/* ============================================================
   04 · Herramientas, interacción con el ratón, panel de propiedades
   ============================================================ */
const CREATE = new Set(['sigbox', 'highlight', 'underline', 'strike', 'note', 'text', 'ink', 'rect', 'ellipse', 'line', 'arrow', 'stamp', 'image', 'whiteout', 'redact', 'field-text', 'field-check', 'field-drop']);
const TOOL_NAMES = {
  select: 'Seleccionar', hand: 'Mano', highlight: 'Resaltar', underline: 'Subrayar', strike: 'Tachar', note: 'Nota', text: 'Cuadro de texto', ink: 'Lápiz',
  rect: 'Rectángulo', ellipse: 'Elipse', line: 'Línea', arrow: 'Flecha', stamp: 'Sello', eraser: 'Borrador', edittext: 'Editar texto', image: 'Imagen',
  whiteout: 'Corrector (tapar)', redact: 'Redactar', 'field-text': 'Campo de texto', 'field-check': 'Casilla', 'field-drop': 'Lista desplegable',
  textedit: 'Texto editado', field: 'Campo de formulario', sigbox: 'Recuadro de firma digital'
};
const STAMPS = ['APROBADO', 'RECIBIDO', 'REVISADO', 'PAGADO', 'VERIFICADO', 'DESPACHADO', 'CONFIDENCIAL', 'URGENTE', 'BORRADOR', 'ORIGINAL', 'COPIA', 'ANULADO', 'RECHAZADO'];
const SWATCHES = ['#111111', '#ffffff', '#d1242f', '#f08c00', '#ffe14d', '#1a7f37', '#1f5fbf', '#8250df', '#ff66c4', '#6b7686'];

function setTool(t) {
  commitEditing();
  if (t !== 'image') S.pendingImage = S.pendingImage && t === 'image' ? S.pendingImage : null;
  S.tool = t;
  if (CREATE.has(t) || t === 'eraser') { const old = S.sel; S.sel = null; if (old) { const p = D()?.page(old.pid); p && renderOverlays(p); } }
  document.body.classList.remove('tool-select', 'tool-hand', 'tool-create', 'tool-eraser', 'tool-edittext');
  document.body.classList.add(CREATE.has(t) ? 'tool-create' : 'tool-' + t);
  refreshEditLayers(); renderRibbonState(); renderProps();
  if (t === 'edittext') toast('Haga clic sobre un texto del PDF para editarlo.');
}
function pagePt(pe, e) { const r = pe.getBoundingClientRect(), s = D().scale; return [(e.clientX - r.left) / s, (e.clientY - r.top) / s]; }
function pageOfEl(pe) { return pe && D()?.page(pe.dataset.pid); }

function selectObj(pid, oid) {
  const d = D(); const prev = S.sel;
  S.sel = oid ? { pid, oid } : null; S.propCk = false;
  if (prev && prev.pid !== pid) { const pp = d.page(prev.pid); pp && renderOverlays(pp); }
  const p = d.page(pid); p && renderOverlays(p);
  renderProps();
}
function clearSel() { if (!S.sel) return; const p = D()?.page(S.sel.pid); S.sel = null; p && renderOverlays(p); renderProps(); }
function selObj() { return S.sel && D()?.obj(S.sel.pid, S.sel.oid); }
function deleteObj(pid, oid) {
  const d = D(), p = d.page(pid); if (!p) return;
  const i = p.ov.findIndex(o => o.id === oid); if (i < 0) return;
  d.checkpoint(); p.ov.splice(i, 1);
  if (S.sel && S.sel.oid === oid) S.sel = null;
  renderOverlays(p); renderProps(); refreshSideIfComments();
}
function duplicateSel() {
  const o = selObj(); if (!o) return; const d = D(), p = d.page(S.sel.pid);
  d.checkpoint(); const c = structuredClone(o); c.id = uid(); c.x += 12; c.y += 12; if (c.type === 'field') c.name = uniqueFieldName(d, c.name);
  p.ov.push(c); selectObj(p.id, c.id);
}
function zorder(dir) {
  const o = selObj(); if (!o) return; const d = D(), p = d.page(S.sel.pid);
  d.checkpoint(); p.ov = p.ov.filter(x => x !== o); dir > 0 ? p.ov.push(o) : p.ov.unshift(o); renderOverlays(p);
}

/* ---------- Eventos del visor ---------- */
function initViewerEvents() {
  const v = viewerEl();
  v.addEventListener('scroll', () => { trackCurrentPage(); });
  v.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); setZoom(e.deltaY < 0 ? 'in' : 'out'); } }, { passive: false });
  v.addEventListener('pointerdown', onViewerDown);
  v.addEventListener('dblclick', onViewerDbl);
  let lastW = 0, lastH = 0;
  new ResizeObserver(() => {
    const w = v.clientWidth, h = v.clientHeight; if (!w || (w === lastW && h === lastH)) return;
    const changed = lastW && (Math.abs(w - lastW) > 2 || Math.abs(h - lastH) > 2); lastW = w; lastH = h;
    const d = D(); if (changed && d && d.view !== 'organize' && typeof d.zoom === 'string') { clearTimeout(R.rz); R.rz = setTimeout(() => renderViewer(true), 120); }
  }).observe($('#viewer-wrap'));
}
function onViewerDown(e) {
  const d = D(); if (!d) return;
  if (e.target.closest('.ffield')) return;
  if (S.editing) {
    if (e.target.closest(`[data-oid="${S.editing}"]`)) return;
    commitEditing(); if (S.tool === 'text') return;
  }
  if (S.tool === 'hand' || e.button === 1) { startPan(e); return; }
  if (e.button !== 0) return;
  const pe = e.target.closest('.page');
  if (S.tool === 'eraser') { const oe = e.target.closest('.ov'); if (oe && pe) deleteObj(pe.dataset.pid, oe.dataset.oid); return; }
  if (S.tool === 'select' || S.tool === 'edittext') {
    const oe = e.target.closest('.ov');
    if (oe && pe) {
      const pid = pe.dataset.pid, oid = oe.dataset.oid;
      if (S.editing === oid) return;
      e.preventDefault();
      const h = e.target.dataset.h;
      if (!S.sel || S.sel.oid !== oid) selectObj(pid, oid);
      startDrag(e, pe, pid, oid, h || 'move');
      return;
    }
    if (S.sel) clearSel();
    return;
  }
  if (CREATE.has(S.tool) && pe) { e.preventDefault(); startCreate(e, pe); }
}
function onViewerDbl(e) {
  const d = D(); if (!d) return;
  const oe = e.target.closest('.ov'), pe = e.target.closest('.page'); if (!oe || !pe) return;
  const p = d.page(pe.dataset.pid), o = p.ov.find(x => x.id === oe.dataset.oid); if (!o) return;
  if (o.type === 'text' || o.type === 'textedit') { startEditing(p, o); }
  else if (o.type === 'note') editNote(p, o);
  else if (o.type === 'field') editFieldProps(p, o);
}
function startPan(e) {
  const v = viewerEl(), sx = e.clientX, sy = e.clientY, st = v.scrollTop, sl = v.scrollLeft;
  v.style.cursor = 'grabbing';
  const mv = ev => { v.scrollTop = st - (ev.clientY - sy); v.scrollLeft = sl - (ev.clientX - sx); };
  const up = () => { v.style.cursor = ''; window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}
const keepAspect = o => o.type === 'image' || o.type === 'stamp' || o.type === 'note';
function setLineAbs(o, x1, y1, x2, y2) {
  const pad = Math.max(4, (o.sw || 2) * 3);
  const L = Math.min(x1, x2) - pad, T = Math.min(y1, y2) - pad, Rr = Math.max(x1, x2) + pad, B = Math.max(y1, y2) + pad;
  Object.assign(o, { x: L, y: T, w: Rr - L, h: B - T, x1: (x1 - L) / (Rr - L), y1: (y1 - T) / (B - T), x2: (x2 - L) / (Rr - L), y2: (y2 - T) / (B - T) });
}
function startDrag(e, pe, pid, oid, mode) {
  const d = D(), p = d.page(pid), o = p.ov.find(x => x.id === oid); if (!o) return;
  const [sx, sy] = pagePt(pe, e), orig = structuredClone(o), snap = d.snap();
  let moved = false;
  const mv = ev => {
    const [x, y] = pagePt(pe, ev), dx = x - sx, dy = y - sy;
    if (!moved && Math.hypot(dx, dy) * d.scale < 3) return; moved = true;
    if (mode === 'move') { o.x = orig.x + dx; o.y = orig.y + dy; }
    else if (mode === 'p1' || mode === 'p2') { let [x1, y1, x2, y2] = lineAbs(orig); if (mode === 'p1') { x1 = x; y1 = y; } else { x2 = x; y2 = y; } setLineAbs(o, x1, y1, x2, y2); }
    else {
      let L = orig.x, T = orig.y, Rr = orig.x + orig.w, B = orig.y + orig.h;
      if (mode.includes('w')) L = Math.min(x, Rr - 4); if (mode.includes('e')) Rr = Math.max(x, L + 4);
      if (mode.includes('n')) T = Math.min(y, B - 4); if (mode.includes('s')) B = Math.max(y, T + 4);
      if (keepAspect(o) && !ev.shiftKey) { const nh = (Rr - L) * orig.h / orig.w; if (mode.includes('n')) T = B - nh; else B = T + nh; }
      Object.assign(o, { x: L, y: T, w: Rr - L, h: B - T });
    }
    const oe = R.els.get(pid)?.ol.querySelector(`[data-oid="${oid}"]`);
    if (oe && mode === 'move') { oe.style.left = o.x * d.scale + 'px'; oe.style.top = o.y * d.scale + 'px'; }
    else renderOverlays(p);
  };
  const up = () => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
    if (moved) { d.undo.push(snap); d.redo = []; d.setDirty(true); renderOverlays(p); renderProps(); }
  };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}

/* ---------- Creación de objetos ---------- */
function uniqueFieldName(d, base = 'Campo') {
  const used = new Set();
  for (const p of d.pages) for (const o of p.ov) if (o.type === 'field') used.add(o.name);
  for (const s of Object.values(d.formOrig)) for (const k of Object.keys(s)) used.add(k);
  base = String(base).replace(/_\d+$/, '') || 'Campo';
  let i = 1, n; do { n = base + '_' + i++; } while (used.has(n));
  return n;
}
function startCreate(e, pe) {
  const d = D(), p = pageOfEl(pe), t = S.tool, opt = S.toolOpts[t] || {};
  const parts = R.els.get(p.id), s = d.scale;
  const [x0, y0] = pagePt(pe, e);
  const pts = [[x0, y0]];
  let rb = null, inkPath = null, x1 = x0, y1 = y0;
  if (t === 'ink') {
    inkPath = el('div', { style: { position: 'absolute', inset: 0 } });
    inkPath.innerHTML = `<svg style="position:absolute;inset:0;width:100%;height:100%;overflow:visible"><path fill="none" stroke="${opt.color}" stroke-width="${opt.sw * s}" stroke-linecap="round" stroke-linejoin="round" opacity="${opt.opacity ?? 1}"/></svg>`;
    parts.sl.append(inkPath);
  } else {
    rb = el('div', { class: 'rubber' }); parts.sl.append(rb);
  }
  const draw = () => {
    if (t === 'ink') { inkPath.querySelector('path').setAttribute('d', smoothPath(pts.map(q => [q[0] * s, q[1] * s]))); return; }
    if (t === 'line' || t === 'arrow') {
      rb.style.cssText = 'position:absolute;inset:0;border:0;background:none';
      rb.innerHTML = `<svg style="position:absolute;inset:0;width:100%;height:100%;overflow:visible"><line x1="${x0 * s}" y1="${y0 * s}" x2="${x1 * s}" y2="${y1 * s}" stroke="${opt.color}" stroke-width="${opt.sw * s}" stroke-linecap="round"/></svg>`;
      return;
    }
    Object.assign(rb.style, { left: Math.min(x0, x1) * s + 'px', top: Math.min(y0, y1) * s + 'px', width: Math.abs(x1 - x0) * s + 'px', height: Math.abs(y1 - y0) * s + 'px' });
    if (t === 'highlight') rb.style.background = opt.color + '66';
  };
  const mv = ev => {
    [x1, y1] = pagePt(pe, ev);
    if (t === 'ink') { const l = pts[pts.length - 1]; if (Math.hypot(x1 - l[0], y1 - l[1]) > 0.8) pts.push([x1, y1]); }
    draw();
  };
  const up = async () => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
    rb && rb.remove(); inkPath && inkPath.remove();
    const r = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
    const dragged = r.w > 4 || r.h > 4;
    await finishCreate(p, t, opt, r, dragged, { x0, y0, x1, y1, pts });
  };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}
async function finishCreate(p, t, opt, r, dragged, g) {
  const d = D(); const add = [];
  const base = () => ({ id: uid() });
  switch (t) {
    case 'highlight': case 'underline': case 'strike': {
      const rects = await snapTextRects(d, p, g);
      if (rects.length) for (const q of rects) add.push({ ...base(), type: t, ...(t === 'highlight' ? q : t === 'underline' ? { x: q.x, y: q.y + q.h * 0.62, w: q.w, h: q.h * 0.38 } : { x: q.x, y: q.y + q.h * 0.25, w: q.w, h: q.h * 0.5 }), color: opt.color, opacity: opt.opacity, sw: opt.sw });
      else if (dragged) add.push({ ...base(), type: t, x: r.x, y: r.y, w: Math.max(r.w, 4), h: Math.max(r.h, 4), color: opt.color, opacity: opt.opacity, sw: opt.sw });
      break;
    }
    case 'rect': case 'ellipse': case 'whiteout': case 'redact':
      if (!dragged) { if (t === 'redact' || t === 'whiteout') break; r = { x: r.x - 40, y: r.y - 25, w: 80, h: 50 }; }
      add.push({ ...base(), type: t, ...r, color: opt.color, fill: opt.fill || '', sw: opt.sw, opacity: opt.opacity });
      break;
    case 'line': case 'arrow': {
      if (Math.hypot(g.x1 - g.x0, g.y1 - g.y0) < 3) break;
      const o = { ...base(), type: t, color: opt.color, sw: opt.sw, opacity: opt.opacity }; setLineAbs(o, g.x0, g.y0, g.x1, g.y1); add.push(o); break;
    }
    case 'ink': {
      if (g.pts.length < 2) break;
      const pad = opt.sw;
      const xs = g.pts.map(q => q[0]), ys = g.pts.map(q => q[1]);
      const L = Math.min(...xs) - pad, T = Math.min(...ys) - pad, W = Math.max(...xs) - L + pad, H = Math.max(...ys) - T + pad;
      add.push({ ...base(), type: 'ink', x: L, y: T, w: W, h: H, pts: g.pts.map(([x, y]) => [n2((x - L) / W * 1e4) / 1e4, n2((y - T) / H * 1e4) / 1e4]), color: opt.color, sw: opt.sw, opacity: opt.opacity });
      break;
    }
    case 'text': {
      const o = { ...base(), type: 'text', text: '', size: opt.size, color: opt.color, font: opt.font, bold: opt.bold, italic: opt.italic, align: opt.align, bg: opt.bg, border: opt.border, pad: 2 };
      Object.assign(o, dragged && r.w > 12 ? { x: r.x, y: r.y, w: r.w, h: Math.max(r.h, o.size * 1.2 + 4) } : { x: r.x, y: r.y - o.size * 0.6, w: 200, h: o.size * 1.2 + 4 });
      S.editSnap = d.snap(); p.ov.push(o); S.sel = { pid: p.id, oid: o.id }; S.editing = o.id; renderOverlays(p); renderProps();
      return;
    }
    case 'note': {
      const o = { ...base(), type: 'note', x: r.x - 10, y: r.y - 10, w: 22, h: 22, color: opt.color, text: '', author: S.settings.author || '' };
      const txt = await noteDialog('', o.author); if (txt == null) return;
      o.text = txt.text; o.author = txt.author; add.push(o); break;
    }
    case 'stamp': {
      const label = opt.label || 'APROBADO', h = opt.date ? 46 : 38;
      const w = metricWidth(label, 'Helvetica', true, false, h * (opt.date ? 0.36 : 0.46)) + h * 0.7;
      const o = { ...base(), type: 'stamp', label, color: opt.color, date: !!opt.date, dateText: todayStr() };
      Object.assign(o, dragged && r.w > 20 ? { x: r.x, y: r.y, w: r.w, h: r.w * h / w } : { x: r.x - w / 2, y: r.y - h / 2, w, h });
      add.push(o); break;
    }
    case 'image': {
      const pi = S.pendingImage; if (!pi) { toast('Primero elija una imagen o firma.', 'err'); return; }
      const ar = pi.h / pi.w; const w = dragged && r.w > 10 ? r.w : Math.min(pi.defW || 200, pi.w * 0.75);
      const o = { ...base(), type: 'image', asset: pi.asset, x: dragged ? r.x : r.x - w / 2, y: dragged ? r.y : r.y - w * ar / 2, w, h: w * ar, opacity: 1 };
      d.checkpoint(); p.ov.push(o); S.pendingImage = null; setTool('select'); selectObj(p.id, o.id); return;
    }
    case 'sigbox': {
      if (!dragged || r.w < 40 || r.h < 18) { toast('Arrastre para dibujar un recuadro (mínimo 40 × 18 pt).', 'err'); return; }
      const opts = S.pendingSign; S.pendingSign = null; setTool('select');
      if (opts) await performSign(D(), opts, p, r);
      return;
    }
    case 'field-text': case 'field-drop': case 'field-check': {
      const ft = t.split('-')[1];
      if (!dragged) r = ft === 'check' ? { x: r.x - 7, y: r.y - 7, w: 14, h: 14 } : { x: r.x, y: r.y - 9, w: 150, h: 18 };
      add.push({ ...base(), type: 'field', ftype: ft, name: uniqueFieldName(d, ft === 'check' ? 'Casilla' : ft === 'drop' ? 'Lista' : 'Campo'), ...r, multiline: !!opt.multiline, options: opt.options || '' });
      break;
    }
  }
  if (!add.length) return;
  d.checkpoint(); p.ov.push(...add);
  renderOverlays(p);
  if (add.length === 1 && !['highlight', 'underline', 'strike', 'ink'].includes(t)) selectObj(p.id, add[0].id);
  refreshSideIfComments();
}
/** Ajusta resaltado/subrayado a las líneas de texto entre el punto inicial y final */
async function snapTextRects(d, p, g) {
  const runs = await textItems(d, p); if (!runs.length) return [];
  let A = [g.x0, g.y0], B = [g.x1, g.y1];
  const top = Math.min(A[1], B[1]) - 1, bot = Math.max(A[1], B[1]) + 1;
  const hit = runs.filter(r => r.y < bot && r.y + r.h > top && (r.x + r.w > Math.min(A[0], B[0]) - 2 || r.y + r.h < bot - 2));
  if (!hit.length) return [];
  // agrupar por línea
  const lines = [];
  for (const r of hit.sort((a, b) => a.base - b.base || a.x - b.x)) {
    const l = lines.find(L => Math.abs(L.base - r.base) < r.size * 0.4);
    if (l) { l.x1 = Math.min(l.x1, r.x); l.x2 = Math.max(l.x2, r.x + r.w); l.y1 = Math.min(l.y1, r.y); l.y2 = Math.max(l.y2, r.y + r.h); }
    else lines.push({ base: r.base, x1: r.x, x2: r.x + r.w, y1: r.y, y2: r.y + r.h });
  }
  lines.sort((a, b) => a.base - b.base);
  if (A[1] > B[1]) [A, B] = [B, A];
  const out = [];
  lines.forEach((l, i) => {
    let a = l.x1, b = l.x2;
    if (lines.length === 1) { a = Math.max(a, Math.min(A[0], B[0])); b = Math.min(b, Math.max(A[0], B[0])); }
    else if (i === 0) a = Math.max(a, A[0]);
    else if (i === lines.length - 1) b = Math.min(b, B[0]);
    if (b - a > 1.5) out.push({ x: a, y: l.y1 + (l.y2 - l.y1) * 0.06, w: b - a, h: (l.y2 - l.y1) * 0.9 });
  });
  return out;
}

/* ---------- Edición de texto ---------- */
function startEditing(p, o) { S.editSnap = D().snap(); S.sel = { pid: p.id, oid: o.id }; S.editing = o.id; renderOverlays(p); renderProps(); }
function commitEditing() {
  if (!S.editing) return;
  const d = D(); const id = S.editing; S.editing = null;
  if (!d) return;
  let p = null, o = null;
  for (const pg of d.pages) { const x = pg.ov.find(q => q.id === id); if (x) { p = pg; o = x; break; } }
  if (!o) return;
  const e = R.els.get(p.id)?.ol.querySelector(`[data-oid="${id}"]`);
  let txt = e ? (o.type === 'textedit' ? e.textContent.replace(/\n/g, ' ') : e.innerText).replace(/ /g, ' ').replace(/\n$/, '') : o.text;
  const changed = txt !== o.text;
  if (!txt.trim() && o.type === 'text') { p.ov = p.ov.filter(x => x !== o); S.sel = null; if (S.editSnap && o.text) { d.undo.push(S.editSnap); d.redo = []; d.setDirty(true); } }
  else {
    o.text = txt;
    fitTextBox(o);
    if (changed || o.type === 'textedit') { if (S.editSnap) d.undo.push(S.editSnap); d.redo = []; d.setDirty(true); }
  }
  S.editSnap = null;
  renderOverlays(p); renderProps(); refreshSideIfComments();
}
function fitTextBox(o) {
  const pad = o.pad ?? 2;
  if (o.type === 'textedit') {
    const lines = o.text.split('\n');
    const w = Math.max(...lines.map(l => metricWidth(l, o.font, o.bold, o.italic, o.size))) + 2;
    o.w = Math.max(o.w, w); o.h = Math.max(o.h, lines.length * o.size * 1.2);
  } else if (o.type === 'text' && !o.rotate) {
    const lines = wrapText(o.text, o.font, o.bold, o.italic, o.size, o.w - 2 * pad);
    o.h = Math.max(o.h, lines.length * o.size * 1.2 + 2 * pad);
  }
}
function sampleColors(d, p, r) {
  const parts = R.els.get(p.id); const cv = parts && parts.canvas;
  if (!cv) return { bg: '#ffffff', fg: '#000000' };
  const [W] = dims(p), k = cv.width / W;
  const X = Math.max(0, Math.floor((r.x - 2) * k)), Y = Math.max(0, Math.floor((r.y - 2) * k));
  const Wd = Math.min(cv.width - X, Math.ceil((r.w + 4) * k)), Hd = Math.min(cv.height - Y, Math.ceil((r.h + 4) * k));
  if (Wd < 2 || Hd < 2) return { bg: '#ffffff', fg: '#000000' };
  let data; try { data = cv.getContext('2d').getImageData(X, Y, Wd, Hd).data; } catch { return { bg: '#ffffff', fg: '#000000' }; }
  const at = (x, y) => { const i = (y * Wd + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const counts = new Map();
  const bump = c => { const key = c.map(v => v >> 3).join(','); const e = counts.get(key) || { n: 0, c }; e.n++; counts.set(key, e); };
  for (let x = 0; x < Wd; x++) { bump(at(x, 0)); bump(at(x, Hd - 1)); }
  for (let y = 0; y < Hd; y++) { bump(at(0, y)); bump(at(Wd - 1, y)); }
  const bg = [...counts.values()].sort((a, b) => b.n - a.n)[0].c;
  let best = null, bd = -1;
  for (let y = 2; y < Hd - 2; y += 1) for (let x = 2; x < Wd - 2; x += 1) {
    const c = at(x, y), dd = Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]);
    if (dd > bd) { bd = dd; best = c; }
  }
  return { bg: rgbToHex(...bg), fg: best && bd > 60 ? rgbToHex(...best) : '#000000' };
}
function guessFont(d, p, run, pg) {
  let fam = 'Helvetica', bold = false, italic = false;
  const st = run.style || {};
  if (st.fontFamily === 'serif') fam = 'Times'; else if (st.fontFamily === 'monospace') fam = 'Courier';
  try {
    const objs = pg && pg.commonObjs;
    if (objs && objs.has(run.fontName)) {
      const f = objs.get(run.fontName); const n = (f.name || f.loadedName || '') + ' ' + (f.fallbackName || '');
      if (/bold|black|heavy|semibold|demi/i.test(n)) bold = true;
      if (/italic|oblique/i.test(n)) italic = true;
      if (/times|serif|georgia|garamond|cambria|book/i.test(f.name || '') && !/sans/i.test(f.name || '')) fam = 'Times';
      if (/courier|mono|consol/i.test(f.name || '')) fam = 'Courier';
      if (/arial|helvetica|calibri|verdana|tahoma|segoe|sans/i.test(f.name || '')) fam = 'Helvetica';
      // detección de la fuente real: buscarla entre las fuentes del equipo
      if (S.settings.detectFonts !== false) { const mt = matchSystemFont(f.name || ''); if (mt) { fam = mt.family; bold = bold || mt.bold; italic = italic || mt.italic; } }
    }
  } catch (e) { console.warn('detección de fuente', e); }
  return { fam, bold, italic };
}
async function startTextEdit(p, run) {
  const d = D();
  const src = d.sources[p.src];
  const pg = src && src.kind === 'pdf' ? await src.pdf.getPage(p.idx + 1) : null;
  const cx = run.x + run.w / 2, cy = run.base - run.size * 0.3;
  const ex = p.ov.find(o => o.type === 'textedit' && cx > o.x && cx < o.x + o.w && cy > o.y && cy < o.y + o.h);
  if (ex) { startEditing(p, ex); return; }
  const { fam, bold, italic } = guessFont(d, p, run, pg);
  if (!isStdFont(fam)) await ensureFont(fam, bold, italic);
  const size = run.size;
  const box = { x: run.x - 1, y: run.base - baselineOf(fam, bold, italic) * size, w: run.w + 2, h: size * 1.2 };
  const col = sampleColors(d, p, box);
  const o = { id: uid(), type: 'textedit', ...box, text: run.str, size: n2(size), font: fam, bold, italic, color: col.fg, bg: col.bg, pad: 0, origW: box.w };
  S.editSnap = d.snap(); p.ov.push(o); S.sel = { pid: p.id, oid: o.id }; S.editing = o.id;
  renderOverlays(p); renderProps();
}
async function noteDialog(text, author) {
  const v = await formDialog('Nota / comentario', [{ key: 'text', label: 'Comentario', type: 'textarea', value: text }, { key: 'author', label: 'Autor', value: author }], { ok: 'Guardar' });
  if (v) { if (v.author && v.author !== S.settings.author) { S.settings.author = v.author; saveSettings(); } }
  return v;
}
async function editNote(p, o) {
  const v = await noteDialog(o.text, o.author); if (!v) return;
  D().checkpoint(); o.text = v.text; o.author = v.author; renderOverlays(p); renderProps(); refreshSideIfComments();
}
async function editFieldProps(p, o) {
  const d = D();
  const v = await formDialog('Propiedades del campo', [
    { key: 'name', label: 'Nombre del campo', value: o.name },
    ...(o.ftype === 'text' ? [{ key: 'multiline', label: 'Varias líneas', type: 'checkbox', value: o.multiline }, { key: 'value', label: 'Valor inicial', value: o.value || '' }] : []),
    ...(o.ftype === 'drop' ? [{ key: 'options', label: 'Opciones (una por línea)', type: 'textarea', value: o.options }] : []),
    ...(o.ftype === 'check' ? [{ key: 'checked', label: 'Marcada por defecto', type: 'checkbox', value: o.checked }] : [])
  ], { validate: v => !v.name.trim() ? 'El nombre es obligatorio' : null });
  if (!v) return;
  d.checkpoint(); Object.assign(o, v); o.name = v.name.trim(); renderOverlays(p); renderProps();
}

/* ---------- Panel de propiedades ---------- */
function renderProps() {
  const box = $('#props-body'), d = D();
  $('#props').classList.toggle('hidden', !d || d.view === 'organize');
  box.innerHTML = '';
  if (!d) return;
  const o = selObj();
  const kind = o ? o.type : S.tool;
  const target = o || S.toolOpts[kind];
  const pp = el('div', { class: 'pp' });
  pp.append(el('h4', { text: o ? (TOOL_NAMES[o.type] || o.type) : TOOL_NAMES[S.tool] || '' }));
  const set = (k, v) => {
    if (o) {
      if (!S.propCk) { d.checkpoint(); S.propCk = true; }
      o[k] = v; if (k === 'sw' && (o.type === 'line' || o.type === 'arrow')) { const a = lineAbs(o); setLineAbs(o, ...a); }
      if (k === 'size' || k === 'font' || k === 'bold') fitTextBox(o);
      const p = d.page(S.sel.pid); renderOverlays(p);
      if (S.toolOpts[o.type] && k in S.toolOpts[o.type]) { S.toolOpts[o.type][k] = v; saveToolOpts(); }
    } else if (S.toolOpts[kind]) { S.toolOpts[kind][k] = v; saveToolOpts(); }
  };
  const has = k => target && k in target;
  const colorRow = (label, k, allowNone) => {
    const cur = target[k] || '';
    const sw = el('div', { class: 'swatches' });
    const pick = el('input', { type: 'color', value: cur && cur.startsWith('#') && cur.length === 7 ? cur : '#000000', title: 'Otro color' });
    const mark = v => $$('.sw', sw).forEach(x => x.classList.toggle('on', x.dataset.c === v));
    if (allowNone) sw.append(el('div', { class: 'sw', title: 'Ninguno', dataset: { c: '' }, style: { background: 'linear-gradient(135deg,#fff 45%,#d1242f 47%,#d1242f 53%,#fff 55%)' }, onclick: () => { set(k, ''); mark(''); } }));
    for (const c of SWATCHES) sw.append(el('div', { class: 'sw', dataset: { c }, style: { background: c }, onclick: () => { set(k, c); mark(c); pick.value = c; } }));
    pick.oninput = () => { set(k, pick.value); mark(pick.value); };
    sw.append(pick); mark(cur);
    pp.append(el('div', { class: 'row' }, el('label', { text: label }), sw));
  };
  const rangeRow = (label, k, min, max, step, fmt = v => v) => {
    const out = el('span', { class: 'muted', text: fmt(target[k]) });
    const r = el('input', { type: 'range', min, max, step, value: target[k] ?? min });
    r.oninput = () => { set(k, +r.value); out.textContent = fmt(+r.value); };
    pp.append(el('div', { class: 'row' }, el('label', {}, label + ' ', out), r));
  };
  if (has('font')) {
    const sel = el('select');
    const fams = fontFamilies(), def = defaultFont();
    const g1 = el('optgroup', { label: 'Predeterminada' }); g1.append(el('option', { value: def, text: (STD_LABEL[def] || def) + ' (predeterminada)' })); sel.append(g1);
    const g2 = el('optgroup', { label: 'Estándar PDF' }); for (const f of STD_FONTS) if (f !== def) g2.append(el('option', { value: f, text: STD_LABEL[f] })); sel.append(g2);
    if (fams.length) { const g3 = el('optgroup', { label: 'Fuentes del equipo' }); for (const f of fams) if (f !== def) g3.append(el('option', { value: f, text: f })); sel.append(g3); }
    if (target.font && ![...sel.options].some(x => x.value === target.font)) sel.append(el('option', { value: target.font, text: target.font + ' (no instalada)' }));
    sel.append(el('option', { value: '__more', text: FONTS.provider ? 'Agregar fuente desde archivo…' : 'Cargar fuentes del equipo…' }));
    sel.value = target.font || def;
    sel.onchange = async () => {
      if (sel.value === '__more') { sel.value = target.font || def; if (FONTS.provider) await addUserFont(); else await loadLocalFonts(false); renderProps(); return; }
      if (!o && kind === 'text') S.toolOpts.text._fontSet = true;
      if (!isStdFont(sel.value)) await ensureFont(sel.value, target.bold, target.italic);
      set('font', sel.value);
    };
    const size = el('input', { type: 'number', min: 4, max: 200, step: 0.5, value: target.size, style: { width: '70px' } }); size.onchange = () => set('size', +size.value);
    const b = el('button', { class: 'btn sm' + (target.bold ? ' primary' : ''), html: '<b>N</b>', title: 'Negrita' }); b.onclick = () => { set('bold', !target.bold); b.classList.toggle('primary'); };
    const it = el('button', { class: 'btn sm' + (target.italic ? ' primary' : ''), html: '<i>K</i>', title: 'Cursiva' }); it.onclick = () => { set('italic', !target.italic); it.classList.toggle('primary'); };
    pp.append(el('div', { class: 'row' }, el('label', { text: 'Fuente' }), sel), el('div', { class: 'row' }, el('label', { text: 'Tamaño y estilo' }), el('div', { class: 'inline' }, size, b, it)));
  }
  if (has('align') && kind === 'text') {
    const seg = el('div', { class: 'seg' });
    for (const [a, l] of [['left', 'Izq.'], ['center', 'Centro'], ['right', 'Der.']]) { const bt = el('button', { text: l, class: target.align === a ? 'on' : '' }); bt.onclick = () => { set('align', a); $$('button', seg).forEach(x => x.classList.toggle('on', x === bt)); }; seg.append(bt); }
    pp.append(el('div', { class: 'row' }, el('label', { text: 'Alineación' }), seg));
  }
  if (kind === 'stamp') {
    const sel = el('select'); for (const s of STAMPS) sel.append(el('option', { value: s, text: s })); sel.append(el('option', { value: '__custom', text: 'Personalizado…' }));
    const custom = el('input', { type: 'text', placeholder: 'Texto del sello', value: STAMPS.includes(target.label) ? '' : target.label });
    sel.value = STAMPS.includes(target.label) ? target.label : '__custom'; custom.style.display = sel.value === '__custom' ? '' : 'none';
    sel.onchange = () => { custom.style.display = sel.value === '__custom' ? '' : 'none'; if (sel.value !== '__custom') set('label', sel.value); };
    custom.onchange = () => custom.value.trim() && set('label', custom.value.trim().toUpperCase());
    pp.append(el('div', { class: 'row' }, el('label', { text: 'Sello' }), sel, custom));
    const ck = el('input', { type: 'checkbox' }); ck.checked = !!target.date; ck.onchange = () => set('date', ck.checked);
    pp.append(el('label', { class: 'inline', style: { marginBottom: '10px' } }, ck, 'Incluir fecha'));
  }
  if (has('color')) colorRow(kind === 'rect' || kind === 'ellipse' ? 'Color del borde' : kind === 'whiteout' ? 'Color de relleno' : 'Color', 'color');
  if (has('fill') && (kind === 'rect' || kind === 'ellipse')) colorRow('Relleno', 'fill', true);
  if (has('bg') && (kind === 'text' || kind === 'textedit')) colorRow('Fondo', 'bg', true);
  if (has('border') && kind === 'text') colorRow('Borde', 'border', true);
  if (has('sw')) rangeRow('Grosor', 'sw', 0.5, 12, 0.5, v => v + ' pt');
  if (has('opacity') && kind !== 'whiteout') rangeRow('Opacidad', 'opacity', 0.1, 1, 0.05, v => Math.round((v ?? 1) * 100) + ' %');
  if (o && o.type === 'note') {
    const ta = el('textarea'); ta.value = o.text || ''; ta.onchange = () => { set('text', ta.value); refreshSideIfComments(); };
    pp.append(el('div', { class: 'row' }, el('label', { text: 'Comentario' + (o.author ? ' — ' + o.author : '') }), ta));
  }
  if (o && o.type === 'field') {
    pp.append(el('div', { class: 'hint', html: `Campo <b>${escapeHtml(o.name)}</b>. Doble clic para cambiar nombre y opciones. Se convierte en un campo rellenable al guardar.` }));
    pp.append(el('button', { class: 'btn sm', text: 'Propiedades…', style: { marginTop: '8px' }, onclick: () => editFieldProps(d.page(S.sel.pid), o) }));
  }
  if (!o && kind === 'field-drop') {
    const ta = el('textarea'); ta.value = target.options; ta.onchange = () => set('options', ta.value);
    pp.append(el('div', { class: 'row' }, el('label', { text: 'Opciones (una por línea)' }), ta));
  }
  if (!o && kind === 'field-text') { const ck = el('input', { type: 'checkbox' }); ck.checked = !!target.multiline; ck.onchange = () => set('multiline', ck.checked); pp.append(el('label', { class: 'inline' }, ck, 'Varias líneas')); }
  if (kind === 'redact') pp.append(el('div', { class: 'hint', html: 'Marque las zonas a ocultar. <b>Al guardar</b>, las páginas afectadas se convierten en imagen para eliminar de forma permanente el texto e imágenes que quedan debajo.' }));
  if (kind === 'textedit') pp.append(el('div', { class: 'hint', html: 'El texto original queda tapado con el color de fondo detectado y se escribe el texto nuevo encima. Doble clic para seguir editando.' }));
  if (kind === 'image' && !o) pp.append(el('div', { class: 'hint', text: 'Haga clic en la página para colocar la imagen, o arrastre para definir su tamaño.' }));
  if (kind === 'edittext') pp.append(el('div', { class: 'hint', html: 'Pase el ratón sobre el texto del documento: los bloques editables se marcan en azul. Haga clic para modificarlos.<br><br>Funciona mejor con PDFs generados digitalmente. Para documentos escaneados use primero <b>OCR</b>.' }));
  if (kind === 'select' && !o) pp.append(el('div', { class: 'hint', html: `Seleccione un objeto para editar sus propiedades.<br><br><span class="kbd">Supr</span> eliminar · <span class="kbd">Ctrl+D</span> duplicar · flechas para mover · <span class="kbd">Ctrl+Z</span> deshacer · <span class="kbd">Ctrl+S</span> guardar · <span class="kbd">Ctrl+F</span> buscar` }));
  if (kind === 'sigbox') pp.append(el('div', { class: 'hint', text: 'Arrastre en la página para definir dónde se verá la firma digital. Esc para cancelar.' }));
  if (kind === 'eraser') pp.append(el('div', { class: 'hint', text: 'Haga clic sobre cualquier anotación para eliminarla.' }));
  if (o) {
    pp.append(el('div', { class: 'inline', style: { marginTop: '14px' } },
      el('button', { class: 'btn sm', html: ic('copy') + 'Duplicar', onclick: duplicateSel }),
      el('button', { class: 'btn sm', html: ic('arrow-up') , title: 'Traer al frente', onclick: () => zorder(1) }),
      el('button', { class: 'btn sm', html: ic('arrow-down'), title: 'Enviar atrás', onclick: () => zorder(-1) }),
      el('button', { class: 'btn sm danger', html: ic('trash-2') + 'Eliminar', onclick: () => deleteObj(S.sel.pid, S.sel.oid) })));
    if (o.group) pp.append(el('div', { class: 'hint', style: { marginTop: '8px' }, text: 'Este elemento pertenece a un grupo aplicado a varias páginas (marca de agua, encabezado, numeración…). Para quitarlo en todas, use el mismo comando del menú.' }));
  }
  box.append(pp);
}
