/* ============================================================
   11b · Preferencias de firma digital
   - Identificaciones digitales: archivos .p12/.pfx guardados en este
     equipo (nunca la contraseña), almacén de Windows y de Android.
   - Estilos de apariencia del recuadro de firma.
   - Servidores de marca de tiempo (RFC 3161), p. ej. la TSA del SAR.
   ============================================================ */

/* ---------- Marca de tiempo (RFC 3161) ---------- */
const OID_TST = '1.2.840.113549.1.9.16.2.14'; // id-aa-signatureTimeStampToken
const TSA_SAR = { id: 'sar', name: 'TSA_SAR', url: 'http://tsa.sar.gob.hn/CryptosecOpenKey/tsa_service' };
function tsaServers() {
  if (!Array.isArray(S.settings.tsaServers)) { S.settings.tsaServers = [{ ...TSA_SAR }]; S.settings.tsaDefault = TSA_SAR.id; saveSettings(); }
  return S.settings.tsaServers;
}
const tsaById = id => tsaServers().find(t => t.id === id) || null;
/** La marca de tiempo necesita la app (Windows o Android): el navegador no puede llamar a la TSA por CORS. */
const TSA_BRIDGE = () => !!(NATIVE || PSN);

function tsaQuery(imprint, nonce) {
  return tlv(0x30, tlv(0x02, new Uint8Array([1])),
    tlv(0x30, tlv(0x30, derOid(forge.pki.oids.sha256), DER_NULL), tlv(0x04, imprint)),
    tlv(0x02, nonce), tlv(0x01, new Uint8Array([0xff])));
}
async function tsaSend(server, query) {
  const auth = server.user ? btoa(unescape(encodeURIComponent(server.user + ':' + (server.pass || '')))) : '';
  if (NATIVE) return natBytes('tsa', { method: 'POST', headers: { 'Content-Type': 'application/timestamp-query', 'X-Tsa-Url': server.url, ...(auth ? { 'X-Tsa-Auth': auth } : {}) }, body: query });
  if (PSN) return b64ToU8((await PSN.tsaRequest({ url: server.url, data: u8ToB64(query), auth })).data || '');
  let r;
  try { r = await fetch(server.url, { method: 'POST', headers: { 'Content-Type': 'application/timestamp-query', ...(auth ? { Authorization: 'Basic ' + auth } : {}) }, body: query }); }
  catch { throw new Error('El navegador no puede contactar el servidor de marca de tiempo. Use la app de Windows o de Android.'); }
  if (!r.ok) throw new Error('El servidor de marca de tiempo respondió ' + r.status + '.');
  return new Uint8Array(await r.arrayBuffer());
}
/** Lee un TimeStampToken (ContentInfo, nodo forge). Si se da sigValue (cadena binaria), comprueba que la marca cubra esa firma. */
function readTimestampToken(token, sigValue) {
  const A = forge.asn1;
  const sd = token.value[1].value[0];
  const encap = sd.value[2];
  let oct = encap.value[1].value[0]; // [0] EXPLICIT OCTET STRING
  const raw = oct.constructed ? oct.value.map(x => x.value).join('') : oct.value;
  const tst = A.fromDer(raw);
  const f = tst.value, imprint = f[2];
  const hashOid = A.derToOid(imprint.value[0].value[0].value), hashed = imprint.value[1].value;
  let time = null, nonce = null;
  for (let k = 4; k < f.length; k++) {
    const n = f[k];
    if (!time && n.tagClass === A.Class.UNIVERSAL && n.type === A.Type.GENERALIZEDTIME) time = A.generalizedTimeToDate(n.value);
    else if (time && n.tagClass === A.Class.UNIVERSAL && n.type === A.Type.INTEGER) nonce = forge.util.bytesToHex(n.value);
  }
  let tsa = '';
  const certsNode = sd.value.find(n => n.tagClass === A.Class.CONTEXT_SPECIFIC && n.type === 0);
  for (const c of (certsNode ? certsNode.value : [])) {
    try { const ce = forge.pki.certificateFromAsn1(c); const eku = ce.getExtension('extKeyUsage'); if (!tsa || (eku && eku.timeStamping)) tsa = dnGet(ce.subject.attributes, 'CN') || dnGet(ce.subject.attributes, 'O'); } catch { }
  }
  let covers = null;
  if (sigValue != null) {
    const dg = DIGESTS[hashOid];
    if (dg) { const h = forge.md[dg[1]].create(); h.update(sigValue); covers = h.digest().bytes() === hashed; }
  }
  return { time, tsa, nonce, covers };
}
/** Pide la marca de tiempo de la firma (valor de firma del SignerInfo) y la agrega como atributo no firmado. */
async function addTimestampToCms(cms, server) {
  const top = derChildren(cms);
  const ci = derChildren(cms, top[0].body, top[0].end);           // [oid, [0]]
  const sdOuter = ci[1], sdSeq = derChildren(cms, sdOuter.body, sdOuter.end)[0];
  const sdKids = derChildren(cms, sdSeq.body, sdSeq.end);
  const sis = sdKids[sdKids.length - 1];                          // SET OF SignerInfo
  const si = derChildren(cms, sis.body, sis.end)[0];
  const siKids = derChildren(cms, si.body, si.end);
  const sigIdx = siKids.map(k => k.tag).lastIndexOf(0x04);
  if (sigIdx < 0) throw new Error('No se encontró el valor de la firma.');
  const sigNode = siKids[sigIdx], sigValue = cms.slice(sigNode.body, sigNode.end);
  const imprint = new Uint8Array(await crypto.subtle.digest('SHA-256', sigValue));
  const nonce = crypto.getRandomValues(new Uint8Array(8)); nonce[0] = (nonce[0] & 0x7f) | 0x01;
  let resp;
  try { resp = await tsaSend(server, tsaQuery(imprint, nonce)); }
  catch (e) { const err = new Error(e.message || String(e)); err.tsa = true; throw err; }
  const fail = m => { const e = new Error(m); e.tsa = true; return e; };
  let tok;
  try {
    const rk = derChildren(resp, derChildren(resp)[0].body, derChildren(resp)[0].end);
    const st = forge.asn1.fromDer(u8ToBin(resp.slice(rk[0].start, rk[0].end)));
    const status = forge.util.bytesToHex(st.value[0].value) | 0;
    if (status > 1 || rk.length < 2) {
      let txt = ''; try { txt = st.value[1].value.map(x => forge.util.decodeUtf8(x.value)).join(' '); } catch { }
      throw fail('El servidor de marca de tiempo rechazó la solicitud' + (txt ? ': ' + txt : ` (estado ${status}).`));
    }
    tok = resp.slice(rk[1].start, rk[1].end);
  } catch (e) { if (e.tsa) throw e; throw fail('Respuesta no válida del servidor de marca de tiempo.'); }
  const info = readTimestampToken(forge.asn1.fromDer(u8ToBin(tok)), u8ToBin(sigValue));
  if (info.covers === false) throw fail('La marca de tiempo recibida no corresponde a esta firma.');
  if (info.nonce && info.nonce.replace(/^0+/, '') !== forge.util.bytesToHex(u8ToBin(nonce)).replace(/^0+/, '')) throw fail('La marca de tiempo recibida no corresponde a esta solicitud.');
  // SignerInfo con [1] unsignedAttrs (agrega a los existentes si los hubiera)
  const attr = tlv(0x30, derOid(OID_TST), tlv(0x31, tok));
  const kids = siKids.map(k => cms.slice(k.start, k.end));
  const ua = siKids.findIndex(k => k.tag === 0xa1);
  if (ua >= 0) kids[ua] = tlv(0xa1, cms.slice(siKids[ua].body, siKids[ua].end), attr); else kids.push(tlv(0xa1, attr));
  const newSi = tlv(0x30, ...kids);
  const otherSi = derChildren(cms, sis.body, sis.end).slice(1).map(k => cms.slice(k.start, k.end));
  const sdParts = sdKids.slice(0, -1).map(k => cms.slice(k.start, k.end));
  const newSd = tlv(0x30, ...sdParts, tlv(0x31, newSi, ...otherSi));
  return tlv(0x30, cms.slice(ci[0].start, ci[0].end), tlv(0xa0, newSd));
}
async function testTsa(server) {
  const imprint = crypto.getRandomValues(new Uint8Array(32)), nonce = crypto.getRandomValues(new Uint8Array(8)); nonce[0] = (nonce[0] & 0x7f) | 1;
  const resp = await tsaSend(server, tsaQuery(imprint, nonce));
  const rk = derChildren(resp, derChildren(resp)[0].body, derChildren(resp)[0].end);
  const st = forge.asn1.fromDer(u8ToBin(resp.slice(rk[0].start, rk[0].end)));
  if ((forge.util.bytesToHex(st.value[0].value) | 0) > 1 || rk.length < 2) throw new Error('El servidor rechazó la solicitud de prueba.');
  return readTimestampToken(forge.asn1.fromDer(u8ToBin(resp.slice(rk[1].start, rk[1].end))), null);
}

/* ---------- Estilos de apariencia ---------- */
const SIG_FIELDS = [['name', 'Nombre'], ['location', 'Ubicación'], ['dn', 'Nombre distinguido'], ['logo', 'Logo'], ['date', 'Fecha'], ['time', 'Hora'], ['reason', 'Razón'], ['labels', 'Etiquetas']];
const STD_STYLE = Object.freeze({ id: 'std', title: 'Estilo estándar', graphic: 'name', image: null, dir: 'auto', show: { name: true, location: true, dn: false, logo: false, date: true, time: true, reason: true, labels: true } });
const sigStyles = () => [STD_STYLE, ...(S.settings.sigStyles || [])];
const sigStyleById = id => sigStyles().find(s => s.id === id) || STD_STYLE;
const SIG_LBL = { dn: 'DN: ', reason: 'Motivo: ', location: 'Ubicación: ', date: 'Fecha: ' };
function sigDateText(d, st) {
  const p = n => String(n).padStart(2, '0'), off = -d.getTimezoneOffset(), out = [];
  if (st.show.date) out.push(`${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`);
  if (st.show.time) out.push(`${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${off >= 0 ? '+' : '-'}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`);
  return out.join(' ');
}
function sigTextLines(st, data) {
  const L = [], lab = st.show.labels, add = (k, v, bold) => { if (v) L.push({ t: (lab && SIG_LBL[k] ? SIG_LBL[k] : '') + v, bold: !!bold }); };
  if (st.show.name && data.cn) { if (lab) L.push({ t: 'Firmado digitalmente por:', bold: false }); add('name', data.cn, true); }
  if (st.show.dn) add('dn', data.dn);
  if (st.show.reason) add('reason', data.reason);
  if (st.show.location) add('location', data.location);
  if (st.show.date || st.show.time) add('date', sigDateText(data.date || new Date(), st));
  return L;
}
function wrapWords(t, W, mw) {
  const out = []; let cur = '';
  for (const w of String(t).split(/\s+/).filter(Boolean)) {
    const tryL = cur ? cur + ' ' + w : w;
    if (mw(tryL) <= W) { cur = tryL; continue; }
    if (cur) out.push(cur);
    if (mw(w) <= W) { cur = w; continue; }
    let part = ''; for (const ch of w) { if (mw(part + ch) > W && part) { out.push(part); part = ch; } else part += ch; } cur = part;
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}
function fitBlock(lines, W, H, measure, maxSize, minSize) {
  let best = null;
  const words = lines.flatMap(l => String(l.t).split(/\s+/).filter(Boolean).map(w => [w, l.bold]));
  for (let size = maxSize; size >= minSize; size -= 0.25) {
    const out = []; for (const l of lines) for (const t of wrapWords(l.t, W, x => measure(x, l.bold, size))) out.push({ t, bold: l.bold });
    best = { size, lines: out };
    // no partir palabras mientras se pueda reducir la letra (salvo palabras muy largas, p. ej. el DN)
    const breaks = words.some(([w, b]) => w.length <= 24 && measure(w, b, size) > W);
    if (!breaks && out.length * size * 1.18 <= H) return best;
  }
  const keep = Math.max(1, Math.floor(H / (minSize * 1.18)));
  return { size: minSize, lines: best.lines.slice(0, keep) };
}
/**
 * Distribución del recuadro (origen abajo a la izquierda, unidades del recuadro).
 * Devuelve { items: [{kind:'text', t, bold, size, x, y(base)} | {kind:'img', x, y, w, h}], logo?: {x, y, w, h} }
 */
function sigLayout(st, data, w, h, measure, imgAspect) {
  const pad = Math.max(1.5, Math.min(w, h) * 0.05), rtl = st.dir === 'rtl', items = [];
  const graphic = st.graphic === 'name' ? (data.cn ? 'name' : null) : st.graphic === 'image' && imgAspect ? 'image' : null;
  const lines = sigTextLines(st, data);
  let tx = pad, tw = w - 2 * pad;
  if (graphic) {
    const gw = lines.length ? (w - 3 * pad) * 0.45 : w - 2 * pad, gh = h - 2 * pad, gx = rtl ? w - pad - gw : pad;
    if (graphic === 'image') {
      const k = Math.min(gw / imgAspect, gh), iw = k * imgAspect, ih = k;
      items.push({ kind: 'img', x: gx + (gw - iw) / 2, y: pad + (gh - ih) / 2, w: iw, h: ih });
    } else {
      const b = fitBlock([{ t: data.cn, bold: false }], gw, gh, measure, Math.max(6, gh * 0.42), 3);
      let y = h - pad - (gh - b.lines.length * b.size * 1.18) / 2 - b.size * 0.92;
      for (const l of b.lines) { items.push({ kind: 'text', t: l.t, bold: false, size: b.size, x: gx + (gw - measure(l.t, false, b.size)) / 2, y }); y -= b.size * 1.18; }
    }
    if (lines.length) { tw = w - 3 * pad - gw; tx = rtl ? pad : gx + gw + pad; }
  }
  if (lines.length && tw > 4) {
    const b = fitBlock(lines, tw, h - 2 * pad, measure, Math.min(11, h * 0.3), 3);
    let y = h - pad - Math.max(0, (h - 2 * pad - b.lines.length * b.size * 1.18) / 2) - b.size * 0.92;
    for (const l of b.lines) { const lw = measure(l.t, l.bold, b.size); items.push({ kind: 'text', t: l.t, bold: l.bold, size: b.size, x: rtl ? tx + tw - lw : tx, y }); y -= b.size * 1.18; }
  }
  const out = { items };
  if (st.show.logo) { const lh = h * 0.92, lw = Math.min(w * 0.92, lh * BRAND_ASPECT), lh2 = lw / BRAND_ASPECT; out.logo = { x: (w - lw) / 2, y: (h - lh2) / 2, w: lw, h: lh2 }; }
  return out;
}
const BRAND_ASPECT = 138.99 / 182.11;
let _brandPng = null;
/** Marca de ZMA en PNG (color menta) para el fondo «Logo» del recuadro de firma. */
async function brandPng() {
  if (_brandPng) return _brandPng;
  const H = 320, W = Math.round(H * BRAND_ASPECT);
  const svg = BRAND_ICON.replace('<svg', `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"`).replace('fill="currentColor"', 'fill="#00866a"');
  const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  const c = el('canvas', { width: W, height: H }); c.getContext('2d').drawImage(img, 0, 0, W, H);
  return (_brandPng = await canvasToBytes(c, 'image/png'));
}
const sigSample = signer => ({ cn: signer?.info?.cn || S.settings.author || 'Nombre del firmante', dn: signer?.info?.dn || 'CN=Nombre del firmante, O=Organización, C=HN', reason: 'Soy el autor de este documento', location: S.settings.sigLocation || 'San Pedro Sula, Honduras', date: new Date() });
/** Vista previa del recuadro en un canvas (misma distribución que el PDF). */
async function drawSigPreview(canvas, st, data, w = 240, h = 80) {
  const scale = canvas.width / w, g = canvas.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
  g.setTransform(scale, 0, 0, scale, 0, 0);
  const font = (b, s) => `${b ? 'bold ' : ''}${s}px Helvetica, Arial, sans-serif`;
  const measure = (t, b, s) => { g.font = font(b, s); return g.measureText(t).width; };
  let img = null; if (st.graphic === 'image' && st.image) img = await loadImage(st.image).catch(() => null);
  const L = sigLayout(st, data, w, h, measure, img ? img.naturalWidth / img.naturalHeight : null);
  if (L.logo) { const lg = await loadImage(bytesToObjUrl(await brandPng())); g.globalAlpha = 0.13; g.drawImage(lg, L.logo.x, h - L.logo.y - L.logo.h, L.logo.w, L.logo.h); g.globalAlpha = 1; }
  g.fillStyle = '#000'; g.textBaseline = 'alphabetic';
  for (const it of L.items) {
    if (it.kind === 'img') g.drawImage(img, it.x, h - it.y - it.h, it.w, it.h);
    else { g.font = font(it.bold, it.size); g.fillText(it.t, it.x, h - it.y); }
  }
}
const bytesToObjUrl = b => URL.createObjectURL(new Blob([b], { type: 'image/png' }));
async function imageToPngDataUrl(src, max = 900) {
  const img = await loadImage(src); const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = el('canvas', { width: Math.round(img.naturalWidth * k), height: Math.round(img.naturalHeight * k) });
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/png');
}
async function styleEditor(st) {
  const s = structuredClone(st);
  const cv = el('canvas', { width: 720, height: 240, style: { width: '100%', maxWidth: '480px', border: '1px solid var(--line)', borderRadius: '6px', background: '#fff', display: 'block' } });
  const redraw = () => drawSigPreview(cv, s, sigSample(null));
  const title = el('input', { type: 'text', value: s.title });
  const gRadios = el('div', { class: 'inline', style: { display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' } });
  const imgBtn = el('button', { class: 'btn sm', text: 'Consultar…' });
  const sigsSel = el('select', { style: { maxWidth: '220px' } }); sigsSel.append(el('option', { value: '', text: 'o use una firma manuscrita guardada…' }));
  store.get('sigs', []).forEach((x, k) => sigsSel.append(el('option', { value: String(k), text: 'Firma manuscrita #' + (k + 1) })));
  for (const [v, l] of [['none', 'Sin gráfico'], ['name', 'Nombre'], ['image', 'Gráfico importado']]) {
    const r = el('input', { type: 'radio', name: 'sg', value: v }); r.checked = s.graphic === v;
    r.onchange = () => { s.graphic = v; if (v === 'image' && !s.image) imgBtn.click(); redraw(); };
    gRadios.append(el('label', { class: 'inline' }, r, l));
  }
  gRadios.append(imgBtn, sigsSel);
  imgBtn.onclick = async () => {
    const f = await pickLocal('image/png,image/jpeg,image/webp,image/gif', false); if (!f.length) return;
    s.image = await imageToPngDataUrl(URL.createObjectURL(f[0])); s.graphic = 'image'; $$('input[name=sg]', gRadios).forEach(r => r.checked = r.value === 'image'); redraw();
  };
  sigsSel.onchange = () => { const v = store.get('sigs', [])[+sigsSel.value]; if (sigsSel.value !== '' && v) { s.image = v; s.graphic = 'image'; $$('input[name=sg]', gRadios).forEach(r => r.checked = r.value === 'image'); redraw(); } };
  const checks = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '6px 12px' } });
  for (const [k, l] of SIG_FIELDS) { const c = el('input', { type: 'checkbox' }); c.checked = !!s.show[k]; c.onchange = () => { s.show[k] = c.checked; redraw(); }; checks.append(el('label', { class: 'inline' }, c, l)); }
  const dirs = el('div', { class: 'inline', style: { display: 'flex', gap: '14px' } });
  for (const [v, l] of [['auto', 'Auto'], ['ltr', 'De izquierda a derecha'], ['rtl', 'De derecha a izquierda']]) { const r = el('input', { type: 'radio', name: 'sd', value: v }); r.checked = (s.dir || 'auto') === v; r.onchange = () => { s.dir = v; redraw(); }; dirs.append(el('label', { class: 'inline' }, r, l)); }
  const body = el('div', { class: 'fm' },
    el('div', { class: 'row' }, el('label', { text: 'Título' }), title),
    el('h5', { text: 'Vista previa' }), cv,
    el('h5', { text: 'Configurar gráfico' }), gRadios,
    el('h5', { text: 'Configurar texto' }), checks,
    el('h5', { text: 'Dirección del texto' }), dirs,
    el('div', { class: 'hint', html: '«Logo» dibuja la marca de Rúbrica atenuada al fondo del recuadro. El texto se ajusta solo al tamaño del recuadro que dibuje en la página.' }));
  setTimeout(redraw, 0);
  const ok = await openModal({ title: 'Configurar el estilo de la firma', body, wide: true, buttons: [{ label: 'Cancelar', value: null }, { label: 'Aceptar', primary: true, onClick: () => { if (!title.value.trim()) { toast('Escriba un título.', 'err'); return false; } if (s.graphic === 'image' && !s.image) { toast('Elija la imagen del gráfico.', 'err'); return false; } return true; } }] }).result;
  if (!ok) return null;
  s.title = title.value.trim(); return s;
}

/* ---------- Identificaciones digitales ---------- */
async function loadIds() {
  let ids = await idb.get('ids').catch(() => null);
  if (!Array.isArray(ids)) {
    ids = []; const old = await idb.get('p12').catch(() => null); // versión 1.1: un solo archivo recordado
    if (old && old.bytes) { ids.push({ id: 'f' + Date.now().toString(36), name: old.name, bytes: old.bytes, info: null, added: Date.now() }); if (!S.settings.sigIdDefault) { S.settings.sigIdDefault = 'f:' + ids[0].id; saveSettings(); } }
    await idb.set('ids', ids).catch(() => { }); idb.del('p12').catch(() => { });
  }
  return ids;
}
const saveIds = ids => idb.set('ids', ids).catch(e => toast('No se pudo guardar la lista: ' + e.message, 'err'));
const infoToJson = i => i && { cn: i.cn, issuer: i.issuer, dn: i.dn || '', serialNumber: i.serialNumber || '', usage: i.usage || [], notBefore: +i.notBefore, notAfter: +i.notAfter };
const infoFromJson = i => i && { ...i, notBefore: new Date(i.notBefore), notAfter: new Date(i.notAfter) };
/** Agrega un .p12/.pfx a la lista: pide la contraseña solo para comprobarla y leer el certificado. */
async function addIdFile(file, password) {
  const bytes = file instanceof Blob ? await readFileBytes(file) : file.bytes, name = file.name; // ojo: Blob.bytes() existe en Chrome reciente
  let pw = password, signer = null;
  for (;;) {
    if (pw == null) pw = await askPassword('Contraseña del certificado', `Escriba la contraseña de «${escapeHtml(name)}» para comprobarlo. No se guarda: se pedirá al firmar.`);
    if (pw == null) return null;
    try { signer = p12Signer(bytes, pw); break; } catch (e) { toast(e.message, 'err', 6000); pw = null; }
  }
  const ids = await loadIds();
  const entry = { id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, bytes, info: infoToJson(signer.info), added: Date.now() };
  ids.push(entry); await saveIds(ids);
  if (!S.settings.sigIdDefault) { S.settings.sigIdDefault = 'f:' + entry.id; saveSettings(); }
  return { entry, signer };
}
function certInfoTable(i) {
  if (!i) return el('div', { class: 'hint', text: 'Datos del certificado disponibles después de usarlo por primera vez (escriba la contraseña y pulse «Verificar»).' });
  const exp = i.notAfter && i.notAfter < new Date(), f = d => d ? d.toLocaleString('es-HN') : '—';
  const rows = [['Nombre del certificado', i.cn], ['Número de identidad / RTN', i.serialNumber || '—'], ['Emisor', i.issuer || '—'], ['Válido desde', f(i.notBefore)], ['Válido hasta', f(i.notAfter) + (exp ? ' (VENCIDO)' : '')], ['Uso previsto', usageText(i.usage)], ['Nombre distinguido', i.dn || '—']];
  return el('table', { class: 'kv' }, ...rows.map(([k, v]) => el('tr', {}, el('th', { text: k }), el('td', { text: v, style: k === 'Válido hasta' && exp ? { color: 'var(--danger)' } : {} }))));
}

/* ---------- Ventana «Preferencias de firma» ---------- */
async function signPrefsDialog(tab = 'ids') {
  const tabs = el('div', { class: 'tabs2' }), paneBox = el('div', { style: { minHeight: '360px' } });
  const panes = { ids: idsPane, style: stylesPane, tsa: tsaPane, trust: () => trustPane(() => setPane('trust')) };
  const setPane = async k => { tab = k; $$('button', tabs).forEach(b => b.classList.toggle('on', b.dataset.k === k)); paneBox.innerHTML = ''; paneBox.append(await panes[k]()); };
  for (const [k, l] of [['ids', 'Identificación digital'], ['style', 'Aspecto de la firma'], ['tsa', 'Servidores de marca de tiempo'], ['trust', 'Certificados de confianza']]) tabs.append(el('button', { text: l, dataset: { k }, onclick: () => setPane(k) }));
  setPane(tab);
  await openModal({ title: 'Preferencias de firma', body: el('div', { class: 'fm' }, tabs, paneBox), wide: true, buttons: [{ label: 'Cerrar', primary: true, value: true }] }).result;

  function listBox(rows, sel, onSel, actions) {
    const box = el('div', { class: 'recent-list sp-list' });
    for (const r of rows) {
      const row = el('div', { class: 'recent-row' + (r.key === sel ? ' on' : ''), dataset: { key: r.key }, onclick: () => onSel(r.key) },
        icEl(r.icon), el('span', { class: 'nm', text: r.name }), el('span', { class: 'src', text: r.src }), r.def ? el('span', { class: 'badge', text: 'Predeterminado' }) : null);
      box.append(row);
    }
    if (!rows.length) box.append(el('div', { class: 'cb-empty', text: 'La lista está vacía.' }));
    return el('div', {}, el('div', { class: 'sp-bar' }, ...actions), box);
  }
  async function idsPane() {
    const wrap = el('div');
    const ids = await loadIds(); let winCerts = [];
    if (NATIVE) winCerts = await natJson('certs').catch(() => []);
    const rows = [
      ...ids.map(x => ({ key: 'f:' + x.id, icon: 'file-badge', name: x.info?.cn ? `${x.info.cn} (${x.name})` : x.name, src: 'Archivo de identificación digital', info: infoFromJson(x.info) })),
      ...winCerts.map(c => ({ key: 's:' + c.thumbprint, icon: 'badge-check', name: c.name, src: 'Almacén de certificados de Windows', info: nativeStoreSigner(c).info })),
      ...(PSN && S.settings.androidCertAlias ? [{ key: 'a:' + S.settings.androidCertAlias, icon: 'smartphone', name: S.settings.androidCertAlias, src: 'Certificado instalado en Android', info: null }] : [])];
    rows.forEach(r => r.def = r.key === S.settings.sigIdDefault);
    let sel = (rows.find(r => r.def) || rows[0] || {}).key;
    const info = el('div', { class: 'sp-info' });
    const render = () => {
      const cur = rows.find(r => r.key === sel);
      wrap.innerHTML = '';
      wrap.append(listBox(rows, sel, k => { sel = k; render(); }, [
        el('button', { class: 'btn sm', html: ic('plus') + 'Añadir archivo .p12 / .pfx', onclick: async () => { const f = await pickLocal(CAP ? '' : '.p12,.pfx', false); if (!f.length) return; const r = await addIdFile(f[0]); if (r) { toast('Identificación digital añadida.', 'ok'); S.settings.sigIdDefault = S.settings.sigIdDefault || 'f:' + r.entry.id; setPane('ids'); } } }),
        el('button', { class: 'btn sm', html: ic('star') + 'Predeterminada', disabled: !cur, onclick: () => { S.settings.sigIdDefault = sel; saveSettings(); setPane('ids'); } }),
        el('button', { class: 'btn sm', html: ic('trash-2') + 'Quitar', disabled: !cur || !/^[fa]:/.test(sel), onclick: async () => {
          if (!(await confirmDialog('Quitar identificación', 'Se quitará de la lista de Rúbrica. El archivo original y el certificado no se borran.', 'Quitar', true))) return;
          if (sel.startsWith('f:')) await saveIds(ids.filter(x => 'f:' + x.id !== sel)); else { S.settings.androidCertAlias = ''; }
          if (S.settings.sigIdDefault === sel) S.settings.sigIdDefault = ''; saveSettings(); setPane('ids');
        } }),
        ...(NATIVE ? [el('button', { class: 'btn sm', html: ic('refresh-cw') + 'Actualizar', onclick: () => setPane('ids') })] : []),
        ...(PSN ? [el('button', { class: 'btn sm', html: ic('smartphone') + 'Certificado de Android', onclick: async () => { try { const c = await PSN.chooseCertificate({ alias: S.settings.androidCertAlias || '' }); if (c && c.alias) { S.settings.androidCertAlias = c.alias; if (!S.settings.sigIdDefault) S.settings.sigIdDefault = 'a:' + c.alias; saveSettings(); setPane('ids'); } } catch (e) { toast(e.message || String(e), 'err'); } } })] : [])]));
      info.innerHTML = ''; info.append(el('h5', { text: 'Información sobre el certificado' }), cur ? certInfoTable(cur.info) : el('div', { class: 'hint', text: 'Añada su certificado .p12/.pfx (por ejemplo, la firma electrónica del SAR).' }));
      if (cur && sel.startsWith('a:') && !cur.info) PSN.getCertificate({ alias: sel.slice(2) }).then(c => { cur.info = androidCertInfo(c, (c.chain || []).map(b64ToU8)); if (rows.find(r => r.key === sel) === cur) { info.lastChild.replaceWith(certInfoTable(cur.info)); } }).catch(() => { });
      wrap.append(info, el('div', { class: 'hint', html: 'La contraseña de los archivos <b>nunca</b> se guarda. Los certificados del almacén de Windows (incluidos tokens USB) se usan con el PIN de Windows; la clave privada no sale del sistema.' }));
    };
    render(); return wrap;
  }
  async function stylesPane() {
    const wrap = el('div'); let sel = S.settings.sigStyleDefault && sigStyleById(S.settings.sigStyleDefault).id || 'std';
    const cv = el('canvas', { width: 720, height: 240, style: { width: '100%', maxWidth: '480px', border: '1px solid var(--line)', borderRadius: '6px', background: '#fff', display: 'block' } });
    const save = list => { S.settings.sigStyles = list; saveSettings(); };
    const render = () => {
      const all = sigStyles(), cur = sigStyleById(sel), custom = sel !== 'std';
      wrap.innerHTML = '';
      wrap.append(listBox(all.map(s => ({ key: s.id, icon: 'pen-line', name: s.title, src: s.id === 'std' ? 'Incluido' : '', def: s.id === (S.settings.sigStyleDefault || 'std') })), sel, k => { sel = k; render(); }, [
        el('button', { class: 'btn sm', html: ic('plus') + 'Crear', onclick: async () => { const s = await styleEditor({ ...structuredClone(STD_STYLE), id: 'st' + Date.now().toString(36), title: 'Nuevo estilo' }); if (s) { save([...(S.settings.sigStyles || []), s]); sel = s.id; render(); } } }),
        el('button', { class: 'btn sm', html: ic('pencil') + 'Editar', disabled: !custom, onclick: async () => { const s = await styleEditor(cur); if (s) { save((S.settings.sigStyles || []).map(x => x.id === s.id ? s : x)); render(); } } }),
        el('button', { class: 'btn sm', html: ic('copy') + 'Duplicar', onclick: async () => { const s = await styleEditor({ ...structuredClone(cur), id: 'st' + Date.now().toString(36), title: cur.title + ' (copia)' }); if (s) { save([...(S.settings.sigStyles || []), s]); sel = s.id; render(); } } }),
        el('button', { class: 'btn sm', html: ic('star') + 'Predeterminado', onclick: () => { S.settings.sigStyleDefault = sel; saveSettings(); render(); } }),
        el('button', { class: 'btn sm', html: ic('trash-2') + 'Eliminar', disabled: !custom, onclick: async () => { if (!(await confirmDialog('Eliminar estilo', `¿Eliminar «${escapeHtml(cur.title)}»?`, 'Eliminar', true))) return; save((S.settings.sigStyles || []).filter(x => x.id !== sel)); if (S.settings.sigStyleDefault === sel) { S.settings.sigStyleDefault = 'std'; saveSettings(); } sel = 'std'; render(); } })]),
        el('h5', { text: 'Estilo de apariencia' }), cv);
      drawSigPreview(cv, cur, sigSample(null));
    };
    render(); return wrap;
  }
  async function tsaPane() {
    const wrap = el('div'); const list = tsaServers(); let sel = S.settings.tsaDefault || (list[0] || {}).id;
    const edit = async t => {
      const v = await formDialog(t ? 'Servidor de marca de tiempo' : 'Añadir servidor de marca de tiempo', [
        { key: 'name', label: 'Nombre', value: t?.name || '' },
        { key: 'url', label: 'URL', value: t?.url || '', placeholder: 'http://servidor/tsa' },
        { key: 'auth', label: 'Este servidor requiere que me conecte', type: 'checkbox', value: !!t?.user },
        { key: 'user', label: 'Nombre de usuario', value: t?.user || '' },
        { key: 'pass', label: 'Contraseña', type: 'password', value: t?.pass || '' },
        { type: 'hint', label: 'La TSA del SAR no requiere usuario. Si su servidor lo pide, la contraseña se guarda en este equipo.' }], {
        validate: v => !v.name.trim() ? 'Escriba un nombre.' : !/^https?:\/\/\S+$/i.test(v.url.trim()) ? 'La URL debe empezar con http:// o https://' : null });
      if (!v) return null;
      return { id: t?.id || 't' + Date.now().toString(36), name: v.name.trim(), url: v.url.trim(), user: v.auth ? v.user.trim() : '', pass: v.auth ? v.pass : '' };
    };
    const save = l => { S.settings.tsaServers = l; saveSettings(); };
    const render = () => {
      const cur = tsaById(sel);
      wrap.innerHTML = '';
      wrap.append(listBox(tsaServers().map(t => ({ key: t.id, icon: 'clock', name: t.name, src: t.url, def: t.id === S.settings.tsaDefault })), sel, k => { sel = k; render(); }, [
        el('button', { class: 'btn sm', html: ic('plus') + 'Añadir', onclick: async () => { const t = await edit(null); if (t) { save([...tsaServers(), t]); sel = t.id; render(); } } }),
        el('button', { class: 'btn sm', html: ic('pencil') + 'Editar', disabled: !cur, onclick: async () => { const t = await edit(cur); if (t) { save(tsaServers().map(x => x.id === t.id ? t : x)); render(); } } }),
        el('button', { class: 'btn sm', html: ic('star') + 'Establecer por defecto', disabled: !cur, onclick: () => { S.settings.tsaDefault = S.settings.tsaDefault === sel ? '' : sel; saveSettings(); render(); } }),
        el('button', { class: 'btn sm', html: ic('plug') + 'Probar', disabled: !cur, onclick: async () => {
          try { const r = await withBusy('Consultando ' + cur.name + '…', () => testTsa(cur)); alertDialog('Servidor de marca de tiempo', `<b>${escapeHtml(cur.name)}</b> respondió correctamente.<br>Hora del servidor: <b>${r.time ? r.time.toLocaleString('es-HN') : '—'}</b>${r.tsa ? '<br>Autoridad: ' + escapeHtml(r.tsa) : ''}`); }
          catch (e) { alertDialog('Servidor de marca de tiempo', `<span style="color:var(--danger)">${escapeHtml(e.message || String(e))}</span>`); }
        } }),
        el('button', { class: 'btn sm', html: ic('trash-2') + 'Eliminar', disabled: !cur, onclick: async () => { if (!(await confirmDialog('Eliminar servidor', `¿Eliminar «${escapeHtml(cur.name)}»?`, 'Eliminar', true))) return; save(tsaServers().filter(x => x.id !== sel)); if (S.settings.tsaDefault === sel) { S.settings.tsaDefault = ''; saveSettings(); } sel = (tsaServers()[0] || {}).id; render(); } })]),
        el('h5', { text: 'Configurar servidores de marca de hora' }),
        el('div', { class: 'hint', html: `Con un servidor <b>predeterminado</b>, cada firma lleva una marca de tiempo confiable emitida por esa autoridad (p. ej. la TSA del SAR): la fecha de la firma ya no depende del reloj de este equipo y la firma sigue siendo verificable después de que el certificado venza.${TSA_BRIDGE() ? '' : '<br><b>En el navegador</b> los servidores de marca de tiempo no suelen aceptar conexiones: use la app de Windows o de Android.'}` }));
    };
    render(); return wrap;
  }
}
