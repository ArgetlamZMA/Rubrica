/* ============================================================
   00 · Idiomas de la interfaz: español (original), inglés y portugués
   Las traducciones están en src/i18n/ui.tsv, con el texto en español como
   clave. Se aplican a la interfaz a medida que se dibuja (texto, title,
   placeholder y aria-label), sin tocar el contenido de los documentos.
   Para agregar un texto: una fila más en ui.tsv. Los textos con valores
   variables usan {0}, {1}… en la clave y en la traducción.
   ============================================================ */
const LANGS = { es: 'Español', en: 'English', pt: 'Português' };
const LOCALES = { es: 'es-HN', en: 'en-US', pt: 'pt-BR' };
let LANG = 'es';
const I18N = { exact: new Map(), patterns: [] };
/** Configuración regional de fechas y números según el idioma de la interfaz. */
const LOC = () => LOCALES[LANG] || 'es-HN';

function resolveLang(pref) {
  if (pref && LANGS[pref]) return pref;
  const sys = (navigator.languages && navigator.languages[0]) || navigator.language || 'es';
  const l = sys.slice(0, 2).toLowerCase();
  return LANGS[l] ? l : 'en';
}
function loadLang(lang) {
  LANG = lang; I18N.exact = new Map(); I18N.patterns = [];
  const d = (typeof I18N_DICT !== 'undefined' && I18N_DICT[lang]) || {};
  for (const [es, tr] of Object.entries(d)) {
    if (/\{\d+\}/.test(es)) {
      const names = [], src = es.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{(\d+)\\?\}/g, (_, n) => { names.push(n); return '([\\s\\S]+?)'; });
      try { I18N.patterns.push({ re: new RegExp('^' + src + '$'), names, tr }); } catch { }
    } else I18N.exact.set(es, tr);
  }
}
/** Traduce un texto de la interfaz (sin cambios si no hay traducción o si el idioma es español). */
function tr(s) {
  if (LANG === 'es' || s == null) return s;
  const str = String(s), m = str.match(/^(\s*)([\s\S]*?)(\s*)$/), core = m[2];
  if (!core) return str;
  let out = I18N.exact.get(core);
  if (out == null) for (const p of I18N.patterns) {
    const r = p.re.exec(core); if (!r) continue;
    out = p.tr.replace(/\{(\d+)\}/g, (_, n) => { const k = p.names.indexOf(n); return k >= 0 ? r[k + 1] : ''; });
    break;
  }
  return out == null ? str : m[1] + out + m[3];
}

/* ---------- Aplicación sobre la interfaz ---------- */
const I18N_ATTRS = ['title', 'placeholder', 'aria-label'];
const I18N_SKIP = '#viewer, .textLayer, [contenteditable="true"], script, style, textarea, .no-i18n';
const I18N_TEXT = new WeakMap(), I18N_SET = new WeakMap(), I18N_ATTR = new WeakMap();
let I18N_OBS = null;
const i18nSkip = e => !e || !!e.closest(I18N_SKIP);
function i18nText(n) {
  const v = n.nodeValue; if (!v || !v.trim()) return;
  let orig = I18N_TEXT.get(n);
  if (orig === undefined || v !== I18N_SET.get(n)) { orig = v; I18N_TEXT.set(n, orig); }
  const t = tr(orig);
  I18N_SET.set(n, t);
  if (t !== v) n.nodeValue = t;
}
function i18nAttrs(e) {
  let rec = I18N_ATTR.get(e);
  for (const a of I18N_ATTRS) {
    const v = e.getAttribute(a); if (v == null || !v.trim()) continue;
    rec = rec || {}; const r = rec[a];
    const orig = r && r.set === v ? r.orig : v;
    const t = tr(orig); rec[a] = { orig, set: t };
    if (t !== v) e.setAttribute(a, t);
  }
  if (rec) I18N_ATTR.set(e, rec);
}
function i18nTree(root) {
  if (!root) return;
  if (root.nodeType === 3) { if (!i18nSkip(root.parentElement)) i18nText(root); return; }
  if (root.nodeType !== 1 || i18nSkip(root)) return;
  i18nAttrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.nodeType === 1 && n.matches(I18N_SKIP)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeType === 3 ? i18nText(n) : i18nAttrs(n);
}
/** Aplica un idioma ('auto', 'es', 'en' o 'pt') a toda la interfaz y a lo que se dibuje después. */
function applyLang(pref) {
  loadLang(resolveLang(pref));
  document.documentElement.lang = LANG;
  i18nTree(document.body);
  if (!I18N_OBS && LANG !== 'es') {
    I18N_OBS = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'childList') m.addedNodes.forEach(i18nTree);
        else if (m.type === 'characterData') { if (!i18nSkip(m.target.parentElement)) i18nText(m.target); }
        else if (m.type === 'attributes' && !i18nSkip(m.target)) i18nAttrs(m.target);
      }
    });
    I18N_OBS.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: I18N_ATTRS });
  }
}
