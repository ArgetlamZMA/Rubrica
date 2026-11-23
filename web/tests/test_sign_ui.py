"""Flujo completo de firma digital desde la interfaz: certificado, recuadro y guardado."""
import asyncio, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
from common import launch, open_fixture, check, done, URL, OUT
async def main():
    async with async_playwright() as p:
        b, ctx, pg, errs = await launch(p)
        await pg.goto(URL); await pg.wait_for_timeout(800)
        await pg.evaluate("delete window.showSaveFilePicker; window.showSaveFilePicker = undefined;")
        await open_fixture(pg, 'texto.pdf'); await pg.wait_for_timeout(800)
        await pg.click('.rtab:has-text("Proteger")'); await pg.click('.rbtn:has-text("Firma digital")'); await pg.wait_for_selector('.modal')
        async with pg.expect_file_chooser() as fc:
            await pg.click('.modal .btn:has-text("Elegir .p12")')
        await (await fc.value).set_files(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'modern.p12'))
        await pg.fill('.modal input[type=password]', 'Clave123')
        await pg.click('.modal .btn:has-text("Verificar certificado")'); await pg.wait_for_timeout(300)
        await pg.screenshot(path=os.path.join(OUT, 'sigdlg.png'))
        await pg.click('.modal .btn.primary:has-text("Continuar")'); await pg.wait_for_timeout(300)
        box = await pg.locator('.page').first.bounding_box(); s = await pg.evaluate('D().scale')
        P = lambda x, y: (box['x'] + x * s, box['y'] + y * s)
        await pg.mouse.move(*P(350, 600)); await pg.mouse.down(); await pg.mouse.move(*P(560, 670), steps=5); await pg.mouse.up()
        await pg.wait_for_selector('.modal .hcard')
        async with pg.expect_download() as dl:
            await pg.click('.modal .hcard:has-text("Este equipo")')
        d = await dl.value; await d.save_as(os.path.join(OUT, 'ui_signed.pdf'))
        await pg.wait_for_timeout(1500)
        check(await pg.evaluate("Object.values(D().sources)[0].sigs.length") == 1, 'documento recargado con la firma')
        await pg.screenshot(path=os.path.join(OUT, 'sigui.png'))
        check(not errs, str(errs[:3]))
        await b.close()
    done()
asyncio.run(main())
