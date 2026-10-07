// Page d'un lieu : refuge, abri, col, site d'escalade, point de vue, glacier…
import { KINDS } from '../lib/categories.js';
import { getFeature } from '../data.js';
import { createMap, layersControl } from '../map.js';
import { renderWeather } from '../components/weather.js';
import { heroPhotos, sectorGallery } from '../components/photos.js';
import {
  crumbsHtml, keyFactsHtml, badgesHtml, subtitle, share, aboutSection, nearbySection, deepHtml, sectionHtml, body,
} from '../components/detail-common.js';
import { esc, num } from '../util.js';

const SECTIONS = {
  hut: ['#/explorer?type=huts', 'Refuges'], shelter: ['#/explorer?type=huts', 'Refuges et abris'],
  col: ['#/explorer?type=cols', 'Cols'], climbing: ['#/explorer?type=climbing', 'Escalade'],
};
const yes = (v) => (v === 'yes' ? 'Oui' : v === 'no' ? 'Non' : v);

export async function placePage(el, { params: [id], query, alive }) {
  const ll = query.get('ll')?.split(',').map(Number) || [];
  el.innerHTML = '<div class="wrap"><p class="loading" style="margin-top:30px">Chargement…</p></div>';
  const f = await getFeature(id, ll[0], ll[1]);
  if (!alive()) return;
  if (!f) { el.innerHTML = '<div class="wrap"><h1 class="page-title">Lieu introuvable</h1><p><a class="btn" href="#/">Accueil</a></p></div>'; return; }
  // Un sommet ou un itinéraire a sa propre page.
  if (f.k === 'peak' || f.k === 'volcano') { location.replace(`#/sommet/${f.id}?ll=${f.la},${f.lo}`); return; }
  if (f.k === 'route' || f.k === 'ferrata') { location.replace(`#/itineraire/${f.id}?ll=${f.la},${f.lo}`); return; }
  document.title = `${f.n || KINDS[f.k]?.label} · Mountains Road`;
  const tg = f.tg || {};
  const [href, label] = SECTIONS[f.k] || ['#/explorer', 'Explorer'];

  const facts = [[f.e != null ? num(f.e) : '—', f.e != null ? 'm' : '', 'Altitude']];
  if (f.k === 'hut' || f.k === 'shelter') {
    facts.push([tg.beds || tg.capacity || '—', '', 'Places']);
    facts.push([tg.fee === 'no' ? 'Gratuit' : tg.fee === 'yes' ? 'Payant' : '—', '', 'Nuitée']);
    facts.push([tg.reservation === 'required' ? 'Obligatoire' : tg.reservation === 'yes' ? 'Possible' : tg.reservation === 'no' ? 'Non' : '—', '', 'Réservation']);
  }
  if (f.k === 'climbing') {
    facts.push([tg['climbing:routes'] || '—', '', 'Voies']);
    facts.push([[tg['climbing:grade:french:min'], tg['climbing:grade:french:max']].filter(Boolean).join(' → ') || tg['climbing:grade:french'] || '—', '', 'Cotations']);
    facts.push([tg['climbing:length'] || '—', '', 'Hauteur']);
  }
  const info = [
    ['Téléphone', tg.phone || tg['contact:phone']], ['E-mail', tg.email || tg['contact:email']],
    ['Ouverture', tg.opening_hours], ['Saison', tg.seasonal], ['Gestionnaire', tg.operator],
    ['Eau potable', yes(tg.drinking_water)], ['Toilettes', yes(tg.toilets)], ['Chauffage', yes(tg.heating)], ['Cheminée', yes(tg.fireplace)],
    ['Type d’abri', tg.shelter_type], ['Roche', tg['climbing:rock']], ['Orientation', tg['climbing:orientation']],
  ].filter(([, v]) => v);
  const site = tg.website || tg['contact:website'] || tg.url;

  el.innerHTML = `<div id="l-hero"></div>
  <div class="wrap">
    ${crumbsHtml(f, { href, label })}
    <div class="detail-head">
      <div class="kind">${esc(KINDS[f.k]?.label || '')}</div>
      <h1>${esc(f.n || KINDS[f.k]?.label)}</h1>
      ${subtitle(f) ? `<div class="sub">${subtitle(f)}</div>` : ''}
      <div class="badges">${badgesHtml(f)}</div>
    </div>
    ${keyFactsHtml(facts)}
    <div class="actions">
      ${site ? `<a class="btn primary" href="${esc(site)}" target="_blank" rel="noopener">Site officiel</a>` : ''}
      <a class="btn" href="#/carte?m=15/${f.la}/${f.lo}">Ouvrir sur la carte</a>
      <a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=${f.la},${f.lo}" target="_blank" rel="noopener">S’y rendre</a>
      <button class="btn" id="l-share">Partager</button>
    </div>
    <div class="detail-layout">
      <div class="detail-main">
        ${info.length ? `<section class="section"><div class="section-head"><h2>Informations pratiques</h2></div><div class="panel"><dl class="kv">${info.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div></section>` : ''}
        ${sectionHtml('l-routes', 'Itinéraires et sommets autour', 'Pour y monter ou partir de là.')}
        ${sectionHtml('l-weather', 'Météo', f.e ? `Prévisions à ${num(f.e)} m` : '')}
        ${sectionHtml('l-about', 'À propos')}
        ${sectionHtml('l-photos', 'Photos du secteur')}
        <section class="section"><div class="section-head"><h2>Données détaillées</h2></div>${deepHtml(f)}</section>
      </div>
      <aside class="detail-side"><div style="position:relative"><div class="minimap tall" id="l-map"></div></div></aside>
    </div>
  </div>`;

  const hero = heroPhotos(el.querySelector('#l-hero'), f, f.c ? `var(--cat-${f.c})` : 'var(--brand-2)');
  el.querySelector('#l-share').addEventListener('click', () => share(f));
  const mapBox = el.querySelector('#l-map');
  const map = createMap(mapBox, { center: [f.la, f.lo], zoom: 14, scrollWheelZoom: false });
  layersControl(map, mapBox.parentElement);
  map.marker(f, { scale: 1.5 });

  nearbySection(body(el, 'l-routes'), f, { radius: 4, kinds: ['route', 'ferrata', 'peak', 'volcano', 'hut', 'shelter', 'col'], max: 14 });
  renderWeather(body(el, 'l-weather'), { la: f.la, lo: f.lo, alt: f.e });
  aboutSection(body(el, 'l-about'), f);
  sectorGallery(body(el, 'l-photos'), { la: f.la, lo: f.lo, radius: 1000, hero, skip: f.img ? [f.img] : [] });
  return () => map.destroy();
}
