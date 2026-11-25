"""Comparar dos versiones: texto (agregado, modificado, eliminado), apariencia y páginas nuevas."""
import asyncio, base64, io, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
from common import launch, check, done, URL, OUT
from pypdf import PdfReader

MAKE = """async () => {
  const mk = async (lines, extra) => { const pdf = await PL.PDFDocument.create(), f = await pdf.embedFont(PL.StandardFonts.Helvetica), fb = await pdf.embedFont(PL.StandardFonts.HelveticaBold);
    for (const [k, page] of lines.entries()) { const p = pdf.addPage([612, 792]); page.forEach(([t, y, b]) => t && p.drawText(t, { x: 72, y, size: b ? 18 : 12, font: b ? fb : f }));
      if (extra && extra[k]) extra[k](p); }
    return pdf.save(); };
  const p1 = [['Factura comercial No. 1000', 700, true], ['Cliente: Inversiones de Prueba S.A.', 660], ['Total a pagar: 2,500.00 USD', 630], ['Puerto de destino: Puerto Cortes', 600]];
  const p2 = [['Condiciones de pago a 30 dias de la fecha de factura', 700], ['Firma del responsable', 400]];
  const a = await mk([p1, p2]);
  const b1 = p1.map(r => r.slice()); b1[2][0] = 'Total a pagar: 2,750.00 USD'; b1.push(['Contenedor MSCU7781234', 300]);
  const b2 = p2.map(r => r.slice()); b2[0][0] = 'Condiciones de pago a dias de la fecha de factura';
  const b = await mk([b1, b2, [['Anexo de fotos', 700, true]]], { 1: p => p.drawEllipse({ x: 400, y: 200, xScale: 70, yScale: 40, borderColor: PL.rgb(0.8, 0, 0), borderWidth: 4 }) });
  await openBytes('Original.pdf', a); await openBytes('Revisado.pdf', b); return S.docs.length; }"""

async def main():
    async with async_playwright() as p:
        b, ctx, pg, errs = await launch(p)
        await pg.goto(URL); await pg.wait_for_timeout(800)
        await pg.evaluate(MAKE); await pg.wait_for_timeout(500)
        await pg.click('.rtab:has-text("Inicio")'); await pg.click('.rbtn:has-text("Comparar")'); await pg.wait_for_selector('.modal select[aria-label="Original"]')
        names = await pg.evaluate("[...document.querySelectorAll('.modal select')].map(s => s.selectedOptions[0].text)")
        check(names == ['Original.pdf', 'Revisado.pdf'], f'propone el penúltimo y el último documento {names}')
        await pg.click('.modal .btn.primary:has-text("Comparar")')
        await pg.wait_for_selector('.modal .cmp-list', timeout=60000); await pg.wait_for_timeout(300)
        await pg.screenshot(path=os.path.join(OUT, 'comparar_resumen.png'))
        rows = await pg.eval_on_selector_all('.cmp-row', 'xs => xs.map(x => [x.className.replace("cmp-row cmp-", ""), x.querySelector(".cmp-pg").textContent, x.querySelector(".cmp-tx").textContent])')
        kinds = [(k, pgn) for k, pgn, _ in rows]
        check(('mod', 'p. 1') in kinds and any(k == 'mod' and '2,500.00' in t and '2,750.00' in t for k, _, t in rows), f'detecta el monto modificado: {rows[:2]}')
        check(any(k == 'ins' and 'MSCU7781234' in t for k, _, t in rows), 'detecta la línea agregada')
        check(any(k == 'del' and pgn == 'p. 2' and t.strip() == '30' for k, pgn, t in rows), 'detecta la palabra eliminada en la página 2')
        check(('vis', 'p. 2') in kinds and ('vis', 'p. 1') not in kinds, f'cambio de apariencia solo donde no lo explica el texto (sello dibujado en p. 2): {[k for k in kinds if k[0] == "vis"]}')
        check(any(k == 'ins' and pgn == 'p. 3' for k, pgn, _ in rows), 'página nueva')
        await pg.click('.modal .btn.primary:has-text("Cerrar")')
        st = await pg.evaluate("""(() => { const d = D(); return { name: d.name, n: d.pages.length,
          hl: d.pages[0].ov.filter(o => o.type === 'highlight').map(o => o.color), notes: d.pages.flatMap(p => p.ov.filter(o => o.type === 'note').map(o => o.text)),
          rects: d.pages.map(p => p.ov.filter(o => o.type === 'rect').length) }; })()""")
        check(st['name'] == 'Comparación - Revisado.pdf' and st['n'] == 3, f"abre una copia de la versión revisada {st['name']}")
        check('#f08c00' in st['hl'] and '#2da44e' in st['hl'], 'resaltados naranja (modificado) y verde (agregado)')
        check(any('Antes: «2,500.00»' in n and 'Ahora: «2,750.00»' in n for n in st['notes']) and any('Eliminado: «30»' in n for n in st['notes']), 'notas con el texto anterior')
        r = st['rects']; check(r == [0, 1, 0], f'recuadro rojo donde cambió la apariencia {r}')
        # la copia marcada se guarda como PDF con comentarios reales
        out = PdfReader(io.BytesIO(base64.b64decode(await pg.evaluate("async () => u8ToB64(await buildPdf(D(), {}))"))))
        texts = [a.get_object().get('/Contents', '') for pp in out.pages for a in (pp.get('/Annots') or []) if a.get_object().get('/Subtype') == '/Text']
        check(any('2,750.00' in t for t in texts), f'las notas quedan como comentarios del PDF ({len(texts)})')
        await pg.wait_for_timeout(400)
        check(await pg.evaluate("S.side") == 'comments' and await pg.locator('#side-body .si').count() >= 3, 'las notas aparecen en el panel de comentarios')
        await pg.screenshot(path=os.path.join(OUT, 'comparar_resultado.png'))
        # documentos idénticos
        await pg.evaluate("async () => { const b = new Uint8Array(await (await fetch('/__t/texto.pdf')).arrayBuffer()); await openBytes('A.pdf', b); await openBytes('B.pdf', b.slice()); }")
        n0 = await pg.evaluate("S.docs.length")
        await pg.click('.rbtn:has-text("Comparar")'); await pg.wait_for_selector('.modal select[aria-label="Original"]'); await pg.click('.modal .btn.primary:has-text("Comparar")')
        await pg.wait_for_selector('.modal:has-text("No se encontraron diferencias")', timeout=60000)
        check(True, 'documentos idénticos: sin diferencias')
        check(not errs, f'sin errores de JavaScript {errs[:3]}')
        await b.close()
    done()
asyncio.run(main())
