// Données chargées (collecte statique + mode direct) et filtres.
import { fetchJson, normText } from './util.js';
import { tileKey, tilesForBbox } from './lib/geo.js';
import { runOverpass, routesQuery, poisQuery } from './lib/overpass.js';
import { parseOverpass, applyMetrics } from './lib/normalize.js';
import { routeMetrics } from './lib/dem.js';
import { browserDem } from './dem-browser.js';

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const emit = (what) => listeners.forEach((fn) => fn(what));

export const store = {
  meta: null,          // data/meta.json (null si aucune collecte)
  features: new Map(), // id → feature
  loadedTiles: new Set(),
  pendingTiles: new Map(),
  liveAreas: [],       // bbox déjà chargées en direct
  searchCache: new Map(),
  geoms: new Map(),    // id → { g: [polylines encodées], p: profil } (tracés chargés)
  geomTiles: new Map(),
};

/** Catégories mises en avant sur l'accueil (boutons). */
export const MAIN_CATS = ['rando', 'montagne', 'alpine', 'alpinisme', 'ferrata'];

export const DEFAULT_FILTERS = () => ({
  cats: new Set(),                     // vide = toutes les catégories (et les lieux sans catégorie)
  kinds: new Set(['route', 'ferrata', 'peak', 'volcano', 'hut', 'climbing']),
  tMin: 1, tMax: 6,
  upMin: null, upMax: null,            // D+ (m)
  kmMin: null, kmMax: null,
  hMax: null,                          // durée max (h)
  eMin: null, eMax: null,              // altitude (sommet ou point culminant)
  nets: new Set(),
  loop: false,
  named: true, photo: false, wiki: false,
});

/** Nombre de filtres avancés actifs (pastille du bouton Filtres). */
export function activeFilterCount(F = filters) {
  const D = DEFAULT_FILTERS();
  let n = 0;
  if ([...D.kinds].some((k) => !F.kinds.has(k)) || [...F.kinds].some((k) => !D.kinds.has(k))) n++;
  if (F.tMin !== 1 || F.tMax !== 6) n++;
  for (const k of ['upMin', 'upMax', 'kmMin', 'kmMax', 'hMax', 'eMin', 'eMax']) if (F[k] != null) n++;
  if (F.nets.size) n++;
  for (const k of ['loop', 'photo', 'wiki']) if (F[k]) n++;
  if (!F.named) n++;
  return n;
}
export let filters = DEFAULT_FILTERS();
export function setFilters(next) { filters = next; emit('filters'); }
export function filtersChanged() { emit('filters'); }

function add(list, src) {
  let n = 0;
  for (const f of list) {
    const prev = store.features.get(f.id);
    // Une version complète (tuile / direct) remplace la version allégée de la vue d'ensemble.
    if (!prev || (f.tg && !prev.tg) || src === 'live') {
      if (src) f.src = src;
      store.features.set(f.id, prev && !f.tg ? { ...prev, ...f } : f);
      n++;
    }
  }
  return n;
}

export async function loadMeta() {
  try {
    store.meta = await fetchJson('data/meta.json');
  } catch {
    store.meta = null;
  }
  if (store.meta) {
    try { add(await fetchJson('data/overview.json'), 'overview'); } catch { /* facultatif */ }
  }
  emit('data');
  return store.meta;
}

export function hasTile(key) { return !!store.meta?.tiles?.[key]; }

export async function loadTile(key) {
  if (store.loadedTiles.has(key) || !hasTile(key)) return 0;
  if (store.pendingTiles.has(key)) return store.pendingTiles.get(key);
  const p = fetchJson(`data/tiles/${key}.json`).then((list) => {
    store.loadedTiles.add(key);
    store.pendingTiles.delete(key);
    return add(list, 'tile');
  }).catch(() => { store.pendingTiles.delete(key); return 0; });
  store.pendingTiles.set(key, p);
  return p;
}

/** Charge les tuiles visibles (bbox = [s, w, n, e]). */
export async function loadTilesForBbox(bbox, max = 40) {
  if (!store.meta) return 0;
  const keys = tilesForBbox(bbox).filter((k) => hasTile(k) && !store.loadedTiles.has(k)).slice(0, max);
  if (!keys.length) return 0;
  const added = (await Promise.all(keys.map(loadTile))).reduce((a, b) => a + b, 0);
  if (added) emit('data');
  return added;
}

/** Garantit qu'une feature (connue par son id + position) est chargée. */
export async function ensureFeature(id, la, lo) {
  if (store.features.has(id)) return store.features.get(id);
  if (la != null) await loadTile(tileKey(la, lo));
  emit('data');
  return store.features.get(id) || null;
}

/** La zone a-t-elle des données collectées ? */
export function bboxCovered(bbox) {
  return tilesForBbox(bbox).some(hasTile);
}

/**
 * Interroge OpenStreetMap en direct pour une zone (navigateur → Overpass),
 * puis calcule le dénivelé de chaque itinéraire avec le modèle de terrain.
 */
export async function loadLive(bbox, { signal, onProgress } = {}) {
  onProgress?.('Itinéraires…');
  const routes = parseOverpass(await runOverpass(routesQuery(bbox, 180), { signal, retries: 1 }), { peakAccess: false });
  onProgress?.('Sommets, refuges, via ferrata…');
  const pois = parseOverpass(await runOverpass(poisQuery(bbox, 180), { signal, retries: 1 }));
  const list = [...routes.features, ...pois.features];
  const n = add(list, 'live');
  store.liveAreas.push(bbox);
  emit('data');
  // Dénivelé, en tâche de fond (les itinéraires s'enrichissent au fur et à mesure).
  let i = 0;
  for (const f of routes.features) {
    const ways = routes.routeWays.get(f.id);
    if (!ways || signal?.aborted) continue;
    try {
      const m = await routeMetrics(ways, browserDem());
      if (m) {
        const cur = store.features.get(f.id) || f;
        applyMetrics(cur, m);
        cur.gm = 1;
        store.geoms.set(f.id, { g: m.geom, p: m.profile });
      }
    } catch { /* MNT indisponible : on garde la distance seule */ }
    if (++i % 15 === 0) { onProgress?.(`Dénivelé ${i}/${routes.features.length}…`); emit('data'); }
  }
  emit('data');
  return { total: list.length, added: n };
}

/** Tracé + profil d'un itinéraire : cache, fichier statique, ou calcul en direct. */
export async function routeGeometry(f) {
  if (store.geoms.has(f.id)) return store.geoms.get(f.id);
  if (f.gm && store.meta) {
    const key = tileKey(f.la, f.lo);
    let tile = store.geomTiles.get(key);
    if (!tile) {
      tile = fetchJson(`data/geom/${key}.json`).catch(() => ({}));
      store.geomTiles.set(key, tile);
    }
    const g = (await tile)[f.id];
    if (g) { store.geoms.set(f.id, g); return g; }
  }
  return null;
}

export function liveCovered([s, w, n, e]) {
  return store.liveAreas.some(([S, W, N, E]) => s >= S && w >= W && n <= N && e <= E);
}

// ---------------------------------------------------------------- filtres
export const isRoute = (f) => f.k === 'route' || f.k === 'ferrata';
/** Altitude de référence : sommet, ou point culminant d'un itinéraire. */
export const altOf = (f) => f.e ?? f.emax ?? null;

export function matches(f, F = filters) {
  if (!F.kinds.has(f.k)) return false;
  if (F.cats.size && !F.cats.has(f.c)) return false;
  if (F.named && !f.n) return false;
  if (F.photo && !f.img) return false;
  if (F.wiki && !f.wp) return false;
  const t = f.t || f.acc?.t;
  if (F.tMin > 1 || F.tMax < 6) {
    if (!t || t < F.tMin || t > F.tMax) return false;
  }
  const alt = altOf(f);
  if (F.eMin != null && !(alt >= F.eMin)) return false;
  if (F.eMax != null && !(alt <= F.eMax)) return false;
  const routeOnly = F.upMin != null || F.upMax != null || F.kmMin != null || F.kmMax != null || F.hMax != null || F.nets.size || F.loop;
  if (!isRoute(f)) return !routeOnly;
  if (F.upMin != null && !(f.up >= F.upMin)) return false;
  if (F.upMax != null && !(f.up <= F.upMax)) return false;
  if (F.kmMin != null && !(f.km >= F.kmMin)) return false;
  if (F.kmMax != null && !(f.km <= F.kmMax)) return false;
  if (F.hMax != null && !(f.h <= F.hMax)) return false;
  if (F.nets.size && !F.nets.has(f.net || 'autre')) return false;
  if (F.loop && !f.loop) return false;
  return true;
}

export function filtered(bbox = null) {
  const out = [];
  for (const f of store.features.values()) {
    if (bbox && !(f.la >= bbox[0] && f.la <= bbox[2] && f.lo >= bbox[1] && f.lo <= bbox[3])) continue;
    if (matches(f)) out.push(f);
  }
  return out;
}

export function counts(list, key) {
  const m = {};
  for (const f of list) { const k = key(f); m[k] = (m[k] || 0) + 1; }
  return m;
}

// ---------------------------------------------------------------- recherche
const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et', 'di', 'del', 'della', 'the', 'of', 'a', 'au', 'aux']);

/** Recherche dans l'index statique + les objets chargés. Renvoie des entrées légères. */
export async function search(q, limit = 25) {
  const words = normText(q).split(' ').filter((w) => w && !STOP.has(w));
  if (!words.length) return [];
  const results = new Map();
  const test = (name) => {
    const nw = normText(name).split(' ');
    return words.every((w) => nw.some((x) => x.startsWith(w)));
  };
  // Objets déjà chargés (dont mode direct).
  for (const f of store.features.values()) {
    if (f.n && test(f.n)) results.set(f.id, { id: f.id, n: f.n, k: f.k, la: f.la, lo: f.lo, e: altOf(f), c: f.c, sl: f.sl || 0, km: f.km, up: f.up });
  }
  // Index statique, rangé par initiale.
  const key = /[a-z]/.test(words[0][0]) ? words[0][0] : '0';
  if (store.meta?.searchKeys?.includes(key)) {
    let idx = store.searchCache.get(key);
    if (!idx) {
      idx = await fetchJson(`data/search/${key}.json`).catch(() => []);
      store.searchCache.set(key, idx);
    }
    for (const [id, n, k, la, lo, e, c, sl, kmv, up] of idx) {
      if (results.size >= 400) break;
      if (!results.has(id) && test(n)) results.set(id, { id, n, k, la, lo, e, c, sl, km: kmv, up });
    }
  }
  const qn = normText(q);
  return [...results.values()]
    .map((r) => ({ ...r, score: (normText(r.n) === qn ? 1e6 : 0) + (normText(r.n).startsWith(qn) ? 1e5 : 0) + (r.sl || 0) * 100 + (r.e || 0) / 100 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Lieux (villes, vallées…) via Nominatim, pour naviguer. */
export async function searchPlaces(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=fr&q=${encodeURIComponent(q)}`;
  try {
    const list = await fetchJson(url);
    return list.map((p) => ({ name: p.display_name, la: +p.lat, lo: +p.lon, bbox: p.boundingbox?.map(Number), type: p.type }));
  } catch { return []; }
}
