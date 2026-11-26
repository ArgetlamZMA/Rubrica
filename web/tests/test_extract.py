"""Extraer datos a Excel con plantillas: zonas con nombre, detección por palabra clave, OCR en escaneos y tipos de dato."""
import asyncio, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
from common import launch, check, done, URL, OUT
from openpyxl import load_workbook

DOCS = """async () => {
  const rows = [['NAVIERA MSC', 'FAC-2026-0101', 'MSCU 778123 4', '25,480.50', '1,250.00', '03/11/2026'],
                ['NAVIERA MSC', 'FAC-2026-0102', 'MSCU 778999 1', '18,200.00', '980.75', '15/11/2026'],
                ['NAVIERA MSC', 'FAC-2026-0103', 'TGHU 445566 0', '9,999.99', '15,300.00', '21/11/2026'],
                ['MAERSK LINE', 'MAE-55', 'MRKU 1', '1.00', '2.00', '01/01/2026']];
  const label = [['Factura No.', 640], ['Contenedor', 600], ['Peso bruto (kg)', 560], ['Valor FOB (USD)', 520], ['Fecha de emision', 480]];
  window.__ex = [];
  for (const [k, r] of rows.entries()) {
    const pdf = await PL.PDFDocument.create(), f = await pdf.embedFont(PL.StandardFonts.Helvetica), fb = await pdf.embedFont(PL.StandardFonts.HelveticaBold);
    const p = pdf.addPage([612, 792]);
    p.drawText(r[0], { x: 60, y: 720, size: 20, font: fb });
    label.forEach(([l, y], i) => { p.drawText(l, { x: 60, y, size: 12, font: f }); p.drawText(r[i + 1], { x: 260, y, size: 12, font: fb }); });
    p.drawText('Condiciones: pago a 30 dias', { x: 60, y: 400, size: 10, font: f });
    window.__ex.push({ name: `factura_${k + 1}.pdf`, bytes: await pdf.save(), mime: 'application/pdf' });
  }
  // el mismo formato escaneado (solo imagen, sin texto)
  const c = document.createElement('canvas'), K = 300 / 72; c.width = 612 * K; c.height = 792 * K; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#000';
  const txt = (t, x, y, s, b) => { g.font = `${b ? 'bold ' : ''}${s * K}px Arial`; g.fillText(t, x * K, (792 - y) * K); };
  txt('NAVIERA MSC', 60, 720, 20, true);
  const sc = ['FAC-2026-0104', 'CMAU 123456 7', '7,350.25', '420.00', '24/11/2026'];
  label.forEach(([l, y], i) => { txt(l, 60, y, 12); txt(sc[i], 260, y, 12, true); });
  const png = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer());
  const pdf = await PL.PDFDocument.create(), im = await pdf.embedPng(png); pdf.addPage([612, 792]).drawImage(im, { x: 0, y: 0, width: 612, height: 792 });
  window.__ex.push({ name: 'factura_escaneada.pdf', bytes: await pdf.save(), mime: 'application/pdf' });
  await openBytes('factura_1.pdf', window.__ex[0].bytes);
  return window.__ex.length; }"""

ZONES = """() => { const p = D().pages[0], z = (name, kind, y) => p.ov.push({ id: uid(), type: 'zone', name, kind, color: '#7c3aed', x: 255, y: 792 - y - 13, w: 150, h: 18 });
  z('Contenedor', 'code', 600); z('Peso bruto', 'number', 560); z('Valor FOB', 'number', 520); z('Fecha', 'date', 480); renderOverlays(p); }"""

async def main():
    async with async_playwright() as p:
        b, ctx, pg, errs = await launch(p)
        await pg.goto(URL); await pg.wait_for_timeout(800)
        await pg.evaluate(DOCS); await pg.wait_for_timeout(500)
        # una zona con la herramienta, el resto por código
        await pg.click('.rtab:has-text("Convertir")'); await pg.click('.rbtn[data-tool="zone"]')
        box = await pg.locator('#pages .page').first.bounding_box(); s = await pg.evaluate("D().scale")
        await pg.mouse.move(box['x'] + 255 * s, box['y'] + (792 - 640 - 13) * s); await pg.mouse.down()
        await pg.mouse.move(box['x'] + 405 * s, box['y'] + (792 - 640 + 5) * s, steps=5); await pg.mouse.up()
        await pg.wait_for_selector('.modal'); await pg.fill('.modal input', 'Factura'); await pg.click('.modal .btn.primary'); await pg.wait_for_timeout(300)
        await pg.evaluate(ZONES)
        check(await pg.evaluate("zonesFromDoc(D()).map(z => z.name).join()") == 'Factura,Contenedor,Peso bruto,Valor FOB,Fecha', 'zonas con nombre en el documento')
        await pg.screenshot(path=os.path.join(OUT, 'zonas.png'))
        # guardar la plantilla desde el diálogo
        await pg.click('.rbtn:has-text("Extraer datos")'); await pg.wait_for_selector('.modal select[aria-label="Plantilla"]')
        await pg.click('.modal button:has-text("Guardar plantilla")'); await pg.wait_for_selector('.modal >> nth=1')
        await pg.locator('.modal >> nth=1').locator('input').nth(0).fill('MSC facturas'); await pg.locator('.modal >> nth=1').locator('input').nth(1).fill('NAVIERA MSC')
        await pg.click('.modal >> nth=1 >> .btn.primary'); await pg.wait_for_timeout(300)
        t = await pg.evaluate("S.settings.extractTemplates")
        check(len(t) == 1 and t[0]['keyword'] == 'NAVIERA MSC' and len(t[0]['zones']) == 5 and 0 < t[0]['zones'][0]['x'] < 1, 'plantilla guardada con posiciones relativas a la página')
        await pg.click('.modal .btn:has-text("Cancelar")')
        # aplicar a todos, detectando la plantilla
        res = await pg.evaluate("async () => { const r = await runExtraction(window.__ex.map(f => ({ ...f, bytes: f.bytes.slice() })), null, { ocr: true }); return r; }")
        rows, rep = res['rows'], res['report']
        check(rows[0] == ['Archivo', 'Plantilla', 'Factura', 'Contenedor', 'Peso bruto', 'Valor FOB', 'Fecha'], f'encabezados {rows[0]}')
        r1 = rows[1]
        check(r1[2] == 'FAC-2026-0101' and r1[3] == 'MSCU7781234' and r1[4] == 25480.5 and r1[5] == 1250 and r1[6] == '2026-11-03', f'valores con su tipo (código sin espacios, números, fecha ISO): {r1}')
        check([r[2] for r in rows[1:4]] == ['FAC-2026-0101', 'FAC-2026-0102', 'FAC-2026-0103'], 'una fila por documento del mismo formato')
        sc = [r for r in rows if r[0] == 'factura_escaneada.pdf']
        check(sc and sc[0][2] == 'FAC-2026-0104' and sc[0][3] == 'CMAU1234567' and sc[0][4] == 7350.25 and sc[0][6] == '2026-11-24', f'escaneo leído con OCR: {sc}')
        mae = [x for x in rep if x['name'] == 'factura_4.pdf'][0]
        check(not mae['ok'] and 'plantilla' in mae['error'], f"otra naviera: ninguna plantilla coincide ({mae.get('error')})")
        # desde el diálogo, a Excel
        await pg.evaluate("async () => { for (const f of window.__ex.slice(1, 3)) await openBytes(f.name, f.bytes.slice()); activateDoc(S.docs[0]); }")
        await pg.click('.rbtn:has-text("Extraer datos")'); await pg.wait_for_selector('.modal select[aria-label="Plantilla"]')
        await pg.select_option('.modal select[aria-label="Plantilla"]', '__auto')
        await pg.click('.modal button:has-text("Documentos abiertos")'); await pg.click('.modal .btn.primary:has-text("Extraer")')
        await pg.wait_for_selector('.modal .extract-preview', timeout=60000)
        await pg.screenshot(path=os.path.join(OUT, 'extraer_vista.png'))
        async with pg.expect_download() as dl:
            await pg.click('.modal .btn.primary:has-text("Descargar Excel")')
        path = os.path.join(OUT, 'datos.xlsx'); await (await dl.value).save_as(path)
        ws = load_workbook(path).active
        vals = [[c.value for c in r] for r in ws.iter_rows()]
        check(len(vals) == 4 and vals[1][4] == 25480.5 and isinstance(vals[1][4], float) and ws['A1'].font.b and ws.freeze_panes == 'A2', f'Excel con números reales, encabezado en negrita y fijo: {vals[1]}')
        check(not errs, f'sin errores de JavaScript {errs[:3]}')
        await b.close()
    done()
asyncio.run(main())
