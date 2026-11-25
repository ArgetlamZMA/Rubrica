"""Sellos predefinidos y códigos QR / Code 128: se exporta el PDF, se rasteriza y se leen los códigos con zxing-cpp."""
import asyncio, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
from common import launch, open_fixture, check, done, save_b64, URL, OUT
import zxingcpp
from PIL import Image

CASES = [('qr', 'https://www.sar.gob.hn/firmaelectronica/ · DUCA 2026-HN-000123 · Puerto Cortés'),
         ('c128', 'MSCU7781234'), ('c128', 'HN-2026-000123'), ('c128', '0501198904985'), ('c128', 'A1')]

async def main():
    async with async_playwright() as p:
        b, ctx, pg, errs = await launch(p)
        await pg.goto(URL); await pg.wait_for_timeout(800)
        await open_fixture(pg, 'texto.pdf'); await pg.wait_for_timeout(900)
        # código de barras desde el diálogo
        await pg.click('.rtab:has-text("Editar")'); await pg.click('.rbtn:has-text("Código QR / barras")'); await pg.wait_for_selector('.modal')
        await pg.select_option('.modal select', 'c128'); await pg.fill('.modal input[type=text]', 'Contenedor ñ')
        await pg.click('.modal .btn.primary'); await pg.wait_for_timeout(300)
        check(await pg.locator('.modal').count() == 1 and 'no «ñ»' in await pg.locator('body').inner_text(), 'rechaza caracteres que Code 128 no admite')
        await pg.fill('.modal input[type=text]', CASES[1][1]); await pg.click('.modal .btn.primary'); await pg.wait_for_timeout(400)
        check(await pg.evaluate("D().pages[0].ov.filter(o => o.type === 'code').length") == 1, 'inserta el código de barras')
        await pg.screenshot(path=os.path.join(OUT, 'codigo_barras.png'))
        # el resto por código, en filas de la página 1
        await pg.evaluate("""(cases) => { const p = D().pages[0]; p.ov = p.ov.filter(o => o.type !== 'code');
          cases.forEach(([kind, data], i) => p.ov.push({ id: uid(), type: 'code', kind, data, caption: true, color: '#000000',
            x: 40, y: 430 + i * 72, w: kind === 'qr' ? 130 : 260, h: kind === 'qr' ? 130 : 56 }));
          // el QR a la derecha para que no se superponga
          const q = p.ov.find(o => o.kind === 'qr'); q.x = 400; q.y = 430; renderOverlays(p); }""", CASES)
        # sellos: color por tipo, fecha, hora y nombre
        await pg.evaluate("() => { S.settings.author = 'Christian Díaz'; }")
        await pg.evaluate("() => { setTool('stamp'); }"); await pg.wait_for_timeout(200)
        await pg.select_option('#props-body select', 'COPIA FIEL'); await pg.wait_for_timeout(100)
        await pg.click('#props-body label:has-text("Incluir hora")'); await pg.click('#props-body label:has-text("Incluir mi nombre")')
        opts = await pg.evaluate("S.toolOpts.stamp")
        check(opts['label'] == 'COPIA FIEL' and opts['color'] == '#1f5fbf' and opts['time'] and opts['who'], f'opciones del sello {opts}')
        box = await pg.locator('#pages .page').first.bounding_box(); s = await pg.evaluate("D().scale")
        await pg.mouse.click(box['x'] + 420 * s, box['y'] + 640 * s); await pg.wait_for_timeout(300)
        st = await pg.evaluate("D().pages[0].ov.find(o => o.type === 'stamp')")
        check(st and 'Christian Díaz' in st['dateText'] and ':' in st['dateText'], f"sello con fecha, hora y nombre: {st and st['dateText']}")
        await pg.screenshot(path=os.path.join(OUT, 'sellos_codigos.png'))
        # exportar, rasterizar y leer los códigos
        out = save_b64('codigos.pdf', await pg.evaluate("async () => u8ToB64(await buildPdf(D(), {}))"))
        png = os.path.join(OUT, 'codigos-1.png')
        subprocess.run(['pdftoppm', '-r', '200', '-f', '1', '-l', '1', '-png', '-singlefile', out, png[:-4]], check=True)
        found = {r.text: r.format.name for r in zxingcpp.read_barcodes(Image.open(png))}
        for kind, data in CASES:
            check(data in found, f'zxing lee {kind} «{data}» ({found.get(data, "no encontrado")})')
        txt = subprocess.run(['pdftotext', '-f', '1', '-l', '1', out, '-'], capture_output=True, text=True).stdout
        check('MSCU7781234' in txt and 'COPIA FIEL' in txt and 'Christian' in txt, 'texto legible del código y del sello en el PDF')
        check(not errs, str(errs[:3]))
        await b.close()
    done()
asyncio.run(main())
