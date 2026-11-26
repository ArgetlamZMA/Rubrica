"""Guardar como PDF/A-2b: solo se convierten en imagen las páginas que no pueden cumplir; el archivo pasa las reglas comprobadas."""
import asyncio, base64, io, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
from common import launch, check, done, URL, OUT
from pypdf import PdfReader
from pdfa_check import check_pdfa2b

MAKE = """async () => {
  const pdf = await PL.PDFDocument.create(); pdf.registerFontkit(fontkit); const N = PL.PDFName.of, ctx = pdf.context;
  const carlito = await pdf.embedFont(new Uint8Array(await (await fetch('/__t/Carlito-Regular.ttf')).arrayBuffer()), { subset: true });
  const helv = await pdf.embedFont(PL.StandardFonts.Helvetica);
  pdf.setTitle('Póliza de importación 2026'); pdf.setAuthor('INVERZMA'); pdf.setSubject('Prueba PDF/A');
  // 1) fuente incrustada: debe quedar vectorial
  const p1 = pdf.addPage([612, 792]); p1.drawText('Declaración DUCA 2026-HN-000123 con fuente incrustada', { x: 60, y: 700, size: 14, font: carlito });
  p1.drawRectangle({ x: 60, y: 600, width: 200, height: 40, color: PL.rgb(0.1, 0.5, 0.3), opacity: 0.5 });
  // 2) Helvetica sin incrustar, visible
  const p2 = pdf.addPage([612, 792]); p2.drawText('Factura con Helvetica sin incrustar', { x: 60, y: 700, size: 14, font: helv });
  // 3) color CMYK
  const p3 = pdf.addPage([612, 792]); p3.drawText('Pagina con color de imprenta', { x: 60, y: 700, size: 14, font: carlito });
  p3.drawRectangle({ x: 60, y: 500, width: 200, height: 80, color: PL.cmyk(0, 0.8, 0.9, 0) });
  // JavaScript y adjunto, que PDF/A no admite
  pdf.addJavaScript('x', 'app.alert(1)'); await pdf.attach(new TextEncoder().encode('adjunto'), 'nota.txt', { mimeType: 'text/plain' });
  const d = await openBytes('poliza.pdf', await pdf.save({ useObjectStreams: false }));
  // nota y sello creados en Rúbrica
  d.pages[0].ov.push({ id: uid(), type: 'note', x: 500, y: 60, w: 22, h: 22, color: '#ffd400', text: 'Revisado por aduana', author: 'Christian' });
  return d.pages.length; }"""

async def main():
    async with async_playwright() as p:
        b, ctx, pg, errs = await launch(p)
        await pg.goto(URL); await pg.wait_for_timeout(800)
        await pg.evaluate(MAKE); await pg.wait_for_timeout(500)
        await pg.click('.rtab:has-text("Convertir")'); await pg.click('.rbtn:has-text("PDF/A")'); await pg.wait_for_selector('.modal')
        await pg.click('.modal .btn.primary'); await pg.wait_for_function("S.docs.length === 2", timeout=60000); await pg.wait_for_timeout(500)
        toast = await pg.locator('.toast').last.inner_text()
        check('2 página(s)' in toast and 'fuentes sin incrustar' in toast and 'CMYK' in toast, f'informa qué páginas se convirtieron y por qué: {toast[:120]}')
        b64 = await pg.evaluate("u8ToB64(Object.values(D().sources)[0].bytes)")
        path = os.path.join(OUT, 'pdfa.pdf'); open(path, 'wb').write(base64.b64decode(b64))
        probs = check_pdfa2b(path)
        check(not probs, f'cumple las reglas de PDF/A-2b comprobadas {probs[:6]}')
        r = PdfReader(path)
        xo = [len(pp['/Resources'].get('/XObject', {})) for pp in r.pages]
        check(xo[0] == 0 and xo[1] == 1 and xo[2] == 1, f'solo se convierten en imagen las páginas que no cumplen {xo}')
        txt = [' '.join((pp.extract_text() or '').split()) for pp in r.pages]
        check('DUCA 2026-HN-000123' in txt[0] and 'Helvetica sin incrustar' in txt[1] and 'color de imprenta' in txt[2], 'el texto sigue buscable en todas las páginas')
        check(r.metadata.title == 'Póliza de importación 2026' and r.metadata.author == 'INVERZMA', 'conserva título y autor (Info y XMP iguales)')
        notes = [a.get_object() for a in (r.pages[0].get('/Annots') or [])]
        check(len(notes) == 1 and notes[0]['/Subtype'] == '/Text' and '/AP' in notes[0] and int(notes[0]['/F']) & 4, 'la nota queda imprimible y con apariencia')
        # guardar sin cambios devuelve el mismo PDF/A; con cambios se vuelve a aplicar
        same = await pg.evaluate("async () => { const d = D(), a = Object.values(d.sources)[0].bytes, b = await buildPdf(d, {}); return a.length === b.length && a.every((v, i) => v === b[i]); }")
        check(same, 'guardar sin cambios conserva el archivo PDF/A exacto')
        await pg.evaluate("() => { const d = D(); d.checkpoint(); d.pages[0].ov.push({ id: uid(), type: 'text', text: 'Agregado después', size: 14, color: '#c00000', font: 'Helvetica', bold: true, italic: false, bg: '', border: '', pad: 0, x: 60, y: 300, w: 200, h: 20 }); }")
        b2 = await pg.evaluate("async () => u8ToB64(await buildPdf(D(), {}))")
        path2 = os.path.join(OUT, 'pdfa_editado.pdf'); open(path2, 'wb').write(base64.b64decode(b2))
        probs2 = check_pdfa2b(path2)
        check(not probs2 and 'Agregado después' in ' '.join((PdfReader(path2).pages[0].extract_text() or '').split()), f'al editar y guardar sigue siendo PDF/A {probs2[:4]}')
        # firmar la copia PDF/A con firma visible: sigue cumpliendo (el texto de la apariencia va como imagen)
        await pg.evaluate("activateDoc(S.docs[1])")
        sb = await pg.evaluate("""async () => { const d = D(), p = d.pages[0], r = { x: 330, y: 620, w: 220, h: 70 };
          const p12 = new Uint8Array(await (await fetch('/__t/modern.p12')).arrayBuffer());
          const out = await signPdfBytes(await buildPdf(d, {}), { signer: p12Signer(p12, 'Clave123'), reason: 'Aprobado', location: 'San Pedro Sula',
            visible: { pageIndex: 0, rect: dispRectToUser(p, r), w: r.w, h: r.h, rot: 0, style: sigStyleById(S.settings.sigStyleDefault) } });
          return u8ToB64(out); }""")
        path3 = os.path.join(OUT, 'pdfa_firmado.pdf'); open(path3, 'wb').write(base64.b64decode(sb))
        probs3 = check_pdfa2b(path3)
        rs = PdfReader(path3); w = [a.get_object() for a in (rs.pages[0].get('/Annots') or []) if a.get_object().get('/FT') == '/Sig']
        res = w[0]['/AP']['/N']['/Resources'] if w else {}
        check(not probs3 and w and '/Font' not in res and '/Tx' in res.get('/XObject', {}), f'firmado con firma visible sigue siendo PDF/A {probs3[:4]}')
        # el original sin convertir no cumple (la comprobación detecta los problemas)
        b0 = await pg.evaluate("async () => u8ToB64(await buildPdf(S.docs[0], { noEncrypt: true }))")
        p0 = os.path.join(OUT, 'no_pdfa.pdf'); open(p0, 'wb').write(base64.b64decode(b0))
        bad = check_pdfa2b(p0)
        check(any('no incrustada' in x for x in bad) and any('CMYK' in x for x in bad) and 'JavaScript' in bad, f'la comprobación detecta un PDF que no cumple ({len(bad)} problemas)')
        check(not errs, f'sin errores de JavaScript {errs[:3]}')
        await b.close()
    done()
asyncio.run(main())
