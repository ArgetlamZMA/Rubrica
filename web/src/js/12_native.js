/* ============================================================
   12 · Puente con la aplicación nativa de Windows (Rubrica.exe)
   El host C# sirve la interfaz en http://localhost:<puerto>/ y expone
   /__native/* protegido con un token de sesión que solo esta página
   recibe (inyectado por WebView2). En el navegador NATIVE es null y
   todo funciona con las API web.
   ============================================================ */
const NATIVE = window.__PDFS_NATIVE || null;
async function nat(path, opt = {}) {
  const r = await fetch('/__native/' + path, { ...opt, headers: { 'X-PDFS-Token': NATIVE.token, ...(opt.headers || {}) } });
  if (!r.ok) { let m = 'HTTP ' + r.status; try { m = (await r.text()) || m; } catch { } throw new Error(m); }
  return r;
}
async function natJson(path, opt) { return (await nat(path, opt)).json(); }
async function natBytes(path, opt) { return new Uint8Array(await (await nat(path, opt)).arrayBuffer()); }
const natPost = (path, obj) => natJson(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj || {}) });

async function nativeOpenFiles() {
  const r = await natPost('open-dialog', { multiple: true, filter: 'pdf' });
  for (const f of r.files || []) await openNativePath(f.path).catch(e => toast(e.message, 'err'));
}
async function openNativePath(path) {
  const name = path.split(/[\\/]/).pop();
  const bytes = await natBytes('read?path=' + encodeURIComponent(path));
  const doc = await openBytes(name, bytes, { nativePath: isPdfName(name) ? path : null });
  return doc;
}
async function nativeSaveAs(doc, suggested) {
  const r = await natPost('save-dialog', { name: suggested, dir: doc.nativePath ? doc.nativePath.replace(/[\\/][^\\/]*$/, '') : '' });
  return r.path || null;
}
async function nativeWrite(path, bytes) {
  await nat('write?path=' + encodeURIComponent(path), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
}
/* llamado por el host al abrir archivos desde el Explorador o una segunda instancia */
window.pdfsNativeOpen = async paths => { for (const p of paths || []) await openNativePath(p).catch(e => toast(e.message, 'err')); };

async function nativeCheckUpdates(manual) {
  if (!NATIVE) return;
  try {
    const u = await natJson('update-check');
    if (!u.available) { if (manual) toast(`Tiene la última versión (${NATIVE.version}).`, 'ok'); return; }
    const notes = escapeHtml(u.notes || '').slice(0, 1500).replace(/\n/g, '<br>');
    const ok = await confirmDialog('Actualización disponible', `Hay una nueva versión <b>${escapeHtml(u.version)}</b> (tiene ${escapeHtml(NATIVE.version)}).<br><br><div class="hint" style="max-height:200px;overflow:auto">${notes}</div><br>Se descargará el instalador desde GitHub y la aplicación se cerrará para actualizarse.`, 'Actualizar ahora');
    if (!ok) return;
    if (S.docs.some(d => d.dirty) && !(await confirmDialog('Cambios sin guardar', 'Hay documentos con cambios sin guardar. ¿Actualizar de todas formas?', 'Actualizar', true))) return;
    await withBusy('Descargando actualización…', () => natPost('update-install', { url: u.url }));
  } catch (e) { if (manual) toast('No se pudo comprobar actualizaciones: ' + e.message, 'err'); }
}
