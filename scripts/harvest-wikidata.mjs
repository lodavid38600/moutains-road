#!/usr/bin/env node
// Collecte Wikidata (monde entier) : montagnes, sommets, volcans, cols et
// collines, avec altitude, proéminence, photo, massif, pays, articles Wikipedia
// et notoriété (nombre d'articles). Une requête par pays, découpée
// automatiquement si Wikidata dépasse son délai.
//
// Usage : node scripts/harvest-wikidata.mjs [--countries=FR,CH,IT] [--max-age=30]

import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { RAW_DIR, USER_AGENT, writeJson, log, args, sleep } from './lib/util.mjs';

const ENDPOINT = 'https://query.wikidata.org/sparql';
const opts = args();
const MAX_AGE_DAYS = Number(opts['max-age'] ?? 30);

/** Classes Wikidata collectées → type de feature. */
const TYPES = {
  Q8502: 'peak',     // montagne
  Q207326: 'peak',   // sommet
  Q8072: 'volcano',  // volcan
  Q169358: 'volcano',// stratovolcan
  Q133056: 'col',    // col de montagne
  Q54050: 'peak',    // colline (filtrée ensuite : altitude ≥ 500 m ou notoriété)
};

async function sparql(query, attempt = 0) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/sparql-results+json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'query=' + encodeURIComponent(query),
    signal: AbortSignal.timeout(120000),
  });
  if (res.status === 429 || res.status === 503 || res.status === 502) {
    if (attempt >= 6) throw new Error(`HTTP ${res.status}`);
    const wait = (Number(res.headers.get('retry-after')) || 30 * (attempt + 1)) * 1000;
    log(`   … Wikidata HTTP ${res.status}, nouvelle tentative dans ${wait / 1000} s`);
    await sleep(wait);
    return sparql(query, attempt + 1);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200).replace(/\s+/g, ' ')}`);
  try { return JSON.parse(text).results.bindings; } catch {
    throw new Error('Réponse tronquée (délai dépassé)');
  }
}

function peaksQuery(countryQ, types, partition = '') {
  const values = types.map((t) => 'wd:' + t).join(' ');
  const part = partition ? `FILTER(STRENDS(STR(?item), "${partition}"))` : '';
  return `SELECT ?item (SAMPLE(?type) AS ?t) (SAMPLE(?coord) AS ?c) (MAX(?ele) AS ?e) (MAX(?prom) AS ?p)
  (SAMPLE(?img) AS ?i) (SAMPLE(?rangeL) AS ?r) (SAMPLE(?lfr) AS ?nfr) (SAMPLE(?len) AS ?nen) (SAMPLE(?lmul) AS ?nmul)
  (SAMPLE(?frT) AS ?wfr) (SAMPLE(?enT) AS ?wen) (MAX(?links) AS ?sl)
WHERE {
  VALUES ?type { ${values} }
  ?item wdt:P31 ?type ; wdt:P17 wd:${countryQ} ; wdt:P625 ?coord .
  ${part}
  OPTIONAL { ?item p:P2044/psn:P2044/wikibase:quantityAmount ?ele }
  OPTIONAL { ?item p:P2660/psn:P2660/wikibase:quantityAmount ?prom }
  OPTIONAL { ?item wdt:P18 ?img }
  OPTIONAL { ?item wdt:P4552 ?range . ?range rdfs:label ?rangeL . FILTER(LANG(?rangeL) = "fr") }
  OPTIONAL { ?item rdfs:label ?lfr . FILTER(LANG(?lfr) = "fr") }
  OPTIONAL { ?item rdfs:label ?len . FILTER(LANG(?len) = "en") }
  OPTIONAL { ?item rdfs:label ?lmul . FILTER(LANG(?lmul) = "mul") }
  OPTIONAL { ?frA schema:about ?item ; schema:isPartOf <https://fr.wikipedia.org/> ; schema:name ?frT }
  OPTIONAL { ?enA schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?enT }
  OPTIONAL { ?item wikibase:sitelinks ?links }
}
GROUP BY ?item`;
}

const val = (b, k) => b[k]?.value;

function rowToFeature(b, cc) {
  const m = /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(val(b, 'c') || '');
  if (!m) return null;
  const typeQ = val(b, 't')?.split('/').pop();
  const f = {
    id: val(b, 'item').split('/').pop(),
    k: TYPES[typeQ] || 'peak',
    n: val(b, 'nfr') || val(b, 'nmul') || val(b, 'nen') || null,
    la: Math.round(+m[2] * 1e5) / 1e5,
    lo: Math.round(+m[1] * 1e5) / 1e5,
    cc,
  };
  const e = parseFloat(val(b, 'e'));
  if (isFinite(e) && e > -500 && e < 9000) f.e = Math.round(e);
  const p = parseFloat(val(b, 'p'));
  if (isFinite(p) && p > 0) f.pr = Math.round(p);
  const img = val(b, 'i');
  if (img) f.img = decodeURIComponent(img.split('/Special:FilePath/').pop()).replace(/_/g, ' ');
  if (val(b, 'r')) f.rg = val(b, 'r');
  if (val(b, 'wfr')) f.wp = 'fr:' + val(b, 'wfr');
  else if (val(b, 'wen')) f.wp = 'en:' + val(b, 'wen');
  const sl = parseInt(val(b, 'sl'), 10);
  if (sl) f.sl = sl;
  if (typeQ === 'Q54050' && !(f.e >= 500) && !(f.sl >= 2)) return null; // petites collines
  return f;
}

/** Requête avec découpage automatique (par type, puis par partition d'identifiant). */
async function fetchCountry(q, cc, types = Object.keys(TYPES), partition = '') {
  try {
    const rows = await sparql(peaksQuery(q, types, partition));
    return rows.map((b) => rowToFeature(b, cc)).filter(Boolean);
  } catch (e) {
    if (types.length > 1) {
      log(`   ↳ ${cc} : découpage par type (${e.message.slice(0, 80)})`);
      const out = [];
      for (const t of types) out.push(...await fetchCountry(q, cc, [t], partition));
      return out;
    }
    if (partition.length < 2) {
      log(`   ↳ ${cc} ${types[0]} : découpage en 10 partitions${partition ? ' (' + partition + ')' : ''}`);
      const out = [];
      for (let d = 0; d < 10; d++) out.push(...await fetchCountry(q, cc, types, d + partition));
      return out;
    }
    throw e;
  }
}

async function fresh(path) {
  try { return Date.now() - (await stat(path)).mtimeMs < MAX_AGE_DAYS * 86400e3; } catch { return false; }
}

log('Liste des pays…');
const countryRows = await sparql(`SELECT DISTINCT ?c ?code WHERE {
  VALUES ?cls { wd:Q6256 wd:Q3624078 }
  ?c wdt:P31 ?cls ; wdt:P297 ?code .
  FILTER NOT EXISTS { ?c wdt:P576 ?end }
}`);
const countries = new Map();
for (const b of countryRows) {
  const code = val(b, 'code');
  if (!countries.has(code)) countries.set(code, val(b, 'c').split('/').pop());
}
let list = [...countries.entries()].sort();
if (opts.countries) {
  const want = String(opts.countries).toUpperCase().split(',');
  list = list.filter(([cc]) => want.includes(cc));
}
log(`${list.length} pays à interroger`);

// Heure limite (secondes epoch) : la suite sera collectée à la prochaine exécution.
const DEADLINE = Number(process.env.DEADLINE_WIKIDATA || process.env.DEADLINE || 0) * 1000;
let total = 0, failed = [];
for (const [cc, q] of list) {
  if (DEADLINE && Date.now() > DEADLINE) { log('Heure limite atteinte : arrêt, reprise à la prochaine exécution.'); break; }
  const path = join(RAW_DIR, 'wikidata', `${cc}.json`);
  if (await fresh(path)) continue;
  try {
    const t0 = Date.now();
    const features = await fetchCountry(q, cc);
    await writeJson(path, { cc, q, date: new Date().toISOString(), features });
    total += features.length;
    log(`✓ ${cc} : ${features.length} sommets/cols (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  } catch (e) {
    failed.push(cc);
    log(`✗ ${cc} : ${e.message}`);
  }
  await sleep(1000);
}
log(`Terminé : ${total} objets collectés.${failed.length ? ' Échecs : ' + failed.join(', ') : ''}`);
