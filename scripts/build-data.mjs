#!/usr/bin/env node
// Assemble les collectes (OSM + Wikidata) en fichiers statiques pour le site :
//   data/meta.json       compteurs, régions, liste des tuiles, date
//   data/overview.json   objets remarquables (vue monde / zoom faible)
//   data/stats.json      statistiques précalculées
//   data/tiles/<lat>_<lon>.json   tous les objets, par tuile de 1°
//   data/geom/<lat>_<lon>.json    tracés + profils d'altitude des itinéraires
//   data/search/<lettre>.json     index de recherche par initiale de mot

import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { RAW_DIR, DATA_DIR, ROOT, readJson, writeJson, log } from './lib/util.mjs';
import { mergeWikidata, classify } from '../js/lib/normalize.js';
import { tileKey, distKm } from '../js/lib/geo.js';
import { estimateHours } from '../js/lib/categories.js';

async function listJson(dir) {
  try { return (await readdir(dir)).filter((f) => f.endsWith('.json')).map((f) => join(dir, f)); } catch { return []; }
}

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const { regions } = await readJson(join(ROOT, 'scripts', 'regions.json'));
const inBbox = (f, [s, w, n, e]) => f.la >= s && f.la <= n && f.lo >= w && f.lo <= e;
const regionOf = (f) => regions.find((r) => inBbox(f, r.bbox))?.id;

// ---- OSM -------------------------------------------------------------------
const osm = new Map();
const geoms = new Map();
let osmDates = [];
for (const kind of ['pois', 'routes']) {
  for (const file of await listJson(join(RAW_DIR, 'osm', kind))) {
    const chunk = await readJson(file);
    osmDates.push(chunk.date);
    for (const f of chunk.features) {
      const prev = osm.get(f.id);
      // Une même relation peut apparaître dans plusieurs cellules : on garde la plus complète.
      if (!prev || (f.ts?.length || 0) >= (prev.ts?.length || 0)) osm.set(f.id, f);
    }
    for (const [id, g] of Object.entries(chunk.geom || {})) geoms.set(id, g);
  }
}
log(`OSM : ${osm.size} objets`);

// Via ferrata découpées en plusieurs chemins : on ne garde qu'un objet par nom et zone.
{
  const seen = [];
  for (const f of osm.values()) {
    if (f.k !== 'ferrata' || !f.id.startsWith('w')) continue;
    const key = norm(f.n);
    if (!key) { osm.delete(f.id); continue; } // tronçon anonyme
    const dup = seen.find((g) => g.key === key && distKm(g.f.la, g.f.lo, f.la, f.lo) < 2);
    if (dup) {
      if (f.vf > (dup.f.vf ?? -1)) dup.f.vf = f.vf;
      osm.delete(f.id);
    } else seen.push({ key, f });
  }
  // Une relation via ferrata existe déjà ? on retire les chemins homonymes proches.
  for (const f of osm.values()) {
    if (f.k !== 'ferrata' || !f.id.startsWith('r')) continue;
    for (const g of seen) if (g.key === norm(f.n) && distKm(g.f.la, g.f.lo, f.la, f.lo) < 3) osm.delete(g.f.id);
  }
}

// ---- Wikidata --------------------------------------------------------------
const wd = new Map();
let wdDates = [];
for (const file of await listJson(join(RAW_DIR, 'wikidata'))) {
  const chunk = await readJson(file);
  wdDates.push(chunk.date);
  for (const f of chunk.features) {
    const prev = wd.get(f.id);
    if (prev) { prev.cc2 = [...new Set([...(prev.cc2 || [prev.cc]), f.cc])]; continue; }
    wd.set(f.id, f);
  }
}
log(`Wikidata : ${wd.size} objets`);

// ---- Fusion ----------------------------------------------------------------
const used = new Set();
for (const f of osm.values()) {
  if (f.wd && wd.has(f.wd)) { mergeWikidata(f, wd.get(f.wd)); used.add(f.wd); }
}
// Rapprochement par nom + proximité pour les sommets OSM sans lien Wikidata.
const grid = new Map();
const gkey = (la, lo) => `${Math.floor(la * 20)}_${Math.floor(lo * 20)}`;
for (const f of osm.values()) {
  if (!['peak', 'volcano', 'col'].includes(f.k) || !f.n) continue;
  const k = gkey(f.la, f.lo);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(f);
}
let matched = 0;
for (const w of wd.values()) {
  if (used.has(w.id) || !w.n) continue;
  const name = norm(w.n);
  const gl = Math.floor(w.la * 20), go = Math.floor(w.lo * 20);
  let best = null;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    for (const f of grid.get(`${gl + a}_${go + b}`) || []) {
      if (f.wd || norm(f.n) !== name) continue;
      const d = distKm(f.la, f.lo, w.la, w.lo);
      if (d < 1 && (!best || d < best.d)) best = { f, d };
    }
  }
  if (best) { mergeWikidata(best.f, w); used.add(w.id); matched++; }
}
log(`Fusion : ${used.size} liens Wikidata (dont ${matched} par nom/proximité)`);

const all = [...osm.values()];
for (const w of wd.values()) if (!used.has(w.id)) { classify(w); all.push(w); }
for (const f of all) {
  const r = regionOf(f);
  if (r) f.r = r;
  if ((f.k === 'route' || f.k === 'ferrata') && f.km && !f.h) {
    const h = estimateHours(f.km, f.up, f.dn ?? f.up);
    if (h) f.h = Math.round(h * 10) / 10;
  }
  if (geoms.has(f.id)) f.gm = 1;
}
log(`Total : ${all.length} objets`);

// ---- Écriture --------------------------------------------------------------
await rm(join(DATA_DIR, 'tiles'), { recursive: true, force: true });
await rm(join(DATA_DIR, 'search'), { recursive: true, force: true });
await rm(join(DATA_DIR, 'geom'), { recursive: true, force: true });

const tiles = new Map();
for (const f of all) {
  const k = tileKey(f.la, f.lo);
  if (!tiles.has(k)) tiles.set(k, []);
  tiles.get(k).push(f);
}
const tileCounts = {};
for (const [k, list] of tiles) {
  tileCounts[k] = list.length;
  await writeJson(join(DATA_DIR, 'tiles', `${k}.json`), list);
}
log(`${tiles.size} tuiles écrites`);

// Tracés et profils, rangés dans la tuile du point de départ de l'itinéraire.
const geomTiles = new Map();
for (const f of all) {
  const g = f.gm && geoms.get(f.id);
  if (!g) continue;
  const k = tileKey(f.la, f.lo);
  if (!geomTiles.has(k)) geomTiles.set(k, {});
  geomTiles.get(k)[f.id] = g;
}
for (const [k, obj] of geomTiles) await writeJson(join(DATA_DIR, 'geom', `${k}.json`), obj);
log(`${geoms.size} tracés (${geomTiles.size} fichiers)`);

// Vue d'ensemble : sommets remarquables + grands itinéraires.
const slim = ({ tg, ...rest }) => rest;
const notable = (f) =>
  ((f.k === 'peak' || f.k === 'volcano') && (f.sl >= 8 || f.e >= 4000 || f.pr >= 1500)) ||
  (f.k === 'route' && (f.net === 'iwn' || f.net === 'nwn')) ||
  (f.k === 'hut' && f.sl >= 1);
const overview = all.filter(notable).map(slim);
await writeJson(join(DATA_DIR, 'overview.json'), overview);
log(`Vue d'ensemble : ${overview.length} objets`);

// Index de recherche : [id, nom, type, lat, lon, alt, catégorie] rangé par initiale de chaque mot.
const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et', 'di', 'del', 'della', 'the', 'of', 'a', 'au', 'aux']);
const search = new Map();
for (const f of all) {
  if (!f.n) continue;
  const entry = [f.id, f.n, f.k, f.la, f.lo, f.e ?? f.emax ?? null, f.c ?? null, f.sl ?? 0, f.km ?? null, f.up ?? null];
  const initials = new Set();
  for (const w of norm(f.n).split(' ')) if (w && !STOP.has(w)) initials.add(/[a-z]/.test(w[0]) ? w[0] : '0');
  for (const i of initials) {
    if (!search.has(i)) search.set(i, []);
    search.get(i).push(entry);
  }
}
for (const [i, list] of search) {
  list.sort((a, b) => (b[7] - a[7]) || ((b[5] ?? 0) - (a[5] ?? 0)));
  await writeJson(join(DATA_DIR, 'search', `${i}.json`), list);
}

// Statistiques.
const count = (arr, fn) => arr.reduce((m, f) => { const k = fn(f); if (k != null) m[k] = (m[k] || 0) + 1; return m; }, {});
const peaks = all.filter((f) => (f.k === 'peak' || f.k === 'volcano') && f.e);
const routes = all.filter((f) => f.k === 'route' || f.k === 'ferrata');
const brief = (f) => ({ id: f.id, n: f.n, k: f.k, la: f.la, lo: f.lo, e: f.e, emax: f.emax, c: f.c, km: f.km, up: f.up, h: f.h, t: f.t, cc: f.cc, r: f.r, rg: f.rg, net: f.net, ref: f.ref });
const altBands = {};
for (const p of peaks) {
  const b = Math.min(8500, Math.floor(p.e / 500) * 500);
  altBands[b] = (altBands[b] || 0) + 1;
}
const stats = {
  byKind: count(all, (f) => f.k),
  byCategory: count(all, (f) => f.c),
  bySac: count(routes, (f) => f.t || 0),
  byNetwork: count(routes, (f) => f.net || 'autre'),
  peaksByAltitude: altBands,
  peaksByCountry: Object.fromEntries(Object.entries(count(peaks, (f) => f.cc)).sort((a, b) => b[1] - a[1]).slice(0, 40)),
  regions: regions.map((r) => {
    const list = all.filter((f) => f.r === r.id);
    return { id: r.id, name: r.name, bbox: r.bbox, total: list.length, byKind: count(list, (f) => f.k), byCategory: count(list, (f) => f.c) };
  }),
  highest: peaks.filter((p) => p.n).sort((a, b) => b.e - a.e).slice(0, 100).map(brief),
  famous: all.filter((p) => p.sl && p.n).sort((a, b) => b.sl - a.sl).slice(0, 100).map(brief),
  longest: routes.filter((r) => r.km && r.n).sort((a, b) => b.km - a.km).slice(0, 100).map(brief),
  biggestGain: routes.filter((r) => r.up && r.n).sort((a, b) => b.up - a.up).slice(0, 100).map(brief),
  byGain: count(routes.filter((r) => r.up != null), (r) => (r.up < 500 ? '< 500 m' : r.up < 800 ? '500–800 m' : r.up < 1200 ? '800–1 200 m' : r.up < 2000 ? '1 200–2 000 m' : '> 2 000 m')),
  hardest: routes.filter((r) => r.t >= 4 && r.n).sort((a, b) => (b.t - a.t) || ((b.km || 0) - (a.km || 0))).slice(0, 100).map(brief),
};
await writeJson(join(DATA_DIR, 'stats.json'), stats);

const latest = (arr) => arr.filter(Boolean).sort().pop() || null;
await writeJson(join(DATA_DIR, 'meta.json'), {
  generated: new Date().toISOString(),
  osmDate: latest(osmDates),
  wikidataDate: latest(wdDates),
  total: all.length,
  byKind: stats.byKind,
  byCategory: stats.byCategory,
  regions: stats.regions.map(({ id, name, bbox, total }) => ({ id, name, bbox, total })),
  tiles: tileCounts,
  searchKeys: [...search.keys()].sort(),
}, true);
log('data/ prêt ✔');
