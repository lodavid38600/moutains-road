// Panneau des filtres avancés (ouvert à la demande).
import { KINDS, SAC_BY_T, NETWORKS, categoryFromSac } from './lib/categories.js';
import { filters, filtersChanged, store } from './store.js';
import { $, esc, num } from './util.js';

const UP_PRESETS = [
  { label: 'Moins de 500 m', min: null, max: 500 },
  { label: 'Moins de 800 m', min: null, max: 800 },
  { label: 'Moins de 1 200 m', min: null, max: 1200 },
  { label: 'Plus de 1 200 m', min: 1200, max: null },
];
const H_PRESETS = [
  { label: 'Moins de 2 h', max: 2 }, { label: 'Moins de 4 h', max: 4 },
  { label: 'Moins de 6 h', max: 6 }, { label: 'Moins de 9 h', max: 9 },
];
const KIND_ORDER = ['route', 'ferrata', 'peak', 'volcano', 'col', 'hut', 'shelter', 'climbing', 'viewpoint', 'glacier'];

let ctx = {};
export function initFilters(context) { ctx = context; render(); }

const numOrNull = (v) => (v === '' || v == null ? null : Number(v));

export function render() {
  const F = filters;
  const body = $('#filters-body');
  const kindCounts = {};
  for (const f of store.features.values()) kindCounts[f.k] = (kindCounts[f.k] || 0) + 1;

  body.innerHTML = `
  <section class="fg">
    <h3>Difficulté maximale</h3>
    <p class="help">Touchez un niveau pour masquer tout ce qui est plus difficile.</p>
    <div class="tscale" id="ff-t">${[1, 2, 3, 4, 5, 6].map((t) => {
      const on = F.tMax < 6 && t <= F.tMax;
      return `<button aria-pressed="${on}" data-t="${t}" style="--c:var(--cat-${categoryFromSac(t)})">T${t}<small>${['facile', 'montagne', 'raide', 'alpin', 'alpin+', 'alpi.'][t - 1]}</small></button>`;
    }).join('')}</div>
    <div class="tscale-txt">${F.tMax < 6 ? `Jusqu’à <b>T${F.tMax}</b> : ${esc(SAC_BY_T[F.tMax].plain.toLowerCase())}.` : 'Toutes les difficultés.'}</div>
  </section>

  <section class="fg">
    <h3>Dénivelé positif (D+)</h3>
    <p class="help">Cumul des montées sur l’itinéraire.</p>
    <div class="seg" id="ff-up">${UP_PRESETS.map((p, i) => `<button data-i="${i}" aria-pressed="${F.upMin === p.min && F.upMax === p.max}">${p.label}</button>`).join('')}</div>
    <div class="inputs" style="margin-top:10px">
      <label>D+ min (m)<input id="ff-upmin" type="number" inputmode="numeric" step="100" min="0" value="${F.upMin ?? ''}" placeholder="0"></label>
      <label>D+ max (m)<input id="ff-upmax" type="number" inputmode="numeric" step="100" min="0" value="${F.upMax ?? ''}" placeholder="illimité"></label>
    </div>
  </section>

  <section class="fg">
    <h3>Durée estimée</h3>
    <div class="seg" id="ff-h">${H_PRESETS.map((p, i) => `<button data-i="${i}" aria-pressed="${F.hMax === p.max}">${p.label}</button>`).join('')}</div>
  </section>

  <section class="fg">
    <h3>Distance</h3>
    <div class="inputs">
      <label>Min (km)<input id="ff-kmin" type="number" inputmode="decimal" step="1" min="0" value="${F.kmMin ?? ''}" placeholder="0"></label>
      <label>Max (km)<input id="ff-kmax" type="number" inputmode="decimal" step="1" min="0" value="${F.kmMax ?? ''}" placeholder="illimité"></label>
    </div>
    <div class="toggles" style="margin-top:6px"><label><input type="checkbox" id="ff-loop" ${F.loop ? 'checked' : ''}> Boucles uniquement (retour au départ)</label></div>
  </section>

  <section class="fg">
    <h3>Altitude</h3>
    <p class="help">Altitude du sommet, ou point le plus haut de l’itinéraire.</p>
    <div class="inputs">
      <label>Min (m)<input id="ff-emin" type="number" inputmode="numeric" step="100" min="0" value="${F.eMin ?? ''}" placeholder="0"></label>
      <label>Max (m)<input id="ff-emax" type="number" inputmode="numeric" step="100" min="0" value="${F.eMax ?? ''}" placeholder="8 849"></label>
    </div>
  </section>

  <section class="fg">
    <h3>Afficher sur la carte</h3>
    <div class="toggles" id="ff-kinds">${KIND_ORDER.map((k) => `<label><input type="checkbox" value="${k}" ${F.kinds.has(k) ? 'checked' : ''}> ${esc(KINDS[k].plural)}<span class="n">${kindCounts[k] ? num(kindCounts[k]) : ''}</span></label>`).join('')}</div>
  </section>

  <section class="fg">
    <h3>Type de sentier</h3>
    <div class="seg" id="ff-nets">${[...Object.entries(NETWORKS), ['autre', 'Non classé']].map(([k, l]) => `<button data-net="${k}" aria-pressed="${F.nets.has(k)}">${esc(l)}</button>`).join('')}</div>
  </section>

  <section class="fg">
    <h3>Plus d’options</h3>
    <div class="toggles">
      <label><input type="checkbox" id="ff-photo" ${F.photo ? 'checked' : ''}> Avec une photo</label>
      <label><input type="checkbox" id="ff-wiki" ${F.wiki ? 'checked' : ''}> Avec un article Wikipedia</label>
      <label><input type="checkbox" id="ff-unnamed" ${!F.named ? 'checked' : ''}> Inclure les lieux sans nom</label>
    </div>
  </section>

  ${store.meta?.regions?.length ? `<section class="fg">
    <h3>Aller à un massif</h3>
    <div class="regions">${store.meta.regions.map((r) => `<button data-region="${esc(r.id)}"><span>${esc(r.name)}</span><span class="n">${num(r.total)}</span></button>`).join('')}</div>
  </section>` : ''}

  <section class="fg">
    <h3>Données</h3>
    <p class="help" id="ff-data">${dataInfo()}</p>
    <div class="toggles"><label><input type="checkbox" id="ff-live" ${ctx.liveAuto?.() ? 'checked' : ''}> Charger OpenStreetMap en direct quand je zoome sur une zone non couverte</label></div>
  </section>`;

  bind(body);
}

function dataInfo() {
  const m = store.meta;
  if (!m) return 'Aucune collecte locale : les données sont chargées en direct depuis OpenStreetMap quand vous zoomez (voir « Les données » dans le menu).';
  return `${num(m.total)} lieux et itinéraires collectés le ${new Date(m.generated).toLocaleDateString('fr-FR')}.`;
}

function bind(body) {
  const F = filters;
  const changed = (rerender = true) => { filtersChanged(); if (rerender) render(); };
  body.querySelectorAll('#ff-t button').forEach((b) => b.addEventListener('click', () => {
    const t = +b.dataset.t;
    F.tMax = F.tMax === t ? 6 : t;
    changed();
  }));
  body.querySelectorAll('#ff-up button').forEach((b) => b.addEventListener('click', () => {
    const p = UP_PRESETS[+b.dataset.i];
    const on = F.upMin === p.min && F.upMax === p.max;
    F.upMin = on ? null : p.min; F.upMax = on ? null : p.max;
    changed();
  }));
  body.querySelectorAll('#ff-h button').forEach((b) => b.addEventListener('click', () => {
    const p = H_PRESETS[+b.dataset.i];
    F.hMax = F.hMax === p.max ? null : p.max;
    changed();
  }));
  const inputs = { 'ff-upmin': 'upMin', 'ff-upmax': 'upMax', 'ff-kmin': 'kmMin', 'ff-kmax': 'kmMax', 'ff-emin': 'eMin', 'ff-emax': 'eMax' };
  for (const [id, key] of Object.entries(inputs)) {
    body.querySelector('#' + id).addEventListener('change', (e) => { F[key] = numOrNull(e.target.value); changed(); });
  }
  body.querySelector('#ff-loop').addEventListener('change', (e) => { F.loop = e.target.checked; changed(false); });
  body.querySelectorAll('#ff-kinds input').forEach((i) => i.addEventListener('change', () => {
    i.checked ? F.kinds.add(i.value) : F.kinds.delete(i.value);
    changed(false);
  }));
  body.querySelectorAll('#ff-nets button').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.net;
    F.nets.has(k) ? F.nets.delete(k) : F.nets.add(k);
    changed();
  }));
  body.querySelector('#ff-photo').addEventListener('change', (e) => { F.photo = e.target.checked; changed(false); });
  body.querySelector('#ff-wiki').addEventListener('change', (e) => { F.wiki = e.target.checked; changed(false); });
  body.querySelector('#ff-unnamed').addEventListener('change', (e) => { F.named = !e.target.checked; changed(false); });
  body.querySelectorAll('[data-region]').forEach((b) => b.addEventListener('click', () => {
    const r = store.meta.regions.find((x) => x.id === b.dataset.region);
    ctx.goRegion?.(r);
  }));
  body.querySelector('#ff-live').addEventListener('change', (e) => ctx.setLiveAuto?.(e.target.checked));
}
