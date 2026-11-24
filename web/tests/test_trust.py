"""Confianza en las firmas: cadena del firmante hasta una raíz de confianza.
Jerarquía de prueba como la del SAR: raíz → subordinada → firmante, más una raíz «impostora» con el mismo nombre."""
import asyncio, base64, datetime, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
from common import launch, open_fixture, check, done, URL, OUT
from cryptography import x509 as cx
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12

NOW = datetime.datetime.now(datetime.timezone.utc)
def name(cn): return cx.Name([cx.NameAttribute(NameOID.COMMON_NAME, cn), cx.NameAttribute(NameOID.COUNTRY_NAME, 'HN')])
def key(): return rsa.generate_private_key(public_exponent=65537, key_size=2048)
def cert(subject, skey, issuer, ikey, ca, days=(-30, 365)):
    b = (cx.CertificateBuilder().subject_name(name(subject)).issuer_name(name(issuer)).public_key(skey.public_key())
         .serial_number(cx.random_serial_number()).not_valid_before(NOW + datetime.timedelta(days=days[0])).not_valid_after(NOW + datetime.timedelta(days=days[1]))
         .add_extension(cx.BasicConstraints(ca=ca, path_length=None), critical=True))
    b = b.add_extension(cx.KeyUsage(not ca, not ca, False, False, False, ca, ca, False, False), critical=True)
    return b.sign(ikey, hashes.SHA256())
def pem(c): return c.public_bytes(serialization.Encoding.PEM).decode()
def p12(c, k, cas): return base64.b64encode(pkcs12.serialize_key_and_certificates(b'firmante', k, c, cas, serialization.BestAvailableEncryption(b'Clave123'))).decode()

def pki(root_name='RAIZ DE PRUEBA SAR', sub_days=(-30, 365)):
    rk, sk, lk = key(), key(), key()
    root = cert(root_name, rk, root_name, rk, True, (-60, 3650))
    sub = cert('SUBORDINADA DE PRUEBA SAR', sk, root_name, rk, True, sub_days)
    leaf = cert('CONTRIBUYENTE DE PRUEBA', lk, 'SUBORDINADA DE PRUEBA SAR', sk, False)
    return root, sub, leaf, lk, rk

SIGN = """async ([p12b64, withRoot]) => {
  const signer = p12Signer(b64ToU8(p12b64), 'Clave123');
  const out = await signPdfBytes(await buildPdf(D(), { noEncrypt: true }), { signer, reason: 'Prueba', visible: null });
  return u8ToB64(out); }"""
VERIFY = """async (b64) => { const b = b64ToU8(b64); const v = await verifySignature(b, scanSignatures(b)[0]);
  return { integrity: v.integrity, status: v.trust.status, reason: v.trust.reason || '', anchor: v.trust.anchor || '', n: (v.trust.path || []).length, top: v.trust.top ? certCn(v.trust.top) : '' }; }"""

async def main():
    root, sub, leaf, lk, rk = pki()
    evil_root, evil_sub, evil_leaf, evil_lk, _ = pki()     # mismo nombre de raíz, otra clave
    osk, olk = key(), key()                                # subordinada de la raíz buena, ya vencida al firmar
    old_sub = cert('SUBORDINADA VENCIDA', osk, 'RAIZ DE PRUEBA SAR', rk, True, (-400, -10))
    old_leaf = cert('CONTRIBUYENTE DE PRUEBA', olk, 'SUBORDINADA VENCIDA', osk, False); old_lk = olk
    async with async_playwright() as p:
        b, ctx, pg, errs = await launch(p)
        await pg.goto(URL); await pg.wait_for_timeout(800)
        await pg.evaluate("delete window.showSaveFilePicker; window.showSaveFilePicker = undefined;")
        await open_fixture(pg, 'texto.pdf'); await pg.wait_for_timeout(700)
        good = await pg.evaluate(SIGN, [p12(leaf, lk, [sub, root]), True])
        v = await pg.evaluate(VERIFY, good)
        check(v['integrity'] and v['status'] == 'untrusted' and 'RAIZ DE PRUEBA SAR' in v['reason'] and v['top'] == 'RAIZ DE PRUEBA SAR', f'sin raíces de confianza: íntegra pero no verificada {v}')
        await pg.evaluate("async (p) => { await addTrusted([forge.pki.certificateFromPem(p)]); }", pem(root))
        v = await pg.evaluate(VERIFY, good)
        check(v['status'] == 'trusted' and v['anchor'] == 'RAIZ DE PRUEBA SAR' and v['n'] == 3, f'con la raíz de confianza: cadena de 3 hasta la raíz {v}')
        # la firma no trae la subordinada: no se puede completar la cadena…
        nosub = await pg.evaluate(SIGN, [p12(leaf, lk, []), False])
        v = await pg.evaluate(VERIFY, nosub)
        check(v['status'] == 'untrusted' and 'SUBORDINADA' in v['reason'], f'falta el certificado intermedio {v}')
        # …salvo que también se confíe en la subordinada
        await pg.evaluate("async (p) => { await addTrusted([forge.pki.certificateFromPem(p)]); }", pem(sub))
        v = await pg.evaluate(VERIFY, nosub)
        check(v['status'] == 'trusted' and v['anchor'] == 'SUBORDINADA DE PRUEBA SAR', f'confianza en una autoridad intermedia {v}')
        evil = await pg.evaluate(SIGN, [p12(evil_leaf, evil_lk, [evil_sub, evil_root]), True])
        v = await pg.evaluate(VERIFY, evil)
        check(v['integrity'] and v['status'] == 'untrusted', f'raíz impostora con el mismo nombre: no es de confianza {v}')
        old = await pg.evaluate(SIGN, [p12(old_leaf, old_lk, [old_sub]), True])
        await pg.evaluate("async () => { await idb.set('trust', []); }")
        await pg.evaluate("async (p) => { await addTrusted([forge.pki.certificateFromPem(p)]); }", pem(root))
        v = await pg.evaluate(VERIFY, old)
        check(v['status'] == 'untrusted' and 'vigente' in v['reason'], f'autoridad vencida al firmar: no es de confianza {v}')
        selfsigned = await pg.evaluate("async () => { const p = new Uint8Array(await (await fetch('/__t/modern.p12')).arrayBuffer()); const out = await signPdfBytes(await buildPdf(D(), { noEncrypt: true }), { signer: p12Signer(p, 'Clave123'), visible: null }); return u8ToB64(out); }")
        v = await pg.evaluate(VERIFY, selfsigned)
        check(v['integrity'] and v['status'] == 'untrusted', f'certificado autofirmado: no verificado {v}')

        # ---- interfaz: panel Firmas y «Confiar en este emisor» ----
        await pg.evaluate("async () => { await idb.set('trust', []); }")
        await pg.evaluate("async (b64) => { await openBytes('firmado_cadena.pdf', b64ToU8(b64)); }", good); await pg.wait_for_timeout(1200)
        await pg.evaluate("() => { S.side = 'signatures'; S.sideOpen = true; renderSide(); }"); await pg.wait_for_timeout(1500)
        side = await pg.locator('#side-panel').inner_text()
        check('emisor no verificado' in side and 'Confiar en este emisor' in side, 'el panel advierte «emisor no verificado»')
        await pg.screenshot(path=os.path.join(OUT, 'firma_no_verificada.png'))
        await pg.click('#side-panel .btn:has-text("Confiar en este emisor")'); await pg.wait_for_selector('.modal')
        t = await pg.locator('.modal').inner_text()
        check('Huella SHA-256' in t and 'RAIZ DE PRUEBA SAR' in t, 'muestra la huella antes de confiar')
        await pg.screenshot(path=os.path.join(OUT, 'confiar_emisor.png'))
        await pg.click('.modal .btn.primary:has-text("Confiar")'); await pg.wait_for_timeout(1500)
        side = await pg.locator('#side-panel').inner_text()
        check('emisor de confianza' in side and 'Cadena:' in side, 'tras confiar: «Firma válida · emisor de confianza»')
        await pg.screenshot(path=os.path.join(OUT, 'firma_confianza.png'))
        # ---- preferencias: importar un .pem ----
        await pg.evaluate("async () => { await idb.set('trust', []); }")
        path = os.path.join(OUT, 'raiz_prueba.pem'); open(path, 'w').write(pem(root) + pem(sub))
        await pg.evaluate("() => { signPrefsDialog('trust'); }"); await pg.wait_for_selector('.modal .tabs2')
        async with pg.expect_file_chooser() as fc:
            await pg.click('.modal .sp-bar .btn:has-text("Importar certificado")')
        await (await fc.value).set_files(path)
        await pg.wait_for_selector('.modal-bg:nth-child(2)'); await pg.click('.modal-bg:nth-child(2) .btn.primary'); await pg.wait_for_timeout(600)
        t = await pg.locator('.modal').inner_text()
        check('RAIZ DE PRUEBA SAR' in t and 'SUBORDINADA DE PRUEBA SAR' in t and 'Huella SHA-256' in t, 'importa la raíz y la subordinada desde un .pem')
        await pg.screenshot(path=os.path.join(OUT, 'prefs_confianza.png'))
        check(not errs, str(errs[:3]))
        await b.close()
    done()
asyncio.run(main())
