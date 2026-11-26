"""Solicitar firmas: campos de firma vacíos con firmante y orden; quien recibe firma dentro del campo, en orden."""
import asyncio, base64, io, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
from common import launch, open_fixture, check, done, URL, OUT
from pypdf import PdfReader
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.validation import async_validate_pdf_signature

SIGN_FIELD = """async (k) => { const d = D(), f = (await docPendingSignatures(d))[k];
  const [x1, y1, x2, y2] = f.rect;
  const p12 = new Uint8Array(await (await fetch('/__t/modern.p12')).arrayBuffer());
  const out = await signPdfBytes(await buildPdf(d, {}), { signer: p12Signer(p12, 'Clave123'), reason: 'Aprobado',
    visible: { field: f.name, pageIndex: f.docPage, rect: f.rect, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), rot: 0, style: sigStyleById(S.settings.sigStyleDefault) } });
  return [f.name, f.signer, u8ToB64(out)]; }"""

def sig_fields(r):
    out = []
    for f in r.trailer['/Root']['/AcroForm']['/Fields']:
        f = f.get_object()
        if f.get('/FT') == '/Sig': out.append((str(f.get('/T')), '/V' in f, str(f.get('/TU', ''))))
    return out

async def main():
    async with async_playwright() as p:
        b, ctx, pg, errs = await launch(p)
        await pg.goto(URL); await pg.wait_for_timeout(800)
        check(await pg.evaluate("[signerMatches('Christian Díaz Prueba', 'CHRISTIAN DIAZ PRUEBA'), signerMatches('Ana López', 'CHRISTIAN DIAZ PRUEBA'), signerMatches('Christian', 'CHRISTIAN DIAZ PRUEBA')]") == [True, False, True], 'compara el nombre pedido con el titular del certificado')
        await open_fixture(pg, 'texto.pdf', 'contrato.pdf'); await pg.wait_for_timeout(600)
        # preparar: dos campos de firma desde la cinta
        await pg.click('.rtab:has-text("Formulario")'); await pg.click('.rbtn[data-tool="field-sig"]')
        box = await pg.locator('#pages .page').first.bounding_box(); s = await pg.evaluate("D().scale")
        async def drag(x, y, who):
            await pg.mouse.move(box['x'] + x * s, box['y'] + y * s); await pg.mouse.down()
            await pg.mouse.move(box['x'] + (x + 200) * s, box['y'] + (y + 55) * s, steps=6); await pg.mouse.up()
            await pg.wait_for_selector('.modal'); await pg.fill('.modal input[placeholder*="certificado"]', who); await pg.click('.modal .btn.primary'); await pg.wait_for_timeout(300)
        await drag(60, 560, 'Christian Díaz Prueba')
        await drag(330, 560, 'Ana López')  # la herramienta sigue activa
        ovs = await pg.evaluate("D().pages[0].ov.filter(o => o.type === 'field' && o.ftype === 'sig').map(o => [o.signer, o.order])")
        check(ovs == [['Christian Díaz Prueba', 1], ['Ana López', 2]], f'campos con firmante y orden {ovs}')
        await pg.screenshot(path=os.path.join(OUT, 'pedir_firma.png'))
        prepared = await pg.evaluate("async () => u8ToB64(await buildPdf(D(), {}))")
        r = PdfReader(io.BytesIO(base64.b64decode(prepared)))
        f = sig_fields(r)
        check(len(f) == 2 and not any(v for _, v, _ in f) and 'Christian' in f[0][2], f'el PDF trae dos campos de firma vacíos {f}')
        # quien recibe: lo abre y ve las firmas pendientes
        await pg.evaluate("(b64) => openBytes('contrato_para_firmar.pdf', b64ToU8(b64))", prepared)
        await pg.wait_for_function("document.querySelector('.sig-pending')", timeout=15000)
        txt = await pg.inner_text('.sig-pending')
        check('Firmas pendientes (2)' in txt and txt.index('Christian') < txt.index('Ana') and 'siguiente' in txt, f'panel de firmas pendientes: {" | ".join(txt.split(chr(10))[:4])}')
        await pg.screenshot(path=os.path.join(OUT, 'firmas_pendientes.png'))
        # saltarse el orden avisa
        await pg.locator('.sig-pending .sp-row').nth(1).locator('button').click()
        await pg.wait_for_selector('.modal:has-text("espera primero la firma de Christian")')
        check(True, 'avisa si se firma antes de que firme quien va primero')
        await pg.click('.modal .btn:has-text("Cancelar")'); await pg.wait_for_timeout(200)
        # la primera persona firma dentro de su campo
        name1, who1, b1 = await pg.evaluate(SIGN_FIELD, 0)
        d1 = base64.b64decode(b1); open(os.path.join(OUT, 'firma_campo1.pdf'), 'wb').write(d1)
        f1 = sig_fields(PdfReader(io.BytesIO(d1)))
        check(len(f1) == 2 and f1[0][1] and not f1[1][1], f'firma dentro del campo existente, sin crear otro {f1}')
        await pg.evaluate("(b64) => openBytes('contrato_firmado_1.pdf', b64ToU8(b64))", b1)
        await pg.wait_for_function("document.querySelector('.sig-pending')", timeout=15000)
        check('Firmas pendientes (1)' in await pg.inner_text('.sig-pending') and 'Ana' in await pg.inner_text('.sig-pending'), 'ahora falta solo Ana')
        # la segunda firma
        name2, who2, b2 = await pg.evaluate(SIGN_FIELD, 0)
        d2 = base64.b64decode(b2); open(os.path.join(OUT, 'firma_campo2.pdf'), 'wb').write(d2)
        rd = PdfFileReader(io.BytesIO(d2)); sigs = rd.embedded_signatures
        st = [await async_validate_pdf_signature(x) for x in sigs]
        check(len(sigs) == 2 and all(x.intact and x.valid for x in st), f'dos firmas íntegras y válidas: {[(x.intact, x.valid) for x in st]}')
        check(st[0].modification_level.name in ('FORM_FILLING', 'LTA_UPDATES', 'NONE'), f'la segunda firma no invalida la primera: {st[0].modification_level}')
        await pg.evaluate("(b64) => openBytes('contrato_firmado_2.pdf', b64ToU8(b64))", b2); await pg.wait_for_timeout(1200)
        check(await pg.locator('.sig-pending').count() == 0, 'ya no quedan firmas pendientes')
        check(not errs, f'sin errores de JavaScript {errs[:3]}')
        await b.close()
    done()
asyncio.run(main())
