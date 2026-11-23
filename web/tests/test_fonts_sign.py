"""Fuentes del sistema (simuladas con Carlito como «Aptos»), detección de fuente y firma digital."""
import asyncio, os, base64
from playwright.async_api import async_playwright
from pypdf import PdfReader
from common import launch, open_fixture, EXPORT, save_b64, check, done, URL, OUT

async def main():
    async with async_playwright() as p:
        b, ctx, pg, errs = await launch(p)
        await pg.goto(URL); await pg.wait_for_timeout(1000)
        await pg.evaluate("""async () => {
          for (const [st, f] of [['Regular','Carlito-Regular.ttf'],['Bold','Carlito-Bold.ttf']]) registerFace('Aptos', st, { bytes: new Uint8Array(await (await fetch('/__t/'+f)).arrayBuffer()) });
          registerFace('DejaVu Sans', 'Bold', { bytes: new Uint8Array(await (await fetch('/__t/Carlito-Bold.ttf')).arrayBuffer()) });
          S.settings.defaultFont = 'Aptos'; S.toolOpts.text.font = defaultFont(); await ensureFont('Aptos', false, false); }""")
        check(await pg.evaluate("defaultFont()") == 'Aptos', 'Aptos como fuente predeterminada')
        await open_fixture(pg, 'texto.pdf')
        await pg.evaluate("""() => { const p = D().pages[0];
          p.ov.push({id:uid(),type:'text',x:72,y:300,w:300,h:40,text:'Aptos: ñandú € ≥ “comillas”',size:14,color:'#111111',font:'Aptos',bold:false,italic:false,align:'left',bg:'',border:'',pad:2});
          p.ov.push({id:uid(),type:'text',x:72,y:350,w:300,h:40,text:'Aptos negrita',size:14,color:'#00866a',font:'Aptos',bold:true,italic:false,align:'left',bg:'',border:'',pad:2}); }""")
        r = PdfReader(save_b64('fonts.pdf', await pg.evaluate(EXPORT)))
        fonts = set()
        for o in r.pages[0]['/Resources']['/Font'].values(): fonts.add(str(o.get_object().get('/BaseFont')))
        check(any('Carlito-Regular' in f for f in fonts) and any('Carlito-Bold' in f for f in fonts), 'incrusta la fuente del sistema (normal y negrita)')
        check('ñandú € ≥ “comillas”' in r.pages[0].extract_text(), 'texto Unicode con fuente incrustada')
        # detección de fuente al editar
        await open_fixture(pg, 'dejavu.pdf'); await pg.wait_for_timeout(800)
        await pg.click('.rtab:has-text("Editar")'); await pg.click('.rbtn[data-tool="edittext"]'); await pg.wait_for_timeout(700)
        await pg.locator('.page').first.locator('.etext').first.click(); await pg.wait_for_timeout(400)
        await pg.keyboard.press('End'); await pg.keyboard.type(' OK'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(300)
        te = await pg.evaluate("D().pages[0].ov.filter(o=>o.type==='textedit').map(o=>[o.font,o.bold,o.text])[0]")
        check(te == ['DejaVu Sans', True, 'Titulo en DejaVu negrita OK'], f'detecta la fuente original {te}')
        # firma digital
        res = await pg.evaluate("""async () => {
          const out = {}; const enc = u8 => { let s=''; for (let i=0;i<u8.length;i+=32768) s+=String.fromCharCode(...u8.subarray(i,i+32768)); return btoa(s); };
          const p12m = new Uint8Array(await (await fetch('/__t/modern.p12')).arrayBuffer());
          const p12l = new Uint8Array(await (await fetch('/__t/legacy.p12')).arrayBuffer());
          try { p12Signer(p12m, 'mala'); out.badpw = false; } catch (e) { out.badpw = true; }
          const s1 = p12Signer(p12m, 'Clave123'), s2 = p12Signer(p12l, 'Clave123'); out.cn = s1.info.cn;
          const b = new Uint8Array(await (await fetch('/__t/texto.pdf')).arrayBuffer()); const doc = await openBytes('firmar.pdf', b);
          const base = await buildPdf(doc, {}); const p = doc.pages[1], r = {x: 40, y: 40, w: 220, h: 70};
          const sig1 = await signPdfBytes(base, { signer: s1, reason: 'Apruebo este documento', location: 'San Pedro Sula, Honduras', visible: { pageIndex: 1, rect: dispRectToUser(p, r), w: r.w, h: r.h, rot: rotT(p), image: null } });
          const sig2 = await signPdfBytes(sig1, { signer: s2, reason: 'Segunda firma', location: 'Puerto Cortés', visible: null });
          out.sig1 = enc(sig1); out.sig2 = enc(sig2);
          const list = scanSignatures(sig2); out.verify = [];
          for (const sg of list) { const v = await verifySignature(sig2, sg); out.verify.push([v.integrity, v.sigValid, v.reason]); }
          const bad = sig2.slice(); bad[300] ^= 1; out.tampered = (await verifySignature(bad, scanSignatures(bad)[0])).integrity;
          const d2 = await openBytes('firmado.pdf', sig2); d2.pages[0].ov.push({id:uid(),type:'stamp',x:300,y:450,w:150,h:40,label:'RECIBIDO',color:'#d1242f',date:false});
          out.inc = enc(await buildPdf(d2, {}));
          return out; }""")
        check(res['badpw'], 'rechaza contraseña incorrecta del .p12')
        check(res['cn'] == 'CHRISTIAN DIAZ PRUEBA', 'lee el titular del certificado')
        check(res['verify'] == [[True, True, 'Apruebo este documento'], [True, True, 'Segunda firma']], f"verificación interna {res['verify']}")
        check(res['tampered'] is False, 'detecta un documento alterado')
        paths = {k: save_b64(k + '.pdf', res[k]) for k in ('sig1', 'sig2', 'inc')}
        # validación independiente con pyHanko
        from pyhanko.pdf_utils.reader import PdfFileReader
        from pyhanko.sign.validation import async_validate_pdf_signature
        from pyhanko_certvalidator import ValidationContext
        from asn1crypto import pem, x509
        cert = x509.Certificate.load(pem.unarmor(open(os.path.join(os.path.dirname(__file__), 'fixtures', 'test-cert.pem'), 'rb').read())[2])
        vc = ValidationContext(trust_roots=[cert])
        for k, n in (('sig1', 1), ('sig2', 2), ('inc', 2)):
            with open(paths[k], 'rb') as fh:
                sigs = PdfFileReader(fh).embedded_signatures
                st = [await async_validate_pdf_signature(s, vc) for s in sigs]
                check(len(sigs) == n and all(x.intact and x.valid for x in st), f'pyHanko: {k} con {n} firma(s) íntegra(s) y válida(s)')
        check(not errs, 'sin errores de JavaScript ' + str(errs[:3]))
        await b.close()
    done()

asyncio.run(main())
