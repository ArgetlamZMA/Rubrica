/* ============================================================
   09 · Cinta de opciones, pantalla de inicio, atajos y arranque
   ============================================================ */
const T = t => ({ tool: t, icon: { select: 'mouse-pointer-2', hand: 'hand', highlight: 'highlighter', underline: 'underline', strike: 'strikethrough', note: 'message-square-plus', text: 'type', ink: 'pencil', rect: 'square', ellipse: 'circle', line: 'minus', arrow: 'move-up-right', stamp: 'stamp', eraser: 'eraser', edittext: 'text-cursor-input', whiteout: 'square-dashed', redact: 'eye-off', 'field-text': 'text-cursor', 'field-check': 'square-check', 'field-drop': 'list' }[t], label: TOOL_NAMES[t] });
const RIBBON = [
  { id: 'home', label: 'Inicio', groups: [
    [{ icon: 'folder-open', label: 'Abrir', act: openLocal, nodoc: true }, { icon: 'cloud', label: 'OneDrive', act: () => openFromCloud('onedrive'), nodoc: true }, { icon: 'cloud', label: 'Google Drive', act: () => openFromCloud('gdrive'), nodoc: true }],
    [{ icon: 'save', label: 'Guardar', act: () => saveDoc() }, { icon: 'save-all', label: 'Guardar como', act: () => saveDoc(D(), true) }, { icon: 'printer', label: 'Imprimir', act: printDoc }],
    [{ icon: 'combine', label: 'Combinar', act: () => combineDialog(false), nodoc: true }, { icon: 'images', label: 'Desde imágenes', act: () => combineDialog(true), nodoc: true }, { icon: 'file-plus', label: 'En blanco', act: newBlankDialog, nodoc: true }],
    [{ icon: 'undo-2', label: 'Deshacer', act: undo }, { icon: 'redo-2', label: 'Rehacer', act: redo }],
    [T('select'), T('hand')],
    [{ icon: 'info', label: 'Propiedades', act: propertiesDialog }]] },
  { id: 'comment', label: 'Comentar', groups: [
    [T('select'), T('hand')], [T('highlight'), T('underline'), T('strike')], [T('note'), T('text'), T('stamp')],
    [T('ink'), T('rect'), T('ellipse'), T('line'), T('arrow')],
    [T('eraser'), { icon: 'eye', label: 'Mostrar / ocultar', act: () => document.body.classList.toggle('hide-ann') }]] },
  { id: 'edit', label: 'Editar', groups: [
    [T('edittext'), { ...T('text'), label: 'Agregar texto' }, { icon: 'image-plus', label: 'Imagen', act: insertImage }, T('whiteout')],
    [{ icon: 'droplets', label: 'Marca de agua', act: watermarkDialog }, { icon: 'paint-bucket', label: 'Fondo', act: backgroundDialog }, { icon: 'panel-top', label: 'Encabezado y pie', act: headerFooterDialog }, { icon: 'list-ordered', label: 'Números de página', act: pageNumbersDialog }, { icon: 'hash', label: 'Bates', act: batesDialog }],
    [{ icon: 'crop', label: 'Recortar', act: cropDialog }]] },
  { id: 'pages', label: 'Organizar', groups: [
    [{ icon: 'layout-grid', label: 'Vista de páginas', act: () => setViewMode(D().view === 'organize' ? 'pages' : 'organize'), on: () => D()?.view === 'organize' }],
    [{ icon: 'file-plus-2', label: 'Insertar en blanco', act: insertBlankDialog }, { icon: 'file-input', label: 'Insertar archivo', act: insertFromFileDialog }],
    [{ icon: 'rotate-ccw', label: 'Girar izquierda', act: () => rotatePages(targetPages(), -1) }, { icon: 'rotate-cw', label: 'Girar derecha', act: () => rotatePages(targetPages(), 1) }, { icon: 'copy', label: 'Duplicar', act: () => duplicatePages(targetPages()) }, { icon: 'trash-2', label: 'Eliminar', act: () => deletePages(targetPages()) }],
    [{ icon: 'file-output', label: 'Extraer', act: extractDialog }, { icon: 'scissors', label: 'Dividir', act: splitDialog }, { icon: 'arrow-down-up', label: 'Invertir orden', act: reversePages }],
    [{ icon: 'crop', label: 'Recortar', act: cropDialog }]] },
  { id: 'convert', label: 'Convertir', groups: [
    [{ icon: 'file-text', label: 'A Word', act: () => convertDialog('word') }, { icon: 'sheet', label: 'A Excel', act: () => convertDialog('excel') }, { icon: 'file-image', label: 'A imágenes', act: () => convertDialog('image') }, { icon: 'file-type', label: 'A texto', act: () => convertDialog('text') }],
    [{ icon: 'scan-text', label: 'OCR', act: ocrDialog }], [{ icon: 'file-archive', label: 'Comprimir', act: compressDialog }],
    [{ icon: 'combine', label: 'Combinar', act: () => combineDialog(false), nodoc: true }, { icon: 'images', label: 'Desde imágenes', act: () => combineDialog(true), nodoc: true }]] },
  { id: 'form', label: 'Formulario', groups: [
    [T('field-text'), T('field-check'), T('field-drop')], [T('select')],
    [{ icon: 'table', label: 'Exportar datos (CSV)', act: exportFormCsv }, { icon: 'rotate-ccw', label: 'Restablecer', act: resetForm }, { icon: 'highlighter', label: 'Resaltar campos', act: toggleFieldHighlight }]] },
  { id: 'protect', label: 'Proteger', groups: [
    [{ icon: 'lock', label: 'Contraseña', act: protectDialog }, { icon: 'lock-open', label: 'Quitar seguridad', act: removeSecurity }],
    [{ icon: 'shield-check', label: 'Firma digital', act: digitalSignDialog }, { icon: 'signature', label: 'Firma manuscrita', act: signatureDialog }, { icon: 'file-badge', label: 'Ver firmas', act: () => { S.side = 'signatures'; S.sideOpen = true; renderSide(); } }],
    [T('redact'), { icon: 'search', label: 'Buscar y redactar', act: () => { S.side = 'search'; S.sideOpen = true; renderSide(); } }]] }
];
function renderRibbon() {
  const tabs = $('#ribbon-tabs'); tabs.innerHTML = '';
  for (const t of RIBBON) tabs.append(el('button', { class: 'rtab' + (S.ribbonTab === t.id ? ' active' : ''), text: t.label, onclick: () => { S.ribbonTab = t.id; renderRibbon(); } }));
  const rb = $('#ribbon'); rb.innerHTML = '';
  const tab = RIBBON.find(t => t.id === S.ribbonTab) || RIBBON[0];
  for (const g of tab.groups) {
    const ge = el('div', { class: 'rgroup' });
    for (const b of g) {
      const be = el('button', { class: 'rbtn', html: ic(b.icon) + `<span>${escapeHtml(b.label)}</span>`, title: b.title || b.label, dataset: b.tool ? { tool: b.tool } : {} });
      be._def = b;
      be.onclick = async () => {
        if (b.tool) { if (D()?.view === 'organize') setViewMode('pages'); setTool(S.tool === b.tool && b.tool !== 'select' ? 'select' : b.tool); return; }
        try { await b.act(); } catch (e) { console.error(e); toast(e.message || String(e), 'err', 6000); } finally { renderRibbonState(); }
      };
      ge.append(be);
    }
    rb.append(ge);
  }
  renderRibbonState();
}
function renderRibbonState() {
  const d = D();
  for (const be of $$('#ribbon .rbtn')) {
    const b = be._def;
    be.disabled = !d && !b.nodoc;
    be.classList.toggle('on', !!(b.tool ? S.tool === b.tool : b.on && b.on()));
    if (d && b.act === undo) be.disabled = !d.undo.length;
    if (d && b.act === redo) be.disabled = !d.redo.length;
  }
}

/* ---------- Pantalla de inicio ---------- */
function renderHome() {
  const box = $('#home'); box.innerHTML = '';
  const card = (icn, t, s, fn) => el('button', { class: 'hcard', onclick: () => Promise.resolve(fn()).catch(e => toast(e.message, 'err')) }, el('div', { class: 'hi', html: ic(icn) }), el('div', {}, el('b', { text: t }), el('span', { text: s })));
  const inner = el('div', { class: 'home-inner' },
    el('div', { class: 'home-brand', html: BRAND_ICON }),
    el('h1', { text: 'PDF Studio' }),
    el('p', { class: 'sub', text: 'Editor PDF local: lectura, comentarios, edición, páginas, formularios, firmas, protección, conversión y OCR — con OneDrive y Google Drive.' }),
    el('div', { class: 'home-cards' },
      card('folder-open', 'Abrir archivo', 'PDF o imagen de este equipo', openLocal),
      card('cloud', 'Abrir de OneDrive', CLOUD.onedrive.label2(), () => openFromCloud('onedrive')),
      card('cloud', 'Abrir de Google Drive', CLOUD.gdrive.label2(), () => openFromCloud('gdrive')),
      card('combine', 'Combinar archivos', 'Unir varios PDF e imágenes', () => combineDialog(false)),
      card('images', 'PDF desde imágenes', 'Fotos o escaneos a un PDF', () => combineDialog(true)),
      card('file-plus', 'Documento en blanco', 'Carta, A4, Oficio…', newBlankDialog)),
    el('div', { class: 'home-drop', html: ic('upload') + '<br>Arrastre aquí archivos PDF o imágenes para abrirlos' }));
  const rec = store.get('recent', []).filter(r => NATIVE || r.kind !== 'native');
  if (rec.length) {
    const list = el('div', { class: 'recent-list' });
    for (const r of rec) list.append(el('div', { class: 'recent-row', onclick: () => openRecent(r) }, icEl(r.kind === 'local' || r.kind === 'native' ? 'hard-drive' : 'cloud'), el('span', { class: 'nm', text: r.name }),
      el('span', { class: 'badge', text: r.kind === 'local' || r.kind === 'native' ? 'Este equipo' : r.kind === 'onedrive' ? 'OneDrive' : 'Google Drive' }), el('span', { class: 'src', text: fmtDate(r.t) }),
      el('button', { class: 'icon-btn sm', html: ic('x'), title: 'Quitar de la lista', onclick: e => { e.stopPropagation(); store.set('recent', store.get('recent', []).filter(x => x.key !== r.key)); renderHome(); } })));
    inner.append(el('div', { class: 'recent' }, el('h3', { text: 'Recientes' }), list));
  }
  if (!CLOUD.onedrive.configured() && !CLOUD.gdrive.configured()) inner.append(el('p', { class: 'hint', style: { marginTop: '22px' }, html: `Para abrir y guardar en la nube, configure OneDrive o Google Drive una sola vez en <a href="#" id="home-cfg">⚙ Configuración</a>.` }));
  box.append(inner);
  const cfg = $('#home-cfg'); if (cfg) cfg.onclick = e => { e.preventDefault(); settingsDialog().then(renderHome); };
}

/* ---------- Atajos de teclado ---------- */
function initKeys() {
  document.addEventListener('keydown', e => {
    if ($('#modal-root').children.length) return;
    const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
    const inField = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable;
    const d = D();
    if (ctrl && k === 'o') { e.preventDefault(); openLocal(); return; }
    if (ctrl && k === 's') { e.preventDefault(); if (d) saveDoc(d, e.shiftKey); return; }
    if (ctrl && k === 'p') { e.preventDefault(); if (d) printDoc(); return; }
    if (ctrl && k === 'f') { e.preventDefault(); if (d) { S.side = 'search'; S.sideOpen = true; renderSide(); } return; }
    if (ctrl && (k === '=' || k === '+')) { e.preventDefault(); setZoom('in'); return; }
    if (ctrl && k === '-') { e.preventDefault(); setZoom('out'); return; }
    if (ctrl && k === '0') { e.preventDefault(); setZoom('fitw'); return; }
    if (inField) { if (e.key === 'Escape' && S.editing) { e.target.blur(); commitEditing(); } return; }
    if (!d) return;
    if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (ctrl && k === 'y') { e.preventDefault(); redo(); return; }
    if (ctrl && k === 'd') { e.preventDefault(); duplicateSel(); return; }
    if (e.key === 'Escape') { if (S.sel) clearSel(); else if (S.tool !== 'select') setTool('select'); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel) { e.preventDefault(); deleteObj(S.sel.pid, S.sel.oid); return; }
    if (S.sel && e.key.startsWith('Arrow')) {
      e.preventDefault(); const o = selObj(); const st = e.shiftKey ? 10 : 1; if (!S.propCk) { d.checkpoint(); S.propCk = true; }
      if (e.key === 'ArrowLeft') o.x -= st; if (e.key === 'ArrowRight') o.x += st; if (e.key === 'ArrowUp') o.y -= st; if (e.key === 'ArrowDown') o.y += st;
      renderOverlays(d.page(S.sel.pid)); return;
    }
    if (e.key === 'PageDown') { e.preventDefault(); goToPage(d.cur + 1); return; }
    if (e.key === 'PageUp') { e.preventDefault(); goToPage(d.cur - 1); return; }
    if (e.key === 'Home' && ctrl) { goToPage(0); return; }
    if (e.key === 'End' && ctrl) { goToPage(d.pages.length - 1); return; }
    if (!ctrl && !e.altKey) { const map = { v: 'select', h: 'hand', t: 'text', n: 'note', p: 'ink', r: 'rect' }; if (map[k]) setTool(map[k]); }
  });
}
function initDnD() {
  let depth = 0;
  window.addEventListener('dragenter', e => { if (e.dataTransfer?.types?.includes('Files')) { depth++; document.body.classList.add('dragging'); } });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('dragging'); });
  window.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', e => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); depth = 0; document.body.classList.remove('dragging'); openDroppedFiles([...e.dataTransfer.files]); });
}
function initChrome() {
  $('#brand-mark').innerHTML = BRAND_ICON;
  $('#btn-theme').innerHTML = ic(S.settings.dark ? 'sun' : 'moon');
  $('#btn-theme').onclick = () => { S.settings.dark = !S.settings.dark; document.documentElement.classList.toggle('dark', S.settings.dark); saveSettings(); $('#btn-theme').innerHTML = ic(S.settings.dark ? 'sun' : 'moon'); };
  $('#btn-settings').innerHTML = ic('settings'); $('#btn-settings').onclick = () => settingsDialog().then(() => { if (!D()) renderHome(); });
  $('#sb-prev').innerHTML = ic('chevron-up'); $('#sb-next').innerHTML = ic('chevron-down');
  $('#sb-prev').onclick = () => goToPage((D()?.cur || 0) - 1); $('#sb-next').onclick = () => goToPage((D()?.cur || 0) + 1);
  $('#sb-page').onchange = () => goToPage((parseInt($('#sb-page').value) || 1) - 1);
  $('#sb-fitw').innerHTML = ic('move-horizontal'); $('#sb-fitw').onclick = () => setZoom('fitw');
  $('#sb-fitp').innerHTML = ic('maximize'); $('#sb-fitp').onclick = () => setZoom('fitp');
  $('#sb-zin').innerHTML = ic('zoom-in'); $('#sb-zin').onclick = () => setZoom('in');
  $('#sb-zout').innerHTML = ic('zoom-out'); $('#sb-zout').onclick = () => setZoom('out');
  $('#sb-zoom').onchange = () => { const v = $('#sb-zoom').value; if (v !== 'custom') setZoom(v); };
  window.addEventListener('beforeunload', e => { if (S.docs.some(d => d.dirty)) { e.preventDefault(); e.returnValue = ''; } });
}
function initPwa() {
  if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
  if ('launchQueue' in window) launchQueue.setConsumer(async p => { for (const h of p.files || []) await openHandle(h).catch(e => toast(e.message, 'err')); });
}
(async function boot() {
  if (handleAuthCallback()) return;
  if (S.settings.dark) document.documentElement.classList.add('dark');
  initChrome(); initViewerEvents(); initKeys(); initDnD();
  renderTabs(); renderRibbon(); renderViewer(); renderSide(); renderProps(); updateCloudStatus(); setTool('select');
  try { await initMetricFonts(); } catch (e) { console.warn('fonts', e); }
  try { await initFonts(); } catch (e) { console.warn('system fonts', e); }
  renderProps();
  if (NATIVE) { document.body.classList.add('native'); if (S.settings.autoUpdate !== false) setTimeout(() => nativeCheckUpdates(false), 6000); }
  else initPwa();
})();
