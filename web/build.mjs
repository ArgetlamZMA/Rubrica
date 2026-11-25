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
// Traducciones de la interfaz (src/i18n/ui.tsv: es → en, pt), clave = texto en español
const tsv = fs.readFileSync(path.join(ROOT, 'src', 'i18n', 'ui.tsv'), 'utf8').split(/\r?\n/).filter(Boolean).map(l => l.split('\t'));
const [head, ...rows] = tsv, dict = {};
head.slice(1).forEach((lang, i) => { dict[lang] = {}; for (const r of rows) if (r[i + 1] && r[i + 1] !== r[0]) dict[lang][r[0]] = r[i + 1]; });
js = `const APP_VERSION = ${JSON.stringify(pkg.version)};\nconst I18N_DICT = ${JSON.stringify(dict)};\n// perfil sRGB (LittleCMS) para el «output intent» de PDF/A\nconst SRGB_ICC_B64 = ${JSON.stringify(fs.readFileSync(path.join(ROOT, 'src/assets/srgb.icc')).toString('base64'))};\n` + js;
// todos los archivos comparten un ámbito global: un nombre declarado dos veces rompería la app al abrirla.
// Se compila el código unido para detectarlo aquí y no en el equipo del usuario.
try { new Function(js); } catch (e) {
  const dup = /Identifier '([^']+)' has already been declared/.exec(e.message);
  const where = dup ? fs.readdirSync(jsDir).filter(f => new RegExp(`^(?:const|let|class|function|async function)\\s+${dup[1]}\\b`, 'm').test(rd(path.join(jsDir, f)))) : [];
  console.error(`Error en el código de la interfaz: ${e.message}${where.length ? ' (en ' + where.join(', ') + ')' : ''}`);
  process.exit(1);
}
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
  '/*__QRCODE__*/': safeJs(rd(path.join(NM, 'qrcode-generator/dist/qrcode.js'))),
  '/*__ICONS__*/': 'const ICONS = ' + JSON.stringify(icons) + ';',
  '/*__APP__*/': safeJs(js),
};
let html = rd(path.join(SRC, 'template.html'));
for (const [k, v] of Object.entries(parts)) { if (!html.includes(k)) throw new Error('Falta marcador ' + k); html = html.split(k).join(v); }
fs.writeFileSync(path.join(OUT, 'index.html'), html);
for (const f of fs.readdirSync(path.join(ROOT, 'static'))) fs.copyFileSync(path.join(ROOT, 'static', f), path.join(OUT, f));
// OCR sin internet: motor Tesseract (WebAssembly, solo LSTM) y modelos compactos de español e inglés
const OCR = path.join(OUT, 'ocr'), ocrFiles = [
  ['tesseract.js/dist/tesseract.min.js', 'tesseract.min.js'], ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js'], ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js'],
  ['@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz', 'lang/spa.traineddata.gz'], ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz'],
  ['@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz', 'lang/por.traineddata.gz'], ['@tesseract.js-data/fra/4.0.0_best_int/fra.traineddata.gz', 'lang/fra.traineddata.gz']];
for (const [src, dst] of ocrFiles) { fs.mkdirSync(path.dirname(path.join(OCR, dst)), { recursive: true }); fs.copyFileSync(path.join(NM, src), path.join(OCR, dst)); }
console.log(`dist/index.html ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB · ${Object.keys(icons).length} íconos · v${pkg.version}`);
