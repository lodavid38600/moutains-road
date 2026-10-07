// Accueil : recherche, activités, massifs, sommets emblématiques, sélections d'itinéraires.
import { CATEGORIES } from '../lib/categories.js';
import { loadMeta, loadStats } from '../data.js';
import { cardHtml } from '../components/cards.js';
import { esc, num, icon, commonsThumb, commonsPage } from '../util.js';
import { focusSearch } from '../app.js';

const ACT_ICONS = { rando: 'route', montagne: 'peak', alpine: 'peak', alpinisme: 'glacier', ferrata: 'ferrata' };

export async function homePage(el, { alive }) {
  const [meta, stats] = await Promise.all([loadMeta(), loadStats()]);
  if (!alive()) return;
  const hero = stats?.photoPeaks?.find((p) => p.img);
  const k = meta?.byKind || {};
  const cats = meta?.byCategory || {};
  document.title = 'Mountains Road · Randonnée et alpinisme';

  el.innerHTML = `
  <section class="hero" ${hero ? `style="background-image:url('${esc(commonsThumb(hero.img, 1920))}')"` : ''}>
    <div class="wrap">
      <h1>Trouvez votre prochaine sortie en montagne</h1>
      <p>Randonnées, sommets et toutes leurs voies d’ascension, via ferrata, alpinisme : distance, dénivelé, durée, difficulté et profils détaillés.</p>
      <form class="hero-search" role="search">
        <input type="search" placeholder="Un sommet, une randonnée, un refuge, un village…" aria-label="Rechercher">
        <button class="btn primary" type="submit">Rechercher</button>
      </form>
      ${meta ? `<div class="hero-stats">
        <span><b>${num((k.route || 0) + (k.ferrata || 0))}</b> itinéraires</span>
        <span><b>${num((k.peak || 0) + (k.volcano || 0))}</b> sommets</span>
        <span><b>${num((k.hut || 0) + (k.shelter || 0))}</b> refuges et abris</span>
        <span><b>${num(k.col || 0)}</b> cols</span></div>` : ''}
    </div>
    ${hero ? `<span class="hero-credit">Photo : <a href="${esc(commonsPage(hero.img))}" target="_blank" rel="noopener">${esc(hero.n)}, Wikimedia Commons</a></span>` : ''}
  </section>

  <div class="wrap">
    <section class="section">
      <div class="section-head"><div><h2>Que voulez-vous faire ?</h2><p>Cinq activités, classées selon la difficulté réelle des sentiers.</p></div><a href="#/guide">Comprendre les niveaux →</a></div>
      <div class="acts">${['rando', 'montagne', 'alpine', 'alpinisme', 'ferrata'].map((c) => `
        <a class="act" href="#/explorer?type=${c === 'alpinisme' ? 'peaks' : 'routes'}&cat=${c}" style="--c:var(--cat-${c})">
          <h3><span class="ico-chip" style="--c:var(--cat-${c})">${icon(ACT_ICONS[c], { size: 18 })}</span>${esc(CATEGORIES[c].label)}</h3>
          <p>${esc(CATEGORIES[c].desc)}</p>
          ${cats[c] ? `<span class="n">${num(cats[c])} itinéraires et sommets</span>` : ''}
        </a>`).join('')}</div>
    </section>

    <section class="section" id="h-massifs"></section>
    <section class="section" id="h-peaks"></section>
    <section class="section" id="h-short"></section>
    <section class="section" id="h-long"></section>
    <section class="section" id="h-cats"></section>
    ${!meta ? `<section class="section"><div class="empty">Aucune donnée collectée sur ce serveur pour l’instant : le site interroge OpenStreetMap en direct.
      <br><a class="btn" style="margin-top:12px" href="#/carte">Ouvrir la carte</a></div></section>` : ''}
  </div>`;

  const form = el.querySelector('.hero-search');
  form.addEventListener('submit', (e) => { e.preventDefault(); focusSearch(form.querySelector('input').value); });

  if (!stats) return;
  // Massifs.
  const regions = (meta.regions || []).filter((r) => r.total > 0);
  const regionPhoto = (id) => stats.photoPeaks?.find((p) => p.r === id)?.img;
  if (regions.length) {
    el.querySelector('#h-massifs').innerHTML = `
      <div class="section-head"><div><h2>Les massifs</h2><p>Sommets, itinéraires et refuges, massif par massif.</p></div><a href="#/massifs">Tous les massifs →</a></div>
      <div class="scroller">${regions.map((r) => {
        const s = stats.regions?.find((x) => x.id === r.id)?.byKind || {};
        const img = regionPhoto(r.id);
        return `<a class="card massif-card" href="#/massif/${r.id}" style="--c:var(--brand-2)">
          <span class="card-media">${icon('peak', { size: 40, width: 1.6 })}${img ? `<img src="${esc(commonsThumb(img, 480))}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>
          <span class="card-body"><span class="card-title">${esc(r.name.split(' (')[0])}</span>
          <span class="card-sub">${num((s.route || 0) + (s.ferrata || 0))} itinéraires · ${num((s.peak || 0) + (s.volcano || 0))} sommets · ${num(s.hut || 0)} refuges</span></span></a>`;
      }).join('')}</div>`;
  }
  const block = (sel, title, sub, list, more) => {
    if (!list?.length) return;
    el.querySelector(sel).innerHTML = `<div class="section-head"><div><h2>${title}</h2><p>${sub}</p></div>${more ? `<a href="${more}">Tout voir →</a>` : ''}</div>
      <div class="scroller">${list.map(cardHtml).join('')}</div>`;
  };
  block('#h-peaks', 'Sommets emblématiques', 'Les plus connus, avec toutes leurs voies d’ascension.', stats.photoPeaks?.slice(0, 16), '#/explorer?type=peaks&sort=sl');
  block('#h-short', 'Sorties de moins de 800 m de dénivelé', 'Des randonnées accessibles, à faire dans la journée.', stats.shortRoutes?.slice(0, 16), '#/explorer?type=routes&upmax=800&sort=up-asc');
  block('#h-long', 'Les grandes traversées', 'GR et itinéraires au long cours, étape par étape.', stats.longest?.slice(0, 16), '#/explorer?type=routes&sort=km-desc');
  // Une sélection par activité.
  const byCat = stats.byCategoryTop || {};
  const firstCats = ['montagne', 'alpine', 'ferrata'].filter((c) => byCat[c]?.length);
  el.querySelector('#h-cats').innerHTML = firstCats.map((c) => `
    <div class="section"><div class="section-head"><div><h2>${esc(CATEGORIES[c].label)}</h2><p>${esc(CATEGORIES[c].desc)}</p></div><a href="#/explorer?type=routes&cat=${c}">Tout voir →</a></div>
    <div class="scroller">${byCat[c].map(cardHtml).join('')}</div></div>`).join('');
}
