// Mountains Road — point d'entrée : en-tête (menu, recherche, thème), routeur et pages.
import { KINDS } from './lib/categories.js';
import { route, start, onRoute } from './router.js';
import { loadMeta, search, searchPlaces, hrefFor } from './data.js';
import { initLightbox } from './lightbox.js';
import { $, $$, esc, num, meters, fmtKm, icon, debounce } from './util.js';
import { resetIcons } from './map.js';
import { homePage } from './pages/home.js';
import { explorePage } from './pages/explore.js';
import { peakPage } from './pages/peak.js';
import { routePage } from './pages/route.js';
import { placePage } from './pages/place.js';
import { massifPage, massifsPage } from './pages/massif.js';
import { mapPage } from './pages/map.js';
import { guidePage, statsPage, dataPage } from './pages/info.js';

// ------------------------------------------------------------------ thème
const THEMES = ['auto', 'light', 'dark'];
let theme = 'auto';
try { theme = localStorage.getItem('mr-theme') || 'auto'; } catch { /* */ }
function applyTheme(t) {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  $('#btn-theme').title = `Thème : ${{ auto: 'automatique', light: 'clair', dark: 'sombre' }[t]}`;
  try { localStorage.setItem('mr-theme', t); } catch { /* */ }
  resetIcons();
}
applyTheme(theme);
$('#btn-theme').addEventListener('click', () => { theme = THEMES[(THEMES.indexOf(theme) + 1) % 3]; applyTheme(theme); });

// ------------------------------------------------------------------ menu
const nav = $('#main-nav');
$('#btn-burger').addEventListener('click', () => {
  const open = !nav.classList.contains('open');
  nav.classList.toggle('open', open);
  $('#btn-burger').setAttribute('aria-expanded', String(open));
});
onRoute(({ path, query }) => {
  nav.classList.remove('open');
  $('#btn-burger').setAttribute('aria-expanded', 'false');
  const type = query.get('type');
  const key = path.startsWith('/explorer') ? { peaks: 'sommets', huts: 'refuges' }[type] || 'explorer'
    : path.startsWith('/sommet') ? 'sommets' : path.startsWith('/itineraire') ? 'explorer'
      : path.startsWith('/massif') ? 'massifs' : path.slice(1).split('/')[0];
  $$('[data-nav]', nav).forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
  document.body.classList.toggle('page-map', path === '/carte');
  closeSearch();
});

// ------------------------------------------------------------------ recherche
const input = $('#search');
const results = $('#search-results');
let seq = 0, active = -1;
const closeSearch = () => { results.hidden = true; active = -1; };

function metaOf(r) {
  const bits = [KINDS[r.k]?.label];
  if (r.km) bits.push(`${fmtKm(r.km)} km`);
  if (r.up) bits.push(`D+ ${num(r.up)} m`);
  else if (r.e) bits.push(meters(r.e));
  return bits.filter(Boolean).map(esc).join(' · ');
}

const doSearch = debounce(async (q) => {
  const s = ++seq;
  if (q.trim().length < 2) { closeSearch(); return; }
  const found = await search(q, 10);
  if (s !== seq) return;
  draw(found, null);
  if (q.trim().length >= 3) {
    const places = await searchPlaces(q);
    if (s === seq) draw(found, places);
  }
  function draw(list, places) {
    const items = [];
    if (list.length) {
      items.push('<div class="sr-group">Montagne</div>');
      items.push(...list.map((r) => `<a class="sr-item" role="option" href="${hrefFor(r)}">
        <span class="sr-ico" style="--c:var(--cat-${r.c || 'none'})">${icon(r.k, { size: 18 })}</span>
        <span class="sr-txt"><div class="sr-name">${esc(r.n)}</div><div class="sr-meta">${metaOf(r)}</div></span></a>`));
    }
    if (places?.length) {
      items.push('<div class="sr-group">Lieux</div>');
      items.push(...places.map((p) => `<a class="sr-item" role="option" href="#/carte?m=13/${p.la.toFixed(4)}/${p.lo.toFixed(4)}">
        <span class="sr-ico">${icon('place', { size: 18 })}</span>
        <span class="sr-txt"><div class="sr-name">${esc(p.name.split(',')[0])}</div><div class="sr-meta">${esc(p.name.split(',').slice(1, 4).join(','))}</div></span></a>`));
    }
    if (!items.length) items.push(`<div class="sr-empty">${places ? 'Aucun résultat.' : 'Recherche…'}</div>`);
    results.innerHTML = items.join('');
    results.hidden = false;
    active = -1;
  }
}, 180);

input.addEventListener('input', () => doSearch(input.value));
input.addEventListener('focus', () => { if (input.value.trim().length >= 2 && results.innerHTML) results.hidden = false; });
input.addEventListener('keydown', (e) => {
  const items = $$('.sr-item', results);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    active = Math.max(0, Math.min(items.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
    items.forEach((it, i) => it.setAttribute('aria-selected', i === active));
    items[active]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    const it = items[active] || items[0];
    if (it) { location.hash = it.getAttribute('href'); input.blur(); }
  } else if (e.key === 'Escape') { closeSearch(); input.blur(); }
});
results.addEventListener('click', (e) => { if (e.target.closest('.sr-item')) { closeSearch(); input.blur(); } });
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.hd-search')) closeSearch(); });

/** La recherche de l'accueil réutilise celle de l'en-tête. */
export function focusSearch(q = '') {
  input.value = q;
  input.focus();
  if (q) doSearch(q);
}

// ------------------------------------------------------------------ pages
route(/^\/$/, homePage);
route(/^\/explorer$/, explorePage);
route(/^\/sommet\/([^/]+)$/, peakPage);
route(/^\/itineraire\/([^/]+)$/, routePage);
route(/^\/lieu\/([^/]+)$/, placePage);
route(/^\/massifs$/, massifsPage);
route(/^\/massif\/([^/]+)$/, massifPage);
route(/^\/carte$/, mapPage);
route(/^\/guide$/, guidePage);
route(/^\/statistiques$/, statsPage);
route(/^\/donnees$/, dataPage);

initLightbox();
loadMeta().then((m) => {
  if (m) $('#ft-date').textContent = `Données collectées le ${new Date(m.generated).toLocaleDateString('fr-FR')}.`;
});
start($('#app'));

// Hors ligne : service worker (sauf en développement local).
if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
