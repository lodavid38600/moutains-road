// Fiche d'un objet, en trois niveaux :
//  1. l'essentiel (photo, nom, catégorie, difficulté, distance, D+, durée, altitude) ;
//  2. profil d'altitude, accès au sommet, météo, description, photos, à proximité ;
//  3. replié : cotations détaillées, sources et méthode, liens externes, tags OSM bruts.
import {
  KINDS, CATEGORIES, SAC_BY_T, FERRATA_SCALE, FERRATA_PLAIN, NETWORKS,
  plainDifficulty, accessSentence, estimateHours, formatHours,
} from './lib/categories.js';
import { applyPeakAccess, applyMetrics } from './lib/normalize.js';
import { routeMetrics } from './lib/dem.js';
import { decode } from './lib/polyline.js';
import { distKm } from './lib/geo.js';
import { browserDem } from './dem-browser.js';
import { store, routeGeometry, isRoute, altOf } from './store.js';
import * as api from './api.js';
import * as M from './map.js';
import { profileChart } from './charts.js';
import {
  $, esc, num, meters, fmtKm, icon, commonsThumb, commonsPage, wikiUrl, osmUrl, isOsm, toast,
} from './util.js';
import { openLightbox } from './lightbox.js';

let current = null;   // feature affichée
let ctx = {};         // { open(f), sheet, panelOffset() }
export const currentFeature = () => current;
export function initDetail(context) { ctx = context; }

const VIS = {
  excellent: 'Tracé très visible', good: 'Tracé bien visible', intermediate: 'Tracé parfois peu visible',
  bad: 'Tracé peu visible, sens de l’orientation utile', horrible: 'Tracé à peine visible', no: 'Pas de tracé au sol',
};

// ------------------------------------------------------------------ niveau 1
function keyFacts(f) {
  if (isRoute(f)) {
    const h = f.h ?? estimateHours(f.km, f.up, f.dn);
    return [
      { v: fmtKm(f.km) ?? '—', u: f.km ? 'km' : '', l: 'Distance' },
      { v: f.up != null ? num(f.up) : '—', u: f.up != null ? 'm' : '', l: 'Dénivelé +' },
      { v: h ? formatHours(h) : '—', u: '', l: 'Durée estimée' },
      { v: f.emax != null ? num(f.emax) : '—', u: f.emax != null ? 'm' : '', l: 'Altitude max' },
    ];
  }
  if (f.k === 'peak' || f.k === 'volcano') {
    const acc = plainDifficulty(f);
    return [
      { v: f.e != null ? num(f.e) : '—', u: f.e != null ? 'm' : '', l: 'Altitude' },
      { v: f.pr != null ? num(f.pr) : '—', u: f.pr != null ? 'm' : '', l: 'Proéminence' },
      { v: acc ? acc.code : f.acc ? (f.acc.nw ? 'Sentier' : f.c === 'alpinisme' ? 'Alpi.' : 'Hors sentier') : '—', u: '', l: 'Accès' },
    ];
  }
  if (f.k === 'hut' || f.k === 'shelter') {
    const tg = f.tg || {};
    return [
      { v: f.e != null ? num(f.e) : '—', u: f.e != null ? 'm' : '', l: 'Altitude' },
      { v: tg.beds || tg.capacity || '—', u: '', l: 'Places' },
      { v: tg.fee === 'no' ? 'Gratuit' : tg.reservation === 'required' ? 'Résa.' : tg.fee === 'yes' ? 'Payant' : '—', u: '', l: 'Accueil' },
    ];
  }
  if (f.k === 'climbing') {
    const tg = f.tg || {};
    const g = [tg['climbing:grade:french:min'], tg['climbing:grade:french:max']].filter(Boolean).join(' → ') || tg['climbing:grade:french'] || tg['climbing:grade:uiaa'];
    return [
      { v: tg['climbing:routes'] || '—', u: '', l: 'Voies' },
      { v: g || '—', u: '', l: 'Cotations' },
      { v: tg['climbing:length'] ? tg['climbing:length'].replace(/\s*m$/, '') : '—', u: tg['climbing:length'] ? 'm' : '', l: 'Hauteur' },
    ];
  }
  return [{ v: f.e != null ? num(f.e) : '—', u: f.e != null ? 'm' : '', l: 'Altitude' }];
}

function subtitle(f) {
  const bits = [];
  if (f.ref && f.n !== f.ref) bits.push(esc(f.ref));
  if (f.net && NETWORKS[f.net]) bits.push(NETWORKS[f.net]);
  if (f.rg) bits.push(esc(f.rg));
  const region = store.meta?.regions?.find((r) => r.id === f.r);
  if (region && !f.rg) bits.push(esc(region.name.split(' (')[0]));
  if (isRoute(f) && f.loop) bits.push('Boucle');
  return bits.join(' · ');
}

function photosOf(f) {
  return f.img ? [{ file: f.img, thumb: commonsThumb(f.img, 900), page: commonsPage(f.img) }] : [];
}

function heroHtml(f, photos) {
  const c = f.c ? `var(--cat-${f.c})` : 'var(--cat-none)';
  if (!photos.length) return `<div class="hero small" style="--c:${c}"><div class="hero-icon">${icon(f.k, { color: '#fff', size: 36, width: 1.8 })}</div></div>`;
  return `<div class="hero" style="--c:${c}">
    <div class="hero-strip">${photos.slice(0, 8).map((p, i) => `<button data-photo="${i}" aria-label="Agrandir la photo ${i + 1}"><img src="${esc(p.thumb)}" alt="" loading="${i ? 'lazy' : 'eager'}" onerror="mrHeroError(this)"></button>`).join('')}</div>
    ${photos.length > 1 ? `<span class="hero-count">1 / ${Math.min(8, photos.length)}</span>` : ''}
  </div>`;
}

function badgesHtml(f) {
  const out = [];
  if (f.c) out.push(`<span class="badge" style="--c:var(--cat-${f.c})"><span class="dot"></span>${esc(CATEGORIES[f.c].label)}</span>`);
  const d = plainDifficulty(f);
  if (d) out.push(`<span class="badge plain"><b>${esc(d.code)}</b> · ${esc(d.text)}</span>`);
  return out.join('');
}

// ------------------------------------------------------------------ rendu
export async function showDetail(f, { fit = true } = {}) {
  current = f;
  const body = $('#detail-body');
  const photos = photosOf(f);
  const facts = keyFacts(f);
  const sub = subtitle(f);
  body.innerHTML = `
    <div id="d-hero">${heroHtml(f, photos)}</div>
    <div class="head">
      <div class="kind">${esc(KINDS[f.k]?.label || '')}${f.cc ? ` · ${esc(f.cc)}` : ''}</div>
      <h1>${esc(f.n || KINDS[f.k]?.label)}</h1>
      ${sub ? `<div class="sub">${sub}</div>` : ''}
      <div class="badges" id="d-badges">${badgesHtml(f)}</div>
    </div>
    <div class="keyfacts ${facts.length === 3 ? 'three' : ''}" id="d-facts" ${facts.length < 3 ? 'style="grid-template-columns:1fr"' : ''}>
      ${facts.map((k) => `<div class="kf"><div class="v">${esc(k.v)}${k.u ? `<small>${k.u}</small>` : ''}</div><div class="l">${k.l}</div></div>`).join('')}
    </div>
    <div class="actions" id="d-actions"></div>
    <div id="d-sections"></div>
    <div class="deep" id="d-deep"></div>`;

  bindHero(body, photos);
  renderActions(f, null);
  renderDeep(f);
  M.highlight(f);
  M.clearGeometry();

  const sections = $('#d-sections');
  const add = (id, html) => {
    const s = document.createElement('section');
    s.className = 'sec'; s.id = id; s.innerHTML = html;
    sections.append(s);
    return s;
  };

  if (isRoute(f)) {
    add('d-profile', '<h2>Profil d’altitude</h2><div class="loading">Chargement du tracé…</div>');
    loadRoute(f, fit);
  } else if (fit) {
    M.flyTo(f.la, f.lo, f.k === 'peak' || f.k === 'volcano' ? 13 : 14, ctx.panelOffset?.() || [0, 0]);
  }
  if (f.k === 'peak' || f.k === 'volcano') {
    add('d-access', '<h2>Accès au sommet</h2><div class="loading">Analyse des sentiers…</div>');
    loadAccess(f);
  }
  const description = f.tg?.['description:fr'] || f.tg?.description;
  if (description || f.wp || f.wd) {
    const s = add('d-about', `<h2>À propos</h2>${description ? `<p class="extract">${esc(description)}</p>` : ''}<div id="d-wiki"></div>`);
    loadWiki(f, s);
  }
  add('d-weather', `<h2>Météo <span class="aside">${weatherWhere(f)}</span></h2><div class="loading">Prévisions…</div>`);
  loadWeather(f);
  add('d-photos', '<h2>Photos du secteur</h2><div class="loading">Recherche de photos…</div>');
  loadPhotos(f, photos);
  add('d-near', '<h2>À proximité</h2>');
  renderNearby(f);

  // Infos Wikidata pour les objets OSM liés mais pas encore enrichis (mode direct).
  if (f.wd && !f.sl) enrichWikidata(f);
}

// Photo introuvable : on la retire ; s'il n'en reste aucune, l'en-tête se réduit.
window.mrHeroError = (img) => {
  const hero = img.closest('.hero');
  img.parentElement.remove();
  if (hero && !hero.querySelector('.hero-strip button')) {
    hero.classList.add('small');
    hero.innerHTML = `<div class="hero-icon">${icon(current?.k || 'peak', { color: '#fff', size: 36, width: 1.8 })}</div>`;
  } else hero?.querySelector('.hero-count')?.remove();
};

function bindHero(root, photos) {
  root.querySelectorAll('[data-photo]').forEach((b) => b.addEventListener('click', () => openLightbox(photos, +b.dataset.photo)));
  const strip = root.querySelector('.hero-strip');
  const count = root.querySelector('.hero-count');
  if (strip && count) {
    strip.addEventListener('scroll', () => {
      const i = Math.round(strip.scrollLeft / strip.clientWidth);
      count.textContent = `${i + 1} / ${strip.children.length}`;
    }, { passive: true });
  }
}

function renderActions(f, geom) {
  const el = $('#d-actions');
  if (!el || current !== f) return;
  const btns = [];
  if (geom) btns.push(`<button class="btn primary" id="a-gpx">${svgDl}Télécharger le GPX</button>`);
  btns.push(`<a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=${f.la},${f.lo}" target="_blank" rel="noopener">${svgCar}S’y rendre</a>`);
  btns.push(`<button class="btn" id="a-share">${svgShare}Partager</button>`);
  if (isRoute(f)) btns.push(`<button class="btn" id="a-fit">${svgMap}Voir le tracé</button>`);
  el.innerHTML = btns.join('');
  $('#a-gpx')?.addEventListener('click', () => downloadGpx(f, geom));
  $('#a-share').addEventListener('click', () => share(f));
  $('#a-fit')?.addEventListener('click', () => { ctx.sheet?.snap(0); showRouteOnMap(f, geom, true); });
}
const svgDl = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';
const svgCar = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8M5 10v10h14V10"/></svg>';
const svgShare = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6"/></svg>';
const svgMap = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/></svg>';

async function share(f) {
  const url = `${location.origin}${location.pathname}#f=${f.id}&ll=${f.la},${f.lo}`;
  try {
    if (navigator.share) await navigator.share({ title: f.n || 'Mountains Road', url });
    else { await navigator.clipboard.writeText(url); toast('Lien copié'); }
  } catch { /* partage annulé */ }
}

// ------------------------------------------------------------------ itinéraire
function linesOf(geom) { return geom.g.map((s) => decode(s)); }

async function loadRoute(f, fit) {
  const sec = $('#d-profile');
  let geom = await routeGeometry(f).catch(() => null);
  if (!geom && isOsm(f.id) && f.id[0] !== 'n') {
    try {
      const ways = await api.osmGeometry(f.id);
      const m = await routeMetrics(ways, browserDem());
      if (m) {
        if (f.up == null || !f.emax) { applyMetrics(f, m); refreshFacts(f); }
        geom = { g: m.geom, p: m.profile };
        store.geoms.set(f.id, geom);
      }
    } catch (e) {
      if (current === f) sec.innerHTML = `<h2>Profil d’altitude</h2><p class="muted">Tracé indisponible pour le moment (${esc(e.message)}).</p>`;
    }
  }
  if (current !== f) return;
  if (!geom) {
    sec.innerHTML = '<h2>Profil d’altitude</h2><p class="muted">Pas de tracé disponible.</p>';
    if (fit) M.flyTo(f.la, f.lo, 13, ctx.panelOffset?.() || [0, 0]);
    return;
  }
  const lines = linesOf(geom);
  showRouteOnMap(f, geom, fit);
  renderActions(f, geom);
  const p = geom.p || [];
  const minifacts = [
    f.dn != null ? `Dénivelé − <b>${num(f.dn)} m</b>` : null,
    f.emin != null ? `Point bas <b>${num(f.emin)} m</b>` : null,
    f.emax != null ? `Point haut <b>${num(f.emax)} m</b>` : null,
    f.loop ? '<b>Boucle</b>' : f.tg?.from || f.tg?.to ? `${esc(f.tg.from || '?')} → ${esc(f.tg.to || '?')}` : null,
  ].filter(Boolean).map((x) => `<span>${x}</span>`);
  sec.innerHTML = `<h2>Profil d’altitude</h2>
    ${p.length > 1 ? '<div id="d-chart"></div>' : '<p class="muted">Altitudes indisponibles pour ce tracé.</p>'}
    <div class="minifacts">${minifacts.join('')}</div>`;
  if (p.length > 1) {
    const locate = pointLocator(lines);
    profileChart($('#d-chart'), p, {
      onHover: (i) => M.setHoverPoint(i == null ? null : locate(p[i][0])),
    });
  }
  renderNearby(f, lines);
}

function showRouteOnMap(f, geom, fit) {
  if (!geom) return;
  const off = ctx.panelOffset?.() || [0, 0];
  M.showGeometry(f, linesOf(geom), { fit, padding: { left: off[0] + 40, bottom: off[1] + 40, top: 140, right: 70 } });
}

/** Position (lat, lon) à une distance donnée le long du tracé principal (même logique que routeMetrics). */
function pointLocator(lines) {
  const withLen = lines.map((pts) => {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + distKm(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
    return { pts, cum, km: cum.at(-1) };
  });
  const longest = Math.max(...withLen.map((l) => l.km));
  const main = withLen.filter((l) => l.km >= longest * 0.15);
  return (d) => {
    let off = 0;
    for (const l of main) {
      if (d <= off + l.km) {
        const x = d - off;
        let i = 1;
        while (i < l.cum.length - 1 && l.cum[i] < x) i++;
        const t = (x - l.cum[i - 1]) / Math.max(1e-9, l.cum[i] - l.cum[i - 1]);
        const a = l.pts[i - 1], b = l.pts[i];
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      }
      off += l.km;
    }
    return main.at(-1)?.pts.at(-1);
  };
}

function refreshFacts(f) {
  if (current !== f) return;
  const facts = keyFacts(f);
  const el = $('#d-facts');
  if (el) el.innerHTML = facts.map((k) => `<div class="kf"><div class="v">${esc(k.v)}${k.u ? `<small>${k.u}</small>` : ''}</div><div class="l">${k.l}</div></div>`).join('');
  const b = $('#d-badges');
  if (b) b.innerHTML = badgesHtml(f);
}

function downloadGpx(f, geom) {
  const lines = linesOf(geom);
  const name = esc(f.n || 'Itinéraire');
  const segs = lines.map((pts) => `<trkseg>${pts.map(([la, lo]) => `<trkpt lat="${la}" lon="${lo}"/>`).join('')}</trkseg>`).join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Mountains Road" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${name}</name><copyright author="OpenStreetMap contributors"><license>https://opendatacommons.org/licenses/odbl/</license></copyright></metadata>
<trk><name>${name}</name><src>${osmUrl(f.id) || ''}</src>
${segs}
</trk>
</gpx>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  a.download = `${(f.n || f.id).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')}.gpx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ------------------------------------------------------------------ accès sommet
const ACC_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 20 7-13 4 7 2-3 5 9z"/></svg>';
async function loadAccess(f) {
  const sec = $('#d-access');
  if (!f.acc) {
    try {
      const ways = await api.pathsAround(f.la, f.lo, 150);
      applyPeakAccess(f, ways);
      refreshFacts(f);
    } catch { /* hors ligne / Overpass saturé */ }
  }
  if (current !== f) return;
  const a = accessSentence(f);
  if (!a) { sec.innerHTML = '<h2>Accès au sommet</h2><p class="muted">Analyse indisponible pour le moment.</p>'; return; }
  sec.innerHTML = `<h2>Accès au sommet</h2>
    <div class="access" style="--c:var(--cat-${a.c})">
      <div class="ico">${ACC_ICON}</div>
      <div><b>${esc(a.text)}</b><span>${esc(a.detail)}</span></div>
    </div>
    <p class="muted" style="margin-top:8px">D’après les chemins cartographiés dans OpenStreetMap à moins de 150 m du sommet. Vérifiez toujours les conditions (neige, glacier) avant de partir.</p>`;
}

// ------------------------------------------------------------------ Wikipedia / Wikidata
async function loadWiki(f, sec) {
  const box = sec.querySelector('#d-wiki');
  let wp = f.wp;
  if (!wp && f.wd) {
    const w = await api.wikidataEntity(f.wd).catch(() => null);
    wp = w?.wp;
  }
  if (!wp) { if (!sec.querySelector('.extract')) sec.remove(); return; }
  const s = await api.wikiSummary(wp).catch(() => null);
  if (current !== f) return;
  if (!s?.extract) { if (!sec.querySelector('.extract')) sec.remove(); return; }
  box.innerHTML = `<p class="extract">${esc(s.extract)}</p><p class="muted">Source : <a href="${esc(s.url)}" target="_blank" rel="noopener">Wikipedia</a> (CC BY-SA)</p>`;
  if (!f.img && s.thumb) addHeroPhoto(f, { thumb: s.thumb, page: s.url, author: 'Wikipedia' });
}

async function enrichWikidata(f) {
  const w = await api.wikidataEntity(f.wd).catch(() => null);
  if (!w) return;
  for (const k of ['img', 'pr', 'sl', 'wp']) if (w[k] != null && f[k] == null) f[k] = w[k];
  if (f.e == null && w.e) f.e = w.e;
  if (current === f) {
    refreshFacts(f);
    if (w.img) addHeroPhoto(f, { file: w.img, thumb: commonsThumb(w.img, 900), page: commonsPage(w.img) });
  }
}

let heroPhotos = [];
function addHeroPhoto(f, p) {
  if (current !== f) return;
  heroPhotos = [p, ...heroPhotos.filter((x) => x.thumb !== p.thumb)];
  const hero = $('#d-hero');
  hero.innerHTML = heroHtml(f, heroPhotos);
  bindHero(hero, heroPhotos);
}

// ------------------------------------------------------------------ photos du secteur
async function loadPhotos(f, initial) {
  heroPhotos = initial.slice();
  const sec = $('#d-photos');
  let list = [];
  try { list = await api.commonsNearby(f.la, f.lo, isRoute(f) ? 2500 : 1200, 30); } catch { /* */ }
  if (current !== f) return;
  const known = new Set(initial.map((p) => p.file));
  list = list.filter((p) => !known.has(p.file));
  if (!list.length) { sec.remove(); return; }
  if (!heroPhotos.length) {
    heroPhotos = list.slice(0, 6);
    const hero = $('#d-hero');
    hero.innerHTML = heroHtml(f, heroPhotos);
    bindHero(hero, heroPhotos);
  }
  const all = [...heroPhotos, ...list.filter((p) => !heroPhotos.includes(p))];
  sec.innerHTML = `<h2>Photos du secteur <span class="aside">${list.length} sur Wikimedia Commons</span></h2>
    <div class="gallery">${list.slice(0, 12).map((p) => `<button data-i="${all.indexOf(p)}" aria-label="Agrandir"><img src="${esc(p.thumb)}" alt="${esc(p.desc || '')}" loading="lazy" onerror="this.parentElement.remove()"></button>`).join('')}</div>`;
  sec.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => openLightbox(all, +b.dataset.i)));
}

// ------------------------------------------------------------------ météo
function weatherWhere(f) {
  if (isRoute(f)) return f.emax ? `au point le plus haut (${meters(f.emax)})` : 'au départ';
  return f.e ? `à ${meters(f.e)}` : '';
}
const DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const round100 = (n) => Math.round(n / 100) * 100;

async function loadWeather(f) {
  const sec = $('#d-weather');
  const alt = isRoute(f) ? f.emax : f.e;
  let days;
  try { days = await api.weather(f.la, f.lo, alt ?? undefined); } catch {
    if (current === f) sec.innerHTML = '<h2>Météo</h2><p class="muted">Prévisions indisponibles.</p>';
    return;
  }
  if (current !== f) return;
  const d0 = days[0];
  const [ic, label] = api.WMO[d0.code] || ['', ''];
  const notes = [];
  if (d0.iso0 != null) {
    if (alt != null && d0.iso0 < alt) notes.push(['❄️', `Il gèle à cette altitude aujourd’hui (gel dès ${num(round100(d0.iso0))} m)`]);
    else notes.push(['🌡️', `Gel au-dessus de ${num(round100(d0.iso0))} m`]);
  }
  if (d0.gust >= 60) notes.push(['💨', `Vent fort : rafales jusqu’à ${Math.round(d0.gust)} km/h`]);
  else if (d0.wind >= 30) notes.push(['💨', `Vent soutenu : ${Math.round(d0.wind)} km/h`]);
  if (d0.rain >= 1) notes.push([d0.tmax < 1 ? '🌨️' : '🌧️', `${d0.tmax < 1 ? 'Neige' : 'Pluie'} prévue : ${Math.round(d0.rain)} mm`]);
  if ([95, 96, 99].includes(d0.code)) notes.push(['⚡', 'Risque d’orage : partez tôt, évitez les crêtes l’après-midi']);
  sec.innerHTML = `<h2>Météo <span class="aside">${weatherWhere(f)}</span></h2>
    <div class="wx-today"><div class="big" aria-hidden="true">${ic}</div>
      <div class="t"><div><b>${Math.round(d0.tmax)}°</b> / ${Math.round(d0.tmin)}° aujourd’hui</div><div class="muted">${esc(label)}</div></div></div>
    <div class="wx-days">${days.map((d) => {
      const [i, l] = api.WMO[d.code] || ['', ''];
      const dt = new Date(d.date + 'T12:00');
      return `<div class="wx-day" title="${esc(l)}${d.iso0 != null ? ` · gel au-dessus de ${num(round100(d.iso0))} m` : ''}">
        <span class="d">${DAYS[dt.getDay()]}</span><span class="i">${i}</span>
        <span class="hi">${Math.round(d.tmax)}°</span><span class="lo">${Math.round(d.tmin)}°</span></div>`;
    }).join('')}</div>
    ${notes.length ? `<div class="wx-notes">${notes.map(([i, t]) => `<div><span aria-hidden="true">${i}</span><span>${esc(t)}</span></div>`).join('')}</div>` : ''}
    <p class="muted" style="margin-top:10px">Températures calculées pour l’altitude indiquée. Source : <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a>.</p>`;
}

// ------------------------------------------------------------------ à proximité
function renderNearby(f, lines) {
  const sec = $('#d-near');
  if (!sec || current !== f) return;
  // Points de référence : le tracé (échantillonné) ou l'objet lui-même.
  const refs = lines ? lines.flatMap((l) => l.filter((_, i) => i % 8 === 0)) : [[f.la, f.lo]];
  const radius = lines ? 1.5 : 4;
  const out = [];
  for (const g of store.features.values()) {
    if (g.id === f.id || !g.n) continue;
    if (!['peak', 'volcano', 'hut', 'shelter', 'route', 'ferrata', 'col', 'climbing'].includes(g.k)) continue;
    let best = Infinity;
    for (const [la, lo] of refs) {
      if (Math.abs(la - g.la) > 0.06 || Math.abs(lo - g.lo) > 0.08) continue;
      best = Math.min(best, distKm(la, lo, g.la, g.lo));
    }
    if (best <= radius) out.push({ g, d: best });
  }
  // On équilibre : un peu de chaque type, les plus proches d'abord.
  out.sort((a, b) => a.d - b.d);
  const perKind = {};
  const pick = out.filter(({ g }) => (perKind[g.k] = (perKind[g.k] || 0) + 1) <= 4).slice(0, 10);
  if (!pick.length) { sec.innerHTML = '<h2>À proximité</h2><p class="muted">Rien d’autre de chargé autour. Zoomez sur la carte pour charger le secteur.</p>'; return; }
  sec.innerHTML = `<h2>À proximité</h2><div class="near">${pick.map(({ g, d }) => {
    const meta = [KINDS[g.k]?.label];
    const alt = altOf(g);
    if (isRoute(g)) { if (g.km) meta.push(`${fmtKm(g.km)} km`); if (g.up) meta.push(`↗ ${num(g.up)} m`); }
    else if (alt) meta.push(meters(alt));
    return `<button data-id="${esc(g.id)}">
      <span class="sr-ico" style="--c:var(--cat-${g.c || 'none'})">${icon(g.k, { color: `var(--cat-${g.c || 'none'})`, size: 18 })}</span>
      <span class="nm"><div>${esc(g.n)}</div><div>${meta.map(esc).join(' · ')}</div></span>
      <span class="ds">${d < 1 ? `${Math.round(d * 1000 / 10) * 10} m` : `${fmtKm(d)} km`}</span></button>`;
  }).join('')}</div>`;
  sec.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => ctx.open?.(store.features.get(b.dataset.id))));
}

// ------------------------------------------------------------------ niveau 3
function renderDeep(f) {
  const el = $('#d-deep');
  const blocks = [];

  // Difficulté détaillée
  const diff = [];
  const t = f.t || f.acc?.t;
  if (t) {
    diff.push(`<dl class="kv"><dt>Échelle SAC</dt><dd><b>${SAC_BY_T[t].code}</b> · ${esc(SAC_BY_T[t].label)}</dd></dl>`);
    if (f.ts?.length > 1) {
      const counts = f.ts.map((x) => ({ x, c: x <= 2 ? 'rando' : x === 3 ? 'montagne' : x <= 5 ? 'alpine' : 'alpinisme' }));
      diff.push(`<p style="margin:10px 0 0">Niveaux rencontrés sur le parcours : ${counts.map(({ x }) => `<b>T${x}</b>`).join(', ')}. La difficulté affichée est celle du passage le plus dur.</p>`);
    }
  }
  if (f.vf != null) diff.push(`<dl class="kv" style="margin-top:8px"><dt>Via ferrata</dt><dd><b>${esc(FERRATA_SCALE[f.vf])}</b> · ${esc(FERRATA_PLAIN[f.vf])}</dd></dl>`);
  if (f.vis?.length) diff.push(`<dl class="kv" style="margin-top:8px"><dt>Visibilité du tracé</dt><dd>${f.vis.map((v) => esc(VIS[v] || v)).join(', ')}</dd></dl>`);
  const grades = Object.entries(f.tg || {}).filter(([k]) => k.startsWith('climbing:'));
  if (grades.length) diff.push(`<dl class="kv" style="margin-top:8px">${grades.map(([k, v]) => `<dt>${esc(k.replace('climbing:', '').replace(/:/g, ' '))}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`);
  diff.push(`<div class="explain"><b>Comment lire l’échelle SAC ?</b><br>${Object.values(SAC_BY_T).map((s) => `<b>${s.code}</b> ${esc(s.plain)}`).join('<br>')}</div>`);
  blocks.push(['Cotations détaillées', diff.join('')]);

  // Sources et méthode
  const src = [];
  if (isRoute(f)) {
    src.push(`<dt>Dénivelé</dt><dd>${f.upSrc === 'osm' ? 'Renseigné par les contributeurs OpenStreetMap' : f.up != null ? 'Calculé à partir du tracé et d’un modèle de terrain (~30 m), lissé pour ignorer le bruit' : 'Non disponible'}</dd>`);
    src.push(`<dt>Durée</dt><dd>Estimation selon la norme DIN 33466 : 4 km/h à plat, 300 m/h en montée, 500 m/h en descente, sans les pauses</dd>`);
    src.push(`<dt>Distance</dt><dd>${f.tg?.distance ? 'Renseignée dans OpenStreetMap' : 'Mesurée sur le tracé (variantes courtes exclues)'}</dd>`);
  }
  if (f.k === 'peak' || f.k === 'volcano') src.push('<dt>Accès</dt><dd>Chemins OpenStreetMap à moins de 150 m du sommet ; le plus facile détermine la catégorie</dd>');
  src.push(`<dt>Identifiant</dt><dd>${esc(f.id)}${f.wd && f.wd !== f.id ? ` · ${esc(f.wd)}` : ''}</dd>`);
  src.push(`<dt>Origine</dt><dd>${f.src === 'live' ? 'Chargé en direct depuis OpenStreetMap' : store.meta?.osmDate ? `Collecte du ${new Date(store.meta.osmDate).toLocaleDateString('fr-FR')}` : 'Collecte'}</dd>`);
  blocks.push(['Sources et méthode', `<dl class="kv">${src.join('')}</dl>`]);

  // Liens externes
  const links = [];
  const name = encodeURIComponent(f.n || '');
  if (isOsm(f.id)) links.push(['OpenStreetMap', osmUrl(f.id)]);
  if (f.id[0] === 'r' && isRoute(f)) links.push(['Waymarked Trails', `https://hiking.waymarkedtrails.org/#route?id=${f.id.slice(1)}`]);
  if (f.wp) links.push(['Wikipedia', wikiUrl(f.wp)]);
  if (f.wd) links.push(['Wikidata', `https://www.wikidata.org/wiki/${f.wd}`]);
  if (f.n) links.push(['Camptocamp (topos, sorties)', `https://www.camptocamp.org/search?q=${name}`]);
  if (f.k === 'hut' || f.k === 'shelter') links.push(['Refuges.info', `https://www.refuges.info/point/recherche?nom=${name}`]);
  const site = f.tg?.website || f.tg?.['contact:website'] || f.tg?.url;
  if (site) links.push(['Site officiel', site]);
  links.push(['Géoportail (IGN)', `https://www.geoportail.gouv.fr/carte?c=${f.lo},${f.la}&z=15&l0=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2::GEOPORTAIL:OGC:WMTS(1)&permalink=yes`]);
  blocks.push(['Liens externes', `<div class="links">${links.map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)} ↗</a>`).join('')}</div>`]);

  // Tags bruts
  const tags = Object.entries(f.tg || {});
  if (tags.length) blocks.push([`Données OpenStreetMap brutes <span class="muted">${tags.length} tags</span>`, `<table class="raw">${tags.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`]);

  el.innerHTML = blocks.map(([t, html]) => `<details><summary>${t}</summary><div class="inner">${html}</div></details>`).join('');
}
