// Petites aides d'affichage.
import { KINDS, CATEGORIES } from './lib/categories.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const nf = new Intl.NumberFormat('fr-FR');
export const num = (n) => (n == null ? '—' : nf.format(n));
export const meters = (n) => (n == null ? '—' : `${nf.format(Math.round(n))} m`);
export const km = (n) => (n == null ? '—' : `${n < 10 ? n.toFixed(1).replace('.', ',') : nf.format(Math.round(n))} km`);

export const normText = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Couleur CSS d'une catégorie (suit le thème clair / sombre). */
export function catColor(c) {
  return getComputedStyle(document.documentElement).getPropertyValue(`--cat-${c || 'none'}`).trim() || CATEGORIES[c]?.color || '#8a8d84';
}

export function kindLabel(f) { return KINDS[f.k]?.label || f.k; }

export function catBadge(c) {
  if (!c) return '';
  return `<span class="badge" style="--c:var(--cat-${c})"><span class="dot"></span>${esc(CATEGORIES[c].label)}</span>`;
}

/** URL d'une miniature Wikimedia Commons. */
export function commonsThumb(file, width = 640) {
  return `https://commons.wikimedia.org/w/index.php?title=Special:FilePath/${encodeURIComponent(file)}&width=${width}`;
}

export function commonsPage(file) {
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, '_'))}`;
}

export function wikiUrl(wp) {
  const m = /^([a-z-]+):(.+)$/.exec(wp || '');
  if (!m) return null;
  return `https://${m[1]}.wikipedia.org/wiki/${encodeURIComponent(m[2].replace(/ /g, '_'))}`;
}

export function osmUrl(id) {
  const t = { n: 'node', w: 'way', r: 'relation' }[id[0]];
  return t ? `https://www.openstreetmap.org/${t}/${id.slice(1)}` : null;
}

export const isOsm = (id) => /^[nwr]\d+$/.test(id);

let toastTimer;
export function toast(msg, ms = 4000) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Pictogrammes (traits) par type d'objet. */
const ICON_PATHS = {
  peak: '<path d="m3 20 7-13 4 7 2-3 5 9z"/>',
  volcano: '<path d="M3 20 9 9h6l6 11z"/><path d="M10 5c1-1 3-1 4 0"/>',
  col: '<path d="M2 18c4 0 5-9 10-9s6 9 10 9"/>',
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>',
  ferrata: '<path d="M7 3v18M17 3v18M7 8h10M7 13h10M7 18h10"/>',
  climbing: '<path d="M14 4a2 2 0 1 0 0 .1"/><path d="m6 21 3-6 3 1 1-5 4-2M9 10l3-1"/>',
  hut: '<path d="m3 11 9-7 9 7v9H3z"/><path d="M10 20v-5h4v5"/>',
  shelter: '<path d="M3 20 12 5l9 15"/><path d="M12 20v-6"/>',
  viewpoint: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  glacier: '<path d="M12 2v20M3 7l18 10M21 7 3 17"/>',
  place: '<path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
};
export function icon(k, { color = 'currentColor', size = 20, width = 2 } = {}) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[k] || ICON_PATHS.place}</svg>`;
}

/** Petites icônes des chiffres clés. */
export const FACT_ICONS = {
  km: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18 10 6l4 8 2-4 4 8"/></svg>',
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18l6-6 4 4 6-8"/><path d="M14 8h6v6"/></svg>',
  h: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  alt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 20 7-13 4 7 2-3 5 9z"/></svg>',
};

export const fmtKm = (n) => (n == null ? null : n < 10 ? n.toFixed(1).replace('.', ',') : String(Math.round(n)));
