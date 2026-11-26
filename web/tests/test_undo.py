"""Historial de deshacer: correcto, compartido entre pasos y con límite de memoria."""
import asyncio, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
from common import launch, open_fixture, check, done, URL

async def main():
    async with async_playwright() as p:
        b, ctx, pg, errs = await launch(p)
        await pg.goto(URL); await pg.wait_for_timeout(800)
        await open_fixture(pg, 'texto.pdf'); await pg.wait_for_timeout(600)
        # documento grande simulado: 120 páginas con 1500 palabras de OCR cada una (~25 MB de objetos)
        r = await pg.evaluate("""() => {
          const d = D(), base = d.pages[0], pages = [];
          for (let i = 0; i < 120; i++) {
            const ov = []; for (let k = 0; k < 1500; k++) ov.push({ id: 'w' + i + '_' + k, type: 'ocrword', t: 'palabra' + k, x: k % 50 * 11, y: Math.floor(k / 50) * 24, w: 10, h: 12 });
            pages.push({ ...structuredClone(base), id: 'pg' + i, ov });
          }
          d.pages = pages; d.undo = []; d.redo = [];
          const t0 = performance.now();
          for (let s = 0; s < 40; s++) { d.checkpoint(); d.pages[s % 120].ov.push({ id: 'n' + s, type: 'rect', x: s, y: s, w: 20, h: 20, stroke: '#f00' }); }
          const ms = (performance.now() - t0) / 40;
          const total = d.undo.reduce((a, x) => a + x.bytes, 0), first = d.undo[0].bytes;
          // las páginas que no cambiaron son la misma cadena en todas las instantáneas
          const shared = d.undo[1].pages[100] === d.undo[39].pages[100];
          return { total, first, ms, shared, n: d.undo.length };
        }""")
        check(r['shared'], 'las páginas sin cambios se comparten entre instantáneas')
        check(r['total'] < r['first'] * 1.5, f"40 pasos ocupan poco más que uno (solo la página cambiada) ({r['first']/1e6:.1f} MB el primero, {r['total']/1e6:.1f} MB en total; antes ≈ {r['first']*40/1e6:.0f} MB)")
        check(r['ms'] < 400, f"cada paso tarda {r['ms']:.0f} ms")
        # deshacer y rehacer devuelven exactamente el estado
        ok = await pg.evaluate("""() => {
          const d = D(), states = [];
          d.undo = []; d.redo = [];
          for (let s = 0; s < 6; s++) { states.push(JSON.stringify(d.pages)); d.checkpoint(); d.pages[s].ov.push({ id: 'z' + s, type: 'text', text: 'Línea ' + s, x: 10, y: 10, w: 80, h: 14, size: 12, color: '#000' }); if (s === 3) d.pages.splice(5, 1); }
          const end = JSON.stringify(d.pages);
          for (let s = 5; s >= 0; s--) { undo(); if (JSON.stringify(D().pages) !== states[s]) return 'undo ' + s; }
          for (let s = 0; s < 6; s++) redo();
          return JSON.stringify(D().pages) === end ? 'ok' : 'redo';
        }""")
        check(ok == 'ok', f'deshacer y rehacer restauran el documento exacto ({ok})')
        # valores que JSON no conserva: se copian completos, sin perder nada
        ok2 = await pg.evaluate("""() => {
          const d = D(); d.undo = []; d.redo = [];
          d.pages[0].ov.push({ id: 'ta', type: 'rect', x: 5, y: 5, w: 10, h: 10, extra: new Float32Array([1.5, 2.5, 3.5]), lim: Infinity });
          d.checkpoint(); d.pages[0].ov.pop(); undo();
          const o = D().pages[0].ov.at(-1); return o.extra instanceof Float32Array && o.extra[2] === 3.5 && o.lim === Infinity;
        }""")
        check(ok2, 'objetos con datos binarios o valores especiales se restauran intactos')
        # límite de memoria: el historial descarta lo más antiguo
        lim = await pg.evaluate("""() => {
          const d = D(); d.undo = []; d.redo = [];
          for (let s = 0; s < 8; s++) { d.pages.forEach(p => p.ov.push({ id: 'm' + s + p.id, type: 'rect', x: 1, y: 1, w: 1, h: 1 })); d.checkpoint(); }
          return [d.undo.length, d.undo.reduce((a, x) => a + x.bytes, 0) <= UNDO_MAX_BYTES];
        }""")
        check(lim[1] and lim[0] < 8, f'con cambios en todas las páginas, el historial respeta el límite de memoria ({lim[0]} pasos guardados)')
        check(await pg.evaluate("(() => { const d = D(); d.undo = []; for (let s = 0; s < 130; s++) d.checkpoint(); return d.undo.length; })()") == 100, 'máximo 100 pasos')
        check(not errs, f'sin errores de JavaScript {errs[:3]}')
        await b.close()
    done()
asyncio.run(main())
