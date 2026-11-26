"""Utilidades compartidas por las pruebas de la interfaz."""
import asyncio, base64, os, sys
from playwright.async_api import async_playwright

URL = os.environ.get('PDFS_URL', 'http://localhost:8765/')
OUT = os.environ.get('OUT') or os.path.join(os.path.dirname(__file__), '..', 'test-output')
os.makedirs(OUT, exist_ok=True)
# la consola de Windows (cp1252) no puede mostrar todos los caracteres: que nunca haga fallar una prueba
try: sys.stdout.reconfigure(errors='replace'); sys.stderr.reconfigure(errors='replace')
except Exception: pass
FAILS = []

def check(cond, msg):
    print(('  ok   ' if cond else '  FALLO ') + msg)
    if not cond:
        FAILS.append(msg)

def done():
    if FAILS:
        print(f'\n{len(FAILS)} comprobación(es) fallaron'); sys.exit(1)
    print('\nTodas las comprobaciones pasaron')

EXPORT = """async (opts) => { const bytes = await buildPdf(D(), opts || {}); let s=''; for (let i=0;i<bytes.length;i+=32768) s+=String.fromCharCode(...bytes.subarray(i,i+32768)); return btoa(s); }"""

def save_b64(name, b64):
    path = os.path.join(OUT, name)
    with open(path, 'wb') as f:
        f.write(base64.b64decode(b64))
    return path

async def launch(p):
    exe = os.environ.get('CHROME') or None
    b = await p.chromium.launch(executable_path=exe, args=['--no-sandbox'])
    ctx = await b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True, locale='es-HN')
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'favicon' not in m.text else None)
    # La app declara una política CSP sin 'unsafe-eval'; page.wait_for_function de Playwright compila la condición
    # dentro de la página y la política lo bloquea. Se sustituye por una espera que consulta desde fuera, para que
    # todas las pruebas corran con la política activa (y cualquier infracción de la app aparezca como error).
    async def wait_for_function(expression, arg=None, timeout=30000, polling=None):
        loop = asyncio.get_running_loop(); end = loop.time() + (timeout or 30000) / 1000
        while True:
            v = await pg.evaluate(expression, arg)
            if v: return v
            if loop.time() > end: raise TimeoutError(f'wait_for_function: {expression[:80]}')
            await asyncio.sleep(0.1)
    pg.wait_for_function = wait_for_function
    return b, ctx, pg, errs

async def open_fixture(pg, name, as_name=None):
    return await pg.evaluate("""async ([f, n]) => { const b = new Uint8Array(await (await fetch('/__t/' + f)).arrayBuffer()); await openBytes(n || f, b); return D().pages.length; }""", [name, as_name])
