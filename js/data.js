// Accès aux données : collecte statique (data/…) et compléments en direct
// (OpenStreetMap / Wikidata) pour tout ce qui n'a pas été collecté.
import { fetchJson, normText } from './util.js';
import { tileKey, tilesForBbox } from './lib/geo.js';
import { runOverpass, routesQuery, poisQuery } from './lib/overpass.js';
import { parseOverpass, featureFromOsm, applyMetrics, classify } from './lib/normalize.js';
import { routeMetrics } from './lib/dem.js';
import { browserDem } from './dem-browser.js';

export const db = {
  meta: undefined,     // data/meta.json (null si aucune collecte)
  features: new Map(), // id → feature complète
  tiles: new Map(),    // clé → Promise
  catalogs: new Map(), // massif → Promise<liste>
  geoms: new Map(),    // id → { g, p, wp }
  geomTiles: new Map(),
  stats: null,
  liveAreas: [],
};

const listeners = new Set();
export const onData = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => fn());

export const isRoute = (f) => f?.k === 'route' || f?.k === 'ferrata';
export const isPeak = (f) => f?.k === 'peak' || f?.k === 'volcano';
export const altOf = (f) => f?.e ?? f?.emax ?? null;

/** Lien vers la page d'un objet (avec position pour retrouver sa tuile). */
export function hrefFor(f) {
  const page = isPeak(f) ? 'sommet' : isRoute(f) ? 'itineraire' : 'lieu';
  return `#/${page}/${encodeURIComponent(f.id)}?ll=${f.la},${f.lo}`;
}

export async function loadMeta() {
  if (db.meta !== undefined) return db.meta;
  try { db.meta = await fetchJson('data/meta.json'); } catch { db.meta = null; }
  return db.meta;
}

export async function loadStats() {
  if (db.stats) return db.stats;
  if (!(await loadMeta())) return null;
  db.stats = await fetchJson('data/stats.json').catch(() => null);
  return db.stats;
}

function add(list, src) {
  let n = 0;
  for (const f of list) {
    const prev = db.features.get(f.id);
    if (!prev || (f.tg && !prev.tg) || src === 'live') {
      if (src) f.src = src;
      db.features.set(f.id, prev && !f.tg ? { ...prev, ...f } : f);
      n++;
    }
  }
  return n;
}

export const hasTile = (key) => !!db.meta?.tiles?.[key];

export function loadTile(key) {
  if (!hasTile(key)) return Promise.resolve(0);
  if (!db.tiles.has(key)) {
    db.tiles.set(key, fetchJson(`data/tiles/${key}.json`).then((l) => add(l, 'tile')).catch(() => { db.tiles.delete(key); return 0; }));
  }
  return db.tiles.get(key);
}

export async function loadTilesForBbox(bbox, max = 40) {
  if (!(await loadMeta())) return 0;
  const keys = tilesForBbox(bbox).filter(hasTile).slice(0, max);
  const n = (await Promise.all(keys.map(loadTile))).reduce((a, b) => a + b, 0);
  if (n) emit();
  return n;
}

let overview;
export async function loadOverview() {
  if (!(await loadMeta())) return;
  overview ||= fetchJson('data/overview.json').then((l) => { add(l, 'overview'); emit(); }).catch(() => {});
  return overview;
}

/** Objets chargés dans une bbox [s, w, n, e]. */
export function featuresIn([s, w, n, e]) {
  const out = [];
  for (const f of db.features.values()) if (f.la >= s && f.la <= n && f.lo >= w && f.lo <= e) out.push(f);
  return out;
}

/**
 * Retrouve un objet par identifiant : données chargées, tuile collectée,
 * puis OpenStreetMap / Wikidata en direct.
 */
export async function getFeature(id, la, lo) {
  if (db.features.get(id)?.tg || (db.features.has(id) && !/^[nwr]\d+$/.test(id))) return db.features.get(id);
  await loadMeta();
  if (la != null && isFinite(la)) {
    await loadTile(tileKey(la, lo));
    if (db.features.has(id)) return db.features.get(id);
  }
  if (/^[nwr]\d+$/.test(id)) return fetchOsmFeature(id);
  if (/^Q\d+$/.test(id)) return fetchWikidataFeature(id);
  return null;
}

async function fetchOsmFeature(id) {
  const type = { n: 'node', w: 'way', r: 'rel' }[id[0]];
  const num = id.slice(1);
  let json;
  if (type === 'rel') json = await runOverpass(`[out:json][timeout:60];rel(${num});out center;way(r);out geom;`, { retries: 2 });
  else if (type === 'way') json = await runOverpass(`[out:json][timeout:60];way(${num});out tags center;`, { retries: 2 });
  else json = await runOverpass(`[out:json][timeout:60];node(${num});out;`, { retries: 2 });
  const { features, routeWays } = parseOverpass(json, { peakAccess: false });
  const f = features.find((x) => x.id === id);
  if (!f) return null;
  f.src = 'live';
  const ways = routeWays.get(id);
  if (ways) {
    try {
      const m = await routeMetrics(ways, browserDem());
      if (m) { applyMetrics(f, m); f.gm = 1; db.geoms.set(id, { g: m.geom, p: m.profile }); }
    } catch { /* MNT indisponible */ }
  }
  db.features.set(id, f);
  return f;
}

async function fetchWikidataFeature(q) {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${q}&props=claims|sitelinks|labels|descriptions&languages=fr|en&format=json&origin=*`;
  const e = (await fetchJson(url)).entities?.[q];
  const claim = (p) => e?.claims?.[p]?.[0]?.mainsnak?.datavalue?.value;
  const coord = claim('P625');
  if (!coord) return null;
  const qty = (p) => { const v = claim(p); return v ? Math.round(parseFloat(v.amount)) : null; };
  const sl = e.sitelinks || {};
  const f = {
    id: q, k: 'peak', n: e.labels?.fr?.value || e.labels?.en?.value, la: coord.latitude, lo: coord.longitude,
    e: qty('P2044'), pr: qty('P2660'), img: claim('P18') || undefined,
    wp: sl.frwiki ? `fr:${sl.frwiki.title}` : sl.enwiki ? `en:${sl.enwiki.title}` : undefined,
    sl: Object.keys(sl).filter((k) => k.endsWith('wiki')).length, src: 'live',
  };
  classify(f);
  db.features.set(q, f);
  return f;
}

/** Catalogue d'un massif (liste allégée pour la page Explorer). */
export function loadCatalog(region) {
  if (!db.catalogs.has(region)) {
    db.catalogs.set(region, loadMeta().then((m) => (m ? fetchJson(`data/catalog/${region}.json`) : [])).catch(() => []));
  }
  return db.catalogs.get(region);
}

/** Tracé + profil + lieux traversés d'un itinéraire. */
export async function routeGeometry(f) {
  if (db.geoms.has(f.id)) return db.geoms.get(f.id);
  if (f.gm && (await loadMeta())) {
    const key = tileKey(f.la, f.lo);
    if (!db.geomTiles.has(key)) db.geomTiles.set(key, fetchJson(`data/geom/${key}.json`).catch(() => ({})));
    const g = (await db.geomTiles.get(key))[f.id];
    if (g) { db.geoms.set(f.id, g); return g; }
  }
  return null;
}

/** Données OSM en direct pour une zone (hors massifs collectés), dénivelés compris. */
export async function loadLive(bbox, { signal, onProgress } = {}) {
  onProgress?.('itinéraires…');
  const routes = parseOverpass(await runOverpass(routesQuery(bbox, 180), { signal, retries: 1 }), { peakAccess: false });
  onProgress?.('sommets, refuges, via ferrata…');
  const pois = parseOverpass(await runOverpass(poisQuery(bbox, 180), { signal, retries: 1 }));
  const list = [...routes.features, ...pois.features];
  add(list, 'live');
  db.liveAreas.push(bbox);
  emit();
  let i = 0;
  for (const f of routes.features) {
    const ways = routes.routeWays.get(f.id);
    if (!ways || signal?.aborted) continue;
    try {
      const m = await routeMetrics(ways, browserDem());
      if (m) { const cur = db.features.get(f.id) || f; applyMetrics(cur, m); cur.gm = 1; db.geoms.set(f.id, { g: m.geom, p: m.profile }); }
    } catch { /* */ }
    if (++i % 15 === 0) { onProgress?.(`dénivelés ${i}/${routes.features.length}…`); emit(); }
  }
  emit();
  return list.length;
}
export const liveCovered = ([s, w, n, e]) => db.liveAreas.some(([S, W, N, E]) => s >= S && w >= W && n <= N && e <= E);
export const bboxCovered = (bbox) => tilesForBbox(bbox).some(hasTile);

// ---------------------------------------------------------------- recherche
const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et', 'di', 'del', 'della', 'the', 'of', 'a', 'au', 'aux']);
const searchCache = new Map();

export async function search(q, limit = 12) {
  const words = normText(q).split(' ').filter((w) => w && !STOP.has(w));
  if (!words.length) return [];
  const results = new Map();
  const test = (name) => { const nw = normText(name).split(' '); return words.every((w) => nw.some((x) => x.startsWith(w))); };
  for (const f of db.features.values()) {
    if (f.n && test(f.n)) results.set(f.id, { id: f.id, n: f.n, k: f.k, la: f.la, lo: f.lo, e: altOf(f), c: f.c, sl: f.sl || 0, km: f.km, up: f.up });
  }
  const key = /[a-z]/.test(words[0][0]) ? words[0][0] : '0';
  if ((await loadMeta())?.searchKeys?.includes(key)) {
    if (!searchCache.has(key)) searchCache.set(key, fetchJson(`data/search/${key}.json`).catch(() => []));
    for (const [id, n, k, la, lo, e, c, sl, km, up] of await searchCache.get(key)) {
      if (results.size >= 400) break;
      if (!results.has(id) && test(n)) results.set(id, { id, n, k, la, lo, e, c, sl, km, up });
    }
  }
  const qn = normText(q);
  return [...results.values()]
    .map((r) => ({ ...r, score: (normText(r.n) === qn ? 1e6 : 0) + (normText(r.n).startsWith(qn) ? 1e5 : 0) + (r.sl || 0) * 100 + (r.e || 0) / 100 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function searchPlaces(q) {
  try {
    const list = await fetchJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=fr&q=${encodeURIComponent(q)}`);
    return list.map((p) => ({ name: p.display_name, la: +p.lat, lo: +p.lon, bbox: p.boundingbox?.map(Number) }));
  } catch { return []; }
}

export { featureFromOsm };
