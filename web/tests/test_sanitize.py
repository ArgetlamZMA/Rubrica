"""Quitar información oculta: metadatos, adjuntos, JavaScript, acciones, comentarios, capas ocultas y datos privados."""
import asyncio, base64, io, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
from common import launch, check, done, URL, OUT
from pypdf import PdfReader

DIRTY = """async () => {
  const pdf = await PL.PDFDocument.create(), N = PL.PDFName.of, ctx = pdf.context, f = await pdf.embedFont(PL.StandardFonts.Helvetica);
  pdf.setTitle('Borrador interno'); pdf.setAuthor('Juan Perez - Legal'); pdf.setKeywords(['confidencial']); pdf.setCreator('Programa X');
  const p = pdf.addPage([612, 792]);
  p.drawText('Contenido publico del documento', { x: 72, y: 700, size: 16, font: f });
  // capa oculta con texto secreto
  const ocg = ctx.register(ctx.obj({ Type: 'OCG', Name: PL.PDFHexString.fromText('Notas internas') }));
  pdf.catalog.set(N('OCProperties'), ctx.obj({ OCGs: [ocg], D: { OFF: [ocg], Order: [ocg] } }));
  p.node.Resources().set(N('Properties'), ctx.obj({ oc1: ocg }));
  p.pushOperators(PL.PDFOperator.of('BDC', [N('OC'), N('oc1')]));
  p.drawText('SECRETO margen de 35 por ciento', { x: 72, y: 500, size: 16, font: f });
  p.pushOperators(PL.PDFOperator.of('EMC'));
  // XMP, adjunto, JavaScript, acción al abrir, comentario, enlace que ejecuta un programa, miniatura y datos privados
  const xmp = ctx.flateStream('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Juan Perez XMP</dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' });
  pdf.catalog.set(N('Metadata'), ctx.register(xmp));
  await pdf.attach(new TextEncoder().encode('costos reales: 1234'), 'costos.txt', { mimeType: 'text/plain' });
  pdf.addJavaScript('rastreo', 'app.alert("hola")');
  pdf.catalog.set(N('OpenAction'), ctx.obj({ S: 'JavaScript', JS: PL.PDFHexString.fromText('this.print()') }));
  const note = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [72, 600, 92, 620], Contents: PL.PDFHexString.fromText('Revisar con el gerente: bajar precio') }));
  const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [72, 650, 300, 670], A: { S: 'Launch', F: PL.PDFHexString.fromText('cmd.exe') } }));
  const web = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [72, 680, 300, 690], A: { S: 'URI', URI: PL.PDFString.of('https://www.sar.gob.hn') } }));
  p.node.set(N('Annots'), ctx.obj([note, link, web]));
  p.node.set(N('Thumb'), ctx.register(ctx.stream('miniatura', { Width: 1, Height: 1 })));
  pdf.catalog.set(N('PieceInfo'), ctx.obj({ Illustrator: { Private: PL.PDFHexString.fromText('datos privados del editor') } }));
  await openBytes('sucio.pdf', await pdf.save({ useObjectStreams: false })); return D().pages.length; }"""

def all_bytes(r):
    out = []
    for g, d in r.xref.items():
        for n in d:
            try:
                o = r.get_object(n)
                out.append(o.get_data() if hasattr(o, 'get_data') else str(o).encode('latin-1', 'replace'))
            except Exception: pass
    return b'\n'.join(out)

async def main():
    async with async_playwright() as p:
        b, ctx, pg, errs = await launch(p)
        await pg.goto(URL); await pg.wait_for_timeout(800)
        await pg.evaluate(DIRTY); await pg.wait_for_timeout(500)
        src = PdfReader(io.BytesIO(base64.b64decode(await pg.evaluate("async () => u8ToB64(await buildPdf(D(), { noEncrypt: true }))"))))
        raw0 = all_bytes(src)
        check(b'SECRETO' in raw0 or b'534543524554' in raw0.upper(), 'el documento de prueba tiene el texto de la capa oculta')
        await pg.click('.rtab:has-text("Proteger")'); await pg.click('.rbtn:has-text("Quitar información oculta")'); await pg.wait_for_selector('.modal .chk')
        await pg.locator('.modal label.chk:has-text("Comentarios") input').check()
        await pg.screenshot(path=os.path.join(OUT, 'limpiar_dialogo.png'))
        await pg.click('.modal .btn.primary'); await pg.wait_for_selector('.modal:has-text("Se quitó de la copia")', timeout=60000)
        rep = await pg.inner_text('.modal')
        check(all(k in rep for k in ('metadatos', 'archivos adjuntos', 'scripts', 'capas ocultas', 'comentarios', 'datos privados')), f'informe de lo quitado: {" · ".join(rep.split(chr(10))[2:9])}')
        await pg.screenshot(path=os.path.join(OUT, 'limpiar_informe.png'))
        await pg.click('.modal .btn.primary')
        check(await pg.evaluate("D().name") == 'sucio_limpio.pdf', 'abre la copia limpia en otra pestaña')
        r = PdfReader(io.BytesIO(base64.b64decode(await pg.evaluate("u8ToB64(Object.values(D().sources)[0].bytes)"))))
        raw = all_bytes(r); up = raw.upper()
        root = r.trailer['/Root']
        check(not (r.metadata or {}).get('/Author') and not (r.metadata or {}).get('/Title') and '/Metadata' not in root and b'Juan Perez' not in raw, 'sin metadatos ni XMP')
        check('/Names' not in root or ('/EmbeddedFiles' not in root['/Names'] and '/JavaScript' not in root['/Names']), 'sin adjuntos ni JavaScript a nivel de documento')
        check(b'costos reales' not in raw and b'app.alert' not in raw and b'this.print' not in raw and '/OpenAction' not in root, 'el contenido del adjunto y los scripts ya no están en el archivo')
        annots = [a.get_object() for a in (r.pages[0].get('/Annots') or [])]
        check([a['/A']['/S'] for a in annots] == ['/URI'], f"solo queda el enlace web: {[a.get('/Subtype') for a in annots]}")
        check(b'Revisar con el gerente' not in raw and b'cmd.exe' not in raw, 'comentario y enlace a programa borrados del archivo')
        check(b'SECRETO' not in raw and b'534543524554' not in up and '/OCProperties' not in root, 'la capa oculta y su texto desaparecieron')
        check('/Thumb' not in r.pages[0] and '/PieceInfo' not in root and b'datos privados del editor' not in raw, 'sin miniatura ni datos privados')
        check('OCR' in rep, 'avisa que las páginas con capas ocultas quedan sin texto buscable (sugiere OCR)')
        # se ve igual que antes (la capa oculta no se veía)
        same = await pg.evaluate("""async () => { const a = S.docs[0], b = D(); const ca = document.createElement('canvas'), cb = document.createElement('canvas');
          await drawPage(a, a.pages[0], 1, ca, 1); await drawPage(b, b.pages[0], 1, cb, 1);
          const x = ca.getContext('2d').getImageData(0, 0, ca.width, ca.height).data, y = cb.getContext('2d').getImageData(0, 0, cb.width, cb.height).data;
          let diff = 0; for (let i = 0; i < x.length; i += 4) if (Math.abs(x[i] - y[i]) > 80) diff++; return diff / (x.length / 4); }""")
        check(same < 0.01, f'la copia se ve igual que el original ({same:.4f} de píxeles distintos)')
        check(not errs, f'sin errores de JavaScript {errs[:3]}')
        await b.close()
    done()
asyncio.run(main())
