// Pages massifs : liste des massifs et page d'un massif.
import { CATEGORIES } from '../lib/categories.js';
import { loadMeta, loadStats, loadCatalog, hrefFor } from '../data.js';
import { createMap, layersControl } from '../map.js';
import { cardHtml, rowHtml } from '../components/cards.js';
import { esc, num, icon, commonsThumb } from '../util.js';

export async function massifsPage(el, { alive }) {
  const [meta, stats] = await Promise.all([loadMeta(), loadStats()]);
  if (!alive()) return;
  document.title = 'Massifs · Mountains Road';
  const regions = (meta?.regions || []).filter((r) => r.total > 0);
  el.innerHTML = `<div class="wrap">
    <h1 class="page-title">Les massifs</h1>
    <p class="page-intro">Chaque massif collecté en détail : itinéraires avec dénivelés, sommets et leurs voies, refuges, via ferrata.</p>
    ${regions.length ? `<div class="grid">${regions.map((r) => {
      const s = stats?.regions?.find((x) => x.id === r.id)?.byKind || {};
      const img = stats?.photoPeaks?.find((p) => p.r === r.id)?.img;
      return `<a class="card massif-card" href="#/massif/${r.id}" style="--c:var(--brand-2)">
        <span class="card-media">${icon('peak', { size: 40, width: 1.6 })}${img ? `<img src="${esc(commonsThumb(img, 600))}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>
        <span class="card-body"><span class="card-title">${esc(r.name.split(' (')[0])}</span>
        <span class="card-sub">${esc(r.name.match(/\((.*)\)/)?.[1] || '')}</span>
        <span class="facts"><span class="f"><b>${num((s.route || 0) + (s.ferrata || 0))}</b> itinéraires</span><span class="f"><b>${num((s.peak || 0) + (s.volcano || 0))}</b> sommets</span><span class="f"><b>${num((s.hut || 0) + (s.shelter || 0))}</b> refuges</span></span></span></a>`;
    }).join('')}</div>` : '<div class="empty">Aucun massif collecté pour l’instant.</div>'}
    <p class="muted small" style="margin-top:20px">Ailleurs dans le monde, la <a href="#/carte">carte</a> interroge OpenStreetMap en direct.</p>
  </div>`;
}

export async function massifPage(el, { params: [id], alive }) {
  const meta = await loadMeta();
  if (!alive()) return;
  const r = meta?.regions?.find((x) => x.id === id);
  if (!r) { el.innerHTML = '<div class="wrap"><h1 class="page-title">Massif introuvable</h1><p><a class="btn" href="#/massifs">Tous les massifs</a></p></div>'; return; }
  document.title = `${r.name.split(' (')[0]} · Mountains Road`;
  el.innerHTML = `<div class="wrap"><p class="loading" style="margin-top:30px">Chargement du massif…</p></div>`;
  const list = await loadCatalog(id);
  if (!alive()) return;
  const peaks = list.filter((f) => f.k === 'peak' || f.k === 'volcano');
  const routes = list.filter((f) => f.k === 'route' || f.k === 'ferrata');
  const huts = list.filter((f) => f.k === 'hut' || f.k === 'shelter');
  const netRank = (f) => ({ iwn: 4, nwn: 3, rwn: 2, lwn: 1 }[f.net] || 0);
  const top = (arr, fn, n = 12) => arr.slice().sort(fn).slice(0, n);
  const famous = top(peaks, (a, b) => (b.sl || 0) - (a.sl || 0) || ((b.nr || 0) + (b.nc || 0)) - ((a.nr || 0) + (a.nc || 0)) || (b.e || 0) - (a.e || 0));
  const highest = top(peaks.filter((p) => p.e), (a, b) => b.e - a.e, 10);
  const byCat = Object.keys(CATEGORIES).filter((c) => c !== 'escalade').map((c) => [c, top(routes.filter((x) => x.c === c), (a, b) => netRank(b) - netRank(a) || (b.np || 0) - (a.np || 0) || (b.km || 0) - (a.km || 0), 12)]).filter(([, l]) => l.length);
  const kk = (k) => `#/explorer?massif=${id}&type=${k}`;

  el.innerHTML = `<div class="wrap">
    <nav class="crumbs"><a href="#/">Accueil</a><span aria-hidden="true">›</span><a href="#/massifs">Massifs</a><span aria-hidden="true">›</span><span>${esc(r.name.split(' (')[0])}</span></nav>
    <h1 class="page-title" style="margin-top:4px">${esc(r.name.split(' (')[0])}</h1>
    <p class="page-intro">${esc(r.name.match(/\((.*)\)/)?.[1] || '')}</p>
    <div class="kpis">
      <a class="kpi" href="${kk('routes')}" style="color:inherit"><div class="v">${num(routes.length)}</div><div class="l">itinéraires</div></a>
      <a class="kpi" href="${kk('peaks')}" style="color:inherit"><div class="v">${num(peaks.length)}</div><div class="l">sommets</div></a>
      <a class="kpi" href="${kk('huts')}" style="color:inherit"><div class="v">${num(huts.length)}</div><div class="l">refuges et abris</div></a>
      <a class="kpi" href="${kk('ferrata')}" style="color:inherit"><div class="v">${num(list.filter((f) => f.k === 'ferrata' || f.c === 'ferrata').length)}</div><div class="l">via ferrata</div></a>
    </div>
    <section class="section"><div style="position:relative"><div class="minimap tall" id="m-map"></div></div></section>
    ${famous.length ? `<section class="section"><div class="section-head"><div><h2>Sommets incontournables</h2></div><a href="${kk('peaks')}&sort=sl">Tous les sommets →</a></div><div class="scroller">${famous.map(cardHtml).join('')}</div></section>` : ''}
    ${byCat.map(([c, l]) => `<section class="section"><div class="section-head"><div><h2>${esc(CATEGORIES[c].label)}</h2><p>${esc(CATEGORIES[c].desc)}</p></div><a href="${kk('routes')}&cat=${c}">Tout voir →</a></div><div class="scroller">${l.map(cardHtml).join('')}</div></section>`).join('')}
    <div class="panels section">
      ${highest.length ? `<div><div class="section-head"><h2>Les plus hauts</h2></div><div class="rows">${highest.map((p) => rowHtml(p)).join('')}</div></div>` : ''}
      ${huts.length ? `<div><div class="section-head"><h2>Refuges</h2><a href="${kk('huts')}">Tous →</a></div><div class="rows">${top(huts.filter((h) => h.k === 'hut'), (a, b) => (b.e || 0) - (a.e || 0), 10).map((h) => rowHtml(h)).join('')}</div></div>` : ''}
    </div>
  </div>`;

  const box = el.querySelector('#m-map');
  const map = createMap(box, { scrollWheelZoom: false });
  layersControl(map, box.parentElement);
  const [s, w, n, e] = r.bbox;
  map.map.fitBounds([[s, w], [n, e]]);
  for (const f of [...famous, ...byCat.flatMap(([, l]) => l), ...top(huts, () => 0, 60)]) {
    map.marker(f, { onClick: () => { location.hash = hrefFor(f); } });
  }
  return () => map.destroy();
}
