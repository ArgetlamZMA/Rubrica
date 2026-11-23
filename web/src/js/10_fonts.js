/* ============================================================
   10 · Fuentes: estándar PDF + fuentes del sistema (Aptos, Calibri…)
   - App de Windows: el host nativo entrega la lista y los archivos
     (incluye las fuentes en la nube de Microsoft 365, como Aptos).
   - Navegador: API «Local Font Access» (Edge/Chrome) o fuentes que
     el usuario agrega manualmente (.ttf/.otf).
   Si una fuente no está disponible se usa Helvetica, sin errores.
   ============================================================ */
const STD_FONTS = ['Helvetica', 'Times', 'Courier'];
const STD_LABEL = { Helvetica: 'Helvetica / Arial', Times: 'Times', Courier: 'Courier' };
const FONTS = { list: new Map(), loaded: new Map(), pending: new Map(), provider: '', tmp: null };
const isStdFont = f => !f || STD_FONTS.includes(f);
const styleKey = (b, i) => (b ? 'b' : '') + (i ? 'i' : '') || 'r';

/** clasifica el estilo («Bold Italic», «Semibold», «Light»…) → [b, i] o null si es un peso no estándar */
function parseStyle(style) {
  const s = String(style || 'Regular').toLowerCase().replace(/[-_]/g, ' ').trim();
  const italic = /italic|oblique|kursiv|cursiva/.test(s);
  const rest = s.replace(/italic|oblique|kursiv|cursiva/g, '').trim();
  if (!rest || /^(regular|normal|book|roman|plain|standard|medium)$/.test(rest)) return rest === 'medium' ? null : [false, italic];
  if (/^bold$/.test(rest)) return [true, italic];
  return null;
}
function registerFace(family, style, src) {
  family = String(family || '').trim(); if (!family) return;
  let st = parseStyle(style);
  if (!st) { family = family + ' ' + String(style).replace(/\s*(italic|oblique)\s*/i, ' ').trim(); st = [false, /italic|oblique/i.test(style)]; }
  let e = FONTS.list.get(family); if (!e) { e = {}; FONTS.list.set(family, e); }
  const k = styleKey(...st); if (!e[k]) e[k] = src;
}
function resolveStyle(family, b, i) {
  const e = FONTS.list.get(family); if (!e) return null;
  for (const k of [styleKey(b, i), styleKey(b, false), styleKey(false, i), 'r', 'b', 'i', 'bi']) if (e[k]) return k;
  return null;
}
function fontKey(family, b, i) { const k = resolveStyle(family, b, i); return k ? family + '|' + k : null; }
function fontAvailable(family) { return isStdFont(family) || FONTS.list.has(family); }
function defaultFont() { const f = S.settings.defaultFont || 'Aptos'; return fontAvailable(f) ? f : 'Helvetica'; }
function fontFamilies() { return [...FONTS.list.keys()].sort((a, b) => a.localeCompare(b, 'es')); }

async function fontBytes(src) {
  if (src.bytes) return src.bytes;
  if (src.native) return natBytes('font?file=' + encodeURIComponent(src.native));
  if (src.local) return new Uint8Array(await (await src.local.blob()).arrayBuffer());
  if (src.idb) return (await idb.get('font:' + src.idb))?.bytes;
  throw new Error('Fuente sin origen');
}
/** Carga una fuente del sistema: FontFace para pantalla + fuente pdf-lib para métricas. null si es estándar o no existe */
function ensureFont(family, b, i) {
  if (isStdFont(family)) return Promise.resolve(null);
  const key = fontKey(family, b, i); if (!key) return Promise.resolve(null);
  if (FONTS.loaded.has(key)) return Promise.resolve(FONTS.loaded.get(key));
  if (FONTS.pending.has(key)) return FONTS.pending.get(key);
  const p = (async () => {
    try {
      const k = key.split('|')[1], src = FONTS.list.get(family)[k];
      const bytes = await fontBytes(src);
      if (!FONTS.tmp) { FONTS.tmp = await PL.PDFDocument.create(); FONTS.tmp.registerFontkit(fontkit); }
      const metric = await FONTS.tmp.embedFont(bytes, { subset: true });
      const fk = metric.embedder.font;
      const css = 'pdfs_' + key.replace(/[^a-z0-9]/gi, '_');
      const face = new FontFace(css, bytes); await face.load(); document.fonts.add(face);
      const upm = fk.unitsPerEm || 1000, asc = fk.ascent, desc = fk.descent;
      const ent = { family, key, bytes, css, metric, bold: k.includes('b'), italic: k.includes('i'), baseline: (1.2 - (asc - desc) / upm) / 2 + asc / upm, cff: !!fk.cff };
      FONTS.loaded.set(key, ent); return ent;
    } catch (e) { console.warn('Fuente no disponible', family, e); FONTS.list.get(family) && delete FONTS.list.get(family)[key.split('|')[1]]; return null; }
    finally { FONTS.pending.delete(key); }
  })();
  FONTS.pending.set(key, p); return p;
}
function loadedFont(family, b, i) { const k = fontKey(family, b, i); return k ? FONTS.loaded.get(k) : null; }
let fontRerenderT = null;
function requestFont(family, b, i) {
  ensureFont(family, b, i).then(ent => {
    if (!ent) return;
    clearTimeout(fontRerenderT);
    fontRerenderT = setTimeout(() => { const d = D(); if (d && d.view !== 'organize') for (const p of d.pages) if (p.ov.some(o => o.font === family)) { for (const o of p.ov) if (o.font === family) fitTextBox(o); renderOverlays(p); } }, 60);
  });
}
/** estilo CSS para un objeto de texto */
function fontCss(family, b, i) {
  if (isStdFont(family)) return { fontFamily: FONT_CSS[family || 'Helvetica'], fontWeight: b ? 700 : 400, fontStyle: i ? 'italic' : 'normal' };
  const ent = loadedFont(family, b, i);
  if (ent) return { fontFamily: `"${ent.css}", Arial, sans-serif`, fontWeight: b && !ent.bold ? 700 : 400, fontStyle: i && !ent.italic ? 'italic' : 'normal' };
  requestFont(family, b, i);
  return { fontFamily: `"${family}", Arial, sans-serif`, fontWeight: b ? 700 : 400, fontStyle: i ? 'italic' : 'normal' };
}
function baselineOf(family, b, i) {
  if (isStdFont(family)) return BASELINE[family || 'Helvetica'];
  const ent = loadedFont(family, b, i); return ent ? ent.baseline : BASELINE.Helvetica;
}

/* ---------- Proveedores ---------- */
async function initFonts() {
  try {
    if (NATIVE) {
      const list = await natJson('fonts');
      for (const f of list) registerFace(f.family, f.style, { native: f.file });
      FONTS.provider = 'native';
    } else if ('queryLocalFonts' in window) {
      let st = 'prompt'; try { st = (await navigator.permissions.query({ name: 'local-fonts' })).state; } catch { }
      if (st === 'granted') await loadLocalFonts(true);
    }
  } catch (e) { console.warn('fuentes del sistema', e); }
  try { for (const u of (await idb.get('userfonts')) || []) registerFace(u.family, u.style, { idb: u.id }); } catch { }
  // fuente predeterminada
  const def = defaultFont();
  if (!S.toolOpts.text._fontSet) { S.toolOpts.text.font = def; }
  if (!isStdFont(def)) ensureFont(def, false, false);
  FONTS.ready = true;
}
async function loadLocalFonts(silent) {
  if (!('queryLocalFonts' in window)) { if (!silent) toast('Este navegador no permite leer las fuentes del equipo. Use «Agregar fuente…».', 'err', 6000); return false; }
  try {
    const fs = await window.queryLocalFonts();
    for (const f of fs) registerFace(f.family, f.style, { local: f });
    FONTS.provider = FONTS.provider || 'local';
    if (!silent) toast(`${FONTS.list.size} familias de fuentes disponibles.`, 'ok');
    return true;
  } catch (e) { if (!silent) toast('No se concedió acceso a las fuentes del equipo.', 'err'); return false; }
}
async function addUserFont() {
  const fs = await pickLocal('.ttf,.otf,.ttc', true); if (!fs.length) return;
  const list = (await idb.get('userfonts').catch(() => null)) || [];
  for (const f of fs) {
    try {
      const bytes = await readFileBytes(f);
      const fk = fontkit.create(bytes);
      const font = fk.fonts ? fk.fonts[0] : fk;
      const id = uid(), family = font.familyName, style = font.subfamilyName || 'Regular';
      await idb.set('font:' + id, { bytes });
      list.push({ id, family, style, name: f.name }); registerFace(family, style, { idb: id });
      toast(`Fuente agregada: ${family} ${style}`, 'ok');
    } catch (e) { toast('No se pudo leer ' + f.name + ': ' + e.message, 'err'); }
  }
  await idb.set('userfonts', list);
}

/* ---------- Detección de la fuente de un PDF ---------- */
const normFam = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function splitPdfFontName(name) {
  let n = String(name || '').replace(/^[A-Z]{6}\+/, '');
  let style = '';
  const m = n.match(/^(.*?)[-,](.*)$/); if (m) { n = m[1]; style = m[2]; }
  n = n.replace(/(PSMT|PS|MT)$/, '');
  const bold = /bold|black|heavy|semibold|demi/i.test(name), italic = /italic|oblique|it$/i.test(style) || /italic|oblique/i.test(name);
  const spaced = n.replace(/([a-z])([A-Z])/g, '$1 $2');
  return { base: n, spaced, bold, italic, raw: name };
}
/** Busca la familia del sistema que corresponde al nombre de fuente del PDF */
function matchSystemFont(pdfFontName) {
  const p = splitPdfFontName(pdfFontName); if (!p.base) return null;
  const want = normFam(p.base);
  const fams = [...FONTS.list.keys()];
  let hit = fams.find(f => normFam(f) === want);
  if (!hit) hit = fams.find(f => normFam(f) === normFam(p.base.replace(/(Regular|Roman|Std|Pro|LT)$/i, '')));
  if (!hit && want.length > 4) hit = fams.filter(f => want.startsWith(normFam(f))).sort((a, b) => b.length - a.length)[0];
  return hit ? { family: hit, bold: p.bold, italic: p.italic } : null;
}
