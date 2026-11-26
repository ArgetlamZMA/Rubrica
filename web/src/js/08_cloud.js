/* ============================================================
   08 · Nube: OneDrive (Microsoft Graph) y Google Drive (API v3)
   Autenticación OAuth 2.0 en ventana emergente, sin servidores
   intermedios: los archivos van directo entre este equipo y su nube.
   ============================================================ */
const AUTH_CH = 'pdfstudio-auth';
const APP_PORT = 8765;
const redirectUri = () => location.origin + '/';
/** Si esta ventana es la emergente de inicio de sesión, entrega el resultado y se cierra */
function handleAuthCallback() {
  const qs = new URLSearchParams(location.search), hs = new URLSearchParams(location.hash.slice(1));
  const state = qs.get('state') || hs.get('state');
  if (!state || !state.startsWith('pdfs_')) return false;
  const msg = { state, code: qs.get('code'), access_token: hs.get('access_token'), expires_in: hs.get('expires_in'), error: qs.get('error') || hs.get('error'), error_description: qs.get('error_description') || hs.get('error_description'), t: Date.now() };
  try { const bc = new BroadcastChannel(AUTH_CH); bc.postMessage(msg); setTimeout(() => bc.close(), 500); } catch { }
  try { localStorage.setItem('pdfs.authmsg', JSON.stringify(msg)); } catch { }
  document.body.innerHTML = '<div style="font:15px Segoe UI,Arial;padding:50px;text-align:center;color:#333">✔ Inicio de sesión completado.<br><br>Ya puede cerrar esta ventana.</div>';
  setTimeout(() => window.close(), 400);
  return true;
}
function ensureServed() {
  if (location.protocol === 'file:') throw new Error(`La conexión con la nube necesita que la app se abra desde el lanzador (http://localhost:${APP_PORT}/). Ejecute «Iniciar Rúbrica.bat».`);
}
function openPopup(url) {
  const w = 520, h = 680, l = screenX + (outerWidth - w) / 2, t = screenY + (outerHeight - h) / 2;
  const win = window.open(url, 'pdfs_auth', `width=${w},height=${h},left=${l},top=${t}`);
  if (!win) throw new Error('El navegador bloqueó la ventana emergente. Permita ventanas emergentes para esta página.');
  return win;
}
function waitAuth(state) {
  return new Promise((res, rej) => {
    let done = false, bc = null;
    const finish = (v, err) => { if (done) return; done = true; try { bc && bc.close(); } catch { } window.removeEventListener('storage', onSt); clearTimeout(to); m.close('x'); try { localStorage.removeItem('pdfs.authmsg'); } catch { } err ? rej(err) : res(v); };
    const onMsg = d => { if (d && d.state === state) finish(d); };
    try { bc = new BroadcastChannel(AUTH_CH); bc.onmessage = e => onMsg(e.data); } catch { }
    const onSt = e => { if (e.key === 'pdfs.authmsg' && e.newValue) { try { onMsg(JSON.parse(e.newValue)); } catch { } } };
    window.addEventListener('storage', onSt);
    const to = setTimeout(() => finish(null, new Error('Se agotó el tiempo de espera del inicio de sesión.')), 300000);
    const m = openModal({ title: 'Iniciando sesión…', body: el('div', { html: 'Complete el inicio de sesión en la ventana emergente.<br><span class="hint">Si no aparece, revise que el navegador permita ventanas emergentes.</span>' }), buttons: [{ label: 'Cancelar', value: 'cancel' }] });
    m.result.then(v => { if (!done && v !== 'x') finish(null, new Error('Inicio de sesión cancelado.')); });
  });
}
function b64url(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function pkcePair() {
  const v = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const c = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))));
  return { v, c };
}
async function readErr(r) { let m = 'HTTP ' + r.status; try { const j = await r.json(); m = j.error?.message || j.error_description || j.error || m; if (typeof m === 'object') m = JSON.stringify(m); } catch { } return m; }

const CLOUD = {};
/* ---------------- OneDrive ---------------- */
const MS_SCOPES = 'openid profile offline_access User.Read Files.ReadWrite.All';
CLOUD.onedrive = {
  id: 'onedrive', label: 'OneDrive', loginLabel: 'Iniciar sesión con Microsoft',
  configured() { return !!S.settings.msClientId; },
  tok() { return store.get('tok.ms', null); }, setTok(t) { store.set('tok.ms', t); updateCloudStatus(); },
  label2() { const t = this.tok(); return t?.user ? 'Conectado: ' + t.user : this.configured() ? 'Iniciar sesión y elegir carpeta' : 'Requiere configuración (una sola vez)'; },
  authBase() { return `https://login.microsoftonline.com/${encodeURIComponent(S.settings.msTenant || 'common')}/oauth2/v2.0`; },
  async login() {
    ensureServed(); if (!this.configured()) throw new Error('Configure primero el ID de cliente de Microsoft (⚙ Configuración).');
    const { v, c } = await pkcePair(), state = 'pdfs_ms_' + uid();
    const url = this.authBase() + '/authorize?' + new URLSearchParams({ client_id: S.settings.msClientId, response_type: 'code', redirect_uri: redirectUri(), response_mode: 'query', scope: MS_SCOPES, state, code_challenge: c, code_challenge_method: 'S256', prompt: 'select_account' });
    openPopup(url);
    const msg = await waitAuth(state);
    if (msg.error) throw new Error(msg.error_description || msg.error);
    await this.tokenReq({ grant_type: 'authorization_code', code: msg.code, code_verifier: v, redirect_uri: redirectUri() });
    try { const t = this.tok(); t.user = await this.me(); this.setTok(t); } catch { }
  },
  async tokenReq(params) {
    const r = await fetch(this.authBase() + '/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: S.settings.msClientId, scope: MS_SCOPES, ...params }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.error || 'HTTP ' + r.status);
    const prev = this.tok() || {};
    const t = { access: j.access_token, refresh: j.refresh_token || prev.refresh, exp: Date.now() + (j.expires_in - 90) * 1000, user: prev.user };
    this.setTok(t); return t;
  },
  async token() {
    let t = this.tok();
    if (t && t.exp > Date.now()) return t.access;
    if (t?.refresh) { try { return (await this.tokenReq({ grant_type: 'refresh_token', refresh_token: t.refresh })).access; } catch (e) { console.warn('refresh', e); } }
    await this.login(); return this.tok().access;
  },
  logout() { store.del('tok.ms'); updateCloudStatus(); },
  async api(path, opt = {}, raw = false) {
    const url = path.startsWith('http') ? path : 'https://graph.microsoft.com/v1.0' + path;
    const go = async () => fetch(url, { ...opt, headers: { Authorization: 'Bearer ' + await this.token(), ...(opt.headers || {}) } });
    let r = await go();
    if (r.status === 401) { const t = this.tok(); if (t) { t.exp = 0; this.setTok(t); } r = await go(); }
    if (!r.ok) throw new Error(await readErr(r));
    return raw ? r : (r.status === 204 ? null : r.json());
  },
  base(ref) { return ref?.driveId ? `/drives/${ref.driveId}/items/${ref.id}` : (ref?.id && ref.id !== 'root' ? `/me/drive/items/${ref.id}` : '/me/drive/root'); },
  map(it) {
    const ri = it.remoteItem, s = ri || it;
    return { id: s.id, driveId: ri ? ri.parentReference?.driveId : it.parentReference?.driveId, parentId: s.parentReference?.id, name: it.name, isFolder: !!s.folder, size: s.size, modified: it.lastModifiedDateTime || s.lastModifiedDateTime, mime: s.file?.mimeType };
  },
  roots: [{ id: 'root', name: 'Mis archivos' }, { id: '__recent', name: 'Recientes' }, { id: '__shared', name: 'Compartidos conmigo' }],
  async list(folder) {
    let url = folder.id === '__recent' ? '/me/drive/recent?$top=100' : folder.id === '__shared' ? '/me/drive/sharedWithMe?$top=200'
      : this.base(folder) + '/children?$top=200&$select=id,name,size,folder,file,lastModifiedDateTime,parentReference,remoteItem';
    const out = [];
    while (url && out.length < 3000) { const j = await this.api(url); out.push(...j.value.map(x => this.map(x))); url = j['@odata.nextLink']; }
    return out;
  },
  async search(q) { const j = await this.api(`/me/drive/root/search(q='${encodeURIComponent(q.replace(/'/g, "''"))}')?$top=100`); return j.value.map(x => this.map(x)); },
  async download(ref) {
    const it = await this.api(this.base(ref));
    const u = it['@microsoft.graph.downloadUrl'];
    const r = u ? await fetch(u) : await this.api(this.base(ref) + '/content', {}, true);
    if (!r.ok) throw new Error('Descarga fallida (' + r.status + ')');
    return new Uint8Array(await r.arrayBuffer());
  },
  async put(path, bytes, upd, conflict) {
    if (bytes.length < 4 * 1024 * 1024)
      return this.api(path + '/content' + (conflict === 'rename' ? '?@microsoft.graph.conflictBehavior=rename' : ''), { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: bytes });
    const s = await this.api(path + '/createUploadSession', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': conflict } }) });
    const CH = 320 * 1024 * 16; let res = null;
    for (let o = 0; o < bytes.length; o += CH) {
      const end = Math.min(bytes.length, o + CH); upd && upd(null, o / bytes.length * 100);
      const r = await fetch(s.uploadUrl, { method: 'PUT', headers: { 'Content-Range': `bytes ${o}-${end - 1}/${bytes.length}` }, body: bytes.slice(o, end) });
      if (!r.ok) throw new Error('Error al subir (' + r.status + ')');
      if (r.status === 200 || r.status === 201) res = await r.json();
    }
    return res;
  },
  async upload(folder, name, bytes, upd) { return this.map(await this.put(this.base(folder) + ':/' + encodeURIComponent(name) + ':', bytes, upd, 'rename')); },
  async update(ref, bytes, upd) { return this.map(await this.put(this.base(ref), bytes, upd, 'replace')); },
  async mkdir(folder, name) { return this.map(await this.api(this.base(folder) + '/children', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'rename' }) })); },
  async me() { const j = await this.api('/me'); return j.mail || j.userPrincipalName || j.displayName; }
};
/* ---------------- Google Drive ---------------- */
const G_SCOPE = 'https://www.googleapis.com/auth/drive';
const G_FOLDER = 'application/vnd.google-apps.folder';
const G_FIELDS = 'id,name,mimeType,size,modifiedTime,parents';
CLOUD.gdrive = {
  id: 'gdrive', label: 'Google Drive', loginLabel: 'Iniciar sesión con Google',
  configured() { return !!S.settings.gClientId; },
  tok() { return store.get('tok.g', null); }, setTok(t) { store.set('tok.g', t); updateCloudStatus(); },
  label2() { const t = this.tok(); return t?.user ? 'Conectado: ' + t.user : this.configured() ? 'Iniciar sesión y elegir carpeta' : 'Requiere configuración (una sola vez)'; },
  async login(silent) {
    ensureServed(); if (!this.configured()) throw new Error('Configure primero el ID de cliente de Google (⚙ Configuración).');
    const state = 'pdfs_g_' + uid(), prev = this.tok();
    const p = { client_id: S.settings.gClientId, redirect_uri: redirectUri(), response_type: 'token', scope: G_SCOPE, include_granted_scopes: 'true', state };
    if (prev?.user) p.login_hint = prev.user; else p.prompt = 'select_account';
    openPopup('https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams(p));
    const msg = await waitAuth(state);
    if (msg.error) throw new Error(msg.error_description || msg.error);
    this.setTok({ access: msg.access_token, exp: Date.now() + ((+msg.expires_in || 3600) - 90) * 1000, user: prev?.user });
    try { const t = this.tok(); t.user = await this.me(); this.setTok(t); } catch { }
  },
  async token() { const t = this.tok(); if (t && t.exp > Date.now()) return t.access; await this.login(); return this.tok().access; },
  logout() { const t = this.tok(); if (t?.access) fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t.access), { method: 'POST' }).catch(() => { }); store.del('tok.g'); updateCloudStatus(); },
  async api(url, opt = {}, raw = false) {
    const go = async () => fetch(url, { ...opt, headers: { Authorization: 'Bearer ' + await this.token(), ...(opt.headers || {}) } });
    let r = await go();
    if (r.status === 401) { const t = this.tok(); if (t) { t.exp = 0; this.setTok(t); } r = await go(); }
    if (!r.ok) throw new Error(await readErr(r));
    return raw ? r : r.json();
  },
  map(f) { return { id: f.id, name: f.name, isFolder: f.mimeType === G_FOLDER, size: f.size, modified: f.modifiedTime, mime: f.mimeType, parentId: f.parents?.[0] }; },
  roots: [{ id: 'root', name: 'Mi unidad' }, { id: '__shared', name: 'Compartidos conmigo' }, { id: '__recent', name: 'Recientes' }],
  async query(q, orderBy, max = 2000) {
    const out = []; let pageToken = '';
    do {
      const p = new URLSearchParams({ q, fields: 'nextPageToken,files(' + G_FIELDS + ')', pageSize: '200', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
      if (orderBy) p.set('orderBy', orderBy); if (pageToken) p.set('pageToken', pageToken);
      const j = await this.api('https://www.googleapis.com/drive/v3/files?' + p);
      out.push(...j.files.map(f => this.map(f))); pageToken = j.nextPageToken;
    } while (pageToken && out.length < max);
    return out;
  },
  list(folder) {
    if (folder.id === '__shared') return this.query('sharedWithMe and trashed=false', 'folder,name');
    if (folder.id === '__recent') return this.query(`trashed=false and mimeType!='${G_FOLDER}'`, 'modifiedTime desc', 100);
    return this.query(`'${folder.id}' in parents and trashed=false`, 'folder,name');
  },
  search(q) { return this.query(`name contains '${q.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and trashed=false`, 'modifiedTime desc', 200); },
  async download(ref) { const r = await this.api(`https://www.googleapis.com/drive/v3/files/${ref.id}?alt=media&supportsAllDrives=true`, {}, true); return new Uint8Array(await r.arrayBuffer()); },
  async send(method, url, meta, bytes, upd) {
    if (bytes.length > 5 * 1024 * 1024) {
      try {
        const init = await this.api(url.replace(/uploadType=\w+/, 'uploadType=resumable'), { method, headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/pdf', 'X-Upload-Content-Length': String(bytes.length) }, body: JSON.stringify(meta || {}) }, true);
        const loc = init.headers.get('Location');
        if (loc) { upd && upd(null, 30); const r = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: bytes }); if (!r.ok) throw new Error(await readErr(r)); return r.json(); }
      } catch (e) { console.warn('resumable', e); }
    }
    const b = 'pdfs' + uid();
    const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta || {})}\r\n--${b}\r\nContent-Type: application/pdf\r\n\r\n`, bytes, `\r\n--${b}--`]);
    return this.api(url.replace(/uploadType=\w+/, 'uploadType=multipart'), { method, headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body });
  },
  async upload(folder, name, bytes, upd) {
    const parent = !folder || folder.id.startsWith('__') ? 'root' : folder.id;
    return this.map(await this.send('POST', `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=${G_FIELDS}`, { name, mimeType: 'application/pdf', parents: [parent] }, bytes, upd));
  },
  async update(ref, bytes, upd) { return this.map(await this.send('PATCH', `https://www.googleapis.com/upload/drive/v3/files/${ref.id}?uploadType=multipart&supportsAllDrives=true&fields=${G_FIELDS}`, {}, bytes, upd)); },
  async mkdir(folder, name) { return this.map(await this.api(`https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=${G_FIELDS}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: G_FOLDER, parents: [folder.id.startsWith('__') ? 'root' : folder.id] }) })); },
  async me() { const j = await this.api('https://www.googleapis.com/drive/v3/about?fields=user'); return j.user.emailAddress || j.user.displayName; }
};
function updateCloudStatus() {
  const box = $('#cloud-status'); if (!box) return; box.innerHTML = '';
  for (const P of [CLOUD.onedrive, CLOUD.gdrive]) {
    if (!P.configured()) continue;
    const t = P.tok();
    box.append(el('span', { title: t?.user ? P.label + ': ' + t.user : P.label + ': sin sesión' }, el('i', { class: t ? 'on' : '' }), P.label));
  }
}

/* ---------------- Explorador de la nube ---------------- */
function openCloudBrowser({ mode = 'open', provider = 'onedrive', multiple = false, name = '' } = {}) {
  return new Promise(resolve => {
    let prov = provider, stack = [], items = [], sel = new Set(), loading = false, err = '', q = '';
    const body = el('div'), tabs = el('div', { class: 'tabs2' }), content = el('div');
    const nameI = el('input', { type: 'text', value: name, style: { flex: 1, border: '1px solid var(--line)', borderRadius: '6px', padding: '6px 8px', background: 'var(--panel2)' } });
    body.append(tabs, content);
    const P = () => CLOUD[prov];
    const okBtn = el('button', { class: 'btn primary', text: mode === 'save' ? 'Guardar aquí' : 'Abrir' });
    const mkBtn = el('button', { class: 'btn', html: ic('folder-plus') + 'Nueva carpeta' });
    const m = openModal({ title: mode === 'save' ? 'Guardar en la nube' : 'Abrir desde la nube', body, wide: true, onClose: () => resolve(result) });
    let result = null;
    const foot = el('div', { class: 'modal-f' }); m.box.append(foot);
    if (mode === 'save') foot.append(el('span', { class: 'muted', text: 'Nombre:' }), nameI, mkBtn);
    foot.append(el('button', { class: 'btn', text: 'Cancelar', onclick: () => m.close() }), okBtn);
    const cur = () => stack[stack.length - 1];
    const accept = it => it.isFolder || (mode === 'save' ? isPdfName(it.name) : (isPdfName(it.name) || isImageName(it.name) || it.mime === 'application/pdf'));
    const load = async () => {
      loading = true; err = ''; draw();
      try { items = q ? await P().search(q) : await P().list(cur()); items = items.filter(accept).sort((a, b) => (b.isFolder - a.isFolder) || (cur().id === '__recent' && !q ? 0 : a.name.localeCompare(b.name, 'es'))); }
      catch (e) { err = e.message; items = []; }
      loading = false; sel.clear(); draw();
    };
    const go = f => { q = ''; stack.push(f); load(); };
    const drawTabs = () => {
      tabs.innerHTML = '';
      for (const k of ['onedrive', 'gdrive']) tabs.append(el('button', { class: k === prov ? 'on' : '', html: ic('cloud') + CLOUD[k].label, onclick: () => { if (prov === k) return; prov = k; stack = []; items = []; init(); } }));
    };
    const draw = () => {
      content.innerHTML = '';
      const Pr = P(); const t = Pr.tok();
      okBtn.disabled = mkBtn.disabled = !t || !stack.length;
      if (!Pr.configured()) {
        content.append(el('div', { class: 'cb-empty' }, el('p', { html: `Para usar <b>${Pr.label}</b> hay que registrar esta aplicación una sola vez (gratis) y pegar el <b>ID de cliente</b>.` }),
          el('button', { class: 'btn primary', html: ic('settings') + 'Abrir configuración', onclick: async () => { await settingsDialog(prov); draw(); } })));
        return;
      }
      if (!t) {
        content.append(el('div', { class: 'cb-empty' }, el('p', { text: 'No hay una sesión iniciada en ' + Pr.label + '.' }),
          el('button', { class: 'btn primary', html: ic('log-in') + Pr.loginLabel, onclick: async () => { try { await Pr.login(); init(); } catch (e) { toast(e.message, 'err', 6000); } } })));
        return;
      }
      const search = el('input', { type: 'text', placeholder: 'Buscar en ' + Pr.label + '…', value: q, style: { flex: 1, border: '1px solid var(--line)', borderRadius: '6px', padding: '5px 8px', background: 'var(--panel2)' } });
      search.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); q = search.value.trim(); load(); } };
      content.append(el('div', { class: 'cb-top' },
        ...Pr.roots.map(r => el('button', { class: 'btn sm' + (stack[0]?.id === r.id && !q ? ' primary' : ''), text: r.name, onclick: () => { stack = [r]; q = ''; load(); } })),
        search,
        el('span', { class: 'hint', text: t.user || '' }),
        el('button', { class: 'btn sm', html: ic('log-out'), title: 'Cerrar sesión', onclick: () => { Pr.logout(); stack = []; draw(); } })));
      const crumbs = el('div', { class: 'cb-crumbs' });
      if (q) crumbs.append(el('span', { text: `Resultados de «${q}»` }));
      else stack.forEach((f, i) => { if (i) crumbs.append(el('span', { class: 'muted', text: '›' })); crumbs.append(i === stack.length - 1 ? el('b', { text: f.name }) : el('a', { text: f.name, onclick: () => { stack = stack.slice(0, i + 1); load(); } })); });
      crumbs.append(el('button', { class: 'icon-btn sm', html: ic('refresh-cw'), title: 'Actualizar', onclick: load }));
      const list = el('div', { class: 'cb-list' });
      if (loading) list.append(el('div', { class: 'cb-empty' }, el('div', { class: 'spinner', style: { margin: '0 auto' } })));
      else if (err) list.append(el('div', { class: 'cb-empty', style: { color: 'var(--danger)' }, text: 'Error: ' + err }));
      else if (!items.length) list.append(el('div', { class: 'cb-empty', text: mode === 'save' ? 'Carpeta vacía — puede guardar aquí.' : 'No hay PDFs ni imágenes en esta carpeta.' }));
      for (const it of items) {
        const row = el('div', { class: 'cb-row' + (sel.has(it) ? ' sel' : '') }, icEl(it.isFolder ? 'folder' : isPdfName(it.name) ? 'file-text' : 'image'), el('span', { class: 'nm', text: it.name }), el('span', { class: 'meta', text: it.isFolder ? '' : fmtSize(it.size) + '  ' + fmtDate(it.modified) }));
        row.onclick = e => {
          if (it.isFolder) { go(it); return; }
          if (mode === 'save') { nameI.value = it.name; return; }
          if (!(multiple && (e.ctrlKey || e.metaKey))) sel.clear();
          sel.has(it) ? sel.delete(it) : sel.add(it); okBtn.disabled = !sel.size; draw();
        };
        row.ondblclick = () => { if (!it.isFolder && mode === 'open') { sel = new Set([it]); okBtn.click(); } };
        list.append(row);
      }
      content.append(crumbs, list);
      if (mode === 'open') okBtn.disabled = !sel.size;
      if (mode === 'save') okBtn.disabled = !!q || cur()?.id?.startsWith('__');
    };
    okBtn.onclick = async () => {
      if (mode === 'open') { if (!sel.size) return; result = { provider: prov, items: [...sel] }; m.close(); return; }
      let n = nameI.value.trim(); if (!n) { toast('Escriba un nombre de archivo.', 'err'); return; }
      if (!isPdfName(n)) n += '.pdf';
      const folder = cur(); if (!folder || folder.id.startsWith('__')) { toast('Elija una carpeta.', 'err'); return; }
      const ex = items.find(i => !i.isFolder && i.name.toLowerCase() === n.toLowerCase());
      if (ex && !(await confirmDialog('Reemplazar archivo', `Ya existe «${escapeHtml(n)}» en esta carpeta. ¿Reemplazarlo?`, 'Reemplazar', true))) return;
      result = { provider: prov, folder, name: ex ? ex.name : n, existing: ex || null }; m.close();
    };
    mkBtn.onclick = async () => {
      const v = await formDialog('Nueva carpeta', [{ key: 'n', label: 'Nombre', value: 'Nueva carpeta' }], { ok: 'Crear' });
      if (!v || !v.n.trim()) return;
      try { const f = await P().mkdir(cur(), v.n.trim()); go(f); } catch (e) { toast(e.message, 'err'); }
    };
    const init = () => { drawTabs(); if (P().configured() && P().tok()) { stack = [P().roots[0]]; load(); } else draw(); };
    init();
  });
}

/* ---------------- Configuración ---------------- */
async function settingsDialog(focus) {
  const ru = location.protocol === 'file:' ? `http://localhost:${APP_PORT}/` : redirectUri();
  const guide = el('div', { class: 'hint', style: { lineHeight: 1.5 } });
  guide.innerHTML = `
  ${location.protocol === 'file:' ? `<p style="color:var(--danger)"><b>Abierto como archivo local.</b> Para conectar la nube, abra la app con <b>Iniciar Rúbrica.bat</b> (usa ${ru}).</p>` : ''}
  <p>URI de redirección de esta instalación: <code class="kbd">${ru}</code> <button class="btn sm" id="cp-ru">Copiar</button></p>
  <details ${focus === 'onedrive' ? 'open' : ''}><summary><b>Cómo obtener el ID de cliente de Microsoft (OneDrive)</b></summary><ol class="steps">
    <li>Entre a <b>entra.microsoft.com</b> (o portal.azure.com) → <i>Aplicaciones</i> → <i>Registros de aplicaciones</i> → <b>Nuevo registro</b>.</li>
    <li>Nombre: <code>Rúbrica</code>. Tipo de cuenta: <i>Cuentas en cualquier directorio organizativo y cuentas personales de Microsoft</i>.</li>
    <li>URI de redirección: plataforma <b>Aplicación de página única (SPA)</b> → <code>${ru}</code>. Registrar.</li>
    <li>Copie el <b>Id. de aplicación (cliente)</b> y péguelo abajo.</li>
    <li>En <i>Permisos de API</i> agregue de Microsoft Graph (delegados): <code>Files.ReadWrite.All</code>, <code>User.Read</code>, <code>offline_access</code>. Si su organización lo exige, pulse <i>Conceder consentimiento de administrador</i>.</li>
  </ol></details>
  <details ${focus === 'gdrive' ? 'open' : ''}><summary><b>Cómo obtener el ID de cliente de Google (Drive)</b></summary><ol class="steps">
    <li>Entre a <b>console.cloud.google.com</b> y cree un proyecto (p. ej. <code>Rúbrica</code>).</li>
    <li><i>APIs y servicios</i> → <i>Biblioteca</i> → habilite <b>Google Drive API</b>.</li>
    <li><i>Pantalla de consentimiento OAuth</i>: tipo <b>Externo</b>, nombre de la app y su correo. En <i>Usuarios de prueba</i> agregue las cuentas que usarán la app.</li>
    <li><i>Credenciales</i> → <b>Crear credenciales</b> → <i>ID de cliente de OAuth</i> → tipo <b>Aplicación web</b>.<br>Orígenes de JavaScript autorizados: <code>${ru.replace(/\/$/, '')}</code><br>URI de redireccionamiento autorizados: <code>${ru}</code></li>
    <li>Copie el <b>ID de cliente</b> (termina en <code>.apps.googleusercontent.com</code>) y péguelo abajo. Al iniciar sesión Google mostrará «app no verificada»: elija <i>Continuar</i> (es su propia app).</li>
  </ol></details>
  <p>Los archivos viajan directamente entre este equipo y su nube; no hay servidores intermedios ni suscripción.</p>`;
  setTimeout(() => { const b = $('#cp-ru'); if (b) b.onclick = () => { navigator.clipboard.writeText(ru); toast('Copiado.', 'ok'); }; }, 50);
  const v = await formDialog('Configuración', [
    ...(CAP ? [{ type: 'heading', label: 'Escaneo' },
      { key: 'scanPageSize', label: 'Tamaño de página de los escaneos', type: 'select', value: S.settings.scanPageSize || 'letter', options: [['letter', 'Carta'], ['a4', 'A4'], ['legal', 'Oficio / Legal'], ['fit', 'Tamaño de la imagen']] },
      { key: 'scanOcr', label: 'Reconocer texto (OCR) al escanear, para poder buscar y copiar', type: 'checkbox', value: S.settings.scanOcr !== false }] : []),
    ...(CAP ? [] : [{ type: 'heading', label: 'Nube' },
    { key: 'msClientId', label: 'Microsoft · ID de aplicación (cliente)', value: S.settings.msClientId, placeholder: '00000000-0000-0000-0000-000000000000' },
    { key: 'msTenant', label: 'Microsoft · Inquilino', value: S.settings.msTenant || 'common', hint: '<code>common</code> acepta cuentas personales y de empresa. Use su dominio (p. ej. <code>miempresa.com</code>) para limitarlo a su organización.' },
    { key: 'gClientId', label: 'Google · ID de cliente', value: S.settings.gClientId, placeholder: 'xxxxxxxx.apps.googleusercontent.com' }]),
    { type: 'heading', label: 'Fuentes' },
    { key: 'defaultFont', label: 'Fuente predeterminada', type: 'select', value: S.settings.defaultFont || 'Aptos', options: [...new Set([S.settings.defaultFont || 'Aptos', 'Aptos', ...STD_FONTS, ...fontFamilies()])].map(f => [f, (STD_LABEL[f] || f) + (fontAvailable(f) ? '' : ' (no disponible en este equipo)')]) },
    { key: 'detectFonts', label: 'Detectar la fuente original al editar texto (usa la fuente instalada con el mismo nombre)', type: 'checkbox', value: S.settings.detectFonts !== false },
    { type: 'hint', label: `${FONTS.list.size} familias de fuentes disponibles${FONTS.provider === 'native' ? ' (incluye fuentes de Microsoft 365)' : ''}. Si una fuente no existe, se usa Helvetica.` },
    { type: 'heading', label: 'General' },
    { key: 'lang', label: 'Idioma de la interfaz', type: 'select', value: S.settings.lang || 'auto', options: [['auto', 'Automático (idioma del sistema)'], ['es', 'Español'], ['en', 'English'], ['pt', 'Português']] },
    { key: 'uiScale', label: 'Tamaño de la interfaz (menús, paneles y ventanas)', type: 'select', value: String(S.settings.uiScale || 1), options: [['0.9', '90 %'], ['1', '100 %'], ['1.15', '115 %'], ['1.3', '130 %'], ['1.5', '150 %']], row: 'cols' },
    { key: 'author', label: 'Nombre del autor (notas y firmas)', value: S.settings.author },
    ...(NATIVE ? [{ key: 'autoUpdate', label: 'Buscar actualizaciones al iniciar', type: 'checkbox', value: S.settings.autoUpdate !== false }] : [])
  ], {
    ok: 'Guardar', wide: true, extra: () => CAP ? el('div', { class: 'hint', html: 'En Android, «Abrir» y «Guardar» usan el selector del sistema, que incluye Google Drive, OneDrive (si su app está instalada) y el almacenamiento del teléfono.<br>Para usar Aptos u otra fuente, copie el archivo .ttf al teléfono y use «Agregar fuente…».' }) : guide, extraButtons: [
      ...(!NATIVE && 'queryLocalFonts' in window ? [{ label: 'Cargar fuentes del equipo', onClick: async () => { await loadLocalFonts(false); return false; } }] : []),
      { label: 'Agregar fuente…', onClick: async () => { await addUserFont(); return false; } },
      { label: 'Preferencias de firma…', onClick: async () => { await signPrefsDialog(); return false; } },
      ...(CAP ? [] : [{ label: 'Atajos de teclado', onClick: async () => { await shortcutsDialog(); return false; } }]),
      ...(NATIVE ? [{ label: 'Buscar actualizaciones', onClick: async () => { await nativeCheckUpdates(true); return false; } }] : [])]
  });
  if (!v) return;
  const fontChanged = (v.defaultFont || 'Aptos') !== (S.settings.defaultFont || 'Aptos');
  S.settings.defaultFont = v.defaultFont; S.settings.detectFonts = v.detectFonts; if ('autoUpdate' in v) S.settings.autoUpdate = v.autoUpdate;
  if (+v.uiScale !== (S.settings.uiScale || 1)) { S.settings.uiScale = +v.uiScale; applyUiScale(); }
  if ((v.lang || 'auto') !== (S.settings.lang || 'auto')) { S.settings.lang = v.lang; applyLang(v.lang); renderRibbon(); renderSide(); renderProps(); }
  if (fontChanged) { S.toolOpts.text.font = defaultFont(); S.toolOpts.text._fontSet = false; saveToolOpts(); if (!isStdFont(defaultFont())) ensureFont(defaultFont(), false, false); }
  if ('scanPageSize' in v) { S.settings.scanPageSize = v.scanPageSize; S.settings.scanOcr = v.scanOcr; }
  if (!('msClientId' in v)) Object.assign(v, { msClientId: S.settings.msClientId, msTenant: S.settings.msTenant || 'common', gClientId: S.settings.gClientId });
  const changedMs = v.msClientId.trim() !== S.settings.msClientId || v.msTenant.trim() !== S.settings.msTenant;
  const changedG = v.gClientId.trim() !== S.settings.gClientId;
  Object.assign(S.settings, { msClientId: v.msClientId.trim(), msTenant: v.msTenant.trim() || 'common', gClientId: v.gClientId.trim(), author: v.author.trim() });
  saveSettings(); if (changedMs) CLOUD.onedrive.logout(); if (changedG) CLOUD.gdrive.logout();
  updateCloudStatus(); toast('Configuración guardada.', 'ok');
}
