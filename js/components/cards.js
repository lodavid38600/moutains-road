// Fiches de liste : cartes (grilles) et rangées (listes compactes).
import { CATEGORIES, KINDS, plainDifficulty, estimateHours, formatHours } from '../lib/categories.js';
import { db, hrefFor, isRoute, isPeak, altOf } from '../data.js';
import { esc, num, fmtKm, icon, commonsThumb, FACT_ICONS } from '../util.js';

export const regionName = (id) => db.meta?.regions?.find((r) => r.id === id)?.name.split(' (')[0] || null;
export const hoursOf = (f) => f.h ?? (isRoute(f) ? estimateHours(f.km, f.up, f.dn) : null);

export function factsHtml(f, { compact = false } = {}) {
  const out = [];
  const fact = (ic, v) => `<span class="f">${FACT_ICONS[ic]}${v}</span>`;
  if (isRoute(f)) {
    if (f.km != null) out.push(fact('km', `<b>${fmtKm(f.km)}</b> km`));
    if (f.up != null) out.push(fact('up', `<b>${num(f.up)}</b> m`));
    const h = hoursOf(f);
    if (h) out.push(fact('h', `<b>${formatHours(h)}</b>`));
    if (!compact && f.emax != null) out.push(fact('alt', `${num(f.emax)} m`));
  } else {
    const a = altOf(f);
    if (a != null) out.push(fact('alt', `<b>${num(a)}</b> m`));
    if (!compact && f.pr) out.push(`<span class="f muted">proéminence ${num(f.pr)} m</span>`);
    if (!compact && f.beds) out.push(`<span class="f">${esc(f.beds)} places</span>`);
  }
  return out.join('');
}

function tagsHtml(f) {
  const d = plainDifficulty(f);
  if (f.c) return `<span class="dot"></span><span>${esc(CATEGORIES[f.c].short)}${d ? ` · ${esc(d.code)} ${esc(d.text.toLowerCase())}` : ''}</span>`;
  if (isPeak(f) && f.acc && !f.acc.nw) return '<span>Hors sentier</span>';
  return `<span>${esc(KINDS[f.k]?.label || '')}</span>`;
}

function subOf(f) {
  const bits = [];
  if (isRoute(f) && f.ref && f.ref !== f.n) bits.push(f.ref);
  bits.push(f.rg || regionName(f.r));
  if (isPeak(f) && f.nr) bits.push(`${f.nr} itinéraire${f.nr > 1 ? 's' : ''} balisé${f.nr > 1 ? 's' : ''}`);
  if (isPeak(f) && f.nc) bits.push(`${f.nc} voie${f.nc > 1 ? 's' : ''} Camptocamp`);
  return bits.filter(Boolean).map(esc).join(' · ');
}

/** Mini-profil (altitudes régulièrement espacées) dessiné en bas de l'illustration. */
function sparkline(sp) {
  if (!sp?.length) return '';
  const min = Math.min(...sp), max = Math.max(...sp), span = Math.max(80, max - min);
  const pts = sp.map((e, i) => `${(i / (sp.length - 1)) * 100},${(40 - ((e - min) / span) * 34).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 100 42" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,42 ${pts} 100,42" fill="rgb(255 255 255 / .28)"/><polyline points="${pts}" fill="none" stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

export function cardHtml(f) {
  const c = f.c ? `var(--cat-${f.c})` : 'var(--cat-none)';
  const sub = subOf(f);
  return `<a class="card" href="${hrefFor(f)}" style="--c:${c}">
    <span class="card-media">${f.sp && !f.img ? sparkline(f.sp) : icon(f.k, { size: 40, width: 1.6 })}${f.img ? `<img src="${esc(commonsThumb(f.img, 480))}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      <span class="tag">${esc(KINDS[f.k]?.label || '')}</span></span>
    <span class="card-body">
      <span class="card-title">${esc(f.n || KINDS[f.k]?.label)}</span>
      ${sub ? `<span class="card-sub">${sub}</span>` : ''}
      <span class="card-tags">${tagsHtml(f)}</span>
      <span class="facts">${factsHtml(f) || '<span class="f muted">—</span>'}</span>
    </span>
  </a>`;
}

export function rowHtml(f, { right = '' } = {}) {
  const c = f.c ? `var(--cat-${f.c})` : 'var(--cat-none)';
  return `<a class="row" href="${hrefFor(f)}">
    <span class="ico-chip" style="--c:${c}">${icon(f.k, { size: 18 })}</span>
    <span class="nm"><b>${esc(f.n || KINDS[f.k]?.label)}</b><span>${[KINDS[f.k]?.label, subOf(f)].filter(Boolean).join(' · ')}</span></span>
    <span class="rt">${right || `<span class="facts">${factsHtml(f, { compact: true })}</span>`}</span>
  </a>`;
}

export const catBadge = (c) => (c ? `<span class="badge" style="--c:var(--cat-${c})"><span class="dot"></span>${esc(CATEGORIES[c].label)}</span>` : '');
