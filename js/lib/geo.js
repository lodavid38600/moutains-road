// Petites fonctions géographiques partagées.

/** Taille des tuiles de données (degrés). */
export const TILE_DEG = 1;

export const tileKey = (lat, lon) => `${Math.floor(lat / TILE_DEG) * TILE_DEG}_${Math.floor(lon / TILE_DEG) * TILE_DEG}`;

/** Clés des tuiles qui recouvrent une bbox [sud, ouest, nord, est]. */
export function tilesForBbox([s, w, n, e]) {
  const keys = [];
  for (let la = Math.floor(s / TILE_DEG) * TILE_DEG; la < n; la += TILE_DEG) {
    for (let lo = Math.floor(w / TILE_DEG) * TILE_DEG; lo < e; lo += TILE_DEG) keys.push(`${la}_${lo}`);
  }
  return keys;
}

/** Distance en km (haversine). */
export function distKm(la1, lo1, la2, lo2) {
  const R = 6371, r = Math.PI / 180;
  const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Découpe une bbox en cellules de `step` degrés. */
export function splitBbox([s, w, n, e], step) {
  const cells = [];
  for (let la = s; la < n - 1e-9; la += step) {
    for (let lo = w; lo < e - 1e-9; lo += step) {
      cells.push([la, lo, Math.min(la + step, n), Math.min(lo + step, e)].map((x) => +x.toFixed(4)));
    }
  }
  return cells;
}

/** Découpe une bbox en 4. */
export function quarter([s, w, n, e]) {
  const ml = (s + n) / 2, mo = (w + e) / 2;
  return [[s, w, ml, mo], [s, mo, ml, e], [ml, w, n, mo], [ml, mo, n, e]];
}

/**
 * Assemble des chemins (listes de points [lat, lon]) en tracés continus
 * en raccordant les extrémités communes (les relations OSM ne sont pas
 * toujours ordonnées). Renvoie une liste de tracés, du plus long au plus court.
 */
export function chainWays(ways) {
  const key = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const pool = ways.filter((w) => w.length > 1);
  const used = new Uint8Array(pool.length);
  // Index des extrémités → tronçons (raccordement en temps linéaire).
  const ends = new Map();
  const addEnd = (k, i) => { const l = ends.get(k); if (l) l.push(i); else ends.set(k, [i]); };
  pool.forEach((w, i) => { addEnd(key(w[0]), i); addEnd(key(w[w.length - 1]), i); });
  const take = (k) => {
    const l = ends.get(k);
    if (!l) return -1;
    for (const i of l) if (!used[i]) return i;
    return -1;
  };
  const chains = [];
  for (let s = 0; s < pool.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    let head = [], tail = pool[s].slice();
    // Prolonge vers l'avant.
    for (let k = key(tail[tail.length - 1]), i; (i = take(k)) >= 0; k = key(tail[tail.length - 1])) {
      used[i] = 1;
      const w = pool[i];
      tail = tail.concat((key(w[0]) === k ? w : w.slice().reverse()).slice(1));
    }
    // Puis vers l'arrière (tronçons accumulés en tête, dans l'ordre inverse).
    for (let k = key(tail[0]), i; (i = take(k)) >= 0;) {
      used[i] = 1;
      const w = pool[i];
      const seg = key(w[w.length - 1]) === k ? w.slice(0, -1) : w.slice().reverse().slice(0, -1);
      head.push(seg);
      k = key(seg[0]);
    }
    const pts = head.reverse().flat().concat(tail);
    chains.push(pts);
  }
  const len = (c) => { let d = 0; for (let i = 1; i < c.length; i++) d += distKm(c[i - 1][0], c[i - 1][1], c[i][0], c[i][1]); return d; };
  return chains.map((c) => ({ pts: c, km: len(c) })).sort((a, b) => b.km - a.km);
}
