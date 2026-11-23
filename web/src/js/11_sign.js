/* ============================================================
   11 · Firma digital (certificado .p12/.pfx o almacén de Windows)
   - Firma CMS/PKCS#7 desacoplada (adbe.pkcs7.detached, SHA-256),
     reconocida por Adobe Acrobat/Reader y validadores estándar.
   - Se agrega como actualización incremental: no invalida firmas
     anteriores del documento.
   - Verificación de integridad de las firmas existentes.
   ============================================================ */
const SIG_HEX = 32768; // espacio reservado para la firma (16 KB)
const u8ToBin = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768)); return s; };
const binToU8 = s => { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255; return a; };
const OID_NAMES = { '2.5.4.3': 'CN', '2.5.4.10': 'O', '2.5.4.11': 'OU', '2.5.4.5': 'serialNumber', '2.5.4.6': 'C', '1.2.840.113549.1.9.1': 'E' };
function dnGet(attrs, short) { const a = (attrs || []).find(x => x.shortName === short || OID_NAMES[x.type] === short); return a ? String(a.value) : ''; }
function certInfo(cert) {
  return {
    cn: dnGet(cert.subject.attributes, 'CN') || dnGet(cert.subject.attributes, 'O'), org: dnGet(cert.subject.attributes, 'O'), serialNumber: dnGet(cert.subject.attributes, 'serialNumber'),
    email: dnGet(cert.subject.attributes, 'E'), issuer: dnGet(cert.issuer.attributes, 'CN') || dnGet(cert.issuer.attributes, 'O'),
    notBefore: cert.validity.notBefore, notAfter: cert.validity.notAfter
  };
}

/* ---------- Firmantes ---------- */
function p12Signer(bytes, password) {
  let p12;
  try { p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(u8ToBin(bytes), { parseAllBytes: false }), false, password); }
  catch (e) { throw new Error(/mac|password|Invalid/i.test(e.message) ? 'Contraseña incorrecta o archivo no válido.' : 'No se pudo leer el certificado: ' + e.message); }
  const oids = forge.pki.oids;
  const keys = [...(p12.getBags({ bagType: oids.pkcs8ShroudedKeyBag })[oids.pkcs8ShroudedKeyBag] || []), ...(p12.getBags({ bagType: oids.keyBag })[oids.keyBag] || [])].map(b => b.key).filter(Boolean);
  const certs = (p12.getBags({ bagType: oids.certBag })[oids.certBag] || []).map(b => b.cert).filter(Boolean);
  if (!keys.length) throw new Error('El archivo no contiene una clave privada compatible (se requiere RSA). Si su certificado es de otro tipo, use el almacén de Windows en la app de escritorio.');
  if (!certs.length) throw new Error('El archivo no contiene certificados.');
  const key = keys[0];
  const cert = certs.find(c => c.publicKey && c.publicKey.n && c.publicKey.n.equals(key.n)) || certs[0];
  const chain = certs.filter(c => c !== cert);
  return {
    kind: 'p12', info: certInfo(cert),
    async sign(data) {
      const p7 = forge.pkcs7.createSignedData();
      p7.content = forge.util.createBuffer(u8ToBin(data));
      p7.addCertificate(cert); chain.forEach(c => p7.addCertificate(c));
      p7.addSigner({
        key, certificate: cert, digestAlgorithm: oids.sha256,
        authenticatedAttributes: [{ type: oids.contentType, value: oids.data }, { type: oids.messageDigest }, { type: oids.signingTime, value: new Date() }]
      });
      p7.sign({ detached: true });
      return binToU8(forge.asn1.toDer(p7.toAsn1()).getBytes());
    }
  };
}
function nativeStoreSigner(c) {
  return { kind: 'store', info: { cn: c.name, issuer: c.issuer, notAfter: new Date(c.notAfter), notBefore: new Date(c.notBefore), serialNumber: c.serialNumber || '' }, async sign(data) { return natBytes('sign?thumbprint=' + encodeURIComponent(c.thumbprint), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: data }); } };
}

/* ---------- Construcción de la firma ---------- */
function pdfDateStr(d) {
  const p = n => String(n).padStart(2, '0'), off = -d.getTimezoneOffset();
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${off >= 0 ? '+' : '-'}${p(Math.floor(Math.abs(off) / 60))}'${p(Math.abs(off) % 60)}'`;
}
async function buildSigAppearance(pdf, w, h, lines, imgBytes, rot) {
  const f1 = await pdf.embedFont(PL.StandardFonts.Helvetica), f2 = await pdf.embedFont(PL.StandardFonts.HelveticaBold);
  const res = { Font: { F1: f1.ref, F2: f2.ref } }; const ops = [];
  let tx = 4;
  if (imgBytes) {
    const img = await pdf.embedPng(imgBytes); res.XObject = { Im1: img.ref };
    const iw = w * 0.42 - 6, ih = h - 8, k = Math.min(iw / img.width, ih / img.height), dw = img.width * k, dh = img.height * k;
    ops.push(PL.pushGraphicsState(), PL.concatTransformationMatrix(dw, 0, 0, dh, 4 + (iw - dw) / 2, (h - dh) / 2), PL.drawObject('Im1'), PL.popGraphicsState());
    tx = w * 0.42 + 2;
  }
  const fonts = { F1: f1, F2: f2 };
  const L = lines.map(l => ({ ...l, t: safeText(fonts[l.f], l.t) }));
  const availW = Math.max(10, w - tx - 4);
  let size = Math.min(11, (h - 6) / (L.length * 1.18));
  for (const l of L) { const w1 = fonts[l.f].widthOfTextAtSize(l.t, 1) || 1; size = Math.min(size, availW / w1); }
  size = Math.max(3.5, size);
  let y = h - 3 - size * 0.95;
  ops.push(PL.setFillingRgbColor(0, 0, 0));
  for (const l of L) { ops.push(PL.beginText(), PL.setFontAndSize(l.f, size), PL.moveText(tx, y), PL.showText(fonts[l.f].encodeText(l.t)), PL.endText()); y -= size * 1.18; }
  const th = (rot || 0) * Math.PI / 180;
  const dict = { BBox: [0, 0, w, h], Resources: res };
  if (rot) dict.Matrix = [Math.round(Math.cos(th)), Math.round(Math.sin(th)), -Math.round(Math.sin(th)), Math.round(Math.cos(th)), 0, 0];
  return pdf.context.register(pdf.context.formXObject(ops, dict));
}
/**
 * Firma bytes PDF. o = { signer, reason, location, contact, visible:{pageIndex, rect:[x1,y1,x2,y2], w, h, rot, image} }
 */
async function signPdfBytes(bytes, o) {
  const pdf = await PL.PDFDocument.load(bytes, { forIncrementalUpdate: true, updateMetadata: false });
  const ctx = pdf.context, now = new Date();
  const page = pdf.getPages()[o.visible ? o.visible.pageIndex : 0];
  const byteRange = PL.PDFArray.withContext(ctx);
  byteRange.push(PL.PDFNumber.of(0)); for (let k = 0; k < 3; k++) byteRange.push(PL.PDFName.of('**********'));
  const sigDict = ctx.obj({
    Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached', ByteRange: byteRange,
    Contents: PL.PDFHexString.of('0'.repeat(SIG_HEX)), M: PL.PDFString.fromDate(now),
    Name: PL.PDFHexString.fromText(o.signer.info.cn || ''), Reason: PL.PDFHexString.fromText(o.reason || ''),
    Location: PL.PDFHexString.fromText(o.location || ''), ContactInfo: PL.PDFHexString.fromText(o.contact || ''),
    Prop_Build: { App: { Name: 'Rubrica' }, Filter: { Name: 'Adobe.PPKLite' } }
  });
  const buf = new Uint8Array(sigDict.sizeInBytes()); sigDict.copyBytesInto(buf, 0);
  const sigRef = ctx.register(PL.PDFInvalidObject.of(buf));
  const acro = pdf.catalog.getOrCreateAcroForm();
  let fields = acro.dict.lookup(PL.PDFName.of('Fields'));
  if (!(fields instanceof PL.PDFArray)) { fields = ctx.obj([]); acro.dict.set(PL.PDFName.of('Fields'), fields); }
  const used = new Set(); try { pdf.getForm().getFields().forEach(f => used.add(f.getName())); } catch { }
  let fname = 'FirmaDigital1'; for (let k = 2; used.has(fname); k++) fname = 'FirmaDigital' + k;
  let rect = [0, 0, 0, 0], ap;
  if (o.visible) {
    rect = o.visible.rect;
    const lines = [{ t: 'Firmado digitalmente por:', f: 'F1' }, { t: o.signer.info.cn || '', f: 'F2' }, { t: 'Fecha: ' + pdfDateStr(now), f: 'F1' }];
    if (o.reason) lines.push({ t: 'Motivo: ' + o.reason, f: 'F1' });
    if (o.location) lines.push({ t: 'Ubicación: ' + o.location, f: 'F1' });
    ap = await buildSigAppearance(pdf, o.visible.w, o.visible.h, lines, o.visible.image, o.visible.rot);
  } else ap = ctx.register(ctx.formXObject([], { BBox: [0, 0, 0, 0], Resources: {} }));
  const widget = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', Rect: rect, V: sigRef, T: PL.PDFHexString.fromText(fname), F: 132, P: page.ref, AP: { N: ap } }));
  let annots = page.node.lookupMaybe(PL.PDFName.of('Annots'), PL.PDFArray);
  if (!annots) { annots = ctx.obj([]); page.node.set(PL.PDFName.of('Annots'), annots); }
  annots.push(widget); fields.push(widget);
  const flags = acro.dict.lookupMaybe(PL.PDFName.of('SigFlags'), PL.PDFNumber);
  acro.dict.set(PL.PDFName.of('SigFlags'), PL.PDFNumber.of((flags ? flags.asNumber() : 0) | 3));
  const out = await pdf.save({ useObjectStreams: false });
  // completar ByteRange y Contents
  const s = u8ToBin(out);
  const ph = '<' + '0'.repeat(SIG_HEX) + '>';
  const cStart = s.lastIndexOf(ph); if (cStart < 0) throw new Error('No se encontró el espacio de la firma.');
  const cEnd = cStart + ph.length;
  const brRe = /\/ByteRange\s*\[\s*0\s+\/\*{10}\s+\/\*{10}\s+\/\*{10}\s*\]/g; let m, last = null;
  while ((m = brRe.exec(s))) last = m;
  if (!last) throw new Error('No se encontró el rango de bytes.');
  const br = [0, cStart, cEnd, out.length - cEnd];
  let brTxt = `/ByteRange [${br.join(' ')}]`;
  if (brTxt.length > last[0].length) throw new Error('Rango de bytes demasiado grande.');
  brTxt = brTxt.padEnd(last[0].length, ' ');
  const res = out.slice();
  res.set(binToU8(brTxt), last.index);
  const data = new Uint8Array(br[1] + br[3]); data.set(res.subarray(0, br[1]), 0); data.set(res.subarray(br[2]), br[1]);
  const cms = await o.signer.sign(data);
  let hex = ''; for (const b of cms) hex += b.toString(16).padStart(2, '0');
  if (hex.length > SIG_HEX) throw new Error('La firma no cabe en el espacio reservado.');
  res.set(binToU8(hex.padEnd(SIG_HEX, '0')), cStart + 1);
  return res;
}

/* ---------- Verificación ---------- */
function scanSignatures(bytes) {
  const s = u8ToBin(bytes), out = [], seen = new Set();
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g; let m;
  while ((m = re.exec(s))) {
    const br = m.slice(1, 5).map(Number); const key = br.join(',');
    if (seen.has(key) || br[1] <= 0 || br[2] + br[3] > s.length || s[br[1]] !== '<' || s[br[2] - 1] !== '>') continue;
    seen.add(key);
    const ds = Math.max(s.lastIndexOf(' obj', br[1]), s.lastIndexOf('\nobj', br[1]), br[1] - 4000, 0);
    let de = s.indexOf('endobj', br[2]); if (de < 0 || de - br[2] > 4000) de = br[2] + 4000;
    const near = s.slice(ds, br[1]) + ' ' + s.slice(br[2], de);
    const str = k => { const mm = near.match(new RegExp('/' + k + '\\s*(\\((?:\\\\.|[^\\\\)])*\\)|<[0-9A-Fa-f\\s]*>)')); return mm ? pdfStrDecode(mm[1]) : ''; };
    out.push({ br, hex: s.slice(br[1] + 1, br[2] - 1).replace(/\s/g, ''), reason: str('Reason'), location: str('Location'), name: str('Name'), m: str('M') });
  }
  return out;
}
function pdfStrDecode(t) {
  if (t[0] === '<') { const h = t.slice(1, -1).replace(/\s/g, ''); let b = ''; for (let i = 0; i < h.length; i += 2) b += String.fromCharCode(parseInt(h.substr(i, 2), 16)); return decodePdfText(b); }
  return decodePdfText(t.slice(1, -1).replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (x, c) => /^[0-7]/.test(c) ? String.fromCharCode(parseInt(c, 8)) : ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[c] || c)));
}
function decodePdfText(b) { if (b.charCodeAt(0) === 0xfe && b.charCodeAt(1) === 0xff) { let o = ''; for (let i = 2; i + 1 < b.length; i += 2) o += String.fromCharCode((b.charCodeAt(i) << 8) | b.charCodeAt(i + 1)); return o; } return b; }
const DIGESTS = { '1.3.14.3.2.26': ['SHA-1', 'sha1'], '2.16.840.1.101.3.4.2.1': ['SHA-256', 'sha256'], '2.16.840.1.101.3.4.2.2': ['SHA-384', 'sha384'], '2.16.840.1.101.3.4.2.3': ['SHA-512', 'sha512'] };
async function verifySignature(bytes, sig) {
  const r = { ...sig, integrity: false, sigValid: null, coversAll: sig.br[2] + sig.br[3] === bytes.length, error: '' };
  try {
    const A = forge.asn1, bin = (() => { let b = ''; for (let i = 0; i < sig.hex.length; i += 2) b += String.fromCharCode(parseInt(sig.hex.substr(i, 2), 16)); return b; })();
    const ci = A.fromDer(bin, { parseAllBytes: false, strict: false });
    const sd = ci.value[1].value[0];
    const certsNode = sd.value.find(n => n.tagClass === A.Class.CONTEXT_SPECIFIC && n.type === 0);
    const signerInfos = sd.value[sd.value.length - 1];
    const si = signerInfos.value[0];
    const digOid = A.derToOid(si.value[2].value[0].value);
    const attrs = si.value.find(n => n.tagClass === A.Class.CONTEXT_SPECIFIC && n.type === 0);
    const sigVal = si.value.find((n, k) => k > 3 && n.type === A.Type.OCTETSTRING && n.tagClass === A.Class.UNIVERSAL);
    const dg = DIGESTS[digOid]; if (!dg) throw new Error('Algoritmo de resumen no soportado');
    const data = new Uint8Array(sig.br[1] + sig.br[3]); data.set(bytes.subarray(sig.br[0], sig.br[0] + sig.br[1]), 0); data.set(bytes.subarray(sig.br[2], sig.br[2] + sig.br[3]), sig.br[1]);
    const digest = u8ToBin(new Uint8Array(await crypto.subtle.digest(dg[0], data)));
    let md = null;
    for (const at of (attrs ? attrs.value : [])) {
      const oid = A.derToOid(at.value[0].value);
      if (oid === '1.2.840.113549.1.9.4') md = at.value[1].value[0].value;
      if (oid === '1.2.840.113549.1.9.5') { try { const t = at.value[1].value[0]; r.signingTime = t.type === A.Type.UTCTIME ? A.utcTimeToDate(t.value) : A.generalizedTimeToDate(t.value); } catch { } }
    }
    r.integrity = attrs ? md === digest : null;
    // certificado del firmante
    let cert = null; const certs = [];
    for (const c of (certsNode ? certsNode.value : [])) { try { certs.push(forge.pki.certificateFromAsn1(c)); } catch { } }
    const sid = si.value[1];
    if (sid.value && sid.value[1]) { const serial = forge.util.bytesToHex(sid.value[1].value); cert = certs.find(c => c.serialNumber.replace(/^0+/, '') === serial.replace(/^0+/, '')); }
    cert = cert || certs[0];
    if (cert) {
      r.cert = certInfo(cert);
      const t = r.signingTime || new Date(); r.certValidAtTime = t >= cert.validity.notBefore && t <= cert.validity.notAfter;
      if (attrs && sigVal) {
        const der = A.toDer(attrs).getBytes(); const setDer = '\x31' + der.slice(1);
        const h = forge.md[dg[1]].create(); h.update(setDer);
        try { r.sigValid = cert.publicKey.verify(h.digest().bytes(), sigVal.value); } catch { r.sigValid = null; }
      }
    } else r.error = 'Certificado no incluido o no compatible para verificación (p. ej. ECDSA).';
  } catch (e) { r.error = e.message; }
  return r;
}

/* ---------- Interfaz ---------- */
async function digitalSignDialog() {
  const d = D(); if (!d) return;
  if (d.security && !d.security.inherited) { toast('Quite la contraseña antes de firmar (un PDF cifrado no se puede firmar aquí).', 'err', 6000); return; }
  let signer = null;
  const info = el('div', { class: 'hint', style: { minHeight: '40px', margin: '6px 0 10px' } });
  const showInfo = () => {
    if (!signer) { info.innerHTML = 'Ningún certificado cargado.'; return; }
    const i = signer.info, exp = i.notAfter && i.notAfter < new Date();
    info.innerHTML = `<b>${escapeHtml(i.cn)}</b>${i.serialNumber ? ' · ' + escapeHtml(i.serialNumber) : ''}<br>Emitido por: ${escapeHtml(i.issuer || '—')}<br>Válido hasta: <span style="color:${exp ? 'var(--danger)' : 'inherit'}">${i.notAfter ? i.notAfter.toLocaleDateString('es-HN') : '—'}${exp ? ' (VENCIDO)' : ''}</span>`;
  };
  showInfo();
  // archivo .p12
  let p12 = null; const savedP12 = await idb.get('p12').catch(() => null);
  if (savedP12) p12 = savedP12;
  const fileLbl = el('span', { class: 'muted', text: p12 ? p12.name : 'Sin archivo' });
  const pw = el('input', { type: 'password', placeholder: 'Contraseña del certificado' });
  const remember = el('input', { type: 'checkbox' }); remember.checked = !!savedP12;
  const loadP12 = () => { try { signer = p12Signer(p12.bytes, pw.value); showInfo(); return true; } catch (e) { signer = null; showInfo(); toast(e.message, 'err', 6000); return false; } };
  const paneP12 = el('div', { class: 'fm' },
    el('div', { class: 'inline', style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' } },
      el('button', { class: 'btn', html: ic('folder-open') + 'Elegir .p12 / .pfx', onclick: async () => { const f = await pickLocal(CAP ? '' : '.p12,.pfx', false); if (!f.length) return; p12 = { name: f[0].name, bytes: await readFileBytes(f[0]) }; fileLbl.textContent = p12.name; signer = null; showInfo(); } }), fileLbl),
    el('div', { class: 'row' }, pw),
    el('div', { class: 'inline', style: { display: 'flex', gap: '8px' } }, el('button', { class: 'btn sm', text: 'Verificar certificado', onclick: () => p12 ? loadP12() : toast('Elija el archivo del certificado.', 'err') }),
      el('label', { class: 'inline hint' }, remember, 'Recordar el archivo en este equipo (nunca la contraseña)')));
  const panes = { p12: paneP12 };
  // almacén de Windows (solo app nativa)
  if (NATIVE) {
    const list = el('div', { class: 'recent-list', style: { maxHeight: '180px', overflow: 'auto' } });
    panes.store = el('div', {}, list);
    natJson('certs').then(cs => {
      if (!cs.length) list.append(el('div', { class: 'cb-empty', text: 'No hay certificados con clave privada en el almacén de Windows.' }));
      for (const c of cs) list.append(el('div', { class: 'recent-row', onclick: e => { $$('.recent-row', list).forEach(x => x.style.background = ''); e.currentTarget.style.background = 'var(--accent2)'; signer = nativeStoreSigner(c); showInfo(); } }, icEl('badge-check'), el('span', { class: 'nm', text: c.name }), el('span', { class: 'src', text: 'vence ' + new Date(c.notAfter).toLocaleDateString('es-HN') })));
    }).catch(e => list.append(el('div', { class: 'cb-empty', text: e.message })));
  }
  const tabs = el('div', { class: 'tabs2' }), paneBox = el('div');
  const setPane = k => { $$('button', tabs).forEach(b => b.classList.toggle('on', b.dataset.k === k)); paneBox.innerHTML = ''; paneBox.append(panes[k]); };
  tabs.append(el('button', { text: 'Archivo .p12 / .pfx', dataset: { k: 'p12' }, onclick: () => setPane('p12') }));
  if (NATIVE) tabs.append(el('button', { text: 'Almacén de Windows / token', dataset: { k: 'store' }, onclick: () => setPane('store') }));
  setPane('p12');
  const reason = el('select'); for (const r of ['Soy el autor de este documento', 'Apruebo este documento', 'He revisado este documento', 'Certifico la exactitud e integridad de este documento', 'Acepto los términos definidos']) reason.append(el('option', { value: r, text: r }));
  const location = el('input', { type: 'text', value: S.settings.sigLocation || 'San Pedro Sula, Honduras' });
  const contact = el('input', { type: 'text', value: S.settings.sigContact || '' , placeholder: 'correo o teléfono (opcional)' });
  const vis = el('select'); for (const [v, l] of [['visible', 'Visible: dibujar el recuadro en la página'], ['invisible', 'Invisible (solo en el panel de firmas)']]) vis.append(el('option', { value: v, text: l }));
  const useImg = el('select'); useImg.append(el('option', { value: '', text: 'Sin firma manuscrita' }));
  store.get('sigs', []).forEach((s, k) => useImg.append(el('option', { value: String(k), text: 'Firma manuscrita guardada #' + (k + 1) })));
  const body = el('div', { class: 'fm' }, tabs, paneBox, info,
    el('div', { class: 'cols' }, el('div', { class: 'row' }, el('label', { text: 'Motivo' }), reason), el('div', { class: 'row' }, el('label', { text: 'Ubicación' }), location)),
    el('div', { class: 'cols' }, el('div', { class: 'row' }, el('label', { text: 'Contacto' }), contact), el('div', { class: 'row' }, el('label', { text: 'Apariencia' }), vis)),
    el('div', { class: 'row' }, el('label', { text: 'Imagen en el recuadro' }), useImg),
    el('div', { class: 'hint', html: 'Al firmar se aplican primero todos los cambios del documento y luego se le pedirá dónde guardar el PDF firmado. Cualquier cambio posterior quedará fuera de la firma.' }));
  const ok = await openModal({ title: 'Firma digital', body, wide: true, buttons: [{ label: 'Cancelar', value: null }, { label: 'Continuar', primary: true, onClick: () => { if (!signer && p12) loadP12(); if (!signer) { toast('Cargue un certificado válido.', 'err'); return false; } if (signer.info.notAfter && signer.info.notAfter < new Date()) { toast('El certificado está vencido.', 'err'); return false; } return true; } }] }).result;
  if (!ok) return;
  S.settings.sigLocation = location.value; S.settings.sigContact = contact.value; saveSettings();
  if (remember.checked && p12) idb.set('p12', { name: p12.name, bytes: p12.bytes }).catch(() => { }); else idb.del('p12').catch(() => { });
  const opts = { signer, reason: reason.value, location: location.value, contact: contact.value };
  const sigs = store.get('sigs', []);
  if (useImg.value !== '') opts.imageDataUrl = sigs[+useImg.value];
  if (vis.value === 'invisible') return performSign(d, opts, null, null);
  S.pendingSign = opts; setTool('sigbox');
  toast('Dibuje en la página el recuadro donde aparecerá la firma.', '', 5000);
}
async function performSign(d, opts, p, r) {
  try {
    let visible = null;
    if (p) {
      const pi = d.pages.indexOf(p);
      let image = null;
      if (opts.imageDataUrl) image = dataUrlToBytes(opts.imageDataUrl);
      visible = { pageIndex: pi, rect: dispRectToUser(p, r), w: r.w, h: r.h, rot: rotT(p), image };
    }
    const bytes = await withBusy('Firmando…', async upd => {
      const base = await buildPdf(d, { progress: upd, noEncrypt: true });
      upd('Aplicando firma digital…', 95);
      return signPdfBytes(base, { ...opts, visible });
    });
    let n = d.name; if (!/firmado/i.test(n)) n = baseName(n) + '_firmado.pdf';
    const saved = await saveAsDialog(d, bytes, n);
    if (!saved) { toast('Firma cancelada: el documento no se guardó.', 'err'); return; }
    await reloadDocFromBytes(d, bytes);
    S.side = 'signatures'; S.sideOpen = true; renderSide();
    toast('Documento firmado digitalmente y guardado.', 'ok', 5000);
  } catch (e) { console.error(e); toast('No se pudo firmar: ' + e.message, 'err', 8000); }
}
async function reloadDocFromBytes(d, bytes) {
  const src = await loadPdfSource(bytes, d.name);
  d.sources = { [src.id]: src }; d.assets = {}; d.fields = {}; d.formValues = {}; d.formOrig = {};
  d.pages = await pagesFromPdfSource(src); await loadFormFields(d, src);
  d.undo = []; d.redo = []; d.cur = 0; d.dirty = false; S.sel = null;
  R.thumbCache.clear(); renderTabs(); afterStructureChange(false);
}
async function renderSignatures(body) {
  const d = D(); const srcs = Object.values(d.sources).filter(s => s.kind === 'pdf' && s.sigs && s.sigs.length);
  if (!srcs.length) { body.append(el('div', { class: 'hint', html: 'Este documento no tiene firmas digitales.<br><br>Para firmar: <b>Proteger → Firma digital</b>.' })); return; }
  const box = el('div', { class: 'slist' }); body.append(box);
  for (const s of srcs) {
    s.sigs.forEach((sig, k) => {
      const row = el('div', { style: { padding: '8px', border: '1px solid var(--line)', borderRadius: '8px', marginBottom: '8px', fontSize: '12px' } }, el('div', { class: 'spinner', style: { width: '16px', height: '16px', borderWidth: '2px' } }));
      box.append(row);
      (sig._v ? Promise.resolve(sig._v) : verifySignature(s.bytes, sig).then(v => (sig._v = v))).then(v => {
        const good = v.integrity && v.sigValid !== false;
        const st = !good ? ['circle-x', 'var(--danger)', 'Firma NO válida: el contenido firmado fue alterado'] : v.coversAll ? ['badge-check', 'var(--ok)', 'Firma íntegra'] : ['badge-check', 'var(--ok)', 'Firma íntegra (con cambios posteriores permitidos)'];
        row.innerHTML = '';
        row.append(el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', fontWeight: 600, color: st[1] } }, icEl(st[0]), st[2]),
          el('div', { style: { marginTop: '6px' }, html: `<b>${escapeHtml(v.cert?.cn || v.name || 'Firmante desconocido')}</b>${v.cert?.serialNumber ? ' · ' + escapeHtml(v.cert.serialNumber) : ''}<br>Emisor: ${escapeHtml(v.cert?.issuer || '—')}<br>Fecha: ${v.signingTime ? v.signingTime.toLocaleString('es-HN') : escapeHtml(v.m || '—')}${v.reason ? '<br>Motivo: ' + escapeHtml(v.reason) : ''}${v.location ? '<br>Ubicación: ' + escapeHtml(v.location) : ''}<br>${v.certValidAtTime === false ? '<span style="color:var(--danger)">Certificado fuera de vigencia al firmar</span><br>' : ''}<span class="muted">Firma ${k + 1} de ${s.sigs.length}. La confianza en la autoridad emisora (SAR u otra) debe confirmarse con su certificado raíz.</span>${v.error ? '<br><span class="muted">' + escapeHtml(v.error) + '</span>' : ''}` }));
      });
    });
  }
}
