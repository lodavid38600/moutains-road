// Explorer : catalogue d'un massif, un onglet par type, filtres adaptés à chaque type.
import { CATEGORIES, SAC_BY_T, FERRATA_SCALE, NETWORKS, categoryFromSac } from '../lib/categories.js';
import { loadMeta, loadCatalog, hrefFor } from '../data.js';
import { setQuery } from '../router.js';
import { cardHtml, hoursOf } from '../components/cards.js';
import { createMap, layersControl } from '../map.js';
import { esc, num, normText, debounce } from '../util.js';

const TYPES = {
  routes: { label: 'Itinéraires', kinds: ['route', 'ferrata'] },
  peaks: { label: 'Sommets', kinds: ['peak', 'volcano'] },
  huts: { label: 'Refuges et abris', kinds: ['hut', 'shelter'] },
  ferrata: { label: 'Via ferrata', kinds: ['ferrata', 'route'], test: (f) => f.k === 'ferrata' || f.c === 'ferrata' },
  climbing: { label: 'Escalade', kinds: ['climbing'] },
  cols: { label: 'Cols', kinds: ['col'] },
};
const ofType = (type, f) => (TYPES[type].test ? TYPES[type].test(f) : TYPES[type].kinds.includes(f.k));

const SORTS = {
  routes: [['rel', 'Recommandés'], ['up-asc', 'D+ croissant'], ['up-desc', 'D+ décroissant'], ['km-asc', 'Plus courts'], ['km-desc', 'Plus longs'], ['h-asc', 'Plus rapides'], ['t-asc', 'Plus faciles'], ['alt-desc', 'Plus hauts']],
  peaks: [['sl', 'Les plus connus'], ['e-desc', 'Plus hauts'], ['e-asc', 'Moins hauts'], ['pr-desc', 'Plus proéminents'], ['voies', 'Plus de voies'], ['t-asc', 'Plus faciles d’accès']],
  huts: [['e-desc', 'Plus hauts'], ['e-asc', 'Moins hauts'], ['n', 'Nom']],
  ferrata: [['rel', 'Recommandées'], ['vf-asc', 'Plus faciles'], ['vf-desc', 'Plus difficiles'], ['km-asc', 'Plus courtes']],
  climbing: [['n', 'Nom'], ['e-desc', 'Plus hauts']],
  cols: [['e-desc', 'Plus hauts'], ['e-asc', 'Moins hauts'], ['n', 'Nom']],
};
const netRank = (f) => ({ iwn: 4, nwn: 3, rwn: 2, lwn: 1 }[f.net] || 0);
const tOf = (f) => f.t || f.acc?.t || null;
const altOf = (f) => f.e ?? f.emax ?? null;
const SORT_FN = {
  rel: (a, b) => netRank(b) - netRank(a) || (b.np || 0) - (a.np || 0) || (b.sl || 0) - (a.sl || 0) || (b.km || 0) - (a.km || 0),
  sl: (a, b) => (b.sl || 0) - (a.sl || 0) || ((b.nr || 0) + (b.nc || 0)) - ((a.nr || 0) + (a.nc || 0)) || (altOf(b) || 0) - (altOf(a) || 0),
  'up-asc': (a, b) => (a.up ?? 1e9) - (b.up ?? 1e9),
  'up-desc': (a, b) => (b.up ?? -1) - (a.up ?? -1),
  'km-asc': (a, b) => (a.km ?? 1e9) - (b.km ?? 1e9),
  'km-desc': (a, b) => (b.km ?? -1) - (a.km ?? -1),
  'h-asc': (a, b) => (hoursOf(a) ?? 1e9) - (hoursOf(b) ?? 1e9),
  't-asc': (a, b) => (tOf(a) ?? 9) - (tOf(b) ?? 9) || (a.up ?? 1e9) - (b.up ?? 1e9),
  'alt-desc': (a, b) => (altOf(b) ?? -1) - (altOf(a) ?? -1),
  'e-desc': (a, b) => (altOf(b) ?? -1) - (altOf(a) ?? -1),
  'e-asc': (a, b) => (altOf(a) ?? 1e9) - (altOf(b) ?? 1e9),
  'pr-desc': (a, b) => (b.pr ?? -1) - (a.pr ?? -1),
  voies: (a, b) => ((b.nr || 0) + (b.nc || 0)) - ((a.nr || 0) + (a.nc || 0)),
  'vf-asc': (a, b) => (a.vf ?? 9) - (b.vf ?? 9),
  'vf-desc': (a, b) => (b.vf ?? -1) - (a.vf ?? -1),
  n: (a, b) => (a.n || '').localeCompare(b.n || '', 'fr'),
};

const UP_PRESETS = [['< 500 m', null, 500], ['< 800 m', null, 800], ['< 1 200 m', null, 1200], ['> 1 200 m', 1200, null]];
const KM_PRESETS = [['< 5 km', null, 5], ['5–10 km', 5, 10], ['10–20 km', 10, 20], ['> 20 km', 20, null]];
const H_PRESETS = [['< 2 h', 2], ['< 4 h', 4], ['< 6 h', 6], ['< 9 h', 9]];
const ALT_PRESETS = [['< 1 500 m', null, 1500], ['1 500–2 500 m', 1500, 2500], ['2 500–3 500 m', 2500, 3500], ['> 3 500 m', 3500, null]];

/** État des filtres lu depuis l'URL. */
function readState(q) {
  const list = (k) => (q.get(k) ? q.get(k).split(',').filter(Boolean) : []);
  const n = (k) => (q.get(k) != null && q.get(k) !== '' && isFinite(+q.get(k)) ? +q.get(k) : null);
  return {
    type: TYPES[q.get('type')] ? q.get('type') : 'routes',
    massif: q.get('massif') || null,
    cat: list('cat'), net: list('net'), hk: list('hk'),
    tmax: n('tmax'), vfmax: n('vfmax'),
    upmin: n('upmin'), upmax: n('upmax'), kmmin: n('kmmin'), kmmax: n('kmmax'), hmax: n('hmax'),
    emin: n('emin'), emax: n('emax'), prmin: n('prmin'),
    loop: q.get('loop') === '1', photo: q.get('photo') === '1', voies: q.get('voies') === '1',
    q: q.get('q') || '', sort: q.get('sort') || '', map: q.get('map') === '1',
  };
}

function matches(f, S) {
  if (!ofType(S.type, f)) return false;
  if (S.q && !normText(f.n).includes(normText(S.q))) return false;
  if (S.cat.length) {
    const c = f.c || (f.acc && !f.acc.nw ? 'none' : f.c);
    if (!S.cat.includes(c || 'nc')) return false;
  }
  if (S.tmax != null) { const t = tOf(f); if (!t || t > S.tmax) return false; }
  if (S.vfmax != null && !(f.vf != null && f.vf <= S.vfmax)) return false;
  if (S.upmin != null && !(f.up >= S.upmin)) return false;
  if (S.upmax != null && !(f.up <= S.upmax)) return false;
  if (S.kmmin != null && !(f.km >= S.kmmin)) return false;
  if (S.kmmax != null && !(f.km <= S.kmmax)) return false;
  if (S.hmax != null) { const h = hoursOf(f); if (!(h <= S.hmax)) return false; }
  if (S.emin != null && !(altOf(f) >= S.emin)) return false;
  if (S.emax != null && !(altOf(f) <= S.emax)) return false;
  if (S.prmin != null && !(f.pr >= S.prmin)) return false;
  if (S.loop && !f.loop) return false;
  if (S.photo && !f.img) return false;
  if (S.voies && !((f.nr || 0) + (f.nc || 0))) return false;
  if (S.net.length && !S.net.includes(f.net || 'autre')) return false;
  if (S.hk.length && !S.hk.includes(f.k)) return false;
  return true;
}

export async function explorePage(el, { query, alive }) {
  const meta = await loadMeta();
  if (!alive()) return;
  const S = readState(query);
  const regions = (meta?.regions || []).filter((r) => r.total > 0);
  if (!S.massif) S.massif = regions.slice().sort((a, b) => b.total - a.total)[0]?.id || 'monde';
  if (S.massif === 'monde') S.type = 'peaks';
  if (!SORTS[S.type].some(([k]) => k === S.sort)) S.sort = SORTS[S.type][0][0];
  document.title = `${TYPES[S.type].label} · Mountains Road`;

  el.innerHTML = `<div class="wrap">
    <div class="explore-head">
      <div><h1 class="page-title">Explorer</h1><p class="page-intro">Tous les itinéraires, sommets et refuges d’un massif, avec des filtres adaptés à chaque activité.</p></div>
      <label>Massif
        <select class="sel" id="x-massif">${regions.map((r) => `<option value="${r.id}" ${r.id === S.massif ? 'selected' : ''}>${esc(r.name.split(' (')[0])}</option>`).join('')}
          <option value="monde" ${S.massif === 'monde' ? 'selected' : ''}>Sommets du monde</option></select>
      </label>
    </div>
    <nav class="type-tabs" id="x-tabs" aria-label="Type"></nav>
    <div class="explore${S.map ? ' with-map' : ''}" id="x-layout">
      <aside class="filters" id="x-filters" aria-label="Filtres"></aside>
      <section aria-label="Résultats">
        <div class="results-bar">
          <span class="count" id="x-count"><span class="loading">Chargement du catalogue…</span></span>
          <button class="btn small filters-toggle" id="x-ftoggle">Filtres</button>
          <label><span class="sr-only">Trier par</span><select class="sel" id="x-sort">${SORTS[S.type].map(([k, l]) => `<option value="${k}" ${k === S.sort ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <button class="btn small" id="x-maptoggle" aria-pressed="${S.map}">Carte</button>
        </div>
        <div class="active-filters" id="x-active"></div>
        <div class="grid" id="x-results"></div>
        <div class="more"><button class="btn" id="x-more" hidden>Afficher plus</button></div>
      </section>
      <div class="explore-map" id="x-map" ${S.map ? '' : 'hidden'}></div>
    </div>
  </div>`;

  const catalog = await loadCatalog(S.massif);
  if (!alive()) return;
  let limit = 24;
  let mapApi = null;

  const sync = () => setQuery({
    type: S.type, massif: S.massif, cat: S.cat, net: S.net, hk: S.hk, tmax: S.tmax, vfmax: S.vfmax,
    upmin: S.upmin, upmax: S.upmax, kmmin: S.kmmin, kmmax: S.kmmax, hmax: S.hmax, emin: S.emin, emax: S.emax,
    prmin: S.prmin, loop: S.loop ? 1 : null, photo: S.photo ? 1 : null, voies: S.voies ? 1 : null,
    q: S.q || null, sort: S.sort, map: S.map ? 1 : null,
  });

  const tabs = () => {
    el.querySelector('#x-tabs').innerHTML = Object.entries(TYPES)
      .filter(([t]) => S.massif !== 'monde' || t === 'peaks')
      .map(([t, d]) => {
        const n = catalog.filter((f) => ofType(t, f)).length;
        return n || t === S.type ? `<a href="#/explorer?type=${t}&massif=${S.massif}" class="${t === S.type ? 'active' : ''}">${d.label}<span class="n">${num(n)}</span></a>` : '';
      }).join('');
  };

  // ---------------------------------------------------------- filtres
  const chip = (attr, val, label, on, c) => `<button class="chip${c ? ' cat-chip' : ''}" data-${attr}="${val}" aria-pressed="${on}" ${c ? `style="--c:${c}"` : ''}>${c ? '<span class="dot"></span>' : ''}${label}</button>`;
  const preset = (key, label, min, max) => {
    const [kmin, kmax] = key === 'up' ? ['upmin', 'upmax'] : key === 'km' ? ['kmmin', 'kmmax'] : ['emin', 'emax'];
    const on = S[kmin] === min && S[kmax] === max;
    return `<button class="chip" data-preset="${key}" data-min="${min ?? ''}" data-max="${max ?? ''}" aria-pressed="${on}">${label}</button>`;
  };
  const range = (kmin, kmax, unit, step) => `<div class="inputs">
    <label>Min (${unit})<input type="number" inputmode="numeric" data-num="${kmin}" step="${step}" min="0" value="${S[kmin] ?? ''}"></label>
    <label>Max (${unit})<input type="number" inputmode="numeric" data-num="${kmax}" step="${step}" min="0" value="${S[kmax] ?? ''}"></label></div>`;
  const pool = catalog.filter((f) => ofType(S.type, f));
  const countBy = (fn) => pool.reduce((m, f) => { const k = fn(f); m[k] = (m[k] || 0) + 1; return m; }, {});

  const filtersHtml = () => {
    const g = [];
    g.push(`<div class="fg"><h3>Nom</h3><input type="search" class="sel" id="x-q" placeholder="Filtrer par nom…" value="${esc(S.q)}"></div>`);
    if (S.type === 'routes' || S.type === 'peaks') {
      const cc = countBy((f) => f.c || (f.acc && !f.acc.nw ? 'none' : 'nc'));
      const cats = ['rando', 'montagne', 'alpine', 'alpinisme', 'ferrata'].filter((c) => cc[c] || S.cat.includes(c));
      if (S.type === 'peaks' && (cc.none || S.cat.includes('none'))) cats.push('none');
      g.push(`<div class="fg"><h3>${S.type === 'peaks' ? 'Accès au sommet' : 'Activité'}${S.cat.length ? '<button class="link-btn" data-clear="cat">Effacer</button>' : ''}</h3>
        ${S.type === 'peaks' ? '<p class="help">D’après le sentier le plus facile qui mène au sommet.</p>' : ''}
        <div class="chips">${cats.map((c) => chip('cat', c, `${c === 'none' ? 'Hors sentier' : esc(CATEGORIES[c].short)} <span class="n">${num(cc[c] || 0)}</span>`, S.cat.includes(c), c === 'none' ? 'var(--cat-none)' : `var(--cat-${c})`)).join('')}</div></div>`);
      g.push(`<div class="fg"><h3>Difficulté maximale${S.tmax ? '<button class="link-btn" data-clear="tmax">Effacer</button>' : ''}</h3>
        <div class="tscale">${[1, 2, 3, 4, 5, 6].map((t) => `<button data-t="${t}" aria-pressed="${S.tmax != null && t <= S.tmax}" style="--c:var(--cat-${categoryFromSac(t)})">T${t}<small>${['facile', 'montagne', 'raide', 'alpin', 'alpin+', 'alpi.'][t - 1]}</small></button>`).join('')}</div>
        <div class="tscale-txt">${S.tmax ? `Jusqu’à <b>T${S.tmax}</b> : ${esc(SAC_BY_T[S.tmax].plain.toLowerCase())}` : 'Toutes les difficultés'}</div></div>`);
    }
    if (S.type === 'routes' || S.type === 'ferrata') {
      g.push(`<div class="fg"><h3>Dénivelé positif (D+)${S.upmin != null || S.upmax != null ? '<button class="link-btn" data-clear="up">Effacer</button>' : ''}</h3>
        <div class="chips">${UP_PRESETS.map(([l, a, b]) => preset('up', l, a, b)).join('')}</div>${range('upmin', 'upmax', 'm', 100)}</div>`);
      g.push(`<div class="fg"><h3>Distance${S.kmmin != null || S.kmmax != null ? '<button class="link-btn" data-clear="km">Effacer</button>' : ''}</h3>
        <div class="chips">${KM_PRESETS.map(([l, a, b]) => preset('km', l, a, b)).join('')}</div>${range('kmmin', 'kmmax', 'km', 1)}</div>`);
      g.push(`<div class="fg"><h3>Durée estimée${S.hmax ? '<button class="link-btn" data-clear="hmax">Effacer</button>' : ''}</h3>
        <div class="chips">${H_PRESETS.map(([l, h]) => chip('hmax', h, l, S.hmax === h)).join('')}</div></div>`);
    }
    if (S.type === 'ferrata') {
      g.push(`<div class="fg"><h3>Cotation maximale${S.vfmax != null ? '<button class="link-btn" data-clear="vfmax">Effacer</button>' : ''}</h3>
        <div class="chips">${[1, 2, 3, 4, 5, 6].map((v) => chip('vfmax', v, esc(FERRATA_SCALE[v].split(' ')[0]), S.vfmax === v)).join('')}</div></div>`);
    }
    if (S.type === 'routes') {
      const nc = countBy((f) => f.net || 'autre');
      g.push(`<div class="fg"><h3>Type de sentier${S.net.length ? '<button class="link-btn" data-clear="net">Effacer</button>' : ''}</h3>
        <div class="chips">${[...Object.entries(NETWORKS), ['autre', 'Non classé']].filter(([k]) => nc[k]).map(([k, l]) => chip('net', k, `${esc(l)} <span class="n">${num(nc[k])}</span>`, S.net.includes(k))).join('')}</div>
        <div class="toggles" style="margin-top:6px"><label><input type="checkbox" data-bool="loop" ${S.loop ? 'checked' : ''}> Boucles uniquement</label></div></div>`);
    }
    if (S.type !== 'routes' && S.type !== 'ferrata') {
      g.push(`<div class="fg"><h3>Altitude${S.emin != null || S.emax != null ? '<button class="link-btn" data-clear="e">Effacer</button>' : ''}</h3>
        <div class="chips">${ALT_PRESETS.map(([l, a, b]) => preset('e', l, a, b)).join('')}</div>${range('emin', 'emax', 'm', 100)}</div>`);
    }
    if (S.type === 'peaks') {
      g.push(`<div class="fg"><h3>Autres critères</h3><div class="toggles">
        <label><input type="checkbox" data-bool="voies" ${S.voies ? 'checked' : ''}> Avec des voies répertoriées</label>
        <label><input type="checkbox" data-bool="photo" ${S.photo ? 'checked' : ''}> Avec une photo</label></div>
        <div class="inputs"><label>Proéminence min. (m)<input type="number" data-num="prmin" step="100" min="0" value="${S.prmin ?? ''}"></label></div></div>`);
    }
    if (S.type === 'huts') {
      const hc = countBy((f) => f.k);
      g.push(`<div class="fg"><h3>Type</h3><div class="chips">${chip('hk', 'hut', `Refuges <span class="n">${num(hc.hut || 0)}</span>`, S.hk.includes('hut'))}${chip('hk', 'shelter', `Abris, cabanes <span class="n">${num(hc.shelter || 0)}</span>`, S.hk.includes('shelter'))}</div></div>`);
    }
    g.push('<div class="fg"><button class="btn small" id="x-reset">Réinitialiser les filtres</button></div>');
    g.push('<button class="btn primary filters-close" id="x-fclose">Voir les résultats</button>');
    return g.join('');
  };

  const toggleList = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const bindFilters = () => {
    const box = el.querySelector('#x-filters');
    box.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => { S.cat = toggleList(S.cat, b.dataset.cat); update(); }));
    box.querySelectorAll('[data-net]').forEach((b) => b.addEventListener('click', () => { S.net = toggleList(S.net, b.dataset.net); update(); }));
    box.querySelectorAll('[data-hk]').forEach((b) => b.addEventListener('click', () => { S.hk = toggleList(S.hk, b.dataset.hk); update(); }));
    box.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { const t = +b.dataset.t; S.tmax = S.tmax === t ? null : t; update(); }));
    box.querySelectorAll('[data-hmax]').forEach((b) => b.addEventListener('click', () => { const h = +b.dataset.hmax; S.hmax = S.hmax === h ? null : h; update(); }));
    box.querySelectorAll('[data-vfmax]').forEach((b) => b.addEventListener('click', () => { const v = +b.dataset.vfmax; S.vfmax = S.vfmax === v ? null : v; update(); }));
    box.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const [kmin, kmax] = { up: ['upmin', 'upmax'], km: ['kmmin', 'kmmax'], e: ['emin', 'emax'] }[b.dataset.preset];
      const min = b.dataset.min === '' ? null : +b.dataset.min, max = b.dataset.max === '' ? null : +b.dataset.max;
      const on = S[kmin] === min && S[kmax] === max;
      S[kmin] = on ? null : min; S[kmax] = on ? null : max;
      update();
    }));
    box.querySelectorAll('[data-num]').forEach((i) => i.addEventListener('change', () => { S[i.dataset.num] = i.value === '' ? null : +i.value; update(); }));
    box.querySelectorAll('[data-bool]').forEach((i) => i.addEventListener('change', () => { S[i.dataset.bool] = i.checked; update(); }));
    box.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () => { clear(b.dataset.clear); update(); }));
    box.querySelector('#x-q').addEventListener('input', debounce((e) => { S.q = e.target.value.trim(); update(false); }, 200));
    box.querySelector('#x-reset').addEventListener('click', () => { for (const k of ['cat', 'net', 'hk', 'tmax', 'vfmax', 'up', 'km', 'hmax', 'e', 'prmin', 'loop', 'photo', 'voies', 'q']) clear(k); update(); });
    box.querySelector('#x-fclose').addEventListener('click', () => box.classList.remove('open'));
  };
  const clear = (k) => {
    if (k === 'up') { S.upmin = S.upmax = null; } else if (k === 'km') { S.kmmin = S.kmmax = null; } else if (k === 'e') { S.emin = S.emax = null; }
    else if (['cat', 'net', 'hk'].includes(k)) S[k] = [];
    else if (['loop', 'photo', 'voies'].includes(k)) S[k] = false;
    else if (k === 'q') S.q = '';
    else S[k] = null;
  };

  // Récapitulatif des filtres actifs (cliquer pour retirer).
  const activeHtml = () => {
    const a = [];
    S.cat.forEach((c) => a.push(['cat:' + c, c === 'none' ? 'Hors sentier' : CATEGORIES[c]?.short]));
    if (S.tmax) a.push(['tmax', `Jusqu’à T${S.tmax}`]);
    if (S.upmin != null || S.upmax != null) a.push(['up', `D+ ${S.upmin != null ? '≥ ' + num(S.upmin) : ''}${S.upmin != null && S.upmax != null ? ' et ' : ''}${S.upmax != null ? '≤ ' + num(S.upmax) : ''} m`]);
    if (S.kmmin != null || S.kmmax != null) a.push(['km', `${S.kmmin != null ? '≥ ' + S.kmmin : ''}${S.kmmin != null && S.kmmax != null ? ' et ' : ''}${S.kmmax != null ? '≤ ' + S.kmmax : ''} km`]);
    if (S.hmax) a.push(['hmax', `Moins de ${S.hmax} h`]);
    if (S.emin != null || S.emax != null) a.push(['e', `Altitude ${S.emin != null ? '≥ ' + num(S.emin) : ''}${S.emin != null && S.emax != null ? ' et ' : ''}${S.emax != null ? '≤ ' + num(S.emax) : ''} m`]);
    if (S.vfmax != null) a.push(['vfmax', `Jusqu’à ${FERRATA_SCALE[S.vfmax].split(' ')[0]}`]);
    S.net.forEach((n) => a.push(['net:' + n, NETWORKS[n] || 'Non classé']));
    S.hk.forEach((n) => a.push(['hk:' + n, n === 'hut' ? 'Refuges' : 'Abris']));
    if (S.loop) a.push(['loop', 'Boucles']);
    if (S.photo) a.push(['photo', 'Avec photo']);
    if (S.voies) a.push(['voies', 'Avec voies']);
    if (S.prmin != null) a.push(['prmin', `Proéminence ≥ ${num(S.prmin)} m`]);
    if (S.q) a.push(['q', `« ${S.q} »`]);
    return a.map(([k, l]) => `<button data-rm="${esc(k)}" aria-label="Retirer le filtre ${esc(l)}">${esc(l)}</button>`).join('');
  };

  let current = [];
  const results = () => {
    current = catalog.filter((f) => matches(f, S)).sort(SORT_FN[S.sort] || SORT_FN.rel);
    const label = TYPES[S.type].label.toLowerCase();
    el.querySelector('#x-count').textContent = `${num(current.length)} ${current.length > 1 ? label : label.replace(/s(\b|$)/g, '$1')}`;
    el.querySelector('#x-results').innerHTML = current.length ? current.slice(0, limit).map(cardHtml).join('')
      : `<div class="empty" style="grid-column:1/-1">Aucun résultat avec ces filtres.<br><button class="btn small" style="margin-top:10px" id="x-reset2">Réinitialiser les filtres</button></div>`;
    el.querySelector('#x-reset2')?.addEventListener('click', () => el.querySelector('#x-reset').click());
    el.querySelector('#x-more').hidden = current.length <= limit;
    el.querySelector('#x-more').textContent = `Afficher plus (${num(current.length - limit)} restants)`;
    const act = el.querySelector('#x-active');
    act.innerHTML = activeHtml();
    act.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
      const [k, v] = b.dataset.rm.split(':');
      if (v) S[k] = S[k].filter((x) => x !== v); else clear(k);
      update();
    }));
    drawMap();
  };

  const drawMap = () => {
    if (!S.map) return;
    const box = el.querySelector('#x-map');
    if (!mapApi) {
      mapApi = createMap(box, { scrollWheelZoom: true });
      layersControl(mapApi, box);
    }
    mapApi.clear();
    const pts = [];
    for (const f of current.slice(0, 1500)) {
      mapApi.marker(f, { onClick: () => { location.hash = hrefFor(f); } });
      pts.push([f.la, f.lo]);
    }
    if (pts.length) mapApi.fitPoints(pts, 30);
    setTimeout(() => mapApi.invalidate(), 50);
  };

  function update(rerenderFilters = true) {
    limit = 24;
    sync();
    if (rerenderFilters) {
      const box = el.querySelector('#x-filters');
      const scroll = box.scrollTop;
      box.innerHTML = filtersHtml();
      bindFilters();
      box.scrollTop = scroll;
    }
    results();
  }

  el.querySelector('#x-massif').addEventListener('change', (e) => { location.hash = `#/explorer?type=${e.target.value === 'monde' ? 'peaks' : S.type}&massif=${e.target.value}`; });
  el.querySelector('#x-sort').addEventListener('change', (e) => { S.sort = e.target.value; update(false); });
  el.querySelector('#x-more').addEventListener('click', () => { limit += 24; results(); });
  el.querySelector('#x-ftoggle').addEventListener('click', () => el.querySelector('#x-filters').classList.add('open'));
  el.querySelector('#x-maptoggle').addEventListener('click', (e) => {
    S.map = !S.map;
    e.currentTarget.setAttribute('aria-pressed', S.map);
    el.querySelector('#x-layout').classList.toggle('with-map', S.map);
    el.querySelector('#x-map').hidden = !S.map;
    sync();
    drawMap();
  });

  tabs();
  if (!catalog.length) {
    el.querySelector('#x-count').textContent = '';
    el.querySelector('#x-results').innerHTML = `<div class="empty" style="grid-column:1/-1">${meta ? 'Ce massif n’a pas encore été collecté.' : 'Aucune donnée collectée sur ce serveur.'}<br>
      <a class="btn small" style="margin-top:10px" href="#/carte">Explorer la carte en direct</a></div>`;
    el.querySelector('#x-filters').innerHTML = '';
    return () => mapApi?.destroy();
  }
  update();
  return () => mapApi?.destroy();
}
