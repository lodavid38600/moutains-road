#!/usr/bin/env node
// Assemble les collectes (OSM + Wikidata) en fichiers statiques pour le site :
//   data/meta.json       compteurs, régions, liste des tuiles, date
//   data/overview.json   objets remarquables (vue monde / zoom faible)
//   data/stats.json      statistiques précalculées
//   data/tiles/<lat>_<lon>.json   tous les objets, par tuile de 1°
//   data/geom/<lat>_<lon>.json    tracés + profils d'altitude des itinéraires
//   data/search/<lettre>.json     index de recherche par initiale de mot
//   data/catalog/<massif>.json    catalogue allégé d'un massif (page Explorer)
//   data/catalog/monde.json       sommets remarquables hors massifs collectés

import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { RAW_DIR, DATA_DIR, ROOT, readJson, writeJson, log } from './lib/util.mjs';
import { mergeWikidata, classify } from '../js/lib/normalize.js';
import { tileKey, distKm } from '../js/lib/geo.js';
import { estimateHours } from '../js/lib/categories.js';
import { decode } from '../js/lib/polyline.js';
import { mainLines, placesAlong, gridIndex, bboxOf } from '../js/lib/along.js';

async function listJson(dir) {
  try { return (await readdir(dir)).filter((f) => f.endsWith('.json')).map((f) => join(dir, f)); } catch { return []; }
}

const qualityRank = (q) => ({ great: 4, fine: 3, medium: 2, draft: 1 }[q] || 0);
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
// Wikidata écrit les noms français en minuscules (« mont Blanc ») : majuscule initiale.
for (const f of all) if (f.n && /^\p{Ll}/u.test(f.n)) f.n = f.n[0].toUpperCase() + f.n.slice(1);
for (const f of all) {
  classify(f); // règles de classement à jour, même pour des collectes plus anciennes
  const r = regionOf(f);
  if (r) f.r = r;
  if ((f.k === 'route' || f.k === 'ferrata') && f.km && !f.h) {
    const h = estimateHours(f.km, f.up, f.dn ?? f.up);
    if (h) f.h = Math.round(h * 10) / 10;
  }
  if (geoms.has(f.id)) {
    f.gm = 1;
    // Mini-profil (~32 altitudes) pour les fiches de liste.
    const p = geoms.get(f.id).p;
    if (p?.length > 4) {
      const n = 32, out = [];
      for (let i = 0; i < n; i++) out.push(p[Math.round((i * (p.length - 1)) / (n - 1))][1]);
      f.sp = out;
    }
  }
}
log(`Total : ${all.length} objets`);

// ---- Camptocamp : voies rattachées aux sommets ------------------------------
{
  const c2cSummits = new Map(), c2cRoutes = new Map();
  let c2cDates = [];
  for (const file of await listJson(join(RAW_DIR, 'c2c'))) {
    const chunk = await readJson(file);
    c2cDates.push(chunk.date);
    for (const x of chunk.summits || []) c2cSummits.set(x.id, x);
    for (const x of chunk.routes || []) c2cRoutes.set(x.id, x);
  }
  if (c2cSummits.size) {
    const peaksGrid = gridIndex(all.filter((f) => f.k === 'peak' || f.k === 'volcano'), 0.02);
    const match = new Map(); // id sommet c2c → feature
    for (const c of c2cSummits.values()) {
      const cands = peaksGrid([c.la - 0.01, c.lo - 0.012, c.la + 0.01, c.lo + 0.012]);
      let best = null, bd = Infinity;
      for (const f of cands) {
        const d = distKm(f.la, f.lo, c.la, c.lo);
        const sameName = f.n && c.n && norm(f.n) === norm(c.n);
        const score = sameName ? d : d + 0.4; // le même nom l'emporte à distance égale
        if ((sameName ? d < 0.8 : d < 0.25) && score < bd) { bd = score; best = f; }
      }
      if (best) match.set(c.id, best);
    }
    // Voie → sommet : même nom (title_prefix) et proche, sinon le sommet apparié le plus proche.
    const byName = new Map();
    for (const c of c2cSummits.values()) {
      const k = norm(c.n);
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(c);
    }
    let attached = 0;
    for (const r of c2cRoutes.values()) {
      if (r.la == null) continue;
      const cands = (byName.get(norm(r.s)) || []).filter((c) => distKm(c.la, c.lo, r.la, r.lo) < 4);
      const c = cands.sort((a, b) => distKm(a.la, a.lo, r.la, r.lo) - distKm(b.la, b.lo, r.la, r.lo))[0];
      const f = c && match.get(c.id);
      if (!f) continue;
      (f.c2c ||= []).push({
        id: r.id, t: r.t, a: r.a, up: r.up, emax: r.emax, emin: r.emin,
        g: r.g, hk: r.hk, rk: r.rk, vf: r.vf, sk: r.sk, o: r.o, d: r.d, q: r.q,
      });
      attached++;
    }
    // Sommet dont toutes les voies Camptocamp relèvent de l'alpinisme ou de l'escalade (aucune voie
    // de randonnée) et dont le meilleur sentier est déjà alpin : c'est un sommet d'alpinisme.
    const HIKE = new Set(['hiking', 'snowshoeing', 'mountain_biking']);
    const CLIMB = new Set(['mountain_climbing', 'snow_ice_mixed', 'rock_climbing', 'ice_climbing']);
    for (const f of all) {
      if (!f.c2c?.length || !['peak', 'volcano'].includes(f.k)) continue;
      const acts = f.c2c.flatMap((r) => r.a || []);
      if (acts.some((a) => HIKE.has(a)) || !acts.some((a) => CLIMB.has(a))) continue;
      if (!f.acc?.t || f.acc.t >= 4 || f.e >= 4000) { f.c = 'alpinisme'; f.c2cAlpi = 1; }
    }
    for (const f of all) if (f.c2c) {
      f.c2c.sort((a, b) => (qualityRank(b.q) - qualityRank(a.q)) || ((a.up || 9999) - (b.up || 9999)));
      f.nc = f.c2c.length;
    }
    log(`Camptocamp : ${c2cSummits.size} sommets (${match.size} appariés), ${attached}/${c2cRoutes.size} voies rattachées`);
  }
  var c2cDate = c2cDates.filter(Boolean).sort().pop() || null;
}

// ---- Lieux traversés par les itinéraires ------------------------------------
// Pour chaque itinéraire : sommets, cols et refuges à moins de 150 m du tracé, avec leur
// position (km) sur le profil. Pour chaque sommet : les itinéraires qui y passent.
{
  const byId = new Map(all.map((f) => [f.id, f]));
  const places = all.filter((f) => f.n && ['peak', 'volcano', 'col', 'hut', 'shelter'].includes(f.k));
  const near = gridIndex(places, 0.05);
  let links = 0;
  for (const f of all) {
    const g = f.gm && geoms.get(f.id);
    if (!g) continue;
    const lines = g.g.map((x) => decode(x));
    const [s, w, n, e] = bboxOf(lines);
    const main = mainLines(lines);
    const wp = placesAlong(main, near([s - 0.01, w - 0.01, n + 0.01, e + 0.01]), 0.15);
    g.wp = wp.map((x) => [x.id, x.km]);
    for (const { id } of wp) {
      const p = byId.get(id);
      if (!p || (p.k !== 'peak' && p.k !== 'volcano')) continue;
      (p.rts ||= []).push([f.id, f.la, f.lo]);
      links++;
    }
    f.np = wp.filter((x) => ['peak', 'volcano'].includes(byId.get(x.id)?.k)).length;
  }
  for (const p of places) if (p.rts) p.nr = p.rts.length;
  log(`${links} passages d'itinéraires par des sommets`);
}

// ---- Écriture --------------------------------------------------------------
await rm(join(DATA_DIR, 'tiles'), { recursive: true, force: true });
await rm(join(DATA_DIR, 'search'), { recursive: true, force: true });
await rm(join(DATA_DIR, 'geom'), { recursive: true, force: true });
await rm(join(DATA_DIR, 'catalog'), { recursive: true, force: true });

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

// Catalogues par massif (page Explorer) : champs utiles aux listes et aux filtres.
const CAT_KEYS = ['c2cAlpi', 'id', 'k', 'n', 'la', 'lo', 'e', 'emax', 'emin', 'c', 't', 'vf', 'km', 'up', 'dn', 'h', 'net', 'ref', 'loop', 'img', 'sl', 'pr', 'rg', 'cc', 'r', 'nr', 'np', 'nc', 'gm', 'sp'];
const catEntry = (f) => {
  const o = {};
  for (const k of CAT_KEYS) if (f[k] != null) o[k] = f[k];
  if (f.acc) o.acc = { t: f.acc.t, nw: f.acc.nw, vf: f.acc.vf };
  const tg = f.tg || {};
  if (tg.beds || tg.capacity) o.beds = tg.beds || tg.capacity;
  return o;
};
const inCatalog = (f) => f.n && ['route', 'ferrata', 'peak', 'volcano', 'col', 'hut', 'shelter', 'climbing'].includes(f.k);
for (const r of regions) {
  const list = all.filter((f) => f.r === r.id && inCatalog(f)).map(catEntry);
  if (list.length) await writeJson(join(DATA_DIR, 'catalog', `${r.id}.json`), list);
}
{
  const world = all.filter((f) => !f.r && (f.k === 'peak' || f.k === 'volcano') && f.n && (f.sl >= 5 || f.e >= 4000 || f.pr >= 1500))
    .sort((a, b) => (b.sl || 0) - (a.sl || 0)).slice(0, 8000).map(catEntry);
  await writeJson(join(DATA_DIR, 'catalog', 'monde.json'), world);
  log(`Catalogue monde : ${world.length} sommets`);
}

// Vue d'ensemble : sommets remarquables + grands itinéraires.
const slim = ({ tg, c2c, rts, ...rest }) => rest;
const notable = (f) =>
  ((f.k === 'peak' || f.k === 'volcano') && (f.sl >= 8 || f.e >= 4000 || f.pr >= 1500)) ||
  (f.k === 'route' && (f.net === 'iwn' || f.net === 'nwn')) ||
  (f.k === 'hut' && f.sl >= 1);
const overview = all.filter(notable).map(slim);
await writeJson(join(DATA_DIR, 'overview.json'), overview);
log(`Vue d'ensemble : ${overview.length} objets`);

// Index de recherche : [id, nom, type, lat, lon, alt, catégorie] rangé par initiale de chaque mot.
// Clé d'index : deux premiers caractères du mot (fichiers de quelques centaines de Ko).
const searchKey = (w) => (/^[a-z0-9]{2}/.test(w) ? w.slice(0, 2) : /[a-z]/.test(w[0]) ? w[0] : '0');
const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et', 'di', 'del', 'della', 'the', 'of', 'a', 'au', 'aux']);
const search = new Map();
for (const f of all) {
  if (!f.n) continue;
  const entry = [f.id, f.n, f.k, f.la, f.lo, f.e ?? f.emax ?? null, f.c ?? null, f.sl ?? 0, f.km ?? null, f.up ?? null];
  while (entry.length > 5 && entry[entry.length - 1] == null) entry.pop();
  const initials = new Set();
  for (const w of norm(f.n).split(' ')) if (w && !STOP.has(w)) initials.add(searchKey(w));
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
const netRank = (f) => ({ iwn: 4, nwn: 3, rwn: 2, lwn: 1 }[f.net] || 0);
const brief = (f) => ({ id: f.id, n: f.n, k: f.k, la: f.la, lo: f.lo, e: f.e, emax: f.emax, c: f.c, km: f.km, up: f.up, h: f.h, t: f.t, cc: f.cc, r: f.r, rg: f.rg, net: f.net, ref: f.ref, np: f.np, nr: f.nr, loop: f.loop, dn: f.dn, sp: f.sp });
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
  famous: all.filter((p) => p.sl && p.n && (!['peak', 'volcano'].includes(p.k) || p.e >= 1000 || p.pr >= 300)).sort((a, b) => b.sl - a.sl).slice(0, 100).map(brief),
  longest: routes.filter((r) => r.km && r.n).sort((a, b) => b.km - a.km).slice(0, 100).map(brief),
  biggestGain: routes.filter((r) => r.up && r.n).sort((a, b) => b.up - a.up).slice(0, 100).map(brief),
  byGain: count(routes.filter((r) => r.up != null), (r) => (r.up < 500 ? '< 500 m' : r.up < 800 ? '500–800 m' : r.up < 1200 ? '800–1 200 m' : r.up < 2000 ? '1 200–2 000 m' : '> 2 000 m')),
  // Sélections pour l'accueil.
  photoPeaks: peaks.filter((p) => p.img && p.n && (p.e >= 1000 || p.pr >= 300)).sort((a, b) => (b.sl || 0) - (a.sl || 0) || b.e - a.e).slice(0, 24).map((f) => ({ ...brief(f), img: f.img, sl: f.sl, pr: f.pr })),
  shortRoutes: routes.filter((r) => r.n && r.up != null && r.up < 800 && r.km >= 3 && r.km <= 20).sort((a, b) => netRank(b) - netRank(a) || (b.np || 0) - (a.np || 0) || b.up - a.up).slice(0, 24).map(brief),
  byCategoryTop: Object.fromEntries(['rando', 'montagne', 'alpine', 'alpinisme', 'ferrata'].map((c) => [c,
    routes.filter((r) => r.c === c && r.n && r.km).sort((a, b) => netRank(b) - netRank(a) || (b.np || 0) - (a.np || 0) || (b.up || 0) - (a.up || 0)).slice(0, 12).map(brief)])),
  hardest: routes.filter((r) => r.t >= 4 && r.n).sort((a, b) => (b.t - a.t) || ((b.km || 0) - (a.km || 0))).slice(0, 100).map(brief),
};
await writeJson(join(DATA_DIR, 'stats.json'), stats);

const latest = (arr) => arr.filter(Boolean).sort().pop() || null;
await writeJson(join(DATA_DIR, 'meta.json'), {
  generated: new Date().toISOString(),
  osmDate: latest(osmDates),
  wikidataDate: latest(wdDates),
  c2cDate,
  total: all.length,
  byKind: stats.byKind,
  byCategory: stats.byCategory,
  regions: stats.regions.map(({ id, name, bbox, total, byKind }) => ({ id, name, bbox, total, byKind })),
  tiles: tileCounts,
  searchKeys: [...search.keys()].sort(),
}, true);
log('data/ prêt ✔');
