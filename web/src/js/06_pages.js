/* ============================================================
   06 · Páginas: organizar, rotar, insertar, extraer, dividir, recortar
   ============================================================ */
function afterStructureChange(keep = true) {
  const d = D(); if (!d) return;
  d.cur = clamp(d.cur, 0, d.pages.length - 1);
  for (const id of [...d.orgSel]) if (!d.page(id)) d.orgSel.delete(id);
  if (S.sel && !d.page(S.sel.pid)) S.sel = null;
  renderSide(); renderProps(); renderViewer(keep); renderRibbonState();
}
function undo() { const d = D(); if (!d || !d.undo.length) return; commitEditing(); d.redo.push(d.snap()); d.restore(d.undo.pop()); S.sel = null; d.setDirty(true); afterStructureChange(); }
function redo() { const d = D(); if (!d || !d.redo.length) return; d.undo.push(d.snap()); d.restore(d.redo.pop()); S.sel = null; d.setDirty(true); afterStructureChange(); }

/** páginas objetivo: selección del organizador o página actual */
function targetPages() {
  const d = D(); if (!d) return [];
  if (d.view === 'organize' && d.orgSel.size) return d.pages.filter(p => d.orgSel.has(p.id));
  return [d.pages[d.cur]].filter(Boolean);
}
function rotateOverlays(p, dir) {
  const [W, H] = dims(p);
  const mp = dir > 0 ? (x, y) => [H - y, x] : (x, y) => [y, W - x];
  const mapRect = o => { const a = mp(o.x, o.y), b = mp(o.x + o.w, o.y + o.h); o.x = Math.min(a[0], b[0]); o.y = Math.min(a[1], b[1]); o.w = Math.abs(a[0] - b[0]); o.h = Math.abs(a[1] - b[1]); };
  for (let k = 0; k < p.ov.length; k++) {
    const o = p.ov[k];
    if (['text', 'note', 'stamp', 'image', 'field'].includes(o.type)) { const [cx, cy] = mp(o.x + o.w / 2, o.y + o.h / 2); o.x = cx - o.w / 2; o.y = cy - o.h / 2; }
    else if (o.type === 'line' || o.type === 'arrow') { const [x1, y1, x2, y2] = lineAbs(o); const a = mp(x1, y1), b = mp(x2, y2); setLineAbs(o, a[0], a[1], b[0], b[1]); }
    else if (o.type === 'ink') {
      const pts = inkAbs(o, o.x, o.y).map(q => mp(q[0], q[1]));
      const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]); const L = Math.min(...xs), T = Math.min(...ys), Wd = Math.max(1, Math.max(...xs) - L), Hd = Math.max(1, Math.max(...ys) - T);
      Object.assign(o, { x: L, y: T, w: Wd, h: Hd, pts: pts.map(q => [(q[0] - L) / Wd, (q[1] - T) / Hd]) });
    } else if (o.type === 'underline' || o.type === 'strike') {
      const yy = o.type === 'underline' ? o.y + o.h - (o.sw || 1) / 2 : o.y + o.h / 2;
      const a = mp(o.x, yy), b = mp(o.x + o.w, yy);
      const n = { id: o.id, type: 'line', color: o.color, sw: o.sw, opacity: 1 }; setLineAbs(n, a[0], a[1], b[0], b[1]); p.ov[k] = n;
    } else mapRect(o);
  }
}
function rotatePages(pages, dir) {
  const d = D(); if (!pages.length) return;
  d.checkpoint();
  for (const p of pages) { rotateOverlays(p, dir); p.rot = ((p.rot + dir * 90) % 360 + 360) % 360; }
  afterStructureChange();
}
async function deletePages(pages) {
  const d = D(); if (!pages.length) return;
  if (pages.length >= d.pages.length) { toast('No se pueden eliminar todas las páginas.', 'err'); return; }
  if (pages.length > 1 && !(await confirmDialog('Eliminar páginas', `¿Eliminar ${pages.length} páginas?`, 'Eliminar', true))) return;
  d.checkpoint(); const ids = new Set(pages.map(p => p.id));
  d.pages = d.pages.filter(p => !ids.has(p.id)); afterStructureChange();
}
function clonePage(p) { const c = structuredClone(p); c.id = uid(); c.ov.forEach(o => o.id = uid()); return c; }
function duplicatePages(pages) {
  const d = D(); if (!pages.length) return; d.checkpoint();
  for (const p of pages) { const i = d.pages.indexOf(p); d.pages.splice(i + 1, 0, clonePage(p)); }
  afterStructureChange();
}
function reversePages() { const d = D(); d.checkpoint(); d.pages.reverse(); afterStructureChange(); }
async function insertBlankDialog() {
  const d = D(); const ref = d.pages[d.cur];
  const v = await formDialog('Insertar página en blanco', [
    { key: 'size', label: 'Tamaño', type: 'select', value: 'same', options: [['same', 'Igual a la página actual'], ['a4', 'A4'], ['letter', 'Carta'], ['legal', 'Oficio / Legal']] },
    { key: 'orient', label: 'Orientación', type: 'select', value: 'p', options: [['p', 'Vertical'], ['l', 'Horizontal']] },
    { key: 'where', label: 'Posición', type: 'select', value: 'after', options: [['after', 'Después de la página actual'], ['before', 'Antes de la página actual'], ['start', 'Al inicio'], ['end', 'Al final']] },
    { key: 'count', label: 'Cantidad', type: 'number', value: 1, min: 1, max: 200 }
  ], { ok: 'Insertar' });
  if (!v) return;
  let [w, h] = v.size === 'same' && ref ? fullDims(ref) : (PAGE_SIZES[v.size] || PAGE_SIZES.a4);
  if ((v.orient === 'l') !== (w > h) && v.size !== 'same') [w, h] = [h, w];
  const at = insertIndex(v.where);
  d.checkpoint(); d.pages.splice(at, 0, ...Array.from({ length: clamp(v.count || 1, 1, 200) }, () => blankPage(w, h)));
  d.cur = at; afterStructureChange();
}
function insertIndex(where) { const d = D(); return where === 'start' ? 0 : where === 'end' ? d.pages.length : where === 'before' ? d.cur : d.cur + 1; }
async function insertFromFileDialog() {
  const d = D();
  const v = await formDialog('Insertar desde archivo', [
    { key: 'where', label: 'Posición', type: 'select', value: 'after', options: [['after', 'Después de la página actual'], ['before', 'Antes de la página actual'], ['start', 'Al inicio'], ['end', 'Al final']] },
    { key: 'from', label: 'Origen', type: 'select', value: 'local', options: [['local', 'Este equipo'], ['onedrive', 'OneDrive'], ['gdrive', 'Google Drive']] },
    { key: 'range', label: 'Páginas a insertar (vacío = todas)', placeholder: 'Ej.: 1-3, 5' }
  ], { ok: 'Elegir archivo…' });
  if (!v) return;
  const files = await pickFiles(v.from, true); if (!files.length) return;
  await withBusy('Insertando…', async () => {
    let at = insertIndex(v.where), added = [];
    for (const f of files) {
      let pages = await addFileToDoc(d, f.bytes, f.name, f.mime, 'a4');
      if (v.range && pages.length > 1) { const idx = parseRanges(v.range, pages.length); pages = idx.map(i => pages[i]); }
      added.push(...pages);
    }
    d.checkpoint(); d.pages.splice(at, 0, ...added); d.cur = at;
  });
  afterStructureChange();
}
function extractToNewDoc(pages, name) {
  const d = D(); if (!pages.length) return;
  const n = new Doc(name || baseName(d.name) + ' (extracto).pdf');
  n.sources = { ...d.sources }; n.assets = { ...d.assets }; n.fields = d.fields;
  n.formValues = structuredClone(d.formValues); n.formOrig = structuredClone(d.formOrig); n.meta = structuredClone(d.meta);
  n.pages = pages.map(clonePage); n.dirty = true;
  addDoc(n); toast(`Se extrajeron ${pages.length} página(s) a un documento nuevo.`, 'ok');
}
async function extractDialog() {
  const d = D();
  const sel = d.view === 'organize' && d.orgSel.size ? d.pages.map((p, i) => d.orgSel.has(p.id) ? i + 1 : 0).filter(Boolean).join(',') : String(d.cur + 1);
  const v = await formDialog('Extraer páginas', [
    { key: 'range', label: 'Páginas', value: sel, hint: 'Ejemplos: <b>1-3</b>, <b>2,4,6</b>, <b>5-</b> (de la 5 al final)' },
    { key: 'remove', label: 'Eliminar las páginas extraídas del documento original', type: 'checkbox' }
  ], { ok: 'Extraer' });
  if (!v) return;
  let idx; try { idx = parseRanges(v.range, d.pages.length); } catch (e) { toast(e.message, 'err'); return; }
  if (!idx.length) return;
  const pages = idx.map(i => d.pages[i]);
  extractToNewDoc(pages);
  if (v.remove && pages.length < d.pages.length) {
    const src = S.docs.find(x => x === d); activateDoc(src);
    d.checkpoint(); const ids = new Set(pages.map(p => p.id)); d.pages = d.pages.filter(p => !ids.has(p.id)); afterStructureChange();
  }
}
async function splitDialog() {
  const d = D();
  const v = await formDialog('Dividir documento', [
    { key: 'mode', label: 'Dividir', type: 'select', value: 'every', options: [['every', 'Cada N páginas'], ['each', 'Una página por archivo'], ['ranges', 'Por rangos personalizados']] },
    { key: 'n', label: 'N (para «Cada N páginas»)', type: 'number', value: 2, min: 1 },
    { key: 'ranges', label: 'Rangos (separe archivos con ;)', placeholder: '1-3; 4-6; 7-' }
  ], { ok: 'Dividir' });
  if (!v) return;
  const N = d.pages.length; let groups = [];
  try {
    if (v.mode === 'each') groups = d.pages.map((_, i) => [i]);
    else if (v.mode === 'every') { const k = Math.max(1, v.n | 0); for (let i = 0; i < N; i += k) groups.push([...Array(Math.min(k, N - i)).keys()].map(j => i + j)); }
    else groups = String(v.ranges || '').split(';').map(s => s.trim()).filter(Boolean).map(s => parseRanges(s, N)).filter(g => g.length);
  } catch (e) { toast(e.message, 'err'); return; }
  if (!groups.length) return;
  await withBusy('Dividiendo…', async upd => {
    const zip = new JSZip();
    for (let g = 0; g < groups.length; g++) {
      upd(`Generando archivo ${g + 1} de ${groups.length}…`, g / groups.length * 100);
      const bytes = await buildPdf(d, { pages: groups[g] });
      const a = groups[g][0] + 1, b = groups[g][groups[g].length - 1] + 1;
      zip.file(`${baseName(d.name)}_${a === b ? 'p' + a : 'p' + a + '-' + b}.pdf`, bytes);
    }
    download(await zip.generateAsync({ type: 'blob' }), baseName(d.name) + '_dividido.zip');
  });
  toast(`Se generaron ${groups.length} archivos (ZIP).`, 'ok');
}
async function cropDialog() {
  const d = D(); const p = d.pages[d.cur];
  const v = await formDialog('Recortar páginas', [
    { type: 'hint', label: 'Márgenes a recortar, en milímetros, medidos sobre la página tal como se ve en pantalla.' },
    { key: 't', label: 'Superior', type: 'number', value: 0, min: 0, step: 1, row: 'cols' }, { key: 'b', label: 'Inferior', type: 'number', value: 0, min: 0, step: 1, row: 'cols' },
    { key: 'l', label: 'Izquierdo', type: 'number', value: 0, min: 0, step: 1, row: 'cols' }, { key: 'r', label: 'Derecho', type: 'number', value: 0, min: 0, step: 1, row: 'cols' },
    { key: 'pages', label: 'Aplicar a', type: 'select', value: 'cur', options: [['cur', 'Página actual'], ['all', 'Todas las páginas'], ['range', 'Rango…']] },
    { key: 'range', label: 'Rango', placeholder: '1-3, 5' },
    { key: 'reset', label: 'Quitar recorte (restaurar página completa)', type: 'checkbox' }
  ], { ok: 'Aplicar' });
  if (!v) return;
  let list;
  try { list = v.pages === 'all' ? d.pages : v.pages === 'range' ? parseRanges(v.range, d.pages.length).map(i => d.pages[i]) : [p]; } catch (e) { toast(e.message, 'err'); return; }
  d.checkpoint();
  for (const pg of list) {
    const old = cropDisp(pg);
    if (v.reset) pg.crop = null;
    else {
      const [W, H] = fullDims(pg), m = k => (v[k] || 0) * PT_PER_MM;
      const r = { x: m('l'), y: m('t'), w: W - m('l') - m('r'), h: H - m('t') - m('b') };
      if (r.w < 20 || r.h < 20) { toast('Los márgenes son demasiado grandes.', 'err'); continue; }
      pg.crop = rectMap(dispToUnrot, pg, r);
    }
    const nw = cropDisp(pg), dx = old.x - nw.x, dy = old.y - nw.y;
    for (const o of pg.ov) { o.x += dx; o.y += dy; }
  }
  afterStructureChange();
}

/* ---------- Vista Organizar ---------- */
function renderOrganizer() {
  const d = D(), box = $('#organizer'); box.innerHTML = '';
  const cnt = el('span', { class: 'muted' });
  const upd = () => { cnt.textContent = d.orgSel.size ? `${d.orgSel.size} seleccionada(s)` : 'Haga clic para seleccionar · Ctrl/Mayús para varias · arrastre para reordenar'; };
  const btn = (icn, label, fn, title) => el('button', { class: 'btn sm', html: ic(icn) + label, title: title || label, onclick: fn });
  const sel = () => d.orgSel.size ? d.pages.filter(p => d.orgSel.has(p.id)) : [];
  const need = fn => () => { const s = sel(); if (!s.length) { toast('Seleccione una o más páginas.'); return; } fn(s); };
  box.append(el('div', { class: 'org-bar' },
    btn('arrow-left', 'Volver al visor', () => setViewMode('pages')),
    btn('check-check', 'Todas', () => { d.pages.forEach(p => d.orgSel.add(p.id)); renderOrganizer(); }),
    btn('square', 'Ninguna', () => { d.orgSel.clear(); renderOrganizer(); }),
    btn('rotate-ccw', '', need(s => rotatePages(s, -1)), 'Girar a la izquierda'), btn('rotate-cw', '', need(s => rotatePages(s, 1)), 'Girar a la derecha'),
    btn('copy', 'Duplicar', need(duplicatePages)), btn('file-output', 'Extraer', need(s => extractToNewDoc(s))),
    btn('trash-2', 'Eliminar', need(deletePages)), btn('arrow-down-up', 'Invertir', reversePages),
    btn('file-plus-2', 'En blanco', insertBlankDialog), btn('file-input', 'Desde archivo', insertFromFileDialog), cnt));
  upd();
  const grid = el('div', { class: 'org-grid' });
  let lastClick = null, dragIds = null;
  d.pages.forEach((p, i) => {
    const it = el('div', { class: 'org-item' + (d.orgSel.has(p.id) ? ' sel' : ''), draggable: 'true', dataset: { pid: p.id } });
    const tc = el('div', { class: 'tc' }); thumbImg(d, p, tc, 150, 190);
    it.append(tc, el('div', { class: 'tl', text: `${i + 1}` + (p.rot ? ` · ${p.rot}°` : '') }),
      el('div', { class: 'rot' }, el('button', { html: ic('rotate-ccw'), title: 'Girar izquierda', onclick: e => { e.stopPropagation(); rotatePages([p], -1); } }),
        el('button', { html: ic('rotate-cw'), title: 'Girar derecha', onclick: e => { e.stopPropagation(); rotatePages([p], 1); } }),
        el('button', { html: ic('trash-2'), title: 'Eliminar', onclick: e => { e.stopPropagation(); deletePages([p]); } })));
    it.onclick = e => {
      if (e.shiftKey && lastClick != null) { const [a, b] = [Math.min(lastClick, i), Math.max(lastClick, i)]; for (let k = a; k <= b; k++) d.orgSel.add(d.pages[k].id); }
      else if (e.ctrlKey || e.metaKey) { d.orgSel.has(p.id) ? d.orgSel.delete(p.id) : d.orgSel.add(p.id); lastClick = i; }
      else { d.orgSel.clear(); d.orgSel.add(p.id); lastClick = i; }
      $$('.org-item', grid).forEach(x => x.classList.toggle('sel', d.orgSel.has(x.dataset.pid))); upd();
    };
    it.ondblclick = () => { d.cur = i; d.scrollTop = null; setViewMode('pages'); setTimeout(() => goToPage(i), 50); };
    it.ondragstart = e => { dragIds = d.orgSel.has(p.id) ? [...d.orgSel] : [p.id]; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'pages'); };
    it.ondragover = e => { if (!dragIds) return; e.preventDefault(); $$('.drop-before', grid).forEach(x => x.classList.remove('drop-before')); const r = it.getBoundingClientRect(); const after = e.clientX > r.left + r.width / 2; const tgt = after ? it.nextElementSibling : it; if (tgt) tgt.classList.add('drop-before'); else it.dataset.dropEnd = '1'; it._after = after; };
    it.ondrop = e => {
      e.preventDefault(); if (!dragIds) return;
      const ids = new Set(dragIds); const moving = d.pages.filter(x => ids.has(x.id));
      let tgtIndex = i + (it._after ? 1 : 0);
      const before = d.pages.slice(0, tgtIndex).filter(x => !ids.has(x.id)).length;
      d.checkpoint(); const rest = d.pages.filter(x => !ids.has(x.id)); rest.splice(before, 0, ...moving); d.pages = rest;
      dragIds = null; afterStructureChange();
    };
    it.ondragend = () => { dragIds = null; $$('.drop-before', grid).forEach(x => x.classList.remove('drop-before')); };
    grid.append(it);
  });
  box.append(grid);
}
