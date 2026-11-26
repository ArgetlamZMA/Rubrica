"""Modo estudio: resumen de resaltados, subrayados, tachados y notas (de Rúbrica y de otros programas) a Word y Markdown."""
import asyncio, os, sys, io
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
from common import launch, open_fixture, check, done, URL, OUT
from docx import Document

MARKS = """() => { const p = D().pages[0], id = uid;
  p.ov.push({ id: id(), type: 'highlight', x: 70, y: 72, w: 265, h: 26, color: '#ffd400', opacity: 0.45 });                 // título
  p.ov.push({ id: id(), type: 'highlight', x: 70, y: 160, w: 250, h: 16, color: '#2da44e', opacity: 0.45 });               // dos líneas seguidas = una sola marca
  p.ov.push({ id: id(), type: 'highlight', x: 70, y: 180, w: 95, h: 16, color: '#2da44e', opacity: 0.45 });
  p.ov.push({ id: id(), type: 'underline', x: 72, y: 182 + 13 * 0.62, w: 90, h: 13 * 0.38, color: '#d1242f', sw: 1 });
  p.ov.push({ id: id(), type: 'strike', x: 214, y: 202 + 13 * 0.25, w: 34, h: 13 * 0.5, color: '#d1242f', sw: 1 });
  p.ov.push({ id: id(), type: 'note', x: 400, y: 80, w: 22, h: 22, color: '#ffd400', text: 'Revisar el número de factura con la DUCA', author: 'Christian' }); }"""

EXTERNAL = """async () => {
  const pdf = await PL.PDFDocument.create(), f = await pdf.embedFont(PL.StandardFonts.Helvetica), ctx = pdf.context, N = PL.PDFName.of;
  const p = pdf.addPage([612, 792]);
  p.drawText('La fotosintesis convierte la luz en energia quimica', { x: 72, y: 700, size: 14, font: f });
  p.drawText('Esta linea no esta marcada', { x: 72, y: 670, size: 14, font: f });
  const w = f.widthOfTextAtSize('La fotosintesis', 14), x1 = 72, x2 = 72 + w, y1 = 696, y2 = 712;
  const hl = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Highlight', Rect: [x1, y1, x2, y2], QuadPoints: [x1, y2, x2, y2, x1, y1, x2, y1], C: [1, 0.8, 0], Contents: PL.PDFHexString.fromText('concepto clave'), T: PL.PDFHexString.fromText('Ana (Acrobat)'), F: 4 }));
  const tx = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [500, 690, 520, 710], Contents: PL.PDFHexString.fromText('Pregunta para el examen'), T: PL.PDFHexString.fromText('Ana (Acrobat)'), F: 4 }));
  p.node.set(N('Annots'), ctx.obj([hl, tx]));
  await openBytes('biologia.pdf', await pdf.save()); }"""

async def main():
    async with async_playwright() as p:
        b, ctx, pg, errs = await launch(p)
        await pg.goto(URL); await pg.wait_for_timeout(800)
        await open_fixture(pg, 'texto.pdf', 'Factura.pdf'); await pg.wait_for_timeout(500)
        await pg.evaluate(MARKS)
        items = await pg.evaluate("async () => (await collectStudyItems(D())).map(i => [i.page, i.kind, i.text, i.note])")
        check(items[0][1:3] == ['highlight', 'Factura comercial No. 1000'], f'texto bajo el resaltado: {items[0]}')
        two = [i for i in items if i[1] == 'highlight' and 'Descripcion' in i[2]]
        check(two and two[0][2].endswith('Tanque isotermico') and len([i for i in items if i[1] == 'highlight']) == 2, f'resaltado de dos líneas = una sola marca: {two}')
        check(any(i[1] == 'underline' and i[2] == 'Tanque isotermico' for i in items), f"subrayado: {[i for i in items if i[1] == 'underline']}")
        check(any(i[1] == 'strike' and i[2] == '850.50' for i in items), f"tachado: {[i for i in items if i[1] == 'strike']}")
        check(any(i[1] == 'note' and 'DUCA' in i[3] for i in items), 'nota')
        # Word desde la cinta
        await pg.click('.rtab:has-text("Comentar")'); await pg.click('.rbtn:has-text("Resumen")'); await pg.wait_for_selector('.modal')
        async with pg.expect_download() as dl:
            await pg.click('.modal .btn.primary')
        path = os.path.join(OUT, 'resumen.docx'); await (await dl.value).save_as(path)
        doc = Document(path); paras = [x.text for x in doc.paragraphs]
        check(paras[0].startswith('Resumen de «Factura»') and 'Página 1' in paras, f'Word: título y página {paras[:3]}')
        hl = [x for x in doc.paragraphs if 'Factura comercial No. 1000' in x.text]
        shd = hl and hl[0].runs[-1]._r.xpath('.//w:shd')
        check(bool(shd) and shd[0].get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}fill') not in (None, 'auto'), 'Word: el resaltado lleva su color')
        st = [x for x in doc.paragraphs if x.text.endswith('850.50')]
        check(st and st[0].runs[-1].font.strike, 'Word: el tachado queda tachado')
        check(any('Revisar el número de factura con la DUCA' in t and 'Christian' in t for t in paras), 'Word: la nota con su autor')
        # anotaciones de otro programa y Markdown
        await pg.evaluate(EXTERNAL); await pg.wait_for_timeout(500)
        ext = await pg.evaluate("async () => (await collectStudyItems(D())).map(i => [i.kind, i.text, i.note, i.author, i.external])")
        check(['highlight', 'La fotosintesis', 'concepto clave', 'Ana (Acrobat)', True] in ext, f'resaltado hecho en otro programa, con su comentario: {ext}')
        check(any(e[0] == 'note' and e[2] == 'Pregunta para el examen' for e in ext) and not any('no esta marcada' in (e[1] or '') for e in ext), 'nota de otro programa y nada de texto sin marcar')
        await pg.click('.rbtn:has-text("Resumen")'); await pg.wait_for_selector('.modal')
        await pg.select_option('.modal select >> nth=0', 'md'); await pg.select_option('.modal select >> nth=1', 'kind')
        async with pg.expect_download() as dl:
            await pg.click('.modal .btn.primary')
        md = open(await (await dl.value).path(), encoding='utf-8').read()
        open(os.path.join(OUT, 'resumen.md'), 'w', encoding='utf-8').write(md)
        check('## Resaltados' in md and '==La fotosintesis==' in md and '(p. 1)' in md and 'Nota: concepto clave' in md and '## Notas' in md, f'Markdown agrupado por tipo:\n{md[:300]}')
        check(not errs, f'sin errores de JavaScript {errs[:3]}')
        await b.close()
    done()
asyncio.run(main())
