// Géométrie « le long d'un tracé » : distance point-segment, tracé principal,
// et repérage des lieux (sommets, cols, refuges) traversés par un itinéraire.
// Partagé entre l'assemblage (Node) et le navigateur.

import { distKm } from './geo.js';

/** Distance (km) d'un point à un segment [a, b] ([lat, lon]), projection locale. */
export function segDistKm(la, lo, a, b) {
  const kx = 111.32 * Math.cos((la * Math.PI) / 180), ky = 110.57;
  const ax = (a[1] - lo) * kx, ay = (a[0] - la) * ky;
  const bx = (b[1] - lo) * kx, by = (b[0] - la) * ky;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
  return { d: Math.hypot(ax + t * dx, ay + t * dy), t };
}

/**
 * Tracé principal : les tronçons d'au moins 15 % du plus long, mis bout à bout
 * (même règle que le calcul du dénivelé, pour que les distances correspondent au profil).
 * lines : [[[lat, lon], …], …] triés du plus long au plus court.
 * Renvoie [{ pts, cum, km, offset }].
 */
export function mainLines(lines) {
  const withLen = lines.map((pts) => {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + distKm(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
    return { pts, cum, km: cum[cum.length - 1] };
  });
  const longest = Math.max(0, ...withLen.map((l) => l.km));
  let offset = 0;
  return withLen.filter((l) => l.km >= longest * 0.15).map((l) => {
    const r = { ...l, offset };
    offset += l.km;
    return r;
  });
}

/** Position [lat, lon] à une distance (km) le long du tracé principal. */
export function pointAt(main, d) {
  for (const l of main) {
    if (d <= l.offset + l.km) {
      const x = d - l.offset;
      let i = 1;
      while (i < l.cum.length - 1 && l.cum[i] < x) i++;
      const t = (x - l.cum[i - 1]) / Math.max(1e-9, l.cum[i] - l.cum[i - 1]);
      const a = l.pts[i - 1], b = l.pts[i];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
  }
  return main.length ? main[main.length - 1].pts[main[main.length - 1].pts.length - 1] : null;
}

/**
 * Lieux situés à moins de `maxKm` du tracé principal, avec leur position (km) sur le profil.
 * places : [{ id, la, lo, … }] ; index : fonction (la, lo) → candidats proches (optionnelle).
 * Renvoie [{ id, km, d }] trié par km.
 */
export function placesAlong(main, places, maxKm = 0.15) {
  const best = new Map();
  for (const l of main) {
    for (let i = 1; i < l.pts.length; i++) {
      const a = l.pts[i - 1], b = l.pts[i];
      const s = Math.min(a[0], b[0]) - 0.003, n = Math.max(a[0], b[0]) + 0.003;
      const w = Math.min(a[1], b[1]) - 0.004, e = Math.max(a[1], b[1]) + 0.004;
      for (const p of places) {
        if (p.la < s || p.la > n || p.lo < w || p.lo > e) continue;
        const { d, t } = segDistKm(p.la, p.lo, a, b);
        if (d > maxKm) continue;
        const km = l.offset + l.cum[i - 1] + t * (l.cum[i] - l.cum[i - 1]);
        const prev = best.get(p.id);
        if (!prev || d < prev.d) best.set(p.id, { id: p.id, km: Math.round(km * 100) / 100, d: Math.round(d * 1000) / 1000 });
      }
    }
  }
  return [...best.values()].sort((a, b) => a.km - b.km);
}

/** Index spatial simple (cases de `cell` degrés) pour accélérer placesAlong. */
export function gridIndex(items, cell = 0.05) {
  const g = new Map();
  const k = (la, lo) => `${Math.floor(la / cell)}_${Math.floor(lo / cell)}`;
  for (const it of items) {
    const key = k(it.la, it.lo);
    if (!g.has(key)) g.set(key, []);
    g.get(key).push(it);
  }
  /** Candidats dans la bbox [s, w, n, e]. */
  return ([s, w, n, e]) => {
    const out = [];
    for (let a = Math.floor(s / cell); a <= Math.floor(n / cell); a++) {
      for (let b = Math.floor(w / cell); b <= Math.floor(e / cell); b++) {
        const l = g.get(`${a}_${b}`);
        if (l) out.push(...l);
      }
    }
    return out;
  };
}

export function bboxOf(lines) {
  let s = 90, w = 180, n = -90, e = -180;
  for (const l of lines) for (const [la, lo] of l) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
  return [s, w, n, e];
}
