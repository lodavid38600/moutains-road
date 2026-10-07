// Mountains Road — point d'entrée : assemble la carte, la recherche, les catégories,
// la liste, la fiche et les filtres.
import { CATEGORIES, KINDS } from './lib/categories.js';
import { tileKey } from './lib/geo.js';
import {
  store, filters, setFilters, filtersChanged, onChange, DEFAULT_FILTERS, MAIN_CATS, activeFilterCount,
  loadMeta, loadTilesForBbox, loadTile, bboxCovered, loadLive, liveCovered, filtered, search, searchPlaces, altOf, isRoute,
} from './store.js';
import * as M from './map.js';
import { Sheet, isMobile } from './sheet.js';
import { initDetail, showDetail, currentFeature } from './detail.js';
import { initFilters, render as renderFilters } from './filters.js';
import { initPages, openPage } from './pages.js';
import { initLightbox } from './lightbox.js';
import { sortList, cardHtml } from './list.js';
import { $, $$, esc, num, meters, fmtKm, icon, toast, debounce } from './util.js';

// ------------------------------------------------------------------ thème
const THEMES = ['auto', 'light', 'dark'];
const THEME_NAMES = { auto: 'automatique', light: 'clair', dark: 'sombre' };
function applyTheme(t) {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  $('#theme-name').textContent = THEME_NAMES[t];
  try { localStorage.setItem('mr-theme', t); } catch { /* */ }
  M.getMap() && M.refreshIcons();
}
let theme = 'auto';
try { theme = localStorage.getItem('mr-theme') || 'auto'; } catch { /* */ }

// ------------------------------------------------------------------ état
let liveAuto = false;
let liveAbort = null;
const hashParams = () => new URLSearchParams(location.hash.slice(1));

const detailSheet = new Sheet($('#detail'), {
  snaps: [0.5, 1], initial: 0,
  onClose: () => { M.highlight(null); M.setHoverPoint(null); setHash(null); },
});
const listSheet = new Sheet($('#list-sheet'), { snaps: [0.4, 1], initial: 0 });

/** Décalage (px) dû aux panneaux qui couvrent la carte : [gauche, bas]. */
function panelOffset() {
  if (isMobile()) return [0, Math.max(detailSheet.visibleHeight(), listSheet.visibleHeight())];
  return detailSheet.open || listSheet.open ? [424, 0] : [0, 0];
}

// ------------------------------------------------------------------ carte
const hp = hashParams();
const ll = hp.get('ll')?.split(',').map(Number);
const view = hp.get('m')?.split('/').map(Number);
M.initMap('map', {
  center: view ? [view[1], view[2]] : ll || [45.95, 6.75],
  zoom: view ? view[0] : ll ? 13 : 9,
  onSelect: (f) => openFeature(f),
  onMove: debounce(onMapMove, 250),
});
applyTheme(theme);

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderMap(); });
}

function renderMap() {
  const list = filtered();
  M.renderMarkers(list);
  const inView = filtered(M.getBbox());
  $('#list-label').textContent = `Liste · ${num(inView.length)}`;
  if (listSheet.open) renderList(inView);
  updateFilterPill();
}

async function onMapMove(bbox, zoom) {
  if (zoom >= 7) await loadTilesForBbox(M.getBbox(0.2));
  updateLiveButton(bbox, zoom);
  if (liveAuto && zoom >= 12 && !bboxCovered(bbox) && !liveCovered(bbox)) runLive();
  else scheduleRender();
  // Position dans l'URL (sans écraser une fiche ouverte).
  const c = M.getMap().getCenter();
  const p = hashParams();
  p.set('m', `${zoom}/${c.lat.toFixed(4)}/${c.lng.toFixed(4)}`);
  history.replaceState(null, '', '#' + p.toString());
}

function updateLiveButton(bbox, zoom) {
  const btn = $('#btn-live');
  btn.hidden = !(zoom >= 11 && !liveCovered(liveBbox(bbox)) && !bboxCovered(bbox));
}

/** Zone interrogée en direct : la vue, limitée à ~0,35° de côté. */
function liveBbox([s, w, n, e]) {
  const max = 0.35;
  const cl = (s + n) / 2, co = (w + e) / 2;
  const hl = Math.min(max, n - s) / 2, ho = Math.min(max, e - w) / 2;
  return [cl - hl, co - ho, cl + hl, co + ho].map((x) => +x.toFixed(4));
}

async function runLive() {
  if (liveAbort) return;
  const bbox = liveBbox(M.getBbox());
  const status = $('#map-status');
  const btn = $('#btn-live');
  btn.disabled = true;
  liveAbort = new AbortController();
  const setStatus = (t) => { status.textContent = t; status.className = 'map-status show busy'; };
  setStatus('OpenStreetMap : chargement…');
  try {
    const r = await loadLive(bbox, { signal: liveAbort.signal, onProgress: (t) => setStatus(`OpenStreetMap : ${t}`) });
    status.className = 'map-status show';
    status.textContent = `${num(r.total)} lieux et itinéraires chargés`;
    setTimeout(() => status.classList.remove('show'), 2500);
  } catch (e) {
    status.className = 'map-status';
    toast(`Chargement impossible (${e.message}). Les serveurs OpenStreetMap sont peut-être saturés, réessayez dans un instant.`, 6000);
  } finally {
    liveAbort = null;
    btn.disabled = false;
    updateLiveButton(M.getBbox(), M.getMap().getZoom());
  }
}

// ------------------------------------------------------------------ catégories (accueil)
function renderCats() {
  $('#cats').innerHTML = MAIN_CATS.map((c) => `<button class="cat" data-cat="${c}" aria-pressed="${filters.cats.has(c)}" style="--c:var(--cat-${c})" title="${esc(CATEGORIES[c].desc)}"><span class="dot"></span>${esc(CATEGORIES[c].short)}</button>`).join('');
  $$('#cats .cat').forEach((b) => b.addEventListener('click', () => {
    const c = b.dataset.cat;
    filters.cats.has(c) ? filters.cats.delete(c) : filters.cats.add(c);
    // Via ferrata : on s'assure que le type est visible.
    if (c === 'ferrata') filters.kinds.add('ferrata');
    renderCats();
    filtersChanged();
  }));
}

function updateFilterPill() {
  const n = activeFilterCount();
  const pill = $('#filters-count');
  pill.hidden = !n;
  pill.textContent = n;
}

// ------------------------------------------------------------------ fiche
function setHash(f) {
  const p = hashParams();
  if (f) { p.set('f', f.id); p.set('ll', `${f.la},${f.lo}`); } else { p.delete('f'); p.delete('ll'); }
  history.replaceState(null, '', '#' + p.toString());
}

function openFeature(f) {
  if (!f) return;
  closePopovers();
  closeSearch();
  detailSheet.show(0);
  $('#detail .sheet-body').scrollTop = 0;
  setHash(f);
  showDetail(f);
}

async function openById(id, la, lo) {
  let f = store.features.get(id);
  if (!f && la != null) {
    await loadTile(tileKey(la, lo));
    f = store.features.get(id);
  }
  if (f) { openFeature(f); scheduleRender(); return; }
  if (la != null) {
    M.flyTo(la, lo, 14);
    toast('Ce lieu n’est pas dans les données chargées. Zoomez puis « Charger cette zone ».');
  }
}

// ------------------------------------------------------------------ liste
let listLimit = 60;
function renderList(list = filtered(M.getBbox())) {
  const sorted = sortList(list, $('#list-sort').value);
  $('#list-title').textContent = `${num(list.length)} résultat${list.length > 1 ? 's' : ''} dans cette zone`;
  $('#list').innerHTML = sorted.length ? sorted.slice(0, listLimit).map(cardHtml).join('') :
    `<div class="list-empty">Aucun résultat ici.<br>${store.meta || store.liveAreas.length ? 'Déplacez la carte ou assouplissez les filtres.' : 'Zoomez sur un massif puis touchez « Charger cette zone ».'}</div>`;
  $('#list-more').hidden = sorted.length <= listLimit;
}
$('#list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-id]');
  if (b) openFeature(store.features.get(b.dataset.id));
});
$('#list-more').addEventListener('click', () => { listLimit += 60; renderList(); });
$('#list-sort').addEventListener('change', () => { listLimit = 60; renderList(); });
$('#btn-list').addEventListener('click', () => {
  if (listSheet.open) { listSheet.close(); return; }
  listLimit = 60;
  detailSheet.close();
  listSheet.show(0);
  renderList();
});

// ------------------------------------------------------------------ recherche
const input = $('#search');
const results = $('#search-results');
let searchSeq = 0, activeIdx = -1;

function closeSearch() { results.hidden = true; activeIdx = -1; }

function resultMeta(r) {
  const bits = [KINDS[r.k]?.label];
  if (r.km) bits.push(`${fmtKm(r.km)} km`);
  if (r.up) bits.push(`↗ ${num(r.up)} m`);
  else if (r.e) bits.push(meters(r.e));
  return bits.filter(Boolean).map(esc).join(' · ');
}

const doSearch = debounce(async (q) => {
  const seq = ++searchSeq;
  if (q.trim().length < 2) { closeSearch(); return; }
  const found = await search(q, 12);
  if (seq !== searchSeq) return;
  render(found, null);
  if (q.trim().length >= 3) {
    const places = await searchPlaces(q);
    if (seq !== searchSeq) return;
    render(found, places);
  }
  function render(list, places) {
    const items = [];
    if (list.length) {
      items.push('<div class="sr-group">Montagne</div>');
      items.push(...list.map((r) => `<div class="sr-item" role="option" data-id="${esc(r.id)}" data-la="${r.la}" data-lo="${r.lo}">
        <span class="sr-ico" style="--c:var(--cat-${r.c || 'none'})">${icon(r.k, { color: `var(--cat-${r.c || 'none'})`, size: 18 })}</span>
        <span class="sr-txt"><div class="sr-name">${esc(r.n)}</div><div class="sr-meta">${resultMeta(r)}</div></span></div>`));
    }
    if (places?.length) {
      items.push('<div class="sr-group">Lieux</div>');
      items.push(...places.map((p, i) => `<div class="sr-item" role="option" data-place="${i}">
        <span class="sr-ico">${icon('place', { size: 18 })}</span>
        <span class="sr-txt"><div class="sr-name">${esc(p.name.split(',')[0])}</div><div class="sr-meta">${esc(p.name.split(',').slice(1, 4).join(','))}</div></span></div>`));
    }
    if (!items.length) items.push(`<div class="sr-empty">${places ? 'Aucun résultat.' : 'Recherche…'}</div>`);
    results.innerHTML = items.join('');
    results.hidden = false;
    activeIdx = -1;
    results._places = places || [];
  }
}, 180);

input.addEventListener('input', () => doSearch(input.value));
input.addEventListener('focus', () => { if (input.value.trim().length >= 2 && results.innerHTML) results.hidden = false; });
input.addEventListener('keydown', (e) => {
  const items = $$('.sr-item', results);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    activeIdx = Math.max(0, Math.min(items.length - 1, activeIdx + (e.key === 'ArrowDown' ? 1 : -1)));
    items.forEach((it, i) => it.setAttribute('aria-selected', i === activeIdx));
    items[activeIdx]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    (items[activeIdx] || items[0])?.click();
  } else if (e.key === 'Escape') { closeSearch(); input.blur(); }
});
results.addEventListener('click', (e) => {
  const it = e.target.closest('.sr-item');
  if (!it) return;
  input.blur();
  closeSearch();
  if (it.dataset.id) {
    openById(it.dataset.id, +it.dataset.la, +it.dataset.lo);
  } else {
    const p = results._places[+it.dataset.place];
    if (p.bbox) M.fitBbox([p.bbox[0], p.bbox[2], p.bbox[1], p.bbox[3]]);
    else M.flyTo(p.la, p.lo, 13);
  }
});
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.searchbar')) closeSearch(); });

// ------------------------------------------------------------------ filtres
const drawer = $('#filters');
function openFilters() {
  closePopovers();
  renderFilters();
  drawer.hidden = false;
  $('#btn-filters').setAttribute('aria-expanded', 'true');
  updateApplyLabel();
}
function closeFilters() { drawer.hidden = true; $('#btn-filters').setAttribute('aria-expanded', 'false'); }
function updateApplyLabel() {
  const n = filtered(M.getBbox()).length;
  $('#btn-apply').textContent = `Voir ${num(n)} résultat${n > 1 ? 's' : ''}`;
}
$('#btn-filters').addEventListener('click', () => (drawer.hidden ? openFilters() : closeFilters()));
$('#filters [data-close]').addEventListener('click', closeFilters);
$('#btn-apply').addEventListener('click', () => {
  closeFilters();
  detailSheet.close();
  listLimit = 60;
  listSheet.show(0);
  renderList();
});
$('#btn-reset').addEventListener('click', () => {
  setFilters(DEFAULT_FILTERS());
  renderCats();
  renderFilters();
  updateApplyLabel();
});

// ------------------------------------------------------------------ menus
function closePopovers() {
  $('#menu').hidden = true; $('#layers').hidden = true;
  $('#btn-menu').setAttribute('aria-expanded', 'false');
  $('#btn-layers').setAttribute('aria-expanded', 'false');
}
$('#btn-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  const open = $('#menu').hidden;
  closePopovers();
  $('#menu').hidden = !open;
  $('#btn-menu').setAttribute('aria-expanded', String(open));
});
$$('#menu [data-page]').forEach((b) => b.addEventListener('click', () => { closePopovers(); openPage(b.dataset.page); }));
$('#btn-theme').addEventListener('click', () => {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  applyTheme(theme);
});

function renderLayers() {
  const cur = M.currentBase();
  $('#layers').innerHTML = `<h3>Fond de carte</h3>
    <div class="base-grid">${M.BASES.map((b) => `<button class="base-opt" data-base="${b.id}" aria-pressed="${b.id === cur}"><img src="${esc(M.previewUrl(b))}" alt="" loading="lazy"><span>${esc(b.name)}</span></button>`).join('')}</div>
    <h3>Couches</h3>
    ${M.OVERLAYS.map((o) => `<label><input type="checkbox" data-ov="${o.id}" ${M.overlayOn(o.id) ? 'checked' : ''}> ${esc(o.name)}</label>`).join('')}`;
  $$('#layers [data-base]').forEach((b) => b.addEventListener('click', () => { M.setBase(b.dataset.base); renderLayers(); }));
  $$('#layers [data-ov]').forEach((i) => i.addEventListener('change', () => M.toggleOverlay(i.dataset.ov, i.checked)));
}
$('#btn-layers').addEventListener('click', (e) => {
  e.stopPropagation();
  const open = $('#layers').hidden;
  closePopovers();
  if (open) { renderLayers(); $('#layers').hidden = false; $('#btn-layers').setAttribute('aria-expanded', 'true'); }
});
$('#btn-locate').addEventListener('click', () => M.locate());
$('#btn-live').addEventListener('click', runLive);
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.popover, #btn-menu, #btn-layers')) closePopovers(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#lightbox').hidden) return;
  if (!$('#page').hidden) { $('#page').hidden = true; return; }
  if (!drawer.hidden) return closeFilters();
  if (!$('#menu').hidden || !$('#layers').hidden) return closePopovers();
  if (detailSheet.open) return detailSheet.close();
  if (listSheet.open) return listSheet.close();
});

// ------------------------------------------------------------------ démarrage
function goRegion(r) {
  if (!r) return;
  closeFilters();
  M.fitBbox(r.bbox);
}

initDetail({ open: openFeature, sheet: detailSheet, panelOffset });
initFilters({
  goRegion,
  liveAuto: () => liveAuto,
  setLiveAuto: (v) => { liveAuto = v; try { localStorage.setItem('mr-live', v ? '1' : '0'); } catch { /* */ } if (v) onMapMove(M.getBbox(), M.getMap().getZoom()); },
});
initPages({ openById, goRegion });
initLightbox();
renderCats();

onChange((what) => {
  scheduleRender();
  if (what === 'filters' && !drawer.hidden) updateApplyLabel();
});

(async () => {
  const meta = await loadMeta();
  try { liveAuto = (localStorage.getItem('mr-live') ?? (meta ? '0' : '1')) === '1'; } catch { liveAuto = !meta; }
  if (!meta) toast('Mode direct : les données sont chargées depuis OpenStreetMap quand vous zoomez sur une zone.', 6000);
  await onMapMove(M.getBbox(), M.getMap().getZoom());
  const id = hashParams().get('f');
  if (id) openById(id, ll?.[0], ll?.[1]);
})();

// Expose pour le débogage dans la console.
window.mountains = { store, filters, M, openById, currentFeature, altOf, isRoute };
