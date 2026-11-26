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
  let usage = [];
  try { const ku = cert.getExtension('keyUsage'); if (ku) usage = ['digitalSignature', 'nonRepudiation', 'keyEncipherment', 'dataEncipherment', 'keyAgreement', 'keyCertSign', 'cRLSign'].filter(k => ku[k]); } catch { }
  return {
    cn: dnGet(cert.subject.attributes, 'CN') || dnGet(cert.subject.attributes, 'O'), org: dnGet(cert.subject.attributes, 'O'), serialNumber: dnGet(cert.subject.attributes, 'serialNumber'),
    email: dnGet(cert.subject.attributes, 'E'), issuer: dnGet(cert.issuer.attributes, 'CN') || dnGet(cert.issuer.attributes, 'O'),
    dn: (cert.subject.attributes || []).map(a => (a.shortName || OID_NAMES[a.type] || a.type) + '=' + a.value).reverse().join(', '),
    notBefore: cert.validity.notBefore, notAfter: cert.validity.notAfter, usage
  };
}
const KEY_USAGE_ES = { digitalsignature: 'Firma digital', nonrepudiation: 'No repudio', contentcommitment: 'No repudio', keyencipherment: 'Cifrado de clave', dataencipherment: 'Cifrado de datos', keyagreement: 'Acuerdo de claves', keycertsign: 'Firma de certificados', crlsign: 'Firma de CRL', encipheronly: 'Solo cifrado', decipheronly: 'Solo descifrado' };
const usageText = u => (u || []).length ? [...new Set(u.map(x => KEY_USAGE_ES[String(x).toLowerCase()] || x))].join(', ') : 'No especificado';

/* ---------- Firmantes ---------- */
function p12Signer(bytes, password) {
  let p12;
  // se guarda el DER original de cada certificado: volver a codificarlo con forge podría alterar bytes y romper la firma del emisor
  const ders = new Map(), orig = forge.pki.certificateFromAsn1;
  forge.pki.certificateFromAsn1 = function (obj, hash) { const c = orig.call(this, obj, hash); try { ders.set(c, binToU8(forge.asn1.toDer(obj).getBytes())); } catch { } return c; };
  try { p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(u8ToBin(bytes), { parseAllBytes: false }), false, password); }
  catch (e) { throw new Error(/mac|password|Invalid/i.test(e.message) ? 'Contraseña incorrecta o archivo no válido.' : 'No se pudo leer el certificado: ' + e.message); }
  finally { forge.pki.certificateFromAsn1 = orig; }
  const oids = forge.pki.oids;
  const keys = [...(p12.getBags({ bagType: oids.pkcs8ShroudedKeyBag })[oids.pkcs8ShroudedKeyBag] || []), ...(p12.getBags({ bagType: oids.keyBag })[oids.keyBag] || [])].map(b => b.key).filter(Boolean);
  const certs = (p12.getBags({ bagType: oids.certBag })[oids.certBag] || []).map(b => b.cert).filter(Boolean);
  if (!keys.length) throw new Error('El archivo no contiene una clave privada compatible (se requiere RSA). Si su certificado es de otro tipo, use el almacén de Windows en la app de escritorio.');
  if (!certs.length) throw new Error('El archivo no contiene certificados.');
  const key = keys[0];
  const cert = certs.find(c => c.publicKey && c.publicKey.n && c.publicKey.n.equals(key.n)) || certs[0];
  const chain = certs.filter(c => c !== cert);
  const der = c => ders.get(c) || binToU8(forge.asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes());
  const certDers = [cert, ...chain].map(der);
  return {
    kind: 'p12', info: certInfo(cert), chain: certDers,
    sign(data, opt = {}) {
      return buildDetachedCms(data, certDers, 'RSA', async tbs => { const md = forge.md.sha256.create(); md.update(u8ToBin(tbs)); return binToU8(key.sign(md)); }, opt);
    }
  };
}
function nativeStoreSigner(c) {
  const info = { cn: c.name, issuer: c.issuer, dn: c.subject || '', usage: c.keyUsage || [], notAfter: new Date(c.notAfter), notBefore: new Date(c.notBefore), serialNumber: c.serialNumber || '' };
  return {
    kind: 'store', info,
    async sign(data, opt = {}) {
      // la clave no sale del almacén de Windows: solo firma los atributos (como en Android) y el CMS PAdES se arma aquí
      if (c.der) return buildDetachedCms(data, [b64ToU8(c.der)], null, async tbs => {
        const r = await natJson('sign-raw?thumbprint=' + encodeURIComponent(c.thumbprint), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: tbs });
        return { signature: b64ToU8(r.signature), chain: (r.chain || []).map(b64ToU8), keyType: r.keyType };
      }, opt);
      return natBytes('sign?thumbprint=' + encodeURIComponent(c.thumbprint), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: data });
    }
  };
}

/* ---------- Certificado instalado en Android (KeyChain) ----------
   La clave privada nunca sale del almacén de Android: la app nativa solo firma
   los atributos firmados (SHA-256) y aquí se arma el CMS desacoplado. */
const cat8 = parts => { const n = parts.reduce((a, p) => a + p.length, 0), o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
const derLen = n => { if (n < 128) return [n]; const b = []; while (n) { b.unshift(n & 255); n = Math.floor(n / 256); } return [0x80 | b.length, ...b]; };
const tlv = (tag, ...parts) => { const body = cat8(parts); return cat8([new Uint8Array([tag, ...derLen(body.length)]), body]); };
const derOid = oid => tlv(0x06, binToU8(forge.asn1.oidToDer(oid).getBytes()));
const DER_NULL = new Uint8Array([5, 0]);
/** Hijos directos de un elemento DER: [{tag, start, end, body}] (start/end incluyen la cabecera) */
function derChildren(u8, start = 0, end = u8.length) {
  const out = [];
  for (let k = start; k < end;) {
    const tag = u8[k]; let len = u8[k + 1], h = 2;
    if (len & 0x80) { const nb = len & 0x7f; len = 0; for (let j = 0; j < nb; j++) len = len * 256 + u8[k + 2 + j]; h += nb; }
    out.push({ tag, start: k, end: k + h + len, body: k + h }); k += h + len;
  }
  return out;
}
function certIssuerSerial(der) {
  const [cert] = derChildren(der); const [tbs] = derChildren(der, cert.body, cert.end);
  const f = derChildren(der, tbs.body, tbs.end); const o = f[0].tag === 0xa0 ? 1 : 0; // versión opcional
  return { serial: der.slice(f[o].start, f[o].end), issuer: der.slice(f[o + 2].start, f[o + 2].end) };
}
const cmpU8 = (a, b) => { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; };
/**
 * CMS desacoplado con SHA-256 a partir de una firma externa (la clave nunca pasa por aquí).
 * chain: certificados DER (el del firmante primero). keyType: 'RSA' | 'EC' (o null si lo informa signRaw).
 * signRaw(bytes) firma los atributos firmados y devuelve la firma (PKCS#1 v1.5 o ECDSA DER),
 * o { signature, chain, keyType } si el almacén conoce la cadena completa.
 * opt.pades: perfil PAdES (ETSI.CAdES.detached): atributo signing-certificate-v2 y sin signing-time
 * (la hora de la firma va en /M o en la marca de tiempo).
 */
async function buildDetachedCms(data, chain, keyType, signRaw, opt = {}) {
  const O = forge.pki.oids, when = opt.when || new Date();
  const sha = tlv(0x30, derOid(O.sha256), DER_NULL);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  const attr = (oid, val) => tlv(0x30, derOid(oid), tlv(0x31, val));
  const attrs = [attr(O.contentType, derOid(O.data)), attr(O.messageDigest, tlv(0x04, digest))];
  if (opt.pades) attrs.push(attr('1.2.840.113549.1.9.16.2.47', await signingCertificateV2(chain[0])));
  else attrs.push(attr(O.signingTime, tlv(0x17, binToU8(forge.asn1.dateToUtcTime(when)))));
  attrs.sort(cmpU8); // SET OF en DER: ordenado
  let sig = await signRaw(tlv(0x31, ...attrs));
  if (sig && !(sig instanceof Uint8Array)) { if (sig.chain && sig.chain.length) chain = sig.chain; keyType = sig.keyType || keyType; sig = sig.signature; }
  if (!sig || !sig.length) throw new Error('El almacén de certificados no devolvió la firma.');
  const ec = keyType === 'EC';
  const sigAlg = ec ? tlv(0x30, derOid('1.2.840.10045.4.3.2')) : tlv(0x30, derOid(O.rsaEncryption), DER_NULL);
  const { issuer, serial } = certIssuerSerial(chain[0]);
  const signerInfo = tlv(0x30, tlv(0x02, new Uint8Array([1])), tlv(0x30, issuer, serial), sha, tlv(0xa0, ...attrs), sigAlg, tlv(0x04, sig));
  const signedData = tlv(0x30, tlv(0x02, new Uint8Array([1])), tlv(0x31, sha), tlv(0x30, derOid(O.data)), tlv(0xa0, ...chain), tlv(0x31, signerInfo));
  return tlv(0x30, derOid(O.signedData), tlv(0xa0, signedData));
}
/** SigningCertificateV2 (RFC 5035) con SHA-256 del certificado del firmante y su emisor/número de serie. */
async function signingCertificateV2(certDer) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', certDer));
  const { issuer, serial } = certIssuerSerial(certDer);
  const essCertIdV2 = tlv(0x30, tlv(0x04, hash), tlv(0x30, tlv(0x30, tlv(0xa4, issuer)), serial));
  return tlv(0x30, tlv(0x30, essCertIdV2));
}
function androidCertInfo(c, chain) {
  try { return certInfo(forge.pki.certificateFromAsn1(forge.asn1.fromDer(u8ToBin(chain[0])))); }
  catch { // p. ej. claves EC, que node-forge no lee: se usan los datos del sistema
    const cn = dn => ((dn || '').match(/(?:^|,)\s*CN=((?:\\.|[^,])*)/) || [, dn || ''])[1].replace(/\\(.)/g, '$1');
    return { cn: cn(c.subject), issuer: cn(c.issuer), dn: c.subject || '', usage: [], serialNumber: '', notBefore: new Date(c.notBefore), notAfter: new Date(c.notAfter) };
  }
}
function androidStoreSigner(c) {
  const chain = (c.chain || []).map(b64ToU8);
  if (!chain.length) throw new Error('El certificado elegido no trae su cadena.');
  return {
    kind: 'android', alias: c.alias, info: androidCertInfo(c, chain),
    sign: (data, opt = {}) => buildDetachedCms(data, chain, c.keyType, async tbs => b64ToU8((await PSN.signWithCertificate({ alias: c.alias, data: u8ToB64(tbs) })).signature || ''), opt)
  };
}

/* ---------- Construcción de la firma ---------- */
function pdfDateStr(d) {
  const p = n => String(n).padStart(2, '0'), off = -d.getTimezoneOffset();
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${off >= 0 ? '+' : '-'}${p(Math.floor(Math.abs(off) / 60))}'${p(Math.abs(off) % 60)}'`;
}
/** Apariencia del recuadro de firma a partir de un estilo (ver 11b_sigprefs.js). */
async function buildSigAppearance(pdf, w, h, st, data, imgBytes, rot, { textAsImage = false } = {}) {
  const ctx = pdf.context;
  const fdoc = textAsImage ? await PL.PDFDocument.create() : pdf; // con texto como imagen, las fuentes solo miden
  const f1 = await fdoc.embedFont(PL.StandardFonts.Helvetica), f2 = await fdoc.embedFont(PL.StandardFonts.HelveticaBold);
  const res = { Font: { F1: f1.ref, F2: f2.ref } }, xo = {}, ops = [];
  const font = b => b ? f2 : f1;
  const clean = v => v ? safeText(f1, String(v)) : '';
  const dat = { ...data, cn: clean(data.cn), dn: clean(data.dn), reason: clean(data.reason), location: clean(data.location) };
  const measure = (t, b, size) => font(b).widthOfTextAtSize(t, size);
  let img = null;
  if (st.graphic === 'image' && imgBytes) img = (imgBytes[0] === 0xff && imgBytes[1] === 0xd8) ? await pdf.embedJpg(imgBytes) : await pdf.embedPng(imgBytes);
  const L = sigLayout(st, dat, w, h, measure, img ? img.width / img.height : null);
  if (L.logo) {
    const lg = await pdf.embedPng(await brandPng()); xo.Lg = lg.ref;
    res.ExtGState = { GSL: ctx.obj({ Type: 'ExtGState', ca: 0.13, CA: 0.13 }) };
    ops.push(PL.pushGraphicsState(), PL.setGraphicsState('GSL'), PL.concatTransformationMatrix(L.logo.w, 0, 0, L.logo.h, L.logo.x, L.logo.y), PL.drawObject('Lg'), PL.popGraphicsState());
  }
  // PDF/A: las fuentes estándar no van incrustadas, así que el texto de la apariencia se dibuja como imagen
  let txtCanvas = null; const K = 4;
  if (textAsImage && L.items.some(it => it.kind !== 'img')) { txtCanvas = el('canvas'); txtCanvas.width = Math.max(1, Math.ceil(w * K)); txtCanvas.height = Math.max(1, Math.ceil(h * K)); }
  for (const it of L.items) {
    if (it.kind === 'img') { xo.Im1 = img.ref; ops.push(PL.pushGraphicsState(), PL.concatTransformationMatrix(it.w, 0, 0, it.h, it.x, it.y), PL.drawObject('Im1'), PL.popGraphicsState()); }
    else if (txtCanvas) {
      const g = txtCanvas.getContext('2d'); g.fillStyle = '#000'; g.textBaseline = 'alphabetic';
      g.font = `${it.bold ? 'bold ' : ''}${it.size * K}px Helvetica, Arial, sans-serif`;
      // mismo ancho que el diseño calculado con Helvetica
      const want = measure(it.t, it.bold, it.size) * K, got = g.measureText(it.t).width || want;
      g.save(); g.translate(it.x * K, (h - it.y) * K); g.scale(want / got, 1); g.fillText(it.t, 0, 0); g.restore();
    }
    else ops.push(PL.setFillingRgbColor(0, 0, 0), PL.beginText(), PL.setFontAndSize(it.bold ? 'F2' : 'F1', it.size), PL.moveText(it.x, it.y), PL.showText(font(it.bold).encodeText(it.t)), PL.endText());
  }
  if (txtCanvas) {
    const tim = await pdf.embedPng(await canvasToBytes(txtCanvas, 'image/png')); xo.Tx = tim.ref;
    ops.push(PL.pushGraphicsState(), PL.concatTransformationMatrix(w, 0, 0, h, 0, 0), PL.drawObject('Tx'), PL.popGraphicsState());
    delete res.Font;
  }
  if (Object.keys(xo).length) res.XObject = xo;
  const th = (rot || 0) * Math.PI / 180;
  const dict = { BBox: [0, 0, w, h], Resources: res };
  if (rot) dict.Matrix = [Math.round(Math.cos(th)), Math.round(Math.sin(th)), -Math.round(Math.sin(th)), Math.round(Math.cos(th)), 0, 0];
  return ctx.register(ctx.formXObject(ops, dict));
}
/**
 * Firma bytes PDF. o = { signer, reason, location, contact, tsa?: servidor de marca de tiempo,
 *   visible:{pageIndex, rect:[x1,y1,x2,y2], w, h, rot, style?: estilo de apariencia, image?: bytes del gráfico} }
 */
async function signPdfBytes(bytes, o) {
  const pdf = await PL.PDFDocument.load(bytes, { forIncrementalUpdate: true, updateMetadata: false });
  const ctx = pdf.context, now = new Date(), sigHex = o.tsa ? SIG_HEX * 2 : SIG_HEX;
  const page = pdf.getPages()[o.visible ? o.visible.pageIndex : 0];
  const byteRange = PL.PDFArray.withContext(ctx);
  byteRange.push(PL.PDFNumber.of(0)); for (let k = 0; k < 3; k++) byteRange.push(PL.PDFName.of('**********'));
  const sigDict = ctx.obj({
    Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: o.pades === false ? 'adbe.pkcs7.detached' : 'ETSI.CAdES.detached', ByteRange: byteRange,
    Contents: PL.PDFHexString.of('0'.repeat(sigHex)), M: PL.PDFString.fromDate(now),
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
    const st = o.visible.style || sigStyleById(S.settings.sigStyleDefault);
    const data = { cn: o.signer.info.cn || '', dn: o.signer.info.dn || '', reason: o.reason, location: o.location, date: now };
    const pdfa = /pdfaid:part/.test(u8ToBin(bytes));
    ap = await buildSigAppearance(pdf, o.visible.w, o.visible.h, st, data, o.visible.image || (st.image ? dataUrlToBytes(st.image) : null), o.visible.rot, { textAsImage: pdfa });
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
  const ph = '<' + '0'.repeat(sigHex) + '>';
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
  let cms = await o.signer.sign(data, { pades: o.pades !== false, when: now });
  if (o.tsa) cms = await addTimestampToCms(cms, o.tsa);
  let hex = ''; for (const b of cms) hex += b.toString(16).padStart(2, '0');
  if (hex.length > sigHex) throw new Error('La firma no cabe en el espacio reservado.');
  res.set(binToU8(hex.padEnd(sigHex, '0')), cStart + 1);
  if (!o.ltv) return res;
  // validación a largo plazo: OCSP/CRL de toda la cadena (firmante y marca de tiempo) en el DSS
  try { return await addLtvToPdf(res, { progress: o.progress }); }
  catch (e) { if (e.revoked) throw e; console.warn('LTV:', e); res.ltvError = e.message || String(e); return res; }
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
    const sf = (near.match(/\/SubFilter\s*\/([A-Za-z0-9.]+)/) || [])[1] || '';
    out.push({ br, hex: s.slice(br[1] + 1, br[2] - 1).replace(/\s/g, ''), reason: str('Reason'), location: str('Location'), name: str('Name'), m: str('M'), subFilter: sf });
  }
  return out;
}
/** ¿Lo agregado después de esta firma es solo información de validación (DSS)? */
function dssOnlyAfter(bytes, sig) {
  const tail = u8ToBin(bytes.subarray(sig.br[2] + sig.br[3]));
  return /\/DSS\b/.test(tail) && !/\/Type\s*\/Page\b|\/Type\s*\/Annot\b|\/Subtype\s*\/Widget\b|\/Type\s*\/XObject\b/.test(tail);
}
function parsePdfDate(s) {
  const m = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(s || ''); if (!m) return null;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00', z, oh = '00', om = '00'] = m;
  const t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se), off = (z === '+' ? 1 : z === '-' ? -1 : 0) * (+oh * 60 + +om);
  return new Date(t - off * 60000);
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
    const unsigned = si.value.find(n => n.tagClass === A.Class.CONTEXT_SPECIFIC && n.type === 1);
    for (const at of (unsigned ? unsigned.value : [])) {
      try { if (A.derToOid(at.value[0].value) === OID_TST && sigVal) r.timestamp = readTimestampToken(at.value[1].value[0], sigVal.value); } catch (e) { r.timestamp = { error: e.message }; }
    }
    const data = new Uint8Array(sig.br[1] + sig.br[3]); data.set(bytes.subarray(sig.br[0], sig.br[0] + sig.br[1]), 0); data.set(bytes.subarray(sig.br[2], sig.br[2] + sig.br[3]), sig.br[1]);
    const digest = u8ToBin(new Uint8Array(await crypto.subtle.digest(dg[0], data)));
    let md = null;
    for (const at of (attrs ? attrs.value : [])) {
      const oid = A.derToOid(at.value[0].value);
      if (oid === '1.2.840.113549.1.9.4') md = at.value[1].value[0].value;
      if (oid === '1.2.840.113549.1.9.5') { try { const t = at.value[1].value[0]; r.signingTime = t.type === A.Type.UTCTIME ? A.utcTimeToDate(t.value) : A.generalizedTimeToDate(t.value); } catch { } }
    }
    r.integrity = attrs ? md === digest : null;
    if (!r.signingTime && sig.m) r.signingTime = parsePdfDate(sig.m);
    // certificado del firmante
    let cert = null; const certs = [];
    for (const c of (certsNode ? certsNode.value : [])) { try { certs.push(forge.pki.certificateFromAsn1(c)); } catch { } }
    const sid = si.value[1];
    if (sid.value && sid.value[1]) { const serial = forge.util.bytesToHex(sid.value[1].value); cert = certs.find(c => c.serialNumber.replace(/^0+/, '') === serial.replace(/^0+/, '')); }
    cert = cert || certs[0];
    // confianza: cadena hasta una raíz de confianza (en la fecha de la marca de tiempo, si la hay)
    try {
      const when = (r.timestamp && r.timestamp.time) || r.signingTime || new Date();
      const raw = (certsNode ? certsNode.value : []).map(c => A.toDer(c).getBytes());
      const serial = sid.value && sid.value[1] ? forge.util.bytesToHex(sid.value[1].value) : '';
      r.trust = await evaluateTrust(cert, certs, raw, serial, when);
    } catch (e) { r.trust = { status: 'untrusted', path: [], reason: e.message }; }
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
  let signer = null, ids = await loadIds(), winCerts = [], androidCert = null;
  const info = el('div', { class: 'sp-info', style: { margin: '6px 0 10px' } });
  const who = el('select', { 'aria-label': 'Firmar como' });
  const pw = el('input', { type: 'password', placeholder: 'Contraseña del certificado', autocomplete: 'off' });
  const verifyBtn = el('button', { class: 'btn sm', text: 'Verificar certificado' });
  const pwRow = el('div', { class: 'row' }, el('label', { text: 'Contraseña' }), el('div', { style: { display: 'flex', gap: '8px' } }, pw, verifyBtn), el('div', { class: 'hint', text: 'La contraseña no se guarda: se pide en cada firma.' }));
  const cur = () => who.value;
  const fileEntry = () => ids.find(x => 'f:' + x.id === cur());
  const showInfo = () => {
    info.innerHTML = '';
    const i = signer ? signer.info : fileEntry() ? infoFromJson(fileEntry().info) : null;
    info.append(i ? certInfoTable(i) : el('div', { class: 'hint', text: cur() === '' ? 'Añada su certificado .p12/.pfx o elija uno de la lista.' : 'Escriba la contraseña y pulse «Verificar certificado» para ver los datos.' }));
    styleChanged();
  };
  const fillWho = (selKey) => {
    const prev = selKey ?? cur(); who.innerHTML = '';
    const og = (label, opts) => { if (!opts.length) return; const g = el('optgroup', { label }); opts.forEach(o => g.append(el('option', { value: o[0], text: o[1] }))); who.append(g); };
    const exp = t => t && new Date(t) < new Date() ? ' (VENCIDO)' : '';
    og('Archivos .p12 / .pfx', ids.map(x => ['f:' + x.id, (x.info?.cn ? `${x.info.cn} · ${x.name}` : x.name) + exp(x.info?.notAfter)]));
    og('Almacén de Windows / token', winCerts.map(c => ['s:' + c.thumbprint, `${c.name} · vence ${new Date(c.notAfter).toLocaleDateString(LOC())}` + exp(c.notAfter)]));
    if (PSN) og('Certificado de Android', [...(androidCert ? [['a:' + androidCert.alias, (androidCertInfo(androidCert, (androidCert.chain || []).map(b64ToU8)).cn || androidCert.alias) + ' (Android)']] : []), ['a:?', 'Elegir certificado de Android…']]);
    og('Otro', [['+file', 'Añadir archivo .p12 / .pfx…']]);
    const keys = [...who.options].map(o => o.value);
    who.value = keys.includes(prev) ? prev : keys.includes(S.settings.sigIdDefault) ? S.settings.sigIdDefault : (keys.find(k => !/^\+|^a:\?$/.test(k)) || '');
    onWho(false);
  };
  const onWho = async (user = true) => {
    signer = null; pw.value = '';
    const k = cur();
    if (k === '+file') {
      const f = await pickLocal(CAP ? '' : '.p12,.pfx', false);
      if (!f.length) { fillWho(''); return; }
      const r = await addIdFile(f[0]); if (!r) { fillWho(''); return; }
      ids = await loadIds(); fillWho('f:' + r.entry.id); signer = r.signer; pwRow.style.display = 'none'; showInfo(); return;
    }
    if (k === 'a:?') {
      try { const c = await PSN.chooseCertificate({ alias: S.settings.androidCertAlias || '' }); if (c && c.alias) { androidCert = c; S.settings.androidCertAlias = c.alias; saveSettings(); fillWho('a:' + c.alias); return; } }
      catch (e) { toast(e.message || String(e), 'err', 7000); }
      fillWho(androidCert ? 'a:' + androidCert.alias : ''); return;
    }
    if (k.startsWith('s:')) signer = nativeStoreSigner(winCerts.find(c => 's:' + c.thumbprint === k));
    if (k.startsWith('a:') && androidCert) signer = androidStoreSigner(androidCert);
    pwRow.style.display = k.startsWith('f:') ? '' : 'none';
    showInfo(); if (user && k.startsWith('f:')) pw.focus();
  };
  who.onchange = () => onWho(true);
  const loadP12 = () => {
    const f = fileEntry(); if (!f) return false;
    try {
      signer = p12Signer(f.bytes, pw.value); showInfo();
      if (!f.info) { f.info = infoToJson(signer.info); saveIds(ids); }
      return true;
    } catch (e) { signer = null; showInfo(); toast(e.message, 'err', 6000); return false; }
  };
  verifyBtn.onclick = loadP12;
  // apariencia
  const styleSel = el('select', { 'aria-label': 'Aspecto' });
  const fillStyles = () => { const v = styleSel.value || S.settings.sigStyleDefault || 'std'; styleSel.innerHTML = ''; sigStyles().forEach(s => styleSel.append(el('option', { value: s.id, text: s.title }))); styleSel.append(el('option', { value: 'invisible', text: 'Invisible (solo en el panel de firmas)' })); styleSel.value = [...styleSel.options].some(o => o.value === v) ? v : 'std'; };
  fillStyles();
  const cv = el('canvas', { width: 720, height: 240, style: { width: '100%', maxWidth: '360px', border: '1px solid var(--line)', borderRadius: '6px', background: '#fff', display: 'block' } });
  const reason = el('select'); for (const r of ['Soy el autor de este documento', 'Apruebo este documento', 'He revisado este documento', 'Certifico la exactitud e integridad de este documento', 'Acepto los términos definidos']) reason.append(el('option', { value: tr(r), text: tr(r) })); // el motivo queda en el PDF en el idioma de la interfaz
  const location = el('input', { type: 'text', value: S.settings.sigLocation || 'San Pedro Sula, Honduras' });
  const contact = el('input', { type: 'text', value: S.settings.sigContact || '', placeholder: 'correo o teléfono (opcional)' });
  function styleChanged() {
    const inv = styleSel.value === 'invisible'; cv.style.display = inv ? 'none' : 'block'; if (inv) return;
    drawSigPreview(cv, sigStyleById(styleSel.value), { ...sigSample(signer), reason: reason.value, location: location.value });
  }
  styleSel.onchange = reason.onchange = styleChanged; location.oninput = styleChanged;
  // marca de tiempo
  const tsaSel = el('select', { 'aria-label': 'Marca de tiempo' }); tsaSel.append(el('option', { value: '', text: 'Sin marca de tiempo (hora de este equipo)' }));
  tsaServers().forEach(t => tsaSel.append(el('option', { value: t.id, text: t.name + ' · ' + t.url })));
  tsaSel.value = TSA_BRIDGE() && tsaById(S.settings.tsaDefault) ? S.settings.tsaDefault : '';
  // validación a largo plazo: necesita la marca de tiempo (fija la fecha) y descargar OCSP/CRL de las autoridades
  const ltv = el('input', { type: 'checkbox' }); ltv.checked = S.settings.sigLtv ?? true;
  const ltvRow = el('label', { class: 'chk', title: 'Agrega al PDF la información de revocación (OCSP/CRL) de los certificados, para que la firma se pueda validar dentro de muchos años aunque los certificados hayan vencido.' }, ltv, el('span', { text: 'Validación a largo plazo (LTV): incluir el estado de los certificados' }));
  const syncLtv = () => { ltvRow.style.display = tsaSel.value ? '' : 'none'; };
  tsaSel.addEventListener('change', syncLtv);
  const prefsBtn = el('button', { class: 'btn sm', html: ic('sliders-horizontal') + 'Preferencias de firma…', onclick: async () => {
    await signPrefsDialog(); ids = await loadIds(); fillWho(); fillStyles(); styleChanged();
    const tv = tsaSel.value; tsaSel.length = 1; tsaServers().forEach(t => tsaSel.append(el('option', { value: t.id, text: t.name + ' · ' + t.url }))); tsaSel.value = tsaById(tv) ? tv : '';
  } });
  const body = el('div', { class: 'fm' },
    el('div', { class: 'row' }, el('label', { text: 'Firmar como' }), who), pwRow, info,
    el('div', { class: 'cols' }, el('div', { class: 'row' }, el('label', { text: 'Motivo' }), reason), el('div', { class: 'row' }, el('label', { text: 'Ubicación' }), location)),
    el('div', { class: 'cols' }, el('div', { class: 'row' }, el('label', { text: 'Contacto' }), contact), el('div', { class: 'row' }, el('label', { text: 'Marca de tiempo' }), tsaSel)),
    ltvRow,
    el('div', { class: 'row' }, el('label', { text: 'Aspecto' }), styleSel), cv,
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '8px' } },
      el('div', { class: 'hint', html: 'Al firmar se aplican primero todos los cambios del documento y luego se le pedirá dónde guardar el PDF firmado.' }), prefsBtn));
  fillWho(); syncLtv();
  if (NATIVE) natJson('certs').then(cs => { winCerts = cs || []; fillWho(); }).catch(() => { });
  if (PSN && S.settings.androidCertAlias) PSN.getCertificate({ alias: S.settings.androidCertAlias }).then(c => { if (c && c.alias) { androidCert = c; fillWho(); } }).catch(() => { /* permiso retirado o certificado eliminado: se elige de nuevo */ });
  const ok = await openModal({ title: 'Firma digital', body, wide: true, buttons: [{ label: 'Cancelar', value: null }, { label: 'Continuar', primary: true, onClick: () => {
    if (!signer && fileEntry()) { if (!pw.value) { toast('Escriba la contraseña del certificado.', 'err'); pw.focus(); return false; } if (!loadP12()) return false; }
    if (!signer) { toast('Elija o añada un certificado.', 'err'); return false; }
    if (signer.info.notAfter && signer.info.notAfter < new Date()) { toast('El certificado está vencido.', 'err'); return false; }
    return true;
  } }] }).result;
  if (!ok) return;
  S.settings.sigLocation = location.value; S.settings.sigContact = contact.value;
  if (!S.settings.sigIdDefault) S.settings.sigIdDefault = cur();
  saveSettings();
  const opts = { signer, reason: reason.value, location: location.value, contact: contact.value, tsa: tsaById(tsaSel.value), ltv: !!tsaSel.value && ltv.checked };
  if (tsaSel.value) { S.settings.sigLtv = ltv.checked; saveSettings(); }
  if (styleSel.value === 'invisible') return performSign(d, opts, null, null);
  opts.style = sigStyleById(styleSel.value);
  S.pendingSign = opts; setTool('sigbox');
  toast('Dibuje en la página el recuadro donde aparecerá la firma.', '', 5000);
}
async function performSign(d, opts, p, r) {
  try {
    let visible = null;
    if (p) {
      const pi = d.pages.indexOf(p);
      const style = opts.style || sigStyleById(S.settings.sigStyleDefault);
      const image = opts.imageDataUrl ? dataUrlToBytes(opts.imageDataUrl) : null;
      visible = { pageIndex: pi, rect: dispRectToUser(p, r), w: r.w, h: r.h, rot: rotT(p), style, image };
    }
    const run = o => withBusy('Firmando…', async upd => {
      const base = await buildPdf(d, { progress: upd, noEncrypt: true });
      upd(o.tsa ? 'Firmando y solicitando la marca de tiempo a ' + o.tsa.name + '…' : 'Aplicando firma digital…', 95);
      return signPdfBytes(base, { ...o, visible });
    });
    let bytes;
    try { bytes = await run(opts); }
    catch (e) {
      if (!e.tsa) throw e;
      if (!(await confirmDialog('Marca de tiempo', `No se pudo obtener la marca de tiempo de <b>${escapeHtml(opts.tsa.name)}</b>:<br>${escapeHtml(e.message)}<br><br>¿Firmar sin marca de tiempo (con la hora de este equipo)?`, 'Firmar sin marca de tiempo'))) { toast('Firma cancelada.', 'err'); return; }
      bytes = await run({ ...opts, tsa: null });
    }
    let n = d.name; if (!/firmado/i.test(n)) n = baseName(n) + '_firmado.pdf';
    const saved = await saveAsDialog(d, bytes, n);
    if (!saved) { toast('Firma cancelada: el documento no se guardó.', 'err'); return; }
    await reloadDocFromBytes(d, bytes);
    S.side = 'signatures'; S.sideOpen = true; renderSide();
    if (bytes.ltvError) alertDialog('Firma sin validación a largo plazo', escapeHtml(tr('El documento quedó firmado y guardado, pero no se pudo incluir la información para validarlo a largo plazo:')) + '<br><br><b>' + escapeHtml(bytes.ltvError) + '</b><br><br>' + escapeHtml(tr('La firma es válida; solo podría ser más difícil comprobarla cuando el certificado venza. Revise la conexión a internet y vuelva a firmar si necesita LTV.')));
    else toast(tr(bytes.ltv ? 'Documento firmado (PAdES con marca de tiempo y validación a largo plazo) y guardado.' : opts.tsa ? 'Documento firmado digitalmente con marca de tiempo y guardado.' : 'Documento firmado digitalmente y guardado.'), 'ok', 6000);
  } catch (e) { console.error(e); toast('No se pudo firmar: ' + e.message, 'err', 8000); }
}
async function reloadDocFromBytes(d, bytes) {
  const src = await loadPdfSource(bytes, d.name);
  d.sources = { [src.id]: src }; d.assets = {}; d.fields = {}; d.formValues = {}; d.formOrig = {};
  d.pages = await pagesFromPdfSource(src); await loadFormFields(d, src);
  d.undo = []; d.redo = []; d.cur = 0; d.dirty = false; S.sel = null;
  R.thumbCache.clear(); renderTabs(); afterStructureChange(false);
}
/** Olvida las verificaciones guardadas (p. ej. tras cambiar los certificados de confianza). */
function forgetSigChecks() { for (const d of S.docs) for (const s of Object.values(d.sources || {})) for (const g of (s.sigs || [])) delete g._v; }
async function renderSignatures(body) {
  const d = D(); const srcs = Object.values(d.sources).filter(s => s.kind === 'pdf' && s.sigs && s.sigs.length);
  if (!srcs.length) { body.append(el('div', { class: 'hint', html: 'Este documento no tiene firmas digitales.<br><br>Para firmar: <b>Proteger → Firma digital</b>.' })); return; }
  const box = el('div', { class: 'slist' }); body.append(box);
  for (const s of srcs) {
    const ltvDoc = pdfHasLtv(s.bytes);
    s.sigs.forEach((sig, k) => {
      const row = el('div', { style: { padding: '8px', border: '1px solid var(--line)', borderRadius: '8px', marginBottom: '8px', fontSize: '12px' } }, el('div', { class: 'spinner', style: { width: '16px', height: '16px', borderWidth: '2px' } }));
      box.append(row);
      (sig._v ? Promise.resolve(sig._v) : verifySignature(s.bytes, sig).then(v => (sig._v = v))).then(v => {
        const good = v.integrity && v.sigValid !== false, trusted = good && v.trust && v.trust.status === 'trusted';
        // tras la última firma solo puede venir el DSS (LTV): no es un cambio del contenido
        const later = v.coversAll || (ltvDoc && k === s.sigs.length - 1 && dssOnlyAfter(s.bytes, sig)) ? '' : ' (con cambios posteriores permitidos)';
        const fmt = /ETSI\.CAdES/i.test(v.subFilter) ? 'PAdES' : /pkcs7/i.test(v.subFilter) ? 'PKCS#7' : v.subFilter;
        const ltvLine = `${fmt ? '<br>Formato: ' + escapeHtml(fmt) : ''}${ltvDoc ? ' · <span style="color:var(--ok)">validación a largo plazo (LTV) incluida</span>' : ''}`;
        const st = !good ? ['circle-x', 'var(--danger)', 'Firma NO válida: el contenido firmado fue alterado']
          : trusted ? ['badge-check', 'var(--ok)', 'Firma válida · emisor de confianza' + later]
            : ['shield-alert', 'var(--warn)', 'Firma íntegra · emisor no verificado' + later];
        row.innerHTML = '';
        const chain = v.trust && (v.trust.chainNames || (v.trust.path || []).map(certCn));
        const trustLine = !good ? '' : trusted
          ? `<br><span style="color:var(--ok)">Confianza: ${escapeHtml(v.trust.anchor || '')} (${escapeHtml(v.trust.source || '')})</span>${chain && chain.length > 1 ? '<br><span class="muted">Cadena: ' + chain.map(escapeHtml).join(' → ') + '</span>' : ''}`
          : `<br><span style="color:var(--warn)">${escapeHtml((v.trust && v.trust.reason) || 'No se pudo comprobar el emisor.')}</span><br><span class="muted">El documento no cambió desde que se firmó, pero Rúbrica no puede confirmar quién emitió el certificado.</span>`;
        row.append(el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', fontWeight: 600, color: st[1] } }, icEl(st[0]), st[2]),
          el('div', { style: { marginTop: '6px' }, html: `<b>${escapeHtml(v.cert?.cn || v.name || 'Firmante desconocido')}</b>${v.cert?.serialNumber ? ' · ' + escapeHtml(v.cert.serialNumber) : ''}<br>Emisor: ${escapeHtml(v.cert?.issuer || '—')}<br>Fecha: ${v.signingTime ? v.signingTime.toLocaleString(LOC()) : escapeHtml(v.m || '—')}${v.timestamp ? (v.timestamp.time ? `<br>Marca de tiempo: <b>${v.timestamp.time.toLocaleString(LOC())}</b>${v.timestamp.tsa ? ' · ' + escapeHtml(v.timestamp.tsa) : ''}${v.timestamp.covers === false ? ' <span style="color:var(--danger)">(no corresponde a esta firma)</span>' : ''}` : '<br><span style="color:var(--danger)">Marca de tiempo ilegible</span>') : ''}${v.reason ? '<br>Motivo: ' + escapeHtml(v.reason) : ''}${v.location ? '<br>Ubicación: ' + escapeHtml(v.location) : ''}${v.certValidAtTime === false ? '<br><span style="color:var(--danger)">Certificado fuera de vigencia al firmar</span>' : ''}${trustLine}${ltvLine}<br><span class="muted">Firma ${k + 1} de ${s.sigs.length}.</span>${v.error ? '<br><span class="muted">' + escapeHtml(v.error) + '</span>' : ''}` }));
        if (good && !trusted && v.trust && v.trust.top) row.append(el('div', { style: { display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' } },
          el('button', { class: 'btn sm', html: ic('shield-check') + 'Confiar en este emisor…', onclick: async () => { if (await trustIssuerDialog(v.trust.top)) { forgetSigChecks(); renderSide(); } } }),
          el('button', { class: 'btn sm', html: ic('sliders-horizontal') + 'Certificados de confianza', onclick: async () => { await signPrefsDialog('trust'); forgetSigChecks(); renderSide(); } })));
      });
    });
  }
}
