/* ============================================================
   09 · Cinta de opciones, pantalla de inicio, atajos y arranque
   ============================================================ */
const T = t => ({ tool: t, icon: { select: 'mouse-pointer-2', hand: 'hand', highlight: 'highlighter', underline: 'underline', strike: 'strikethrough', note: 'message-square-plus', text: 'type', ink: 'pencil', rect: 'square', ellipse: 'circle', line: 'minus', arrow: 'move-up-right', stamp: 'stamp', eraser: 'eraser', edittext: 'text-cursor-input', whiteout: 'square-dashed', redact: 'eye-off', 'field-text': 'text-cursor', 'field-check': 'square-check', 'field-drop': 'list', 'field-sig': 'pen-line' }[t], label: TOOL_NAMES[t] });
const RIBBON = [
  { id: 'home', label: 'Inicio', groups: [
    [{ icon: 'scan-line', label: 'Escanear', act: () => scanDocument(), nodoc: true, android: true }, { icon: 'folder-open', label: 'Abrir', act: openLocal, nodoc: true }, { icon: 'cloud', label: 'OneDrive', act: () => openFromCloud('onedrive'), nodoc: true, android: false }, { icon: 'cloud', label: 'Google Drive', act: () => openFromCloud('gdrive'), nodoc: true, android: false }],
    [{ icon: 'save', label: 'Guardar', act: () => saveDoc() }, { icon: 'save-all', label: 'Guardar como', act: () => saveDoc(D(), true) }, { icon: 'share-2', label: 'Compartir', act: () => shareDoc(), touch: true }, { icon: 'printer', label: 'Imprimir', act: printDoc }],
    [{ icon: 'combine', label: 'Combinar', act: () => combineDialog(false), nodoc: true }, { icon: 'folder-archive', label: 'Expediente', act: dossierDialog, nodoc: true }, { icon: 'images', label: 'Desde imágenes', act: () => combineDialog(true), nodoc: true }, { icon: 'file-plus', label: 'En blanco', act: newBlankDialog, nodoc: true }],
    [{ icon: 'undo-2', label: 'Deshacer', act: undo }, { icon: 'redo-2', label: 'Rehacer', act: redo }],
    [T('select'), T('hand')],
    [{ icon: 'workflow', label: 'Automatizaciones', act: automationsMenu, nodoc: true }, { icon: 'git-compare', label: 'Comparar', act: compareDialog, nodoc: true }],
    [{ icon: 'info', label: 'Propiedades', act: propertiesDialog }]] },
  { id: 'comment', label: 'Comentar', groups: [
    [T('select'), T('hand')], [T('highlight'), T('underline'), T('strike')], [T('note'), T('text'), T('stamp')],
    [T('ink'), T('rect'), T('ellipse'), T('line'), T('arrow')],
    [T('eraser'), { icon: 'eye', label: 'Mostrar / ocultar', act: () => document.body.classList.toggle('hide-ann') }],
    [{ icon: 'notebook-pen', label: 'Resumen', title: 'Resumen de resaltados y notas (Word o Markdown)', act: studySummaryDialog }]] },
  { id: 'edit', label: 'Editar', groups: [
    [T('edittext'), { ...T('text'), label: 'Agregar texto' }, { icon: 'image-plus', label: 'Imagen', act: insertImage }, { icon: 'qr-code', label: 'Código QR / barras', act: insertCodeDialog }, T('whiteout')],
    [{ icon: 'droplets', label: 'Marca de agua', act: watermarkDialog }, { icon: 'paint-bucket', label: 'Fondo', act: backgroundDialog }, { icon: 'panel-top', label: 'Encabezado y pie', act: headerFooterDialog }, { icon: 'list-ordered', label: 'Números de página', act: pageNumbersDialog }, { icon: 'hash', label: 'Bates', act: batesDialog }],
    [{ icon: 'crop', label: 'Recortar', act: cropDialog }]] },
  { id: 'pages', label: 'Organizar', groups: [
    [{ icon: 'layout-grid', label: 'Vista de páginas', act: () => setViewMode(D().view === 'organize' ? 'pages' : 'organize'), on: () => D()?.view === 'organize' }],
    [{ icon: 'file-plus-2', label: 'Insertar en blanco', act: insertBlankDialog }, { icon: 'file-input', label: 'Insertar archivo', act: insertFromFileDialog }, { icon: 'scan-line', label: 'Escanear páginas', act: () => scanDocument(D()), android: true }],
    [{ icon: 'rotate-ccw', label: 'Girar izquierda', act: () => rotatePages(targetPages(), -1) }, { icon: 'rotate-cw', label: 'Girar derecha', act: () => rotatePages(targetPages(), 1) }, { icon: 'copy', label: 'Duplicar', act: () => duplicatePages(targetPages()) }, { icon: 'trash-2', label: 'Eliminar', act: () => deletePages(targetPages()) }],
    [{ icon: 'file-output', label: 'Extraer', act: extractDialog }, { icon: 'scissors', label: 'Dividir', act: splitDialog }, { icon: 'arrow-down-up', label: 'Invertir orden', act: reversePages }],
    [{ icon: 'folder-archive', label: 'Armar expediente', act: dossierDialog, nodoc: true }, { icon: 'git-compare', label: 'Comparar versiones', act: compareDialog, nodoc: true }],
    [{ icon: 'crop', label: 'Recortar', act: cropDialog }]] },
  { id: 'convert', label: 'Convertir', groups: [
    [{ icon: 'file-text', label: 'A Word', act: () => convertDialog('word') }, { icon: 'sheet', label: 'A Excel', act: () => convertDialog('excel') }, { icon: 'file-image', label: 'A imágenes', act: () => convertDialog('image') }, { icon: 'file-type', label: 'A texto', act: () => convertDialog('text') }],
    [{ icon: 'scan-text', label: 'OCR', act: ocrDialog }, { icon: 'file-type-2', label: 'Desde Office', act: officeFromDisk, nodoc: true, native: true }],
    [{ icon: 'layers', label: 'Por lotes', act: () => batchDialog(), nodoc: true }, { icon: 'workflow', label: 'Automatizaciones', act: automationsMenu, nodoc: true }], [{ icon: 'file-archive', label: 'Comprimir', act: compressDialog }, { icon: 'file-down', label: 'Ajustar a tamaño', act: fitSizeDialog }, { icon: 'archive', label: 'PDF/A', title: 'Guardar como PDF/A (archivo a largo plazo)', act: pdfaDialog }],
    [{ icon: 'combine', label: 'Combinar', act: () => combineDialog(false), nodoc: true }, { icon: 'images', label: 'Desde imágenes', act: () => combineDialog(true), nodoc: true }]] },
  { id: 'form', label: 'Formulario', groups: [
    [T('field-text'), T('field-check'), T('field-drop'), T('field-sig')], [T('select')],
    [{ icon: 'table', label: 'Exportar datos (CSV)', act: exportFormCsv }, { icon: 'rotate-ccw', label: 'Restablecer', act: resetForm }, { icon: 'highlighter', label: 'Resaltar campos', act: toggleFieldHighlight }]] },
  { id: 'protect', label: 'Proteger', groups: [
    [{ icon: 'lock', label: 'Contraseña', act: protectDialog }, { icon: 'lock-open', label: 'Quitar seguridad', act: removeSecurity }],
    [{ icon: 'shield-check', label: 'Firma digital', act: digitalSignDialog }, { icon: 'signature', label: 'Firma manuscrita', act: signatureDialog }, { icon: 'file-badge', label: 'Ver firmas', act: () => { S.side = 'signatures'; S.sideOpen = true; renderSide(); } }, { icon: 'sliders-horizontal', label: 'Preferencias de firma', act: () => signPrefsDialog(), nodoc: true }],
    [{ ...T('field-sig'), label: 'Pedir firma' }, { icon: 'send', label: 'Enviar para firmar', act: shareForSigningDialog }],
    [T('redact'), { icon: 'search', label: 'Buscar y redactar', act: () => { S.side = 'search'; S.sideOpen = true; renderSide(); } }, { icon: 'shield-x', label: 'Quitar información oculta', act: sanitizeDialog }]] }
];
function renderRibbon() {
  const tabs = $('#ribbon-tabs'); tabs.innerHTML = '';
  for (const t of RIBBON) tabs.append(el('button', { class: 'rtab' + (S.ribbonTab === t.id ? ' active' : ''), text: t.label, onclick: () => { S.ribbonTab = t.id; renderRibbon(); } }));
  const rb = $('#ribbon'); rb.innerHTML = '';
  const tab = RIBBON.find(t => t.id === S.ribbonTab) || RIBBON[0];
  for (const g of tab.groups) {
    const ge = el('div', { class: 'rgroup' });
    for (const b of g) {
      if (b.android === true && !CAP) continue;
      if (b.android === false && CAP) continue;
      if (b.native === true && !NATIVE) continue;
      if (b.touch && !CAP && !isTouch()) continue;
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
    el('h1', { text: 'Rúbrica' }),
    el('p', { class: 'sub', text: 'Editor PDF local: lectura, comentarios, edición, páginas, formularios, firmas, protección, conversión y OCR — con OneDrive y Google Drive.' }),
    el('div', { class: 'home-cards' },
      CAP ? card('scan-line', 'Escanear documento', 'Cámara con detección de bordes y OCR', () => scanDocument()) : null,
      CAP ? card('folder-open', 'Abrir PDF', 'Teléfono, Google Drive, OneDrive…', openLocal) : null,
      CAP ? null : card('folder-open', 'Abrir archivo', 'PDF o imagen de este equipo', openLocal),
      CAP ? null : card('cloud', 'Abrir de OneDrive', CLOUD.onedrive.label2(), () => openFromCloud('onedrive')),
      CAP ? null : card('cloud', 'Abrir de Google Drive', CLOUD.gdrive.label2(), () => openFromCloud('gdrive')),
      card('combine', 'Combinar archivos', 'Unir varios PDF e imágenes', () => combineDialog(false)),
      card('folder-archive', 'Armar expediente', 'Portada, índice, marcadores y Bates', dossierDialog),
      NATIVE ? card('file-type-2', 'Desde Word, Excel o PowerPoint', 'Convertir documentos de Office a PDF', officeFromDisk) : null,
      card('images', 'PDF desde imágenes', 'Fotos o escaneos a un PDF', () => combineDialog(true)),
      card('file-plus', 'Documento en blanco', 'Carta, A4, Oficio…', newBlankDialog)),
    CAP ? null : el('div', { class: 'home-drop', html: ic('upload') + '<br>' + escapeHtml(tr(NATIVE ? 'Arrastre aquí archivos PDF, imágenes o documentos de Office para abrirlos' : 'Arrastre aquí archivos PDF o imágenes para abrirlos')) }));
  const rec = store.get('recent', []).filter(r => NATIVE || r.kind !== 'native');
  if (rec.length) {
    const list = el('div', { class: 'recent-list' });
    for (const r of rec) list.append(el('div', { class: 'recent-row', onclick: () => openRecent(r) }, icEl(r.kind === 'local' || r.kind === 'native' ? 'hard-drive' : 'cloud'), el('span', { class: 'nm', text: r.name }),
      el('span', { class: 'badge', text: r.kind === 'local' || r.kind === 'native' ? 'Este equipo' : r.kind === 'onedrive' ? 'OneDrive' : 'Google Drive' }), el('span', { class: 'src', text: fmtDate(r.t) }),
      el('button', { class: 'icon-btn sm', html: ic('x'), title: 'Quitar de la lista', onclick: e => { e.stopPropagation(); store.set('recent', store.get('recent', []).filter(x => x.key !== r.key)); renderHome(); } })));
    inner.append(el('div', { class: 'recent' }, el('h3', { text: 'Recientes' }), list));
  }
  if (!CAP && !CLOUD.onedrive.configured() && !CLOUD.gdrive.configured()) inner.append(el('p', { class: 'hint', style: { marginTop: '22px' }, html: `Para abrir y guardar en la nube, configure OneDrive o Google Drive una sola vez en <a href="#" id="home-cfg">⚙ Configuración</a>.` }));
  box.append(inner);
  const cfg = $('#home-cfg'); if (cfg) cfg.onclick = e => { e.preventDefault(); settingsDialog().then(renderHome); };
}

/* ---------- Atajos de teclado ----------
   Los de un editor PDF de escritorio (PDFelement / Acrobat). En la app de Windows también se
   bloquean F5 y Ctrl+R del navegador interno, que recargarían la página y perderían el trabajo. */
const SHORTCUTS = [
  ['Archivo', [['Ctrl+N', 'Nuevo documento en blanco'], ['Ctrl+O', 'Abrir'], ['Ctrl+S', 'Guardar'], ['Ctrl+Mayús+S', 'Guardar como'], ['Ctrl+P', 'Imprimir'], ['Ctrl+W · Ctrl+F4', 'Cerrar el documento'], ['Ctrl+Tab · Ctrl+Mayús+Tab', 'Documento siguiente / anterior'], ['Ctrl+D', 'Propiedades del documento (o duplicar el objeto seleccionado)']]],
  ['Edición', [['Ctrl+Z', 'Deshacer'], ['Ctrl+Y · Ctrl+Mayús+Z', 'Rehacer'], ['Ctrl+C · Ctrl+X · Ctrl+V', 'Copiar, cortar y pegar el objeto seleccionado'], ['Ctrl+A', 'Seleccionar todo el texto de la página (o todas las páginas en Organizar)'], ['Supr', 'Eliminar la selección (o las páginas en Organizar)'], ['Ctrl+E', 'Editar texto e imágenes'], ['Flechas · Mayús+Flechas', 'Mover el objeto 1 / 10 puntos'], ['Esc', 'Quitar la selección / volver a Seleccionar']]],
  ['Buscar', [['Ctrl+F', 'Buscar'], ['F3 · Mayús+F3', 'Resultado siguiente / anterior']]],
  ['Vista', [['Ctrl++ · Ctrl+-', 'Acercar / alejar'], ['Ctrl+0', 'Ajustar a la página'], ['Ctrl+1', 'Tamaño real (100 %)'], ['Ctrl+2', 'Ajustar al ancho'], ['Ctrl+R · Ctrl+Mayús+R', 'Girar la página a la derecha / izquierda'], ['Ctrl+G', 'Ir a la página…'], ['Inicio · Fin', 'Primera / última página'], ['RePág · AvPág', 'Página anterior / siguiente'], ['F4', 'Mostrar u ocultar el panel lateral'], ['Ctrl+L · F11', 'Pantalla completa']]],
  ['Herramientas', [['V', 'Seleccionar'], ['H', 'Mano'], ['T', 'Texto'], ['N', 'Nota'], ['P', 'Lápiz'], ['R', 'Rectángulo']]],
  ['Ayuda', [['F1 · Ctrl+/', 'Esta lista de atajos']]]
];
function shortcutsDialog() {
  const box = el('div', { class: 'kbd-list' });
  for (const [g, items] of SHORTCUTS) { box.append(el('h5', { text: g })); for (const [k, l] of items) box.append(el('div', {}, el('span', { text: l }), el('span', {}, ...k.split(' · ').flatMap((x, i) => [i ? ' ' : null, el('kbd', { text: x })]).filter(Boolean)))); }
  return openModal({ title: 'Atajos de teclado', body: box, wide: true, buttons: [{ label: 'Cerrar', primary: true, value: true }] }).result;
}
function selectPageText(d) {
  const p = d.pages[d.cur], parts = p && R.els.get(p.id), tl = parts && parts.pe.querySelector('.textLayer');
  if (!tl || !tl.textContent.trim()) { toast('Esta página no tiene texto seleccionable (use OCR si es escaneada).', '', 4000); return; }
  const sel = window.getSelection(); sel.removeAllRanges(); sel.selectAllChildren(tl);
}
function copySel(cut) {
  const d = D(), o = selObj(); if (!o) return false;
  S.clip = { obj: structuredClone(o), pid: S.sel.pid, n: 0 };
  if (cut) deleteObj(S.sel.pid, S.sel.oid);
  toast(cut ? 'Objeto cortado.' : 'Objeto copiado.', '', 1500); return true;
}
function pasteClip() {
  const d = D(); if (!d || !S.clip) return false;
  const p = d.pages[d.cur]; if (!p) return false;
  d.checkpoint();
  const c = structuredClone(S.clip.obj); c.id = uid();
  if (S.clip.pid === p.id) { S.clip.n++; c.x += 12 * S.clip.n; c.y += 12 * S.clip.n; }
  if (c.type === 'field') c.name = uniqueFieldName(d, c.name);
  p.ov.push(c); selectObj(p.id, c.id); return true;
}
function switchDoc(step) {
  if (S.docs.length < 2) return;
  const i = S.docs.indexOf(S.active); activateDoc(S.docs[(i + step + S.docs.length) % S.docs.length]);
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
  else document.documentElement.requestFullscreen().catch(() => toast('Pantalla completa no disponible.', 'err'));
}
function initKeys() {
  document.addEventListener('keydown', e => {
    if ($('#modal-root').children.length) return;
    const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey, shift = e.shiftKey;
    const inField = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable;
    const d = D(), stop = () => { e.preventDefault(); e.stopPropagation(); };
    // recarga del navegador interno: haría perder el trabajo
    if (NATIVE && (e.key === 'F5' || (ctrl && k === 'r' && !d))) { stop(); return; }
    if (e.key === 'F1' || (ctrl && (k === '/' || e.code === 'Slash'))) { stop(); shortcutsDialog(); return; }
    if (ctrl && !shift && k === 'o') { stop(); openLocal(); return; }
    if (ctrl && !shift && k === 'n') { stop(); newBlankDialog(); return; }
    if (ctrl && k === 's') { stop(); if (d) saveDoc(d, shift); return; }
    if (ctrl && k === 'p') { stop(); if (d) printDoc(); return; }
    if (ctrl && k === 'f') { stop(); if (d) { S.side = 'search'; S.sideOpen = true; renderSide(); } return; }
    if (ctrl && (k === 'w' || e.key === 'F4')) { stop(); if (d) closeDoc(d); return; }
    if (ctrl && e.key === 'Tab') { stop(); switchDoc(shift ? -1 : 1); return; }
    if (ctrl && (e.key === 'PageDown' || e.key === 'PageUp')) { stop(); switchDoc(e.key === 'PageDown' ? 1 : -1); return; }
    if (ctrl && (k === '=' || k === '+' || e.code === 'NumpadAdd')) { stop(); setZoom('in'); return; }
    if (ctrl && (k === '-' || e.code === 'NumpadSubtract')) { stop(); setZoom('out'); return; }
    if (ctrl && !shift && k === '0') { stop(); setZoom('fitp'); return; }
    if (ctrl && !shift && k === '1') { stop(); setZoom(100); return; }
    if (ctrl && !shift && k === '2') { stop(); setZoom('fitw'); return; }
    if ((ctrl && k === 'l') || e.key === 'F11') { stop(); toggleFullscreen(); return; }
    if (e.key === 'F3') { stop(); if (d && SR.hits.length) goToHit(SR.cur + (shift ? -1 : 1)); else if (d) { S.side = 'search'; S.sideOpen = true; renderSide(); } return; }
    if (e.key === 'F4' && !ctrl) { stop(); if (d) { S.sideOpen = !S.sideOpen; renderSide(); renderViewer(true); } return; }
    if (inField) { if (e.key === 'Escape' && S.editing) { e.target.blur(); commitEditing(); } return; }
    if (!d) return;
    if (ctrl && k === 'z') { stop(); shift ? redo() : undo(); return; }
    if (ctrl && k === 'y') { stop(); redo(); return; }
    if (ctrl && k === 'd') { stop(); if (S.sel) duplicateSel(); else propertiesDialog(); return; }
    if (ctrl && k === 'e') { stop(); setTool(S.tool === 'edittext' ? 'select' : 'edittext'); return; }
    if (ctrl && k === 'r') { stop(); const p = d.pages[d.cur]; if (d.view === 'organize' ? targetPages().length : p) rotatePages(d.view === 'organize' ? targetPages() : [p], shift ? -1 : 1); return; }
    if (ctrl && k === 'g') { stop(); const i = $('#sb-page'); if (i) { i.focus(); i.select(); } return; }
    if (ctrl && k === 'a') {
      stop();
      if (d.view === 'organize') { d.orgSel = new Set(d.pages.map(p => p.id)); renderOrganizer(); }
      else selectPageText(d);
      return;
    }
    const textSelected = () => { const s = window.getSelection(); return s && !s.isCollapsed && String(s).trim(); };
    if (ctrl && (k === 'c' || k === 'x') && S.sel && !textSelected()) { stop(); copySel(k === 'x'); return; }
    if (ctrl && k === 'v' && S.clip) { stop(); pasteClip(); return; }
    if (e.key === 'Escape') { if (S.sel) clearSel(); else if (S.tool !== 'select') setTool('select'); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel) { stop(); deleteObj(S.sel.pid, S.sel.oid); return; }
    if (e.key === 'Delete' && d.view === 'organize' && d.orgSel.size) { stop(); deletePages(targetPages()); return; }
    if (S.sel && e.key.startsWith('Arrow')) {
      e.preventDefault(); const o = selObj(); const st = shift ? 10 : 1; if (!S.propCk) { d.checkpoint(); S.propCk = true; }
      if (e.key === 'ArrowLeft') o.x -= st; if (e.key === 'ArrowRight') o.x += st; if (e.key === 'ArrowUp') o.y -= st; if (e.key === 'ArrowDown') o.y += st;
      renderOverlays(d.page(S.sel.pid)); return;
    }
    if (e.key === 'PageDown') { e.preventDefault(); goToPage(d.cur + 1); return; }
    if (e.key === 'PageUp') { e.preventDefault(); goToPage(d.cur - 1); return; }
    if (e.key === 'Home') { e.preventDefault(); goToPage(0); return; }
    if (e.key === 'End') { e.preventDefault(); goToPage(d.pages.length - 1); return; }
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
  $('#sb-style').onclick = () => { S.toolSheet = !S.toolSheet; renderProps(); };
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
  applyLang(S.settings.lang || 'auto');
  initChrome(); initViewerEvents(); initKeys(); initDnD();
  try { await initMobile(); } catch (e) { console.warn('móvil', e); }
  renderTabs(); renderRibbon(); renderViewer(); renderSide(); renderProps(); updateCloudStatus(); setTool('select');
  try { await initMetricFonts(); } catch (e) { console.warn('fonts', e); }
  try { await initFonts(); } catch (e) { console.warn('system fonts', e); }
  renderProps();
  if (CAP) { /* Android: sin service worker ni actualizaciones web */ }
  else if (NATIVE) { document.body.classList.add('native'); if (S.settings.autoUpdate !== false) setTimeout(() => nativeCheckUpdates(false), 6000); }
  else initPwa();
})();
