"""Documentos de Office → PDF: en Windows los convierte el host nativo (aquí simulado); en el navegador se explica qué hacer."""
import asyncio, os, sys, json
from urllib.parse import unquote
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
from common import launch, check, done, URL, OUT

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'texto.pdf')
calls = []

async def native(route):
    req = route.request; name = req.url.split('/__native/')[1].split('?')[0]
    if req.headers.get('x-pdfs-token') != 'tok': return await route.fulfill(status=403, body='token')
    if name == 'office-to-pdf':
        fname = unquote(req.headers.get('x-file-name', ''))
        calls.append((fname, req.post_data_buffer))
        if fname.endswith('.pptx'):
            return await route.fulfill(status=500, body='Para convertir presentaciones se necesita Microsoft PowerPoint o LibreOffice instalados en este equipo.')
        return await route.fulfill(status=200, body=open(FIX, 'rb').read(), headers={'Content-Type': 'application/pdf'})
    if name == 'fonts': return await route.fulfill(json=[])
    if name == 'certs': return await route.fulfill(json=[])
    return await route.fulfill(json={})

async def main():
    async with async_playwright() as p:
        b, ctx, pg, errs = await launch(p)
        # ---------- navegador: sin host nativo ----------
        await pg.goto(URL); await pg.wait_for_timeout(700)
        check(await pg.evaluate("isOfficeName('Liquidación.XLSX') && isOfficeName('a.docx') && !isOfficeName('a.pdf') && !isOfficeName('docx')"), 'reconoce documentos de Office por la extensión')
        msg = await pg.evaluate("async () => { try { await openBytes('Informe.docx', new Uint8Array([80, 75, 3, 4])); return 'abrió'; } catch (e) { return e.message; } }")
        check('Windows' in msg and 'Informe.docx' in msg, f'en el navegador explica cómo abrirlo: {msg[:90]}')
        await pg.click('.rtab:has-text("Convertir")')
        check(await pg.locator('.rbtn:has-text("Desde Office")').count() == 0, 'sin botón «Desde Office» fuera de Windows')
        await pg.close()
        # ---------- app de Windows (host simulado) ----------
        pg = await ctx.new_page(); errs.clear()
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
        await pg.add_init_script("window.__PDFS_NATIVE = { token: 'tok', version: '1.4.0' };")
        await pg.route('**/__native/**', native)
        await pg.goto(URL); await pg.wait_for_timeout(900)
        check(await pg.locator('.hcard:has-text("Desde Word, Excel o PowerPoint")').count() == 1, 'tarjeta de inicio para convertir desde Office')
        await pg.click('.rtab:has-text("Convertir")')
        check(await pg.locator('.rbtn:has-text("Desde Office")').count() == 1, 'botón «Desde Office» en la app de Windows')
        n = await pg.evaluate("async () => { await openBytes('Informe de carga ñ.docx', new Uint8Array([80, 75, 3, 4, 9, 9])); return [D().name, D().pages.length]; }")
        check(n == ['Informe de carga ñ.pdf', 3], f'convierte y abre el documento de Word como PDF {n}')
        check(calls and calls[-1][0] == 'Informe de carga ñ.docx' and calls[-1][1] == bytes([80, 75, 3, 4, 9, 9]), 'envía el archivo y su nombre al host')
        await pg.evaluate("async () => { const f = new File([new Uint8Array([1, 2, 3])], 'Liquidación.xlsx'); await openDroppedFiles([f]); }")
        await pg.wait_for_function("S.docs.length === 2")
        check(await pg.evaluate("D().name") == 'Liquidación.pdf', 'arrastrar y soltar una hoja de Excel')
        k = await pg.evaluate("async () => { const d = D(); const pages = await addFileToDoc(d, new Uint8Array([7]), 'Anexo.rtf'); d.pages.push(...pages); return d.pages.length; }")
        check(k == 6, 'insertar un documento de Office en un PDF abierto (combinar, expediente)')
        await pg.evaluate("async () => { const f = new File([new Uint8Array([1])], 'Presentación.pptx'); await openDroppedFiles([f]); }"); await pg.wait_for_timeout(400)
        t = await pg.locator('.toast').last.inner_text()
        check('PowerPoint o LibreOffice' in t and await pg.evaluate("S.docs.length") == 2, f'muestra el error del host sin abrir nada: {t[:70]}')
        acc = await pg.evaluate("async () => { const inp = document.querySelector('#file-input'); const p = pickFiles('local'); await new Promise(r => setTimeout(r, 50)); const a = inp.accept; inp.oncancel(); await p; return a; }")
        check('.docx' in acc and '.xlsx' in acc and '.pdf' in acc, 'el selector de archivos acepta documentos de Office')
        await pg.screenshot(path=os.path.join(OUT, 'office.png'))
        check(not errs, f'sin errores de JavaScript {errs[:3]}')
        await b.close()
    done()
asyncio.run(main())
