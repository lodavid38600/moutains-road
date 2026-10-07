// Pages plein écran : statistiques, guide des difficultés, données.
import { CATEGORIES, KINDS, SAC_BY_T, FERRATA_SCALE, FERRATA_PLAIN } from './lib/categories.js';
import { store, isRoute } from './store.js';
import { barChart, histogram } from './charts.js';
import { $, esc, num, fmtKm, fetchJson } from './util.js';

let ctx = {};
export function initPages(context) {
  ctx = context;
  $('#page [data-close]').addEventListener('click', closePage);
}

export function openPage(name) {
  const page = $('#page');
  page.hidden = false;
  const titles = { stats: 'Statistiques', guide: 'Comprendre les difficultés', data: 'Les données' };
  $('#page-title').textContent = titles[name] || '';
  const body = $('#page-body');
  body.scrollTop = 0;
  if (name === 'stats') renderStats(body);
  if (name === 'guide') body.innerHTML = guideHtml();
  if (name === 'data') body.innerHTML = dataHtml();
}
export function closePage() { $('#page').hidden = true; }

// ---------------------------------------------------------------- stats
async function renderStats(body) {
  body.innerHTML = '<div class="wrap"><p class="loading">Calcul…</p></div>';
  let s = null, scope = 'Base complète';
  if (store.meta) s = await fetchJson('data/stats.json').catch(() => null);
  if (!s) { s = computeStats([...store.features.values()]); scope = 'Données chargées sur la carte'; }

  const k = s.byKind || {};
  const routes = (k.route || 0) + (k.ferrata || 0);
  const kpis = [
    [num(routes), 'itinéraires'], [num((k.peak || 0) + (k.volcano || 0)), 'sommets'],
    [num((k.hut || 0) + (k.shelter || 0)), 'refuges et abris'], [num(k.ferrata || 0), 'via ferrata'],
    [num(k.col || 0), 'cols'], [num(k.climbing || 0), 'sites d’escalade'],
  ];
  const catRows = Object.keys(CATEGORIES).map((c) => ({ label: CATEGORIES[c].short, value: s.byCategory?.[c] || 0, color: `var(--cat-${c})` })).filter((r) => r.value);
  const gainOrder = ['< 500 m', '500–800 m', '800–1 200 m', '1 200–2 000 m', '> 2 000 m'];
  const gainRows = gainOrder.map((l) => ({ label: l, value: s.byGain?.[l] || 0 }));
  const sacRows = [1, 2, 3, 4, 5, 6].map((t) => ({ label: `${SAC_BY_T[t].code} · ${['facile', 'montagne', 'raide', 'alpin', 'alpin exigeant', 'alpinisme'][t - 1]}`, value: s.bySac?.[t] || 0, color: `var(--cat-${t <= 2 ? 'rando' : t === 3 ? 'montagne' : t <= 5 ? 'alpine' : 'alpinisme'})` }));
  const altBins = Object.entries(s.peaksByAltitude || {}).map(([b, v]) => [+b, v]).sort((a, b) => a[0] - b[0]);
  const table = (rows, cols) => `<div class="table-scroll"><table class="tbl"><thead><tr>${cols.map(([l, , r]) => `<th class="${r ? 'r' : ''}">${l}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((f) => `<tr data-id="${esc(f.id)}" data-la="${f.la}" data-lo="${f.lo}">${cols.map(([, fn, r]) => `<td class="${r ? 'r' : ''}">${fn(f)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

  body.innerHTML = `<div class="wrap">
    <p class="muted">${esc(scope)}${store.meta ? ` · collecte du ${new Date(store.meta.generated).toLocaleDateString('fr-FR')}` : ''}</p>
    <div class="kpis">${kpis.map(([v, l]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('')}</div>
    <div class="panels">
      <div class="panel"><h3>Par activité</h3><p class="sub">Itinéraires et sommets, selon leur difficulté</p>${barChart(catRows)}</div>
      <div class="panel"><h3>Dénivelé des itinéraires</h3><p class="sub">Nombre d’itinéraires par tranche de D+</p>${barChart(gainRows)}</div>
      <div class="panel"><h3>Difficulté des itinéraires</h3><p class="sub">Passage le plus difficile (échelle SAC)</p>${barChart(sacRows)}</div>
      ${altBins.length ? `<div class="panel"><h3>Altitude des sommets</h3><p class="sub">Nombre de sommets par tranche de 500 m</p>${histogram(altBins.map(([b, v]) => ({ label: b >= 1000 ? `${b / 1000}k` : String(b), value: v })))}</div>` : ''}
    </div>
    <div class="panels">
      ${s.highest?.length ? `<div class="panel"><h3>Les plus hauts sommets</h3><p class="sub">Touchez une ligne pour ouvrir la fiche</p>${table(s.highest.slice(0, 50), [['Sommet', (f) => esc(f.n)], ['Pays', (f) => esc(f.cc || '')], ['Altitude', (f) => `${num(f.e)} m`, 1]])}</div>` : ''}
      ${s.biggestGain?.length ? `<div class="panel"><h3>Les plus gros dénivelés</h3><p class="sub">Itinéraires au D+ le plus important</p>${table(s.biggestGain.slice(0, 50), [['Itinéraire', (f) => esc(f.n)], ['Distance', (f) => (f.km ? `${fmtKm(f.km)} km` : '—'), 1], ['D+', (f) => `${num(f.up)} m`, 1]])}</div>` : ''}
      ${s.longest?.length ? `<div class="panel"><h3>Les plus longs itinéraires</h3><p class="sub">Grandes traversées et GR</p>${table(s.longest.slice(0, 50), [['Itinéraire', (f) => esc(f.n)], ['Distance', (f) => `${fmtKm(f.km)} km`, 1], ['D+', (f) => (f.up ? `${num(f.up)} m` : '—'), 1]])}</div>` : ''}
      ${s.famous?.length ? `<div class="panel"><h3>Les plus célèbres</h3><p class="sub">Selon le nombre d’articles Wikipedia</p>${table(s.famous.slice(0, 50), [['Nom', (f) => esc(f.n)], ['Type', (f) => esc(KINDS[f.k]?.label || '')], ['Langues', (f) => num(f.sl), 1]])}</div>` : ''}
    </div>
    ${s.regions?.length ? `<div class="panel"><h3>Par massif</h3><div class="table-scroll"><table class="tbl"><thead><tr><th>Massif</th><th class="r">Itinéraires</th><th class="r">Sommets</th><th class="r">Refuges</th><th class="r">Via ferrata</th></tr></thead><tbody>
      ${s.regions.map((r) => `<tr data-region="${esc(r.id)}" style="cursor:pointer"><td>${esc(r.name)}</td><td class="r">${num(r.byKind?.route || 0)}</td><td class="r">${num((r.byKind?.peak || 0) + (r.byKind?.volcano || 0))}</td><td class="r">${num(r.byKind?.hut || 0)}</td><td class="r">${num(r.byKind?.ferrata || 0)}</td></tr>`).join('')}
    </tbody></table></div></div>` : ''}
  </div>`;
  body.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => {
    closePage();
    ctx.openById?.(tr.dataset.id, +tr.dataset.la, +tr.dataset.lo);
  }));
  body.querySelectorAll('tr[data-region]').forEach((tr) => tr.addEventListener('click', () => {
    closePage();
    ctx.goRegion?.(s.regions.find((r) => r.id === tr.dataset.region));
  }));
}

/** Statistiques calculées dans le navigateur (sans collecte). */
function computeStats(all) {
  const count = (arr, fn) => arr.reduce((m, f) => { const k = fn(f); if (k != null) m[k] = (m[k] || 0) + 1; return m; }, {});
  const routes = all.filter(isRoute);
  const peaks = all.filter((f) => (f.k === 'peak' || f.k === 'volcano') && f.e);
  const alt = {};
  for (const p of peaks) { const b = Math.floor(p.e / 500) * 500; alt[b] = (alt[b] || 0) + 1; }
  return {
    byKind: count(all, (f) => f.k),
    byCategory: count(all, (f) => f.c),
    bySac: count(routes, (f) => f.t || null),
    byGain: count(routes.filter((r) => r.up != null), (r) => (r.up < 500 ? '< 500 m' : r.up < 800 ? '500–800 m' : r.up < 1200 ? '800–1 200 m' : r.up < 2000 ? '1 200–2 000 m' : '> 2 000 m')),
    peaksByAltitude: alt,
    highest: peaks.filter((p) => p.n).sort((a, b) => b.e - a.e).slice(0, 50),
    biggestGain: routes.filter((r) => r.up && r.n).sort((a, b) => b.up - a.up).slice(0, 50),
    longest: routes.filter((r) => r.km && r.n).sort((a, b) => b.km - a.km).slice(0, 50),
    famous: all.filter((f) => f.sl && f.n).sort((a, b) => b.sl - a.sl).slice(0, 50),
  };
}

// ---------------------------------------------------------------- guide
function guideHtml() {
  return `<div class="wrap prose">
  <p>Chaque itinéraire et chaque sommet est classé dans une <b>catégorie d’activité</b>, d’après la difficulté des sentiers saisie par les contributeurs d’OpenStreetMap. Les couleurs sont les mêmes partout sur le site.</p>
  <table class="tbl diff-table"><tbody>
    ${Object.entries(CATEGORIES).map(([c, d]) => `<tr><td><span class="badge" style="--c:var(--cat-${c})"><span class="dot"></span>${esc(d.label)}</span></td><td>${esc(d.desc)}</td></tr>`).join('')}
  </tbody></table>

  <h2>L’échelle de difficulté T1 à T6</h2>
  <p>C’est l’échelle du Club alpin suisse (SAC), la plus utilisée en Europe pour la randonnée. La difficulté d’un itinéraire est celle de son <b>passage le plus dur</b>.</p>
  <table class="tbl diff-table"><tbody>
    ${Object.values(SAC_BY_T).map((s) => `<tr><td>${s.code}</td><td><b>${esc(s.plain)}</b><br><span class="muted">${esc(s.label)}</span></td></tr>`).join('')}
  </tbody></table>

  <h2>Les via ferrata</h2>
  <table class="tbl diff-table"><tbody>
    ${Object.entries(FERRATA_SCALE).map(([k, v]) => `<tr><td>${esc(v.split(' ')[0])}</td><td><b>${esc(FERRATA_PLAIN[k])}</b><br><span class="muted">${esc(v)}</span></td></tr>`).join('')}
  </tbody></table>

  <h2>Le dénivelé (D+ et D−)</h2>
  <p>Le <b>D+</b> est le cumul de toutes les montées sur l’itinéraire ; le <b>D−</b> celui des descentes. Quand les contributeurs l’ont renseigné, on utilise leur valeur ; sinon on le calcule à partir du tracé et d’un modèle de terrain mondial (précision ~30 m), lissé pour ne pas compter les petites irrégularités.</p>
  <p>Repères : <b>moins de 500 m</b> de D+ convient à une sortie tranquille ; <b>800 à 1 200 m</b> est une belle journée de montagne ; <b>au-delà de 1 500 m</b>, il faut un bon entraînement.</p>

  <h2>La durée estimée</h2>
  <p>Calculée avec la méthode utilisée par les clubs alpins (norme DIN 33466) : <b>4 km/h</b> sur le plat, <b>300 m/h</b> de montée et <b>500 m/h</b> de descente, en combinant distance et dénivelé. Les pauses ne sont pas comptées.</p>

  <h2>L’accès aux sommets</h2>
  <p>Pour chaque sommet, on regarde les chemins cartographiés à moins de 150 m. S’il en existe un, le sommet est « accessible par un sentier » et prend la difficulté du chemin le plus facile. Sinon, c’est a priori un <b>terrain d’alpinisme</b> : pas de sentier, et souvent rocher ou glacier.</p>

  <h2>La météo</h2>
  <p>Les températures sont calculées <b>à l’altitude du sommet</b> (ou du point le plus haut de l’itinéraire). « Gel au-dessus de 2 800 m » correspond à l’altitude où la température passe sous 0 °C à midi : au-dessus, attention à la neige et au verglas.</p>
  <p class="muted">Ces informations proviennent de données ouvertes et peuvent être incomplètes. Renseignez-vous toujours sur les conditions du moment avant de partir.</p>
  </div>`;
}

// ---------------------------------------------------------------- données
function dataHtml() {
  const m = store.meta;
  return `<div class="wrap prose">
  <h2>D’où viennent les données ?</h2>
  <ul>
    <li><b><a href="https://www.openstreetmap.org" target="_blank" rel="noopener">OpenStreetMap</a></b> (ODbL) : itinéraires de randonnée, sentiers et leur difficulté, sommets, cols, refuges, abris, via ferrata, sites d’escalade.</li>
    <li><b><a href="https://www.wikidata.org" target="_blank" rel="noopener">Wikidata</a></b> (CC0) : sommets du monde entier, altitude, proéminence, massif, photo principale, articles Wikipedia.</li>
    <li><b>Wikipedia</b> et <b>Wikimedia Commons</b> (CC BY-SA) : descriptions et photos, chargées à l’ouverture d’une fiche.</li>
    <li><b><a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain Tiles</a></b> (AWS Open Data, Mapzen) : modèle de terrain pour calculer dénivelés et profils.</li>
    <li><b><a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a></b> (CC BY 4.0) : météo à 7 jours.</li>
  </ul>
  <h2>État de la collecte</h2>
  ${m ? `<p><b>${num(m.total)}</b> lieux et itinéraires, collectés le ${new Date(m.generated).toLocaleString('fr-FR')}.</p>
    <p>${Object.entries(m.byKind || {}).map(([k, v]) => `${esc(KINDS[k]?.plural || k)} : <b>${num(v)}</b>`).join(' · ')}</p>` :
    '<p>Aucune collecte n’est présente sur ce serveur : le site interroge OpenStreetMap <b>en direct</b> quand vous zoomez sur une zone. Pour disposer de toute la base hors ligne, lancez la collecte (ci-dessous).</p>'}
  <h2>Collecter les données</h2>
  <pre>npm run harvest          # Wikidata (monde) + OSM (massifs) + assemblage
npm run harvest:osm -- --regions=alpes-nord,pyrenees
npm run build:data
npm start                # http://localhost:8080</pre>
  <p>Les massifs collectés se règlent dans <code>scripts/regions.json</code>. Hors des massifs collectés, le bouton « Charger cette zone » interroge OpenStreetMap en direct.</p>
  </div>`;
}
