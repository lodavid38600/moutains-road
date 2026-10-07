// Graphiques SVG / HTML légers : profil d'altitude, barres, histogramme.
import { esc, num } from './util.js';

/**
 * Profil d'altitude interactif.
 * @param {HTMLElement} el
 * @param {Array<[number, number]>} profile  [[distance km, altitude m], …]
 * @param {{ onHover?: (index|null) => void }} opts
 */
export function profileChart(el, profile, { onHover } = {}) {
  const W = 400, H = 150, P = { l: 40, r: 8, t: 10, b: 22 };
  const xs = profile.map((p) => p[0]), ys = profile.map((p) => p[1]);
  const xMax = xs.at(-1) || 1;
  let yMin = Math.min(...ys), yMax = Math.max(...ys);
  const span = Math.max(100, yMax - yMin);
  const step = [50, 100, 200, 250, 500, 1000].find((s) => span / s <= 4) || 1000;
  yMin = Math.floor((yMin - span * 0.05) / step) * step;
  yMax = Math.ceil((yMax + span * 0.05) / step) * step;
  const X = (d) => P.l + (d / xMax) * (W - P.l - P.r);
  const Y = (e) => H - P.b - ((e - yMin) / (yMax - yMin)) * (H - P.t - P.b);
  const line = profile.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  const area = `${line}L${X(xMax).toFixed(1)},${H - P.b}L${P.l},${H - P.b}Z`;
  const yTicks = [];
  for (let v = yMin; v <= yMax; v += step) yTicks.push(v);
  const xStep = [0.5, 1, 2, 5, 10, 20, 50, 100, 200].find((s) => xMax / s <= 6) || 500;
  const xTicks = [];
  for (let v = 0; v <= xMax + 1e-9; v += xStep) xTicks.push(v);

  el.innerHTML = `<div class="chart-wrap">
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Profil d'altitude : de ${num(Math.round(Math.min(...ys)))} à ${num(Math.round(Math.max(...ys)))} m sur ${num(Math.round(xMax * 10) / 10)} km">
      <g class="grid">${yTicks.map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}"/>`).join('')}</g>
      ${yTicks.map((v) => `<text x="${P.l - 6}" y="${Y(v) + 4}" text-anchor="end">${num(v)}</text>`).join('')}
      ${xTicks.map((v) => `<text x="${X(v)}" y="${H - 6}" text-anchor="middle">${String(v).replace('.', ',')}${v === 0 ? '' : ''}</text>`).join('')}
      <text x="${W - P.r}" y="${H - 6}" text-anchor="end"> km</text>
      <path class="area" d="${area}"/>
      <path class="line" d="${line}"/>
      <line class="xhair" y1="${P.t}" y2="${H - P.b}" visibility="hidden"/>
      <circle class="xdot" r="4.5" visibility="hidden"/>
      <rect x="${P.l}" y="0" width="${W - P.l - P.r}" height="${H}" fill="transparent" class="hit"/>
    </svg>
    <div class="chart-tip" hidden></div>
  </div>`;
  const svg = el.querySelector('svg'), tip = el.querySelector('.chart-tip');
  const xh = svg.querySelector('.xhair'), dot = svg.querySelector('.xdot');
  const show = (clientX) => {
    const r = svg.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * W;
    const d = Math.max(0, Math.min(xMax, ((sx - P.l) / (W - P.l - P.r)) * xMax));
    let i = 0;
    while (i < xs.length - 1 && xs[i + 1] < d) i++;
    if (i < xs.length - 1 && Math.abs(xs[i + 1] - d) < Math.abs(xs[i] - d)) i++;
    const x = X(xs[i]), y = Y(ys[i]);
    xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.style.left = `${(x / W) * 100}%`;
    tip.innerHTML = `<b>${num(Math.round(ys[i]))} m</b> · ${String(Math.round(xs[i] * 10) / 10).replace('.', ',')} km`;
    onHover?.(i);
  };
  const hide = () => {
    xh.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden');
    tip.hidden = true; onHover?.(null);
  };
  svg.addEventListener('pointermove', (e) => show(e.clientX));
  svg.addEventListener('pointerdown', (e) => show(e.clientX));
  svg.addEventListener('pointerleave', hide);
}

/**
 * Barres horizontales étiquetées.
 * rows : [{ label, value, color?, id? }]
 */
export function barChart(rows, { format = num, onClick } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const html = `<div class="bars" role="list">${rows.map((r, i) => `
    <div class="bar-row" role="listitem" ${onClick ? `data-i="${i}" style="cursor:pointer"` : ''} title="${esc(r.label)} : ${format(r.value)}">
      <div class="lbl">${r.color ? `<span class="dot" style="--c:${r.color}"></span>` : ''}<span>${esc(r.label)}</span></div>
      <div class="track"><div class="fill" style="width:${(r.value / max) * 100}%;${r.color ? `--c:${r.color}` : ''}"></div></div>
      <div class="val">${format(r.value)}</div>
    </div>`).join('')}</div>`;
  return html;
}

/** Histogramme vertical (une seule série). bins : [{ label, value }] */
export function histogram(bins) {
  const max = Math.max(1, ...bins.map((b) => b.value));
  return `<div class="hist">${bins.map((b) => `<div class="col" title="${esc(b.label)} : ${num(b.value)}"><div class="b" style="height:${(b.value / max) * 100}%"></div></div>`).join('')}</div>
    <div class="hist-x">${bins.map((b, i) => `<span>${i % 2 ? '' : esc(b.label)}</span>`).join('')}</div>`;
}
