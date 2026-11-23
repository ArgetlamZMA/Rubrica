"""Pruebas principales: anotaciones, exportación, formularios, cifrado, redacción, edición de texto e interfaz."""
import asyncio, os
from playwright.async_api import async_playwright
from pypdf import PdfReader
from common import launch, open_fixture, EXPORT, save_b64, check, done, OUT, URL

async def main():
    async with async_playwright() as p:
        b, ctx, pg, errs = await launch(p)
        await pg.goto(URL); await pg.wait_for_timeout(1200)
        check(await pg.locator('.hcard').count() >= 6, 'pantalla de inicio')
        # ---------- 1. anotaciones y exportación ----------
        await open_fixture(pg, 'texto.pdf')
        await pg.evaluate("""() => { const d = D(), p = d.pages[0];
          p.ov.push({id:uid(),type:'highlight',x:90,y:80,w:200,h:24,color:'#ffe14d',opacity:.45});
          p.ov.push({id:uid(),type:'rect',x:60,y:300,w:150,h:80,color:'#d1242f',sw:2,fill:'',opacity:1});
          const ln={id:uid(),type:'arrow',color:'#8250df',sw:2,opacity:1}; setLineAbs(ln,420,300,560,380); p.ov.push(ln);
          p.ov.push({id:uid(),type:'ink',x:60,y:400,w:200,h:60,color:'#d1242f',sw:2,opacity:1,pts:[[0,1],[.5,0],[1,1]]});
          p.ov.push({id:uid(),type:'text',x:300,y:400,w:220,h:40,text:'Texto agregado ñandú',size:12,color:'#111111',font:'Helvetica',bold:true,italic:false,align:'left',bg:'',border:'',pad:2});
          p.ov.push({id:uid(),type:'note',x:560,y:80,w:22,h:22,color:'#ffd400',text:'Revisar precio',author:'Prueba'});
          p.ov.push({id:uid(),type:'stamp',x:380,y:480,w:180,h:46,label:'APROBADO',color:'#1d8a4e',date:false});
          p.ov.push({id:uid(),type:'field',ftype:'text',name:'Observaciones',x:60,y:520,w:250,h:20});
          p.ov.push({id:uid(),type:'field',ftype:'check',name:'Revisado',x:320,y:523,w:14,h:14});
          rotatePages([d.pages[2]], 1); }""")
        f = save_b64('core1.pdf', await pg.evaluate(EXPORT))
        r = PdfReader(f)
        check(len(r.pages) == 3, 'exporta 3 páginas')
        check(r.pages[1].get('/Rotate') == 90 and r.pages[2].get('/Rotate') == 90, 'conserva y aplica rotaciones')
        t0 = r.pages[0].extract_text()
        check('Texto agregado ñandú' in t0 and 'APROBADO' in t0, 'texto y sello integrados')
        ann = [a.get_object().get('/Subtype') for a in r.pages[0].get('/Annots')]
        check('/Text' in ann and ann.count('/Widget') == 2, 'nota como comentario PDF y 2 campos nuevos')
        # ---------- 2. formulario existente ----------
        await open_fixture(pg, 'form.pdf')
        await pg.wait_for_timeout(600)
        await pg.fill('.ffield >> nth=0', 'José Pérez'); await pg.click('.ffield[type=checkbox]')
        await pg.select_option('select.ffield', 'Guatemala')
        r = PdfReader(save_b64('core2.pdf', await pg.evaluate(EXPORT)))
        fv = {k: v.get('/V') for k, v in r.get_fields().items()}
        check(fv.get('nombre') == 'José Pérez' and fv.get('acepta') == '/Yes' and fv.get('pais') == 'Guatemala', f'rellena formulario {fv}')
        # ---------- 3. combinar + contraseña ----------
        await pg.evaluate("""async () => { const d = new Doc('comb.pdf');
          for (const f of ['texto.pdf','form.pdf']) { const b = new Uint8Array(await (await fetch('/__t/'+f)).arrayBuffer()); d.pages.push(...await addFileToDoc(d, b, f)); }
          d.pages.push(blankPage()); d.pages = [d.pages[2], d.pages[0], d.pages[3], d.pages[4], d.pages[0]];
          d.security = {userPw:'clave1', ownerPw:'dueno', perms:{print:true}}; addDoc(d); }""")
        r = PdfReader(save_b64('core3.pdf', await pg.evaluate(EXPORT)))
        check(r.is_encrypted and r.decrypt('clave1') and len(r.pages) == 5, 'combina, reordena, duplica y cifra (AES-256)')
        # ---------- 4. abrir PDF cifrado ----------
        task = asyncio.ensure_future(open_fixture(pg, 'cifrado.pdf'))
        await pg.wait_for_selector('.modal input[type=password]')
        await pg.fill('.modal input[type=password]', 'abc123'); await pg.click('.modal .btn.primary')
        check(await task == 3, 'abre PDF con contraseña')
        # ---------- 5. redacción permanente ----------
        await open_fixture(pg, 'texto.pdf', 'red.pdf')
        await pg.evaluate("D().pages[0].ov.push({id:uid(),type:'redact',x:60,y:60,w:500,h:150})")
        r = PdfReader(save_b64('core5.pdf', await pg.evaluate(EXPORT)))
        check('Factura' not in (r.pages[0].extract_text() or '') and 'Factura' in r.pages[1].extract_text(), 'redacción elimina el texto subyacente')
        # ---------- 6. interacción: resaltar, texto, deshacer, editar texto ----------
        await open_fixture(pg, 'texto.pdf', 'ui.pdf'); await pg.wait_for_timeout(1000)
        async def P(x, y):
            box = await pg.locator('.page').first.bounding_box(); s = await pg.evaluate('D().scale'); return box['x'] + x * s, box['y'] + y * s
        await pg.click('.rtab:has-text("Comentar")'); await pg.click('.rbtn[data-tool="highlight"]')
        a = await P(75, 127); c = await P(260, 128)
        await pg.mouse.move(*a); await pg.mouse.down(); await pg.mouse.move(*c, steps=5); await pg.mouse.up(); await pg.wait_for_timeout(300)
        check(await pg.evaluate("D().pages[0].ov.filter(o=>o.type==='highlight').length") == 1, 'resaltado ajustado al texto')
        await pg.click('.rbtn[data-tool="text"]'); await pg.mouse.click(*(await P(80, 300))); await pg.wait_for_timeout(200)
        await pg.keyboard.type('Hola desde la prueba de texto que es bastante larga para ajustar')
        await pg.mouse.click(*(await P(500, 200))); await pg.wait_for_timeout(300)
        check(await pg.evaluate("D().pages[0].ov.some(o=>o.type==='text' && o.text.startsWith('Hola') && o.h > 25)"), 'cuadro de texto con ajuste de línea')
        check(await pg.evaluate("viewerEl().scrollTop") == 0, 'escribir no desplaza la vista')
        n = await pg.evaluate("D().pages[0].ov.length"); await pg.keyboard.press('Escape'); await pg.keyboard.press('Control+z')
        check(await pg.evaluate("D().pages[0].ov.length") == n - 1, 'deshacer')
        await pg.click('.rtab:has-text("Editar")'); await pg.click('.rbtn[data-tool="edittext"]'); await pg.wait_for_timeout(600)
        await pg.mouse.click(*(await P(150, 85))); await pg.wait_for_timeout(400)
        await pg.keyboard.press('End'); await pg.keyboard.type(' - EDITADA'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(300)
        r = PdfReader(save_b64('core6.pdf', await pg.evaluate(EXPORT)))
        t = r.pages[0].extract_text()
        check('Factura comercial No. 1000 - EDITADA' in t and t.count('Factura comercial No. 1000') == 1, 'editar texto reemplaza el original')
        # ---------- 7. conversiones ----------
        import docx, openpyxl
        for kind, label, ext in [('word', 'A Word', 'docx'), ('excel', 'A Excel', 'xlsx')]:
            await pg.click('.rtab:has-text("Convertir")'); await pg.click(f'.rbtn:has-text("{label}")'); await pg.wait_for_selector('.modal')
            async with pg.expect_download() as dl:
                await pg.click('.modal .btn.primary')
            path = os.path.join(OUT, 'conv.' + ext); await (await dl.value).save_as(path)
            ok = len(docx.Document(path).paragraphs) > 3 if ext == 'docx' else len(openpyxl.load_workbook(path).sheetnames) == 3
            check(ok, f'convierte a {ext}')
        check(not errs, 'sin errores de JavaScript ' + str(errs[:3]))
        await b.close()
    done()

asyncio.run(main())
