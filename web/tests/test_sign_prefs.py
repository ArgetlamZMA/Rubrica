"""Preferencias de firma (identificaciones, estilos, marca de tiempo RFC 3161) y atajos de teclado.
La TSA se simula con el DummyTimeStamper de pyHanko; solo se reemplaza el transporte (tsaSend):
el armado de la solicitud, la lectura de la respuesta y su inserción en la firma son los reales."""
import asyncio, base64, datetime, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
from common import launch, open_fixture, check, done, save_b64, URL, OUT
from cryptography import x509 as cx
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from asn1crypto import x509, keys, tsp, pem
from pyhanko.sign.timestamps.dummy_client import DummyTimeStamper
HERE = os.path.dirname(os.path.abspath(__file__))

def make_tsa():
    k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = cx.Name([cx.NameAttribute(NameOID.COMMON_NAME, 'TSA DE PRUEBA'), cx.NameAttribute(NameOID.COUNTRY_NAME, 'HN')])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (cx.CertificateBuilder().subject_name(name).issuer_name(name).public_key(k.public_key()).serial_number(cx.random_serial_number())
            .not_valid_before(now - datetime.timedelta(days=1)).not_valid_after(now + datetime.timedelta(days=365))
            .add_extension(cx.ExtendedKeyUsage([ExtendedKeyUsageOID.TIME_STAMPING]), critical=True)
            .add_extension(cx.KeyUsage(True, True, False, False, False, False, False, False, False), critical=True)
            .sign(k, hashes.SHA256()))
    c = x509.Certificate.load(cert.public_bytes(serialization.Encoding.DER))
    key = keys.PrivateKeyInfo.load(k.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    return c, DummyTimeStamper(tsa_cert=c, tsa_key=key)

async def main():
    tsa_cert, stamper = make_tsa()
    calls = []
    def py_tsa(b64):
        req = tsp.TimeStampReq.load(base64.b64decode(b64)); calls.append(req)
        return base64.b64encode(stamper.request_tsa_response(req).dump()).decode()
    async with async_playwright() as p:
        b, ctx, pg, errs = await launch(p)
        await pg.expose_function('pyTsa', py_tsa)
        await pg.goto(URL); await pg.wait_for_timeout(800)
        await pg.evaluate("delete window.showSaveFilePicker; window.showSaveFilePicker = undefined;")
        await pg.evaluate("() => { window.tsaSend = async (server, q) => b64ToU8(await pyTsa(u8ToB64(q))); }")
        await open_fixture(pg, 'texto.pdf'); await pg.wait_for_timeout(800)

        # ---- firma con marca de tiempo y estilo propio ----
        res = await pg.evaluate("""async () => {
          const p12 = new Uint8Array(await (await fetch('/__t/modern.p12')).arrayBuffer());
          const signer = p12Signer(p12, 'Clave123');
          const style = { id: 'x', title: 'INVERZMA', graphic: 'name', image: null, dir: 'auto', show: { name: true, location: true, dn: true, logo: true, date: true, time: true, reason: true, labels: false } };
          const base = await buildPdf(D(), { noEncrypt: true });
          const out = await signPdfBytes(base, { signer, reason: 'Apruebo este documento', location: 'San Pedro Sula', tsa: { id: 't', name: 'Prueba', url: 'http://tsa.prueba/' },
            visible: { pageIndex: 0, rect: [320, 60, 560, 140], w: 240, h: 80, rot: 0, style } });
          const sigs = scanSignatures(out); const v = await verifySignature(out, sigs[0]);
          return { b64: u8ToB64(out), integrity: v.integrity, sigValid: v.sigValid, ts: v.timestamp && { time: !!v.timestamp.time, tsa: v.timestamp.tsa, covers: v.timestamp.covers }, dn: signer.info.dn, usage: usageText(signer.info.usage) };
        }""")
        check(len(calls) == 1 and calls[0]['cert_req'].native and calls[0]['nonce'].native, 'solicitud RFC 3161 con nonce y certificado')
        check(res['integrity'] and res['sigValid'], 'firma íntegra con la marca de tiempo agregada')
        check(res['ts'] == {'time': True, 'tsa': 'TSA DE PRUEBA', 'covers': True}, f"lee la marca de tiempo {res['ts']}")
        check('CN=CHRISTIAN DIAZ PRUEBA' in res['dn'], 'nombre distinguido del certificado')
        check(res['usage'] != '', f"uso previsto: {res['usage']}")
        path = save_b64('firmado_tsa.pdf', res['b64'])
        from pyhanko.pdf_utils.reader import PdfFileReader
        from pyhanko.sign.validation import async_validate_pdf_signature
        from pyhanko_certvalidator import ValidationContext
        root = x509.Certificate.load(pem.unarmor(open(os.path.join(HERE, 'fixtures', 'test-cert.pem'), 'rb').read())[2])
        with open(path, 'rb') as fh:
            sig = PdfFileReader(fh).embedded_signatures[0]
            st = await async_validate_pdf_signature(sig, ValidationContext(trust_roots=[root]), ts_validation_context=ValidationContext(trust_roots=[tsa_cert]))
            check(st.intact and st.valid, 'pyHanko: firma íntegra y válida')
            check(st.timestamp_validity is not None and st.timestamp_validity.intact and st.timestamp_validity.valid, 'pyHanko: marca de tiempo íntegra y válida')
        # página firmada a imagen para revisar la apariencia
        await pg.evaluate("async (b64) => { await openBytes('firmado_tsa.pdf', b64ToU8(b64)); }", res['b64']); await pg.wait_for_timeout(1500)
        await pg.screenshot(path=os.path.join(OUT, 'sig_estilo.png'))

        # ---- fallo de la TSA: error marcado para ofrecer firmar sin marca de tiempo ----
        r = await pg.evaluate("""async () => {
          const keep = window.tsaSend; window.tsaSend = async () => { throw new Error('sin conexión'); };
          try { const p12 = new Uint8Array(await (await fetch('/__t/modern.p12')).arrayBuffer());
            await signPdfBytes(await buildPdf(D(), { noEncrypt: true }), { signer: p12Signer(p12, 'Clave123'), tsa: { name: 'X', url: 'http://x/' }, visible: null }); return 'firmó'; }
          catch (e) { return e.tsa ? 'tsa' : e.message; } finally { window.tsaSend = keep; } }""")
        check(r == 'tsa', 'error de la TSA identificado para firmar sin marca')

        # ---- ventana de preferencias ----
        await pg.click('.rtab:has-text("Proteger")'); await pg.click('.rbtn:has-text("Preferencias de firma")'); await pg.wait_for_selector('.modal .tabs2')
        await pg.click('.modal .tabs2 button:has-text("Servidores de marca de tiempo")'); await pg.wait_for_timeout(200)
        t = await pg.locator('.modal').inner_text()
        check('TSA_SAR' in t and 'tsa.sar.gob.hn/CryptosecOpenKey/tsa_service' in t and 'Predeterminado' in t, 'TSA del SAR incluida y predeterminada')
        await pg.screenshot(path=os.path.join(OUT, 'prefs_tsa.png'))
        await pg.click('.modal .tabs2 button:has-text("Aspecto de la firma")'); await pg.wait_for_timeout(200)
        await pg.click('.modal .sp-bar .btn:has-text("Crear")'); await pg.wait_for_selector('.modal-bg:nth-child(2)')
        await pg.fill('.modal-bg:nth-child(2) .row input[type=text]', 'INVERZMA')
        await pg.click('.modal-bg:nth-child(2) label:has-text("Nombre distinguido")'); await pg.click('.modal-bg:nth-child(2) label:has-text("Logo")')
        await pg.wait_for_timeout(400); await pg.screenshot(path=os.path.join(OUT, 'prefs_estilo_editor.png'))
        await pg.click('.modal-bg:nth-child(2) .btn.primary:has-text("Aceptar")'); await pg.wait_for_timeout(300)
        st = await pg.evaluate("S.settings.sigStyles")
        check(len(st) == 1 and st[0]['title'] == 'INVERZMA' and st[0]['show']['dn'] and st[0]['show']['logo'], 'crea un estilo de apariencia')
        await pg.click('.modal .sp-bar .btn:has-text("Predeterminado")'); await pg.wait_for_timeout(200)
        check(await pg.evaluate("S.settings.sigStyleDefault") == st[0]['id'], 'estilo predeterminado')
        await pg.screenshot(path=os.path.join(OUT, 'prefs_estilos.png'))
        await pg.click('.modal .tabs2 button:has-text("Identificación digital")'); await pg.wait_for_timeout(200)
        async with pg.expect_file_chooser() as fc:
            await pg.click('.modal .sp-bar .btn:has-text("Añadir archivo")')
        await (await fc.value).set_files(os.path.join(HERE, 'fixtures', 'legacy.p12'))
        await pg.wait_for_selector('.modal-bg:nth-child(2) input[type=password]')
        await pg.fill('.modal-bg:nth-child(2) input[type=password]', 'Clave123'); await pg.click('.modal-bg:nth-child(2) .btn.primary'); await pg.wait_for_timeout(600)
        t = await pg.locator('.modal').inner_text()
        check('Archivo de identificación digital' in t and 'Válido hasta' in t and 'Predeterminado' in t, 'lista de identificaciones con datos del certificado')
        check(await pg.evaluate("(async () => (await idb.get('ids')).map(x => !!x.info && !('password' in x)))()") == [True], 'guarda el certificado sin la contraseña')
        await pg.screenshot(path=os.path.join(OUT, 'prefs_ids.png'))
        await pg.click('.modal .btn.primary:has-text("Cerrar")')
        # el diálogo de firma usa el estilo predeterminado
        await pg.evaluate("void digitalSignDialog()"); await pg.wait_for_selector('.modal'); await pg.wait_for_timeout(500)
        check(await pg.evaluate("document.querySelector('.modal select[aria-label=\"Aspecto\"]').value") == st[0]['id'], 'el diálogo propone el estilo predeterminado')
        await pg.screenshot(path=os.path.join(OUT, 'sigdlg_nuevo.png'))
        await pg.click('.modal .btn:has-text("Cancelar")')

        # ---- atajos de teclado ----
        await pg.evaluate("S.docs.slice().forEach(d => d.dirty = false)")
        await open_fixture(pg, 'texto.pdf', 'segundo.pdf'); await pg.wait_for_timeout(700)
        await pg.click('#viewer', position={'x': 5, 'y': 5})
        n0 = await pg.evaluate("S.docs.length")
        await pg.keyboard.press('Control+Tab'); await pg.wait_for_timeout(300)
        check(await pg.evaluate("D().name") != 'segundo.pdf', 'Ctrl+Tab cambia de documento')
        await pg.keyboard.press('Control+Shift+Tab'); await pg.wait_for_timeout(300)
        check(await pg.evaluate("D().name") == 'segundo.pdf', 'Ctrl+Mayús+Tab vuelve al anterior')
        await pg.keyboard.press('Control+e'); await pg.wait_for_timeout(200)
        check(await pg.evaluate("S.tool") == 'edittext', 'Ctrl+E: editar texto')
        await pg.keyboard.press('Control+e'); await pg.keyboard.press('Control+a'); await pg.wait_for_timeout(200)
        check(len(await pg.evaluate("String(window.getSelection())")) > 20, 'Ctrl+A selecciona el texto de la página')
        await pg.evaluate("() => { const d = D(), p = d.pages[0]; p.ov.push({id: uid(), type: 'rect', x: 60, y: 300, w: 150, h: 80, color: '#d1242f', sw: 2, fill: '', opacity: 1}); renderOverlays(p); selectObj(p.id, p.ov[p.ov.length - 1].id); window.getSelection().removeAllRanges(); }")
        await pg.keyboard.press('Control+c'); await pg.keyboard.press('Control+v'); await pg.keyboard.press('Control+v'); await pg.wait_for_timeout(200)
        check(await pg.evaluate("D().pages[0].ov.filter(o => o.type === 'rect').length") == 3, 'Ctrl+C / Ctrl+V copian el objeto')
        await pg.keyboard.press('Control+x'); await pg.wait_for_timeout(200)
        check(await pg.evaluate("D().pages[0].ov.filter(o => o.type === 'rect').length") == 2, 'Ctrl+X corta el objeto')
        await pg.keyboard.press('Escape'); await pg.keyboard.press('Control+r'); await pg.wait_for_timeout(300)
        check(await pg.evaluate("D().pages[D().cur].rot") == 90, 'Ctrl+R gira la página')
        await pg.keyboard.press('Control+z'); await pg.keyboard.press('Control+1'); await pg.wait_for_timeout(300)
        check(await pg.evaluate("D().zoom") == 100, 'Ctrl+1: tamaño real')
        await pg.keyboard.press('Control+0'); await pg.wait_for_timeout(200)
        check(await pg.evaluate("D().zoom") == 'fitp', 'Ctrl+0: ajustar a la página')
        await pg.keyboard.press('F1'); await pg.wait_for_timeout(300)
        check('Atajos de teclado' in await pg.locator('.modal').inner_text(), 'F1 muestra la lista de atajos')
        await pg.screenshot(path=os.path.join(OUT, 'atajos.png'))
        await pg.keyboard.press('Escape')
        await pg.evaluate("D().dirty = false"); await pg.keyboard.press('Control+w'); await pg.wait_for_timeout(300)
        check(await pg.evaluate("S.docs.length") == n0 - 1, 'Ctrl+W cierra el documento')
        check(not [e for e in errs if 'tsa' not in e.lower()], str(errs[:3]))
        await b.close()
    done()
asyncio.run(main())
