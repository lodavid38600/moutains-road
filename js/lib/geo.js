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
  const pool = ways.filter((w) => w.length > 1).map((w) => w.slice());
  const chains = [];
  while (pool.length) {
    let chain = pool.pop();
    let grown = true;
    while (grown) {
      grown = false;
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i];
        const hs = key(chain[0]), he = key(chain[chain.length - 1]);
        const ws = key(w[0]), we = key(w[w.length - 1]);
        if (he === ws) chain = chain.concat(w.slice(1));
        else if (he === we) chain = chain.concat(w.slice().reverse().slice(1));
        else if (hs === we) chain = w.concat(chain.slice(1));
        else if (hs === ws) chain = w.slice().reverse().concat(chain.slice(1));
        else continue;
        pool.splice(i, 1);
        grown = true;
        break;
      }
    }
    chains.push(chain);
  }
  const len = (c) => c.reduce((s, p, i) => (i ? s + distKm(c[i - 1][0], c[i - 1][1], p[0], p[1]) : 0), 0);
  return chains.map((c) => ({ pts: c, km: len(c) })).sort((a, b) => b.km - a.km);
}
