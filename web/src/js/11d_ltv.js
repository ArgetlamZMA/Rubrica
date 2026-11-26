/* ============================================================
   11d · Validación a largo plazo (PAdES-LTV)
   Tras firmar, se reúne la información de revocación de toda la
   cadena (firmante, autoridades intermedias y el sello de tiempo):
   respuestas OCSP o, si no hay, listas CRL, y los certificados de
   emisores que falten. Todo se guarda en el diccionario DSS del PDF
   (actualización incremental), para que la firma pueda validarse
   años después aunque los certificados ya hayan vencido.
   ============================================================ */
const OID_OCSP = '1.3.6.1.5.5.7.48.1', OID_CA_ISSUERS = '1.3.6.1.5.5.7.48.2', OID_OCSP_NOCHECK = '1.3.6.1.5.5.7.48.1.5';

/** Descarga con el puente nativo (Windows/Android) o, en el navegador, directamente (puede impedirlo CORS). */
async function revFetch(url, { method = 'GET', body = null, type = 'application/octet-stream' } = {}) {
  if (NATIVE) return natBytes('fetch', { method: 'POST', headers: { 'X-Url': encodeURIComponent(url), 'X-Method': method, 'X-Content-Type': type, 'Content-Type': 'application/octet-stream' }, body: body || new Uint8Array() });
  if (PSN) return b64ToU8((await PSN.httpRequest({ url, method, contentType: type, data: body ? u8ToB64(body) : '' })).data || '');
  let r;
  try { r = await fetch(url, { method, headers: body ? { 'Content-Type': type } : {}, body }); }
  catch { throw new Error(tr(`El navegador no puede contactar ${new URL(url).host}. Use la app de Windows o de Android para la validación a largo plazo.`)); }
  if (!r.ok) throw new Error(tr(`${new URL(url).host} respondió ${r.status}.`));
  return new Uint8Array(await r.arrayBuffer());
}

const derOidStr = (u8, el) => forge.asn1.derToOid(u8ToBin(u8.slice(el.body, el.end)));
const derEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const sha1 = async u8 => new Uint8Array(await crypto.subtle.digest('SHA-1', u8));

/** Campos de un certificado leídos del DER (sirve también para claves EC, que node-forge no lee). */
function certFields(der) {
  const [c] = derChildren(der), [tbs] = derChildren(der, c.body, c.end), f = derChildren(der, tbs.body, tbs.end), o = f[0].tag === 0xa0 ? 1 : 0;
  const sl = x => der.slice(x.start, x.end);
  const spki = f[o + 5], bit = derChildren(der, spki.body, spki.end)[1];
  const ext = new Map(), w = f.find(x => x.tag === 0xa3);
  if (w) {
    const [seq] = derChildren(der, w.body, w.end);
    for (const e of derChildren(der, seq.body, seq.end)) { const k = derChildren(der, e.body, e.end); ext.set(derOidStr(der, k[0]), der.slice(k.at(-1).body, k.at(-1).end)); }
  }
  return { der, serial: sl(f[o]), serialBody: der.slice(f[o].body, f[o].end), issuer: sl(f[o + 2]), subject: sl(f[o + 4]), keyBytes: der.slice(bit.body + 1, bit.end), ext };
}
/** Nombre común (CN) de un Name DER; si no hay, la organización. */
function dnCommonName(name) {
  const found = {};
  try {
    const [seq] = derChildren(name);
    for (const set of derChildren(name, seq.body, seq.end)) for (const atv of derChildren(name, set.body, set.end)) {
      const [oid, val] = derChildren(name, atv.body, atv.end), o = derOidStr(name, oid), raw = name.slice(val.body, val.end);
      found[o] = val.tag === 0x1e ? String.fromCharCode(...Array.from({ length: raw.length / 2 }, (_, i) => (raw[2 * i] << 8) | raw[2 * i + 1])) : new TextDecoder().decode(raw);
    }
  } catch { }
  return found['2.5.4.3'] || found['2.5.4.10'] || '';
}
/** URI de una extensión (GeneralName [6]); en AIA se separan por método de acceso. */
function extUris(u8) {
  const out = [];
  const walk = (s, e) => { for (const x of derChildren(u8, s, e)) { if (x.tag === 0x86) out.push(u8ToBin(u8.slice(x.body, x.end))); else if (x.tag & 0x20) walk(x.body, x.end); } };
  try { walk(0, u8.length); } catch { }
  return out.filter(u => /^https?:\/\//i.test(u));
}
function certUrls(f) {
  const r = { ocsp: [], caIssuers: [], crl: [] };
  const aia = f.ext.get('1.3.6.1.5.5.7.1.1');
  if (aia) try {
    const [seq] = derChildren(aia);
    for (const ad of derChildren(aia, seq.body, seq.end)) {
      const k = derChildren(aia, ad.body, ad.end), m = derOidStr(aia, k[0]), uri = extUris(aia.slice(k[1].start, k[1].end));
      if (m === OID_OCSP) r.ocsp.push(...uri); else if (m === OID_CA_ISSUERS) r.caIssuers.push(...uri);
    }
  } catch { }
  const cdp = f.ext.get('2.5.29.31'); if (cdp) r.crl.push(...extUris(cdp));
  return r;
}
/** Certificados de un SignedData (CMS); con timestamps=true, también los de los sellos de tiempo de sus firmantes. */
function cmsCertificates(der, timestamps = true) {
  const out = [];
  try {
    const [ci] = derChildren(der), k = derChildren(der, ci.body, ci.end);
    if (derOidStr(der, k[0]) !== '1.2.840.113549.1.7.2') return out;
    const [sd] = derChildren(der, k[1].body, k[1].end), parts = derChildren(der, sd.body, sd.end);
    const certs = parts.find(x => x.tag === 0xa0);
    if (certs) for (const c of derChildren(der, certs.body, certs.end)) if (c.tag === 0x30) out.push(der.slice(c.start, c.end));
    if (timestamps) {
      const sis = parts.at(-1);
      for (const si of derChildren(der, sis.body, sis.end)) {
        const un = derChildren(der, si.body, si.end).find(x => x.tag === 0xa1); if (!un) continue;
        for (const at of derChildren(der, un.body, un.end)) {
          const ak = derChildren(der, at.body, at.end);
          if (derOidStr(der, ak[0]) !== '1.2.840.113549.1.9.16.2.14') continue;
          for (const tok of derChildren(der, ak[1].body, ak[1].end)) out.push(...cmsCertificates(der.slice(tok.start, tok.end), false));
        }
      }
    }
  } catch (e) { console.warn('cmsCertificates', e); }
  return out;
}

async function ocspRequestFor(f, issuer) {
  const certId = tlv(0x30, tlv(0x30, derOid('1.3.14.3.2.26'), DER_NULL), tlv(0x04, await sha1(f.issuer)), tlv(0x04, await sha1(issuer.keyBytes)), f.serial);
  return tlv(0x30, tlv(0x30, tlv(0x30, tlv(0x30, certId))));
}
/** Estado de un certificado en una respuesta OCSP: { status: 'good'|'revoked'|'unknown', certs } */
function parseOcsp(resp, f) {
  const [r] = derChildren(resp), k = derChildren(resp, r.body, r.end);
  const status = resp[k[0].body];
  if (status !== 0 || k.length < 2) throw new Error(tr(`El servidor OCSP respondió con el estado ${status}.`));
  const [rb] = derChildren(resp, k[1].body, k[1].end), rk = derChildren(resp, rb.body, rb.end);
  const basic = resp.slice(rk[1].body, rk[1].end);
  const [b] = derChildren(basic), bk = derChildren(basic, b.body, b.end);
  const tbs = derChildren(basic, bk[0].body, bk[0].end), responses = tbs.find((x, i) => x.tag === 0x30 && i > 0 && tbs[i - 1].tag === 0x18);
  const certs = [];
  const cw = bk.find(x => x.tag === 0xa0);
  if (cw) { const [seq] = derChildren(basic, cw.body, cw.end); for (const c of derChildren(basic, seq.body, seq.end)) certs.push(basic.slice(c.start, c.end)); }
  for (const sr of derChildren(basic, responses.body, responses.end)) {
    const sk = derChildren(basic, sr.body, sr.end), id = derChildren(basic, sk[0].body, sk[0].end);
    if (!derEq(basic.slice(id[3].body, id[3].end), f.serialBody)) continue;
    const st = sk[1].tag; return { status: st === 0x80 ? 'good' : st === 0xa1 ? 'revoked' : 'unknown', certs };
  }
  throw new Error(tr('La respuesta OCSP no incluye el certificado consultado.'));
}
/** ¿Está el número de serie en la lista de revocación? */
function crlRevokes(crl, f) {
  const [c] = derChildren(crl), [tbs] = derChildren(crl, c.body, c.end), k = derChildren(crl, tbs.body, tbs.end);
  let i = k.findIndex(x => x.tag === 0x17 || x.tag === 0x18); if (i < 0) throw new Error(tr('Lista de revocación no válida.'));
  while (i < k.length && (k[i].tag === 0x17 || k[i].tag === 0x18)) i++;
  if (i >= k.length || k[i].tag !== 0x30) return false;
  for (const rc of derChildren(crl, k[i].body, k[i].end)) { const [sn] = derChildren(crl, rc.body, rc.end); if (derEq(crl.slice(sn.body, sn.end), f.serialBody)) return true; }
  return false;
}
function certsFromDownload(u8) {
  if (!u8 || !u8.length) return [];
  try { const [x] = derChildren(u8), k = derChildren(u8, x.body, x.end); if (k[0].tag === 0x06) return cmsCertificates(u8, false); } catch { }
  if (u8[0] === 0x30) return [u8];
  const pem = u8ToBin(u8).match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
  return pem.map(p => b64ToU8(p.replace(/-----[^-]+-----|\s/g, '')));
}

/**
 * Reúne certificados, respuestas OCSP y listas CRL para validar cada certificado no raíz de la lista.
 * Lanza un error si algún certificado está revocado.
 */
async function collectRevocation(certDers, progress = () => { }) {
  const certs = new Map(); // DER en hex corto → campos
  const key = d => u8ToB64(d);
  const add = d => { const k = key(d); if (!certs.has(k)) { try { certs.set(k, certFields(d)); } catch { } } return certs.get(k); };
  certDers.forEach(add);
  const ocsps = [], crls = [], done = new Set(), notes = [];
  const issuerOf = async f => {
    let i = [...certs.values()].find(c => derEq(c.subject, f.issuer) && c !== f);
    if (i) return i;
    for (const u of certUrls(f).caIssuers) {
      try { for (const d of certsFromDownload(await revFetch(u))) add(d); } catch (e) { notes.push(e.message); }
      i = [...certs.values()].find(c => derEq(c.subject, f.issuer) && c !== f); if (i) return i;
    }
    return null;
  };
  const queue = [...certs.values()];
  let steps = 0;
  while (queue.length && steps++ < 40) {
    const f = queue.shift(), k = key(f.der);
    if (done.has(k)) continue; done.add(k);
    if (derEq(f.issuer, f.subject)) continue; // raíz: no se revoca por OCSP/CRL
    if (f.ext.has(OID_OCSP_NOCHECK)) continue; // respondedor OCSP con id-pkix-ocsp-nocheck
    const issuer = await issuerOf(f);
    if (issuer && !done.has(key(issuer.der))) queue.push(issuer);
    const urls = certUrls(f), who = dnCommonName(f.subject);
    progress(tr(`Comprobando la revocación de ${who}…`));
    let ok = false;
    if (issuer) for (const u of urls.ocsp) {
      try {
        const resp = await revFetch(u, { method: 'POST', body: await ocspRequestFor(f, issuer), type: 'application/ocsp-request' });
        const r = parseOcsp(resp, f);
        if (r.status === 'revoked') throw Object.assign(new Error(tr(`El certificado «${who}» está revocado: la firma no es válida.`)), { revoked: true });
        if (r.status !== 'good') throw new Error(tr('El servidor OCSP no conoce el certificado.'));
        ocsps.push(resp);
        for (const d of r.certs) { const rf = add(d); if (rf && !done.has(key(d))) queue.push(rf); }
        ok = true; break;
      } catch (e) { if (e.revoked) throw e; notes.push(e.message); }
    }
    if (!ok) for (const u of urls.crl) {
      try {
        const crl = await revFetch(u);
        if (crlRevokes(crl, f)) throw Object.assign(new Error(tr(`El certificado «${who}» está revocado: la firma no es válida.`)), { revoked: true });
        crls.push(crl); ok = true; break;
      } catch (e) { if (e.revoked) throw e; notes.push(e.message); }
    }
    if (!ok) throw new Error(tr(`No se pudo obtener la información de revocación de «${who}»`) + (notes.length ? ': ' + notes.at(-1) : '.'));
  }
  return { certs: [...certs.values()].map(c => c.der), ocsps, crls };
}

/** Agrega el DSS (validación a largo plazo) para la última firma del PDF, en una actualización incremental. */
async function addLtvToPdf(bytes, { progress } = {}) {
  const prog = progress || (() => { });
  const sigs = scanSignatures(bytes); if (!sigs.length) throw new Error(tr('El documento no tiene firmas.'));
  const hex = sigs.at(-1).hex.replace(/(00)+$/, '');
  const cms = new Uint8Array(hex.length / 2); for (let i = 0; i < cms.length; i++) cms[i] = parseInt(hex.substr(i * 2, 2), 16);
  const chain = cmsCertificates(cms);
  if (!chain.length) throw new Error(tr('La firma no incluye certificados.'));
  const v = await collectRevocation(chain, m => prog(m));
  prog(tr('Guardando la información de validación…'));
  const pdf = await PL.PDFDocument.load(bytes, { forIncrementalUpdate: true, updateMetadata: false });
  const ctx = pdf.context, N = PL.PDFName.of;
  let dss = pdf.catalog.lookup(N('DSS'));
  if (!(dss instanceof PL.PDFDict)) { dss = ctx.obj({ Type: 'DSS' }); pdf.catalog.set(N('DSS'), ctx.register(dss)); }
  else { const r = pdf.catalog.get(N('DSS')); if (r instanceof PL.PDFRef) ctx.assign(r, dss); }
  const put = (k, list) => {
    if (!list.length) return;
    let arr = dss.lookup(N(k)); if (!(arr instanceof PL.PDFArray)) { arr = ctx.obj([]); dss.set(N(k), arr); }
    for (const d of list) arr.push(ctx.register(ctx.flateStream(d)));
  };
  put('Certs', v.certs); put('OCSPs', v.ocsps); put('CRLs', v.crls);
  if (!pdf.catalog.has(N('Extensions'))) pdf.catalog.set(N('Extensions'), ctx.obj({ ESIC: { BaseVersion: N('1.7'), ExtensionLevel: 2 } }));
  const out = await pdf.save({ useObjectStreams: false });
  out.ltv = { certs: v.certs.length, ocsps: v.ocsps.length, crls: v.crls.length };
  return out;
}
/** ¿El PDF trae información de validación a largo plazo (DSS con OCSP o CRL)? */
function pdfHasLtv(bytes) { const s = u8ToBin(bytes.subarray(Math.max(0, bytes.length - 4 * 1024 * 1024))); return /\/DSS\b/.test(s) && /\/(OCSPs|CRLs)\s*\[/.test(s); }
