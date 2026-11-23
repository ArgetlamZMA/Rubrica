/* ============================================================
   13 · Android (Capacitor) e interfaz táctil
   - Abrir/guardar con el selector de Android (incluye Drive y OneDrive)
   - Escáner de documentos y OCR de ML Kit (sin conexión)
   - Compartir, imprimir, «Abrir con», botón Atrás
   - Diseño para teléfono, pellizcar para hacer zoom
   ============================================================ */
const CAP = (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) ? window.Capacitor : null;
const PSN = CAP ? (typeof CAP.registerPlugin === 'function' ? CAP.registerPlugin('Rubrica') : CAP.Plugins.Rubrica) : null;
const b64ToU8 = s => binToU8(atob(s));
const u8ToB64 = u8 => btoa(u8ToBin(u8));
const isPhone = () => window.matchMedia('(max-width: 760px)').matches;
const isTouch = () => window.matchMedia('(pointer: coarse)').matches;

/* ---------- Archivos ---------- */
async function androidOpen(imagesOnly) {
  const r = await PSN.openDocument({ multiple: true, imagesOnly: !!imagesOnly });
  return (r.files || []).map(f => ({ name: f.name, bytes: b64ToU8(f.data), mime: f.mime, uri: f.uri }));
}
async function androidOpenDocs() {
  for (const f of await androidOpen()) await openBytes(f.name, f.bytes, { mime: f.mime, androidUri: isPdfName(f.name) || f.mime === 'application/pdf' ? f.uri : null }).catch(e => toast(e.message, 'err'));
}
async function saveToAndroid(doc, uri, preset) {
  try {
    const bytes = preset || await withBusy('Guardando…', upd => buildPdf(doc, { progress: upd }));
    await withBusy('Escribiendo archivo…', () => PSN.write({ uri, data: u8ToB64(bytes) }));
    doc.androidUri = uri; if (!preset) doc.setDirty(false); addRecent(doc); renderTabs(); updateStatus();
    toast('Guardado: ' + doc.name, 'ok'); return true;
  } catch (e) { toast(e.message || String(e), 'err', 6000); return false; }
}
async function androidSaveAs(doc, preset, name) {
  try {
    const bytes = preset || await withBusy('Generando PDF…', upd => buildPdf(doc, { progress: upd }));
    let n = name || doc.name; if (!isPdfName(n)) n += '.pdf';
    const r = await PSN.saveAs({ name: n, data: u8ToB64(bytes), mime: 'application/pdf' });
    if (!r || !r.uri) return false;
    doc.androidUri = r.uri; doc.name = r.name || n; doc.cloud = null; doc.handle = null; doc.nativePath = null;
    if (!preset) doc.setDirty(false); addRecent(doc); renderTabs(); updateStatus();
    toast('Guardado: ' + doc.name, 'ok'); return true;
  } catch (e) { toast('No se pudo guardar: ' + (e.message || e), 'err', 6000); return false; }
}
async function shareDoc(doc = D()) {
  if (!doc) return;
  try {
    const bytes = await withBusy('Preparando…', upd => buildPdf(doc, { progress: upd }));
    let n = doc.name; if (!isPdfName(n)) n += '.pdf';
    if (PSN) await PSN.share({ name: n, data: u8ToB64(bytes), mime: 'application/pdf' });
    else if (navigator.canShare && navigator.canShare({ files: [new File([bytes], n, { type: 'application/pdf' })] })) await navigator.share({ files: [new File([bytes], n, { type: 'application/pdf' })], title: n });
    else download(pdfBlob(bytes), n);
  } catch (e) { if (!/abort|cancel/i.test(e.message || '')) toast('No se pudo compartir: ' + (e.message || e), 'err'); }
}
/** En Android no hay «descargas» del navegador: se guarda con el selector del sistema */
async function androidSaveBlob(blob, name) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  try { const r = await PSN.saveAs({ name, data: u8ToB64(bytes), mime: blob.type || 'application/octet-stream' }); if (r && r.uri) toast('Guardado: ' + (r.name || name), 'ok'); }
  catch (e) { toast('No se pudo guardar: ' + (e.message || e), 'err'); }
}

/* ---------- Escáner ---------- */
async function scanDocument(appendTo) {
  if (!PSN) { toast('El escáner está disponible en la app de Android. Aquí puede usar «PDF desde imágenes».'); return combineDialog(true); }
  let r;
  try { r = await PSN.scan({ pageLimit: 60, gallery: true }); }
  catch (e) { toast(e.message || String(e), 'err', 7000); return; }
  const pages = r.pages || []; if (!pages.length) return;
  const size = S.settings.scanPageSize || 'letter', ocr = S.settings.scanOcr !== false;
  try {
    await withBusy('Creando PDF…', async upd => {
      const now = new Date(), p2 = n => String(n).padStart(2, '0');
      const doc = appendTo || new Doc(`Escaneo ${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}${p2(now.getMinutes())}.pdf`);
      const snap = appendTo ? doc.snap() : null;
      const added = [];
      for (let k = 0; k < pages.length; k++) {
        upd(`Página ${k + 1} de ${pages.length}…`, k / pages.length * 100);
        const bytes = b64ToU8(pages[k].data);
        const [pg] = await addFileToDoc(doc, bytes, `pagina${k + 1}.jpg`, 'image/jpeg', size);
        if (ocr) {
          upd(`Reconociendo texto, página ${k + 1}…`);
          try { addOcrWords(pg, await PSN.ocr({ data: pages[k].data })); } catch (e) { console.warn('OCR', e); }
        }
        added.push(pg);
      }
      if (appendTo) { doc.undo.push(snap); doc.redo = []; doc.pages.splice(doc.cur + 1, 0, ...added); doc.setDirty(true); afterStructureChange(); }
      else { doc.pages = added; doc.dirty = true; addDoc(doc); }
    });
    toast(`${pages.length} página(s) escaneada(s)${ocr ? ' con texto reconocido' : ''}. Guarde o comparta el PDF.`, 'ok', 5000);
  } catch (e) { toast(e.message || String(e), 'err'); }
}
/** Convierte palabras reconocidas (píxeles de la imagen) en la capa de texto invisible de la página */
function addOcrWords(p, res) {
  if (!res || !res.words) return 0;
  const r = p.img || { x: 0, y: 0, w: p.w, h: p.h }, kx = r.w / res.width, ky = r.h / res.height;
  p.ov = p.ov.filter(o => o.type !== 'ocrword');
  for (const w of res.words) if (w.t && w.t.trim()) p.ov.unshift({ id: uid(), type: 'ocrword', t: w.t, x: r.x + w.x * kx, y: r.y + w.y * ky, w: w.w * kx, h: w.h * ky });
  return res.words.length;
}
/** OCR nativo de páginas ya abiertas (renderiza la página y la envía a ML Kit) */
async function ocrNative(d, idx) {
  let text = '';
  await withBusy('Reconociendo texto…', async upd => {
    const snap = d.snap();
    for (let k = 0; k < idx.length; k++) {
      upd(`Página ${idx[k] + 1} (${k + 1} de ${idx.length})…`, k / idx.length * 100);
      const p = d.pages[idx[k]], cv = el('canvas'); await drawPage(d, p, 2.8, cv, 1);
      const data = cv.toDataURL('image/jpeg', 0.9).split(',')[1]; cv.width = 0;
      const res = await PSN.ocr({ data });
      // la imagen corresponde a la página en pantalla (sin rotación adicional ni recorte)
      const [W, H] = dims(p); p.ov = p.ov.filter(o => o.type !== 'ocrword');
      for (const w of res.words || []) if (w.t && w.t.trim()) p.ov.unshift({ id: uid(), type: 'ocrword', t: w.t, x: w.x * W / res.width, y: w.y * H / res.height, w: w.w * W / res.width, h: w.h * H / res.height });
      text += (text ? '\n\n' : '') + `--- Página ${idx[k] + 1} ---\n` + (res.text || '');
    }
    d.undo.push(snap); d.redo = []; d.setDirty(true);
  });
  return text;
}

/* ---------- Botón Atrás de Android ---------- */
window.pdfsBack = () => {
  const modals = $$('#modal-root .modal-bg');
  if (modals.length) { const x = modals[modals.length - 1].querySelector('.modal-h .icon-btn'); if (x) x.click(); return true; }
  if (S.editing) { commitEditing(); return true; }
  if (S.sel) { clearSel(); return true; }
  if (S.tool !== 'select') { setTool('select'); return true; }
  if (isPhone() && S.sideOpen && D()) { S.sideOpen = false; renderSide(); return true; }
  const d = D();
  if (d && d.view === 'organize') { setViewMode('pages'); return true; }
  if (d) { activateDoc(null); return true; }
  return false;
};

/* ---------- Pellizcar para hacer zoom ---------- */
function initPinchZoom() {
  const v = viewerEl(); let st = null;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  v.addEventListener('touchstart', e => {
    const d = D(); if (!d || e.touches.length !== 2) return;
    const r = v.getBoundingClientRect();
    const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
    st = { d0: dist(e.touches), k: 1, mx, my, fx: (v.scrollLeft + mx) / v.scrollWidth, fy: (v.scrollTop + my) / v.scrollHeight, scale0: d.scale };
    const pe = pagesEl(); pe.style.transformOrigin = `${v.scrollLeft + mx}px ${v.scrollTop + my}px`;
  }, { passive: true });
  v.addEventListener('touchmove', e => {
    if (!st || e.touches.length !== 2) return;
    e.preventDefault();
    st.k = clamp(dist(e.touches) / st.d0, 0.3, 4);
    pagesEl().style.transform = `scale(${st.k})`;
  }, { passive: false });
  const end = () => {
    if (!st) return; const s = st; st = null;
    pagesEl().style.transform = ''; pagesEl().style.transformOrigin = '';
    if (Math.abs(s.k - 1) < 0.04) return;
    const d = D(); d.zoom = clamp(Math.round(s.scale0 * s.k / PX_PER_PT * 100), 25, 800);
    renderViewer(false);
    v.scrollLeft = s.fx * v.scrollWidth - s.mx; v.scrollTop = s.fy * v.scrollHeight - s.my;
  };
  v.addEventListener('touchend', e => { if (e.touches.length < 2) end(); });
  v.addEventListener('touchcancel', end);
}

/* ---------- Arranque en Android / pantallas táctiles ---------- */
async function initMobile() {
  if (isTouch()) document.body.classList.add('touch');
  if (CAP) document.body.classList.add('android');
  if (isPhone()) S.sideOpen = false;
  initPinchZoom();
  window.matchMedia('(max-width: 760px)').addEventListener('change', () => { renderSide(); renderProps(); });
  if (!PSN) return;
  const openList = async files => { for (const f of files || []) await openBytes(f.name, b64ToU8(f.data), { mime: f.mime, androidUri: f.mime === 'application/pdf' || isPdfName(f.name) ? f.uri : null }).catch(e => toast(e.message, 'err')); };
  try { PSN.addListener('filesReceived', ev => openList(ev.files)); } catch (e) { console.warn(e); }
  try { const r = await PSN.getLaunchFiles(); await openList(r.files); } catch (e) { console.warn(e); }
}
