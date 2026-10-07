// Service worker : chargement rapide et consultation hors ligne des zones déjà visitées.
//  - interface (HTML, CSS, JS, bibliothèques) : servie depuis le cache, mise à jour en arrière-plan ;
//  - données (data/…) : réseau d'abord, cache en secours (utile sans réseau en montagne).
const SHELL = 'mr-shell-v2';
const DATA = 'mr-data-v1';
const SHELL_FILES = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest', 'assets/icon.svg',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'vendor/markercluster/leaflet.markercluster.js', 'vendor/markercluster/MarkerCluster.css',
  'js/api.js',
  'js/app.js',
  'js/charts.js',
  'js/components/cards.js',
  'js/components/detail-common.js',
  'js/components/photos.js',
  'js/components/profile.js',
  'js/components/weather.js',
  'js/data.js',
  'js/dem-browser.js',
  'js/lib/along.js',
  'js/lib/ascent.js',
  'js/lib/categories.js',
  'js/lib/dem.js',
  'js/lib/geo.js',
  'js/lib/normalize.js',
  'js/lib/overpass.js',
  'js/lib/polyline.js',
  'js/lightbox.js',
  'js/map.js',
  'js/pages/explore.js',
  'js/pages/home.js',
  'js/pages/info.js',
  'js/pages/map.js',
  'js/pages/massif.js',
  'js/pages/peak.js',
  'js/pages/place.js',
  'js/pages/route.js',
  'js/router.js',
  'js/util.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/data/')) {
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(DATA).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || Response.error())));
    return;
  }
  // Interface : cache puis mise à jour en arrière-plan.
  e.respondWith(caches.open(SHELL).then(async (c) => {
    const cached = await c.match(e.request, { ignoreSearch: true });
    const network = fetch(e.request).then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; }).catch(() => null);
    return cached || (await network) || (await c.match('index.html')) || Response.error();
  }));
});
