// Liste des résultats : cartes compactes avec les chiffres clés (distance, D+, durée, altitude).
import { CATEGORIES, KINDS, plainDifficulty, estimateHours, formatHours } from './lib/categories.js';
import { isRoute, altOf } from './store.js';
import { esc, num, fmtKm, icon, commonsThumb, FACT_ICONS } from './util.js';

const SORTS = {
  rel: (a, b) => (b.sl || 0) - (a.sl || 0) || (b.net === 'iwn' || b.net === 'nwn') - (a.net === 'iwn' || a.net === 'nwn') || (altOf(b) || 0) - (altOf(a) || 0),
  'up-asc': (a, b) => (a.up ?? Infinity) - (b.up ?? Infinity),
  'up-desc': (a, b) => (b.up ?? -1) - (a.up ?? -1),
  km: (a, b) => (a.km ?? Infinity) - (b.km ?? Infinity),
  h: (a, b) => (hours(a) ?? Infinity) - (hours(b) ?? Infinity),
  alt: (a, b) => (altOf(b) ?? -1) - (altOf(a) ?? -1),
  t: (a, b) => ((a.t || a.acc?.t) ?? 9) - ((b.t || b.acc?.t) ?? 9),
};
const hours = (f) => f.h ?? (isRoute(f) ? estimateHours(f.km, f.up, f.dn) : null);

/** Tri ; les objets sans la valeur triée passent à la fin. */
export function sortList(list, key) {
  const fn = SORTS[key] || SORTS.rel;
  // Pour les tris propres aux itinéraires, on les met devant.
  if (['up-asc', 'up-desc', 'km', 'h'].includes(key)) {
    return list.slice().sort((a, b) => (isRoute(b) - isRoute(a)) || fn(a, b));
  }
  return list.slice().sort(fn);
}

export function factsHtml(f) {
  const out = [];
  const fact = (ic, v) => `<span class="f">${FACT_ICONS[ic]}${v}</span>`;
  if (isRoute(f)) {
    if (f.km != null) out.push(fact('km', `<b>${fmtKm(f.km)}</b> km`));
    if (f.up != null) out.push(fact('up', `<b>${num(f.up)}</b> m`));
    const h = hours(f);
    if (h) out.push(fact('h', `<b>${formatHours(h)}</b>`));
    if (f.emax != null) out.push(fact('alt', `${num(f.emax)} m`));
  } else {
    const a = altOf(f);
    if (a != null) out.push(fact('alt', `<b>${num(a)}</b> m`));
    if (f.pr) out.push(`<span class="f">proéminence ${num(f.pr)} m</span>`);
  }
  return out.join('');
}

export function cardHtml(f) {
  const c = f.c ? `var(--cat-${f.c})` : 'var(--cat-none)';
  const d = plainDifficulty(f);
  const tags = [];
  if (f.c) tags.push(`<span class="dot"></span><span>${esc(CATEGORIES[f.c].short)}${d ? ` · ${esc(d.code)}` : ''}</span>`);
  else tags.push(`<span>${esc(KINDS[f.k]?.label || '')}</span>`);
  if (f.ref && f.ref !== f.n) tags.push(`<span>· ${esc(f.ref)}</span>`);
  return `<button class="card" data-id="${esc(f.id)}" style="--c:${c}">
    <span class="card-img">${icon(f.k, { color: '#fff', size: 34, width: 1.8 })}${f.img ? `<img src="${esc(commonsThumb(f.img, 200))}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>
    <span class="card-body">
      <span class="card-title">${esc(f.n || KINDS[f.k]?.label)}</span>
      <span class="card-tags">${tags.join('')}</span>
      <span class="facts">${factsHtml(f) || '<span class="f muted">—</span>'}</span>
    </span>
  </button>`;
}
