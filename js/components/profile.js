// Profils d'altitude :
//  - profil détaillé d'un itinéraire : aire colorée selon la pente, repères (sommets, cols,
//    refuges) posés sur la courbe, survol avec altitude / pente / D+ cumulé, statistiques ;
//  - profils comparés de plusieurs voies (une couleur par voie, légende et étiquettes) ;
//  - mini-profils (sparklines) pour les listes.
import { gainLoss } from '../lib/dem.js';
import { estimateHours, formatHours } from '../lib/categories.js';
import { esc, num, fmtKm } from '../util.js';

/** Classes de pente (%) → couleur de la rampe séquentielle. */
export const SLOPES = [
  { max: 5, c: 'var(--p1)', label: '< 5 %' },
  { max: 10, c: 'var(--p2)', label: '5–10 %' },
  { max: 15, c: 'var(--p3)', label: '10–15 %' },
  { max: 25, c: 'var(--p4)', label: '15–25 %' },
  { max: 35, c: 'var(--p5)', label: '25–35 %' },
  { max: Infinity, c: 'var(--p6)', label: '> 35 %' },
];
export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)'];

/** Pente (%) en chaque point, mesurée sur ~150 m pour lisser le bruit du terrain. */
export function slopes(profile, span = 0.15) {
  const out = new Array(profile.length).fill(0);
  let a = 0, b = 0;
  for (let i = 0; i < profile.length; i++) {
    while (a < i && profile[i][0] - profile[a][0] > span / 2) a++;
    while (b < profile.length - 1 && profile[b][0] - profile[i][0] < span / 2) b++;
    const dx = (profile[b][0] - profile[a][0]) * 1000;
    out[i] = dx > 20 ? ((profile[b][1] - profile[a][1]) / dx) * 100 : 0;
  }
  return out;
}

/** Statistiques d'un profil. */
export function profileStats(profile) {
  if (!profile?.length) return null;
  const eles = profile.map((p) => p[1]);
  const { up, dn } = gainLoss(eles);
  const sl = slopes(profile, 0.2);
  let steep = 0, maxSlope = 0;
  for (let i = 1; i < profile.length; i++) {
    const d = profile[i][0] - profile[i - 1][0];
    if (Math.abs(sl[i]) > 25) steep += d;
    maxSlope = Math.max(maxSlope, Math.abs(sl[i]));
  }
  const km = profile[profile.length - 1][0] - profile[0][0];
  return { up, dn, min: Math.min(...eles), max: Math.max(...eles), km, maxSlope: Math.round(maxSlope), steepPct: km ? Math.round((steep / km) * 100) : 0 };
}

/** Altitude interpolée à une distance donnée. */
export function eleAt(profile, d) {
  if (!profile.length || d < profile[0][0] || d > profile[profile.length - 1][0] + 1e-6) return null;
  let i = 1;
  while (i < profile.length - 1 && profile[i][0] < d) i++;
  const [d0, e0] = profile[i - 1], [d1, e1] = profile[i];
  return d1 === d0 ? e0 : e0 + ((e1 - e0) * (d - d0)) / (d1 - d0);
}

/** Découpe un profil entre des repères (refuges de préférence) → étapes. */
export function stages(profile, waypoints) {
  if (!profile?.length) return [];
  const total = profile[profile.length - 1][0];
  const huts = waypoints.filter((w) => w.kind === 'hut' || w.kind === 'shelter');
  const marks = (huts.length >= 2 ? huts : waypoints).filter((w) => w.km > 0.3 && w.km < total - 0.3);
  const cuts = [{ km: 0, label: 'Départ' }, ...marks, { km: total, label: 'Arrivée' }];
  const out = [];
  for (let i = 1; i < cuts.length; i++) {
    const a = cuts[i - 1], b = cuts[i];
    if (b.km - a.km < 0.2) continue;
    const slice = profile.filter((p) => p[0] >= a.km && p[0] <= b.km);
    const { up, dn } = gainLoss(slice.map((p) => p[1]));
    const km = b.km - a.km;
    out.push({ from: a.label, to: b.label, fromId: a.id, toId: b.id, km, up, dn, h: estimateHours(km, up, dn), eTo: eleAt(profile, b.km) });
  }
  return out;
}

const niceStep = (span, target, steps) => steps.find((s) => span / s <= target) || steps[steps.length - 1];

/**
 * Graphique de profil(s).
 * @param {HTMLElement} el
 * @param {{ series: Array<{label:string, color?:string, profile:number[][]}>, waypoints?: Array<{km:number,label:string,kind?:string}>,
 *           slope?: boolean, height?: number, onHover?: (d:number|null, series:number) => void }} opts
 */
export function profileChart(el, opts) {
  const draw = () => render(el, opts);
  draw();
  const ro = new ResizeObserver(() => { if (Math.abs(el.clientWidth - (el._w || 0)) > 4) draw(); });
  ro.observe(el);
  return () => ro.disconnect();
}

function render(el, { series, waypoints = [], slope = series.length === 1, height = 260, onHover, totalUp = null }) {
  const W = Math.max(300, el.clientWidth || 700);
  el._w = W;
  const H = height;
  const multi = series.length > 1;
  const P = { l: 46, r: multi ? 12 : 12, t: waypoints.length ? 34 : 12, b: 26 };
  const all = series.flatMap((s) => s.profile);
  if (!all.length) { el.innerHTML = '<p class="muted">Profil indisponible.</p>'; return; }
  const xMax = Math.max(...series.map((s) => s.profile[s.profile.length - 1][0])) || 1;
  let yMin = Math.min(...all.map((p) => p[1])), yMax = Math.max(...all.map((p) => p[1]));
  const span = Math.max(80, yMax - yMin);
  const yStep = niceStep(span, 5, [20, 50, 100, 200, 250, 500, 1000]);
  yMin = Math.floor((yMin - span * 0.04) / yStep) * yStep;
  yMax = Math.ceil((yMax + span * 0.06) / yStep) * yStep;
  const X = (d) => P.l + (d / xMax) * (W - P.l - P.r);
  const Y = (e) => H - P.b - ((e - yMin) / (yMax - yMin)) * (H - P.t - P.b);
  const xStep = niceStep(xMax, Math.max(4, Math.floor(W / 90)), [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100]);
  const yTicks = []; for (let v = yMin; v <= yMax + 1e-6; v += yStep) yTicks.push(v);
  const xTicks = []; for (let v = 0; v <= xMax + 1e-9; v += xStep) xTicks.push(+v.toFixed(2));
  const color = (s, i) => s.color || SERIES[i % SERIES.length];
  const path = (pr) => pr.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');

  let body = '';
  if (!multi && slope) {
    // Aire colorée par tranches de pente : un trapèze par segment, regroupés par couleur.
    const pr = series[0].profile;
    const sl = slopes(pr);
    const byClass = SLOPES.map(() => []);
    for (let i = 1; i < pr.length; i++) {
      const s = Math.abs((sl[i - 1] + sl[i]) / 2);
      const k = SLOPES.findIndex((c) => s < c.max);
      const x0 = X(pr[i - 1][0]).toFixed(1), x1 = X(pr[i][0]).toFixed(1);
      byClass[k].push(`M${x0},${H - P.b}L${x0},${Y(pr[i - 1][1]).toFixed(1)}L${x1},${Y(pr[i][1]).toFixed(1)}L${x1},${H - P.b}Z`);
    }
    body += byClass.map((ps, k) => (ps.length ? `<path d="${ps.join('')}" fill="${SLOPES[k].c}" stroke="${SLOPES[k].c}" stroke-width=".6"/>` : '')).join('');
    body += `<path class="line" d="${path(pr)}"/>`;
  } else {
    body += series.map((s, i) => `<path class="series" data-i="${i}" d="${path(s.profile)}" stroke="${color(s, i)}"/>`).join('');
    // Étiquettes directes en fin de courbe (≤ 4 séries).
    if (series.length <= 4) {
      const ends = series.map((s, i) => ({ i, x: X(s.profile[s.profile.length - 1][0]) }));
      body += ends.map(({ i, x }) => `<circle cx="${x}" cy="${Y(series[i].profile[series[i].profile.length - 1][1])}" r="3.5" fill="${color(series[i], i)}"/>`).join('');
    }
  }

  // Repères (sommets, cols, refuges) posés sur la courbe, étiquettes sur deux rangées.
  let wps = '';
  if (waypoints.length && !multi) {
    const pr = series[0].profile;
    // Étiquettes sur deux rangées, sans chevauchement (les repères en surnombre gardent leur point).
    const prio = (w) => (w.kind === 'peak' || w.kind === 'volcano' ? 0 : w.kind === 'hut' ? 1 : 2);
    const items = waypoints.filter((w) => w.km >= 0 && w.km <= xMax).map((w) => {
      const e = eleAt(pr, w.km) ?? w.ele;
      const label = w.label.length > 20 ? w.label.slice(0, 19) + '…' : w.label;
      return { ...w, label, x: X(w.km), y: e != null ? Y(e) : null, width: label.length * 6.3 + 10 };
    });
    // Les sommets d'abord, puis les refuges, puis les cols ; à position égale, de gauche à droite.
    const placed = new Map();
    for (const w of items.slice().sort((a, b) => prio(a) - prio(b) || a.x - b.x)) {
      const left = Math.max(P.l - 30, Math.min(W - w.width, w.x - w.width / 2));
      for (const row of [0, 1]) {
        const occupied = [...placed.values()].some((o) => o.row === row && left < o.left + o.width && o.left < left + w.width);
        if (!occupied) { placed.set(w, { row, left, width: w.width }); break; }
      }
    }
    for (const w of items) {
      const fill = w.kind === 'hut' || w.kind === 'shelter' ? 'var(--cat-none)' : w.kind === 'col' ? 'var(--text-3)' : 'var(--accent)';
      const pl = placed.get(w);
      wps += '<g class="wp">';
      if (pl) {
        wps += `<line x1="${w.x}" x2="${w.x}" y1="${pl.row ? 24 : 12}" y2="${w.y ?? H - P.b}"/>`;
        wps += `<text x="${pl.left + w.width / 2}" y="${pl.row ? 21 : 9}" text-anchor="middle">${esc(w.label)}</text>`;
      }
      if (w.y != null) wps += `<circle cx="${w.x}" cy="${w.y}" r="${pl ? 4 : 3}" fill="${fill}"/>`;
      wps += '</g>';
    }
  }

  el.innerHTML = `<div class="chart-wrap">
    <svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(multi ? `Comparaison de ${series.length} profils d'altitude` : `Profil d'altitude de ${num(Math.round(Math.min(...all.map((p) => p[1]))))} à ${num(Math.round(Math.max(...all.map((p) => p[1]))))} m sur ${fmtKm(xMax)} km`)}">
      <g class="grid">${yTicks.map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}"/>`).join('')}</g>
      ${yTicks.map((v) => `<text x="${P.l - 7}" y="${Y(v) + 4}" text-anchor="end">${num(v)}</text>`).join('')}
      ${xTicks.map((v) => `<text x="${X(v)}" y="${H - 7}" text-anchor="middle">${String(v).replace('.', ',')}</text>`).join('')}
      <text x="${W - P.r}" y="${H - 7}" text-anchor="end" dx="14">km</text>
      ${body}${wps}
      <line class="xhair" y1="${P.t}" y2="${H - P.b}" visibility="hidden"/>
      ${series.map((s, i) => `<circle class="xdot" data-i="${i}" r="5" fill="${color(s, i)}" visibility="hidden"/>`).join('')}
      <rect class="hit" x="${P.l}" y="0" width="${W - P.l - P.r}" height="${H}" fill="transparent"/>
    </svg>
    <div class="chart-tip" hidden></div>
  </div>
  ${multi ? `<div class="legend">${series.map((s, i) => `<span><i class="ln" style="--c:${color(s, i)}"></i>${esc(s.label)}</span>`).join('')}</div>`
    : slope ? `<div class="legend" aria-label="Légende des pentes">${SLOPES.map((c) => `<span><i style="--c:${c.c}"></i>${c.label}</span>`).join('')}</div>` : ''}`;

  const svg = el.querySelector('svg'), tip = el.querySelector('.chart-tip'), xh = svg.querySelector('.xhair');
  const dots = [...svg.querySelectorAll('.xdot')];
  const sl0 = !multi ? slopes(series[0].profile) : null;
  const cum = !multi ? cumulativeGain(series[0].profile, totalUp) : null;
  const show = (clientX) => {
    const r = svg.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * W;
    const d = Math.max(0, Math.min(xMax, ((sx - P.l) / (W - P.l - P.r)) * xMax));
    xh.setAttribute('x1', X(d)); xh.setAttribute('x2', X(d)); xh.setAttribute('visibility', 'visible');
    const rows = [];
    series.forEach((s, i) => {
      const e = eleAt(s.profile, d);
      if (e == null) { dots[i].setAttribute('visibility', 'hidden'); return; }
      dots[i].setAttribute('cx', X(d)); dots[i].setAttribute('cy', Y(e)); dots[i].setAttribute('visibility', 'visible');
      rows.push({ i, e });
    });
    let html = `<div class="r"><b>${fmtKm(d)} km</b></div>`;
    if (!multi && rows[0]) {
      const pr = series[0].profile;
      let k = 0; while (k < pr.length - 1 && pr[k][0] < d) k++;
      html += `<div class="r"><span>Altitude</span><b>${num(Math.round(rows[0].e))} m</b></div>
        <div class="r"><span>Pente</span><b>${Math.round(sl0[k])} %</b></div>
        <div class="r"><span>D+ depuis le départ</span><b>${num(cum[k])} m</b></div>`;
    } else {
      html += rows.map(({ i, e }) => `<div class="r"><span><span class="sw" style="background:${color(series[i], i)}"></span>${esc(series[i].label)}</span><b>${num(Math.round(e))} m</b></div>`).join('');
    }
    tip.innerHTML = html;
    tip.hidden = false;
    const px = (X(d) / W) * r.width;
    tip.style.left = `${Math.min(r.width - tip.offsetWidth - 4, Math.max(4, px + 14 > r.width - tip.offsetWidth ? px - tip.offsetWidth - 14 : px + 14))}px`;
    tip.style.top = `${P.t}px`;
    onHover?.(d);
  };
  const hide = () => {
    xh.setAttribute('visibility', 'hidden');
    dots.forEach((x) => x.setAttribute('visibility', 'hidden'));
    tip.hidden = true;
    onHover?.(null);
  };
  svg.addEventListener('pointermove', (e) => show(e.clientX));
  svg.addEventListener('pointerdown', (e) => show(e.clientX));
  svg.addEventListener('pointerleave', hide);
  // Survol de la légende : met une série en avant.
  el.querySelectorAll('.legend span').forEach((sp, i) => {
    if (!multi) return;
    sp.addEventListener('pointerenter', () => svg.querySelectorAll('.series').forEach((p) => p.classList.toggle('dim', +p.dataset.i !== i)));
    sp.addEventListener('pointerleave', () => svg.querySelectorAll('.series').forEach((p) => p.classList.remove('dim')));
  });
}

function cumulativeGain(profile, totalUp = null) {
  const out = [0];
  let up = 0;
  for (let i = 1; i < profile.length; i++) {
    const d = profile[i][1] - profile[i - 1][1];
    if (d > 0) up += d;
    out.push(Math.round(up));
  }
  // Le cumul brut surestime légèrement : on le ramène au D+ lissé du profil complet.
  const total = totalUp ?? gainLoss(profile.map((p) => p[1])).up;
  const k = up > 0 ? total / up : 1;
  return out.map((v) => Math.round(v * k));
}

/** Mini-profil (aire) pour les listes. */
export function sparkSvg(profile, color = 'var(--s1)', { w = 220, h = 64 } = {}) {
  if (!profile?.length) return '';
  const xs = profile.map((p) => p[0]), ys = profile.map((p) => p[1]);
  const xMax = xs[xs.length - 1] || 1, yMin = Math.min(...ys), yMax = Math.max(...ys), sp = Math.max(50, yMax - yMin);
  const X = (d) => (d / xMax) * w, Y = (e) => h - 3 - ((e - yMin) / sp) * (h - 8);
  const line = profile.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${line}L${w},${h}L0,${h}Z" fill="${color}" opacity=".16"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

/** Statistiques affichées ; `up`/`dn`/`km` officiels de l'itinéraire priment sur ceux du profil échantillonné. */
export function statsHtml(st, { km, up, dn, min, max } = {}) {
  if (!st) return '';
  st = { ...st, up: up ?? st.up, dn: dn ?? st.dn, min: min ?? st.min, max: max ?? st.max };
  const items = [
    [`${num(st.up)} m`, 'Dénivelé +'], [`${num(st.dn)} m`, 'Dénivelé −'],
    [`${num(Math.round(st.min))} m`, 'Point bas'], [`${num(Math.round(st.max))} m`, 'Point haut'],
    [`${st.maxSlope} %`, 'Pente max (200 m)'], [`${st.steepPct} %`, 'Du parcours à plus de 25 %'],
  ];
  if (km) items.unshift([`${fmtKm(km)} km`, 'Distance']);
  return `<div class="profile-stats">${items.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('')}</div>`;
}

export const hoursLabel = (h) => formatHours(h);
