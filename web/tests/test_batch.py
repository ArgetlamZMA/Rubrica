"""Procesar por lotes y automatizaciones guardadas."""
import asyncio, base64, io, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
from common import launch, open_fixture, check, done, URL, OUT
from pypdf import PdfReader

FILES = """async () => {
  const fx = new Uint8Array(await (await fetch('/__t/texto.pdf')).arrayBuffer());
  // «escaneo»: imagen con texto, sin capa de texto, en horizontal
  const c = document.createElement('canvas'); c.width = 1650; c.height = 1275; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#111'; g.font = 'bold 64px Arial';
  g.fillText('CONOCIMIENTO DE EMBARQUE', 120, 260); g.font = '56px Arial'; g.fillText('Contenedor MSCU7781234', 120, 400); g.fillText('Puerto Cortes, Honduras', 120, 500);
  const png = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer());
  const pdf = await PL.PDFDocument.create(); const im = await pdf.embedPng(png); pdf.addPage([792, 612]).drawImage(im, { x: 0, y: 0, width: 792, height: 612 });
  window.__files = [{ name: 'Factura 1000.pdf', bytes: fx, mime: 'application/pdf' }, { name: 'BL escaneado.pdf', bytes: await pdf.save(), mime: 'application/pdf' },
                    { name: 'dañado.pdf', bytes: new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10, 1, 2, 3]), mime: 'application/pdf' }];
  return window.__files.length; }"""

RUN = """async (steps) => { const r = await runBatch(window.__files, steps, { pattern: '{archivo}_listo' });
  return { report: r.report.map(x => ({ ...x, files: x.files || [] })), outputs: r.outputs.map(o => ({ name: o.name, b64: u8ToB64(o.bytes) })) }; }"""

def rd(b64, pw=None):
    r = PdfReader(io.BytesIO(base64.b64decode(b64)))
    if pw is not None: check(r.is_encrypted and r.decrypt(pw) != 0, 'cifrado con la contraseña del paso')
    return r

async def main():
    async with async_playwright() as p:
        b, ctx, pg, errs = await launch(p)
        await pg.goto(URL); await pg.wait_for_timeout(800)
        await pg.evaluate(FILES)
        steps = [{'type': 'ocr', 'v': {'lang': 'spa', 'skip': True}}, {'type': 'rotate', 'v': {'angle': '-1', 'which': 'landscape'}},
                 {'type': 'stamp', 'v': {'label': 'COPIA FIEL', 'pages': 'first', 'pos': 'tr', 'date': True}},
                 {'type': 'bates', 'v': {'prefix': 'L-', 'start': 1, 'digits': 6, 'cont': True}}, {'type': 'meta', 'v': {'title': '{archivo}', 'author': 'INVERZMA'}},
                 {'type': 'compress', 'v': {'level': 'strong'}}, {'type': 'protect', 'v': {'userPw': 'x1', 'ownerPw': 'dueño', 'print': True}}]
        res = await pg.evaluate(RUN, steps)
        rep = res['report']
        check([x['ok'] for x in rep] == [True, True, False] and 'dañado' in rep[2]['name'] and rep[2]['error'], f"sigue con los demás si un archivo falla: {rep[2].get('error', '')[:60]}")
        check([o['name'] for o in res['outputs']] == ['Factura 1000_listo.pdf', 'BL escaneado_listo.pdf'], f"nombres de salida {[o['name'] for o in res['outputs']]}")
        a, bl = rd(res['outputs'][0]['b64'], 'x1'), rd(res['outputs'][1]['b64'], 'x1')
        ta = [' '.join((x.extract_text() or '').split()) for x in a.pages]; tb = ' '.join((bl.pages[0].extract_text() or '').split())
        check(len(a.pages) == 3 and 'L-000001' in ta[0] and 'L-000003' in ta[2] and 'L-000004' in tb, 'Bates continúa de un archivo al siguiente')
        check('COPIA FIEL' in ta[0] and 'COPIA FIEL' not in ta[1] and 'COPIA FIEL' in tb, 'sello en la primera página de cada archivo')
        check('MSCU7781234' in tb and 'CONOCIMIENTO' in tb, f'OCR del escaneo: {tb[:60]}')
        check('Factura comercial No. 1000' in ta[0], 'no se vuelve a reconocer lo que ya tiene texto y el texto sobrevive a la compresión')
        imgs = all(len(x['/Resources']['/XObject']) == 1 for x in list(a.pages) + list(bl.pages))
        check(imgs, 'comprimido: cada página es una imagen')
        w, h = float(bl.pages[0].mediabox.width), float(bl.pages[0].mediabox.height); rot = bl.pages[0].get('/Rotate', 0)
        check((w < h) == (rot % 180 == 0), f'gira solo las horizontales ({w:.0f}×{h:.0f}, /Rotate {rot})')
        check(a.metadata.title == 'Factura 1000' and a.metadata.author == 'INVERZMA', f'propiedades con {{archivo}}: {a.metadata.title}')
        check(rep[0]['before'] and rep[0]['after'] and rep[0]['parts'] == 1, 'informe con tamaño antes y después')
        # tamaño máximo con partes cifradas
        res2 = await pg.evaluate("""async () => { const pdf = await PL.PDFDocument.create();
            for (let i = 0; i < 4; i++) { const c = document.createElement('canvas'); c.width = 1000; c.height = 1300; const g = c.getContext('2d'), im = g.createImageData(c.width, c.height);
              for (let k = 0; k < im.data.length; k += 4) { const v = (Math.random() * 255) | 0; im.data[k] = v; im.data[k + 1] = 255 - v; im.data[k + 2] = v; im.data[k + 3] = 255; }
              g.putImageData(im, 0, 0); const j = await pdf.embedJpg(new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.95))).arrayBuffer()));
              pdf.addPage([612, 792]).drawImage(j, { x: 0, y: 0, width: 612, height: 792 }); }
            const r = await runBatch([{ name: 'fotos.pdf', bytes: await pdf.save() }], [{ type: 'fit', v: { mb: '0.25', minDpi: '96' } }, { type: 'protect', v: { userPw: 'k9' } }]);
            return { rep: r.report[0], outs: r.outputs.map(o => ({ name: o.name, n: o.bytes.length, b64: u8ToB64(o.bytes) })) }; }""")
        outs = res2['outs']
        check(len(outs) >= 2 and all(o['n'] <= 0.25 * 1024 * 1024 for o in outs) and outs[0]['name'] == 'fotos_parte01.pdf', f"divide al tamaño máximo: {[(o['name'], round(o['n'] / 1e3)) for o in outs]}")
        check(sum(len(rd(o['b64'], 'k9').pages) for o in outs) == 4, 'cada parte cifrada y todas las páginas presentes')
        # ---------- interfaz y automatizaciones ----------
        await open_fixture(pg, 'texto.pdf', 'Póliza.pdf'); await pg.wait_for_timeout(500)
        await pg.click('.rtab:has-text("Convertir")'); await pg.click('.rbtn:has-text("Por lotes")'); await pg.wait_for_selector('.modal .batch-steps')
        await pg.click('.modal button:has-text("Documentos abiertos")')
        check(await pg.locator('.modal .recent-list .recent-row').count() == 1, 'agrega el documento abierto')
        while await pg.locator('.bstep').count(): await pg.locator('.bstep').first.locator('button[title="Quitar"]').click()
        await pg.select_option('.modal select[aria-label="Agregar paso"]', 'stamp')
        await pg.select_option('.modal select[aria-label="Agregar paso"]', 'pagenum')
        await pg.locator('.bstep').nth(0).locator('select[aria-label="Sello"]').select_option('RECIBIDO CONFORME')
        check(await pg.locator('.bstep').count() == 2, 'agrega pasos y edita sus opciones')
        await pg.screenshot(path=os.path.join(OUT, 'lotes.png'))
        await pg.click('.modal button:has-text("Guardar como automatización")'); await pg.wait_for_selector('.modal >> nth=1')
        await pg.fill('.modal >> nth=1 >> input', 'Recibido para el expediente'); await pg.click('.modal >> nth=1 >> .btn.primary'); await pg.wait_for_timeout(300)
        au = await pg.evaluate("S.settings.automations")
        check(len(au) == 1 and au[0]['name'] == 'Recibido para el expediente' and [s['type'] for s in au[0]['steps']] == ['stamp', 'pagenum'] and au[0]['steps'][0]['v']['label'] == 'RECIBIDO CONFORME', 'guarda la automatización con sus opciones')
        await pg.click('.modal .btn:has-text("Cancelar")'); await pg.wait_for_timeout(200)
        await pg.click('.rtab:has-text("Inicio")'); await pg.click('.rbtn:has-text("Automatizaciones")'); await pg.wait_for_selector('.popmenu')
        check(await pg.locator('.popmenu button:has-text("Recibido para el expediente")').count() == 1, 'menú de automatizaciones')
        await pg.screenshot(path=os.path.join(OUT, 'automatizaciones.png'))
        n0 = await pg.evaluate("S.docs.length")
        await pg.click('.popmenu button:has-text("Recibido para el expediente")')
        await pg.wait_for_function(f"S.docs.length === {n0 + 1}", timeout=60000); await pg.wait_for_timeout(500)
        out = await pg.evaluate("(() => { const d = D(); return [d.name, d.pages.length]; })()")
        rb = PdfReader(io.BytesIO(base64.b64decode(await pg.evaluate("u8ToB64(Object.values(D().sources)[0].bytes)"))))
        t0 = ' '.join((rb.pages[0].extract_text() or '').split())
        check(out == ['Póliza.pdf', 3] and 'RECIBIDO CONFORME' in t0 and 'Página 1 de 3' in t0, f'aplica la automatización al documento actual: {out} · {t0[-40:]}')
        check(not errs, f'sin errores de JavaScript {errs[:3]}')
        await b.close()
    done()
asyncio.run(main())
