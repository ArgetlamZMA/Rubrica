// Genera dist/index.html (un solo archivo, funciona sin conexión) + archivos estáticos.
// Uso: npm ci && node build.mjs
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src'), OUT = path.join(ROOT, 'dist'), NM = path.join(ROOT, 'node_modules');
const rd = p => fs.readFileSync(p, 'utf8');
const safeJs = s => s.replaceAll('</script', '<\\/script').replaceAll('<!--', '<\\!--');
const pkg = JSON.parse(rd(path.join(ROOT, 'package.json')));
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const jsDir = path.join(SRC, 'js');
let js = fs.readdirSync(jsDir).filter(f => f.endsWith('.js')).sort().map(f => `/* ---- ${f} ---- */\n` + rd(path.join(jsDir, f))).join('\n');
js = `const APP_VERSION = ${JSON.stringify(pkg.version)};\n` + js;
// íconos Lucide referenciados en el código
const iconDir = path.join(NM, 'lucide-static', 'icons');
const names = new Set(['square']);
for (const m of js.matchAll(/'([a-z][a-z0-9-]*)'/g)) if (fs.existsSync(path.join(iconDir, m[1] + '.svg'))) names.add(m[1]);
const icons = {};
for (const n of [...names].sort()) { const svg = rd(path.join(iconDir, n + '.svg')); icons[n] = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1].replace(/\s+/g, ' ').trim(); }
const parts = {
  '/*__CSS__*/': rd(path.join(SRC, 'app.css')),
  '/*__PDFJS_WORKER__*/': safeJs(rd(path.join(NM, 'pdfjs-dist/build/pdf.worker.min.js'))),
  '/*__PDFJS__*/': safeJs(rd(path.join(NM, 'pdfjs-dist/build/pdf.min.js'))),
  '/*__PDFLIB__*/': safeJs(rd(path.join(NM, '@cantoo/pdf-lib/dist/pdf-lib.min.js'))),
  '/*__JSZIP__*/': safeJs(rd(path.join(NM, 'jszip/dist/jszip.min.js'))),
  '/*__FONTKIT__*/': safeJs(rd(path.join(NM, '@cantoo/fontkit/dist/fontkit.umd.min.js'))),
  '/*__FORGE__*/': safeJs(rd(path.join(NM, 'node-forge/dist/forge.min.js'))),
  '/*__ICONS__*/': 'const ICONS = ' + JSON.stringify(icons) + ';',
  '/*__APP__*/': safeJs(js),
};
let html = rd(path.join(SRC, 'template.html'));
for (const [k, v] of Object.entries(parts)) { if (!html.includes(k)) throw new Error('Falta marcador ' + k); html = html.split(k).join(v); }
fs.writeFileSync(path.join(OUT, 'index.html'), html);
for (const f of fs.readdirSync(path.join(ROOT, 'static'))) fs.copyFileSync(path.join(ROOT, 'static', f), path.join(OUT, f));
console.log(`dist/index.html ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB · ${Object.keys(icons).length} íconos · v${pkg.version}`);
