// Altitudes et dénivelé à partir d'un modèle numérique de terrain (MNT).
// Source : tuiles « Terrarium » (Mapzen / AWS Open Data, monde entier,
// ~30 m de résolution au zoom 12). Partagé entre Node et le navigateur :
// seul le chargeur de tuile change (`loadTile(z, x, y)` → Float32Array 256×256).

import { distKm, chainWays } from './geo.js';
import { encode, simplify } from './polyline.js';

export const DEM_ZOOM = 12;
export const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const terrariumUrl = (z, x, y) => TERRARIUM_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);

/** Décodage d'un pixel Terrarium (R, G, B) en mètres. */
export const terrarium = (r, g, b) => r * 256 + g + b / 256 - 32768;

export class Dem {
  constructor(loadTile, { zoom = DEM_ZOOM, maxTiles = 400 } = {}) {
    this.loadTile = loadTile;
    this.zoom = zoom;
    this.maxTiles = maxTiles;
    this.tiles = new Map(); // clé → Promise<Float32Array|null>
  }

  _tile(x, y) {
    const key = `${x}/${y}`;
    let p = this.tiles.get(key);
    if (p) { this.tiles.delete(key); this.tiles.set(key, p); return p; } // LRU
    p = this.loadTile(this.zoom, x, y).catch(() => null);
    this.tiles.set(key, p);
    if (this.tiles.size > this.maxTiles) this.tiles.delete(this.tiles.keys().next().value);
    return p;
  }

  /** Altitude (interpolation bilinéaire) ou null. */
  async at(lat, lon) {
    const n = 2 ** this.zoom;
    const fx = ((lon + 180) / 360) * n;
    const r = (lat * Math.PI) / 180;
    const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
    const tx = Math.floor(fx), ty = Math.floor(fy);
    const data = await this._tile(tx, ty);
    if (!data) return null;
    const px = Math.min(254.999, Math.max(0, (fx - tx) * 256 - 0.5));
    const py = Math.min(254.999, Math.max(0, (fy - ty) * 256 - 0.5));
    const x0 = Math.floor(px), y0 = Math.floor(py), dx = px - x0, dy = py - y0;
    const v = (x, y) => data[y * 256 + x];
    return v(x0, y0) * (1 - dx) * (1 - dy) + v(x0 + 1, y0) * dx * (1 - dy) +
      v(x0, y0 + 1) * (1 - dx) * dy + v(x0 + 1, y0 + 1) * dx * dy;
  }

  async many(points) {
    const out = new Array(points.length);
    // Regroupe par tuile pour limiter les attentes concurrentes.
    await Promise.all(points.map(async ([la, lo], i) => { out[i] = await this.at(la, lo); }));
    return out;
  }
}

/** Ré-échantillonne un tracé tous les `stepKm`. Renvoie [{ la, lo, d }]. */
export function resample(pts, stepKm = 0.025) {
  if (!pts.length) return [];
  const out = [{ la: pts[0][0], lo: pts[0][1], d: 0 }];
  let d = 0, next = stepKm;
  for (let i = 1; i < pts.length; i++) {
    const [a1, o1] = pts[i - 1], [a2, o2] = pts[i];
    const seg = distKm(a1, o1, a2, o2);
    while (seg > 0 && next <= d + seg) {
      const t = (next - d) / seg;
      out.push({ la: a1 + (a2 - a1) * t, lo: o1 + (o2 - o1) * t, d: next });
      next += stepKm;
    }
    d += seg;
  }
  const last = pts[pts.length - 1];
  if (d - out[out.length - 1].d > 1e-3) out.push({ la: last[0], lo: last[1], d });
  return out;
}

/** Lissage (moyenne glissante) puis cumul avec seuil d'hystérésis. */
export function gainLoss(eles, { window = 5, threshold = 3 } = {}) {
  const v = eles.filter((e) => e != null);
  if (v.length < 2) return { up: 0, dn: 0 };
  const h = Math.floor(window / 2);
  const s = v.map((_, i) => {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - h); j <= Math.min(v.length - 1, i + h); j++) { sum += v[j]; n++; }
    return sum / n;
  });
  let up = 0, dn = 0, ref = s[0];
  for (const e of s) {
    if (e - ref >= threshold) { up += e - ref; ref = e; } else if (ref - e >= threshold) { dn += ref - e; ref = e; }
  }
  return { up: Math.round(up), dn: Math.round(dn) };
}

/**
 * Calcule les métriques d'un itinéraire à partir de ses chemins :
 * longueur, D+/D−, altitudes min/max, profil (≤ 200 points) et tracé simplifié.
 * Le tracé principal est la suite des tronçons raccordés ; les variantes
 * courtes (< 15 % du plus long tronçon) sont ignorées pour le dénivelé.
 */
export async function routeMetrics(ways, dem, { stepKm = 0.025 } = {}) {
  const chains = chainWays(ways);
  if (!chains.length) return null;
  const total = chains.reduce((s, c) => s + c.km, 0);
  const main = chains.filter((c) => c.km >= chains[0].km * 0.15);
  let up = 0, dn = 0, emax = -Infinity, emin = Infinity;
  let profile = [];
  let offset = 0;
  for (const c of main) {
    // Pas plus fin pour les courts itinéraires, plus large pour les très longs (GR).
    const step = Math.max(stepKm, c.km / 4000);
    const samples = resample(c.pts, step);
    const eles = dem ? await dem.many(samples.map((p) => [p.la, p.lo])) : [];
    const valid = eles.filter((e) => e != null);
    if (valid.length > 1) {
      const g = gainLoss(eles);
      up += g.up; dn += g.dn;
      emax = Math.max(emax, ...valid);
      emin = Math.min(emin, ...valid);
      samples.forEach((p, i) => { if (eles[i] != null) profile.push([offset + p.d, eles[i]]); });
    }
    offset += c.km;
  }
  // Profil réduit à ~200 points (max local conservé par intervalle).
  if (profile.length > 200) {
    const n = Math.ceil(profile.length / 200);
    const red = [];
    for (let i = 0; i < profile.length; i += n) {
      const slice = profile.slice(i, i + n);
      red.push(slice.reduce((a, b) => (b[1] > a[1] ? b : a)));
    }
    profile = red;
  }
  const hasDem = isFinite(emax);
  return {
    kmGeom: Math.round(total * 10) / 10,
    kmMain: Math.round(main.reduce((s, c) => s + c.km, 0) * 10) / 10,
    up: hasDem ? up : null,
    dn: hasDem ? dn : null,
    emax: hasDem ? Math.round(emax) : null,
    emin: hasDem ? Math.round(emin) : null,
    loop: main.length === 1 && distKm(main[0].pts[0][0], main[0].pts[0][1], ...main[0].pts.at(-1)) < 0.3,
    geom: chains.map((c) => encode(simplify(c.pts, 8e-5))),
    profile: profile.map(([d, e]) => [Math.round(d * 100) / 100, Math.round(e)]),
  };
}
