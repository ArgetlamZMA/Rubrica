"""OneDrive y Google Drive con las API simuladas (no requiere cuentas reales)."""
import asyncio, os, re
from playwright.async_api import async_playwright
from common import launch, check, done, URL, OUT

PDF = open(os.path.join(os.path.dirname(__file__), 'fixtures', 'texto.pdf'), 'rb').read()
calls = []

async def graph(route):
    req = route.request; u = req.url; calls.append(req.method + ' ' + u.split('?')[0])
    if u.split('?')[0].endswith('/me'): return await route.fulfill(json={'mail': 'usuario@empresa.com'})
    if '/children' in u and req.method == 'GET':
        return await route.fulfill(json={'value': [
            {'id': 'F1', 'name': 'Aduanas', 'folder': {'childCount': 2}, 'parentReference': {'driveId': 'D1', 'id': 'root'}},
            {'id': 'A1', 'name': 'Factura 1000.pdf', 'size': len(PDF), 'file': {'mimeType': 'application/pdf'}, 'parentReference': {'driveId': 'D1', 'id': 'root'}}]})
    if re.search(r'/items/A1$', u.split('?')[0]): return await route.fulfill(json={'id': 'A1', 'name': 'Factura 1000.pdf', '@microsoft.graph.downloadUrl': 'https://dl.example.com/a1'})
    if req.method == 'PUT': return await route.fulfill(json={'id': 'A1', 'name': 'Factura 1000.pdf', 'parentReference': {'driveId': 'D1', 'id': 'root'}, 'file': {}})
    return await route.fulfill(status=404, json={'error': {'message': 'sin simulación'}})

async def gapi(route):
    req = route.request; u = req.url; calls.append(req.method + ' ' + u.split('?')[0])
    if 'about' in u: return await route.fulfill(json={'user': {'emailAddress': 'usuario@gmail.com'}})
    if '/upload/' in u: return await route.fulfill(json={'id': 'G2', 'name': 'Copia.pdf', 'mimeType': 'application/pdf', 'parents': ['root']})
    if u.split('?')[0].endswith('/files'): return await route.fulfill(json={'files': [{'id': 'G1', 'name': 'Manifiesto.pdf', 'mimeType': 'application/pdf', 'size': str(len(PDF)), 'parents': ['root']}]})
    return await route.fulfill(status=404, json={})

async def main():
    async with async_playwright() as p:
        b, ctx, pg, errs = await launch(p)
        await ctx.route('https://graph.microsoft.com/**', graph)
        await ctx.route('https://dl.example.com/**', lambda r: r.fulfill(body=PDF, headers={'content-type': 'application/pdf', 'access-control-allow-origin': '*'}))
        await ctx.route('https://www.googleapis.com/**', gapi)
        await pg.goto(URL); await pg.wait_for_timeout(800)
        await pg.evaluate("""() => { S.settings.msClientId='abc'; S.settings.gClientId='g.apps'; saveSettings();
           store.set('tok.ms',{access:'T',refresh:'R',exp:Date.now()+3e6,user:'usuario@empresa.com'}); store.set('tok.g',{access:'G',exp:Date.now()+3e6,user:'usuario@gmail.com'}); updateCloudStatus(); renderHome(); }""")
        await pg.click('.hcard:has-text("Abrir de OneDrive")'); await pg.wait_for_selector('.cb-row')
        await pg.dblclick('.cb-row:has-text("Factura 1000.pdf")'); await pg.wait_for_timeout(1500)
        check(await pg.evaluate("D()?.cloud?.provider") == 'onedrive', 'abre desde OneDrive')
        await pg.evaluate("D().pages[0].ov.push({id:uid(),type:'stamp',x:300,y:300,w:150,h:40,label:'PAGADO',color:'#d1242f',date:false}); D().setDirty(true)")
        await pg.keyboard.press('Control+s'); await pg.wait_for_timeout(1500)
        check(any(c.startswith('PUT') and c.endswith('/items/A1/content') for c in calls) and not await pg.evaluate('D().dirty'), 'guarda de vuelta en OneDrive')
        await pg.evaluate("void saveDoc(D(), true)"); await pg.wait_for_selector('.modal .hcard')
        await pg.click('.modal .hcard:has-text("Google Drive")'); await pg.wait_for_selector('.cb-row')
        await pg.fill('.modal-f input', 'Copia'); await pg.click('.modal-f .btn.primary'); await pg.wait_for_timeout(1500)
        check(await pg.evaluate("D().cloud.provider") == 'gdrive' and await pg.evaluate("D().name") == 'Copia.pdf', 'guarda como en Google Drive')
        check(not errs, 'sin errores de JavaScript ' + str(errs[:3]))
        await b.close()
    done()

asyncio.run(main())
