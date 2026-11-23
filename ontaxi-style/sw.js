// Service worker: приложение открывается мгновенно с иконки, оболочка берётся из кэша.
// Карта, адреса и маршруты всегда идут из сети.
const CACHE = 'ontaxi-style-v7';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/maplibre-gl@5.24.1/dist/maplibre-gl.css',
  'https://unpkg.com/maplibre-gl@5.24.1/dist/maplibre-gl.js',
  'https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') {                       // страница: сначала сеть (свежая версия), иначе кэш
    e.respondWith(fetch(req).then(r => {
      const copy = r.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); return r;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  if (url.hostname === 'unpkg.com' || url.origin === location.origin) {   // библиотеки и иконки: из кэша
    e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
  }
});
