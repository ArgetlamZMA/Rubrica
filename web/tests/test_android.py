"""Interfaz Android simulada: Capacitor y el complemento nativo Rubrica se reemplazan por simulaciones."""
import asyncio, os, base64
from playwright.async_api import async_playwright
from pypdf import PdfReader
from common import check, done, URL, OUT

MOCK = r"""
(() => {
  const calls = window.__calls = [];
  const mkJpeg = (txt) => { const c = document.createElement('canvas'); c.width = 1240; c.height = 1754; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#111'; x.font = 'bold 64px Arial'; x.fillText(txt, 120, 200);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1]; };
  const plugin = {
    async getLaunchFiles() { calls.push('getLaunchFiles'); return { files: [] }; },
    addListener(n, cb) { calls.push('addListener:' + n); window.__recv = cb; return { remove() {} }; },
    async scan() { calls.push('scan'); return { pages: [{ data: mkJpeg('MANIFIESTO DE CARGA 001'), width: 1240, height: 1754 }, { data: mkJpeg('PAGINA DOS'), width: 1240, height: 1754 }] }; },
    async ocr(o) { calls.push('ocr'); return { width: 1240, height: 1754, text: 'MANIFIESTO DE CARGA 001', words: [ { t: 'MANIFIESTO', x: 120, y: 150, w: 420, h: 64 }, { t: 'DE', x: 560, y: 150, w: 90, h: 64 }, { t: 'CARGA', x: 670, y: 150, w: 230, h: 64 }, { t: '001', x: 920, y: 150, w: 130, h: 64 } ] }; },
    async saveAs(o) { calls.push('saveAs:' + o.name); window.__saved = o.data; return { uri: 'content://docs/escaneo.pdf', name: o.name }; },
    async write(o) { calls.push('write:' + o.uri); window.__saved = o.data; return { uri: o.uri }; },
    async share(o) { calls.push('share:' + o.name); return {}; },
    async print(o) { calls.push('print'); return {}; },
    async openDocument() { calls.push('openDocument'); const b = new Uint8Array(await (await fetch('/__t/texto.pdf')).arrayBuffer()); let s = ''; for (const v of b) s += String.fromCharCode(v);
      return { files: [{ uri: 'content://docs/texto.pdf', name: 'texto.pdf', mime: 'application/pdf', data: btoa(s) }] }; },
    async read(o) { return this.openDocument(); }
  };
  window.Capacitor = { isNativePlatform: () => true, registerPlugin: () => plugin, Plugins: { Rubrica: plugin } };
})();
"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 384, 'height': 824}, device_scale_factor=3, is_mobile=True, has_touch=True)
        await ctx.add_init_script(MOCK)
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        await pg.goto(URL); await pg.wait_for_timeout(1200)
        check(await pg.evaluate("document.body.classList.contains('android') && !!PSN"), 'detecta Android')
        check(await pg.locator('.hcard:has-text("Escanear documento")').count() == 1, 'tarjeta de escanear en inicio')
        check(await pg.locator('.hcard:has-text("Abrir de OneDrive")').count() == 0, 'oculta la nube integrada (usa el selector de Android)')
        await pg.screenshot(path=os.path.join(OUT, 'android_home.png'))
        await pg.tap('.hcard:has-text("Escanear documento")'); await pg.wait_for_timeout(2500)
        n = await pg.evaluate("D() && D().pages.length")
        check(n == 2, f'crea PDF de {n} páginas desde el escáner')
        check(await pg.evaluate("D().pages[0].ov.filter(o=>o.type==='ocrword').length") == 4, 'agrega la capa de texto OCR')
        await pg.screenshot(path=os.path.join(OUT, 'android_doc.png'))
        await pg.evaluate("runSearch('carga')"); await pg.wait_for_timeout(300)
        check(await pg.evaluate("SR.hits.length") == 2, 'busca texto en el escaneo')
        # guardar (Guardar como → selector de Android)
        await pg.evaluate("void saveDoc()"); await pg.wait_for_timeout(1500)
        calls = await pg.evaluate("__calls")
        check(any(c.startswith('saveAs:Escaneo') for c in calls), 'guarda con el selector de Android')
        pdf = base64.b64decode(await pg.evaluate("__saved")); path = os.path.join(OUT, 'android_scan.pdf'); open(path, 'wb').write(pdf)
        r = PdfReader(path)
        check(len(r.pages) == 2 and 'MANIFIESTO DE CARGA 001' in r.pages[0].extract_text(), 'PDF escaneado y buscable')
        check(abs(float(r.pages[0].mediabox.width) - 612) < 1, 'tamaño Carta')
        await pg.evaluate("D().pages[1].ov.push({id:uid(),type:'stamp',x:200,y:300,w:150,h:40,label:'RECIBIDO',color:'#d1242f',date:false}); D().setDirty(true)")
        await pg.evaluate("void saveDoc()"); await pg.wait_for_timeout(1200)
        check('write:content://docs/escaneo.pdf' in await pg.evaluate("__calls"), 'Guardar escribe sobre el mismo archivo')
        # compartir, abrir y botón atrás
        await pg.evaluate("void shareDoc()"); await pg.wait_for_timeout(1000)
        check(any(c.startswith('share:') for c in await pg.evaluate("__calls")), 'compartir')
        await pg.evaluate("void openLocal()"); await pg.wait_for_timeout(1500)
        check(await pg.evaluate("D().name") == 'texto.pdf' and await pg.evaluate("D().androidUri") == 'content://docs/texto.pdf', 'abre con el selector de Android')
        # hoja de propiedades: oculta sin selección, visible al seleccionar
        check(await pg.evaluate("$('#props').classList.contains('hidden')"), 'panel de propiedades oculto en teléfono')
        await pg.evaluate("const p=D().pages[0]; p.ov.push({id:'x1',type:'rect',x:60,y:300,w:150,h:80,color:'#d1242f',sw:2,fill:'',opacity:1}); selectObj(p.id,'x1')")
        await pg.wait_for_timeout(200)
        check(not await pg.evaluate("$('#props').classList.contains('hidden')"), 'hoja de propiedades al seleccionar')
        await pg.screenshot(path=os.path.join(OUT, 'android_sheet.png'))
        r1 = await pg.evaluate("pdfsBack()"); r2 = await pg.evaluate("pdfsBack()"); r3 = await pg.evaluate("pdfsBack()")
        check(r1 and r2 and await pg.evaluate("D() === null"), 'botón Atrás: deselecciona y vuelve al inicio')
        check(r3 is False or r3 is True, 'botón Atrás en inicio')
        # Fold desplegado (pantalla amplia)
        await pg.set_viewport_size({'width': 884, 'height': 800}); await pg.evaluate("activateDoc(S.docs[0])"); await pg.wait_for_timeout(800)
        await pg.screenshot(path=os.path.join(OUT, 'android_fold.png'))
        check(not errs, 'sin errores de JavaScript ' + str(errs[:3]))
        await b.close()
    done()

if __name__ == "__main__":
    asyncio.run(main())
