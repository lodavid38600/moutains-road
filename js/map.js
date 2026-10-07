// Cartes Leaflet : un composant réutilisable (fiches, explorer, page Carte).
/* global L */
import { KINDS } from './lib/categories.js';
import { catColor, esc, meters } from './util.js';

// Un fond par défaut ; les autres dans le menu des couches.
// `preview` : tuile d'aperçu (massif du Mont-Blanc, z10).
export const BASES = [
  { id: 'topo', name: 'Topo', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', maxZoom: 17,
    attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  { id: 'osm', name: 'Plan', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  { id: 'sat', name: 'Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 19,
    attribution: 'Imagerie © Esri, Maxar, Earthstar Geographics' },
  { id: 'ign', name: 'IGN (France)', url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}', maxZoom: 19,
    attribution: '© <a href="https://www.ign.fr">IGN</a>' },
  { id: 'swiss', name: 'Swisstopo', url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg', maxZoom: 18,
    attribution: '© <a href="https://www.swisstopo.admin.ch">swisstopo</a>' },
  { id: 'ortho', name: 'Photos IGN', url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}', maxZoom: 19,
    attribution: '© <a href="https://www.ign.fr">IGN</a>' },
];
export const OVERLAYS = [
  { id: 'trails', name: 'Sentiers balisés', url: 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png', maxZoom: 18, opacity: 0.8,
    attribution: '© <a href="https://hiking.waymarkedtrails.org">Waymarked Trails</a>' },
  { id: 'slopes', name: 'Pentes raides (> 30°, France)', url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.SLOPES.MOUNTAIN&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}', maxZoom: 17, opacity: 0.55,
    attribution: '© IGN' },
  { id: 'shade', name: 'Relief ombré', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}', maxZoom: 16, opacity: 0.3,
    attribution: 'Relief © Esri' },
];
export const previewUrl = (l) => l.url.replace('{s}', 'a').replace('{z}', 10).replace('{x}', 531).replace('{y}', 365);

// ---------------------------------------------------------------- icônes
const SHAPES = {
  peak: (c) => `<svg width="18" height="16" viewBox="0 0 18 16"><path d="M9 1 17 15H1z" fill="${c}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  volcano: (c) => `<svg width="20" height="16" viewBox="0 0 20 16"><path d="M7 3h6l6 12H1z" fill="${c}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  col: (c) => `<svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 1 15 8 8 15 1 8z" fill="${c}" stroke="#fff" stroke-width="1.6"/></svg>`,
  route: (c) => `<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.5" fill="${c}" stroke="#fff" stroke-width="1.8"/><path d="M5 13c2-5 3 0 5-4s3 0 5-3" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  ferrata: (c) => `<svg width="20" height="20" viewBox="0 0 20 20"><rect x="1.5" y="1.5" width="17" height="17" rx="4" fill="${c}" stroke="#fff" stroke-width="1.8"/><path d="M6 5v10M14 5v10M6 8h8M6 12h8" stroke="#fff" stroke-width="1.6"/></svg>`,
  climbing: (c) => `<svg width="18" height="18" viewBox="0 0 18 18"><rect x="1.5" y="1.5" width="15" height="15" rx="7.5" fill="${c}" stroke="#fff" stroke-width="1.6"/><path d="M6 13l2-4 2 1 2-5" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  hut: (c) => `<svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 9 9 2l7 7v7H2z" fill="${c}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><rect x="7" y="11" width="4" height="5" fill="#fff"/></svg>`,
  shelter: (c) => `<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 14 8 2l7 12z" fill="${c}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 9v5" stroke="#fff" stroke-width="2"/></svg>`,
  viewpoint: (c) => `<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="${c}" stroke="#fff" stroke-width="1.6"/><circle cx="8" cy="8" r="2.4" fill="#fff"/></svg>`,
  glacier: (c) => `<svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 1l6 3.5v7L8 15l-6-3.5v-7z" fill="${c}" stroke="#fff" stroke-width="1.6"/></svg>`,
};
const iconCache = new Map();
export function iconFor(f, scale = 1) {
  const color = f.c ? catColor(f.c) : KINDS[f.k]?.color || '#777';
  const key = `${f.k}|${color}|${scale}`;
  if (!iconCache.has(key)) {
    const size = (f.k === 'route' || f.k === 'ferrata' ? 20 : 18) * scale;
    const svg = (SHAPES[f.k] || SHAPES.viewpoint)(color).replace('<svg ', `<svg style="transform:scale(${scale})" `);
    iconCache.set(key, L.divIcon({ className: 'mk', html: svg, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }));
  }
  return iconCache.get(key);
}
export const resetIcons = () => iconCache.clear();

export function tooltipHtml(f) {
  const bits = [];
  if (f.km) bits.push(`${String(f.km).replace('.', ',')} km`);
  if (f.up) bits.push(`↗ ${meters(f.up)}`);
  if (!f.km && (f.e ?? f.emax)) bits.push(meters(f.e ?? f.emax));
  return `<b>${esc(f.n || KINDS[f.k]?.label)}</b>${bits.length ? '<br>' + bits.join(' · ') : ''}`;
}

let savedBase = 'topo';
try { savedBase = localStorage.getItem('mr-base') || 'topo'; } catch { /* stockage indisponible */ }

/**
 * Crée une carte dans `el`.
 * @returns {object} API : map, setBase, toggleOverlay, line, marker, fit, hover, clear, destroy…
 */
export function createMap(el, { center = [45.9, 6.9], zoom = 9, scrollWheelZoom = true, zoomControl = true } = {}) {
  const map = L.map(el, { zoomControl: false, preferCanvas: true, worldCopyJump: true, scrollWheelZoom }).setView(center, zoom);
  if (zoomControl) L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  let base;
  const overlays = new Map();
  const groups = { lines: L.layerGroup().addTo(map), marks: L.layerGroup().addTo(map) };
  let hoverMk = null;

  const api = {
    map,
    setBase(id) {
      const def = BASES.find((b) => b.id === id) || BASES[0];
      if (base) map.removeLayer(base);
      base = L.tileLayer(def.url, { maxZoom: 19, maxNativeZoom: def.maxZoom, subdomains: 'abc', attribution: def.attribution }).addTo(map);
      base.bringToBack();
      api.base = def.id;
      savedBase = def.id;
      try { localStorage.setItem('mr-base', def.id); } catch { /* */ }
    },
    toggleOverlay(id, on) {
      const def = OVERLAYS.find((o) => o.id === id);
      if (on && def && !overlays.has(id)) overlays.set(id, L.tileLayer(def.url, { maxZoom: 19, maxNativeZoom: def.maxZoom, opacity: def.opacity, attribution: def.attribution }).addTo(map));
      if (!on && overlays.has(id)) { map.removeLayer(overlays.get(id)); overlays.delete(id); }
    },
    overlayOn: (id) => overlays.has(id),
    /** Tracé : lignes [[lat, lon]…], couleur CSS. */
    line(lines, color, { weight = 4.5, halo = true, group = groups.lines, onClick } = {}) {
      const g = L.layerGroup().addTo(group);
      if (halo) L.polyline(lines, { color: '#fff', weight: weight + 3.5, opacity: 0.85, interactive: false }).addTo(g);
      const pl = L.polyline(lines, { color, weight, opacity: 1 }).addTo(g);
      if (onClick) pl.on('click', onClick);
      g.bounds = pl.getBounds();
      g.poly = pl;
      return g;
    },
    marker(f, { onClick, group = groups.marks, scale = 1, tooltip = true } = {}) {
      const m = L.marker([f.la, f.lo], { icon: iconFor(f, scale), keyboard: false, riseOnHover: true }).addTo(group);
      if (tooltip) m.bindTooltip(() => tooltipHtml(f), { direction: 'top', offset: [0, -8] });
      if (onClick) m.on('click', () => onClick(f));
      return m;
    },
    dot(latlng, color, { label, group = groups.marks, r = 7 } = {}) {
      const m = L.circleMarker(latlng, { radius: r, color: '#fff', weight: 2.5, fillColor: color, fillOpacity: 1 }).addTo(group);
      if (label) m.bindTooltip(label, { direction: 'top', offset: [0, -6] });
      return m;
    },
    fit(bounds, padding = 30) { if (bounds?.isValid?.()) map.fitBounds(bounds, { padding: [padding, padding], maxZoom: 15 }); },
    fitPoints(points, padding = 30) { if (points.length) api.fit(L.latLngBounds(points), padding); },
    hover(latlng) {
      if (!latlng) { if (hoverMk) { map.removeLayer(hoverMk); hoverMk = null; } return; }
      if (!hoverMk) hoverMk = L.marker(latlng, { icon: L.divIcon({ className: '', html: '<div class="hover-dot"></div>', iconSize: [16, 16] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
      else hoverMk.setLatLng(latlng);
    },
    clear() { groups.lines.clearLayers(); groups.marks.clearLayers(); },
    groups,
    destroy() { map.remove(); },
    invalidate() { map.invalidateSize(); },
  };
  api.setBase(savedBase);
  return api;
}

/** Contrôle « couches » discret (fonds + calques) pour une carte. */
export function layersControl(api, container) {
  const btn = document.createElement('button');
  btn.className = 'map-ctl';
  btn.setAttribute('aria-label', 'Fonds de carte et calques');
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/></svg>';
  const pop = document.createElement('div');
  pop.className = 'layers-pop';
  pop.hidden = true;
  const render = () => {
    pop.innerHTML = `<h3>Fond de carte</h3>
      <div class="base-grid">${BASES.map((b) => `<button class="base-opt" data-base="${b.id}" aria-pressed="${b.id === api.base}"><img src="${esc(previewUrl(b))}" alt="" loading="lazy"><span>${esc(b.name)}</span></button>`).join('')}</div>
      <h3>Calques</h3>
      ${OVERLAYS.map((o) => `<label><input type="checkbox" data-ov="${o.id}" ${api.overlayOn(o.id) ? 'checked' : ''}> ${esc(o.name)}</label>`).join('')}`;
    pop.querySelectorAll('[data-base]').forEach((b) => b.addEventListener('click', () => { api.setBase(b.dataset.base); render(); }));
    pop.querySelectorAll('[data-ov]').forEach((i) => i.addEventListener('change', () => api.toggleOverlay(i.dataset.ov, i.checked)));
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); render(); pop.hidden = !pop.hidden; });
  document.addEventListener('pointerdown', (e) => { if (!pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) pop.hidden = true; });
  const ctl = L.control({ position: 'topright' });
  ctl.onAdd = () => { const d = L.DomUtil.create('div', 'leaflet-control'); d.append(btn); L.DomEvent.disableClickPropagation(d); return d; };
  ctl.addTo(api.map);
  container.append(pop);
  L.DomEvent.disableClickPropagation(pop);
  L.DomEvent.disableScrollPropagation(pop);
}
