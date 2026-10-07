// Éléments communs aux pages de détail (sommet, itinéraire, lieu).
import { KINDS, CATEGORIES, SAC_BY_T, FERRATA_SCALE, FERRATA_PLAIN, plainDifficulty } from '../lib/categories.js';
import { db, hrefFor, isRoute, isPeak, altOf, featuresIn, loadTilesForBbox } from '../data.js';
import { distKm } from '../lib/geo.js';
import * as api from '../api.js';
import { regionName, rowHtml } from './cards.js';
import { esc, num, fmtKm, osmUrl, wikiUrl, isOsm, toast } from '../util.js';

export function crumbsHtml(f, section) {
  const r = f.r ? db.meta?.regions?.find((x) => x.id === f.r) : null;
  const items = ['<a href="#/">Accueil</a>'];
  if (r) items.push(`<a href="#/massif/${r.id}">${esc(r.name.split(' (')[0])}</a>`);
  items.push(`<a href="${section.href}">${esc(section.label)}</a>`);
  items.push(`<span aria-current="page">${esc(f.n || KINDS[f.k]?.label)}</span>`);
  return `<nav class="crumbs" aria-label="Fil d’Ariane">${items.join('<span aria-hidden="true">›</span>')}</nav>`;
}

export function keyFactsHtml(items) {
  return `<div class="keyfacts">${items.map(([v, u, l]) => `<div class="kf"><div class="v">${esc(v)}${u ? `<small>${u}</small>` : ''}</div><div class="l">${l}</div></div>`).join('')}</div>`;
}

export function badgesHtml(f) {
  const out = [];
  if (f.c) out.push(`<span class="badge" style="--c:var(--cat-${f.c})"><span class="dot"></span>${esc(CATEGORIES[f.c].label)}</span>`);
  const d = plainDifficulty(f);
  if (d) out.push(`<span class="badge plain"><b>${esc(d.code)}</b> · ${esc(d.text)}</span>`);
  return out.join('');
}

export function subtitle(f) {
  const bits = [];
  if (f.rg) bits.push(esc(f.rg));
  else if (f.r) bits.push(esc(regionName(f.r)));
  if (f.cc) bits.push(esc(f.cc));
  return bits.join(' · ');
}

export async function share(f) {
  const url = location.href;
  try {
    if (navigator.share) await navigator.share({ title: f.n || 'Mountains Road', url });
    else { await navigator.clipboard.writeText(url); toast('Lien copié'); }
  } catch { /* partage annulé */ }
}

export function downloadGpx(name, lines, { waypoints = [] } = {}) {
  const n = esc(name || 'Itinéraire');
  const wpt = waypoints.map((w) => `<wpt lat="${w.la}" lon="${w.lo}"><name>${esc(w.label)}</name></wpt>`).join('\n');
  const segs = lines.map((pts) => `<trkseg>${pts.map(([la, lo, e]) => `<trkpt lat="${la.toFixed(6)}" lon="${lo.toFixed(6)}">${e != null ? `<ele>${Math.round(e)}</ele>` : ''}</trkpt>`).join('')}</trkseg>`).join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Mountains Road" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${n}</name><copyright author="OpenStreetMap contributors"><license>https://opendatacommons.org/licenses/odbl/</license></copyright></metadata>
${wpt}
<trk><name>${n}</name>
${segs}
</trk>
</gpx>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  a.download = `${(name || 'itineraire').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')}.gpx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Description OSM + résumé Wikipedia. */
export async function aboutSection(el, f) {
  const desc = f.tg?.['description:fr'] || f.tg?.description;
  let wp = f.wp;
  if (!wp && f.wd) wp = (await api.wikidataEntity(f.wd).catch(() => null))?.wp;
  const s = wp ? await api.wikiSummary(wp).catch(() => null) : null;
  if (!desc && !s?.extract) { el.closest('.section')?.remove(); return null; }
  el.innerHTML = `${desc ? `<p class="extract">${esc(desc)}</p>` : ''}
    ${s?.extract ? `<p class="extract">${esc(s.extract)}</p><p class="muted small">Source : <a href="${esc(s.url)}" target="_blank" rel="noopener">Wikipedia</a> (CC BY-SA)</p>` : ''}`;
  return s;
}

/** Lieux à proximité (sommets, refuges, cols, itinéraires) autour d'un point ou d'un tracé. */
export async function nearbySection(el, f, { refs = null, radius = 4, kinds = ['peak', 'volcano', 'hut', 'shelter', 'col', 'route', 'ferrata', 'climbing'], max = 12 } = {}) {
  const pts = refs || [[f.la, f.lo]];
  const pad = radius / 100 + 0.02;
  const lats = pts.map((p) => p[0]), lons = pts.map((p) => p[1]);
  await loadTilesForBbox([Math.min(...lats) - pad, Math.min(...lons) - pad, Math.max(...lats) + pad, Math.max(...lons) + pad], 9);
  const cands = featuresIn([Math.min(...lats) - pad, Math.min(...lons) - pad, Math.max(...lats) + pad, Math.max(...lons) + pad]);
  const out = [];
  for (const g of cands) {
    if (g.id === f.id || !g.n || !kinds.includes(g.k)) continue;
    let best = Infinity;
    for (const [la, lo] of pts) best = Math.min(best, distKm(la, lo, g.la, g.lo));
    if (best <= radius) out.push({ g, d: best });
  }
  out.sort((a, b) => a.d - b.d);
  const per = {};
  const pick = out.filter(({ g }) => (per[g.k] = (per[g.k] || 0) + 1) <= 4).slice(0, max);
  if (!pick.length) { el.closest('.section')?.remove(); return; }
  el.innerHTML = `<div class="rows">${pick.map(({ g, d }) => rowHtml(g, { right: `${d < 1 ? `${Math.round(d * 100) * 10} m` : `${fmtKm(d)} km`}<span>${isRoute(g) && g.up ? `D+ ${num(g.up)} m` : altOf(g) ? `${num(altOf(g))} m` : ''}</span>` })).join('')}</div>`;
}

const VIS = {
  excellent: 'Tracé très visible', good: 'Tracé bien visible', intermediate: 'Tracé parfois peu visible',
  bad: 'Tracé peu visible, sens de l’orientation utile', horrible: 'Tracé à peine visible', no: 'Pas de tracé au sol',
};

/** Niveau 3 : cotations détaillées, sources, liens externes, tags OSM bruts. */
export function deepHtml(f, { method = [] } = {}) {
  const blocks = [];
  const diff = [];
  const t = f.t || f.acc?.t;
  if (t) diff.push(`<dl class="kv"><dt>Échelle SAC</dt><dd><b>${SAC_BY_T[t].code}</b> · ${esc(SAC_BY_T[t].label)}</dd></dl>`);
  if (f.ts?.length > 1) diff.push(`<p>Niveaux rencontrés : ${f.ts.map((x) => `<b>T${x}</b>`).join(', ')}. La difficulté retenue est celle du passage le plus dur.</p>`);
  if (f.vf != null) diff.push(`<dl class="kv"><dt>Via ferrata</dt><dd><b>${esc(FERRATA_SCALE[f.vf])}</b> · ${esc(FERRATA_PLAIN[f.vf])}</dd></dl>`);
  if (f.vis?.length) diff.push(`<dl class="kv"><dt>Visibilité du tracé</dt><dd>${f.vis.map((v) => esc(VIS[v] || v)).join(', ')}</dd></dl>`);
  const grades = Object.entries(f.tg || {}).filter(([k]) => k.startsWith('climbing:'));
  if (grades.length) diff.push(`<dl class="kv">${grades.map(([k, v]) => `<dt>${esc(k.replace('climbing:', '').replace(/:/g, ' '))}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`);
  diff.push(`<div class="explain"><b>L’échelle SAC en bref</b><br>${Object.values(SAC_BY_T).map((s) => `<b>${s.code}</b> ${esc(s.plain)}`).join('<br>')}<br><a href="#/guide">Toutes les cotations expliquées →</a></div>`);
  blocks.push(['Cotations détaillées', diff.join('')]);

  const src = [...method];
  src.push(`<dt>Identifiant</dt><dd>${esc(f.id)}${f.wd && f.wd !== f.id ? ` · ${esc(f.wd)}` : ''}</dd>`);
  src.push(`<dt>Origine</dt><dd>${f.src === 'live' ? 'Chargé en direct depuis OpenStreetMap' : db.meta?.osmDate ? `Collecte du ${new Date(db.meta.osmDate).toLocaleDateString('fr-FR')}` : 'Collecte'}</dd>`);
  blocks.push(['Sources et méthode', `<dl class="kv">${src.join('')}</dl>`]);

  const links = [];
  const name = encodeURIComponent(f.n || '');
  if (isOsm(f.id)) links.push(['OpenStreetMap', osmUrl(f.id)]);
  if (f.id[0] === 'r' && isRoute(f)) links.push(['Waymarked Trails', `https://hiking.waymarkedtrails.org/#route?id=${f.id.slice(1)}`]);
  if (f.wp) links.push(['Wikipedia', wikiUrl(f.wp)]);
  if (f.wd) links.push(['Wikidata', `https://www.wikidata.org/wiki/${f.wd}`]);
  if (f.n) links.push(['Camptocamp', `https://www.camptocamp.org/search?q=${name}`]);
  if (isPeak(f) && f.n) links.push(['Peakbagger', `https://www.peakbagger.com/search.aspx?ss=${name}`]);
  if (f.k === 'hut' || f.k === 'shelter') links.push(['Refuges.info', `https://www.refuges.info/point/recherche?nom=${name}`]);
  const site = f.tg?.website || f.tg?.['contact:website'] || f.tg?.url;
  if (site) links.push(['Site officiel', site]);
  links.push(['Géoportail (IGN)', `https://www.geoportail.gouv.fr/carte?c=${f.lo},${f.la}&z=15&l0=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2::GEOPORTAIL:OGC:WMTS(1)&permalink=yes`]);
  links.push(['Google Maps', `https://www.google.com/maps/search/?api=1&query=${f.la},${f.lo}`]);
  blocks.push(['Liens externes', `<div class="links">${links.map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)} ↗</a>`).join('')}</div>`]);

  const tags = Object.entries(f.tg || {});
  if (tags.length) blocks.push([`Données OpenStreetMap brutes <span class="muted">${tags.length} tags</span>`, `<table class="raw">${tags.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`]);
  return `<div class="deep">${blocks.map(([ttl, html]) => `<details><summary>${ttl}</summary><div class="inner">${html}</div></details>`).join('')}</div>`;
}

export const sectionHtml = (id, title, sub = '', aside = '') => `<section class="section" id="${id}"><div class="section-head"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div>${aside}</div><div class="sec-body"></div></section>`;
export const body = (root, id) => root.querySelector(`#${id} .sec-body`);
export { hrefFor };
