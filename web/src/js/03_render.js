/* ============================================================
   03 · Visor: pestañas, páginas, capas, miniaturas
   ============================================================ */
const FONT_CSS = { Helvetica: 'Helvetica, Arial, sans-serif', Times: '"Times New Roman", Times, serif', Courier: '"Courier New", Courier, monospace' };
const BASELINE = { Helvetica: 0.9465, Times: 0.9375, Courier: 0.8665 };
const viewerEl = () => $('#viewer');
const pagesEl = () => $('#pages');
const R = { gen: 0, els: new Map(), io: null, running: 0, thumbCache: new Map(), thumbIO: null };

function renderTabs() {
  const box = $('#doctabs'); box.innerHTML = '';
  const home = el('div', { class: 'doctab' + (!S.active ? ' active' : ''), title: 'Inicio', onclick: () => activateDoc(null) }, icEl('house'));
  box.append(home);
  for (const d of S.docs) {
    const t = el('div', { class: 'doctab' + (d === S.active ? ' active' : ''), title: d.name + (d.cloud ? ' — ' + (d.cloud.provider === 'onedrive' ? 'OneDrive' : 'Google Drive') : ''), onclick: () => activateDoc(d) },
      d.cloud ? icEl('cloud') : d.nativePath ? null : null,
      el('span', { class: 'nm', text: d.name }), d.dirty ? el('span', { class: 'dirty', title: 'Cambios sin guardar' }) : null,
      el('button', { class: 'x', html: ic('x'), title: 'Cerrar', onclick: e => { e.stopPropagation(); closeDoc(d); } }));
    box.append(t);
  }
  document.title = (S.active ? (S.active.dirty ? '• ' : '') + S.active.name + ' — ' : '') + 'Rúbrica';
}
function activateDoc(doc) {
  const prev = S.active;
  if (prev) { prev.scrollTop = viewerEl().scrollTop; prev.scrollLeft = viewerEl().scrollLeft; }
  commitEditing(); S.active = doc; S.sel = null;
  renderTabs(); renderRibbon(); renderSide(); renderProps(); renderViewer();
}
async function closeDoc(doc) {
  if (doc.dirty && !(await confirmDialog('Cerrar documento', `«${escapeHtml(doc.name)}» tiene cambios sin guardar. ¿Cerrar de todas formas?`, 'Cerrar sin guardar', true))) return;
  const i = S.docs.indexOf(doc); S.docs.splice(i, 1);
  if (S.active === doc) activateDoc(S.docs[Math.min(i, S.docs.length - 1)] || null); else renderTabs();
}

function setViewMode(mode) {
  const d = D(); if (d) d.view = mode;
  renderSide(); renderProps(); renderViewer(); renderRibbon();
}
function computeScale(d) {
  const v = viewerEl(); const vw = Math.max(200, v.clientWidth - 70), vh = Math.max(200, v.clientHeight - 40);
  if (!d.pages.length) return 1;
  if (d.zoom === 'fitw') { const mw = Math.max(...d.pages.map(p => dims(p)[0])); return clamp(vw / mw, 0.1, 8); }
  if (d.zoom === 'fitp') { const p = d.pages[d.cur] || d.pages[0]; const [w, h] = dims(p); return clamp(Math.min(vw / w, vh / h), 0.1, 8); }
  return clamp(d.zoom / 100 * PX_PER_PT, 0.1, 8);
}
function renderViewer(keepScroll) {
  const wrap = $('#viewer-wrap'), d = D();
  wrap.className = !d ? 'mode-home' : (d.view === 'organize' ? 'mode-organize' : '');
  R.gen++; R.els.clear(); if (R.io) R.io.disconnect();
  pagesEl().innerHTML = '';
  if (!d) { renderHome(); updateStatus(); return; }
  if (d.view === 'organize') { renderOrganizer(); updateStatus(); return; }
  const v = viewerEl();
  const anchor = keepScroll ? captureAnchor() : null;
  d.scale = computeScale(d);
  const s = d.scale;
  R.io = new IntersectionObserver(onPagesVisible, { root: v, rootMargin: '800px 0px' });
  d.pages.forEach((p, i) => {
    const [w, h] = dims(p);
    const pe = el('div', { class: 'page', dataset: { pid: p.id }, style: { width: w * s + 'px', height: h * s + 'px', overflow: p.crop ? 'hidden' : 'visible' } },
      el('div', { class: 'pnum', text: i + 1 }));
    const parts = { pe, canvas: null, tl: null, ol: el('div', { class: 'olayer' }), fl: el('div', { class: 'flayer' }), el: el('div', { class: 'elayer' }), sl: el('div', { class: 'slayer' }), scale: 0, visible: false, task: null };
    parts.el.style.display = 'none';
    pe.append(parts.ol, parts.fl, parts.el, parts.sl);
    R.els.set(p.id, parts);
    pagesEl().append(pe);
    renderOverlays(p);
    R.io.observe(pe);
  });
  if (anchor) restoreAnchor(anchor);
  else if (d.scrollTop != null) { v.scrollTop = d.scrollTop; v.scrollLeft = d.scrollLeft || 0; }
  updateStatus(); applySearchHighlights();
}
function captureAnchor() {
  const d = D(), v = viewerEl(); const p = d.pages[d.cur]; const parts = p && R.els.get(p.id);
  if (!parts) return null;
  return { pid: p.id, frac: (v.scrollTop - parts.pe.offsetTop) / Math.max(1, parts.pe.offsetHeight), fx: (v.scrollLeft + v.clientWidth / 2) / Math.max(1, v.scrollWidth) };
}
function restoreAnchor(a) {
  const parts = R.els.get(a.pid), v = viewerEl(); if (!parts) return;
  v.scrollTop = parts.pe.offsetTop + a.frac * parts.pe.offsetHeight;
  v.scrollLeft = a.fx * v.scrollWidth - v.clientWidth / 2;
}
function onPagesVisible(entries) {
  for (const en of entries) {
    const pid = en.target.dataset.pid, parts = R.els.get(pid);
    if (parts) parts.visible = en.isIntersecting;
  }
  pumpRender();
}
async function pumpRender() {
  const d = D(); if (!d || d.view === 'organize') return;
  const gen = R.gen;
  while (R.running < 2) {
    const p = d.pages.find(p => { const x = R.els.get(p.id); return x && x.visible && x.scale !== d.scale && !x.task; });
    if (!p) return;
    const parts = R.els.get(p.id);
    R.running++;
    parts.task = renderPageCanvas(d, p, parts, gen).catch(e => { if (!/cancel/i.test(e?.name + e?.message)) console.warn(e); })
      .finally(() => { R.running--; parts.task = null; if (gen === R.gen) pumpRender(); });
  }
}
/** Dibuja la página (contenido base) en un canvas */
async function drawPage(doc, p, scale, canvas, dprCap = 2) {
  const [W, H] = dims(p), dpr = Math.min(window.devicePixelRatio || 1, dprCap);
  const k = scale * dpr;
  canvas.width = Math.max(1, Math.ceil(W * k)); canvas.height = Math.max(1, Math.ceil(H * k));
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const c = cropDisp(p), src = doc.sources[p.src];
  if (src && src.kind === 'pdf') {
    const pg = await src.pdf.getPage(p.idx + 1);
    const vp = pg.getViewport({ scale: k, rotation: rotT(p) });
    const task = pg.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -c.x * k, -c.y * k], annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS });
    await task.promise;
  } else if (src && src.kind === 'image') {
    const t = rotT(p), w = p.w, h = p.h;
    const M = t === 90 ? [0, 1, -1, 0, h, 0] : t === 180 ? [-1, 0, 0, -1, w, h] : t === 270 ? [0, -1, 1, 0, 0, w] : [1, 0, 0, 1, 0, 0];
    ctx.setTransform(k, 0, 0, k, -c.x * k, -c.y * k); ctx.transform(...M);
    const r = p.img || { x: 0, y: 0, w, h };
    ctx.drawImage(src.img, r.x, r.y, r.w, r.h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  return canvas;
}
async function renderPageCanvas(d, p, parts, gen) {
  const s = d.scale;
  const cv = el('canvas', { class: 'pc' });
  await drawPage(d, p, s, cv);
  if (gen !== R.gen) return;
  if (parts.canvas) parts.canvas.replaceWith(cv); else parts.pe.prepend(cv);
  parts.canvas = cv; parts.scale = s;
  const src = d.sources[p.src];
  if (src && src.kind === 'pdf') {
    await buildTextLayer(d, p, parts);
    if (gen !== R.gen) return;
    renderFormLayer(p);
  }
  if (S.tool === 'edittext') await buildEditLayer(d, p, parts);
  applySearchHighlights(p.id);
}
async function getTextContent(src, idx) {
  if (!src.text[idx]) { const pg = await src.pdf.getPage(idx + 1); src.text[idx] = await pg.getTextContent(); }
  return src.text[idx];
}
async function buildTextLayer(d, p, parts) {
  const src = d.sources[p.src], s = d.scale;
  const pg = await src.pdf.getPage(p.idx + 1);
  const vp = pg.getViewport({ scale: s, rotation: rotT(p) });
  const c = cropDisp(p);
  const tc = await getTextContent(src, p.idx);
  const tl = el('div', { class: 'textLayer', style: { left: -c.x * s + 'px', top: -c.y * s + 'px', width: vp.width + 'px', height: vp.height + 'px', right: 'auto', bottom: 'auto' } });
  tl.style.setProperty('--scale-factor', s);
  try { await pdfjsLib.renderTextLayer({ textContentSource: tc, container: tl, viewport: vp, textDivs: [] }).promise; } catch (e) { console.warn('textlayer', e); }
  if (parts.tl) parts.tl.replaceWith(tl); else parts.canvas.after(tl);
  parts.tl = tl;
}
/** Elementos de texto (en puntos, pantalla recortada) agrupados en tramos de línea */
async function textItems(d, p) {
  const out = [], src = d.sources[p.src];
  if (src && src.kind === 'pdf') {
    const tc = await getTextContent(src, p.idx);
    const pg = await src.pdf.getPage(p.idx + 1);
    const vp = pg.getViewport({ scale: 1, rotation: rotT(p) });
    const c = cropDisp(p);
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
      if (Math.abs(tx[1]) > 0.01 * Math.abs(tx[0]) + 0.01) continue; // texto girado
      const fh = Math.hypot(tx[2], tx[3]); if (fh < 1) continue;
      const base = tx[5] - c.y, x = tx[4] - c.x;
      out.push({ str: it.str, x, y: base - fh * 0.92, w: Math.max(1, it.width), h: fh * 1.17, base, size: fh, fontName: it.fontName, style: tc.styles[it.fontName] });
    }
  }
  for (const o of p.ov) if (o.type === 'ocrword') out.push({ str: o.t, x: o.x, y: o.y, w: o.w, h: o.h, base: o.y + o.h * 0.82, size: o.h, ocr: true });
  return out;
}
async function textRuns(d, p) {
  const items = (await textItems(d, p)).slice().sort((a, b) => (Math.abs(a.base - b.base) < a.size * 0.3 ? a.x - b.x : a.base - b.base));
  const runs = [];
  for (const it of items) {
    const r = runs[runs.length - 1];
    if (r && Math.abs(r.base - it.base) < Math.min(r.size, it.size) * 0.3 && Math.abs(r.size - it.size) < r.size * 0.25) {
      const gap = it.x - (r.x + r.w);
      if (gap < r.size * 0.8 && gap > -r.size * 0.6) {
        r.str += (gap > r.size * 0.12 && !/\s$/.test(r.str) && !/^\s/.test(it.str) ? ' ' : '') + it.str;
        r.w = Math.max(r.w, it.x + it.w - r.x); r.items.push(it); continue;
      }
    }
    runs.push({ ...it, items: [it] });
  }
  return runs;
}
async function buildEditLayer(d, p, parts) {
  parts.el.innerHTML = ''; parts.el.style.display = '';
  const s = d.scale;
  for (const r of await textRuns(d, p)) {
    const e = el('div', { class: 'etext', title: 'Clic para editar este texto', style: { left: r.x * s + 'px', top: r.y * s + 'px', width: r.w * s + 'px', height: r.h * s + 'px' } });
    e.onpointerdown = ev => { ev.stopPropagation(); ev.preventDefault(); startTextEdit(p, r); };
    parts.el.append(e);
  }
}
function refreshEditLayers() {
  const d = D(); if (!d) return;
  for (const p of d.pages) {
    const parts = R.els.get(p.id); if (!parts) continue;
    if (S.tool === 'edittext') { if (parts.scale) buildEditLayer(d, p, parts); }
    else { parts.el.style.display = 'none'; parts.el.innerHTML = ''; }
  }
}

/* ---------- Capa de formulario (campos AcroForm existentes) ---------- */
function renderFormLayer(p) {
  const d = D(), parts = R.els.get(p.id); if (!parts) return;
  parts.fl.innerHTML = '';
  const src = d.sources[p.src]; if (!src || !src.hasForm) return;
  const ws = d.fields[src.id]?.[p.idx]; if (!ws) return;
  const s = d.scale, vals = d.formValues[src.id];
  const c = cropDisp(p);
  src.pdf.getPage(p.idx + 1).then(pg => {
    const vp = pg.getViewport({ scale: 1, rotation: rotT(p) });
    for (const w of ws) {
      if (w.fieldType === 'Sig') continue;
      const rr = vp.convertToViewportRectangle(w.rect);
      const x = Math.min(rr[0], rr[2]) - c.x, y = Math.min(rr[1], rr[3]) - c.y, ww = Math.abs(rr[2] - rr[0]), hh = Math.abs(rr[3] - rr[1]);
      let inp;
      const name = w.fieldName;
      const pos = { left: x * s + 'px', top: y * s + 'px', width: ww * s + 'px', height: hh * s + 'px' };
      if (w.fieldType === 'Tx') {
        inp = w.multiLine ? el('textarea', { class: 'ffield' }) : el('input', { class: 'ffield', type: w.password ? 'password' : 'text' });
        inp.value = vals[name] ?? '';
        if (w.maxLen) inp.maxLength = w.maxLen;
        const fs = w.multiLine ? Math.min(11, hh * 0.7) : Math.min(12, hh * 0.68);
        Object.assign(inp.style, pos, { fontSize: fs * s + 'px', textAlign: ['left', 'center', 'right'][w.textAlignment || 0] });
        inp.oninput = () => setFormValue(src.id, name, inp.value, inp);
      } else if (w.fieldType === 'Btn' && (w.checkBox || w.radioButton)) {
        inp = el('input', { class: 'ffield', type: w.radioButton ? 'radio' : 'checkbox', name: w.radioButton ? src.id + '|' + name : null });
        inp.checked = w.radioButton ? (vals[name] === w.buttonValue) : !!vals[name];
        Object.assign(inp.style, pos, { margin: 0 });
        inp.onchange = () => setFormValue(src.id, name, w.radioButton ? (inp.checked ? w.buttonValue : vals[name]) : inp.checked, inp);
      } else if (w.fieldType === 'Ch') {
        inp = el('select', { class: 'ffield' });
        if (!w.combo) inp.size = Math.max(2, Math.min(6, (w.options || []).length));
        inp.append(el('option', { value: '', text: '' }));
        for (const o of (w.options || [])) inp.append(el('option', { value: o.exportValue ?? o.displayValue, text: o.displayValue ?? o.exportValue }));
        inp.value = vals[name] ?? '';
        Object.assign(inp.style, pos, { fontSize: Math.min(11, hh * 0.65) * s + 'px' });
        inp.onchange = () => setFormValue(src.id, name, inp.value, inp);
      } else continue;
      if (w.readOnly) inp.disabled = true;
      inp.dataset.fname = name; inp.dataset.src = src.id;
      inp.title = name;
      inp.addEventListener('focus', () => { inp._snap = d.snap(); });
      parts.fl.append(inp);
    }
  });
}
function setFormValue(srcId, name, value, inp) {
  const d = D();
  if (inp && inp._snap) { d.undo.push(inp._snap); d.redo = []; inp._snap = null; d.setDirty(true); }
  else if (!inp) d.checkpoint();
  d.formValues[srcId][name] = value;
  // sincronizar widgets con el mismo nombre
  for (const o of $$(`.ffield[data-src="${srcId}"]`)) {
    if (o === inp || o.dataset.fname !== name) continue;
    if (o.type === 'checkbox') o.checked = !!value; else if (o.type === 'radio') o.checked = false; else o.value = value;
  }
}

/* ---------- Objetos (anotaciones) ---------- */
function n2(v) { return Math.round(v * 100) / 100; }
function smoothPath(pts) {
  if (!pts.length) return '';
  if (pts.length < 3) return 'M' + pts.map(q => n2(q[0]) + ' ' + n2(q[1])).join(' L');
  let d = `M${n2(pts[0][0])} ${n2(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${n2(pts[i][0])} ${n2(pts[i][1])} ${n2(mx)} ${n2(my)}`;
  }
  const l = pts[pts.length - 1]; return d + ` L${n2(l[0])} ${n2(l[1])}`;
}
function inkAbs(o, ox = 0, oy = 0) { return o.pts.map(([fx, fy]) => [ox + fx * o.w, oy + fy * o.h]); }
function lineAbs(o) { return [o.x + o.x1 * o.w, o.y + o.y1 * o.h, o.x + o.x2 * o.w, o.y + o.y2 * o.h]; }
function arrowHead(x1, y1, x2, y2, sw) {
  const L = Math.max(8, sw * 4), a = Math.atan2(y2 - y1, x2 - x1), sp = 0.45;
  return [[x2, y2], [x2 - L * Math.cos(a - sp), y2 - L * Math.sin(a - sp)], [x2 - L * Math.cos(a + sp), y2 - L * Math.sin(a + sp)]];
}
function ovSvg(o) {
  const w = o.w, h = o.h, sw = o.sw || 1, col = o.color || '#000';
  const vb = `<svg viewBox="0 0 ${n2(w)} ${n2(h)}" preserveAspectRatio="none">`;
  switch (o.type) {
    case 'rect': return vb + `<rect x="${sw / 2}" y="${sw / 2}" width="${Math.max(0, w - sw)}" height="${Math.max(0, h - sw)}" fill="${o.fill || 'none'}" stroke="${col}" stroke-width="${sw}"/></svg>`;
    case 'ellipse': return vb + `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${Math.max(0, w / 2 - sw / 2)}" ry="${Math.max(0, h / 2 - sw / 2)}" fill="${o.fill || 'none'}" stroke="${col}" stroke-width="${sw}"/></svg>`;
    case 'line': case 'arrow': {
      const x1 = o.x1 * w, y1 = o.y1 * h, x2 = o.x2 * w, y2 = o.y2 * h;
      let s = vb + `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/>`;
      if (o.type === 'arrow') s += `<polygon points="${arrowHead(x1, y1, x2, y2, sw).map(q => q.join(',')).join(' ')}" fill="${col}"/>`;
      return s + '</svg>';
    }
    case 'ink': return vb + `<path d="${smoothPath(inkAbs(o))}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case 'underline': return vb + `<line x1="0" y1="${h - sw / 2}" x2="${w}" y2="${h - sw / 2}" stroke="${col}" stroke-width="${sw}"/></svg>`;
    case 'strike': return vb + `<line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke="${col}" stroke-width="${sw}"/></svg>`;
  }
  return '';
}
function ovEl(o, s, d) {
  const e = el('div', { class: 'ov ' + o.type, dataset: { oid: o.id }, style: { left: o.x * s + 'px', top: o.y * s + 'px', width: o.w * s + 'px', height: o.h * s + 'px' } });
  if (o.opacity != null && o.type !== 'highlight') e.style.opacity = o.opacity;
  switch (o.type) {
    case 'highlight': Object.assign(e.style, { background: o.color, opacity: o.opacity ?? 0.45, mixBlendMode: 'multiply' }); break;
    case 'whiteout': e.style.background = o.color || '#fff'; break;
    case 'redact': break;
    case 'note': e.style.background = o.color || '#ffd400'; e.innerHTML = ic('message-square'); e.title = (o.author ? o.author + ': ' : '') + (o.text || ''); break;
    case 'image': { const a = d.assets[o.asset]; e.append(el('img', { src: a ? a.url : '', draggable: 'false' })); break; }
    case 'code': e.innerHTML = codeSvg(o); break;
    case 'stamp': {
      const bw = Math.max(1.5, o.h * 0.06);
      Object.assign(e.style, { color: o.color, borderColor: o.color, borderWidth: bw * s + 'px', borderRadius: o.h * 0.14 * s + 'px', fontSize: o.h * (o.date || o.who ? 0.36 : 0.46) * s + 'px' });
      e.append(el('span', { text: o.label }));
      if (o.date || o.who) e.append(el('small', { text: o.dateText || todayStr(), style: { fontSize: o.h * 0.2 * s + 'px' } }));
      break;
    }
    case 'text': case 'textedit': {
      const fam = o.font || 'Helvetica';
      Object.assign(e.style, fontCss(fam, o.bold, o.italic), {
        fontSize: o.size * s + 'px', color: o.color, fontKerning: 'normal',
        textAlign: o.align || 'left', padding: (o.pad ?? 2) * s + 'px', background: o.bg || 'transparent',
        border: o.border ? Math.max(1, s) + 'px solid ' + o.border : 'none', whiteSpace: o.type === 'textedit' ? 'pre' : 'pre-wrap'
      });
      if (o.rotate) {
        e.style.overflow = 'visible';
        e.append(el('span', { text: o.text, style: { position: 'absolute', left: '50%', top: '50%', whiteSpace: 'pre', textAlign: 'center', transform: `translate(-50%,-50%) rotate(${-o.rotate}deg)` } }));
      } else e.textContent = o.text;
      break;
    }
    case 'field': e.innerHTML = o.ftype === 'sig' ? ic('pen-line') + '&nbsp;' + escapeHtml(tr('Firma') + ' ' + (o.order || '') + ': ' + (o.signer || '')) : ic(o.ftype === 'check' ? 'square-check' : o.ftype === 'drop' ? 'list' : 'text-cursor-input') + '&nbsp;' + escapeHtml(o.name); e.querySelector('svg').style.cssText = 'position:static;width:12px;height:12px;flex:none'; break;
    default: e.innerHTML = ovSvg(o);
  }
  if (o.type === 'redact') e.classList.add('pending');
  return e;
}
function renderOverlays(p) {
  const d = D(), parts = R.els.get(p.id); if (!parts || !d) return;
  const s = d.scale; parts.ol.innerHTML = '';
  for (const o of p.ov) {
    if (o.type === 'ocrword') continue;
    const e = ovEl(o, s, d);
    if (S.sel && S.sel.oid === o.id) {
      e.classList.add('sel');
      if (o.type === 'line' || o.type === 'arrow') {
        const [x1, y1, x2, y2] = lineAbs(o);
        e.append(el('div', { class: 'hd p1', dataset: { h: 'p1' }, style: { left: (x1 - o.x) * s + 'px', top: (y1 - o.y) * s + 'px' } }),
          el('div', { class: 'hd p2', dataset: { h: 'p2' }, style: { left: (x2 - o.x) * s + 'px', top: (y2 - o.y) * s + 'px' } }));
      } else if (o.type !== 'note' && S.editing !== o.id) for (const h of ['nw', 'ne', 'sw', 'se']) e.append(el('div', { class: 'hd ' + h, dataset: { h } }));
      if (S.editing === o.id) {
        e.contentEditable = o.type === 'textedit' ? 'plaintext-only' : 'true'; e.spellcheck = false;
        if (o.type === 'text' && !o.rotate) { e.style.height = 'auto'; e.style.minHeight = o.h * s + 'px'; }
        if (o.type === 'textedit') { e.style.width = 'auto'; e.style.minWidth = o.w * s + 'px'; }
        e.addEventListener('keydown', ev => { if (ev.key === 'Escape' || (ev.key === 'Enter' && o.type === 'textedit')) { ev.preventDefault(); commitEditing(); } });
      }
    }
    parts.ol.append(e);
  }
  if (S.editing) { const e = parts.ol.querySelector(`[data-oid="${S.editing}"]`); if (e) setTimeout(() => { e.focus({ preventScroll: true }); placeCaretEnd(e); }, 0); }
}
function placeCaretEnd(e) { const r = document.createRange(); r.selectNodeContents(e); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
function rerenderPage(p, full) {
  const parts = R.els.get(p.id); if (!parts) return;
  if (full) { parts.scale = 0; pumpRender(); }
  renderOverlays(p);
}

/* ---------- Barra de estado / navegación ---------- */
function updateStatus() {
  const d = D();
  $('#sb-page').value = d ? d.cur + 1 : 0; $('#sb-total').textContent = '/ ' + (d ? d.pages.length : 0);
  const z = $('#sb-zoom');
  if (!z.options.length) {
    for (const [v, l] of [['fitw', 'Ajustar ancho'], ['fitp', 'Página completa'], ['50', '50 %'], ['75', '75 %'], ['100', '100 %'], ['125', '125 %'], ['150', '150 %'], ['200', '200 %'], ['300', '300 %'], ['400', '400 %']]) z.append(el('option', { value: v, text: l }));
    z.append(el('option', { value: 'custom', text: '' }));
  }
  if (d) {
    const pct = Math.round(d.scale / PX_PER_PT * 100);
    if (typeof d.zoom === 'string') z.value = d.zoom; else { const o = z.querySelector('option[value=custom]'); o.textContent = pct + ' %'; z.value = [...z.options].some(x => x.value == d.zoom) ? String(d.zoom) : 'custom'; }
  }
  $('#sb-msg').textContent = d ? `${d.pages.length} pág.` + (d.cloud ? ' · ' + (d.cloud.provider === 'onedrive' ? 'OneDrive' : 'Google Drive') : d.handle ? ' · Este equipo' : '') + (d.security ? ' · 🔒' : '') : '';
}
function setZoom(z) {
  const d = D(); if (!d) return;
  if (z === 'in' || z === 'out') { const cur = d.scale / PX_PER_PT * 100; const steps = [10, 25, 33, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500, 600, 800]; z = z === 'in' ? (steps.find(x => x > cur + 1) || 800) : ([...steps].reverse().find(x => x < cur - 1) || 10); }
  d.zoom = (z === 'fitw' || z === 'fitp') ? z : +z;
  renderViewer(true);
}
function goToPage(i, smooth) {
  const d = D(); if (!d) return; i = clamp(i, 0, d.pages.length - 1);
  if (d.view === 'organize') return;
  const parts = R.els.get(d.pages[i].id); if (!parts) return;
  viewerEl().scrollTo({ top: parts.pe.offsetTop - 10, behavior: smooth ? 'smooth' : 'auto' });
  d.cur = i; updateStatus(); markThumbCur();
}
function trackCurrentPage() {
  const d = D(); if (!d || d.view === 'organize') return;
  const v = viewerEl(), mid = v.scrollTop + v.clientHeight * 0.35;
  let best = 0;
  for (let i = 0; i < d.pages.length; i++) { const x = R.els.get(d.pages[i].id); if (!x) continue; if (x.pe.offsetTop <= mid) best = i; else break; }
  if (best !== d.cur) { d.cur = best; updateStatus(); markThumbCur(); }
}

/* ---------- Miniaturas ---------- */
function thumbKey(p) { return [p.rot, JSON.stringify(p.crop), p.src, p.idx, p.v || 0].join('|'); }
async function getThumb(d, p) {
  const key = thumbKey(p), c = R.thumbCache.get(p.id);
  if (c && c.key === key) return c.url;
  const [w, h] = dims(p); const s = Math.min(150 / w, 190 / h) * 1.5;
  const cv = el('canvas'); await drawPage(d, p, s, cv, 1);
  const url = cv.toDataURL('image/jpeg', 0.8);
  R.thumbCache.set(p.id, { key, url }); return url;
}
function thumbImg(d, p, box, maxW, maxH) {
  const [w, h] = dims(p); const k = Math.min(maxW / w, maxH / h);
  const ph = el('div', { style: { width: w * k + 'px', height: h * k + 'px', background: '#fff' } });
  box.append(ph);
  const load = () => getThumb(d, p).then(u => { const i = el('img', { src: u, style: { width: w * k + 'px', height: h * k + 'px', display: 'block' }, draggable: 'false' }); ph.replaceWith(i); }).catch(() => { });
  if (!R.thumbIO) R.thumbIO = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { R.thumbIO.unobserve(e.target); e.target._load && e.target._load(); } }, { rootMargin: '300px' });
  ph._load = load; R.thumbIO.observe(ph);
}
function markThumbCur() {
  const d = D(); if (!d) return;
  for (const t of $$('#side-body .thumb')) t.classList.toggle('cur', +t.dataset.i === d.cur);
  const cur = $('#side-body .thumb.cur'); if (cur && S.side === 'thumbs') { const b = $('#side-body'); if (cur.offsetTop < b.scrollTop || cur.offsetTop > b.scrollTop + b.clientHeight - 60) b.scrollTop = cur.offsetTop - 40; }
}
