"""Ajustar al tamaño de un portal: comprimir hasta X MB y dividir en partes de máximo X MB."""
import asyncio, os, sys, io
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
from common import launch, check, done, URL, OUT
from pypdf import PdfReader

HEAVY = """async (n) => {
  const pdf = await PL.PDFDocument.create();
  for (let i = 0; i < n; i++) {
    const c = document.createElement('canvas'); c.width = 1100; c.height = 1420; const g = c.getContext('2d'), im = g.createImageData(c.width, c.height);
    for (let k = 0; k < im.data.length; k += 4) { const v = (Math.random() * 255) | 0; im.data[k] = v; im.data[k + 1] = (v * 7 + i * 40) & 255; im.data[k + 2] = 255 - v; im.data[k + 3] = 255; }
    g.putImageData(im, 0, 0); g.fillStyle = '#fff'; g.fillRect(80, 80, 940, 160); g.fillStyle = '#000'; g.font = 'bold 90px Arial'; g.fillText('PAGINA ' + (i + 1), 120, 200);
    const jpg = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.95))).arrayBuffer());
    const im2 = await pdf.embedJpg(jpg), pg = pdf.addPage([612, 792]); pg.drawImage(im2, { x: 0, y: 0, width: 612, height: 792 });
  }
  await openBytes('pesado.pdf', await pdf.save()); return Object.values(D().sources)[0].bytes.length; }"""

async def main():
    async with async_playwright() as p:
        b, ctx, pg, errs = await launch(p)
        await pg.goto(URL); await pg.wait_for_timeout(800)
        size = await pg.evaluate(HEAVY, 6); await pg.wait_for_timeout(800)
        check(size > 4_000_000, f'documento de prueba pesado: {size / 1e6:.1f} MB')
        MB = 1024 * 1024
        r = await pg.evaluate("async (max) => { const r = await fitToSize(D(), max, { minDpi: 72, mode: 'compress' }); return { n: r.bytes.length, dpi: r.dpi }; }", int(1.5 * MB))
        check(r['n'] <= 1.5 * MB and r['dpi'] is not None, f"comprime por debajo de 1,5 MB: {r['n'] / 1e6:.2f} MB a {r['dpi']} ppp")
        r = await pg.evaluate("""async (max) => { const r = await fitToSize(D(), max, { minDpi: 150, mode: 'split' });
          return r.parts.map(p => ({ n: p.bytes.length, from: p.from, to: p.to, b64: u8ToB64(p.bytes) })); }""", int(2.2 * MB))
        sizes = [x['n'] for x in r]
        check(len(r) >= 2 and all(n <= 2.2 * MB for n in sizes), f'divide sin pérdida en partes de máximo 2,2 MB: {[round(n / 1e6, 2) for n in sizes]}')
        pages = []
        import base64
        for x in r:
            rd = PdfReader(io.BytesIO(base64.b64decode(x['b64'])))
            pages += [pp.extract_text() for pp in rd.pages]
            check(len(rd.pages) == x['to'] - x['from'] + 1, f"parte {x['from']}–{x['to']} con sus páginas")
        check(len(pages) == 6 and r[0]['from'] == 1 and r[-1]['to'] == 6 and all(r[k]['to'] + 1 == r[k + 1]['from'] for k in range(len(r) - 1)), 'las partes cubren todas las páginas, en orden')
        r = await pg.evaluate("async (max) => { try { await fitToSize(D(), max, { minDpi: 150, mode: 'split' }); return 'ok'; } catch (e) { return e.message; } }", 200_000)
        check('pesa' in r and 'límite' in r, f'avisa si una sola página excede el límite: {r[:80]}')
        # interfaz: Convertir → Ajustar a tamaño, solo comprimir
        await pg.click('.rtab:has-text("Convertir")'); await pg.click('.rbtn:has-text("Ajustar a tamaño")'); await pg.wait_for_selector('.modal')
        await pg.fill('.modal input[type=text]', '1.5'); await pg.select_option('.modal select >> nth=0', '72'); await pg.select_option('.modal select >> nth=1', 'compress')
        await pg.screenshot(path=os.path.join(OUT, 'ajustar_tamano.png'))
        await pg.click('.modal .btn.primary'); await pg.wait_for_function("S.docs.length === 2", timeout=120000)
        n = await pg.evaluate("Object.values(D().sources)[0].bytes.length")
        check(n <= 1.5 * MB and await pg.evaluate("D().pages.length") == 6, f'abre el resultado ajustado en una pestaña nueva ({n / 1e6:.2f} MB)')
        check(await pg.evaluate("S.settings.fitMb") == 1.5, 'recuerda el tamaño elegido')
        check(not errs, f'sin errores de JavaScript {errs[:3]}')
        await b.close()
    done()
asyncio.run(main())
