/* ============================================================
   02 · Estado, modelo de documento, geometría, apertura
   ============================================================ */
const DEFAULT_OPTS = {
  highlight: { color: '#ffe14d', opacity: 0.45 },
  underline: { color: '#1a7f37', sw: 1.4 },
  strike: { color: '#d1242f', sw: 1.4 },
  ink: { color: '#d1242f', sw: 2, opacity: 1 },
  rect: { color: '#d1242f', sw: 2, fill: '', opacity: 1 },
  ellipse: { color: '#d1242f', sw: 2, fill: '', opacity: 1 },
  line: { color: '#d1242f', sw: 2, opacity: 1 },
  arrow: { color: '#d1242f', sw: 2, opacity: 1 },
  text: { color: '#111111', size: 12, font: 'Helvetica', bold: false, italic: false, align: 'left', bg: '', border: '' },
  note: { color: '#ffd400' },
  stamp: { label: 'APROBADO', color: '#1d8a4e', date: true },
  whiteout: { color: '#ffffff' },
  redact: {},
  'field-text': { multiline: false },
  'field-check': {},
  'field-drop': { options: 'Opción 1\nOpción 2\nOpción 3' }
};
const S = {
  docs: [], active: null,
  tool: 'select', toolOpts: Object.assign(structuredClone(DEFAULT_OPTS), store.get('toolOpts', {})),
  sel: null,            // {pid, oid}
  editing: null,        // oid en edición de texto
  ribbonTab: 'home', side: 'thumbs', sideOpen: true,
  pendingImage: null,   // {assetId, w, h} para colocar imagen/firma
  settings: Object.assign({ msClientId: '', msTenant: 'common', gClientId: '', author: '', dark: false, flattenFormsOnCopy: true }, store.get('settings', {})),
  metricsFonts: {}
};
const saveToolOpts = () => store.set('toolOpts', S.toolOpts);
const saveSettings = () => store.set('settings', S.settings);

class Doc {
  constructor(name) {
    this.id = uid(); this.name = name || 'Sin título.pdf';
    this.sources = {}; this.pages = []; this.assets = {};
    this.formValues = {}; this.formOrig = {}; this.fields = {}; // fields[srcId][idx] = widgets
    this.meta = {}; this.security = null; this.cloud = null; this.handle = null; this.handleId = null;
    this.dirty = false; this.undo = []; this.redo = [];
    this.zoom = 'fitw'; this.scale = 1; this.cur = 0; this.scrollTop = 0;
    this.orgSel = new Set(); this.view = 'pages';
  }
  snap() { return structuredClone({ pages: this.pages, formValues: this.formValues, meta: this.meta, security: this.security }); }
  checkpoint() {
    this.undo.push(this.snap()); if (this.undo.length > 60) this.undo.shift();
    this.redo = []; this.setDirty(true);
  }
  restore(s) { Object.assign(this, structuredClone(s)); }
  setDirty(v) { this.dirty = v; renderTabs(); }
  page(pid) { return this.pages.find(p => p.id === pid); }
  pageIndex(pid) { return this.pages.findIndex(p => p.id === pid); }
  obj(pid, oid) { const p = this.page(pid); return p && p.ov.find(o => o.id === oid); }
}
const D = () => S.active;

/* ---------- Geometría de página ----------
   Unidades: puntos PDF. Coordenadas "de pantalla" con origen arriba-izquierda
   sobre la página ya rotada y recortada. */
const rotT = p => ((p.brot + p.rot) % 360 + 360) % 360;
function fullDims(p) { const t = rotT(p); return t % 180 ? [p.h, p.w] : [p.w, p.h]; }
/** punto sin rotar (u,v arriba-izq) → pantalla completa */
function unrotToDisp(p, u, v) {
  const t = rotT(p), w = p.w, h = p.h;
  if (t === 90) return [h - v, u]; if (t === 180) return [w - u, h - v]; if (t === 270) return [v, w - u]; return [u, v];
}
function dispToUnrot(p, x, y) {
  const t = rotT(p), w = p.w, h = p.h;
  if (t === 90) return [y, h - x]; if (t === 180) return [w - x, h - y]; if (t === 270) return [w - y, x]; return [x, y];
}
function rectMap(fn, p, r) {
  const a = fn(p, r.x, r.y), b = fn(p, r.x + r.w, r.y + r.h);
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
}
function cropDisp(p) { // rectángulo recortado en pantalla completa
  if (!p.crop) { const [W, H] = fullDims(p); return { x: 0, y: 0, w: W, h: H }; }
  return rectMap(unrotToDisp, p, p.crop);
}
function dims(p) { const c = cropDisp(p); return [c.w, c.h]; }
/** Matriz (PDF cm) desde pantalla recortada con eje Y hacia arriba → espacio de usuario PDF */
function exportMatrix(p) {
  const t = rotT(p), w = p.w, h = p.h, bx = p.bx || 0, by = p.by || 0;
  let Mr;
  if (t === 90) Mr = [0, 1, -1, 0, w + bx, by];
  else if (t === 180) Mr = [-1, 0, 0, -1, w + bx, h + by];
  else if (t === 270) Mr = [0, -1, 1, 0, bx, h + by];
  else Mr = [1, 0, 0, 1, bx, by];
  const [, Hf] = fullDims(p), c = cropDisp(p);
  const T = [1, 0, 0, 1, c.x, Hf - c.y - c.h];
  return matMul(T, Mr);
}
function matMul(m1, m2) { // aplicar m1 y luego m2
  return [m1[0] * m2[0] + m1[1] * m2[2], m1[0] * m2[1] + m1[1] * m2[3], m1[2] * m2[0] + m1[3] * m2[2], m1[2] * m2[1] + m1[3] * m2[3],
  m1[4] * m2[0] + m1[5] * m2[2] + m2[4], m1[4] * m2[1] + m1[5] * m2[3] + m2[5]];
}
const matApply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
/** rect de pantalla (arriba-izq) → rect en espacio de usuario PDF [x1,y1,x2,y2] */
function dispRectToUser(p, r) {
  const [, Hc] = dims(p), M = exportMatrix(p);
  const a = matApply(M, r.x, Hc - r.y), b = matApply(M, r.x + r.w, Hc - r.y - r.h);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

/* ---------- Fuentes / páginas ---------- */
async function loadPdfSource(bytes, name) {
  let password;
  for (let attempt = 0; ; attempt++) {
    try {
      const pdf = await pdfjsLib.getDocument({ data: bytes.slice(), password, isEvalSupported: false, useSystemFonts: true }).promise;
      return { id: uid(), kind: 'pdf', name, bytes, pdf, password, numPages: pdf.numPages, text: {}, annots: {}, sigs: scanSignatures(bytes) };
    } catch (e) {
      if (e && e.name === 'PasswordException') {
        busy(false);
        const pw = await askPassword('Documento protegido', (e.code === 2 ? '<b style="color:var(--danger)">Contraseña incorrecta.</b> ' : '') + `«${escapeHtml(name)}» requiere contraseña para abrirse.`);
        busy(true);
        if (pw == null) throw new Error('Apertura cancelada');
        password = pw; continue;
      }
      throw new Error('No se pudo leer el PDF: ' + (e.message || e));
    }
  }
}
async function pagesFromPdfSource(src) {
  const out = [];
  for (let i = 0; i < src.numPages; i++) {
    const pg = await src.pdf.getPage(i + 1);
    const v = pg.view;
    out.push({ id: uid(), src: src.id, idx: i, w: v[2] - v[0], h: v[3] - v[1], bx: v[0], by: v[1], brot: pg.rotate || 0, rot: 0, crop: null, ov: [] });
  }
  return out;
}
async function loadImageSource(bytes, name, mime) {
  mime = mime || (/\.png$/i.test(name) ? 'image/png' : 'image/jpeg');
  let url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  let img = await loadImage(url);
  // normalizar formatos no soportados por pdf-lib (gif/webp/bmp) a PNG
  if (!/png|jpe?g/i.test(mime)) {
    const c = el('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
    bytes = await canvasToBytes(c, 'image/png'); mime = 'image/png'; url = URL.createObjectURL(new Blob([bytes], { type: mime })); img = await loadImage(url);
  }
  return { id: uid(), kind: 'image', name, bytes, mime, url, img, pw: img.naturalWidth, ph: img.naturalHeight };
}
const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008], a3: [841.89, 1190.55], a5: [419.53, 595.28] };
function imagePage(src, size = 'fit', margin = 0) {
  const pwPt = src.pw * 0.75, phPt = src.ph * 0.75;
  if (size === 'fit') return { id: uid(), src: src.id, idx: 0, w: pwPt, h: phPt, bx: 0, by: 0, brot: 0, rot: 0, crop: null, ov: [], img: { x: 0, y: 0, w: pwPt, h: phPt } };
  let [W, H] = PAGE_SIZES[size] || PAGE_SIZES.a4;
  if (src.pw > src.ph) [W, H] = [H, W];
  const m = margin * PT_PER_MM, k = Math.min((W - 2 * m) / pwPt, (H - 2 * m) / phPt, 1e9);
  const w = pwPt * k, h = phPt * k;
  return { id: uid(), src: src.id, idx: 0, w: W, h: H, bx: 0, by: 0, brot: 0, rot: 0, crop: null, ov: [], img: { x: (W - w) / 2, y: (H - h) / 2, w, h } };
}
function blankPage(w = 595.28, h = 841.89) { return { id: uid(), src: null, idx: 0, w, h, bx: 0, by: 0, brot: 0, rot: 0, crop: null, ov: [] }; }

/** Agrega un archivo (PDF o imagen) a un documento; devuelve las páginas nuevas */
async function addFileToDoc(doc, bytes, name, mime, imgSize = 'fit') {
  if (isPdfName(name) || mime === 'application/pdf' || (bytes[0] === 0x25 && bytes[1] === 0x50)) {
    const src = await loadPdfSource(bytes, name);
    doc.sources[src.id] = src;
    const pages = await pagesFromPdfSource(src);
    await loadFormFields(doc, src);
    return pages;
  }
  if (isImageName(name) || isImageMime(mime)) {
    const src = await loadImageSource(bytes, name, mime);
    doc.sources[src.id] = src;
    return [imagePage(src, imgSize, imgSize === 'fit' ? 0 : 10)];
  }
  throw new Error('Formato no soportado: ' + name);
}
async function loadFormFields(doc, src) {
  doc.fields[src.id] = {}; doc.formValues[src.id] = {}; doc.formOrig[src.id] = {};
  let any = false;
  for (let i = 0; i < src.numPages; i++) {
    const pg = await src.pdf.getPage(i + 1);
    let ann = [];
    try { ann = await pg.getAnnotations({ intent: 'display' }); } catch { }
    const ws = ann.filter(a => a.subtype === 'Widget' && a.fieldName && !a.pushButton && a.fieldType);
    if (!ws.length) continue;
    any = true; doc.fields[src.id][i] = ws;
    for (const w of ws) {
      if (w.fieldName in doc.formOrig[src.id]) continue;
      let v = w.fieldValue;
      if (w.checkBox) v = !!(v && v !== 'Off' && (w.exportValue ? v === w.exportValue : true));
      else if (w.radioButton) v = (v && v !== 'Off') ? v : '';
      else if (Array.isArray(v)) v = v[0] ?? '';
      else v = v ?? '';
      doc.formOrig[src.id][w.fieldName] = v; doc.formValues[src.id][w.fieldName] = v;
    }
  }
  src.hasForm = any;
}
function docHasForms(doc) { return Object.values(doc.sources).some(s => s.hasForm); }

/** Abre bytes como documento nuevo (pestaña) */
async function openBytes(name, bytes, extra = {}) {
  return withBusy('Abriendo ' + name + '…', async () => {
    const doc = new Doc(isPdfName(name) ? name : baseName(name) + '.pdf');
    doc.pages = await addFileToDoc(doc, bytes, name, extra.mime);
    const s0 = Object.values(doc.sources)[0];
    if (s0.kind === 'pdf') {
      if (s0.password) doc.security = { userPw: s0.password, ownerPw: s0.password, perms: { print: true, copy: true, modify: true, annotate: true, forms: true, assemble: true }, inherited: true };
      try { const md = await s0.pdf.getMetadata(); const i = md.info || {}; doc.meta = { title: i.Title || '', author: i.Author || '', subject: i.Subject || '', keywords: i.Keywords || '' }; } catch { }
    }
    if (extra.cloud) doc.cloud = extra.cloud;
    if (extra.handle) { doc.handle = extra.handle; doc.handleId = extra.handleId; }
    if (extra.nativePath) doc.nativePath = extra.nativePath;
    if (extra.androidUri) doc.androidUri = extra.androidUri;
    if (s0.sigs && s0.sigs.length) setTimeout(() => toast(`Este documento tiene ${s0.sigs.length} firma(s) digital(es). Revíselas en el panel «Firmas».`, '', 6000), 300);
    if (s0.kind === 'image') doc.dirty = true;
    addDoc(doc);
    addRecent(doc);
    return doc;
  });
}
function addDoc(doc) { S.docs.push(doc); activateDoc(doc); }
function newEmptyDoc(name) { const d = new Doc(name); return d; }
