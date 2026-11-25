/* ============================================================
   07 · Funciones: archivos, paneles, herramientas de página,
        protección, firma, conversión, OCR, compresión, impresión
   ============================================================ */

/* ---------- Selección de archivos ---------- */
function pickLocal(accept = '.pdf,image/*', multiple = true) {
  return new Promise(res => {
    const inp = $('#file-input'); inp.value = ''; inp.accept = accept; inp.multiple = multiple;
    inp.onchange = () => res([...inp.files]); inp.oncancel = () => res([]);
    inp.click();
  });
}
async function pickFiles(from = 'local', multiple = true, accept) {
  if (from === 'local' && PSN) return androidOpen(accept === 'image/*');
  if (from === 'local') {
    const fs = await pickLocal(accept || '.pdf,.png,.jpg,.jpeg,.gif,.webp,.bmp' + (NATIVE ? ',' + OFFICE_EXT.map(e => '.' + e).join(',') : ''), multiple);
    return Promise.all(fs.map(async f => ({ name: f.name, bytes: await readFileBytes(f), mime: f.type })));
  }
  const r = await openCloudBrowser({ mode: 'open', provider: from, multiple });
  if (!r) return [];
  return withBusy('Descargando…', async () => {
    const out = [];
    for (const it of r.items) out.push({ name: it.name, bytes: await CLOUD[r.provider].download(it), mime: it.mime, cloud: { provider: r.provider, id: it.id, driveId: it.driveId, parentId: it.parentId, name: it.name } });
    return out;
  });
}
async function openLocal() {
  if (PSN) return androidOpenDocs();
  if (NATIVE) return nativeOpenFiles();
  if (window.showOpenFilePicker) {
    let hs;
    try { hs = await showOpenFilePicker({ multiple: true, types: [{ description: 'PDF e imágenes', accept: { 'application/pdf': ['.pdf'], 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'] } }] }); }
    catch (e) { if (e.name !== 'AbortError') toast(e.message, 'err'); return; }
    for (const h of hs) await openHandle(h).catch(e => toast(e.message, 'err'));
    return;
  }
  for (const f of await pickLocal()) await openBytes(f.name, await readFileBytes(f), { mime: f.type }).catch(e => toast(e.message, 'err'));
}
async function openHandle(h) {
  const f = await h.getFile(); const hid = uid();
  const isPdf = isPdfName(f.name);
  if (isPdf) await idb.set('h:' + hid, h).catch(() => { });
  return openBytes(f.name, await readFileBytes(f), { mime: f.type, handle: isPdf ? h : null, handleId: isPdf ? hid : null });
}
async function openFromCloud(provider) {
  const files = await pickFiles(provider, true); for (const f of files) await openBytes(f.name, f.bytes, { mime: f.mime, cloud: isPdfName(f.name) ? f.cloud : null }).catch(e => toast(e.message, 'err'));
}
async function openDroppedFiles(list) {
  for (const f of list) {
    if (!isPdfName(f.name) && !isImageName(f.name) && !isOfficeName(f.name)) { toast('Formato no soportado: ' + f.name, 'err'); continue; }
    await openBytes(f.name, await readFileBytes(f), { mime: f.type }).catch(e => toast(e.message, 'err'));
  }
}

/* ---------- Recientes ---------- */
function addRecent(doc) {
  let kind = null, ref = null;
  if (doc.cloud) { kind = doc.cloud.provider; ref = doc.cloud; } else if (doc.androidUri) { kind = 'android'; ref = { id: doc.androidUri, uri: doc.androidUri }; } else if (doc.nativePath) { kind = 'native'; ref = { id: doc.nativePath, path: doc.nativePath }; } else if (doc.handleId) { kind = 'local'; ref = { handleId: doc.handleId }; }
  if (!kind) return;
  const key = kind + ':' + (ref.id || doc.name);
  const list = store.get('recent', []).filter(r => r.key !== key);
  list.unshift({ key, kind, ref, name: doc.name, t: Date.now() });
  store.set('recent', list.slice(0, 15));
}
async function openRecent(r) {
  try {
    if (r.kind === 'android') { if (!PSN) throw new Error('Este archivo se abrió en Android.'); const f = await withBusy('Abriendo…', () => PSN.read({ uri: r.ref.uri })); await openBytes(f.name, b64ToU8(f.data), { androidUri: r.ref.uri }); }
    else if (r.kind === 'native') { if (!NATIVE) throw new Error('Este archivo se abrió desde la app de escritorio.'); await openNativePath(r.ref.path); }
    else if (r.kind === 'local') {
      const h = await idb.get('h:' + r.ref.handleId);
      if (!h) throw new Error('El archivo ya no está disponible. Ábralo de nuevo con «Abrir».');
      if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') return;
      const f = await h.getFile();
      await openBytes(f.name, await readFileBytes(f), { mime: f.type, handle: h, handleId: r.ref.handleId });
    } else {
      const bytes = await withBusy('Descargando ' + r.name + '…', () => CLOUD[r.kind].download(r.ref));
      await openBytes(r.ref.name || r.name, bytes, { cloud: r.ref });
    }
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- Guardar ---------- */
async function saveDoc(doc = D(), as = false) {
  if (!doc) return;
  commitEditing();
  if (!as && doc.androidUri) return saveToAndroid(doc, doc.androidUri);
  if (!as && doc.cloud) return saveToCloud(doc, doc.cloud.provider, true);
  if (!as && doc.nativePath) return saveToNative(doc, doc.nativePath);
  if (!as && doc.handle) return saveToHandle(doc, doc.handle);
  return saveAsDialog(doc);
}
async function saveToNative(doc, path, preset) {
  try {
    const bytes = preset || await withBusy('Guardando…', upd => buildPdf(doc, { progress: upd }));
    await withBusy('Escribiendo archivo…', () => nativeWrite(path, bytes));
    doc.nativePath = path; doc.name = path.split(/[\\/]/).pop(); doc.cloud = null; doc.handle = null;
    if (!preset) doc.setDirty(false); addRecent(doc); updateStatus(); renderTabs();
    toast('Guardado: ' + path, 'ok'); return true;
  } catch (e) { toast('No se pudo guardar: ' + e.message, 'err'); return false; }
}
/** Guardar como. preset: bytes ya generados (p. ej. PDF firmado). Devuelve true si se guardó. */
async function saveAsDialog(doc, preset, suggested) {
  if (PSN) return androidSaveAs(doc, preset, suggested); // el selector de Android incluye Drive, OneDrive y el teléfono
  const name = el('input', { type: 'text', value: suggested || doc.name });
  const choose = where => m.close(where);
  const card = (where, icn, title, sub) => el('button', { class: 'hcard', onclick: () => choose(where) }, el('div', { class: 'hi', html: ic(icn) }), el('div', {}, el('b', { text: title }), el('span', { text: sub })));
  const body = el('div', { class: 'fm' }, el('div', { class: 'row' }, el('label', { text: 'Nombre del archivo' }), name),
    el('div', { class: 'home-cards', style: { gridTemplateColumns: '1fr', marginBottom: 0 } },
      card('local', 'hard-drive', 'Este equipo', NATIVE || window.showSaveFilePicker ? 'Elegir carpeta y guardar' : 'Descargar a la carpeta de descargas'),
      card('onedrive', 'cloud', 'OneDrive', CLOUD.onedrive.label2()), card('gdrive', 'cloud', 'Google Drive', CLOUD.gdrive.label2())));
  const m = openModal({ title: 'Guardar como', body });
  const where = await m.result; if (!where) return false;
  let n = name.value.trim() || doc.name; if (!isPdfName(n)) n += '.pdf';
  if (where === 'local') {
    if (NATIVE) { const path = await nativeSaveAs(doc, n); if (!path) return false; return saveToNative(doc, path, preset); }
    if (window.showSaveFilePicker) {
      let h; try { h = await showSaveFilePicker({ suggestedName: n, types: [{ description: 'Documento PDF', accept: { 'application/pdf': ['.pdf'] } }] }); }
      catch (e) { if (e.name !== 'AbortError') toast(e.message, 'err'); return false; }
      doc.name = h.name; doc.cloud = null; doc.nativePath = null; doc.handleId = uid(); await idb.set('h:' + doc.handleId, h).catch(() => { });
      return saveToHandle(doc, h, preset);
    }
    const bytes = preset || await withBusy('Generando PDF…', upd => buildPdf(doc, { progress: upd }));
    download(pdfBlob(bytes), n); doc.name = n; if (!preset) doc.setDirty(false); renderTabs(); toast('PDF descargado.', 'ok'); return true;
  }
  const r = await openCloudBrowser({ mode: 'save', provider: where, name: n });
  if (!r) return false;
  doc.name = r.name;
  return saveToCloud(doc, where, false, r, preset);
}
async function saveToHandle(doc, h, preset) {
  try {
    if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Permiso de escritura denegado.');
    const bytes = preset || await withBusy('Guardando…', upd => buildPdf(doc, { progress: upd }));
    const w = await h.createWritable(); await w.write(bytes); await w.close();
    doc.handle = h; if (!preset) doc.setDirty(false); addRecent(doc); updateStatus(); renderTabs();
    toast('Guardado en este equipo: ' + doc.name, 'ok'); return true;
  } catch (e) { toast('No se pudo guardar: ' + e.message, 'err'); return false; }
}
async function saveToCloud(doc, provider, existing, target, preset) {
  const P = CLOUD[provider];
  try {
    const bytes = preset || await withBusy('Generando PDF…', upd => buildPdf(doc, { progress: upd }));
    const res = await withBusy('Subiendo a ' + P.label + '…', async upd => {
      if (existing) return P.update(doc.cloud, bytes, upd);
      if (target.existing) return P.update(target.existing, bytes, upd);
      return P.upload(target.folder, target.name, bytes, upd);
    });
    doc.cloud = { provider, id: res.id, driveId: res.driveId, parentId: res.parentId, name: res.name || doc.name };
    doc.name = doc.cloud.name; doc.handle = null; doc.nativePath = null; if (!preset) doc.setDirty(false); addRecent(doc); updateStatus(); renderTabs();
    toast('Guardado en ' + P.label + ': ' + doc.name, 'ok'); return true;
  } catch (e) { console.error(e); toast('No se pudo guardar en ' + P.label + ': ' + e.message, 'err', 6000); return false; }
}

/* ---------- Crear / combinar ---------- */
async function combineDialog(imagesMode = false) {
  const items = [];
  const list = el('div', { class: 'recent-list', style: { maxHeight: '300px', overflow: 'auto', minHeight: '60px' } });
  const draw = () => {
    list.innerHTML = '';
    if (!items.length) list.append(el('div', { class: 'cb-empty', text: imagesMode ? 'Agregue imágenes (JPG, PNG…)' : 'Agregue dos o más archivos PDF o imágenes' }));
    items.forEach((it, i) => list.append(el('div', { class: 'recent-row' }, icEl(isPdfName(it.name) ? 'file-text' : 'image'), el('span', { class: 'nm', text: it.name }), el('span', { class: 'src', text: fmtSize(it.bytes.length) }),
      el('button', { class: 'icon-btn sm', html: ic('arrow-up'), title: 'Subir', onclick: () => { if (i) { [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); } } }),
      el('button', { class: 'icon-btn sm', html: ic('arrow-down'), title: 'Bajar', onclick: () => { if (i < items.length - 1) { [items[i + 1], items[i]] = [items[i], items[i + 1]]; draw(); } } }),
      el('button', { class: 'icon-btn sm', html: ic('x'), title: 'Quitar', onclick: () => { items.splice(i, 1); draw(); } }))));
  };
  const add = async from => { try { items.push(...await pickFiles(from, true, imagesMode ? 'image/*' : undefined)); draw(); } catch (e) { toast(e.message, 'err'); } };
  const addScan = async () => { try { const r = await PSN.scan({ pageLimit: 60, gallery: true }); (r.pages || []).forEach(pg => items.push({ name: `escaneo${items.length + 1}.jpg`, bytes: b64ToU8(pg.data), mime: 'image/jpeg' })); draw(); } catch (e) { toast(e.message || String(e), 'err'); } };
  const size = el('select'); for (const [v, l] of [['fit', 'Ajustar a cada imagen'], ['a4', 'A4'], ['letter', 'Carta'], ['legal', 'Oficio / Legal']]) size.append(el('option', { value: v, text: l })); size.value = imagesMode ? 'a4' : 'fit';
  const nameI = el('input', { type: 'text', value: imagesMode ? 'Imágenes.pdf' : 'Combinado.pdf' });
  const body = el('div', { class: 'fm' },
    el('div', { class: 'inline', style: { marginBottom: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' } },
      ...(PSN ? [el('button', { class: 'btn', html: ic('scan-line') + 'Escanear', onclick: addScan }), el('button', { class: 'btn', html: ic('folder-open') + 'Elegir archivos', onclick: () => add('local') })] : [
      el('button', { class: 'btn', html: ic('hard-drive') + 'Este equipo', onclick: () => add('local') }),
      el('button', { class: 'btn', html: ic('cloud') + 'OneDrive', onclick: () => add('onedrive') }),
      el('button', { class: 'btn', html: ic('cloud') + 'Google Drive', onclick: () => add('gdrive') })])),
    list, el('div', { class: 'cols', style: { marginTop: '12px' } },
      el('div', { class: 'row' }, el('label', { text: 'Tamaño de página para imágenes' }), size),
      el('div', { class: 'row' }, el('label', { text: 'Nombre del documento' }), nameI)));
  draw();
  const ok = await openModal({ title: imagesMode ? 'Crear PDF desde imágenes' : 'Combinar archivos', body, wide: true, buttons: [{ label: 'Cancelar', value: false }, { label: imagesMode ? 'Crear PDF' : 'Combinar', primary: true, onClick: () => items.length ? true : (toast('Agregue archivos.', 'err'), false) }] }).result;
  if (!ok) return;
  try {
    await withBusy('Combinando…', async upd => {
      let n = nameI.value.trim() || 'Combinado.pdf'; if (!isPdfName(n)) n += '.pdf';
      const doc = new Doc(n);
      for (let i = 0; i < items.length; i++) { upd(`Procesando ${items[i].name}…`, i / items.length * 100); doc.pages.push(...await addFileToDoc(doc, items[i].bytes, items[i].name, items[i].mime, size.value)); }
      doc.dirty = true; addDoc(doc);
    });
  } catch (e) { toast(e.message, 'err'); }
}
async function newBlankDialog() {
  const v = await formDialog('Nuevo documento en blanco', [
    { key: 'size', label: 'Tamaño', type: 'select', value: 'letter', options: [['letter', 'Carta (216 × 279 mm)'], ['a4', 'A4 (210 × 297 mm)'], ['legal', 'Oficio / Legal'], ['a3', 'A3'], ['a5', 'A5']] },
    { key: 'orient', label: 'Orientación', type: 'select', value: 'p', options: [['p', 'Vertical'], ['l', 'Horizontal']] },
    { key: 'count', label: 'Páginas', type: 'number', value: 1, min: 1, max: 500 }, { key: 'name', label: 'Nombre', value: 'Nuevo documento.pdf' }
  ], { ok: 'Crear' });
  if (!v) return;
  let [w, h] = PAGE_SIZES[v.size]; if (v.orient === 'l') [w, h] = [h, w];
  const d = new Doc(isPdfName(v.name) ? v.name : v.name + '.pdf');
  d.pages = Array.from({ length: clamp(v.count || 1, 1, 500) }, () => blankPage(w, h)); d.dirty = true;
  addDoc(d);
}
async function propertiesDialog() {
  const d = D(); if (!d) return;
  const p = d.pages[d.cur]; const [w, h] = p ? dims(p) : [0, 0];
  const size = Object.values(d.sources).reduce((a, s) => a + (s.bytes?.length || 0), 0);
  const v = await formDialog('Propiedades del documento', [
    { key: 'title', label: 'Título', value: d.meta.title }, { key: 'author', label: 'Autor', value: d.meta.author },
    { key: 'subject', label: 'Asunto', value: d.meta.subject }, { key: 'keywords', label: 'Palabras clave', value: d.meta.keywords },
    { type: 'hint', label: `<b>Archivo:</b> ${escapeHtml(d.name)}<br><b>Páginas:</b> ${d.pages.length} · <b>Página actual:</b> ${(w / PT_PER_MM).toFixed(0)} × ${(h / PT_PER_MM).toFixed(0)} mm<br><b>Tamaño original:</b> ${fmtSize(size)}<br><b>Ubicación:</b> ${d.cloud ? (d.cloud.provider === 'onedrive' ? 'OneDrive' : 'Google Drive') : d.handle ? 'Este equipo' : 'Sin guardar'}<br><b>Seguridad:</b> ${d.security ? 'Protegido con contraseña' : 'Ninguna'}<br><b>Formulario:</b> ${docHasForms(d) ? 'Sí' : 'No'}` }
  ], { ok: 'Guardar' });
  if (!v) return;
  d.checkpoint(); d.meta = v;
}

/* ---------- Elementos aplicados por grupo (marca de agua, encabezados…) ---------- */
function removeGroup(d, prefix) { let n = 0; for (const p of d.pages) { const b = p.ov.length; p.ov = p.ov.filter(o => !(o.group && o.group.startsWith(prefix))); n += b - p.ov.length; } return n; }
function targetByRange(d, range) { return parseRanges(range, d.pages.length); }
function tokens(str, n, N, d) { return String(str || '').replace(/\{n\}/g, n).replace(/\{N\}/g, N).replace(/\{fecha\}/gi, todayStr()).replace(/\{archivo\}/gi, baseName(d.name)); }
function placeText(p, text, pos, opts) {
  const [W, H] = dims(p); const { size, margin, font = defaultFont(), bold = false } = opts;
  const lines = String(text).split('\n');
  const w = Math.max(...lines.map(l => metricWidth(l, font, bold, false, size))) + 2, h = lines.length * size * 1.2;
  const col = pos[1], row = pos[0];
  const x = col === 'l' ? margin : col === 'r' ? W - margin - w : (W - w) / 2;
  const y = row === 't' ? margin : row === 'b' ? H - margin - h : (H - h) / 2;
  return { x, y, w, h, align: col === 'l' ? 'left' : col === 'r' ? 'right' : 'center' };
}
async function watermarkDialog() {
  const d = D();
  const v = await formDialog('Marca de agua', [
    { key: 'text', label: 'Texto', value: 'CONFIDENCIAL' },
    { key: 'size', label: 'Tamaño (pt)', type: 'number', value: 60, min: 6, max: 300, row: 'cols' }, { key: 'rotate', label: 'Rotación (°)', type: 'number', value: 45, min: -90, max: 90, row: 'cols' },
    { key: 'color', label: 'Color', type: 'color', value: '#d1242f', row: 'cols3' }, { key: 'opacity', label: 'Opacidad (%)', type: 'number', value: 25, min: 5, max: 100, row: 'cols3' },
    { key: 'layout', label: 'Distribución', type: 'select', value: 'center', options: [['center', 'Centrada'], ['tile', 'Mosaico'], ['top', 'Arriba'], ['bottom', 'Abajo']], row: 'cols3' },
    { key: 'bold', label: 'Negrita', type: 'checkbox', value: true },
    { key: 'range', label: 'Páginas (vacío = todas)', placeholder: '1-3, 5' }
  ], { ok: 'Aplicar', extraButtons: [{ label: 'Quitar marca de agua', onClick: () => { d.checkpoint(); const n = removeGroup(d, 'wm'); afterStructureChange(); toast(n ? 'Marca de agua eliminada.' : 'No hay marca de agua.'); return null; } }] });
  if (!v || !v.text) return;
  let idx; try { idx = targetByRange(d, v.range); } catch (e) { toast(e.message, 'err'); return; }
  const wf = defaultFont(); await ensureFont(wf, v.bold, false);
  d.checkpoint(); removeGroup(d, 'wm');
  for (const i of idx) {
    const p = d.pages[i], [W, H] = dims(p);
    const tw = metricWidth(v.text, wf, v.bold, false, v.size), th = v.size * 1.2;
    const rot = v.layout === 'top' || v.layout === 'bottom' ? 0 : v.rotate || 0, r = rot * Math.PI / 180;
    const bw = Math.abs(tw * Math.cos(r)) + Math.abs(th * Math.sin(r)), bh = Math.abs(tw * Math.sin(r)) + Math.abs(th * Math.cos(r));
    const centers = v.layout === 'tile' ? (() => { const out = []; const sx = Math.max(bw * 1.1, 120), sy = Math.max(bh * 1.4, 120); for (let y = sy / 2; y < H; y += sy) for (let x = sx / 2; x < W; x += sx) out.push([x, y]); return out; })()
      : v.layout === 'top' ? [[W / 2, 20 + bh / 2]] : v.layout === 'bottom' ? [[W / 2, H - 20 - bh / 2]] : [[W / 2, H / 2]];
    for (const [cx, cy] of centers) p.ov.unshift({ id: uid(), type: 'text', group: 'wm', text: v.text, size: v.size, color: v.color, font: wf, bold: v.bold, italic: false, align: 'center', bg: '', border: '', pad: 0, opacity: (v.opacity || 25) / 100, rotate: rot, x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh });
  }
  afterStructureChange(); toast('Marca de agua aplicada a ' + idx.length + ' página(s).', 'ok');
}
async function backgroundDialog() {
  const d = D();
  const v = await formDialog('Color de fondo', [
    { type: 'hint', label: 'Aplica un tono de fondo mediante fusión «multiplicar»: el texto y los gráficos siguen visibles.' },
    { key: 'color', label: 'Color', type: 'color', value: '#fff6d6' }, { key: 'range', label: 'Páginas (vacío = todas)' }
  ], { extraButtons: [{ label: 'Quitar fondo', onClick: () => { d.checkpoint(); removeGroup(d, 'bg'); afterStructureChange(); return null; } }] });
  if (!v) return;
  let idx; try { idx = targetByRange(d, v.range); } catch (e) { toast(e.message, 'err'); return; }
  d.checkpoint(); removeGroup(d, 'bg');
  for (const i of idx) { const p = d.pages[i], [W, H] = dims(p); p.ov.unshift({ id: uid(), type: 'highlight', group: 'bg', x: 0, y: 0, w: W, h: H, color: v.color, opacity: 1 }); }
  afterStructureChange();
}
async function headerFooterDialog() {
  const d = D();
  const v = await formDialog('Encabezado y pie de página', [
    { type: 'hint', label: 'Variables: <b>{n}</b> nº de página · <b>{N}</b> total · <b>{fecha}</b> · <b>{archivo}</b>' },
    { type: 'heading', label: 'Encabezado' },
    { key: 'tl', label: 'Izquierda', row: 'cols3' }, { key: 'tc', label: 'Centro', row: 'cols3' }, { key: 'tr', label: 'Derecha', row: 'cols3' },
    { type: 'heading', label: 'Pie de página' },
    { key: 'bl', label: 'Izquierda', row: 'cols3b' }, { key: 'bc', label: 'Centro', row: 'cols3b' }, { key: 'br', label: 'Derecha', value: 'Página {n} de {N}', row: 'cols3b' },
    { type: 'heading', label: 'Formato' },
    { key: 'size', label: 'Tamaño (pt)', type: 'number', value: 9, min: 5, max: 40, row: 'cols3c' }, { key: 'color', label: 'Color', type: 'color', value: '#444444', row: 'cols3c' }, { key: 'margin', label: 'Margen (mm)', type: 'number', value: 10, min: 0, max: 60, row: 'cols3c' },
    { key: 'font', label: 'Fuente', type: 'select', value: defaultFont(), options: [...new Set([defaultFont(), ...STD_FONTS, ...fontFamilies()])].map(f => [f, STD_LABEL[f] || f]), row: 'cols' }, { key: 'start', label: 'Primer número', type: 'number', value: 1, row: 'cols' },
    { key: 'range', label: 'Páginas (vacío = todas)' }
  ], { wide: true, extraButtons: [{ label: 'Quitar', onClick: () => { d.checkpoint(); removeGroup(d, 'hf'); afterStructureChange(); return null; } }] });
  if (!v) return;
  let idx; try { idx = targetByRange(d, v.range); } catch (e) { toast(e.message, 'err'); return; }
  await ensureFont(v.font, false, false);
  d.checkpoint(); removeGroup(d, 'hf');
  idx.forEach((i, k) => {
    const p = d.pages[i];
    for (const slot of ['tl', 'tc', 'tr', 'bl', 'bc', 'br']) {
      if (!v[slot]) continue;
      const text = tokens(v[slot], (v.start ?? 1) + k, idx.length + (v.start ?? 1) - 1, d);
      const r = placeText(p, text, slot, { size: v.size, margin: (v.margin ?? 10) * PT_PER_MM, font: v.font });
      p.ov.push({ id: uid(), type: 'text', group: 'hf', text, size: v.size, color: v.color, font: v.font, bold: false, italic: false, bg: '', border: '', pad: 0, ...r });
    }
  });
  afterStructureChange();
}
async function pageNumbersDialog() {
  const d = D();
  const v = await formDialog('Números de página', [
    { key: 'fmt', label: 'Formato', type: 'select', value: 'Página {n} de {N}', options: [['{n}', '1'], ['Página {n}', 'Página 1'], ['Página {n} de {N}', 'Página 1 de 10'], ['{n} / {N}', '1 / 10'], ['- {n} -', '- 1 -'], ['Pág. {n}', 'Pág. 1']] },
    { key: 'pos', label: 'Posición', type: 'pos', value: 'bc', positions: ['tl', 'tc', 'tr', 'bl', 'bc', 'br'] },
    { key: 'size', label: 'Tamaño (pt)', type: 'number', value: 10, min: 5, max: 40, row: 'cols3' }, { key: 'margin', label: 'Margen (mm)', type: 'number', value: 10, row: 'cols3' }, { key: 'start', label: 'Empezar en', type: 'number', value: 1, row: 'cols3' },
    { key: 'color', label: 'Color', type: 'color', value: '#333333' },
    { key: 'range', label: 'Páginas (vacío = todas)', placeholder: 'Ej.: 2- para omitir la portada' }
  ], { extraButtons: [{ label: 'Quitar numeración', onClick: () => { d.checkpoint(); removeGroup(d, 'pn'); afterStructureChange(); return null; } }] });
  if (!v) return;
  let idx; try { idx = targetByRange(d, v.range); } catch (e) { toast(e.message, 'err'); return; }
  const pf = defaultFont(); await ensureFont(pf, false, false);
  d.checkpoint(); removeGroup(d, 'pn');
  const start = v.start ?? 1, N = idx.length + start - 1;
  idx.forEach((i, k) => {
    const p = d.pages[i], text = tokens(v.fmt, start + k, N, d);
    p.ov.push({ id: uid(), type: 'text', group: 'pn', text, size: v.size, color: v.color, font: pf, bold: false, italic: false, bg: '', border: '', pad: 0, ...placeText(p, text, v.pos, { size: v.size, margin: (v.margin ?? 10) * PT_PER_MM }) });
  });
  afterStructureChange();
}
async function batesDialog() {
  const d = D();
  const v = await formDialog('Numeración Bates', [
    { key: 'prefix', label: 'Prefijo', value: 'INV-', row: 'cols' }, { key: 'suffix', label: 'Sufijo', value: '', row: 'cols' },
    { key: 'start', label: 'Número inicial', type: 'number', value: 1, row: 'cols3' }, { key: 'digits', label: 'Dígitos', type: 'number', value: 6, min: 1, max: 12, row: 'cols3' }, { key: 'size', label: 'Tamaño (pt)', type: 'number', value: 9, row: 'cols3' },
    { key: 'pos', label: 'Posición', type: 'pos', value: 'br', positions: ['tl', 'tc', 'tr', 'bl', 'bc', 'br'] },
    { key: 'color', label: 'Color', type: 'color', value: '#000000' }, { key: 'range', label: 'Páginas (vacío = todas)' }
  ], { extraButtons: [{ label: 'Quitar Bates', onClick: () => { d.checkpoint(); removeGroup(d, 'bates'); afterStructureChange(); return null; } }] });
  if (!v) return;
  let idx; try { idx = targetByRange(d, v.range); } catch (e) { toast(e.message, 'err'); return; }
  d.checkpoint(); removeGroup(d, 'bates');
  idx.forEach((i, k) => {
    const p = d.pages[i], text = (v.prefix || '') + String((v.start ?? 1) + k).padStart(v.digits || 6, '0') + (v.suffix || '');
    p.ov.push({ id: uid(), type: 'text', group: 'bates', text, size: v.size, color: v.color, font: 'Helvetica', bold: true, italic: false, bg: '', border: '', pad: 0, ...placeText(p, text, v.pos, { size: v.size, margin: 8 * PT_PER_MM, bold: true }) });
  });
  afterStructureChange();
  toast(`Bates aplicado: ${(v.prefix || '')}${String(v.start ?? 1).padStart(v.digits || 6, '0')} – ${(v.prefix || '')}${String((v.start ?? 1) + idx.length - 1).padStart(v.digits || 6, '0')}`, 'ok', 5000);
}

/* ---------- Imágenes y firmas ---------- */
async function createAsset(doc, bytes, mime) {
  if (!/png|jpe?g/i.test(mime)) {
    const img = await loadImage(URL.createObjectURL(new Blob([bytes], { type: mime })));
    const c = el('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
    bytes = await canvasToBytes(c, 'image/png'); mime = 'image/png';
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const img = await loadImage(url);
  const id = uid(); doc.assets[id] = { id, bytes, mime: /png/i.test(mime) ? 'image/png' : 'image/jpeg', url, w: img.naturalWidth, h: img.naturalHeight };
  return doc.assets[id];
}
async function insertImage() {
  const d = D(); const fs = await pickLocal('image/*', false); if (!fs.length) return;
  const a = await createAsset(d, await readFileBytes(fs[0]), fs[0].type);
  S.pendingImage = { asset: a.id, w: a.w, h: a.h, defW: 220 }; setTool('image');
}
function trimCanvas(c) {
  const ctx = c.getContext('2d'), { width: w, height: h } = c, data = ctx.getImageData(0, 0, w, h).data;
  let x1 = w, y1 = h, x2 = 0, y2 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 10) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
  if (x2 <= x1 || y2 <= y1) return null;
  const pad = 6, o = el('canvas'); o.width = x2 - x1 + pad * 2; o.height = y2 - y1 + pad * 2;
  o.getContext('2d').drawImage(c, x1 - pad, y1 - pad, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}
async function signatureDialog() {
  const d = D();
  let mode = 'draw';
  const sigs = store.get('sigs', []);
  const pad = el('canvas', { class: 'sigpad', width: 900, height: 300 });
  const pctx = pad.getContext('2d'); let drawing = false, last = null, inkCol = '#1b2a6b';
  const pos = e => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; };
  pad.onpointerdown = e => { drawing = true; last = pos(e); pad.setPointerCapture(e.pointerId); };
  pad.onpointermove = e => { if (!drawing) return; const p = pos(e); pctx.strokeStyle = inkCol; pctx.lineWidth = 5; pctx.lineCap = 'round'; pctx.lineJoin = 'round'; pctx.beginPath(); pctx.moveTo(...last); pctx.lineTo(...p); pctx.stroke(); last = p; };
  pad.onpointerup = () => drawing = false;
  const typed = el('input', { type: 'text', placeholder: 'Escriba su nombre', value: S.settings.author || '' });
  const fontSel = el('select'); for (const f of ['Segoe Script', 'Brush Script MT', 'Lucida Handwriting', 'Ink Free', 'cursive']) fontSel.append(el('option', { value: f, text: f }));
  const typedPrev = el('div', { style: { fontSize: '44px', minHeight: '70px', padding: '8px', border: '1px dashed var(--line)', borderRadius: '8px', background: '#fff', color: '#1b2a6b' } });
  const updTyped = () => { typedPrev.textContent = typed.value; typedPrev.style.fontFamily = `"${fontSel.value}", cursive`; }; typed.oninput = updTyped; fontSel.onchange = updTyped; updTyped();
  const colors = el('div', { class: 'swatches' }); for (const c of ['#1b2a6b', '#111111', '#1f5fbf']) colors.append(el('div', { class: 'sw' + (c === inkCol ? ' on' : ''), style: { background: c }, onclick: e => { inkCol = c; typedPrev.style.color = c; $$('.sw', colors).forEach(x => x.classList.toggle('on', x === e.target)); } }));
  const fileBtn = el('button', { class: 'btn', html: ic('upload') + 'Elegir imagen de firma (PNG con fondo transparente recomendado)' });
  let fileAsset = null; const filePrev = el('div', { style: { marginTop: '8px' } });
  fileBtn.onclick = async () => { const f = await pickLocal('image/*', false); if (!f.length) return; fileAsset = { bytes: await readFileBytes(f[0]), mime: f[0].type }; filePrev.innerHTML = ''; filePrev.append(el('img', { src: URL.createObjectURL(f[0]), style: { maxHeight: '90px', background: '#fff', border: '1px solid var(--line)', borderRadius: '6px' } })); };
  const panes = { draw: el('div', {}, pad, el('div', { class: 'inline', style: { marginTop: '6px', justifyContent: 'space-between', display: 'flex' } }, colors, el('button', { class: 'btn sm', text: 'Borrar', onclick: () => pctx.clearRect(0, 0, pad.width, pad.height) }))),
    type: el('div', { class: 'fm' }, el('div', { class: 'cols' }, el('div', { class: 'row' }, el('label', { text: 'Nombre' }), typed), el('div', { class: 'row' }, el('label', { text: 'Estilo' }), fontSel)), typedPrev),
    file: el('div', {}, fileBtn, filePrev) };
  const tabs = el('div', { class: 'tabs2' }); const paneBox = el('div');
  for (const [k, l] of [['draw', 'Dibujar'], ['type', 'Escribir'], ['file', 'Imagen']]) tabs.append(el('button', { text: l, class: k === mode ? 'on' : '', onclick: e => { mode = k; $$('button', tabs).forEach(b => b.classList.toggle('on', b === e.target)); paneBox.innerHTML = ''; paneBox.append(panes[k]); } }));
  paneBox.append(panes.draw);
  const saved = el('div', { class: 'sig-list' });
  let chosen = null;
  const m = { close: null };
  const drawSaved = () => {
    saved.innerHTML = ''; if (!sigs.length) return;
    sigs.forEach((s, i) => saved.append(el('div', { class: 'sig-item', title: 'Usar esta firma', onclick: () => { chosen = s; m.ref.close('saved'); } }, el('img', { src: s }), el('button', { class: 'del', text: '×', onclick: e => { e.stopPropagation(); sigs.splice(i, 1); store.set('sigs', sigs); drawSaved(); } }))));
  };
  drawSaved();
  const keep = el('input', { type: 'checkbox' }); keep.checked = true;
  const body = el('div', {}, sigs.length ? el('div', { class: 'hint', text: 'Firmas guardadas (clic para usar):' }) : null, saved, el('div', { style: { height: '12px' } }), tabs, paneBox,
    el('label', { class: 'inline', style: { marginTop: '10px' } }, keep, 'Guardar esta firma para usarla después'));
  m.ref = openModal({ title: 'Firma', body, wide: true, buttons: [{ label: 'Cancelar', value: null }, { label: 'Colocar firma', primary: true, value: 'new' }] });
  const r = await m.ref.result; if (!r) return;
  let dataUrl = chosen;
  if (r === 'new') {
    if (mode === 'draw') { const t = trimCanvas(pad); if (!t) { toast('Dibuje la firma primero.', 'err'); return; } dataUrl = t.toDataURL('image/png'); }
    else if (mode === 'type') {
      if (!typed.value.trim()) return;
      const c = el('canvas', { width: 1400, height: 260 }), x = c.getContext('2d');
      x.font = `120px "${fontSel.value}", cursive`; x.fillStyle = typedPrev.style.color || inkCol; x.textBaseline = 'middle'; x.fillText(typed.value, 20, 130);
      const t = trimCanvas(c); if (!t) return; dataUrl = t.toDataURL('image/png');
    } else { if (!fileAsset) return; dataUrl = await bytesToDataUrl(fileAsset.bytes, fileAsset.mime); }
    if (keep.checked) { sigs.unshift(dataUrl); store.set('sigs', sigs.slice(0, 8)); }
  }
  const b = dataUrlToBytes(dataUrl); const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
  const a = await createAsset(d, b, mime);
  S.pendingImage = { asset: a.id, w: a.w, h: a.h, defW: 150 }; setTool('image');
  toast('Haga clic en la página donde va la firma.');
}

/* ---------- Seguridad ---------- */
async function protectDialog() {
  const d = D(); const s = d.security || { perms: { print: true, copy: false, modify: false, annotate: false, forms: true, assemble: false } };
  const v = await formDialog('Proteger con contraseña', [
    { type: 'hint', label: 'Cifrado AES-256. La protección se aplica al guardar el documento.' },
    { key: 'userPw', label: 'Contraseña para abrir (opcional)', type: 'password', value: s.inherited ? s.userPw : (s.userPw || '') },
    { key: 'userPw2', label: 'Confirmar contraseña', type: 'password', value: s.inherited ? s.userPw : (s.userPw || '') },
    { key: 'ownerPw', label: 'Contraseña de permisos (restringe impresión, copia y edición)', type: 'password', value: s.ownerPw || '' },
    { type: 'heading', label: 'Permitir a quien abra el documento' },
    { key: 'print', label: 'Imprimir', type: 'checkbox', value: s.perms.print }, { key: 'copy', label: 'Copiar texto e imágenes', type: 'checkbox', value: s.perms.copy },
    { key: 'modify', label: 'Modificar el documento', type: 'checkbox', value: s.perms.modify }, { key: 'annotate', label: 'Agregar comentarios', type: 'checkbox', value: s.perms.annotate },
    { key: 'forms', label: 'Rellenar formularios', type: 'checkbox', value: s.perms.forms }, { key: 'assemble', label: 'Insertar, girar o eliminar páginas', type: 'checkbox', value: s.perms.assemble }
  ], { ok: 'Aplicar protección', validate: v => v.userPw !== v.userPw2 ? 'Las contraseñas no coinciden.' : (!v.userPw && !v.ownerPw ? 'Indique al menos una contraseña.' : null) });
  if (!v) return;
  d.checkpoint();
  d.security = { userPw: v.userPw, ownerPw: v.ownerPw || '', perms: { print: v.print, copy: v.copy, modify: v.modify, annotate: v.annotate, forms: v.forms, assemble: v.assemble } };
  updateStatus(); toast('Protección configurada. Guarde el documento para aplicarla.', 'ok');
}
async function removeSecurity() {
  const d = D(); if (!d.security) { toast('El documento no tiene contraseña.'); return; }
  if (!(await confirmDialog('Quitar seguridad', 'Al guardar, el documento quedará sin contraseña ni restricciones.', 'Quitar'))) return;
  d.checkpoint(); d.security = null; updateStatus(); toast('Seguridad eliminada. Guarde para aplicar.', 'ok');
}

/* ---------- Búsqueda ---------- */
const SR = { q: '', hits: [], cur: -1, cs: false };
function normalizeStr(s, cs) { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); return cs ? s : s.toLowerCase(); }
async function runSearch(q) {
  const d = D(); SR.q = q; SR.hits = []; SR.cur = -1;
  if (!d || !q.trim()) { applySearchHighlights(); return; }
  const nq = normalizeStr(q, SR.cs);
  for (let i = 0; i < d.pages.length; i++) {
    const p = d.pages[i];
    let runs = []; try { runs = await textRuns(d, p); } catch { }
    for (const r of runs) {
      const ns = normalizeStr(r.str, SR.cs); let k = ns.indexOf(nq);
      while (k >= 0) {
        const fw = metricWidth(r.str, 'Helvetica', false, false, r.size) || 1;
        const a = metricWidth(r.str.slice(0, k), 'Helvetica', false, false, r.size) / fw, b = metricWidth(r.str.slice(0, k + q.length), 'Helvetica', false, false, r.size) / fw;
        SR.hits.push({ pi: i, pid: p.id, x: r.x + r.w * a, y: r.y, w: Math.max(2, r.w * (b - a)), h: r.h, snip: r.str.slice(Math.max(0, k - 25), k + q.length + 30) });
        k = ns.indexOf(nq, k + nq.length);
      }
    }
  }
  if (SR.hits.length) SR.cur = 0;
  applySearchHighlights(); renderSearchResults();
  if (SR.hits.length) goToHit(0);
}
function goToHit(i) {
  if (!SR.hits.length) return; SR.cur = (i + SR.hits.length) % SR.hits.length;
  const h = SR.hits[SR.cur], d = D(); const parts = R.els.get(h.pid);
  if (parts) viewerEl().scrollTo({ top: parts.pe.offsetTop + h.y * d.scale - viewerEl().clientHeight / 3 });
  applySearchHighlights(); $$('#side-body .si.hit').forEach((x, k) => x.style.background = k === SR.cur ? 'var(--accent2)' : '');
}
function applySearchHighlights(only) {
  const d = D(); if (!d) return;
  for (const [pid, parts] of R.els) {
    if (only && pid !== only) continue;
    $$('.search-hit', parts.sl).forEach(x => x.remove());
    SR.hits.forEach((h, k) => { if (h.pid === pid) parts.sl.append(el('div', { class: 'search-hit' + (k === SR.cur ? ' cur' : ''), style: { left: h.x * d.scale + 'px', top: h.y * d.scale + 'px', width: h.w * d.scale + 'px', height: h.h * d.scale + 'px' } })); });
  }
}
function redactHits() {
  const d = D(); if (!SR.hits.length) return;
  d.checkpoint();
  for (const h of SR.hits) d.page(h.pid).ov.push({ id: uid(), type: 'redact', x: h.x - 1, y: h.y, w: h.w + 2, h: h.h });
  afterStructureChange(); toast(`${SR.hits.length} coincidencias marcadas para redacción. Se aplicará al guardar.`, 'ok', 5000);
}

/* ---------- Panel lateral ---------- */
const SIDE = [['thumbs', 'layout-panel-left', 'Miniaturas'], ['bookmarks', 'bookmark', 'Marcadores'], ['comments', 'message-square', 'Comentarios'], ['signatures', 'file-badge', 'Firmas'], ['search', 'search', 'Buscar']];
function renderSide() {
  const d = D(); const sb = $('#sidebar'); sb.style.display = d && d.view !== 'organize' ? '' : 'none'; if (!d) return;
  sb.classList.toggle('collapsed', !S.sideOpen);
  const icons = $('#side-icons'); icons.innerHTML = '';
  for (const [k, icn, l] of SIDE) icons.append(el('button', { class: 'icon-btn' + (S.side === k && S.sideOpen ? ' on' : ''), html: ic(icn), title: l, onclick: () => { if (S.side === k) S.sideOpen = !S.sideOpen; else { S.side = k; S.sideOpen = true; } renderSide(); } }));
  if (!S.sideOpen) return;
  const head = $('#side-head'), body = $('#side-body'); body.innerHTML = '';
  head.innerHTML = ''; head.append(el('span', { text: SIDE.find(x => x[0] === S.side)[2] }), el('button', { class: 'icon-btn sm', html: ic('chevrons-left'), title: 'Ocultar panel', onclick: () => { S.sideOpen = false; renderSide(); } }));
  if (S.side === 'thumbs') {
    const box = el('div', { class: 'thumbs' });
    d.pages.forEach((p, i) => { const t = el('div', { class: 'thumb' + (i === d.cur ? ' cur' : ''), dataset: { i }, onclick: () => { goToPage(i); if (isPhone()) { S.sideOpen = false; renderSide(); } } }); const tc = el('div', { class: 'tc' }); thumbImg(d, p, tc, 130, 165); t.append(tc, el('div', { class: 'tl', text: i + 1 })); box.append(t); });
    body.append(box);
  } else if (S.side === 'comments') renderCommentsList(body);
  else if (S.side === 'bookmarks') renderBookmarks(body);
  else if (S.side === 'signatures') renderSignatures(body);
  else if (S.side === 'search') {
    const inp = el('input', { type: 'text', placeholder: 'Buscar en el documento…', value: SR.q });
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); if (inp.value === SR.q && SR.hits.length) goToHit(SR.cur + (e.shiftKey ? -1 : 1)); else withBusy('Buscando…', () => runSearch(inp.value)); } };
    const cs = el('input', { type: 'checkbox' }); cs.checked = SR.cs; cs.onchange = () => { SR.cs = cs.checked; };
    body.append(el('div', { class: 'search-box' }, inp, el('button', { class: 'btn sm', html: ic('search'), onclick: () => withBusy('Buscando…', () => runSearch(inp.value)) })),
      el('label', { class: 'inline hint', style: { marginBottom: '8px' } }, cs, 'Distinguir mayúsculas'), el('div', { id: 'search-results' }));
    renderSearchResults(); setTimeout(() => inp.focus(), 20);
  }
}
function renderSearchResults() {
  const box = $('#search-results'); if (!box) return; box.innerHTML = '';
  if (!SR.q) return;
  box.append(el('div', { class: 'inline', style: { justifyContent: 'space-between', display: 'flex', marginBottom: '6px' } },
    el('span', { class: 'hint', text: SR.hits.length ? `${SR.hits.length} resultado(s)` : 'Sin resultados' }),
    SR.hits.length ? el('span', {}, el('button', { class: 'icon-btn sm', html: ic('chevron-up'), onclick: () => goToHit(SR.cur - 1) }), el('button', { class: 'icon-btn sm', html: ic('chevron-down'), onclick: () => goToHit(SR.cur + 1) })) : null));
  if (SR.hits.length) box.append(el('button', { class: 'btn sm', html: ic('eraser') + 'Redactar todas', style: { marginBottom: '8px' }, onclick: redactHits }));
  const l = el('div', { class: 'slist' });
  SR.hits.slice(0, 300).forEach((h, k) => l.append(el('div', { class: 'si hit', onclick: () => goToHit(k), style: { background: k === SR.cur ? 'var(--accent2)' : '' } }, el('b', { text: h.pi + 1, style: { minWidth: '22px' } }), el('span', { class: 'tx', text: h.snip }))));
  box.append(l);
}
function refreshSideIfComments() { if (S.side === 'comments' && S.sideOpen && D()) renderSide(); }
function renderCommentsList(body) {
  const d = D(); const l = el('div', { class: 'slist' }); let any = false;
  const icon = { highlight: 'highlighter', underline: 'underline', strike: 'strikethrough', note: 'message-square', text: 'type', ink: 'pencil', rect: 'square', ellipse: 'circle', line: 'minus', arrow: 'move-up-right', stamp: 'stamp', image: 'image', whiteout: 'square-dashed', redact: 'eye-off', textedit: 'text-cursor-input', field: 'text-cursor' };
  d.pages.forEach((p, i) => {
    const items = p.ov.filter(o => o.type !== 'ocrword' && !o.group); if (!items.length) return;
    any = true; l.append(el('div', { class: 'grp', text: 'Página ' + (i + 1) }));
    for (const o of items) {
      const txt = o.type === 'note' ? (o.author ? o.author + ': ' : '') + (o.text || '') : o.text || o.label || o.name || TOOL_NAMES[o.type];
      l.append(el('div', { class: 'si', onclick: () => { if (S.tool !== 'select') setTool('select'); goToPage(i); selectObj(p.id, o.id); } }, icEl(icon[o.type] || 'square'), el('span', { class: 'tx', text: txt })));
    }
  });
  if (!any) l.append(el('div', { class: 'hint', text: 'No hay anotaciones todavía.' }));
  body.append(l);
}
async function renderBookmarks(body) {
  const d = D(); const src = Object.values(d.sources).find(s => s.kind === 'pdf');
  if (!src) { body.append(el('div', { class: 'hint', text: 'Sin marcadores.' })); return; }
  let ol = null; try { ol = await src.pdf.getOutline(); } catch { }
  if (!ol || !ol.length) { body.append(el('div', { class: 'hint', text: 'Este documento no tiene marcadores.' })); return; }
  const go = async it => {
    try {
      let dest = it.dest; if (typeof dest === 'string') dest = await src.pdf.getDestination(dest);
      if (!dest) return; const idx = typeof dest[0] === 'object' ? await src.pdf.getPageIndex(dest[0]) : dest[0];
      const pi = d.pages.findIndex(p => p.src === src.id && p.idx === idx); if (pi >= 0) goToPage(pi); else toast('La página de este marcador ya no está en el documento.');
    } catch { }
  };
  const mk = (items, lvl) => { for (const it of items) { body.append(el('div', { class: 'slist' }, el('div', { class: 'si', style: { paddingLeft: 8 + lvl * 14 + 'px' }, onclick: () => go(it) }, icEl('bookmark'), el('span', { class: 'tx', text: it.title })))); if (it.items?.length) mk(it.items, lvl + 1); } };
  mk(ol, 0);
}

/* ---------- Formularios ---------- */
function exportFormCsv() {
  const d = D(); const names = [], vals = [];
  for (const s of Object.values(d.formValues)) for (const [k, v] of Object.entries(s)) { names.push(k); vals.push(typeof v === 'boolean' ? (v ? 'Sí' : 'No') : v); }
  for (const p of d.pages) for (const o of p.ov) if (o.type === 'field') { names.push(o.name); vals.push(o.ftype === 'check' ? (o.checked ? 'Sí' : 'No') : (o.value || '')); }
  if (!names.length) { toast('El documento no tiene campos de formulario.'); return; }
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  download(new Blob(['﻿' + names.map(q).join(',') + '\r\n' + vals.map(q).join(',') + '\r\n'], { type: 'text/csv' }), baseName(d.name) + '_datos.csv');
}
async function resetForm() {
  const d = D(); if (!docHasForms(d)) { toast('El documento no tiene un formulario existente.'); return; }
  if (!(await confirmDialog('Restablecer formulario', 'Se devolverán todos los campos a sus valores originales.', 'Restablecer'))) return;
  d.checkpoint(); d.formValues = structuredClone(d.formOrig); for (const p of d.pages) renderFormLayer(p);
}
function toggleFieldHighlight() { document.body.classList.toggle('no-fhl'); }

/* ---------- Conversión ---------- */
async function finalPdfjs(d, upd) {
  const bytes = await buildPdf(d, { noEncrypt: true, progress: upd });
  return pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
}
async function pageLines(pg) {
  const tc = await pg.getTextContent(); const vp = pg.getViewport({ scale: 1 });
  const items = [];
  for (const it of tc.items) {
    if (!it.str) continue; const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
    items.push({ str: it.str, x: tx[4], base: tx[5], w: it.width, size: Math.hypot(tx[2], tx[3]) || 10 });
  }
  items.sort((a, b) => a.base - b.base || a.x - b.x);
  const lines = [];
  for (const it of items) {
    let l = lines[lines.length - 1];
    if (!l || Math.abs(l.base - it.base) > Math.max(2, it.size * 0.4)) { l = { base: it.base, size: it.size, items: [] }; lines.push(l); }
    l.items.push(it); l.size = Math.max(l.size, it.size);
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x); let s = '', end = null;
    for (const it of l.items) { if (end != null) { const gap = it.x - end; if (gap > it.size * 0.15 && !/\s$/.test(s) && !/^\s/.test(it.str)) s += gap > it.size * 2 ? '    ' : ' '; } s += it.str; end = it.x + it.w; }
    l.text = s.replace(/\s+$/, ''); l.x = l.items[0]?.x || 0;
  }
  return { lines, width: vp.width, height: vp.height };
}
async function convertDialog(kind) {
  const d = D(); if (!d) return;
  const titles = { word: 'Convertir a Word (.docx)', excel: 'Convertir a Excel (.xlsx)', image: 'Convertir a imágenes', text: 'Convertir a texto (.txt)' };
  const fields = [{ key: 'range', label: 'Páginas (vacío = todas)', placeholder: '1-3, 5' }];
  if (kind === 'word') fields.unshift({ key: 'mode', label: 'Modo', type: 'select', value: 'text', options: [['text', 'Texto editable (párrafos)'], ['image', 'Diseño exacto (cada página como imagen)']] });
  if (kind === 'image') fields.unshift({ key: 'fmt', label: 'Formato', type: 'select', value: 'png', options: [['png', 'PNG'], ['jpg', 'JPG']], row: 'cols' }, { key: 'dpi', label: 'Resolución', type: 'select', value: '150', options: [['72', '72 ppp'], ['150', '150 ppp'], ['200', '200 ppp'], ['300', '300 ppp']], row: 'cols' });
  if (kind === 'excel') fields.push({ type: 'hint', label: 'Detecta columnas por la posición del texto. Funciona mejor con tablas de PDFs digitales (no escaneados).' });
  if (kind === 'word') fields.push({ type: 'hint', label: 'El modo texto recupera el contenido para editarlo; el modo diseño conserva la apariencia exacta pero no es editable.' });
  const v = await formDialog(titles[kind], fields, { ok: 'Convertir' }); if (!v) return;
  try {
    await withBusy('Convirtiendo…', async upd => {
      const pj = await finalPdfjs(d, upd);
      const idx = parseRanges(v.range, pj.numPages);
      const name = baseName(d.name);
      if (kind === 'image') {
        const files = [];
        for (let k = 0; k < idx.length; k++) {
          upd(`Página ${idx[k] + 1}…`, k / idx.length * 100);
          const pg = await pj.getPage(idx[k] + 1), vp = pg.getViewport({ scale: +v.dpi / 72 });
          const c = el('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
          await pg.render({ canvasContext: x, viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE }).promise;
          files.push({ name: `${name}_p${idx[k] + 1}.${v.fmt}`, blob: await canvasToBlob(c, v.fmt === 'jpg' ? 'image/jpeg' : 'image/png', 0.9) }); c.width = 0;
        }
        if (files.length === 1) download(files[0].blob, files[0].name);
        else { const z = new JSZip(); files.forEach(f => z.file(f.name, f.blob)); download(await z.generateAsync({ type: 'blob' }), name + '_imagenes.zip'); }
      } else if (kind === 'text') {
        let out = '';
        for (const i of idx) { const { lines } = await pageLines(await pj.getPage(i + 1)); out += (out ? '\n\n' : '') + `--- Página ${i + 1} ---\n` + lines.map(l => l.text).join('\n'); }
        download(new Blob(['﻿' + out], { type: 'text/plain;charset=utf-8' }), name + '.txt');
      } else if (kind === 'word') download(await buildDocx(pj, idx, v.mode, upd), name + '.docx');
      else if (kind === 'excel') download(await buildXlsx(pj, idx, upd), name + '.xlsx');
      pj.destroy();
    });
    toast('Conversión completada.', 'ok');
  } catch (e) { console.error(e); toast('Error al convertir: ' + e.message, 'err'); }
}
const xmlEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
async function buildDocx(pj, idx, mode, upd) {
  const z = new JSZip(); const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  let body = '', rels = '', imgN = 0;
  const pgBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const first = await pj.getPage(idx[0] + 1), fv = first.getViewport({ scale: 1 });
  const landscape = fv.width > fv.height;
  const pgW = landscape ? 15840 : 12240, pgH = landscape ? 12240 : 15840, mar = mode === 'image' ? 720 : 1134;
  for (let k = 0; k < idx.length; k++) {
    upd && upd(`Página ${idx[k] + 1}…`, k / idx.length * 100);
    const pg = await pj.getPage(idx[k] + 1);
    if (k) body += pgBreak;
    if (mode === 'image') {
      const vp = pg.getViewport({ scale: 150 / 72 }); const c = el('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); await pg.render({ canvasContext: x, viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE }).promise;
      imgN++; z.file(`word/media/p${imgN}.jpeg`, await canvasToBlob(c, 'image/jpeg', 0.88));
      const maxW = (pgW - 2 * mar) / 1440 * 914400, maxH = (pgH - 2 * mar - 300) / 1440 * 914400;
      const k2 = Math.min(maxW / c.width, maxH / c.height), cx = Math.round(c.width * k2), cy = Math.round(c.height * k2); c.width = 0;
      rels += `<Relationship Id="rImg${imgN}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/p${imgN}.jpeg"/>`;
      body += `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${imgN}" name="Pagina ${imgN}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${imgN}" name="p${imgN}.jpeg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rImg${imgN}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    } else {
      const { lines } = await pageLines(pg);
      let para = null; const paras = [];
      for (const l of lines) {
        if (para && l.base - para.last < para.size * 1.75 && Math.abs(l.size - para.size) < 1.5 && Math.abs(l.x - para.x) < para.size * 3) { para.text += (para.text.endsWith('-') ? '' : ' ') + l.text.trim(); para.last = l.base; }
        else { para = { text: l.text.trim(), size: l.size, x: l.x, last: l.base }; paras.push(para); }
      }
      for (const p of paras) {
        if (!p.text) continue;
        const sz = Math.round(clamp(p.size, 6, 48) * 2);
        body += `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:rPr><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>${p.size >= 15 ? '<w:b/>' : ''}</w:rPr><w:t xml:space="preserve">${xmlEsc(p.text)}</w:t></w:r></w:p>`;
      }
    }
  }
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  z.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`);
  z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}<w:sectPr><w:pgSz w:w="${pgW}" w:h="${pgH}"${landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${mar}" w:right="${mar}" w:bottom="${mar}" w:left="${mar}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
function colName(i) { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; }
function parseNum(s) {
  const t = String(s).trim().replace(/[\s$L€]/g, '');
  if (!/^-?\(?[\d.,]+\)?%?$/.test(t) || !/\d/.test(t)) return null;
  let x = t.replace(/[()%]/g, ''); const neg = /^\(.*\)$/.test(t) || x.startsWith('-'); x = x.replace('-', '');
  const lc = x.lastIndexOf(','), ld = x.lastIndexOf('.');
  if (lc > -1 && ld > -1) x = lc > ld ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '');
  else if (lc > -1) x = /,\d{3}$/.test(x) && (x.match(/,/g) || []).length >= 1 && !/,\d{1,2}$/.test(x) ? x.replace(/,/g, '') : x.replace(',', '.');
  else if ((x.match(/\./g) || []).length > 1) x = x.replace(/\./g, '');
  const n = parseFloat(x); if (isNaN(n)) return null;
  return (neg ? -n : n) / (t.endsWith('%') ? 100 : 1);
}
async function buildXlsx(pj, idx, upd) {
  const z = new JSZip(); let sheets = '', wbRels = '', ct = '';
  for (let k = 0; k < idx.length; k++) {
    upd && upd(`Página ${idx[k] + 1}…`, k / idx.length * 100);
    const { lines } = await pageLines(await pj.getPage(idx[k] + 1));
    const rows = lines.map(l => {
      const cells = []; let cur = null;
      const parts = [];
      for (const it of l.items) {
        // separar columnas escritas en un mismo bloque con 2+ espacios
        const segs = it.str.split(/(\s{2,})/); if (segs.length === 1) { parts.push(it); continue; }
        const per = it.w / Math.max(1, it.str.length); let off = 0;
        for (const sg of segs) { if (sg.trim()) parts.push({ str: sg, x: it.x + off * per, w: sg.length * per, size: it.size }); off += sg.length; }
      }
      for (const it of parts) {
        if (cur && it.x - cur.end < Math.max(it.size * 1.0, 4)) { cur.text += (it.x - cur.end > it.size * 0.15 ? ' ' : '') + it.str; cur.end = it.x + it.w; }
        else { cur = { x: it.x, end: it.x + it.w, text: it.str }; cells.push(cur); }
      }
      return cells.filter(c => c.text.trim());
    }).filter(r => r.length);
    const xs = rows.flat().map(c => c.x).sort((a, b) => a - b), anchors = [];
    for (const x of xs) if (!anchors.length || x - anchors[anchors.length - 1] > 9) anchors.push(x);
    let sd = '';
    rows.forEach((r, ri) => {
      const cols = new Map();
      for (const c of r) { let ci = 0; for (let a = 0; a < anchors.length; a++) if (anchors[a] <= c.x + 4.5) ci = a; cols.set(ci, (cols.has(ci) ? cols.get(ci) + ' ' : '') + c.text.trim()); }
      sd += `<row r="${ri + 1}">`;
      for (const [ci, t] of [...cols.entries()].sort((a, b) => a[0] - b[0])) {
        const ref = colName(ci) + (ri + 1), n = parseNum(t);
        sd += n != null ? `<c r="${ref}"><v>${n}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(t)}</t></is></c>`;
      }
      sd += '</row>';
    });
    const n = k + 1;
    z.file(`xl/worksheets/sheet${n}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sd}</sheetData></worksheet>`);
    sheets += `<sheet name="Pagina ${idx[k] + 1}" sheetId="${n}" r:id="rId${n}"/>`;
    wbRels += `<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`;
    ct += `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  }
  z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${ct}</Types>`);
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  z.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`);
  z.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${wbRels}</Relationships>`);
  return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/* ---------- OCR (Tesseract incluido en la app: funciona sin internet) ---------- */
const OCR_BASE = new URL('ocr/', location.href).href;
const OCR_OPTS = { workerPath: OCR_BASE + 'worker.min.js', corePath: OCR_BASE + 'core', langPath: OCR_BASE + 'lang', gzip: true, cacheMethod: 'none' };
async function loadTesseract() {
  if (window.Tesseract) return;
  await new Promise((res, rej) => { const s = el('script', { src: OCR_BASE + 'tesseract.min.js' }); s.onload = res; s.onerror = () => rej(new Error('No se encontró el motor OCR (carpeta «ocr» de la aplicación).')); document.head.append(s); });
}
async function ocrDialog() {
  const d = D();
  const v = await formDialog('Reconocimiento de texto (OCR)', [
    { type: 'hint', label: 'Convierte páginas escaneadas en texto buscable y seleccionable (se agrega una capa de texto invisible sobre la imagen). Funciona sin internet: el motor y los idiomas vienen incluidos en Rúbrica.' },
    { key: 'lang', label: 'Idioma del documento', type: 'select', value: 'spa+eng', options: [['spa', 'Español'], ['eng', 'Inglés'], ['spa+eng', 'Español + Inglés'], ['por', 'Portugués'], ['fra', 'Francés']] },
    { key: 'range', label: 'Páginas', value: String(d.cur + 1), hint: 'Vacío = todas' },
    { key: 'quality', label: 'Calidad', type: 'select', value: '2.8', options: [['2', 'Rápida (144 ppp)'], ['2.8', 'Normal (200 ppp)'], ['4.2', 'Alta (300 ppp)']] }
  ], { ok: 'Reconocer texto' });
  if (!v) return;
  let idx; try { idx = parseRanges(v.range, d.pages.length); } catch (e) { toast(e.message, 'err'); return; }
  let allText = '';
  if (PSN) { try { allText = await ocrNative(d, idx); } catch (e) { toast('OCR: ' + (e.message || e), 'err'); return; } }
  else try {
    await withBusy('Cargando motor OCR…', async upd => {
      await loadTesseract();
      const worker = await Tesseract.createWorker(v.lang, 1, { ...OCR_OPTS, logger: m => { if (m.status && m.progress != null && /recogniz/i.test(m.status)) upd(null, m.progress * 100); else if (m.status) upd(({ 'loading tesseract core': 'Cargando motor…', 'loading language traineddata': 'Cargando idioma…', 'initializing api': 'Inicializando…' })[m.status] || null); } });
      const snap = d.snap(); let words = 0;
      for (let k = 0; k < idx.length; k++) {
        const p = d.pages[idx[k]];
        upd(`Reconociendo página ${idx[k] + 1} (${k + 1} de ${idx.length})…`, 0);
        const scale = +v.quality, cv = el('canvas'); await drawPage(d, p, scale, cv, 1);
        const res = await worker.recognize(cv, {}, { text: true, tsv: true });
        cv.width = 0;
        p.ov = p.ov.filter(o => o.type !== 'ocrword');
        for (const row of String(res.data.tsv || '').split('\n')) {
          const c = row.split('\t'); if (c[0] !== '5' || c.length < 12) continue;
          const t = c.slice(11).join(' ').trim(); if (!t || +c[10] < 15) continue;
          p.ov.unshift({ id: uid(), type: 'ocrword', t, x: +c[6] / scale, y: +c[7] / scale, w: +c[8] / scale, h: +c[9] / scale }); words++;
        }
        allText += (allText ? '\n\n' : '') + `--- Página ${idx[k] + 1} ---\n` + (res.data.text || '').trim();
      }
      await worker.terminate();
      d.undo.push(snap); d.redo = []; d.setDirty(true);
      if (!words) throw new Error('No se reconoció texto en las páginas indicadas.');
    });
  } catch (e) { toast(e.message, 'err', 6000); return; }
  SR.hits = []; afterStructureChange();
  const ta = el('textarea', { style: { width: '100%', height: '300px', fontFamily: 'Consolas, monospace', fontSize: '12px' } }); ta.value = allText;
  openModal({
    title: 'Texto reconocido', wide: true, body: el('div', {}, el('div', { class: 'hint', style: { marginBottom: '8px' }, html: 'La capa de texto se agregó al documento: ya puede buscar y, al <b>guardar</b>, el PDF quedará buscable y seleccionable.' }), ta),
    buttons: [{ label: 'Copiar texto', onClick: () => { navigator.clipboard.writeText(ta.value); toast('Copiado.', 'ok'); return false; } }, { label: 'Descargar .txt', onClick: () => { download(new Blob(['﻿' + ta.value], { type: 'text/plain' }), baseName(d.name) + '_ocr.txt'); return false; } }, { label: 'Cerrar', primary: true }]
  });
}

/* ---------- Compresión ---------- */
async function compressDialog() {
  const d = D();
  const orig = Object.values(d.sources).reduce((a, s) => a + (s.bytes?.length || 0), 0);
  const v = await formDialog('Comprimir PDF', [
    { key: 'mode', label: 'Nivel', type: 'select', value: 'medium', options: [['lossless', 'Sin pérdida — optimiza la estructura interna'], ['medium', 'Media — páginas como imagen 150 ppp'], ['strong', 'Fuerte — páginas como imagen 110 ppp'], ['max', 'Máxima — páginas como imagen 72 ppp']] },
    { type: 'hint', label: 'Los niveles con pérdida convierten cada página en imagen: el tamaño baja mucho en documentos escaneados, pero el texto deja de ser seleccionable (puede aplicar OCR después). El resultado se abre en una pestaña nueva para que lo revise antes de guardar.' }
  ], { ok: 'Comprimir' });
  if (!v) return;
  const cfg = { medium: { dpi: 150, quality: 0.72 }, strong: { dpi: 110, quality: 0.6 }, max: { dpi: 72, quality: 0.5 } }[v.mode];
  try {
    const bytes = await withBusy('Comprimiendo…', upd => buildPdf(d, { raster: cfg, progress: upd }));
    const nd = await openBytes(baseName(d.name) + '_comprimido.pdf', bytes);
    nd.dirty = true; if (d.security) nd.security = structuredClone(d.security); renderTabs();
    toast(`Tamaño: ${fmtSize(orig)} → ${fmtSize(bytes.length)} (${orig ? Math.round((1 - bytes.length / orig) * 100) : 0} % menos)`, bytes.length < orig ? 'ok' : '', 7000);
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- Imprimir ---------- */
async function printDoc() {
  const d = D(); if (!d) return;
  if (PSN) { try { const bytes = await withBusy('Preparando impresión…', upd => buildPdf(d, { noEncrypt: true, progress: upd })); await PSN.print({ name: d.name, data: u8ToB64(bytes) }); } catch (e) { toast(e.message || String(e), 'err'); } return; }
  try {
    const bytes = await withBusy('Preparando impresión…', upd => buildPdf(d, { noEncrypt: true, progress: upd }));
    const url = URL.createObjectURL(pdfBlob(bytes));
    const fr = el('iframe', { style: { position: 'fixed', right: 0, bottom: 0, width: '1px', height: '1px', border: 0, opacity: 0 }, src: url });
    fr.onload = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch { window.open(url, '_blank'); } setTimeout(() => fr.remove(), 60000); };
    document.body.append(fr);
  } catch (e) { toast(e.message, 'err'); }
}
