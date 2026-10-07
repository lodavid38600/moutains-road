// Encodage « Google polyline » (précision 1e-5) : tracés compacts.

export function encode(points, precision = 5) {
  const f = 10 ** precision;
  let out = '', pla = 0, plo = 0;
  const enc = (v) => {
    v = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    return s + String.fromCharCode(v + 63);
  };
  for (const [la, lo] of points) {
    const a = Math.round(la * f), b = Math.round(lo * f);
    out += enc(a - pla) + enc(b - plo);
    pla = a; plo = b;
  }
  return out;
}

export function decode(str, precision = 5) {
  const f = 10 ** precision;
  const pts = [];
  let i = 0, la = 0, lo = 0;
  const dec = () => {
    let r = 0, s = 0, b;
    do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20);
    return r & 1 ? ~(r >> 1) : r >> 1;
  };
  while (i < str.length) {
    la += dec(); lo += dec();
    pts.push([la / f, lo / f]);
  }
  return pts;
}

/** Simplification Douglas-Peucker (tolérance en degrés ~ 1e-4 ≈ 10 m). */
export function simplify(pts, tol = 1e-4) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ay, ax] = pts[a], [by, bx] = pts[b];
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let max = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [py, px] = pts[i];
      let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > max) { max = d; idx = i; }
    }
    if (max > t2) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
