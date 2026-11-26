"""Firma PAdES con validación a largo plazo (LTV).
PKI de prueba propia: raíz → intermedia → firmante (OCSP), intermedia solo con CRL, TSA emitida por la raíz.
El .p12 no trae la intermedia: Rúbrica debe obtenerla por caIssuers. Un servidor HTTP local (con CORS) atiende
OCSP, CRL, certificados y la TSA. La validación final con pyHanko se hace SIN red (servidor apagado y revocación
obligatoria): solo puede pasar si el PDF ya trae todo en el DSS."""
import asyncio, base64, datetime, io, os, sys, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
from common import launch, check, done, URL, OUT
from cryptography import x509 as cx
from cryptography.x509 import ocsp as cocsp
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID, AuthorityInformationAccessOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from asn1crypto import x509 as ax, keys as akeys, tsp
from pyhanko.sign.timestamps.dummy_client import DummyTimeStamper
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.validation import async_validate_pdf_signature
from pyhanko.sign.validation.dss import DocumentSecurityStore

PORT = 8799; BASE = f'http://localhost:{PORT}'
NOW = datetime.datetime.now(datetime.timezone.utc)

def key(): return rsa.generate_private_key(public_exponent=65537, key_size=2048)
def name(cn): return cx.Name([cx.NameAttribute(NameOID.COMMON_NAME, cn), cx.NameAttribute(NameOID.ORGANIZATION_NAME, 'PKI de prueba Rubrica'), cx.NameAttribute(NameOID.COUNTRY_NAME, 'HN')])
def cert(subject, skey, issuer, ikey, *, ca=False, ocsp=None, ca_issuers=None, crl=None, eku=None, serial=None):
    b = (cx.CertificateBuilder().subject_name(name(subject)).issuer_name(issuer.subject if issuer else name(subject)).public_key(skey.public_key())
         .serial_number(serial or cx.random_serial_number()).not_valid_before(NOW - datetime.timedelta(days=30)).not_valid_after(NOW + datetime.timedelta(days=365))
         .add_extension(cx.BasicConstraints(ca=ca, path_length=None), critical=True)
         .add_extension(cx.SubjectKeyIdentifier.from_public_key(skey.public_key()), critical=False))
    b = b.add_extension(cx.KeyUsage(not ca, not ca, False, False, False, ca, ca, False, False), critical=True)
    if issuer: b = b.add_extension(cx.AuthorityKeyIdentifier.from_issuer_public_key(ikey.public_key()), critical=False)
    aia = ([cx.AccessDescription(AuthorityInformationAccessOID.OCSP, cx.UniformResourceIdentifier(ocsp))] if ocsp else []) + \
          ([cx.AccessDescription(AuthorityInformationAccessOID.CA_ISSUERS, cx.UniformResourceIdentifier(ca_issuers))] if ca_issuers else [])
    if aia: b = b.add_extension(cx.AuthorityInformationAccess(aia), critical=False)
    if crl: b = b.add_extension(cx.CRLDistributionPoints([cx.DistributionPoint([cx.UniformResourceIdentifier(crl)], None, None, None)]), critical=False)
    if eku: b = b.add_extension(cx.ExtendedKeyUsage(eku), critical=True)
    return b.sign(ikey or skey, hashes.SHA256())

rk = key(); root = cert('RAIZ DE PRUEBA', rk, None, None, ca=True)
ik = key(); inter = cert('INTERMEDIA DE PRUEBA', ik, root, rk, ca=True, crl=f'{BASE}/raiz.crl', ca_issuers=f'{BASE}/raiz.cer')
sk = key(); signer = cert('CHRISTIAN DIAZ PRUEBA LTV', sk, inter, ik, ocsp=f'{BASE}/ocsp', ca_issuers=f'{BASE}/intermedia.cer', crl=f'{BASE}/intermedia.crl')
xk = key(); revoked = cert('CERTIFICADO REVOCADO', xk, inter, ik, ocsp=f'{BASE}/ocsp', ca_issuers=f'{BASE}/intermedia.cer')
tk = key(); tsa = cert('TSA DE PRUEBA LTV', tk, root, rk, ocsp=f'{BASE}/ocsp', ca_issuers=f'{BASE}/raiz.cer', eku=[ExtendedKeyUsageOID.TIME_STAMPING])
DER = lambda c: c.public_bytes(serialization.Encoding.DER)
ISSUERS = {inter.subject: (inter, ik), root.subject: (root, rk)}
REVOKED = {revoked.serial_number}
def crl_of(issuer, ikey):
    b = cx.CertificateRevocationListBuilder().issuer_name(issuer.subject).last_update(NOW - datetime.timedelta(hours=1)).next_update(NOW + datetime.timedelta(days=7))
    for c in (signer, revoked, inter, tsa):
        if c.serial_number in REVOKED and c.issuer == issuer.subject:
            b = b.add_revoked_certificate(cx.RevokedCertificateBuilder().serial_number(c.serial_number).revocation_date(NOW - datetime.timedelta(hours=2)).build())
    return b.sign(ikey, hashes.SHA256()).public_bytes(serialization.Encoding.DER)
ALL = {c.serial_number: c for c in (signer, revoked, inter, tsa)}

ax_tsa = ax.Certificate.load(DER(tsa)); ax_root = ax.Certificate.load(DER(root))
stamper = DummyTimeStamper(tsa_cert=ax_tsa, tsa_key=akeys.PrivateKeyInfo.load(tk.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())), certs_to_embed=[ax_tsa])
hits = []

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def cors(self): self.send_header('Access-Control-Allow-Origin', '*'); self.send_header('Access-Control-Allow-Headers', '*'); self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    def send(self, body, ctype='application/octet-stream'):
        self.send_response(200); self.cors(); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_OPTIONS(self): self.send_response(204); self.cors(); self.end_headers()
    def do_GET(self):
        hits.append('GET ' + self.path)
        if self.path == '/raiz.cer': return self.send(DER(root))
        if self.path == '/intermedia.cer': return self.send(DER(inter))
        if self.path == '/raiz.crl': return self.send(crl_of(root, rk))
        if self.path == '/intermedia.crl': return self.send(crl_of(inter, ik))
        self.send_response(404); self.cors(); self.end_headers()
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        hits.append('POST ' + self.path)
        if self.path == '/tsa': return self.send(stamper.request_tsa_response(tsp.TimeStampReq.load(body)).dump(), 'application/timestamp-reply')
        if self.path == '/ocsp':
            req = cocsp.load_der_ocsp_request(body); c = ALL[req.serial_number]
            iss, ikey = ISSUERS[c.issuer]
            st = cocsp.OCSPCertStatus.REVOKED if c.serial_number in REVOKED else cocsp.OCSPCertStatus.GOOD
            rb = cocsp.OCSPResponseBuilder().add_response(cert=c, issuer=iss, algorithm=hashes.SHA1(), cert_status=st, this_update=NOW - datetime.timedelta(minutes=5),
                next_update=NOW + datetime.timedelta(days=1), revocation_time=NOW - datetime.timedelta(hours=2) if st == cocsp.OCSPCertStatus.REVOKED else None,
                revocation_reason=cx.ReasonFlags.key_compromise if st == cocsp.OCSPCertStatus.REVOKED else None).responder_id(cocsp.OCSPResponderEncoding.HASH, iss)
            return self.send(rb.sign(ikey, hashes.SHA256()).public_bytes(serialization.Encoding.DER), 'application/ocsp-response')
        self.send_response(404); self.cors(); self.end_headers()

class Srv(ThreadingHTTPServer):
    allow_reuse_address = True

def p12(c, k): return base64.b64encode(pkcs12.serialize_key_and_certificates(b'prueba', k, c, None, serialization.BestAvailableEncryption(b'1234'))).decode()

SIGN = """async ([p12b64, ltv]) => { const d = D(); const r = await signPdfBytes(await buildPdf(d, { noEncrypt: true }),
  { signer: p12Signer(b64ToU8(p12b64), '1234'), reason: 'Prueba LTV', location: 'San Pedro Sula', tsa: { id: 't', name: 'TSA prueba', url: '%s/tsa' }, ltv });
  return { b64: u8ToB64(r), ltvError: r.ltvError || null, ltv: r.ltv || null }; }""" % BASE

async def main():
    srv = Srv(('127.0.0.1', PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
    async with async_playwright() as p:
        b, ctx, pg, errs = await launch(p)
        await pg.goto(URL); await pg.wait_for_timeout(800)
        await pg.evaluate("async () => { const b = new Uint8Array(await (await fetch('/__t/texto.pdf')).arrayBuffer()); await openBytes('contrato.pdf', b); }")
        r = await pg.evaluate(SIGN, [p12(signer, sk), True])
        check(r['ltvError'] is None and r['ltv'] and r['ltv']['ocsps'] >= 2 and r['ltv']['crls'] >= 1, f"firma con LTV: {r['ltv']} {r['ltvError'] or ''}")
        check('GET /intermedia.cer' in hits, 'obtiene la autoridad intermedia que faltaba (caIssuers)')
        data = base64.b64decode(r['b64']); open(os.path.join(OUT, 'firmado_ltv.pdf'), 'wb').write(data)
        srv.shutdown(); srv.server_close()  # desde aquí, sin red: todo debe estar en el PDF
        rd = PdfFileReader(io.BytesIO(data)); sig = rd.embedded_signatures[0]
        check(sig.sig_object['/SubFilter'] == '/ETSI.CAdES.detached', f"SubFilter PAdES: {sig.sig_object['/SubFilter']}")
        attrs = [a['type'].native for a in sig.signer_info['signed_attrs']]
        check('signing_certificate_v2' in attrs and 'signing_time' not in attrs, f'atributos PAdES: {attrs}')
        dss = DocumentSecurityStore.read_dss(rd)
        vc = dss.as_validation_context({'trust_roots': [ax_root], 'allow_fetching': False, 'revocation_mode': 'hard-fail'})
        vc_ts = dss.as_validation_context({'trust_roots': [ax_root], 'allow_fetching': False, 'revocation_mode': 'hard-fail'})
        st = await async_validate_pdf_signature(sig, signer_validation_context=vc, ts_validation_context=vc_ts)
        check(st.intact and st.valid and st.trusted, f'pyHanko sin red y con revocación obligatoria: íntegra={st.intact} válida={st.valid} confianza={st.trusted}')
        check(st.timestamp_validity is not None and st.timestamp_validity.trusted, 'la marca de tiempo también es de confianza con los datos del DSS')
        check(st.modification_level is not None and st.modification_level.name in ('LTA_UPDATES', 'NONE'), f'lo agregado después de firmar es solo validación: {st.modification_level}')
        # sin DSS la misma validación debe fallar: prueba que el DSS es lo que la hace posible
        from pyhanko_certvalidator import ValidationContext
        try:
            st0 = await async_validate_pdf_signature(sig, signer_validation_context=ValidationContext(trust_roots=[ax_root], allow_fetching=False, revocation_mode='hard-fail', crls=[], ocsps=[], other_certs=[]))
            sin_dss = not st0.trusted
        except Exception as e:
            sin_dss = True  # pyHanko ni siquiera puede armar la ruta de validación
        check(sin_dss, 'sin la información del DSS no se podría validar (control)')
        # el panel muestra PAdES y LTV
        await pg.evaluate("async (b64) => { await openBytes('firmado_ltv.pdf', b64ToU8(b64)); S.side = 'signatures'; S.sideOpen = true; renderSide(); }", r['b64'])
        await pg.wait_for_function("document.querySelector('#side-body') && /LTV/.test(document.querySelector('#side-body').innerText)", timeout=20000)
        panel = await pg.inner_text('#side-body')
        check('Formato: PAdES' in panel and 'validación a largo plazo (LTV) incluida' in panel and 'cambios posteriores' not in panel, f'panel de firmas: {" | ".join(panel.split(chr(10))[:3])}')
        await pg.screenshot(path=os.path.join(OUT, 'firma_ltv.png'))
        # certificado revocado: no se debe entregar como firma válida
        srv = Srv(('127.0.0.1', PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
        msg = await pg.evaluate("async (a) => { try { await (" + SIGN + ")(a); return 'firmó'; } catch (e) { return e.message; } }", [p12(revoked, xk), True])
        check('CERTIFICADO REVOCADO' in msg and 'revocado' in msg, f'detiene la firma con un certificado revocado: {msg[:80]}')
        srv.shutdown(); srv.server_close()
        check(not errs, f'sin errores de JavaScript {errs[:3]}')
        await b.close()
    done()
asyncio.run(main())
