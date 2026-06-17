// VFR Planner ZA — service worker (offline caching of app shell)
const CACHE = 'vfrza-v1';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './airports.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './favicon-32.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Always go to network for map tiles & the Leaflet CDN (don't cache the whole world)
  if (url.hostname.includes('tile.openstreetmap.org') || url.hostname.includes('cdnjs.cloudflare.com')) {
    return; // let the browser handle it normally
  }
  // App shell: cache-first, fall back to network, then to cached index for navigations
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).catch(() => {
      if (e.request.mode === 'navigate') return caches.match('./index.html');
    }))
  );
});
