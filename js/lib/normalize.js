// Conversion des réponses Overpass en « features » compactes et homogènes,
// utilisées telles quelles par le site.
//
// Schéma d'une feature :
//  id   identifiant unique : n123 / w123 / r123 (OSM) ou Q123 (Wikidata seul)
//  k    type (voir KINDS)          n    nom
//  la   latitude                   lo   longitude
//  e    altitude (m)               c    catégorie d'activité (voir CATEGORIES)
//  t    niveau SAC max (1–6)       ts   niveaux SAC rencontrés [..]
//  vf   cotation via ferrata (0–6)
//  km   longueur (km)              up / dn  dénivelé positif / négatif (m)
//  net  réseau (iwn/nwn/rwn/lwn)   ref  numéro (GR 5, …)
//  wd   identifiant Wikidata       wp   article Wikipedia (« fr:Titre »)
//  img  fichier Wikimedia Commons  pr   proéminence (m)
//  rg   massif / chaîne            cc   code pays
//  sl   nombre d'articles Wikipedia (notoriété)
//  acc  accès sommet : { t: niveau SAC, hw: [types de chemins], nw: nb chemins }
//  tg   tags OSM utiles (objet)

import { distKm } from './geo.js';
import {
  parseSacList, parseFerrataList, parseMeters, parseDistanceKm, categoryFromSac, estimateHours,
} from './categories.js';

/** Altitude à partir de laquelle un sommet sans sentier est considéré comme de l'alpinisme. */
export const ALPINE_ALT = 2500;

/** Tags OSM conservés dans `tg` (le reste est trop technique ou redondant). */
const KEEP_TAGS = [
  'name', 'name:fr', 'name:en', 'name:de', 'name:it', 'alt_name', 'old_name', 'official_name',
  'description', 'description:fr', 'note', 'inscription',
  'ele', 'prominence', 'summit:cross', 'summit:register',
  'sac_scale', 'trail_visibility', 'via_ferrata_scale', 'climbing:grade:uiaa', 'climbing:grade:french',
  'climbing:grade:french:min', 'climbing:grade:french:max', 'climbing:routes', 'climbing:length',
  'climbing:rock', 'climbing:sport', 'climbing:trad', 'climbing:boulder', 'climbing:toprope',
  'climbing:multipitch', 'climbing:ice', 'climbing:orientation',
  'distance', 'ascent', 'descent', 'roundtrip', 'from', 'to', 'via', 'network', 'ref', 'osmc:symbol',
  'symbol', 'colour', 'operator', 'website', 'url', 'contact:website', 'phone', 'contact:phone',
  'email', 'contact:email', 'opening_hours', 'capacity', 'beds', 'fee', 'reservation',
  'access', 'seasonal', 'fireplace', 'drinking_water', 'toilets', 'shower', 'heating',
  'wikipedia', 'wikidata', 'wikimedia_commons', 'image', 'mapillary', 'start_date',
  'shelter_type', 'tourism', 'natural', 'mountain_pass', 'direction', 'survey_point',
  'route', 'state', 'duration', 'source:ele', 'historic', 'protect_class',
];

function pickTags(tags) {
  const out = {};
  for (const k of KEEP_TAGS) if (tags[k] != null && tags[k] !== '') out[k] = tags[k];
  return out;
}

function frName(tags) {
  return tags['name:fr'] || tags.name || tags['name:en'] || tags['official_name'] || null;
}

function coords(el) {
  if (el.lat != null) return [el.lat, el.lon];
  if (el.center) return [el.center.lat, el.center.lon];
  return [null, null];
}

const round = (n, d = 5) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);
const prefix = { node: 'n', way: 'w', relation: 'r' };

function kindOf(el) {
  const t = el.tags || {};
  if (el.type === 'relation' && t.type === 'route') {
    return t.route === 'via_ferrata' ? 'ferrata' : 'route';
  }
  if (t.highway === 'via_ferrata') return 'ferrata';
  if (t.natural === 'volcano') return 'volcano';
  if (t.natural === 'peak') return 'peak';
  if (t.natural === 'saddle' || t.mountain_pass === 'yes') return 'col';
  if (t.tourism === 'alpine_hut') return 'hut';
  if (t.tourism === 'wilderness_hut' || t.amenity === 'shelter') return 'shelter';
  if (t.sport === 'climbing') return 'climbing';
  if (t.tourism === 'viewpoint') return 'viewpoint';
  if (t.natural === 'glacier') return 'glacier';
  return null;
}

function isIndoorClimbing(t) {
  return t.leisure === 'sports_centre' || t.leisure === 'fitness_centre' || t.indoor === 'yes' ||
    t.building || t.climbing === 'gym' || /indoor|salle/i.test(t['climbing:type'] || '');
}

function wikiRef(t) {
  if (t.wikipedia) return t.wikipedia;
  for (const l of ['fr', 'en', 'de', 'it', 'es']) if (t[`wikipedia:${l}`]) return `${l}:${t[`wikipedia:${l}`]}`;
  return null;
}

function commonsFile(t) {
  const v = t.wikimedia_commons || (/^File:/i.test(t.image || '') ? t.image : null);
  if (v && /^File:/i.test(v)) return v.replace(/^File:/i, '');
  return null;
}

/** Élément OSM → feature (ou null si non pertinent). */
export function featureFromOsm(el) {
  const t = el.tags || {};
  const k = kindOf(el);
  if (!k) return null;
  if (k === 'climbing' && isIndoorClimbing(t)) return null;
  const [la, lo] = coords(el);
  if (la == null) return null;
  const f = { id: prefix[el.type] + el.id, k, n: frName(t), la: round(la), lo: round(lo) };
  const ele = parseMeters(t.ele);
  if (ele != null && ele > -500 && ele < 9000) f.e = ele;
  if (t.wikidata && /^Q\d+$/.test(t.wikidata)) f.wd = t.wikidata;
  const wp = wikiRef(t);
  if (wp) f.wp = wp;
  const img = commonsFile(t);
  if (img) f.img = img;
  const pr = parseMeters(t.prominence);
  if (pr) f.pr = pr;

  if (k === 'route' || k === 'ferrata') {
    if (t.network) f.net = t.network;
    if (t.ref) f.ref = t.ref;
    const km = parseDistanceKm(t.distance);
    if (km) f.km = Math.round(km * 10) / 10;
    const up = parseMeters(t.ascent);
    if (up) f.up = up;
    const dn = parseMeters(t.descent);
    if (dn) f.dn = dn;
    if (!f.n) f.n = [t.ref, t.from && t.to ? `${t.from} → ${t.to}` : null].filter(Boolean).join(' · ') || null;
  }

  // Difficulté portée directement par l'objet.
  const sac = parseSacList(t.sac_scale);
  if (sac.length) f.t = Math.max(...sac);
  const vf = parseFerrataList(t.via_ferrata_scale);
  if (vf.length) f.vf = Math.max(...vf);

  f.tg = pickTags(t);
  classify(f);
  return f;
}

/** Statistiques d'un itinéraire à partir des tags de ses chemins. */
function applyRouteStats(f, ways) {
  let len = 0;
  const sac = [], vf = [], vis = new Set();
  for (const w of ways) {
    const g = w.geometry;
    for (let i = 1; i < g.length; i++) len += distKm(g[i - 1].lat, g[i - 1].lon, g[i].lat, g[i].lon);
    const t = w.tags || {};
    sac.push(...parseSacList(t.sac_scale));
    vf.push(...parseFerrataList(t.via_ferrata_scale));
    if (t.trail_visibility) vis.add(t.trail_visibility);
  }
  if (!f.km && len > 0) f.km = Math.round(len * 10) / 10;
  if (sac.length) {
    f.ts = [...new Set(sac)].sort();
    f.t = Math.max(f.t || 0, ...sac);
  }
  if (vf.length) f.vf = Math.max(f.vf ?? 0, ...vf);
  if (vis.size) f.vis = [...vis];
  classify(f);
}

/** Distance (km) d'un point à une polyligne [{lat, lon}] (projection locale). */
function distToLine(la, lo, g) {
  const kx = 111.32 * Math.cos((la * Math.PI) / 180), ky = 110.57;
  let best = Infinity;
  for (let i = 1; i < g.length; i++) {
    const ax = (g[i - 1].lon - lo) * kx, ay = (g[i - 1].lat - la) * ky;
    const bx = (g[i].lon - lo) * kx, by = (g[i].lat - la) * ky;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  if (g.length === 1) best = Math.hypot((g[0].lon - lo) * kx, (g[0].lat - la) * ky);
  return best;
}

/** Accès au sommet : chemins à moins de 150 m. */
export function applyPeakAccess(f, ways) {
  const sac = [], hw = new Set(), vf = [];
  for (const w of ways) {
    const t = w.tags || {};
    hw.add(t.highway);
    const levels = parseSacList(t.sac_scale);
    // Piste, escalier ou chemin piéton sans cotation : accès facile.
    if (!levels.length && /^(track|footway|steps|bridleway)$/.test(t.highway)) levels.push(1);
    sac.push(...levels);
    if (t.highway === 'via_ferrata') vf.push(...parseFerrataList(t.via_ferrata_scale), 0);
  }
  f.acc = { nw: ways.length, hw: [...hw].filter(Boolean) };
  // Le chemin le plus facile détermine l'accès (on peut monter par la voie normale).
  if (sac.length) f.acc.t = Math.min(...sac);
  if (vf.length) f.acc.vf = Math.max(...vf);
  classify(f);
}

/**
 * Catégorie d'activité (c) :
 *  - itinéraires : selon la difficulté SAC maximale / via ferrata ;
 *  - sommets : selon le chemin le plus facile qui y mène (à < 150 m) ;
 *    sans chemin cartographié, on ne devine pas (sauf glaciers / T6 tagués).
 */
export function classify(f) {
  delete f.c;
  if (f.k === 'ferrata') { f.c = 'ferrata'; return f; }
  if (f.k === 'climbing') { f.c = 'escalade'; return f; }
  if (f.k === 'route') {
    if (f.vf != null && (!f.t || f.t <= 4)) f.c = 'ferrata';
    else f.c = categoryFromSac(f.t) || 'rando';
    return f;
  }
  if (f.k === 'peak' || f.k === 'volcano' || f.k === 'col') {
    if (f.acc) {
      if (f.acc.t) f.c = categoryFromSac(f.acc.t);
      else if (f.acc.vf != null) f.c = 'ferrata';
      else if (f.acc.nw > 0) f.c = 'rando'; // chemin sans cotation SAC
      // Aucun chemin à < 150 m : alpinisme en haute montagne, simple hors-sentier ailleurs.
      else if (f.e >= ALPINE_ALT) f.c = 'alpinisme';
    } else if (f.t) {
      f.c = categoryFromSac(f.t);
    }
  }
  return f;
}

/**
 * Analyse une réponse Overpass (routesQuery / poisQuery) :
 *  - features : objets normalisés ;
 *  - routeWays : Map id d'itinéraire → chemins [[lat, lon], …] (pour le dénivelé).
 */
export function parseOverpass(json, { peakAccess = true } = {}) {
  const byId = new Map();
  const geomWays = new Map();
  const members = new Map();
  for (const el of json.elements || []) {
    if (el.type === 'way' && el.geometry) { geomWays.set(el.id, el); continue; }
    const f = featureFromOsm(el);
    if (!f) continue;
    byId.set(f.id, f);
    if (el.type === 'relation' && el.members) {
      members.set(f.id, el.members.filter((m) => m.type === 'way' && !/platform|stop|guidepost|start|finish/.test(m.role || '')).map((m) => m.ref));
    }
  }

  const routeWays = new Map();
  for (const [rid, refs] of members) {
    const ways = refs.map((r) => geomWays.get(r)).filter((w) => w && w.geometry.length > 1 && w.geometry.every(Boolean));
    if (!ways.length) continue;
    applyRouteStats(byId.get(rid), ways);
    routeWays.set(rid, ways.map((w) => w.geometry.map((p) => [p.lat, p.lon])));
  }

  if (peakAccess && geomWays.size) {
    // Index spatial grossier (cases de 0,01°) des chemins.
    const grid = new Map();
    const key = (la, lo) => `${Math.floor(la * 100)}_${Math.floor(lo * 100)}`;
    for (const w of geomWays.values()) {
      const cells = new Set(w.geometry.map((p) => key(p.lat, p.lon)));
      for (const c of cells) { if (!grid.has(c)) grid.set(c, []); grid.get(c).push(w); }
    }
    for (const f of byId.values()) {
      if ((f.k !== 'peak' && f.k !== 'volcano') || !f.n) continue;
      const near = new Set();
      const gl = Math.floor(f.la * 100), go = Math.floor(f.lo * 100);
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
        for (const w of grid.get(`${gl + a}_${go + b}`) || []) near.add(w);
      }
      applyPeakAccess(f, [...near].filter((w) => distToLine(f.la, f.lo, w.geometry) <= 0.15));
    }
  }
  return { features: [...byId.values()], routeWays };
}

export const featuresFromOverpass = (json) => parseOverpass(json).features;

/** Fusionne les infos d'une feature Wikidata (w) dans une feature OSM (f). */
export function mergeWikidata(f, w) {
  for (const key of ['e', 'pr', 'img', 'rg', 'cc', 'sl', 'wp', 'n']) {
    if (w[key] != null && f[key] == null) f[key] = w[key];
  }
  f.wd = w.id;
  return f;
}

/**
 * Applique les métriques calculées sur le tracé (routeMetrics) à un itinéraire.
 * Les valeurs saisies dans OSM (distance, ascent, descent) restent prioritaires.
 */
export function applyMetrics(f, m) {
  if (!m) return f;
  const tg = f.tg || {};
  if (!parseDistanceKm(tg.distance) && m.kmMain) f.km = m.kmMain;
  const upTag = parseMeters(tg.ascent), dnTag = parseMeters(tg.descent);
  if (upTag) { f.up = upTag; f.upSrc = 'osm'; } else if (m.up != null) { f.up = m.up; f.upSrc = 'mnt'; }
  if (dnTag) f.dn = dnTag; else if (m.dn != null) f.dn = m.dn;
  if (m.emax != null) f.emax = m.emax;
  if (m.emin != null) f.emin = m.emin;
  if (m.loop || tg.roundtrip === 'yes') f.loop = true;
  const h = estimateHours(f.km, f.up, f.dn);
  if (h) f.h = Math.round(h * 10) / 10;
  return f;
}
