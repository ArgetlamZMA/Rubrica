/* ============================================================
   11c · Confianza en las firmas
   Una firma «íntegra» solo dice que el documento no cambió. Para que sea
   «de confianza», el certificado del firmante debe encadenar hasta una
   raíz en la que el usuario confía:
     1. Raíces de Rúbrica: incluidas en la app o importadas por el usuario
        (Preferencias de firma → Certificados de confianza).
     2. En Windows: el almacén de certificados del sistema (donde el SAR
        indica instalar sus certificados raíz y subordinado).
     3. En Android: los certificados de CA instalados en el teléfono.
   La revocación (OCSP/CRL) aún no se consulta.
   ============================================================ */

/** Raíces incluidas en Rúbrica: { name, sha256 (huella en hex), der (Base64) }. La huella se comprueba al cargar. */
const TRUST_BUILTIN = [];

const certDer = c => forge.asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes();
const certFp = c => { const h = forge.md.sha256.create(); h.update(certDer(c)); return h.digest().toHex(); };
const fpPretty = hex => hex.toUpperCase().match(/../g).join(':');
const certCn = c => dnGet(c.subject.attributes, 'CN') || dnGet(c.subject.attributes, 'O') || '(sin nombre)';
const isSelfSigned = c => c.subject.hash === c.issuer.hash;

async function trustList() {
  const l = await idb.get('trust').catch(() => null);
  return Array.isArray(l) ? l : [];
}
async function trustAnchors() {
  const out = [];
  for (const b of TRUST_BUILTIN) {
    try { const c = forge.pki.certificateFromAsn1(forge.asn1.fromDer(atob(b.der))); if (certFp(c) === b.sha256.toLowerCase().replace(/[^0-9a-f]/g, '')) out.push({ cert: c, source: 'incluida en Rúbrica' }); } catch { }
  }
  for (const t of await trustList()) {
    try { out.push({ cert: forge.pki.certificateFromAsn1(forge.asn1.fromDer(atob(t.der))), source: 'importada' }); } catch { }
  }
  return out;
}
/** Agrega certificados (forge) a la lista de confianza del usuario. Devuelve cuántos eran nuevos. */
async function addTrusted(certs) {
  const l = await trustList(); let n = 0;
  for (const c of certs) {
    const fp = certFp(c); if (l.some(x => x.fp === fp)) continue;
    l.push({ fp, der: btoa(certDer(c)), cn: certCn(c), issuer: dnGet(c.issuer.attributes, 'CN') || '', notBefore: +c.validity.notBefore, notAfter: +c.validity.notAfter, added: Date.now() }); n++;
  }
  await idb.set('trust', l); return n;
}
/** Lee certificados de un archivo .cer/.crt/.pem/.der (uno o varios en PEM). */
function parseCertFile(bytes) {
  const txt = new TextDecoder('latin1').decode(bytes.slice(0, Math.min(bytes.length, 200000)));
  if (txt.includes('-----BEGIN CERTIFICATE-----')) return forge.pki.certificateFromPem ? (txt.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || []).map(p => forge.pki.certificateFromPem(p)) : [];
  return [forge.pki.certificateFromAsn1(forge.asn1.fromDer(u8ToBin(bytes)))];
}

/**
 * Construye la cadena desde el firmante usando los certificados incluidos en la firma y las raíces de confianza.
 * Verifica la firma de cada eslabón y la vigencia de cada certificado en la fecha de la firma.
 */
function buildTrustPath(leaf, pool, anchors, when) {
  const verifies = (issuer, child) => { try { return issuer.verify(child); } catch { return false; } };
  const path = [leaf]; let cur = leaf, anchor = null;
  for (let depth = 0; depth < 8 && !anchor; depth++) {
    const self = anchors.find(a => certFp(a.cert) === certFp(cur));
    if (self) { anchor = self; break; }
    const up = anchors.find(a => a.cert.subject.hash === cur.issuer.hash && verifies(a.cert, cur));
    if (up) { path.push(up.cert); anchor = up; break; }
    if (isSelfSigned(cur)) return { status: 'untrusted', path, top: cur, reason: `La raíz «${certCn(cur)}» no está en sus certificados de confianza.` };
    const next = pool.find(c => c !== cur && !path.includes(c) && c.subject.hash === cur.issuer.hash && verifies(c, cur));
    if (!next) return { status: 'untrusted', path, top: cur, reason: `La firma no incluye el certificado del emisor «${dnGet(cur.issuer.attributes, 'CN') || '?'}» y no está en sus certificados de confianza.` };
    path.push(next); cur = next;
  }
  if (!anchor) return { status: 'untrusted', path, top: cur, reason: 'Cadena de certificados demasiado larga.' };
  for (let i = 0; i < path.length; i++) {
    const c = path[i];
    if (when < c.validity.notBefore || when > c.validity.notAfter) return { status: 'untrusted', path, top: path[path.length - 1], reason: `El certificado «${certCn(c)}» no estaba vigente en la fecha de la firma.` };
    if (i > 0) { const bc = c.getExtension('basicConstraints'); if (bc && !bc.cA) return { status: 'untrusted', path, top: path[path.length - 1], reason: `«${certCn(c)}» no es una autoridad de certificación.` }; }
  }
  return { status: 'trusted', path, anchor: certCn(anchor.cert), source: anchor.source === 'importada' ? 'sus certificados de confianza' : 'raíces incluidas en Rúbrica' };
}

/**
 * Evalúa la confianza de una firma. cert: certificado del firmante (forge o null si no se pudo leer, p. ej. EC);
 * certs: certificados (forge) incluidos en la firma; raw: todos los certificados incluidos en DER (cadenas binarias);
 * serial: número de serie del firmante (hex); when: fecha de la firma (marca de tiempo si la hay).
 */
async function evaluateTrust(cert, certs, raw, serial, when) {
  let res = cert ? buildTrustPath(cert, certs, await trustAnchors(), when) : { status: 'untrusted', path: [], reason: 'El certificado del firmante no se pudo leer aquí (p. ej. clave EC).' };
  if (res.status === 'trusted') return res;
  const b64 = raw.map(d => btoa(d)), time = when.toISOString();
  try {
    if (NATIVE) {
      const n = await natPost('verify-chain', { certs: b64, leafSerial: serial || '', time });
      if (n && n.trusted) return { status: 'trusted', path: res.path, chainNames: n.chain, anchor: n.root, source: 'el almacén de certificados de Windows' };
      if (n && n.status && n.status.length && !cert) res.reason = n.status.join(' ');
    } else if (PSN && PSN.verifyChain) {
      const n = await PSN.verifyChain({ certs: b64, leafSerial: serial || '', time: +when });
      if (n && n.trusted) return { status: 'trusted', path: res.path, chainNames: n.chain, anchor: n.root, source: 'los certificados instalados en Android' };
    }
  } catch (e) { console.warn('verificación del sistema', e); }
  return res;
}

/** Diálogo «Confiar en este emisor»: muestra la huella para compararla con la publicada por la autoridad. */
async function trustIssuerDialog(top) {
  const fp = fpPretty(certFp(top)), self = isSelfSigned(top);
  const ok = await confirmDialog('Confiar en este emisor',
    `<p>Rúbrica tratará como <b>de confianza</b> las firmas cuyos certificados emita:</p>
     <table class="kv"><tr><th>Certificado</th><td>${escapeHtml(certCn(top))}</td></tr>
     <tr><th>Tipo</th><td>${self ? 'Raíz (autofirmado)' : 'Autoridad intermedia'}</td></tr>
     <tr><th>Emisor</th><td>${escapeHtml(dnGet(top.issuer.attributes, 'CN') || '—')}</td></tr>
     <tr><th>Vigencia</th><td>${top.validity.notBefore.toLocaleDateString(LOC())} – ${top.validity.notAfter.toLocaleDateString(LOC())}</td></tr>
     <tr><th>Huella SHA-256</th><td style="font-family:monospace;font-size:11.5px">${fp}</td></tr></table>
     <p class="hint" style="margin-top:10px"><b>Compare la huella</b> con la que publica la autoridad (por ejemplo, el SAR en sar.gob.hn/firmaelectronica). Cualquiera puede crear un certificado con el nombre de una institución: confíe solo en raíces de autoridades reconocidas.</p>`, 'Confiar');
  if (!ok) return false;
  await addTrusted([top]); toast('Certificado agregado a sus certificados de confianza.', 'ok'); return true;
}

/** Pestaña de Preferencias de firma: certificados de confianza. */
async function trustPane(refresh) {
  const wrap = el('div'), list = await trustList();
  let sel = (list[0] || {}).fp;
  const render = () => {
    const cur = list.find(x => x.fp === sel);
    wrap.innerHTML = '';
    const box = el('div', { class: 'recent-list sp-list' });
    for (const t of list) box.append(el('div', { class: 'recent-row' + (t.fp === sel ? ' on' : ''), onclick: () => { sel = t.fp; render(); } }, icEl('shield-check'), el('span', { class: 'nm', text: t.cn }), el('span', { class: 'src', text: 'vence ' + new Date(t.notAfter).toLocaleDateString(LOC()) })));
    if (!list.length) box.append(el('div', { class: 'cb-empty', text: 'Aún no hay certificados. Importe la raíz y la subordinada del SAR, o use «Confiar en este emisor» en el panel Firmas.' }));
    wrap.append(el('div', { class: 'sp-bar' },
      el('button', { class: 'btn sm', html: ic('plus') + 'Importar certificado (.cer / .crt / .pem)', onclick: async () => {
        const f = await pickLocal(CAP ? '' : '.cer,.crt,.pem,.der', true); if (!f.length) return;
        let certs = [];
        for (const x of f) { try { certs.push(...parseCertFile(await readFileBytes(x))); } catch (e) { toast(`«${x.name}» no es un certificado válido.`, 'err'); } }
        if (!certs.length) return;
        const fps = certs.map(c => `<li><b>${escapeHtml(certCn(c))}</b><br><span style="font-family:monospace;font-size:11px">${fpPretty(certFp(c))}</span></li>`).join('');
        if (!(await confirmDialog('Importar certificados de confianza', `<ul style="padding-left:18px">${fps}</ul><p class="hint">Compare las huellas SHA-256 con las publicadas por la autoridad antes de confiar.</p>`, 'Confiar'))) return;
        const n = await addTrusted(certs); toast(n ? `${n} certificado(s) de confianza agregado(s).` : 'Ya estaban en la lista.', 'ok'); refresh();
      } }),
      el('button', { class: 'btn sm', html: ic('trash-2') + 'Quitar', disabled: !cur, onclick: async () => {
        if (!(await confirmDialog('Quitar certificado de confianza', `Las firmas emitidas por «${escapeHtml(cur.cn)}» dejarán de mostrarse como de confianza.`, 'Quitar', true))) return;
        await idb.set('trust', list.filter(x => x.fp !== sel)); refresh();
      } })), box);
    if (cur) wrap.append(el('div', { class: 'sp-info' }, el('h5', { text: 'Información sobre el certificado' }), el('table', { class: 'kv' },
      ...[['Nombre', cur.cn], ['Emisor', cur.issuer || '—'], ['Válido desde', new Date(cur.notBefore).toLocaleString(LOC())], ['Válido hasta', new Date(cur.notAfter).toLocaleString(LOC())], ['Huella SHA-256', fpPretty(cur.fp)]].map(([k, v]) => el('tr', {}, el('th', { text: k }), el('td', { text: v, style: k.startsWith('Huella') ? { fontFamily: 'monospace', fontSize: '11.5px' } : {} }))))));
    wrap.append(el('div', { class: 'hint', html: `Una firma es <b>de confianza</b> cuando el certificado del firmante encadena hasta uno de estos certificados${NATIVE ? ' o hasta una raíz del almacén de Windows' : PSN ? ' o hasta un certificado de CA instalado en Android' : ''}. Descargue los del SAR en <b>sar.gob.hn/firmaelectronica</b> (Autoridad de Certificación Raíz y Subordinada).` }));
  };
  render(); return wrap;
}
