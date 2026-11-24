"""OCR de escritorio sin internet: el motor Tesseract y los idiomas vienen en la carpeta /ocr de la app.
Se bloquea toda conexión externa y se reconoce una página escaneada (imagen) creada en el momento."""
import asyncio, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
from common import launch, check, done, URL, OUT

MAKE_SCAN = """async () => {
  const c = document.createElement('canvas'); c.width = 1275; c.height = 1650; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#111';
  g.font = 'bold 64px Arial'; g.fillText('FACTURA COMERCIAL 4521', 110, 220);
  g.font = '44px Arial'; g.fillText('Puerto Cortes, Honduras', 110, 330); g.fillText('Contenedor MSCU 7781234', 110, 420);
  const png = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer());
  const pdf = await PL.PDFDocument.create(); const im = await pdf.embedPng(png);
  const pg = pdf.addPage([612, 792]); pg.drawImage(im, { x: 0, y: 0, width: 612, height: 792 });
  await openBytes('escaneo.pdf', await pdf.save()); }"""

async def main():
    async with async_playwright() as p:
        b, ctx, pg, errs = await launch(p)
        external = []
        async def guard(route):
            u = route.request.url
            if u.startswith(URL) or u.startswith('data:') or u.startswith('blob:'): await route.continue_()
            else: external.append(u); await route.abort()
        await ctx.route('**/*', guard)
        await pg.goto(URL); await pg.wait_for_timeout(800)
        await pg.evaluate(MAKE_SCAN); await pg.wait_for_timeout(1200)
        await pg.evaluate("() => { ocrDialog(); }"); await pg.wait_for_selector('.modal')
        check('sin internet' in await pg.locator('.modal').inner_text(), 'el diálogo indica que funciona sin internet')
        await pg.select_option('.modal select', 'spa')
        await pg.click('.modal .btn.primary:has-text("Reconocer texto")')
        await pg.wait_for_function("D() && D().pages[0].ov.some(o => o.type === 'ocrword')", timeout=120000)
        words = await pg.evaluate("D().pages[0].ov.filter(o => o.type === 'ocrword').map(o => o.t).join(' ')")
        check('FACTURA' in words and '4521' in words and 'MSCU' in words, f'reconoce el texto escaneado: {words[:90]}')
        check(not external, f'sin conexiones externas: {external[:3]}')
        await pg.screenshot(path=os.path.join(OUT, 'ocr_sin_internet.png'))
        check(not [e for e in errs if 'net::ERR' not in e], str(errs[:3]))
        await b.close()
    done()
asyncio.run(main())
