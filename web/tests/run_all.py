"""Compila nada: sirve web/dist con los archivos de prueba y ejecuta todas las pruebas.
Uso (desde /web, después de `npm run build`):  python tests/run_all.py"""
import http.server, os, shutil, subprocess, sys, threading, functools
HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.normpath(os.path.join(HERE, '..', 'dist'))
T = os.path.join(DIST, '__t')
if not os.path.exists(os.path.join(DIST, 'index.html')):
    sys.exit('Primero compile la interfaz: npm run build')
shutil.rmtree(T, ignore_errors=True); shutil.copytree(os.path.join(HERE, 'fixtures'), T)
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIST)
Handler.log_message = lambda *a, **k: None
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
code = 0
try:
    for t in (sys.argv[1:] or ['test_core.py', 'test_cloud.py', 'test_fonts_sign.py', 'test_sign_ui.py', 'test_sign_prefs.py', 'test_trust.py', 'test_ocr.py', 'test_android.py']):
        print(f'\n===== {t} =====', flush=True)
        r = subprocess.run([sys.executable, os.path.join(HERE, t)], cwd=HERE)
        code = code or r.returncode
finally:
    srv.shutdown(); shutil.rmtree(T, ignore_errors=True)
sys.exit(code)
