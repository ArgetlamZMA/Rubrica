"""Política de seguridad de contenido (CSP): bloquea código inyectado y no rompe lo propio (PDF.js, OCR, ventanas)."""
import asyncio, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
from common import launch, open_fixture, check, done, URL

WATCH = "window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + (e.blockedURI || 'inline')));"

async def main():
    async with async_playwright() as p:
        b, ctx, pg, errs = await launch(p)
        await pg.add_init_script(WATCH)
        await pg.goto(URL); await pg.wait_for_timeout(800)
        csp = await pg.evaluate("document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]')?.content || ''")
        check("object-src blob:" in csp and "base-uri 'none'" in csp and "'unsafe-inline'" not in csp.split('script-src')[1].split(';')[0] and "'unsafe-eval'" not in csp,
              'CSP presente: scripts solo por hash, sin unsafe-inline ni unsafe-eval en script-src')
        check(await pg.evaluate("(() => { const m = document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]'), s = [...document.scripts].find(x => x.type !== 'text/plain'); return !!(m.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING); })()"),
              'la política se declara antes del primer script')
        check(await pg.evaluate("window.__csp.length") == 0, f'la app arranca sin infracciones {await pg.evaluate("window.__csp")}')
        # un texto con HTML que llegara a insertarse en la página no ejecuta nada
        # se ejecuta desde un temporizador, como código de la página (DevTools permite eval en sus propias evaluaciones)
        await pg.evaluate("""() => setTimeout(() => {
          window.__pwn = [];
          document.body.insertAdjacentHTML('beforeend', '<img id="x1" src="data:," onerror="__pwn.push(1)"><a id="x2" href="javascript:__pwn.push(2)">x</a>');
          const s = document.createElement('script'); s.textContent = '__pwn.push(3)'; document.body.append(s);
          try { new Function('__pwn.push(4)')(); } catch { }
          try { eval('__pwn.push(5)'); } catch { }
          try { setTimeout('__pwn.push(6)', 0); } catch { }
          const s2 = document.createElement('script'); s2.src = 'data:text/javascript,__pwn.push(7)'; document.body.append(s2);
          document.getElementById('x2').click();
        }, 0)""")
        await pg.wait_for_timeout(600)
        check(await pg.evaluate("window.__pwn.length === 0"), f'código inyectado no se ejecuta (atributos on*, script en línea, eval, Function, setTimeout con texto, data:, javascript:) {await pg.evaluate("window.__pwn")}')
        check(await pg.evaluate("window.__csp.length") >= 4, f'el navegador informa los bloqueos ({await pg.evaluate("window.__csp.length")})')
        await pg.evaluate("window.__csp = []; document.querySelectorAll('#x1, #x2').forEach(e => e.remove())")
        errs.clear()
        # lo propio sigue funcionando: PDF.js (trabajador blob:), fuentes, miniaturas, OCR (trabajador + WebAssembly), guardar
        await open_fixture(pg, 'texto.pdf'); await pg.wait_for_timeout(1000)
        check(await pg.evaluate("document.querySelectorAll('#pages .page canvas').length") > 0 and await pg.evaluate("document.querySelectorAll('.page .textLayer span').length") > 0, 'PDF.js dibuja la página y su texto')
        txt = await pg.evaluate("""async () => { const c = document.createElement('canvas'); c.width = 900; c.height = 220; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 900, 220); g.fillStyle = '#000'; g.font = 'bold 64px sans-serif'; g.fillText('ADUANA 2026', 60, 140);
          const w = await ocrWorker('spa'); const r = await w.recognize(c); return r.data.text; }""")
        check('ADUANA' in txt.upper(), f'OCR funciona con la política activa ({txt.strip()!r})')
        n = await pg.evaluate("async () => (await buildPdf(D())).length")
        check(n > 1000, 'genera el PDF al guardar')
        await pg.evaluate("() => { settingsDialog(); }"); await pg.wait_for_selector('.modal'); await pg.keyboard.press('Escape')
        check(await pg.evaluate("window.__csp.length") == 0, f'sin infracciones al usar la app {await pg.evaluate("window.__csp")}')
        # contraseña del servidor de marca de tiempo: cifrada, nunca en texto claro
        await pg.evaluate("S.settings.tsaServers = [{ id: 'tx', name: 'TSA privada', url: 'https://tsa.prueba.invalid/tsa', user: 'zma', pass: 'Secreto-ñ-2026' }]; saveSettings()")
        await pg.evaluate("migrateSecrets()"); await pg.wait_for_timeout(300)
        stored = await pg.evaluate("JSON.stringify(Object.fromEntries(Object.entries(localStorage)))")
        enc = await pg.evaluate("S.settings.tsaServers[0].passEnc || ''")
        check('Secreto' not in stored and enc.startswith('wc:') and 'pass' not in await pg.evaluate("Object.keys(S.settings.tsaServers[0])"),
              f'la contraseña que estaba en texto claro se cifra al arrancar ({enc[:12]}…)')
        check(await pg.evaluate("tsaPassword(S.settings.tsaServers[0])") == 'Secreto-ñ-2026', 'se descifra para usarla')
        seen = []
        async def tsa_route(route):
            seen.append(route.request.headers.get('authorization', '')); await route.fulfill(status=500, body='x')
        await pg.route('https://tsa.prueba.invalid/**', tsa_route)
        await pg.evaluate("async () => { try { await tsaSend(S.settings.tsaServers[0], new Uint8Array([1])); } catch { } }")
        import base64
        check(seen == ['Basic ' + base64.b64encode('zma:Secreto-ñ-2026'.encode()).decode()], f'se envía al servidor solo en la conexión ({seen})')
        # editar el servidor sin escribir la contraseña la conserva; el diálogo nunca la muestra
        await pg.evaluate("() => { signPrefsDialog('tsa'); }"); await pg.wait_for_selector('.modal'); await pg.wait_for_timeout(300)
        await pg.click('.modal button:has-text("Editar")'); await pg.wait_for_timeout(300)
        pw = pg.locator('.modal input[type=password]').last
        check(await pw.input_value() == '' and 'guardada' in (await pw.get_attribute('placeholder') or ''), 'el diálogo no muestra la contraseña guardada')
        await pg.locator('.modal').last.locator('button.primary, button:has-text("Aceptar"), button:has-text("Guardar")').first.click(); await pg.wait_for_timeout(400)
        check(await pg.evaluate("tsaPassword(S.settings.tsaServers[0])") == 'Secreto-ñ-2026' and await pg.evaluate("S.settings.tsaServers[0].passEnc") == enc, 'al guardar sin cambiarla, se conserva')
        while await pg.locator('.modal').count(): await pg.keyboard.press('Escape'); await pg.wait_for_timeout(120)
        # un valor de otro equipo (DPAPI de Windows) no se puede usar aquí: aviso claro, sin enviar nada
        await pg.evaluate("S.settings.tsaServers[0].passEnc = 'dpapi:AQAAANCMnd8='")
        msg = await pg.evaluate("async () => { try { await tsaSend(S.settings.tsaServers[0], new Uint8Array([1])); return 'enviado'; } catch (e) { return e.message; } }")
        check('Preferencias de firma' in msg and len(seen) == 1, f'contraseña de otro equipo: aviso claro y no se envía ({msg})')
        errs[:] = [e for e in errs if 'status of 500' not in e]  # respuesta simulada del servidor de prueba
        check(not errs, f'sin errores de JavaScript {errs[:3]}')
        await b.close()
    done()
asyncio.run(main())
