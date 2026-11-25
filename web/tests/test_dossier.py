"""Armar expediente: portada con datos, índice con enlaces, marcadores, Bates (también en páginas giradas) y ajuste de tamaño."""
import asyncio, base64, io, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
from common import launch, open_fixture, check, done, URL, OUT
from pypdf import PdfReader

ROTATED = """async () => { const pdf = await PL.PDFDocument.create(), f = await pdf.embedFont(PL.StandardFonts.Helvetica);
  const p = pdf.addPage([612, 792]); p.drawText('Conocimiento de embarque MSCU7781234', { x: 60, y: 700, size: 16, font: f }); p.setRotation(PL.degrees(90));
  await openBytes('BL girado.pdf', await pdf.save()); return D().pages.length; }"""

# posición (en la vista, origen arriba a la izquierda) de un texto en una página, con la rotación aplicada
POS = """async ([b64, n, needle]) => { const pj = await pdfjsLib.getDocument({ data: b64ToU8(b64) }).promise, pg = await pj.getPage(n), vp = pg.getViewport({ scale: 1 });
  const tc = await pg.getTextContent(), it = tc.items.find(i => i.str.includes(needle)); if (!it) return null;
  const t = pdfjsLib.Util.transform(vp.transform, it.transform); pj.destroy(); return { x: t[4] / vp.width, y: t[5] / vp.height, w: vp.width, h: vp.height }; }"""

async def main():
    async with async_playwright() as p:
        b, ctx, pg, errs = await launch(p)
        await pg.goto(URL); await pg.wait_for_timeout(800)
        await open_fixture(pg, 'texto.pdf', 'Factura comercial.pdf'); await pg.wait_for_timeout(500)
        await pg.evaluate(ROTATED); await pg.wait_for_timeout(500)
        # ---------- interfaz ----------
        await pg.click('.rtab:has-text("Inicio")'); await pg.click('.rbtn:has-text("Expediente")'); await pg.wait_for_selector('.modal .dossier-list')
        check(await pg.locator('.dossier-list .recent-row').count() == 2, 'propone los documentos abiertos')
        await pg.fill('.modal input[aria-label="Título del expediente"]', 'Expediente de importación DUCA 2026-HN-000123 ≤ prueba')
        labels = await pg.locator('.df-row input[aria-label="Dato"]').evaluate_all('xs => xs.map(x => x.value)')
        check('RTN' in labels and 'Aduana' in labels, f'datos de la portada para aduanas: {labels[:4]}…')
        await pg.locator('.df-row').nth(labels.index('RTN')).locator('input[aria-label="Valor"]').fill('05011989049857')
        await pg.locator('.df-row').nth(labels.index('Importador / exportador')).locator('input[aria-label="Valor"]').fill('Inversiones de Prueba S. de R.L.')
        await pg.locator('.dossier-list input').nth(1).fill('Conocimiento de embarque (BL)')
        await pg.screenshot(path=os.path.join(OUT, 'expediente_dialogo.png'))
        await pg.click('.modal .btn.primary:has-text("Armar expediente")')
        await pg.wait_for_function("S.docs.length === 3", timeout=60000); await pg.wait_for_timeout(800)
        await pg.screenshot(path=os.path.join(OUT, 'expediente_resultado.png'))
        b64 = await pg.evaluate("u8ToB64(Object.values(D().sources)[0].bytes)")
        open(os.path.join(OUT, 'expediente.pdf'), 'wb').write(base64.b64decode(b64))
        r = PdfReader(io.BytesIO(base64.b64decode(b64)))
        check(len(r.pages) == 6, f'portada + índice + 3 + 1 páginas = {len(r.pages)}')
        cover = ' '.join(r.pages[0].extract_text().split())
        check('05011989049857' in cover and 'Inversiones de Prueba' in cover and 'DUCA 2026-HN-000123' in cover, 'la portada lleva el título y los datos')
        check('EXP-000001 a EXP-000004' in cover.replace('\n', ' '), 'la portada resume el rango Bates')
        idx = r.pages[1].extract_text()
        check('Factura comercial' in idx and 'Conocimiento de embarque (BL)' in idx and '3–5' in idx and 'EXP-000004' in idx, 'índice con páginas y Bates por documento')
        dests = []
        for a in r.pages[1].get('/Annots') or []:
            a = a.get_object()
            if a.get('/Subtype') == '/Link': dests.append(r.get_page_number(a['/Dest'][0].get_object()) + 1)
        check(dests == [3, 6], f'cada fila del índice enlaza al documento {dests}')
        ol = [(o.title, r.get_destination_page_number(o) + 1) for o in r.outline]
        check(ol == [('Portada', 1), ('Índice', 2), ('1. Factura comercial', 3), ('2. Conocimiento de embarque (BL)', 6)], f'marcadores {ol}')
        check('EXP-000001' in r.pages[2].extract_text() and 'EXP-000003' in r.pages[4].extract_text() and 'EXP-000004' in r.pages[5].extract_text(), 'Bates en cada página de los documentos')
        check(r.metadata.title.startswith('Expediente de importación') and r.metadata.producer == 'Rúbrica', 'metadatos del expediente')
        up = await pg.evaluate(POS, [b64, 3, 'EXP-000001']); rot = await pg.evaluate(POS, [b64, 6, 'EXP-000004'])
        check(up and up['x'] > 0.7 and up['y'] > 0.9, f'Bates abajo a la derecha {up}')
        check(rot and rot['w'] > rot['h'] and rot['x'] > 0.7 and rot['y'] > 0.88, f'Bates abajo a la derecha también en la página girada {rot}')
        await pg.wait_for_function("document.querySelectorAll('#side-body .si').length >= 4", timeout=5000)
        check(await pg.evaluate("S.side === 'bookmarks' && [...document.querySelectorAll('#side-body .si')].map(x => x.innerText.trim())[3]") == '2. Conocimiento de embarque (BL)', 'abre el panel de marcadores')
        check(await pg.evaluate("S.settings.dossier.fields.some(([l, v]) => l === 'RTN' && v === '05011989049857')"), 'recuerda los datos para el próximo expediente')
        # ---------- ajuste de tamaño (documentos como imagen; portada e índice vectoriales) ----------
        res = await pg.evaluate("""async () => {
          const heavy = async (n) => { const pdf = await PL.PDFDocument.create();
            for (let i = 0; i < n; i++) { const c = document.createElement('canvas'); c.width = 1100; c.height = 1420; const g = c.getContext('2d'), im = g.createImageData(c.width, c.height);
              for (let k = 0; k < im.data.length; k += 4) { const v = (Math.random() * 255) | 0; im.data[k] = v; im.data[k + 1] = 255 - v; im.data[k + 2] = (v * 3) & 255; im.data[k + 3] = 255; }
              g.putImageData(im, 0, 0); const j = await pdf.embedJpg(new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.95))).arrayBuffer()));
              pdf.addPage([612, 792]).drawImage(j, { x: 0, y: 0, width: 612, height: 792 }); }
            return pdf.save(); };
          const items = [{ title: 'Fotos de la carga', bytes: await heavy(3) }, { title: 'Póliza', bytes: await heavy(2) }];
          const r = await buildDossierFit(items, { title: 'Prueba de tamaño', fields: [['RTN', '0501']], cover: true, index: true, outline: true, bates: { prefix: 'T-', start: 1, digits: 4 }, size: PAGE_SIZES.letter }, 1.2 * 1024 * 1024, 72);
          return { n: r.bytes.length, dpi: r.dpi, parts: !!r.parts, b64: u8ToB64(r.bytes) }; }""")
        rf = PdfReader(io.BytesIO(base64.b64decode(res['b64'])))
        check(not res['parts'] and res['n'] <= 1.2 * 1024 * 1024 and res['dpi'], f"comprime el expediente a {res['n'] / 1e6:.2f} MB ({res['dpi']} ppp)")
        check(len(rf.outline) == 4 and len(rf.pages) == 7 and 'Prueba de tamaño' in rf.pages[0].extract_text() and 'T-0005' in rf.pages[1].extract_text(), 'conserva portada, índice y marcadores al comprimir')
        check(not errs, f'sin errores de JavaScript {errs[:3]}')
        await b.close()
    done()
asyncio.run(main())
