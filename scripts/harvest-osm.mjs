#!/usr/bin/env node
// Collecte OpenStreetMap (via Overpass) de tous les massifs de scripts/regions.json :
// itinéraires de randonnée (+ difficulté, longueur), sommets (+ accès), cols,
// refuges, abris, via ferrata, sites d'escalade, points de vue, glaciers.
//
// Le dénivelé (D+/D−), l'altitude max et le profil de chaque itinéraire sont
// calculés à partir du tracé et du modèle de terrain Terrarium (AWS Open Data) ;
// les tags OSM ascent/descent restent prioritaires quand ils existent.
//
// Usage : node scripts/harvest-osm.mjs [--regions=alpes-nord,pyrenees] [--max-age=30] [--concurrency=2] [--no-dem]
// Les résultats (déjà normalisés) sont mis en cache dans .cache/raw/osm/ :
// relancer la commande reprend là où elle s'était arrêtée.

import { join } from 'node:path';
import { routesQuery, poisQuery, runOverpass } from '../js/lib/overpass.js';
import { parseOverpass, applyMetrics } from '../js/lib/normalize.js';
import { routeMetrics } from '../js/lib/dem.js';
import { createDem } from './lib/dem-node.mjs';
import { splitBbox, quarter } from '../js/lib/geo.js';
import { ROOT, RAW_DIR, USER_AGENT, readJson, writeJson, log, args, sleep } from './lib/util.mjs';
import { stat } from 'node:fs/promises';

const opts = args();
const MAX_AGE_DAYS = Number(opts['max-age'] ?? 30);
const CONCURRENCY = Number(opts.concurrency ?? 2);
const MAX_DEPTH = 3;
const NO_DEM = !!opts['no-dem'];
const dem = NO_DEM ? null : createDem({ maxTiles: 600 });

const { regions: allRegions } = await readJson(join(ROOT, 'scripts', 'regions.json'));
const wanted = opts.regions && opts.regions !== 'all' ? String(opts.regions).split(',').map((s) => s.trim()) : null;
const regions = wanted ? allRegions.filter((r) => wanted.includes(r.id)) : allRegions;
if (!regions.length) {
  console.error('Aucune région ne correspond. Régions disponibles :', allRegions.map((r) => r.id).join(', '));
  process.exit(1);
}

const QUERIES = { routes: routesQuery, pois: poisQuery };

async function fresh(path) {
  try { return Date.now() - (await stat(path)).mtimeMs < MAX_AGE_DAYS * 86400e3; } catch { return false; }
}

/**
 * Interroge Overpass ; si la zone est trop lourde, la découpe en 4.
 * Renvoie { features, routeWays }.
 */
async function fetchCell(kind, bbox, depth = 0) {
  try {
    const json = await runOverpass(QUERIES[kind](bbox), {
      userAgent: USER_AGENT,
      retries: depth === MAX_DEPTH ? 4 : 2,
      log: (m) => log(`   ⚠ ${kind} ${bbox.join(',')} : ${m}`),
    });
    return parseOverpass(json, { peakAccess: kind === 'pois' });
  } catch (e) {
    if (depth >= MAX_DEPTH) throw e;
    log(`   ↳ découpage de ${kind} ${bbox.join(',')} (${e.message.slice(0, 120)})`);
    const features = new Map(), routeWays = new Map();
    for (const q of quarter(bbox)) {
      const r = await fetchCell(kind, q, depth + 1);
      for (const f of r.features) features.set(f.id, f);
      for (const [k, v] of r.routeWays) routeWays.set(k, v);
    }
    return { features: [...features.values()], routeWays };
  }
}

/** D+/D−, altitudes et tracé de chaque itinéraire (une seule fois par relation). */
const metricsDone = new Map(); // id → { geom, profile, metrics } calculés pendant cette exécution
async function computeRoutes(features, routeWays) {
  const geom = {};
  for (const f of features) {
    const ways = routeWays.get(f.id);
    if (!ways) continue;
    let m = metricsDone.get(f.id);
    if (!m) {
      try { m = await routeMetrics(ways, dem); } catch (e) { log(`   ⚠ dénivelé ${f.id} : ${e.message}`); m = null; }
      if (m) metricsDone.set(f.id, m);
    }
    if (!m) continue;
    applyMetrics(f, m);
    geom[f.id] = { g: m.geom, p: m.profile };
  }
  return geom;
}

const jobs = [];
for (const region of regions) {
  for (const cell of splitBbox(region.bbox, region.step || 1)) {
    for (const kind of Object.keys(QUERIES)) jobs.push({ region, cell, kind });
  }
}

log(`${regions.length} région(s), ${jobs.length} requêtes à effectuer (cache : ${MAX_AGE_DAYS} j)`);
let done = 0, failed = 0, skipped = 0;
const failures = [];

async function worker(n) {
  while (jobs.length) {
    const { region, cell, kind } = jobs.shift();
    const path = join(RAW_DIR, 'osm', kind, `${cell.join('_')}.json`);
    if (await fresh(path)) { skipped++; continue; }
    const t0 = Date.now();
    try {
      const { features, routeWays } = await fetchCell(kind, cell);
      const geom = kind === 'routes' ? await computeRoutes(features, routeWays) : undefined;
      await writeJson(path, { region: region.id, bbox: cell, kind, date: new Date().toISOString(), features, geom });
      done++;
      log(`✓ [w${n}] ${region.id} ${kind} ${cell.join(',')} : ${features.length} objets (${((Date.now() - t0) / 1000).toFixed(0)} s) — reste ${jobs.length}`);
    } catch (e) {
      failed++;
      failures.push(`${region.id} ${kind} ${cell.join(',')}: ${e.message}`);
      log(`✗ [w${n}] ${region.id} ${kind} ${cell.join(',')} : ${e.message}`);
    }
    await sleep(1500);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));
log(`Terminé : ${done} requêtes OK, ${skipped} déjà en cache, ${failed} échecs.`);
if (failures.length) {
  console.log('Échecs (relancez la commande pour réessayer) :\n  ' + failures.join('\n  '));
  if (failed > (done + skipped) / 2) process.exitCode = 1;
}
