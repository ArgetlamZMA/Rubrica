/* PDF Studio — service worker: la app funciona sin el servidor local una vez instalada,
   y guarda en caché el motor OCR la primera vez que se descarga. */
const APP = 'pdfstudio-app-v1', RUNTIME = 'pdfstudio-runtime-v1';
const CORE = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(APP).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== APP && k !== RUNTIME).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // la app: red primero (para recibir actualizaciones), caché si el servidor local no está corriendo
    const key = req.mode === 'navigate' ? '/' : url.pathname;
    e.respondWith(fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(APP).then(c => c.put(key, cp)); } return r; }).catch(() => caches.match(key, { ignoreSearch: true })));
    return;
  }
  // motor OCR y datos de idioma: caché primero
  if (/cdn\.jsdelivr\.net|tessdata\.projectnaptha\.com/.test(url.host)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(RUNTIME).then(c => c.put(req, cp)); } return r; })));
  }
});
