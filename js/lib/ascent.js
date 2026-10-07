// Voies d'ascension d'un sommet, calculées sur le réseau de sentiers OpenStreetMap.
//
// 1. On récupère les chemins piétons autour du sommet (avec leurs nœuds et leur géométrie),
//    les parkings, refuges et lieux habités, et les routes carrossables.
// 2. Dijkstra depuis le sommet sur le réseau piéton (coût = temps de marche, pénalisé
//    par la difficulté).
// 3. Chaque point de départ réel (parking, refuge, accès routier) donne une voie candidate ;
//    on garde les plus courtes qui sont réellement différentes les unes des autres.
// 4. Chaque voie est mesurée (distance, D+, difficulté max, profil) avec le modèle de terrain.

import { distKm } from './geo.js';
import { parseSacList, parseFerrataList, estimateHours } from './categories.js';
import { routeMetrics } from './dem.js';

const FOOT = 'path|footway|track|steps|bridleway|via_ferrata|pedestrian';
const ROADS = 'residential|unclassified|tertiary|secondary|primary|service|living_street';

/** Requête Overpass : réseau piéton + départs possibles autour du sommet (rayon en m). */
export function ascentQuery(lat, lon, radius = 7000) {
  const A = `around:${radius},${lat},${lon}`;
  return `[out:json][timeout:120][maxsize:268435456];
way(${A})[highway~"^(${FOOT})$"][access!~"^(no|private)$"]->.foot;
.foot out body geom qt;
(
  node(${A})[amenity=parking];
  way(${A})[amenity=parking];
  nwr(${A})[tourism~"^(alpine_hut|wilderness_hut)$"];
  node(around:${radius + 4000},${lat},${lon})[place~"^(city|town|village|hamlet|locality|isolated_dwelling)$"][name];
)->.p;
.p out center tags qt;
way(${A})[highway~"^(${ROADS})$"][motor_vehicle!~"^(no|private)$"][access!~"^(no|private)$"]->.r;
.r out skel qt;`;
}

/** Plus petite file de priorité (tas binaire). */
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(k, v) {
    const a = this.a; a.push([k, v]);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

/** Pénalité de difficulté : on préfère les sentiers plus faciles à longueur égale. */
function penalty(tags) {
  const sac = Math.max(0, ...parseSacList(tags.sac_scale));
  if (tags.highway === 'via_ferrata') return 2.2;
  if (sac >= 5) return 1.8;
  if (sac === 4) return 1.4;
  if (tags.trail_visibility === 'bad' || tags.trail_visibility === 'horrible' || tags.trail_visibility === 'no') return 1.3;
  return 1;
}

/** Construit le graphe piéton : nœud OSM → [{ to, km, cost, way }]. */
export function buildGraph(json) {
  const coords = new Map();
  const adj = new Map();
  const ways = new Map();
  const roadNodes = new Set();
  const pois = [];
  const link = (a, b, km, cost, w) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ to: b, km, cost, w });
  };
  for (const el of json.elements || []) {
    if (el.type === 'way' && el.geometry && el.nodes && el.tags?.highway && new RegExp(`^(${FOOT})$`).test(el.tags.highway)) {
      ways.set(el.id, el);
      const pen = penalty(el.tags);
      for (let i = 0; i < el.nodes.length; i++) {
        const g = el.geometry[i];
        if (!g) continue;
        coords.set(el.nodes[i], [g.lat, g.lon]);
        if (i === 0 || !el.geometry[i - 1]) continue;
        const a = el.nodes[i - 1], b = el.nodes[i];
        const km = distKm(el.geometry[i - 1].lat, el.geometry[i - 1].lon, g.lat, g.lon);
        const cost = km * pen;
        // Les sentiers se parcourent dans les deux sens.
        link(a, b, km, cost, el.id);
        link(b, a, km, cost, el.id);
      }
    } else if (el.type === 'way' && el.nodes && !el.geometry) {
      for (const n of el.nodes) roadNodes.add(n); // routes (out skel)
    } else if (el.tags && (el.tags.amenity === 'parking' || el.tags.tourism || el.tags.place)) {
      const la = el.lat ?? el.center?.lat, lo = el.lon ?? el.center?.lon;
      if (la != null) pois.push({ id: el.type[0] + el.id, la, lo, tags: el.tags });
    }
  }
  return { coords, adj, ways, roadNodes, pois };
}

/** Nœud du graphe le plus proche d'un point (dans `maxKm`). */
function nearestNode(graph, la, lo, maxKm) {
  let best = null, bd = maxKm;
  for (const [id, [a, b]] of graph.coords) {
    if (Math.abs(a - la) > 0.02 || Math.abs(b - lo) > 0.03) continue;
    if (!graph.adj.has(id)) continue;
    const d = distKm(la, lo, a, b);
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}

function dijkstra(graph, source, maxCost) {
  const dist = new Map([[source, 0]]);
  const prev = new Map();
  const heap = new Heap();
  heap.push(0, source);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d > (dist.get(u) ?? Infinity) || d > maxCost) continue;
    for (const e of graph.adj.get(u) || []) {
      const nd = d + e.cost;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, { from: u, e });
        heap.push(nd, e.to);
      }
    }
  }
  return { dist, prev };
}

/** Chemin (liste de nœuds + arêtes) du départ vers le sommet. */
function pathFrom(prev, start) {
  const nodes = [start], edges = [];
  let cur = start;
  while (prev.has(cur)) {
    const { from, e } = prev.get(cur);
    edges.push(e);
    nodes.push(from);
    cur = from;
  }
  return { nodes, edges }; // départ → sommet (car Dijkstra part du sommet)
}

const nearestPlace = (pois, la, lo, maxKm = 5) => {
  let best = null, bd = maxKm;
  for (const p of pois) {
    if (!p.tags.place) continue;
    const d = distKm(la, lo, p.la, p.lo);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
};

/**
 * Calcule les voies d'ascension.
 * @param {{ la: number, lo: number, n?: string, e?: number }} peak
 * @param {object} json  réponse Overpass de ascentQuery
 * @param {import('./dem.js').Dem|null} dem
 * @returns {Promise<{ ascents: Array, reason?: string }>}
 */
export async function findAscents(peak, json, dem, { max = 6, maxKm = 18 } = {}) {
  const graph = buildGraph(json);
  if (!graph.adj.size) return { ascents: [], reason: 'Aucun sentier cartographié autour du sommet.' };
  const summit = nearestNode(graph, peak.la, peak.lo, 0.2);
  if (summit == null) return { ascents: [], reason: 'Aucun sentier cartographié n’atteint le sommet.' };

  const { dist, prev } = dijkstra(graph, summit, maxKm * 2.5);

  // Départs candidats.
  const starts = [];
  for (const p of graph.pois) {
    if (p.tags.place) continue;
    const isHut = !!p.tags.tourism;
    const node = nearestNode(graph, p.la, p.lo, isHut ? 0.25 : 0.4);
    if (node == null || !dist.has(node)) continue;
    starts.push({ node, kind: isHut ? 'hut' : 'parking', name: p.tags.name, poi: p, prio: isHut ? 0.9 : 1 });
  }
  for (const n of graph.roadNodes) {
    if (!dist.has(n) || !graph.adj.has(n)) continue;
    starts.push({ node: n, kind: 'road', prio: 1.15 }); // accès routier sans parking connu
  }
  // Tri par coût (légère préférence pour les parkings et refuges nommés).
  starts.sort((a, b) => dist.get(a.node) * a.prio - dist.get(b.node) * b.prio);

  const chosen = [];
  const usedEdges = [];
  for (const s of starts) {
    if (chosen.length >= max) break;
    if (s.node === summit) continue;
    const { nodes, edges } = pathFrom(prev, s.node);
    const km = edges.reduce((t, e) => t + e.km, 0);
    if (km < 0.3 || km > maxKm) continue;
    // Une voie qui passe par le départ d'une voie déjà retenue en est un prolongement.
    if (chosen.some((c) => nodes.includes(c.startNode))) continue;
    // Trop de tronçons en commun avec une voie déjà retenue → doublon.
    const mine = new Set(edges.map((e) => e.w));
    const overlap = usedEdges.some((set) => {
      let shared = 0;
      for (const e of edges) if (set.has(e.w)) shared += e.km;
      return shared / km > 0.6;
    });
    if (overlap) continue;
    usedEdges.push(mine);
    chosen.push({ ...s, startNode: s.node, nodes, edges, km });
  }

  const ascents = [];
  for (const c of chosen) {
    const pts = c.nodes.map((n) => graph.coords.get(n));
    const sac = [], vf = [];
    const wayIds = [...new Set(c.edges.map((e) => e.w))];
    for (const id of wayIds) {
      const t = graph.ways.get(id)?.tags || {};
      sac.push(...parseSacList(t.sac_scale));
      if (t.highway === 'via_ferrata') vf.push(...parseFerrataList(t.via_ferrata_scale), 0);
    }
    let m = null;
    try { m = await routeMetrics([pts], dem); } catch { /* MNT indisponible */ }
    const startPt = pts[0];
    const place = nearestPlace(graph.pois, startPt[0], startPt[1]);
    const label = c.kind === 'hut' ? (c.name || 'Refuge')
      : c.kind === 'parking' ? (c.name ? c.name : place ? `Parking, ${place.tags.name}` : 'Parking')
        : place ? `Route, ${place.tags.name}` : 'Accès routier';
    const km = Math.round((m?.kmMain || c.km) * 10) / 10;
    const up = m?.up ?? null, dn = m?.dn ?? null;
    ascents.push({
      id: `${c.kind}-${c.node}`,
      start: { kind: c.kind, name: label, la: startPt[0], lo: startPt[1], place: place?.tags.name, ele: m?.profile?.[0]?.[1] ?? null },
      line: pts,
      km, up, dn,
      emax: m?.emax ?? peak.e ?? null,
      t: sac.length ? Math.max(...sac) : null,
      vf: vf.length ? Math.max(...vf) : null,
      hUp: estimateHours(km, up, dn),
      hRound: estimateHours(km * 2, (up || 0) + (dn || 0), (up || 0) + (dn || 0)),
      profile: m?.profile || [],
      ways: wayIds.length,
    });
  }
  // Ordre d'affichage : les plus courtes en temps de montée d'abord.
  ascents.sort((a, b) => (a.hUp ?? 99) - (b.hUp ?? 99));
  return { ascents, reason: ascents.length ? undefined : 'Aucun point de départ accessible trouvé à moins de 18 km de marche.' };
}
