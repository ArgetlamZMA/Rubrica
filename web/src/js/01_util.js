'use strict';
/* ============================================================
   PDF Studio — editor PDF local con OneDrive / Google Drive
   01 · Utilidades
   ============================================================ */
const PL = PDFLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
  new Blob([document.getElementById('pdfjs-worker-src').textContent], { type: 'text/javascript' }));

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PT_PER_MM = 72 / 25.4;
const PX_PER_PT = 96 / 72;

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) {
    if (k == null || k === false) continue;
    e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return e;
}
function ic(name, cls = 'ic') {
  const body = ICONS[name] || ICONS['square'];
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
function icEl(name) { const t = document.createElement('template'); t.innerHTML = ic(name); return t.content.firstChild; }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function toast(msg, kind = '', ms = 3200) {
  const t = el('div', { class: 'toast ' + kind, text: msg });
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}
let busyDepth = 0;
function busy(on, msg, pct) {
  const b = $('#busy');
  if (on === true) { busyDepth++; b.classList.add('on'); }
  if (on === false) { busyDepth = Math.max(0, busyDepth - 1); if (!busyDepth) b.classList.remove('on'); }
  if (msg != null) $('#busy-msg').textContent = msg;
  $('#busy-fill').style.width = pct == null ? '0' : clamp(pct, 0, 100) + '%';
}
async function withBusy(msg, fn) {
  busy(true, msg);
  try { return await fn((m, p) => busy(null, m ?? msg, p)); }
  finally { busy(false); }
}

function hexToRgb(hex) {
  const h = String(hex || '#000000').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16) || 0;
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
const plRgb = hex => { const c = hexToRgb(hex); return PL.rgb(c.r, c.g, c.b); };
function rgbToHex(r, g, b) { return '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join(''); }

function download(blob, name) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
const pdfBlob = bytes => new Blob([bytes], { type: 'application/pdf' });
async function readFileBytes(file) { return new Uint8Array(await file.arrayBuffer()); }
function fmtSize(n) {
  if (n == null || isNaN(n)) return '';
  n = +n; if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
function fmtDate(d) { if (!d) return ''; const x = new Date(d); return isNaN(x) ? '' : x.toLocaleDateString('es-HN', { day: '2-digit', month: 'short', year: 'numeric' }); }
function todayStr() { return new Date().toLocaleDateString('es-HN', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
function baseName(n) { return String(n || 'documento').replace(/\.[a-z0-9]{2,5}$/i, ''); }
function isPdfName(n) { return /\.pdf$/i.test(n || ''); }
function isImageName(n) { return /\.(png|jpe?g|gif|bmp|webp|tiff?)$/i.test(n || ''); }
function isImageMime(m) { return /^image\//.test(m || ''); }

/** "1-3,5,8-" → índices base 0 (n = total). Vacío o "todas" → todas. */
function parseRanges(str, n) {
  str = String(str || '').trim().toLowerCase();
  if (!str || str === 'todas' || str === 'all' || str === '*') return [...Array(n).keys()];
  const out = [];
  for (const part of str.split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    if (m) {
      let a = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : n;
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) if (i >= 1 && i <= n) out.push(i - 1);
    } else if (/^\d+$/.test(part)) { const i = +part; if (i >= 1 && i <= n) out.push(i - 1); }
    else throw new Error('Rango no válido: ' + part);
  }
  return [...new Set(out)];
}
const store = {
  get(k, d) { try { const v = localStorage.getItem('pdfs.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pdfs.' + k, JSON.stringify(v)); } catch (e) { console.warn(e); } },
  del(k) { try { localStorage.removeItem('pdfs.' + k); } catch { } }
};
/* IndexedDB mínimo para guardar identificadores de archivos locales (Recientes) */
const idb = {
  db: null,
  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((res, rej) => {
      const r = indexedDB.open('pdfstudio', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return this.db;
  },
  async get(k) { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async set(k, v) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
  async del(k) { const db = await this.open(); return new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = () => res(); }); }
};
function dataUrlToBytes(u) {
  const b64 = u.split(',')[1]; const bin = atob(b64); const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
function bytesToDataUrl(bytes, mime) {
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(new Blob([bytes], { type: mime })); });
}
function canvasToBlob(c, type = 'image/png', q = 0.92) { return new Promise(res => c.toBlob(res, type, q)); }
async function canvasToBytes(c, type, q) { return new Uint8Array(await (await canvasToBlob(c, type, q)).arrayBuffer()); }
function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('No se pudo leer la imagen')); i.src = src; }); }

/* ---------------- Ventanas modales ---------------- */
function openModal({ title, body, buttons = [], wide = false, onClose, closable = true }) {
  let resolve; const result = new Promise(r => resolve = r);
  const bg = el('div', { class: 'modal-bg' });
  const box = el('div', { class: 'modal' + (wide ? ' wide' : '') });
  const close = v => { bg.remove(); document.removeEventListener('keydown', onKey, true); onClose && onClose(v); resolve(v); };
  const head = el('div', { class: 'modal-h' }, el('span', { text: title }),
    closable ? el('button', { class: 'icon-btn', html: ic('x'), onclick: () => close(null) }) : null);
  const foot = el('div', { class: 'modal-f' });
  for (const b of buttons) {
    foot.append(el('button', {
      class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), html: (b.icon ? ic(b.icon) : '') + escapeHtml(b.label),
      onclick: async () => { if (b.onClick) { const r = await b.onClick(); if (r === false) return; close(r === undefined ? b.value : r); } else close(b.value); }
    }));
  }
  const onKey = e => {
    if (e.key === 'Escape' && closable) { e.stopPropagation(); close(null); }
    if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
      const p = foot.querySelector('.btn.primary'); if (p) { e.preventDefault(); e.stopPropagation(); p.click(); }
    }
  };
  document.addEventListener('keydown', onKey, true);
  box.append(head, el('div', { class: 'modal-b' }, body)); if (buttons.length) box.append(foot);
  bg.append(box);
  bg.addEventListener('mousedown', e => { if (e.target === bg && closable) close(null); });
  $('#modal-root').append(bg);
  setTimeout(() => { const f = box.querySelector('input:not([type=hidden]):not([type=checkbox]),textarea,select'); f && f.focus(); }, 30);
  return { close, result, box, foot };
}
function confirmDialog(title, msg, ok = 'Aceptar', danger = false) {
  return openModal({ title, body: el('div', { html: msg }), buttons: [{ label: 'Cancelar', value: false }, { label: ok, primary: !danger, danger, value: true }] }).result.then(v => !!v);
}
function alertDialog(title, html) { return openModal({ title, body: el('div', { html }), buttons: [{ label: 'Entendido', primary: true, value: true }] }).result; }

/**
 * Diálogo de formulario genérico.
 * fields: [{key,label,type,value,options:[[v,l]],min,max,step,placeholder,hint,row:'cols'}]
 */
function formDialog(title, fields, { ok = 'Aplicar', wide = false, extra, validate, extraButtons = [] } = {}) {
  const form = el('div', { class: 'fm' });
  const inputs = {};
  const mk = f => {
    if (f.type === 'heading') return el('h5', { text: f.label });
    if (f.type === 'hint') return el('div', { class: 'hint', html: f.label, style: { marginBottom: '10px' } });
    if (f.type === 'checkbox') {
      const i = el('input', { type: 'checkbox' }); i.checked = !!f.value; inputs[f.key] = i;
      return el('label', { class: 'chk' }, i, el('span', { html: f.label }));
    }
    let i;
    if (f.type === 'select') { i = el('select'); for (const [v, l] of f.options) i.append(el('option', { value: v, text: l })); i.value = f.value ?? f.options[0][0]; }
    else if (f.type === 'textarea') { i = el('textarea', { placeholder: f.placeholder || '' }); i.value = f.value ?? ''; }
    else if (f.type === 'pos') {
      i = el('div', { class: 'pos-grid' }); i.value = f.value || 'bc';
      for (const p of (f.positions || ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'])) {
        const b = el('button', { type: 'button', title: p, class: p === i.value ? 'on' : '' });
        b.onclick = () => { i.value = p; $$('button', i).forEach(x => x.classList.toggle('on', x === b)); };
        i.append(b);
      }
      if (f.positions && f.positions.length === 6) i.style.gridTemplateRows = '22px 22px';
    }
    else { i = el('input', { type: f.type || 'text', placeholder: f.placeholder || '', min: f.min, max: f.max, step: f.step }); i.value = f.value ?? ''; }
    inputs[f.key] = i;
    return el('div', { class: 'row' }, f.label ? el('label', { html: f.label }) : null, i, f.hint ? el('div', { class: 'hint', html: f.hint }) : null);
  };
  let rowBuf = null;
  for (const f of fields) {
    const node = mk(f);
    if (f.row) { if (!rowBuf || rowBuf.dataset.k !== f.row) { rowBuf = el('div', { class: f.row.startsWith('cols3') ? 'cols3' : 'cols', dataset: { k: f.row } }); form.append(rowBuf); } rowBuf.append(node); }
    else { rowBuf = null; form.append(node); }
  }
  if (extra) form.append(extra(inputs));
  const read = () => {
    const v = {};
    for (const [k, i] of Object.entries(inputs)) v[k] = i.type === 'checkbox' ? i.checked : (i.type === 'number' ? (i.value === '' ? null : +i.value) : i.value);
    return v;
  };
  return openModal({
    title, body: form, wide, buttons: [...extraButtons.map(b => ({ ...b, onClick: () => b.onClick(read(), inputs) })), { label: 'Cancelar', value: null }, {
      label: ok, primary: true, onClick: () => {
        const v = read();
        if (validate) { const err = validate(v); if (err) { toast(err, 'err'); return false; } }
        return v;
      }
    }]
  }).result;
}
function askPassword(title, msg) {
  return formDialog(title, [{ type: 'hint', label: msg }, { key: 'pw', label: 'Contraseña', type: 'password' }], { ok: 'Abrir' }).then(v => v ? v.pw : null);
}

/* Marca: ícono de ZMA Inversiones (submarca «A»). Propiedad de ZMA Inversiones — ver branding/LEEME.md */
const BRAND_ICON = '<svg viewBox="0 0 138.99 182.11" fill="currentColor" aria-hidden="true"><path d="M138.81,178.44L72.03,1.75c-.4-1.05-1.41-1.75-2.53-1.75h-.02c-1.13,0-2.14.71-2.53,1.78-10.53,28.83-22.15,59.07-33.38,88.31C22.33,119.34,10.7,149.6.16,178.47c-.36.97-.13,2.07.6,2.82.73.74,1.81,1.01,2.8.68l33.24-11.06c.75-.25,1.36-.82,1.66-1.56l21.18-52.68,7.02,22.94-10.25,33.51c-.25.83-.1,1.72.42,2.41.51.69,1.32,1.09,2.18,1.09h.02l20.95-.11c.85,0,1.66-.42,2.17-1.11.51-.69.66-1.58.41-2.4l-10.22-33.4,6.94-22.66,21.07,52.4c.29.74.9,1.31,1.66,1.56l33.42,11.07c.28.09.57.13.85.13.73,0,1.43-.29,1.95-.84.73-.75.95-1.85.58-2.83ZM33.91,166.15l-26.72,8.89c10-27.22,20.9-55.55,31.45-83.01,2.48-6.48,4.99-13,7.5-19.54l7.41,24.22s.02.06.02.08l3.56,11.62-23.22,57.75ZM76.3,171.11l-13.62.07,6.83-22.3,6.79,22.23ZM69.5,130.33l-6.07-19.82s-.02-.06-.02-.08l-.55-1.78,6.53-16.25,6.64,16.53-6.54,21.4ZM78.58,100.68l-6.66-16.55c-.41-1.03-1.41-1.7-2.52-1.7s-2.1.67-2.52,1.7l-6.54,16.27-1.57-5.13s-.02-.05-.02-.07l-9.46-30.94c6.89-18.02,13.75-36.11,20.25-53.77l20.25,53.56-11.21,36.64ZM104.9,166.15l-23.1-57.46,11.12-36.35,38.82,102.7-26.84-8.89Z"/></svg>';
