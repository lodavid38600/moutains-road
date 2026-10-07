// Page Carte : exploration libre. Un clic ouvre un aperçu, avec lien vers la fiche complète.
/* global L */
import { CATEGORIES, KINDS } from '../lib/categories.js';
import { loadMeta, loadOverview, loadTilesForBbox, db, onData, hrefFor, loadLive, liveCovered, bboxCovered } from '../data.js';
import { setQuery } from '../router.js';
import { createMap, layersControl, iconFor, tooltipHtml } from '../map.js';
import { factsHtml } from '../components/cards.js';
import { esc, num, icon, commonsThumb, toast, debounce } from '../util.js';

const TYPES = [
  ['routes', 'Itinéraires', ['route']], ['ferrata', 'Via ferrata', ['ferrata']], ['peaks', 'Sommets', ['peak', 'volcano']],
  ['huts', 'Refuges', ['hut', 'shelter']], ['cols', 'Cols', ['col']], ['climbing', 'Escalade', ['climbing']],
];

export async function mapPage(el, { query, alive }) {
  document.title = 'Carte · Mountains Road';
  const meta = await loadMeta();
  if (!alive()) return;
  const view = query.get('m')?.split('/').map(Number);
  const types = new Set((query.get('types') || 'routes,ferrata,peaks,huts').split(',').filter(Boolean));
  const cats = new Set((query.get('cat') || '').split(',').filter(Boolean));

  el.innerHTML = `<div class="mapview">
    <div class="map" id="mv-map"></div>
    <div class="map-top" id="mv-chips"></div>
    <div class="map-status" id="mv-status" role="status" aria-live="polite"></div>
    <button class="btn map-live" id="mv-live" hidden>Charger cette zone (OpenStreetMap)</button>
    <div id="mv-preview"></div>
  </div>`;
  const box = el.querySelector('.mapview');
  const api = createMap(el.querySelector('#mv-map'), { center: view ? [view[1], view[2]] : [45.9, 6.85], zoom: view ? view[0] : 9 });
  layersControl(api, box);
  const locate = L.control({ position: 'topright' });
  locate.onAdd = () => {
    const b = L.DomUtil.create('button', 'map-ctl leaflet-control');
    b.setAttribute('aria-label', 'Me localiser');
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';
    L.DomEvent.on(b, 'click', (e) => { L.DomEvent.stop(e); api.map.locate({ setView: true, maxZoom: 14 }); });
    return b;
  };
  locate.addTo(api.map);

  const cluster = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: (z) => (z < 9 ? 60 : 42), disableClusteringAtZoom: 14, showCoverageOnHover: false });
  api.map.addLayer(cluster);
  const markers = new Map();

  const kinds = () => new Set(TYPES.filter(([t]) => types.has(t)).flatMap(([, , k]) => k));
  const visible = (f) => {
    if (!kinds().has(f.k) || !f.n) return false;
    if (cats.size && (f.k === 'route' || f.k === 'ferrata' || f.k === 'peak' || f.k === 'volcano') && !cats.has(f.c)) return false;
    return true;
  };

  const chips = () => {
    el.querySelector('#mv-chips').innerHTML =
      TYPES.map(([t, l]) => `<button class="map-chip" data-type="${t}" aria-pressed="${types.has(t)}" style="--c:var(--brand-2)">${l}</button>`).join('')
      + Object.keys(CATEGORIES).filter((c) => c !== 'escalade').map((c) => `<button class="map-chip" data-cat="${c}" aria-pressed="${cats.has(c)}" style="--c:var(--cat-${c})"><span class="dot"></span>${esc(CATEGORIES[c].short)}</button>`).join('');
    el.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => { types.has(b.dataset.type) ? types.delete(b.dataset.type) : types.add(b.dataset.type); chips(); draw(); sync(); }));
    el.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => { cats.has(b.dataset.cat) ? cats.delete(b.dataset.cat) : cats.add(b.dataset.cat); chips(); draw(); sync(); }));
  };

  const preview = (f) => {
    const c = f.c ? `var(--cat-${f.c})` : 'var(--cat-none)';
    const p = el.querySelector('#mv-preview');
    p.innerHTML = `<a class="preview" href="${hrefFor(f)}" style="--c:${c}">
      <span class="card-media">${icon(f.k, { size: 32, width: 1.6 })}${f.img ? `<img src="${esc(commonsThumb(f.img, 240))}" alt="" onerror="this.remove()">` : ''}</span>
      <span class="card-body"><span class="card-sub">${esc(KINDS[f.k]?.label || '')}${f.c ? ` · ${esc(CATEGORIES[f.c].short)}` : ''}</span>
        <span class="card-title">${esc(f.n || KINDS[f.k]?.label)}</span>
        <span class="facts">${factsHtml(f, { compact: true })}</span>
        <span class="go">Voir la fiche →</span></span>
      <button class="icon-btn x" aria-label="Fermer l’aperçu"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></a>`;
    p.querySelector('.x').addEventListener('click', (e) => { e.preventDefault(); p.innerHTML = ''; });
  };

  function draw() {
    const want = new Map();
    for (const f of db.features.values()) if (visible(f)) want.set(f.id, f);
    const rm = [];
    for (const [id, m] of markers) if (!want.has(id) || m._f !== want.get(id)) { rm.push(m); markers.delete(id); }
    cluster.removeLayers(rm);
    const add = [];
    for (const [id, f] of want) {
      if (markers.has(id)) continue;
      const m = L.marker([f.la, f.lo], { icon: iconFor(f), keyboard: false });
      m._f = f;
      m.bindTooltip(() => tooltipHtml(f), { direction: 'top', offset: [0, -8] });
      m.on('click', () => preview(f));
      markers.set(id, m);
      add.push(m);
    }
    cluster.addLayers(add);
  }

  const sync = () => {
    const c = api.map.getCenter();
    setQuery({ m: `${api.map.getZoom()}/${c.lat.toFixed(4)}/${c.lng.toFixed(4)}`, types: [...types], cat: [...cats] });
  };
  const bbox = () => { const b = api.map.getBounds(); return [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]; };
  const liveBox = () => {
    const [s, w, n, e] = bbox(), cl = (s + n) / 2, co = (w + e) / 2, h = Math.min(0.35, n - s) / 2, k = Math.min(0.35, e - w) / 2;
    return [cl - h, co - k, cl + h, co + k];
  };
  const liveBtn = el.querySelector('#mv-live');
  const status = el.querySelector('#mv-status');
  const onMove = debounce(async () => {
    sync();
    if (api.map.getZoom() >= 7) await loadTilesForBbox(bbox());
    liveBtn.hidden = !(api.map.getZoom() >= 11 && !bboxCovered(bbox()) && !liveCovered(liveBox()));
  }, 250);
  api.map.on('moveend', onMove);
  liveBtn.addEventListener('click', async () => {
    liveBtn.disabled = true;
    status.className = 'map-status show busy';
    try {
      const n = await loadLive(liveBox(), { onProgress: (t) => { status.textContent = `OpenStreetMap : ${t}`; } });
      status.className = 'map-status show';
      status.textContent = `${num(n)} lieux et itinéraires chargés`;
      setTimeout(() => status.classList.remove('show'), 2500);
    } catch (e) {
      status.className = 'map-status';
      toast(`Chargement impossible (${e.message}). Réessayez dans un instant.`);
    }
    liveBtn.disabled = false;
    onMove();
  });

  const off = onData(draw);
  chips();
  await loadOverview();
  draw();
  onMove();
  if (!meta) toast('Pas de données collectées ici : zoomez sur une zone puis « Charger cette zone ».', 6000);
  return () => { off(); api.destroy(); };
}
