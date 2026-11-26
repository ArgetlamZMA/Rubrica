"""Accesibilidad (WCAG 2.1 AA con axe-core), teclado, lectura en voz alta y tamaño de la interfaz."""
import asyncio, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
from common import launch, open_fixture, check, done, URL, OUT

AXE = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'node_modules', 'axe-core', 'axe.min.js'), encoding='utf-8').read()
# motor de voz simulado: Chrome sin interfaz no trae voces
FAKE_TTS = """
window.__spoken = [];
const fake = { speaking: false, paused: false, _u: null,
  getVoices: () => [{ name: 'Voz de prueba', lang: 'es-ES', default: true, localService: true, voiceURI: 'x' }],
  speak(u) { this.speaking = true; this._u = u; window.__spoken.push(u.text); setTimeout(() => { if (this._u === u) { this.speaking = false; u.onend && u.onend(); } }, 40); },
  cancel() { const u = this._u; this._u = null; this.speaking = false; u && u.onend && u.onend(); }, pause() { this.paused = true; }, resume() { this.paused = false; }, onvoiceschanged: null };
Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
"""

async def axe(pg, label, bad):
    if not await pg.evaluate("typeof axe !== 'undefined'"):
        # la política CSP de la app no deja insertar scripts: se carga axe por el protocolo de DevTools
        cdp = await pg.context.new_cdp_session(pg); await cdp.send('Runtime.evaluate', {'expression': AXE}); await cdp.detach()
    v = await pg.evaluate("async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map(v => v.id + ' ' + v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | '))")
    if v: bad.append(f'{label}: {v}')

async def main():
    async with async_playwright() as p:
        b, ctx, pg, errs = await launch(p)
        await pg.add_init_script(FAKE_TTS)
        await pg.goto(URL); await pg.wait_for_timeout(800)
        bad = []
        await axe(pg, 'inicio', bad)
        await open_fixture(pg, 'texto.pdf', 'Factura.pdf'); await pg.wait_for_timeout(700)
        for theme in ('', 'dark'):
            await pg.evaluate(f"document.documentElement.classList.toggle('dark', {str(theme == 'dark').lower()})")
            for t in ['Inicio', 'Comentar', 'Editar', 'Organizar', 'Convertir', 'Formulario', 'Proteger']:
                await pg.click(f'.rtab:has-text("{t}")'); await pg.wait_for_timeout(100); await axe(pg, f'{theme or "claro"} {t}', bad)
        await pg.evaluate("document.documentElement.classList.remove('dark')")
        for side in ['thumbs', 'bookmarks', 'comments', 'signatures', 'search']:
            await pg.evaluate(f"S.side = '{side}'; S.sideOpen = true; renderSide()"); await pg.wait_for_timeout(300); await axe(pg, 'panel ' + side, bad)
        for dlg in ['settingsDialog', 'digitalSignDialog', 'batchDialog', 'dossierDialog', 'extractDialog', 'compareDialog', 'sanitizeDialog', 'studySummaryDialog', 'fitSizeDialog']:
            await pg.evaluate(f"() => {{ {dlg}(); }}"); await pg.wait_for_selector('.modal'); await pg.wait_for_timeout(300)
            await axe(pg, 'diálogo ' + dlg, bad)
            while await pg.locator('.modal').count(): await pg.keyboard.press('Escape'); await pg.wait_for_timeout(120)
        check(not bad, f'sin infracciones WCAG 2.1 AA en inicio, cinta (claro y oscuro), paneles y {9} diálogos {bad[:3]}')
        # teclado: pestañas de la cinta con flechas
        await pg.focus('.rtab[aria-selected="true"]'); first = await pg.evaluate("document.activeElement.textContent")
        await pg.keyboard.press('ArrowRight'); nxt = await pg.evaluate("[document.activeElement.textContent, document.activeElement.getAttribute('aria-selected'), document.activeElement.getAttribute('role')]")
        check(nxt[0] != first and nxt[1] == 'true' and nxt[2] == 'tab', f'flechas entre pestañas de la cinta: {first} → {nxt[0]}')
        # ventanas: el foco no se escapa y vuelve al botón que la abrió
        await pg.click('.rtab:has-text("Inicio")'); opener = pg.locator('.rbtn:has-text("Propiedades")')
        await opener.focus(); await pg.keyboard.press('Enter'); await pg.wait_for_selector('.modal[role="dialog"][aria-modal="true"]')
        inside = []
        for _ in range(25): await pg.keyboard.press('Tab'); inside.append(await pg.evaluate("!!document.activeElement.closest('.modal')"))
        check(all(inside), 'Tab no sale de la ventana abierta')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(150)
        check(await pg.evaluate("document.activeElement && document.activeElement.textContent.includes('Propiedades')"), 'al cerrar, el foco vuelve al botón que la abrió')
        # leer en voz alta
        await pg.evaluate("goToPage(0)")
        await pg.click('.rbtn:has-text("Leer en voz alta")'); await pg.wait_for_selector('.tts-bar')
        await pg.wait_for_function("window.__spoken.length >= 2", timeout=10000)
        hl = await pg.locator('.tts-hl').count()
        spoken = await pg.evaluate("window.__spoken.slice()")
        check(spoken[0].startswith('Factura comercial No. 1000') and hl > 0, f'lee oración por oración y resalta lo que lee: {spoken[:2]}')
        await pg.wait_for_function("window.__spoken.some(t => /Factura comercial No. 1001/.test(t))", timeout=20000)
        check(await pg.evaluate("D().cur") >= 1, 'sigue en la página siguiente')
        await pg.screenshot(path=os.path.join(OUT, 'leer_voz.png'))
        await pg.keyboard.press('Control+Shift+Y'); await pg.wait_for_timeout(150)
        n = await pg.evaluate("window.__spoken.length"); await pg.wait_for_timeout(500)
        check(await pg.evaluate("TTS.paused") and await pg.evaluate("window.__spoken.length") <= n + 1, 'Ctrl+Mayús+Y pausa la lectura')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
        check(await pg.locator('.tts-bar').count() == 0 and await pg.locator('.tts-hl').count() == 0, 'Esc detiene la lectura y quita el resaltado')
        # solo el texto seleccionado
        await pg.evaluate("window.__spoken = []; goToPage(0)"); await pg.wait_for_timeout(300)
        await pg.evaluate("""() => { const span = [...document.querySelectorAll('.page .textLayer span')].find(s => s.textContent.includes('Cliente')); const r = document.createRange(); r.selectNodeContents(span); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }""")
        await pg.evaluate("readAloud()"); await pg.wait_for_timeout(600)
        sel = await pg.evaluate("window.__spoken.slice()")
        check(' '.join(sel) == 'Cliente: Inversiones de Prueba S.A. de C.V.', f'con texto seleccionado, lee solo eso: {sel}')
        await pg.evaluate("ttsStop()")
        # tamaño de la interfaz: menús más grandes, el documento igual
        w0 = await pg.evaluate("document.querySelector('#pages .page').getBoundingClientRect().width"); h0 = await pg.evaluate("document.querySelector('#ribbon').getBoundingClientRect().height")
        await pg.evaluate("S.settings.uiScale = 1.3; applyUiScale()"); await pg.wait_for_timeout(400)
        h1 = await pg.evaluate("document.querySelector('#ribbon').getBoundingClientRect().height"); w1 = await pg.evaluate("document.querySelector('#pages .page').getBoundingClientRect().width")
        check(h1 > h0 * 1.2, f'la cinta crece con el tamaño de la interfaz ({h0:.0f} → {h1:.0f} px)')
        await pg.screenshot(path=os.path.join(OUT, 'interfaz_130.png'))
        await pg.evaluate("S.settings.uiScale = 1; applyUiScale()")
        check(abs(w1 - w0) / w0 < 0.35, f'el documento conserva su propio zoom ({w0:.0f} / {w1:.0f} px)')
        check(not errs, f'sin errores de JavaScript {errs[:3]}')
        await b.close()
    done()
asyncio.run(main())
