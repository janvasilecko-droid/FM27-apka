/* Service worker samostatné verze: aplikace se otevře i bez připojení (kromě volání AI a čtečky PDF z cdnjs,
   kterou si pamatuje po prvním použití). Nová verze se projeví při dalším otevření: stránka se stahuje nejdřív ze sítě. */
const CACHE = 'fm27-coach-__BUILD__';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('fm27-coach-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const pdfjs = url.hostname === 'cdnjs.cloudflare.com' && url.pathname.includes('/pdf.js/');
  if (!sameOrigin && !pdfjs) return; // volání AI a písma neřešíme
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./') : Response.error())))
  );
});
