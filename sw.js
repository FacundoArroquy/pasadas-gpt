/* Pasadas GPS - Service Worker */
const CACHE_NAME = 'pasadas-pwa-v2';
const APP_SHELL = [
  './',
  './index.html',
  './main.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  // Leaflet from CDN (versions pinned)
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k!==CACHE_NAME && caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Cache-first for app shell & Leaflet
  if (request.method === 'GET' && (
      request.url.includes(self.registration.scope) ||
      request.url.includes('unpkg.com/leaflet'))) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const fresh = await fetch(request);
        cache.put(request, fresh.clone());
        return fresh;
      } catch {
        return cached || Response.error();
      }
    })());
    return;
  }

  // Runtime cache (stale-while-revalidate) for OSM tiles (be polite)
  if (request.url.includes('tile.openstreetmap.org')) {
    event.respondWith((async () => {
      const cache = await caches.open('osm-tiles');
      const cached = await cache.match(request);
      const network = fetch(request).then(resp => { cache.put(request, resp.clone()); return resp; }).catch(() => cached);
      return cached || network;
    })());
    return;
  }
});
