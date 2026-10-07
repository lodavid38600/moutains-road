// Page itinéraire : profil détaillé (pente, repères), étapes, variantes, sommets traversés.
import { NETWORKS, estimateHours, formatHours } from '../lib/categories.js';
import { getFeature, routeGeometry, db, hrefFor, loadTilesForBbox, featuresIn } from '../data.js';
import { mainLines, pointAt, placesAlong, bboxOf } from '../lib/along.js';
import { decode } from '../lib/polyline.js';
import { routeMetrics } from '../lib/dem.js';
import { browserDem } from '../dem-browser.js';
import { createMap, layersControl } from '../map.js';
import { profileChart, profileStats, statsHtml, stages, SERIES } from '../components/profile.js';
import { renderWeather } from '../components/weather.js';
import { heroPhotos, sectorGallery } from '../components/photos.js';
import { rowHtml } from '../components/cards.js';
import {
  crumbsHtml, keyFactsHtml, badgesHtml, subtitle, share, downloadGpx, aboutSection, nearbySection, deepHtml, sectionHtml, body,
} from '../components/detail-common.js';
import { esc, num, fmtKm } from '../util.js';

export async function routePage(el, { params: [id], query, alive }) {
  const ll = query.get('ll')?.split(',').map(Number) || [];
  el.innerHTML = '<div class="wrap"><p class="loading" style="margin-top:30px">Chargement de l’itinéraire…</p></div>';
  const f = await getFeature(id, ll[0], ll[1]);
  if (!alive()) return;
  if (!f) { el.innerHTML = '<div class="wrap"><h1 class="page-title">Itinéraire introuvable</h1><p><a class="btn" href="#/explorer?type=routes">Voir tous les itinéraires</a></p></div>'; return; }
  document.title = `${f.n || 'Itinéraire'} · Mountains Road`;
  const catVar = f.c ? `var(--cat-${f.c})` : 'var(--cat-none)';
  const tg = f.tg || {};
  const sub = [f.ref && f.ref !== f.n ? esc(f.ref) : '', f.net ? esc(NETWORKS[f.net] || '') : '', subtitle(f), tg.from || tg.to ? `${esc(tg.from || '?')} → ${esc(tg.to || '?')}` : '', f.loop ? 'Boucle' : ''].filter(Boolean).join(' · ');

  el.innerHTML = `<div id="r-hero"></div>
  <div class="wrap">
    ${crumbsHtml(f, { href: '#/explorer?type=routes' + (f.r ? `&massif=${f.r}` : ''), label: 'Itinéraires' })}
    <div class="detail-head">
      <div class="kind">${f.k === 'ferrata' ? 'Via ferrata' : 'Itinéraire balisé'}</div>
      <h1>${esc(f.n || 'Itinéraire')}</h1>
      ${sub ? `<div class="sub">${sub}</div>` : ''}
      <div class="badges" id="r-badges">${badgesHtml(f)}</div>
    </div>
    <div id="r-facts"></div>
    <div class="actions" id="r-actions">
      <a class="btn" href="#/carte?m=13/${f.la}/${f.lo}">Ouvrir sur la carte</a>
      <button class="btn" id="r-share">Partager</button>
    </div>
    <div class="detail-layout">
      <div class="detail-main">
        ${sectionHtml('r-profile', 'Profil d’altitude', 'Pente colorée, sommets, cols et refuges sur le parcours. Survolez la courbe pour suivre le tracé sur la carte.')}
        ${sectionHtml('r-stages', 'Étapes', 'Le parcours découpé aux refuges et points de passage.')}
        ${sectionHtml('r-variants', 'Tronçons et variantes', 'Chaque partie du tracé avec son propre profil.')}
        ${sectionHtml('r-peaks', 'Sommets et refuges sur le parcours')}
        ${sectionHtml('r-weather', 'Météo')}
        ${sectionHtml('r-about', 'À propos')}
        ${sectionHtml('r-photos', 'Photos du secteur')}
        ${sectionHtml('r-near', 'À proximité', 'Autres sommets, refuges et itinéraires près du tracé.')}
        <section class="section"><div class="section-head"><h2>Données détaillées</h2></div>${deepHtml(f, { method: [
          `<dt>Dénivelé</dt><dd>${f.upSrc === 'osm' ? 'Renseigné par les contributeurs OpenStreetMap' : 'Calculé sur le tracé avec un modèle de terrain (~30 m), lissé pour ignorer le bruit'}</dd>`,
          '<dt>Durée</dt><dd>Norme DIN 33466 : 4 km/h à plat, 300 m/h en montée, 500 m/h en descente (sans les pauses)</dd>',
          `<dt>Distance</dt><dd>${tg.distance ? 'Renseignée dans OpenStreetMap' : 'Mesurée sur le tracé principal (variantes courtes exclues)'}</dd>`,
        ] })}</section>
      </div>
      <aside class="detail-side">
        <div style="position:relative"><div class="minimap tall" id="r-map"></div></div>
        <div class="panel" id="r-side"></div>
      </aside>
    </div>
  </div>`;

  const hero = heroPhotos(el.querySelector('#r-hero'), f, catVar);
  el.querySelector('#r-share').addEventListener('click', () => share(f));
  const mapBox = el.querySelector('#r-map');
  const map = createMap(mapBox, { center: [f.la, f.lo], zoom: 12, scrollWheelZoom: false });
  layersControl(map, mapBox.parentElement);

  const facts = () => {
    const h = f.h ?? estimateHours(f.km, f.up, f.dn);
    el.querySelector('#r-facts').innerHTML = keyFactsHtml([
      [f.km != null ? fmtKm(f.km) : '—', f.km != null ? 'km' : '', 'Distance'],
      [f.up != null ? num(f.up) : '—', f.up != null ? 'm' : '', 'Dénivelé +'],
      [f.dn != null ? num(f.dn) : '—', f.dn != null ? 'm' : '', 'Dénivelé −'],
      [h ? formatHours(h) : '—', '', 'Durée estimée'],
      [f.emax != null ? num(f.emax) : '—', f.emax != null ? 'm' : '', 'Altitude max'],
    ]);
    el.querySelector('#r-badges').innerHTML = badgesHtml(f);
    el.querySelector('#r-side').innerHTML = `<h3>En bref</h3><dl class="kv">
      ${f.ref ? `<dt>Numéro</dt><dd>${esc(f.ref)}</dd>` : ''}
      ${f.net ? `<dt>Réseau</dt><dd>${esc(NETWORKS[f.net] || f.net)}</dd>` : ''}
      ${tg.operator ? `<dt>Gestionnaire</dt><dd>${esc(tg.operator)}</dd>` : ''}
      ${tg.symbol ? `<dt>Balisage</dt><dd>${esc(tg.symbol)}</dd>` : ''}
      ${f.emin != null ? `<dt>Point bas</dt><dd>${num(f.emin)} m</dd>` : ''}
      ${f.emax != null ? `<dt>Point haut</dt><dd>${num(f.emax)} m</dd>` : ''}
      <dt>Type</dt><dd>${f.loop ? 'Boucle' : 'Aller simple'}</dd>
    </dl>`;
  };
  facts();

  // Sections qui ne dépendent pas du tracé.
  aboutSection(body(el, 'r-about'), f);

  // ------------------------------------------------------------- tracé
  let g = await routeGeometry(f);
  if (!alive()) return () => map.destroy();
  if (!g && /^[rw]\d+$/.test(f.id)) {
    body(el, 'r-profile').innerHTML = '<p class="loading">Calcul du profil d’altitude…</p>';
    try {
      const ways = await import('../api.js').then((m) => m.osmGeometry(f.id));
      const m = await routeMetrics(ways, browserDem());
      if (m) { g = { g: m.geom, p: m.profile }; db.geoms.set(f.id, g); if (f.up == null) { const { applyMetrics } = await import('../lib/normalize.js'); applyMetrics(f, m); facts(); } }
    } catch { /* */ }
  }
  if (!g) {
    body(el, 'r-profile').innerHTML = '<p class="muted">Tracé indisponible.</p>';
    ['r-stages', 'r-variants', 'r-peaks'].forEach((s) => el.querySelector('#' + s)?.remove());
    map.marker(f, { scale: 1.4 });
    renderWeather(body(el, 'r-weather'), { la: f.la, lo: f.lo, alt: f.emax });
    nearbySection(body(el, 'r-near'), f, { radius: 3 });
    return () => map.destroy();
  }

  const lines = g.g.map((s) => decode(s));
  const main = mainLines(lines);
  const [s, w, n, e] = bboxOf(lines);
  map.line(lines, catVar.startsWith('var') ? getComputedStyle(document.documentElement).getPropertyValue(`--cat-${f.c || 'none'}`).trim() : catVar, { weight: 5 });
  if (main.length) {
    map.dot(pointAt(main, 0), getComputedStyle(document.documentElement).getPropertyValue('--cat-rando').trim(), { label: 'Départ' });
    if (!f.loop) map.dot(pointAt(main, main[main.length - 1].offset + main[main.length - 1].km), '#222', { label: 'Arrivée' });
  }
  map.fitPoints(lines.flat(), 24);

  // Lieux traversés : ceux de la collecte, sinon calculés avec les données chargées.
  await loadTilesForBbox([s - 0.02, w - 0.02, n + 0.02, e + 0.02], 12);
  if (!alive()) return () => map.destroy();
  let wp = (g.wp || []).map(([pid, km]) => ({ f: db.features.get(pid), km })).filter((x) => x.f);
  if (!g.wp) {
    const places = featuresIn([s - 0.01, w - 0.01, n + 0.01, e + 0.01]).filter((x) => x.n && ['peak', 'volcano', 'col', 'hut', 'shelter'].includes(x.k));
    wp = placesAlong(main, places, 0.15).map((x) => ({ f: db.features.get(x.id), km: x.km }));
  }
  const waypoints = wp.map(({ f: p, km }) => ({ km, label: p.n, kind: p.k, id: p.id }));
  for (const { f: p } of wp) map.marker(p, { onClick: () => { location.hash = hrefFor(p); } });

  // Profil détaillé.
  const profEl = body(el, 'r-profile');
  if (g.p?.length > 1) {
    profEl.innerHTML = '<div class="panel"><div id="r-chart"></div><div id="r-pstats"></div></div>';
    profileChart(profEl.querySelector('#r-chart'), {
      series: [{ label: f.n, profile: g.p }], waypoints, height: 300, totalUp: f.up ?? null,
      onHover: (d) => map.hover(d == null ? null : pointAt(main, d)),
    });
    profEl.querySelector('#r-pstats').innerHTML = statsHtml(profileStats(g.p), { km: f.km, up: f.up, dn: f.dn, min: f.emin, max: f.emax });
  } else {
    profEl.innerHTML = '<p class="muted">Altitudes indisponibles pour ce tracé.</p>';
  }

  el.querySelector('#r-actions').insertAdjacentHTML('afterbegin', '<button class="btn primary" id="r-gpx">Télécharger le GPX</button>');
  el.querySelector('#r-gpx').addEventListener('click', () => downloadGpx(f.n, lines, { waypoints: wp.map(({ f: p }) => ({ la: p.la, lo: p.lo, label: p.n })) }));
  const start = main.length ? pointAt(main, 0) : [f.la, f.lo];
  el.querySelector('#r-actions').insertAdjacentHTML('beforeend', `<a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=${start[0]},${start[1]}" target="_blank" rel="noopener">Aller au départ</a>`);

  // Étapes.
  const st = g.p?.length > 1 ? stages(g.p, waypoints) : [];
  if (st.length > 1) {
    body(el, 'r-stages').innerHTML = `<div class="panel table-scroll"><table class="tbl"><thead><tr><th>#</th><th>De → à</th><th class="r">Distance</th><th class="r">D+</th><th class="r">D−</th><th class="r">Durée</th><th class="r">Altitude d’arrivée</th></tr></thead><tbody>
      ${st.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.from)} → ${esc(x.to)}</td><td class="r">${fmtKm(x.km)} km</td><td class="r">${num(x.up)} m</td><td class="r">${num(x.dn)} m</td><td class="r">${formatHours(x.h)}</td><td class="r">${x.eTo != null ? num(Math.round(x.eTo)) + ' m' : '—'}</td></tr>`).join('')}
      </tbody></table></div>`;
  } else el.querySelector('#r-stages')?.remove();

  // Sommets et refuges traversés.
  if (wp.length) {
    const row = ({ f: p, km }) => rowHtml(p, { right: `km ${fmtKm(km)}<span>${p.e != null ? num(p.e) + ' m' : ''}</span>` });
    const box = body(el, 'r-peaks');
    box.innerHTML = `<div class="rows">${wp.slice(0, 12).map(row).join('')}</div>${wp.length > 12 ? `<div class="more"><button class="btn" id="r-more">Afficher les ${wp.length} lieux</button></div>` : ''}`;
    box.querySelector('#r-more')?.addEventListener('click', () => { box.innerHTML = `<div class="rows">${wp.map(row).join('')}</div>`; });
  } else el.querySelector('#r-peaks')?.remove();

  // Tronçons et variantes : un profil par tronçon (calculé à la demande).
  if (lines.length > 1) {
    const box = body(el, 'r-variants');
    box.innerHTML = '<p class="loading">Calcul des profils de chaque tronçon…</p>';
    const parts = [];
    for (const [i, l] of lines.slice(0, 6).entries()) {
      try {
        const m = await routeMetrics([l], browserDem());
        if (m?.profile?.length > 1) parts.push({ i, label: i === 0 ? 'Tracé principal' : `Tronçon ${i + 1}`, profile: m.profile, km: m.kmMain, up: m.up, dn: m.dn });
      } catch { /* */ }
    }
    if (!alive()) return () => map.destroy();
    if (parts.length > 1) {
      box.innerHTML = `<div class="panel"><div id="r-var-chart"></div>
        <div class="table-scroll" style="margin-top:12px"><table class="tbl"><thead><tr><th>Tronçon</th><th class="r">Distance</th><th class="r">D+</th><th class="r">D−</th></tr></thead><tbody>
        ${parts.map((p, k) => `<tr><td><span style="display:inline-block;width:12px;height:3px;border-radius:2px;background:${SERIES[k % 6]};margin-right:8px;vertical-align:middle"></span>${esc(p.label)}</td><td class="r">${fmtKm(p.km)} km</td><td class="r">${num(p.up)} m</td><td class="r">${num(p.dn)} m</td></tr>`).join('')}
        </tbody></table></div></div>`;
      profileChart(box.querySelector('#r-var-chart'), { series: parts.map((p, k) => ({ label: p.label, color: SERIES[k % 6], profile: p.profile })), height: 240 });
    } else el.querySelector('#r-variants')?.remove();
  } else el.querySelector('#r-variants')?.remove();

  // Météo au point le plus haut.
  let hi = [f.la, f.lo];
  if (g.p?.length) {
    const top = g.p.reduce((a, b) => (b[1] > a[1] ? b : a));
    hi = pointAt(main, top[0]) || hi;
  }
  renderWeather(body(el, 'r-weather'), { la: hi[0], lo: hi[1], alt: f.emax, where: f.emax ? `au point le plus haut du parcours (${num(f.emax)} m)` : '' });
  sectorGallery(body(el, 'r-photos'), { la: start[0], lo: start[1], radius: 2500, hero });
  nearbySection(body(el, 'r-near'), f, { refs: lines.flatMap((l) => l.filter((_, i) => i % 6 === 0)), radius: 1.5, kinds: ['peak', 'volcano', 'hut', 'shelter', 'route', 'ferrata', 'climbing'] });
  return () => map.destroy();
}
