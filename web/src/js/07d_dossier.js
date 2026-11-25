/* ============================================================
   07d · Armar expediente: portada con datos, índice con enlaces,
   marcadores por documento, numeración Bates y ajuste de tamaño.
   Pensado para expedientes aduaneros, licitaciones y trámites,
   pero los datos de la portada son libres.
   ============================================================ */
const DOSSIER_PRESETS = {
  aduana: { label: 'Aduanas: importación / exportación', title: 'Expediente de importación', prefix: 'EXP-',
    fields: ['Importador / exportador', 'RTN', 'Declaración (DUCA) No.', 'Régimen', 'Aduana', 'Documento de transporte (BL / guía)', 'Contenedor(es)', 'Factura(s) comercial(es)', 'Agente aduanero', 'Referencia interna'] },
  licitacion: { label: 'Licitación / propuesta', title: 'Propuesta', prefix: 'OF-',
    fields: ['Entidad contratante', 'Proceso No.', 'Oferente', 'RTN', 'Representante legal', 'Fecha de presentación'] },
  general: { label: 'General', title: 'Expediente', prefix: 'DOC-', fields: ['Cliente', 'Referencia', 'Asunto', 'Preparado por'] }
};

/* ---------- Utilidades de dibujo ---------- */
/** Reemplaza los caracteres que la fuente estándar no puede codificar (WinAnsi). */
function winAnsiSafe(font, s) {
  const set = font.__set || (font.__set = new Set(font.getCharacterSet()));
  return Array.from(String(s ?? '')).map(c => set.has(c.codePointAt(0)) ? c : (c === '\t' ? ' ' : '?')).join('');
}
function wrapLines(font, text, size, maxW) {
  const out = [];
  for (const para of winAnsiSafe(font, text).split(/\r?\n/)) {
    let line = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const t = line ? line + ' ' + w : w;
      if (font.widthOfTextAtSize(t, size) <= maxW) { line = t; continue; }
      if (line) out.push(line);
      line = w;
      while (font.widthOfTextAtSize(line, size) > maxW && line.length > 1) { // palabra más larga que la columna
        let k = line.length - 1; while (k > 1 && font.widthOfTextAtSize(line.slice(0, k), size) > maxW) k--;
        out.push(line.slice(0, k)); line = line.slice(k);
      }
    }
    out.push(line);
  }
  return out;
}
function ellipsize(font, text, size, maxW) {
  let t = winAnsiSafe(font, text);
  if (font.widthOfTextAtSize(t, size) <= maxW) return t;
  while (t.length > 1 && font.widthOfTextAtSize(t + '…', size) > maxW) t = t.slice(0, -1);
  return t + '…';
}
const hexRgb = (hex) => { const c = hexToRgb01(hex || '#000000'); return PL.rgb(c.r, c.g, c.b); };
function hexToRgb01(hex) { const m = /^#?([0-9a-f]{6})$/i.exec(hex || '') || [0, '000000']; const n = parseInt(m[1], 16); return { r: (n >> 16 & 255) / 255, g: (n >> 8 & 255) / 255, b: (n & 255) / 255 }; }

/** Escribe texto en una esquina de la página tal como se ve (respeta /Rotate y el cuadro de recorte). */
function drawVisibleText(page, text, { font, size = 9, color = PL.rgb(0, 0, 0), pos = 'br', margin = 22, box = true }) {
  const rot = ((page.getRotation().angle % 360) + 360) % 360, cb = page.getCropBox();
  const w = cb.width, h = cb.height, W = rot % 180 ? h : w, H = rot % 180 ? w : h;
  const t = winAnsiSafe(font, text), tw = font.widthOfTextAtSize(t, size);
  const vx = pos[1] === 'l' ? margin : pos[1] === 'c' ? (W - tw) / 2 : W - margin - tw;
  const vy = pos[0] === 't' ? H - margin - size : margin;
  const map = (x, y) => rot === 90 ? [w - y, x] : rot === 180 ? [w - x, h - y] : rot === 270 ? [y, h - x] : [x, y];
  const rotate = PL.degrees(rot);
  if (box) { const [bx, by] = map(vx - 3, vy - 3); page.drawRectangle({ x: cb.x + bx, y: cb.y + by, width: tw + 6, height: size + 5, color: PL.rgb(1, 1, 1), opacity: 0.85, rotate }); }
  const [x, y] = map(vx, vy);
  page.drawText(t, { x: cb.x + x, y: cb.y + y, size, font, color, rotate });
}

/** Agrega marcadores (esquema) planos: [{ title, page }] con page = PDFPage del documento. */
function setFlatOutline(pdf, entries) {
  if (!entries.length) return;
  const ctx = pdf.context, N = PL.PDFName.of, root = ctx.nextRef(), refs = entries.map(() => ctx.nextRef());
  entries.forEach((e, i) => {
    const d = { Title: PL.PDFHexString.fromText(e.title), Parent: root, Dest: ctx.obj([e.page.ref, N('Fit')]) };
    if (i > 0) d.Prev = refs[i - 1];
    if (i < entries.length - 1) d.Next = refs[i + 1];
    ctx.assign(refs[i], ctx.obj(d));
  });
  ctx.assign(root, ctx.obj({ Type: 'Outlines', First: refs[0], Last: refs.at(-1), Count: entries.length }));
  pdf.catalog.set(N('Outlines'), root);
  pdf.catalog.set(N('PageMode'), N('UseOutlines'));
}
function addLink(pdf, page, rect, target) {
  const ctx = pdf.context, N = PL.PDFName.of;
  const a = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], F: 4, Dest: ctx.obj([target.ref, N('Fit')]) }));
  let annots = page.node.lookup(N('Annots'));
  if (!(annots instanceof PL.PDFArray)) { annots = ctx.obj([]); page.node.set(N('Annots'), annots); }
  annots.push(a);
}

/* ---------- Armado ---------- */
/**
 * items: [{ title, bytes }] (PDF). o: { title, fields:[[etiqueta, valor]], notes, logo:{bytes,mime}, color,
 * cover, index, outline, bates:{prefix,start,digits,pos}|null, size:[w,h], raster:{dpi,quality}|null, progress }
 * Devuelve { bytes, docs:[{ title, from, to, bates }], pages }.
 */
async function buildDossier(items, o) {
  const prog = o.progress || (() => { });
  const pdf = await PL.PDFDocument.create();
  const F = await pdf.embedFont(PL.StandardFonts.Helvetica), B = await pdf.embedFont(PL.StandardFonts.HelveticaBold);
  const [PW, PH] = o.size || PAGE_SIZES.letter, M = 54, accent = hexRgb(o.color || '#00866a'), gray = PL.rgb(0.4, 0.4, 0.4), black = PL.rgb(0.1, 0.1, 0.1);
  // documentos (opcionalmente como imagen para reducir tamaño)
  const libs = [];
  for (let i = 0; i < items.length; i++) {
    prog(o.raster ? `Comprimiendo «${items[i].title}» a ${o.raster.dpi} ppp…` : `Preparando «${items[i].title}»…`, 5 + (i / items.length) * 50);
    const src = await PL.PDFDocument.load(items[i].bytes, { ignoreEncryption: true, updateMetadata: false });
    libs.push(o.raster ? await rasterizePagesInLib(items[i].bytes, src.getPageIndices(), o.raster.dpi, o.raster.quality) : src);
  }
  const counts = libs.map(l => l.getPageCount()), total = counts.reduce((a, b) => a + b, 0);
  const ROW = 22, rowsPerPage = Math.floor((PH - 150 - 70) / ROW);
  const nIdx = o.index ? Math.max(1, Math.ceil(items.length / rowsPerPage)) : 0, front = (o.cover ? 1 : 0) + nIdx;
  const bat = o.bates, bnum = n => bat ? (bat.prefix || '') + String((bat.start ?? 1) + n).padStart(bat.digits || 6, '0') : '';
  const docs = []; let at = front + 1, bn = 0;
  items.forEach((it, i) => { docs.push({ title: it.title, from: at, to: at + counts[i] - 1, bates: bat ? [bnum(bn), bnum(bn + counts[i] - 1)] : null }); at += counts[i]; bn += counts[i]; });
  const fecha = new Date().toLocaleDateString(LOC(), { day: '2-digit', month: 'long', year: 'numeric' });

  // portada
  if (o.cover) {
    prog('Diseñando la portada…', 58);
    const pg = pdf.addPage([PW, PH]);
    pg.drawRectangle({ x: 0, y: PH - 14, width: PW, height: 14, color: accent });
    let top = PH - 40;
    if (o.logo?.bytes) {
      try {
        const img = /png/i.test(o.logo.mime) ? await pdf.embedPng(o.logo.bytes) : await pdf.embedJpg(o.logo.bytes);
        const s = Math.min(170 / img.width, 64 / img.height); pg.drawImage(img, { x: M, y: top - img.height * s, width: img.width * s, height: img.height * s });
      } catch { }
    }
    const fd = winAnsiSafe(F, fecha); pg.drawText(fd, { x: PW - M - F.widthOfTextAtSize(fd, 10), y: top - 12, size: 10, font: F, color: gray });
    let y = PH - 170;
    for (const l of wrapLines(B, o.title || tr('Expediente'), 26, PW - 2 * M).slice(0, 3)) { pg.drawText(l, { x: M, y, size: 26, font: B, color: accent }); y -= 32; }
    pg.drawRectangle({ x: M, y: y + 14, width: 60, height: 3, color: accent });
    y -= 22;
    const LW = 170, VW = PW - 2 * M - LW - 10;
    for (const [lab, val] of (o.fields || []).filter(([l, v]) => String(v || '').trim())) {
      const vl = wrapLines(F, val, 11, VW), hh = Math.max(1, vl.length) * 14 + 8;
      if (y - hh < 150) break;
      wrapLines(B, lab, 9, LW).slice(0, 2).forEach((l, k) => pg.drawText(l.toUpperCase(), { x: M, y: y - k * 11, size: 9, font: B, color: gray }));
      vl.forEach((l, k) => pg.drawText(l, { x: M + LW + 10, y: y - k * 14, size: 11, font: F, color: black }));
      y -= hh; pg.drawLine({ start: { x: M, y: y + 10 }, end: { x: PW - M, y: y + 10 }, thickness: 0.5, color: PL.rgb(0.85, 0.85, 0.85) });
    }
    y -= 10;
    const resumen = bat
      ? tr(`Contenido: ${items.length} documentos · ${total} páginas · Bates ${bnum(0)} a ${bnum(total - 1)}`)
      : tr(`Contenido: ${items.length} documentos · ${total} páginas`);
    pg.drawRectangle({ x: M, y: y - 8, width: PW - 2 * M, height: 26, color: PL.rgb(0.95, 0.96, 0.95) });
    pg.drawText(ellipsize(B, resumen, 10, PW - 2 * M - 20), { x: M + 10, y, size: 10, font: B, color: black });
    y -= 34;
    if (String(o.notes || '').trim()) for (const l of wrapLines(F, o.notes, 10, PW - 2 * M)) { if (y < 70) break; pg.drawText(l, { x: M, y, size: 10, font: F, color: black }); y -= 13; }
    pg.drawLine({ start: { x: M, y: 48 }, end: { x: PW - M, y: 48 }, thickness: 0.5, color: PL.rgb(0.8, 0.8, 0.8) });
    pg.drawText(winAnsiSafe(F, tr('Expediente generado con Rúbrica')), { x: M, y: 34, size: 8, font: F, color: gray });
  }

  // índice (las páginas se crean ahora; los enlaces se agregan cuando existan las páginas de destino)
  const links = [];
  for (let k = 0; k < nIdx; k++) {
    const pg = pdf.addPage([PW, PH]);
    pg.drawRectangle({ x: 0, y: PH - 14, width: PW, height: 14, color: accent });
    pg.drawText(winAnsiSafe(B, nIdx > 1 ? tr(`Índice (${k + 1} de ${nIdx})`) : tr('Índice')), { x: M, y: PH - 70, size: 20, font: B, color: accent });
    pg.drawText(ellipsize(F, o.title || '', 10, PW - 2 * M), { x: M, y: PH - 88, size: 10, font: F, color: gray });
    const cNo = M, cDoc = M + 34, cBat = PW - M, cPag = bat ? PW - M - 150 : PW - M;
    let y = PH - 120;
    pg.drawText('No.', { x: cNo, y, size: 9, font: B, color: gray });
    pg.drawText(winAnsiSafe(B, tr('Documento')), { x: cDoc, y, size: 9, font: B, color: gray });
    const hp = winAnsiSafe(B, tr('Páginas')); pg.drawText(hp, { x: cPag - B.widthOfTextAtSize(hp, 9), y, size: 9, font: B, color: gray });
    if (bat) { const hb = 'Bates'; pg.drawText(hb, { x: cBat - B.widthOfTextAtSize(hb, 9), y, size: 9, font: B, color: gray }); }
    pg.drawLine({ start: { x: M, y: y - 6 }, end: { x: PW - M, y: y - 6 }, thickness: 0.8, color: accent });
    y -= ROW;
    docs.slice(k * rowsPerPage, (k + 1) * rowsPerPage).forEach((d, j) => {
      const n = k * rowsPerPage + j;
      const pgs = d.from === d.to ? String(d.from) : `${d.from}–${d.to}`;
      const docW = (bat ? cPag - 60 : cPag - 50) - cDoc;
      pg.drawText(String(n + 1), { x: cNo, y, size: 10, font: F, color: gray });
      pg.drawText(ellipsize(F, d.title, 10.5, docW), { x: cDoc, y, size: 10.5, font: F, color: black });
      pg.drawText(pgs, { x: cPag - F.widthOfTextAtSize(pgs, 10), y, size: 10, font: F, color: black });
      if (bat) { const b = d.bates[0] === d.bates[1] ? d.bates[0] : `${d.bates[0]} – ${d.bates[1]}`, bb = ellipsize(F, b, 8.5, 145); pg.drawText(bb, { x: cBat - F.widthOfTextAtSize(bb, 8.5), y, size: 8.5, font: F, color: gray }); }
      pg.drawLine({ start: { x: M, y: y - 7 }, end: { x: PW - M, y: y - 7 }, thickness: 0.4, color: PL.rgb(0.88, 0.88, 0.88) });
      links.push({ page: pg, rect: [M, y - 7, PW - M, y + ROW - 7], doc: n });
      y -= ROW;
    });
  }

  // documentos: copiar páginas, Bates
  const starts = []; let n = 0;
  for (let i = 0; i < libs.length; i++) {
    prog(`Agregando «${items[i].title}»…`, 62 + (i / libs.length) * 30);
    const copied = await pdf.copyPages(libs[i], libs[i].getPageIndices());
    copied.forEach((p, k) => {
      pdf.addPage(p); if (!k) starts.push(p);
      if (bat) drawVisibleText(p, bnum(n), { font: B, size: bat.size || 9, pos: bat.pos || 'br', color: hexRgb(bat.color || '#000000') });
      n++;
    });
  }
  for (const l of links) addLink(pdf, l.page, l.rect, starts[l.doc]);
  if (o.outline) {
    const all = pdf.getPages(), ent = [];
    if (o.cover) ent.push({ title: tr('Portada'), page: all[0] });
    if (nIdx) ent.push({ title: tr('Índice'), page: all[o.cover ? 1 : 0] });
    items.forEach((it, i) => ent.push({ title: `${i + 1}. ${it.title}`, page: starts[i] }));
    setFlatOutline(pdf, ent);
  }
  pdf.setTitle(o.title || tr('Expediente'), { showInWindowTitleBar: true });
  pdf.setSubject((o.fields || []).filter(([, v]) => String(v || '').trim()).map(([l, v]) => `${l}: ${v}`).join(' · ').slice(0, 500));
  pdf.setProducer('Rúbrica'); pdf.setCreator('Rúbrica'); pdf.setCreationDate(new Date()); pdf.setModificationDate(new Date());
  prog('Guardando…', 95);
  return { bytes: await pdf.save({ useObjectStreams: true }), docs, pages: front + total };
}

/** Arma el expediente sin superar maxBytes: primero sin pérdida, luego documentos como imagen y, si aún no cabe, en partes. */
async function buildDossierFit(items, o, maxBytes, minDpi = 96) {
  const prog = o.progress || (() => { });
  let r = await buildDossier(items, { ...o, raster: null });
  if (!maxBytes || r.bytes.length <= maxBytes) return { ...r, dpi: null };
  const steps = FIT_STEPS.filter(s => s.dpi >= minDpi); let target = Infinity, best = null;
  for (const st of steps) {
    if (st.dpi > target && st !== steps.at(-1)) continue;
    best = { ...(await buildDossier(items, { ...o, raster: st })), dpi: st.dpi };
    if (best.bytes.length <= maxBytes) return best;
    target = st.dpi * Math.sqrt(maxBytes / best.bytes.length) * 1.05;
  }
  return { ...best, parts: await splitBytesBySize(best.bytes, maxBytes, prog) };
}

/* ---------- Diálogo ---------- */
async function dossierDialog() {
  const cfg = S.settings.dossier || {};
  const items = [];
  // documentos abiertos con páginas, en el orden de las pestañas
  for (const doc of S.docs) if (doc.pages.length) items.push({ title: baseName(doc.name), name: doc.name, doc, size: Object.values(doc.sources).reduce((a, s) => a + (s.bytes?.length || 0), 0) });
  const list = el('div', { class: 'recent-list dossier-list', style: { maxHeight: '230px', overflow: 'auto', minHeight: '60px' } });
  const draw = () => {
    list.innerHTML = '';
    if (!items.length) list.append(el('div', { class: 'cb-empty', text: 'Agregue los documentos del expediente (PDF o imágenes)' }));
    items.forEach((it, i) => {
      const t = el('input', { type: 'text', value: it.title, 'aria-label': 'Título en el índice' }); t.oninput = () => { it.title = t.value; };
      list.append(el('div', { class: 'recent-row' }, el('span', { class: 'src', text: String(i + 1) }), icEl(it.doc ? 'file-check' : isPdfName(it.name) ? 'file-text' : 'image'), t,
        el('span', { class: 'src', text: it.doc ? tr('abierto') : fmtSize(it.bytes.length) }),
        el('button', { class: 'icon-btn sm', html: ic('arrow-up'), title: 'Subir', onclick: () => { if (i) { [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); } } }),
        el('button', { class: 'icon-btn sm', html: ic('arrow-down'), title: 'Bajar', onclick: () => { if (i < items.length - 1) { [items[i + 1], items[i]] = [items[i], items[i + 1]]; draw(); } } }),
        el('button', { class: 'icon-btn sm', html: ic('x'), title: 'Quitar', onclick: () => { items.splice(i, 1); draw(); } })));
    });
  };
  const add = async from => { try { for (const f of await pickFiles(from, true)) items.push({ title: baseName(f.name), name: f.name, bytes: f.bytes, mime: f.mime }); draw(); } catch (e) { toast(e.message, 'err'); } };
  const addOpen = () => {
    const missing = S.docs.filter(d => d.pages.length && !items.some(it => it.doc === d));
    if (!missing.length) { toast('Todos los documentos abiertos ya están en la lista.'); return; }
    missing.forEach(doc => items.push({ title: baseName(doc.name), name: doc.name, doc })); draw();
  };

  // portada
  const preset = el('select', { 'aria-label': 'Tipo de expediente' }); for (const [k, p] of Object.entries(DOSSIER_PRESETS)) preset.append(el('option', { value: k, text: p.label }));
  preset.value = cfg.preset || 'aduana';
  const title = el('input', { type: 'text', 'aria-label': 'Título del expediente' });
  const rows = el('div', { class: 'dossier-fields' });
  const addRow = (lab = '', val = '') => {
    const l = el('input', { type: 'text', value: lab, placeholder: tr('Dato'), 'aria-label': 'Dato' }), v = el('input', { type: 'text', value: val, placeholder: tr('Valor'), 'aria-label': 'Valor' });
    const r = el('div', { class: 'df-row' }, l, v, el('button', { class: 'icon-btn sm', type: 'button', html: ic('x'), title: 'Quitar', onclick: () => r.remove() }));
    rows.append(r);
  };
  const loadPreset = (k, keep) => {
    const p = DOSSIER_PRESETS[k]; rows.innerHTML = '';
    const saved = keep && cfg.preset === k ? cfg.fields : null;
    if (saved?.length) saved.forEach(([l, v]) => addRow(l, v)); else p.fields.forEach(f => addRow(tr(f), ''));
    title.value = (keep && cfg.preset === k && cfg.title) || tr(p.title);
    batesPrefix.value = (keep && cfg.preset === k && cfg.batesPrefix) || p.prefix;
  };
  const notes = el('textarea', { placeholder: tr('Notas u observaciones (opcional)'), 'aria-label': 'Notas', style: { minHeight: '48px' } });
  const color = el('input', { type: 'color', value: cfg.color || '#00866a', 'aria-label': 'Color' });
  let logo = cfg.logo ? { bytes: b64ToU8(cfg.logo.b64), mime: cfg.logo.mime } : null;
  const logoLbl = el('span', { class: 'hint', text: logo ? tr('Logotipo guardado') : tr('Sin logotipo') });
  const pickLogo = async () => {
    try {
      const [f] = await pickFiles('local', false, 'image/*'); if (!f) return;
      let { bytes, mime } = f;
      if (!/png|jpe?g/i.test(mime || f.name)) { const img = await loadImage(URL.createObjectURL(new Blob([bytes], { type: mime }))); const c = el('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); bytes = await canvasToBytes(c, 'image/png'); mime = 'image/png'; }
      if (bytes.length > 600 * 1024) { toast('El logotipo pesa más de 600 KB; use una imagen más pequeña.', 'err'); return; }
      logo = { bytes, mime: /png/i.test(mime || f.name) ? 'image/png' : 'image/jpeg' }; logoLbl.textContent = f.name;
    } catch (e) { toast(e.message, 'err'); }
  };

  // opciones
  const chk = (label, on) => { const i = el('input', { type: 'checkbox' }); i.checked = on; return [i, el('label', { class: 'chk' }, i, el('span', { text: label }))]; };
  const o = cfg.opts || {};
  const [cCover, lCover] = chk('Portada con los datos', o.cover ?? true), [cIndex, lIndex] = chk('Índice con enlaces a cada documento', o.index ?? true);
  const [cOutline, lOutline] = chk('Marcadores por documento', o.outline ?? true), [cBates, lBates] = chk('Numeración Bates en las páginas de los documentos', o.bates ?? true);
  const [cFit, lFit] = chk('Ajustar a un tamaño máximo (MB)', o.fit ?? false);
  const batesPrefix = el('input', { type: 'text', 'aria-label': 'Prefijo Bates', style: { width: '90px' } }), batesStart = el('input', { type: 'number', value: o.start ?? 1, min: 0, 'aria-label': 'Número inicial', style: { width: '80px' } });
  const fitMb = el('input', { type: 'text', value: String(o.fitMb ?? S.settings.fitMb ?? 4), 'aria-label': 'Tamaño máximo (MB)', style: { width: '70px' } });
  const pageSize = el('select', { 'aria-label': 'Tamaño de la portada y el índice' }); for (const [v, l] of [['letter', 'Carta'], ['a4', 'A4'], ['legal', 'Oficio / Legal']]) pageSize.append(el('option', { value: v, text: l })); pageSize.value = o.size || 'letter';
  const nameI = el('input', { type: 'text', 'aria-label': 'Nombre del archivo' });
  preset.onchange = () => loadPreset(preset.value, false);
  loadPreset(preset.value, true);

  const H = t => el('h5', { text: t });
  const body = el('div', { class: 'fm dossier' },
    H('Documentos'),
    el('div', { class: 'inline', style: { marginBottom: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' } },
      el('button', { class: 'btn', type: 'button', html: ic('files') + escapeHtml(tr('Documentos abiertos')), onclick: addOpen }),
      ...(PSN ? [el('button', { class: 'btn', type: 'button', html: ic('folder-open') + escapeHtml(tr('Elegir archivos')), onclick: () => add('local') })] : [
        el('button', { class: 'btn', type: 'button', html: ic('hard-drive') + escapeHtml(tr('Este equipo')), onclick: () => add('local') }),
        el('button', { class: 'btn', type: 'button', html: ic('cloud') + 'OneDrive', onclick: () => add('onedrive') }),
        el('button', { class: 'btn', type: 'button', html: ic('cloud') + 'Google Drive', onclick: () => add('gdrive') })])),
    list,
    H('Portada'),
    el('div', { class: 'cols' }, el('div', { class: 'row' }, el('label', { text: 'Tipo de expediente' }), preset), el('div', { class: 'row' }, el('label', { text: 'Título' }), title)),
    rows, el('button', { class: 'btn sm', type: 'button', html: ic('plus') + escapeHtml(tr('Agregar dato')), onclick: () => addRow() }),
    el('div', { class: 'row', style: { marginTop: '8px' } }, notes),
    el('div', { class: 'inline', style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
      el('button', { class: 'btn sm', type: 'button', html: ic('image-up') + escapeHtml(tr('Logotipo…')), onclick: pickLogo }), logoLbl,
      el('button', { class: 'btn sm', type: 'button', text: 'Quitar logotipo', onclick: () => { logo = null; logoLbl.textContent = tr('Sin logotipo'); } }),
      el('label', { text: 'Color', style: { marginLeft: 'auto' } }), color),
    H('Opciones'),
    lCover, lIndex, lOutline,
    el('div', { class: 'inline', style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, lBates, el('label', { text: 'Prefijo' }), batesPrefix, el('label', { text: 'Desde' }), batesStart),
    el('div', { class: 'inline', style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, lFit, fitMb),
    el('div', { class: 'cols', style: { marginTop: '8px' } }, el('div', { class: 'row' }, el('label', { text: 'Tamaño de la portada y el índice' }), pageSize), el('div', { class: 'row' }, el('label', { text: 'Nombre del archivo' }), nameI)),
    el('div', { class: 'hint', text: 'Los formularios de los documentos se aplanan y sus firmas digitales no se conservan al unirlos: firme el expediente completo al final. Si debe dividirse en partes, cada parte se entrega sin marcadores.' }));
  draw();
  const ok = await openModal({ title: 'Armar expediente', body, wide: true, buttons: [{ label: 'Cancelar', value: false }, { label: 'Armar expediente', primary: true, onClick: () => items.length ? true : (toast('Agregue al menos un documento.', 'err'), false) }] }).result;
  if (!ok) return;
  const fields = $$('.df-row', rows).map(r => $$('input', r).map(i => i.value.trim())).filter(([l, v]) => l || v);
  const opts = { cover: cCover.checked, index: cIndex.checked, outline: cOutline.checked, bates: cBates.checked, fit: cFit.checked, start: +batesStart.value || 0, fitMb: +String(fitMb.value).replace(',', '.') || 4, size: pageSize.value };
  S.settings.dossier = { preset: preset.value, title: title.value, fields, color: color.value, batesPrefix: batesPrefix.value, opts, logo: logo ? { b64: u8ToB64(logo.bytes), mime: logo.mime } : null };
  saveSettings();
  let name = nameI.value.trim() || (title.value.trim() || tr('Expediente')).replace(/[\\/:*?"<>|]+/g, ' ').trim(); if (!isPdfName(name)) name += '.pdf';
  try {
    await withBusy('Armando expediente…', async upd => {
      const src = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i]; upd(`Preparando «${it.title}»…`, (i / items.length) * 5);
        let d = it.doc;
        if (!d) { d = new Doc(it.name); d.pages = await addFileToDoc(d, it.bytes, it.name, it.mime, 'fit'); }
        src.push({ title: it.title.trim() || baseName(it.name), bytes: await buildPdf(d, { noEncrypt: true, flatten: true }) });
      }
      const max = opts.fit ? Math.floor(opts.fitMb * 1024 * 1024) : 0;
      const r = await buildDossierFit(src, { title: title.value.trim(), fields, notes: notes.value, logo, color: color.value, cover: opts.cover, index: opts.index, outline: opts.outline,
        bates: opts.bates ? { prefix: batesPrefix.value, start: opts.start, digits: 6 } : null, size: PAGE_SIZES[opts.size], progress: upd }, max, S.settings.fitMinDpi || 96);
      if (r.parts) {
        const zip = new JSZip();
        r.parts.forEach((p, i) => zip.file(`${baseName(name)}_parte${String(i + 1).padStart(2, '0')}_p${p.from}-${p.to}.pdf`, p.bytes));
        download(await zip.generateAsync({ type: 'blob' }), baseName(name) + '_partes.zip');
        toast(`El expediente no cabe en ${fmtSize(max)} aun comprimido: se descargó en ${r.parts.length} partes.`, 'ok', 9000);
      }
      const nd = await openBytes(name, r.bytes); nd.dirty = true; renderTabs();
      if (opts.outline) { S.side = 'bookmarks'; S.sideOpen = true; renderSide(); }
      if (!r.parts) toast(r.dpi ? `Expediente listo: ${r.pages} páginas, ${fmtSize(r.bytes.length)} (documentos a ${r.dpi} ppp).` : `Expediente listo: ${r.pages} páginas, ${fmtSize(r.bytes.length)}.`, 'ok', 7000);
    });
  } catch (e) { toast(e.message, 'err', 9000); }
}
