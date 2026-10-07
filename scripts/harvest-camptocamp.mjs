#!/usr/bin/env node
// Collecte Camptocamp (topoguide collaboratif, licence CC BY-SA) : sommets et voies
// (randonnée, alpinisme, escalade, via ferrata…) des massifs de scripts/regions.json.
// Les voies sont ensuite rattachées aux sommets OpenStreetMap / Wikidata à l'assemblage.
//
// L'API n'accepte pas les appels depuis un autre site (navigateur) : la collecte se fait ici.
// Usage : node scripts/harvest-camptocamp.mjs [--regions=alpes-nord] [--max-age=30]

import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { splitBbox } from '../js/lib/geo.js';
import { ROOT, RAW_DIR, USER_AGENT, readJson, writeJson, log, args, sleep } from './lib/util.mjs';

const API = 'https://api.camptocamp.org';
const opts = args();
const MAX_AGE_DAYS = Number(opts['max-age'] ?? 30);
const DEADLINE = Number(process.env.DEADLINE_C2C || process.env.DEADLINE || 0) * 1000;
const PAGE = 100;
const MAX_OFFSET = 9900; // au-delà, l'API refuse : on découpe la zone

const { regions: allRegions } = await readJson(join(ROOT, 'scripts', 'regions.json'));
const wanted = opts.regions && opts.regions !== 'all' ? String(opts.regions).split(',') : null;
const regions = wanted ? allRegions.filter((r) => wanted.includes(r.id)) : allRegions;

// Web Mercator (EPSG:3857) ↔ WGS84
const R = 6378137;
const toMerc = (lat, lon) => [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
const fromMerc = (x, y) => [Math.round((Math.atan(Math.exp(y / R)) * 360 / Math.PI - 90) * 1e5) / 1e5, Math.round(x / R * 180 / Math.PI * 1e5) / 1e5];
const bboxParam = ([s, w, n, e]) => [...toMerc(s, w), ...toMerc(n, e)].map((v) => Math.round(v)).join(',');

async function get(path, attempt = 0) {
  try {
    const res = await fetch(API + path, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`), { fatal: true });
    return await res.json();
  } catch (e) {
    if (e.fatal || attempt >= 4) throw e;
    await sleep(3000 * (attempt + 1));
    return get(path, attempt + 1);
  }
}

const locale = (d) => d.locales?.find((l) => l.lang === 'fr') || d.locales?.[0] || {};
const point = (d) => {
  try {
    const c = JSON.parse(d.geometry?.geom || 'null')?.coordinates;
    return c ? fromMerc(c[0], c[1]) : null;
  } catch { return null; }
};

/** Toutes les pages d'une liste ; renvoie null si la zone est trop grande (à découper). */
async function listAll(kind, query, bbox) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    if (offset > MAX_OFFSET) return null;
    const j = await get(`/${kind}?${query}&bbox=${bboxParam(bbox)}&pl=fr&limit=${PAGE}&offset=${offset}`);
    out.push(...(j.documents || []));
    if (offset === 0 && j.total > MAX_OFFSET + PAGE) return null;
    if (!j.documents?.length || out.length >= j.total) break;
    await sleep(400);
  }
  return out;
}

async function harvestCell(bbox, depth = 0) {
  const summits = await listAll('waypoints', 'wtyp=summit', bbox);
  const routes = summits && await listAll('routes', '', bbox);
  if (!summits || !routes) {
    if (depth >= 3) throw new Error('zone trop dense');
    const [s, w, n, e] = bbox, ml = (s + n) / 2, mo = (w + e) / 2;
    const parts = [[s, w, ml, mo], [s, mo, ml, e], [ml, w, n, mo], [ml, mo, n, e]];
    const res = { summits: [], routes: [] };
    for (const p of parts) { const r = await harvestCell(p, depth + 1); res.summits.push(...r.summits); res.routes.push(...r.routes); }
    return res;
  }
  return {
    summits: summits.map((d) => {
      const p = point(d);
      return p && { id: d.document_id, n: locale(d).title, e: d.elevation, la: p[0], lo: p[1] };
    }).filter(Boolean),
    routes: routes.map((d) => {
      const l = locale(d), p = point(d);
      return {
        id: d.document_id,
        t: l.title, s: l.title_prefix, la: p?.[0], lo: p?.[1],
        a: d.activities, up: d.height_diff_up, dn: d.height_diff_down,
        emax: d.elevation_max, emin: d.elevation_min, q: d.quality,
        g: d.global_rating, hk: d.hiking_rating, rk: d.rock_free_rating, vf: d.via_ferrata_rating,
        sk: d.ski_rating, snow: d.snowshoe_rating, o: d.orientations, d: d.durations,
      };
    }),
  };
}

async function fresh(path) {
  try { return Date.now() - (await stat(path)).mtimeMs < MAX_AGE_DAYS * 86400e3; } catch { return false; }
}

let nS = 0, nR = 0;
for (const region of regions) {
  for (const cell of splitBbox(region.bbox, 1)) {
    if (DEADLINE && Date.now() > DEADLINE) { log('Heure limite atteinte : reprise à la prochaine exécution.'); process.exit(0); }
    const path = join(RAW_DIR, 'c2c', `${cell.join('_')}.json`);
    if (await fresh(path)) continue;
    try {
      const r = await harvestCell(cell);
      await writeJson(path, { region: region.id, bbox: cell, date: new Date().toISOString(), ...r });
      nS += r.summits.length; nR += r.routes.length;
      log(`✓ ${region.id} ${cell.join(',')} : ${r.summits.length} sommets, ${r.routes.length} voies`);
    } catch (e) {
      log(`✗ ${region.id} ${cell.join(',')} : ${e.message}`);
    }
  }
}
log(`Terminé : ${nS} sommets, ${nR} voies Camptocamp.`);
