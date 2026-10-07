// Page sommet : toutes les manières d'y monter.
//  1. Voies calculées sur le réseau de sentiers (depuis parkings, refuges, accès routiers) ;
//  2. Itinéraires balisés qui passent par le sommet (portion jusqu'au sommet) ;
//  3. Voies d'alpinisme / escalade / randonnée référencées sur Camptocamp.
// Les voies sont comparées sur un même graphique et sur la carte.
import { KINDS, SAC_BY_T, FERRATA_SCALE, plainDifficulty, accessSentence, estimateHours, formatHours, categoryFromSac } from '../lib/categories.js';
import { getFeature, routeGeometry, db, hrefFor } from '../data.js';
import { runOverpass } from '../lib/overpass.js';
import { ascentQuery, findAscents } from '../lib/ascent.js';
import { applyPeakAccess } from '../lib/normalize.js';
import { mainLines, pointAt, placesAlong } from '../lib/along.js';
import { decode } from '../lib/polyline.js';
import { browserDem } from '../dem-browser.js';
import * as api from '../api.js';
import { createMap, layersControl } from '../map.js';
import { profileChart, sparkSvg, profileStats, statsHtml, SERIES } from '../components/profile.js';
import { renderWeather } from '../components/weather.js';
import { heroPhotos, sectorGallery } from '../components/photos.js';
import {
  crumbsHtml, keyFactsHtml, badgesHtml, subtitle, share, downloadGpx, aboutSection, nearbySection, deepHtml, sectionHtml, body,
} from '../components/detail-common.js';
import { esc, num, fmtKm, icon } from '../util.js';

const C2C_ACT = {
  hiking: 'Randonnée', mountain_climbing: 'Alpinisme', rock_climbing: 'Escalade', snow_ice_mixed: 'Neige, glace, mixte',
  ice_climbing: 'Cascade de glace', skitouring: 'Ski de randonnée', snowshoeing: 'Raquettes', via_ferrata: 'Via ferrata',
  mountain_biking: 'VTT', paragliding: 'Parapente', slacklining: 'Slackline',
};
const ORIENT = { N: 'nord', NE: 'nord-est', E: 'est', SE: 'sud-est', S: 'sud', SW: 'sud-ouest', W: 'ouest', NW: 'nord-ouest' };
const c2cRating = (r) => [r.g, r.hk, r.rk, r.vf, r.sk && `ski ${r.sk}`].filter(Boolean).join(' · ');
const cacheKey = (id) => `mr-asc-v1:${id}`;

export async function peakPage(el, { params: [id], query, alive }) {
  const ll = query.get('ll')?.split(',').map(Number) || [];
  el.innerHTML = '<div class="wrap"><p class="loading" style="margin-top:30px">Chargement du sommet…</p></div>';
  const f = await getFeature(id, ll[0], ll[1]);
  if (!alive()) return;
  if (!f) { el.innerHTML = '<div class="wrap"><h1 class="page-title">Sommet introuvable</h1><p><a class="btn" href="#/explorer?type=peaks">Voir tous les sommets</a></p></div>'; return; }
  document.title = `${f.n || 'Sommet'} · Mountains Road`;
  const catVar = f.c ? `var(--cat-${f.c})` : 'var(--cat-none)';

  el.innerHTML = `<div id="p-hero"></div>
  <div class="wrap">
    ${crumbsHtml(f, { href: '#/explorer?type=peaks' + (f.r ? `&massif=${f.r}` : ''), label: 'Sommets' })}
    <div class="detail-head">
      <div class="kind">${esc(KINDS[f.k]?.label)}${f.cc ? ` · ${esc(f.cc)}` : ''}</div>
      <h1>${esc(f.n || 'Sommet sans nom')}</h1>
      ${subtitle(f) ? `<div class="sub">${subtitle(f)}</div>` : ''}
      <div class="badges" id="p-badges">${badgesHtml(f)}</div>
    </div>
    <div id="p-facts"></div>
    <div class="actions">
      <a class="btn primary" href="#p-voies">Voir les voies d’ascension</a>
      <a class="btn" href="#/carte?m=14/${f.la}/${f.lo}">Ouvrir sur la carte</a>
      <a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=${f.la},${f.lo}" target="_blank" rel="noopener">S’y rendre</a>
      <button class="btn" id="p-share">Partager</button>
    </div>
    <div class="detail-layout">
      <div class="detail-main">
        ${sectionHtml('p-voies', 'Voies d’ascension', 'Toutes les manières connues d’atteindre le sommet, comparées.')}
        ${sectionHtml('p-access', 'Accès au sommet')}
        ${sectionHtml('p-weather', 'Météo au sommet', f.e ? `Prévisions à ${num(f.e)} m` : '')}
        ${sectionHtml('p-about', 'À propos')}
        ${sectionHtml('p-photos', 'Photos du secteur')}
        ${sectionHtml('p-near', 'À proximité', 'Refuges, cols, sommets voisins et itinéraires.')}
        <section class="section"><div class="section-head"><h2>Données détaillées</h2></div>${deepHtml(f, { method: ['<dt>Accès</dt><dd>Chemins OpenStreetMap à moins de 150 m du sommet ; le plus facile détermine la catégorie</dd>', '<dt>Voies calculées</dt><dd>Plus courts chemins sur le réseau de sentiers OSM depuis les parkings, refuges et routes à moins de 7 km ; dénivelé mesuré sur un modèle de terrain (~30 m)</dd>'] })}</section>
      </div>
      <aside class="detail-side">
        <div style="position:relative"><div class="minimap tall" id="p-map"></div></div>
        <div class="panel" id="p-side"></div>
      </aside>
    </div>
  </div>`;

  const hero = heroPhotos(el.querySelector('#p-hero'), f, catVar);
  el.querySelector('#p-share').addEventListener('click', () => share(f));
  const mapBox = el.querySelector('#p-map');
  const map = createMap(mapBox, { center: [f.la, f.lo], zoom: 13, scrollWheelZoom: false });
  layersControl(map, mapBox.parentElement);
  map.marker(f, { scale: 1.5, tooltip: true });

  const facts = () => {
    if (!alive()) return;
    const acc = plainDifficulty(f);
    const nVoies = (f.rts?.length || 0) + (f.nc || 0) + (voies.computed?.length || 0);
    el.querySelector('#p-facts').innerHTML = keyFactsHtml([
      [f.e != null ? num(f.e) : '—', f.e != null ? 'm' : '', 'Altitude'],
      [f.pr != null ? num(f.pr) : '—', f.pr != null ? 'm' : '', 'Proéminence'],
      [acc ? acc.code : f.acc ? (f.acc.nw ? 'Sentier' : 'Hors sentier') : '—', '', 'Accès le plus facile'],
      [nVoies ? num(nVoies) : '…', '', 'Voies répertoriées'],
    ]);
    el.querySelector('#p-badges').innerHTML = badgesHtml(f);
  };
  const voies = { computed: null, marked: [], all: [], pending: true };
  facts();

  // Panneau latéral : fiche d'identité.
  el.querySelector('#p-side').innerHTML = `<h3>En bref</h3><dl class="kv">
    ${f.e != null ? `<dt>Altitude</dt><dd>${num(f.e)} m</dd>` : ''}
    ${f.pr != null ? `<dt>Proéminence</dt><dd>${num(f.pr)} m</dd>` : ''}
    ${f.rg ? `<dt>Massif</dt><dd>${esc(f.rg)}</dd>` : ''}
    ${f.cc ? `<dt>Pays</dt><dd>${esc(f.cc)}</dd>` : ''}
    <dt>Coordonnées</dt><dd>${f.la.toFixed(5)}, ${f.lo.toFixed(5)}</dd>
    ${f.tg?.['summit:cross'] === 'yes' ? '<dt>Croix sommitale</dt><dd>Oui</dd>' : ''}
    ${f.sl ? `<dt>Notoriété</dt><dd>Article Wikipedia en ${f.sl} langue${f.sl > 1 ? 's' : ''}</dd>` : ''}
  </dl>`;

  // ------------------------------------------------------------- accès
  const accessEl = body(el, 'p-access');
  const drawAccess = () => {
    if (!alive()) return;
    const a = accessSentence(f);
    accessEl.innerHTML = a ? `<div class="access" style="--c:var(--cat-${a.c})"><span class="ico-chip">${icon('peak', { size: 18 })}</span>
      <div><b>${esc(a.text)}</b><span>${esc(a.detail)}</span></div></div>
      <p class="muted small" style="margin-top:8px">D’après les chemins cartographiés à moins de 150 m du sommet. Vérifiez toujours les conditions (neige, glace, orages) avant de partir.</p>`
      : '<p class="loading">Analyse des sentiers autour du sommet…</p>';
  };
  drawAccess();
  if (!f.acc) {
    api.pathsAround(f.la, f.lo, 150).then((ways) => { applyPeakAccess(f, ways); drawAccess(); facts(); }).catch(() => {
      accessEl.innerHTML = '<p class="muted">Analyse indisponible pour le moment.</p>';
    });
  }

  // ------------------------------------------------------------- sections indépendantes (lancées tout de suite)
  renderWeather(body(el, 'p-weather'), { la: f.la, lo: f.lo, alt: f.e, where: f.e ? `pour l’altitude du sommet (${num(f.e)} m)` : '' });
  aboutSection(body(el, 'p-about'), f).then((s) => { if (!f.img && s?.thumb) hero.add([{ thumb: s.thumb, page: s.url }]); });
  sectorGallery(body(el, 'p-photos'), { la: f.la, lo: f.lo, radius: 1500, hero, skip: f.img ? [f.img] : [] });
  nearbySection(body(el, 'p-near'), f, { radius: 5 });

  // ------------------------------------------------------------- voies
  const voiesEl = body(el, 'p-voies');
  voiesEl.innerHTML = `
    <div id="v-status"><p class="loading">Recherche des voies : itinéraires balisés et réseau de sentiers autour du sommet…</p></div>
    <div id="v-compare"></div>
    <div class="ascents" id="v-list"></div>
    <div id="v-detail"></div>
    <div id="v-c2c"></div>`;
  let selected = null;
  const lineLayers = new Map();

  const drawList = () => {
    const all = voies.all;
    el.querySelector('#v-list').innerHTML = all.map((v, i) => {
      const d = v.t ? `<span class="badge" style="--c:var(--cat-${categoryFromSac(v.t)})"><span class="dot"></span>${SAC_BY_T[v.t].code} · ${esc(SAC_BY_T[v.t].plain)}</span>` : v.vf != null ? `<span class="badge" style="--c:var(--cat-ferrata)"><span class="dot"></span>Via ferrata ${esc(FERRATA_SCALE[v.vf].split(' ')[0])}</span>` : '<span class="badge plain">Difficulté non renseignée</span>';
      return `<button class="ascent" data-i="${i}" aria-pressed="${selected === i}" style="--sc:${v.color}">
        <span class="bar"></span>
        <span class="txt">
          <span class="ttl">${esc(v.title)} <small>${esc(v.kindLabel)}</small></span>
          <span class="facts">
            <span class="f"><b>${fmtKm(v.km)}</b> km aller</span>
            ${v.up != null ? `<span class="f">D+ <b>${num(v.up)}</b> m</span>` : ''}
            ${v.hUp ? `<span class="f">montée <b>${formatHours(v.hUp)}</b></span>` : ''}
            ${v.hRound ? `<span class="f muted">aller-retour ${formatHours(v.hRound)}</span>` : ''}
          </span>
          <span class="badges">${d}${v.startEle != null ? `<span class="badge plain">Départ à ${num(v.startEle)} m</span>` : ''}</span>
        </span>
        <span class="spark">${sparkSvg(v.profile, v.color)}</span>
      </button>`;
    }).join('');
    el.querySelectorAll('#v-list .ascent').forEach((b) => b.addEventListener('click', () => select(+b.dataset.i)));
  };

  const drawCompare = () => {
    const box = el.querySelector('#v-compare');
    const withProfile = voies.all.filter((v) => v.profile?.length > 1).slice(0, 6);
    if (withProfile.length < 2) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="panel" style="margin-bottom:14px"><h3>Comparaison des profils</h3><p class="muted small" style="margin:-6px 0 8px">Altitude selon la distance depuis le départ de chaque voie, jusqu’au sommet.</p><div id="v-chart"></div></div>';
    profileChart(box.querySelector('#v-chart'), { series: withProfile.map((v) => ({ label: v.title, color: v.color, profile: v.profile })), height: 280 });
  };

  const drawMapLines = () => {
    for (const g of lineLayers.values()) map.groups.lines.removeLayer(g);
    lineLayers.clear();
    const pts = [[f.la, f.lo]];
    voies.all.forEach((v, i) => {
      if (!v.lines?.length) return;
      const g = map.line(v.lines, v.color, { weight: selected === i ? 6 : 4, halo: true, onClick: () => select(i) });
      lineLayers.set(i, g);
      if (v.start) map.dot(v.start, v.color, { label: v.title, group: g, r: 6 });
      pts.push(...v.lines.flat());
    });
    if (pts.length > 1) map.fitPoints(pts, 30);
  };

  function select(i) {
    selected = selected === i ? null : i;
    el.querySelectorAll('#v-list .ascent').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.i === selected)));
    drawMapLines();
    const box = el.querySelector('#v-detail');
    if (selected == null) { box.innerHTML = ''; return; }
    const v = voies.all[selected];
    const main = mainLines(v.lines || []);
    const wps = (v.waypoints || []);
    box.innerHTML = `<div class="panel" style="margin-top:14px">
      <div class="section-head" style="margin-bottom:6px"><div><h3 style="margin:0">${esc(v.title)}</h3><p class="small">${esc(v.kindLabel)}</p></div>
        <div class="actions" style="margin:0">${v.href ? `<a class="btn small" href="${v.href}">Fiche de l’itinéraire</a>` : ''}<button class="btn small" id="v-gpx">GPX</button></div></div>
      <div id="v-profile"></div>${statsHtml(profileStats(v.profile), { km: v.km })}</div>`;
    if (v.profile?.length > 1) {
      profileChart(box.querySelector('#v-profile'), {
        series: [{ label: v.title, profile: v.profile }], waypoints: wps, height: 240,
        onHover: (d) => map.hover(d == null || !main.length ? null : pointAt(main, d)),
      });
    }
    box.querySelector('#v-gpx').addEventListener('click', () => downloadGpx(`${f.n} – ${v.title}`, v.lines, { waypoints: [{ la: f.la, lo: f.lo, label: f.n }] }));
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  const finish = () => {
    if (!alive()) return;
    voies.all = [...(voies.computed || []), ...voies.marked].map((v, i) => ({ ...v, color: SERIES[i % SERIES.length] }));
    facts();
    const st = el.querySelector('#v-status');
    const nC = voies.computed?.length || 0, nM = voies.marked.length, nCc = f.c2c?.length || 0;
    if (!nC && !nM) {
      st.innerHTML = `<div class="empty">${voies.reason ? esc(voies.reason) + '<br>' : ''}${nCc ? 'Voir les voies d’alpinisme ci-dessous.' : f.e >= 2500 ? 'Sommet de haute montagne sans sentier : consultez un topo d’alpinisme.' : 'Aucune voie trouvée.'}</div>`;
    } else {
      st.innerHTML = `${voies.pending ? '<p class="loading" style="margin:0 0 8px">Calcul des voies par les sentiers (parkings, refuges, routes autour du sommet)…</p>' : ''}${!nC && voies.reason ? `<p class="muted small" style="margin:0 0 8px">${esc(voies.reason)}</p>` : ''}<p class="muted" style="margin:0 0 12px">${[nC && `${nC} voie${nC > 1 ? 's' : ''} par les sentiers`, nM && `${nM} itinéraire${nM > 1 ? 's' : ''} balisé${nM > 1 ? 's' : ''}`, nCc && `${nCc} voie${nCc > 1 ? 's' : ''} Camptocamp`].filter(Boolean).join(' · ')}. Touchez une voie pour voir son profil détaillé et son tracé.</p>`;
    }
    drawCompare();
    drawList();
    drawMapLines();
  };

  // Voies Camptocamp (collectées).
  if (f.c2c?.length) {
    el.querySelector('#v-c2c').innerHTML = `<div class="panel" style="margin-top:14px"><h3>Voies référencées sur Camptocamp</h3>
      <p class="muted small" style="margin:-6px 0 8px">Alpinisme, escalade, randonnée, ski… Cotations et dénivelés indiqués par les auteurs des topos (CC BY-SA).</p>
      <div class="c2c-list">${f.c2c.slice(0, 60).map((r) => `<a class="c2c" href="https://www.camptocamp.org/routes/${r.id}" target="_blank" rel="noopener">
        <span><b>${esc(r.t || 'Voie')}</b><br><span class="acts-l">${(r.a || []).map((a) => esc(C2C_ACT[a] || a)).join(', ')}${r.o?.length ? ` · versant ${r.o.map((o) => ORIENT[o] || o).join(', ')}` : ''}</span></span>
        <span class="rt">${c2cRating(r) ? `<span class="rating">${esc(c2cRating(r))}</span><br>` : ''}${r.up ? `D+ ${num(r.up)} m` : ''}</span></a>`).join('')}</div>
      ${f.c2c.length > 60 ? `<p class="small"><a href="https://www.camptocamp.org/search?q=${encodeURIComponent(f.n)}" target="_blank" rel="noopener">Toutes les voies sur Camptocamp ↗</a></p>` : ''}</div>`;
  }

  // Itinéraires balisés passant par le sommet : portion jusqu'au sommet.
  const markedP = (async () => {
    for (const [rid, la, lo] of (f.rts || []).slice(0, 8)) {
      const r = await getFeature(rid, la, lo).catch(() => null);
      const g = r && await routeGeometry(r);
      if (!g?.p?.length) continue;
      const pos = g.wp?.find(([pid]) => pid === f.id)?.[1];
      if (pos == null) continue;
      const total = g.p[g.p.length - 1][0];
      // Sommet dans la 2e moitié : on monte depuis le départ ; sinon depuis l'arrivée (sens inverse).
      const fromStart = pos >= total - pos;
      let prof = fromStart ? g.p.filter((p) => p[0] <= pos) : g.p.filter((p) => p[0] >= pos).map(([d, e]) => [total - d, e]).reverse();
      if (prof.length < 2) continue;
      prof = prof.map(([d, e]) => [d - prof[0][0], e]);
      const st = profileStats(prof);
      const km = prof[prof.length - 1][0];
      const lines = g.g.map((s) => decode(s));
      voies.marked.push({
        kindLabel: `Itinéraire balisé${r.ref ? ' ' + r.ref : ''}${fromStart ? ', depuis son départ' : ', depuis son arrivée'}`,
        title: r.n || r.ref || 'Itinéraire', href: hrefFor(r), km, up: st.up, dn: st.dn,
        hUp: estimateHours(km, st.up, st.dn), hRound: estimateHours(km * 2, st.up + st.dn, st.up + st.dn),
        t: r.t, vf: r.vf, profile: prof, lines, startEle: Math.round(prof[0][1]),
        start: (() => { const m = mainLines(lines); return m.length ? pointAt(m, fromStart ? 0 : total) : null; })(),
      });
    }
  })();

  // Voies calculées sur le réseau de sentiers (en direct, mises en cache).
  const computedP = (async () => {
    try {
      const cached = sessionStorage.getItem(cacheKey(f.id));
      if (cached) { const c = JSON.parse(cached); voies.computed = c.ascents; voies.reason = c.reason; return; }
    } catch { /* */ }
    try {
      const json = await runOverpass(ascentQuery(f.la, f.lo, 7000), { retries: 2, timeoutMs: 150e3 });
      if (alive()) el.querySelector('#v-status').innerHTML = '<p class="loading">Calcul des dénivelés de chaque voie…</p>';
      const { ascents, reason } = await findAscents(f, json, browserDem(), { max: 6 });
      // Lieux traversés (refuges, cols) pour les repères du profil.
      const places = [...db.features.values()].filter((g) => g.n && ['hut', 'shelter', 'col', 'peak'].includes(g.k) && g.id !== f.id && Math.abs(g.la - f.la) < 0.1 && Math.abs(g.lo - f.lo) < 0.14);
      voies.computed = ascents.map((a) => {
        const lines = [a.line];
        const wps = placesAlong(mainLines(lines), places, 0.12).map((w) => { const p = db.features.get(w.id); return { km: w.km, label: p.n, kind: p.k }; });
        wps.push({ km: a.profile.length ? a.profile[a.profile.length - 1][0] : a.km, label: f.n, kind: 'peak' });
        return {
          kindLabel: a.start.kind === 'hut' ? 'Depuis un refuge, par les sentiers' : a.start.kind === 'parking' ? 'Depuis un parking, par les sentiers' : 'Depuis une route, par les sentiers',
          title: `Depuis ${a.start.name.replace(/^Parking, /, 'le parking de ').replace(/^Route, /, 'la route, ')}`,
          km: a.km, up: a.up, dn: a.dn, hUp: a.hUp, hRound: a.hRound, t: a.t, vf: a.vf, profile: a.profile, lines,
          start: [a.start.la, a.start.lo], startEle: a.start.ele != null ? Math.round(a.start.ele) : null, waypoints: wps,
        };
      });
      voies.reason = reason;
      try { sessionStorage.setItem(cacheKey(f.id), JSON.stringify({ ascents: voies.computed, reason })); } catch { /* quota */ }
    } catch (e) {
      voies.computed = [];
      voies.reason = `Calcul des voies indisponible pour le moment (serveurs OpenStreetMap saturés : ${e.message}).`;
    }
  })();

  await markedP;
  if (voies.marked.length) finish();
  await computedP;
  voies.pending = false;
  finish();
  if (!alive()) map.destroy();

  return () => map.destroy();
}
