const CACHE = 'livetrades-v2';
const PRECACHE = ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  const fresh = req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html') || url.pathname === '/sw.js';
  event.respondWith(
    fetch(req, fresh ? { cache: 'no-store' } : {}).then(res => {
      if (!fresh && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => fresh ? Response.error() : caches.match(req).then(hit => hit || Response.error()))
  );
});
