// VFR Planner ZA — service worker
// Strategy: NETWORK-FIRST for the app's own files, so a new deploy is picked up
// immediately when online, while still working offline (falls back to cache).
// Map tiles, the Leaflet CDN, and the weather function are never cache-served.
const CACHE = 'vfrza-v2';
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
  // pre-cache the shell, and take over right away
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  // drop any old caches (e.g. vfrza-v1) so stale code can't linger
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never intercept: map tiles, Leaflet CDN, the weather function, or any
  // external API — these must always go straight to the network.
  if (url.hostname.includes('tile.openstreetmap.org') ||
      url.hostname.includes('cdnjs.cloudflare.com') ||
      url.pathname === '/wx' || url.pathname.startsWith('/wx?') ||
      url.pathname.includes('/.netlify/functions/') ||
      url.hostname.includes('aviationweather.gov') ||
      url.hostname.includes('open-meteo.com') ||
      url.hostname.includes('allorigins') ) {
    return; // let the browser handle it normally
  }

  // App shell: NETWORK-FIRST. Try the network, update the cache with the fresh
  // copy, and only fall back to cache if the network is unavailable (offline).
  e.respondWith(
    fetch(e.request)
      .then(resp => {
        // cache a copy of successful same-origin responses for offline use
        if (resp && resp.status === 200 && url.origin === self.location.origin) {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return resp;
      })
      .catch(() =>
        caches.match(e.request).then(hit =>
          hit || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined)
        )
      )
  );
});
