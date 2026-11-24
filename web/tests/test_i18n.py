"""Idiomas de la interfaz: inglés y portugués, regreso a español y contenido del PDF sin traducir."""
import asyncio, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
from common import launch, open_fixture, check, done, URL, OUT

async def main():
    async with async_playwright() as p:
        b, ctx, pg, errs = await launch(p)
        await pg.goto(URL); await pg.wait_for_timeout(800)
        await open_fixture(pg, 'texto.pdf'); await pg.wait_for_timeout(1200)
        await pg.evaluate("() => { S.settings.lang = 'en'; applyLang('en'); renderRibbon(); renderSide(); renderProps(); }"); await pg.wait_for_timeout(500)
        tabs = ' '.join(await pg.locator('.rtab').all_inner_texts()); rib = await pg.locator('#ribbon').inner_text()
        check('Home' in tabs and 'Protect' in tabs and 'Organize' in tabs and 'Save as' in rib and 'Inicio' not in tabs, 'cinta en inglés')
        check(await pg.evaluate("document.documentElement.lang") == 'en', 'atributo lang del documento')
        check(await pg.evaluate("LOC()") == 'en-US', 'fechas con formato regional del idioma')
        txt = await pg.evaluate("[...document.querySelectorAll('#viewer .textLayer span')].map(s => s.textContent).join(' ')")
        check('Cantidad' in txt, 'el texto del PDF no se traduce («Cantidad» sigue igual)')
        await pg.screenshot(path=os.path.join(OUT, 'interfaz_en.png'))
        # diálogos y avisos que se crean después
        await pg.evaluate("() => { digitalSignDialog(); }"); await pg.wait_for_selector('.modal'); await pg.wait_for_timeout(400)
        t = await pg.locator('.modal').inner_text()
        check('Sign as' in t and 'Timestamp' in t and 'Appearance' in t and 'Cancel' in t, 'diálogo de firma en inglés')
        await pg.screenshot(path=os.path.join(OUT, 'firma_en.png'))
        await pg.keyboard.press('Escape'); await pg.click('.modal .btn:has-text("Cancel")') if await pg.locator('.modal').count() else None
        await pg.evaluate("() => toast(`Este documento tiene 3 firma(s) digital(es). Revíselas en el panel «Firmas».`)"); await pg.wait_for_timeout(300)
        check('This document has 3 digital signature(s)' in await pg.locator('body').inner_text(), 'textos con valores variables')
        # portugués
        await pg.evaluate("() => { applyLang('pt'); renderRibbon(); }"); await pg.wait_for_timeout(300)
        tabs = ' '.join(await pg.locator('.rtab').all_inner_texts()); rib = await pg.locator('#ribbon').inner_text()
        check('Início' in tabs and 'Organizar' in tabs and 'Salvar como' in rib, 'cinta en portugués')
        await pg.evaluate("() => { shortcutsDialog(); }"); await pg.wait_for_selector('.modal')
        t = await pg.locator('.modal').inner_text()
        check('Atalhos de teclado' in t and 'Ctrl+Shift+S' in t and 'Salvar como' in t, 'lista de atalhos en portugués')
        await pg.screenshot(path=os.path.join(OUT, 'atajos_pt.png'))
        await pg.keyboard.press('Escape')
        # de vuelta a español: se restauran los textos originales
        await pg.evaluate("() => { applyLang('es'); }"); await pg.wait_for_timeout(300)
        tabs = ' '.join(await pg.locator('.rtab').all_inner_texts()); rib = await pg.locator('#ribbon').inner_text()
        check('Inicio' in tabs and 'Guardar como' in rib and 'Home' not in tabs and 'Início' not in tabs, 'regresa a español sin recargar')
        # automático: idioma del sistema (el navegador de prueba usa en-US)
        check(await pg.evaluate("resolveLang('auto')") == 'es', 'idioma automático: el del sistema (es-HN)')
        check(await pg.evaluate("tr('Guardar')") == 'Guardar', 'en español no traduce')
        check(not errs, str(errs[:3]))
        await b.close()
    done()
asyncio.run(main())
