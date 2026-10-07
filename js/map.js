// Carte Leaflet : fonds de carte, marqueurs regroupés, tracés d'itinéraires.
/* global L */
import { KINDS } from './lib/categories.js';
import { catColor, esc, meters } from './util.js';

let map, cluster, geomLayer, hoverMarker, selectMarker;
const markers = new Map(); // id → marker
let onSelect = () => {};

// Un seul fond par défaut ; les autres restent accessibles dans le menu « couches ».
// `preview` : tuile d'aperçu (massif du Mont-Blanc, z10).
export const BASES = [
  { id: 'topo', name: 'Topo', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', maxZoom: 17, subdomains: 'abc',
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
function iconFor(f) {
  const color = f.c ? catColor(f.c) : KINDS[f.k]?.color || '#777';
  const key = `${f.k}|${color}`;
  if (!iconCache.has(key)) {
    const svg = (SHAPES[f.k] || SHAPES.viewpoint)(color);
    const size = f.k === 'route' || f.k === 'ferrata' ? 20 : 18;
    iconCache.set(key, L.divIcon({ className: 'mk', html: svg, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }));
  }
  return iconCache.get(key);
}
export function resetIcons() { iconCache.clear(); }

// ---------------------------------------------------------------- init
let baseLayer;
const overlayLayers = new Map();

export function initMap(el, { center = [45.9, 6.9], zoom = 8, onSelect: sel, onMove } = {}) {
  onSelect = sel || onSelect;
  map = L.map(el, { zoomControl: false, preferCanvas: true, worldCopyJump: true, tap: true }).setView(center, zoom);
  if (matchMedia('(min-width: 761px)').matches) L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);
  let base = 'topo';
  try { base = localStorage.getItem('mr-base') || base; } catch { /* stockage indisponible */ }
  setBase(base);

  cluster = L.markerClusterGroup({
    chunkedLoading: true, maxClusterRadius: (z) => (z < 9 ? 64 : 44), disableClusteringAtZoom: 14,
    showCoverageOnHover: false, spiderfyOnMaxZoom: true,
  });
  map.addLayer(cluster);
  geomLayer = L.layerGroup().addTo(map);

  map.on('moveend', () => onMove?.(getBbox(), map.getZoom()));
  map.on('locationfound', (e) => map.setView(e.latlng, Math.max(map.getZoom(), 13)));
  return map;
}

export function setBase(id) {
  const def = BASES.find((b) => b.id === id) || BASES[0];
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = L.tileLayer(def.url, { maxZoom: 19, maxNativeZoom: def.maxZoom, subdomains: def.subdomains || 'abc', attribution: def.attribution }).addTo(map);
  baseLayer.bringToBack();
  baseLayer._id = def.id;
  try { localStorage.setItem('mr-base', def.id); } catch { /* */ }
}
export const currentBase = () => baseLayer?._id;

export function toggleOverlay(id, on) {
  const def = OVERLAYS.find((o) => o.id === id);
  if (!def) return;
  if (on && !overlayLayers.has(id)) {
    overlayLayers.set(id, L.tileLayer(def.url, { maxZoom: 19, maxNativeZoom: def.maxZoom, opacity: def.opacity, attribution: def.attribution }).addTo(map));
  } else if (!on && overlayLayers.has(id)) {
    map.removeLayer(overlayLayers.get(id));
    overlayLayers.delete(id);
  }
}
export const overlayOn = (id) => overlayLayers.has(id);
export const locate = () => map.locate({ enableHighAccuracy: true });

export const getMap = () => map;

export function getBbox(pad = 0) {
  const b = map.getBounds().pad(pad);
  return [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];
}

function tooltipHtml(f) {
  const bits = [];
  if (f.km) bits.push(`${String(f.km).replace('.', ',')} km`);
  if (f.up) bits.push(`↗ ${meters(f.up)}`);
  if (!f.km && f.e) bits.push(meters(f.e));
  return `<b>${esc(f.n || KINDS[f.k]?.label)}</b>${bits.length ? '<br>' + bits.join(' · ') : ''}`;
}

/** Remplace l'ensemble des marqueurs affichés. */
export function renderMarkers(list) {
  const keep = new Set(list.map((f) => f.id));
  const toRemove = [];
  for (const [id, m] of markers) {
    if (!keep.has(id)) { toRemove.push(m); markers.delete(id); }
  }
  cluster.removeLayers(toRemove);
  const toAdd = [];
  for (const f of list) {
    const prev = markers.get(f.id);
    if (prev && prev._f === f) continue;
    if (prev) { cluster.removeLayer(prev); }
    const m = L.marker([f.la, f.lo], { icon: iconFor(f), title: f.n || '', riseOnHover: true, keyboard: false });
    m._f = f;
    m.bindTooltip(() => tooltipHtml(f), { direction: 'top', offset: [0, -8] });
    m.on('click', () => onSelect(f));
    markers.set(f.id, m);
    toAdd.push(m);
  }
  cluster.addLayers(toAdd);
}

export function refreshIcons() {
  resetIcons();
  for (const m of markers.values()) m.setIcon(iconFor(m._f));
}

/** Affiche le tracé d'un itinéraire. */
export function showGeometry(f, lines, { fit = true, padding } = {}) {
  geomLayer.clearLayers();
  const color = catColor(f.c);
  L.polyline(lines, { color: '#fff', weight: 8, opacity: 0.85, interactive: false }).addTo(geomLayer);
  const pl = L.polyline(lines, { color, weight: 4.5, opacity: 1 }).addTo(geomLayer);
  if (fit && lines.length) fitBounds(pl.getBounds(), padding);
  // Départ / arrivée.
  if (lines.length) {
    const dot = (p, fill) => L.circleMarker(p, { radius: 6, color: '#fff', weight: 2.5, fillColor: fill, fillOpacity: 1, interactive: false }).addTo(geomLayer);
    dot(lines[0][0], color);
    if (lines.length === 1) dot(lines[0].at(-1), '#222');
  }
}

/** Ajuste la vue en tenant compte des panneaux qui recouvrent la carte. */
export function fitBounds(bounds, padding = {}) {
  const { left = 40, bottom = 40, top = 40, right = 40 } = padding;
  map.fitBounds(bounds, { paddingTopLeft: [left, top], paddingBottomRight: [right, bottom], maxZoom: 15 });
}

export function clearGeometry() { geomLayer.clearLayers(); }

export function highlight(f) {
  if (selectMarker) map.removeLayer(selectMarker);
  selectMarker = null;
  if (!f) { geomLayer.clearLayers(); return; }
  selectMarker = L.circleMarker([f.la, f.lo], { radius: 16, color: catColor(f.c), weight: 3, fill: false, interactive: false }).addTo(map);
}

export function setHoverPoint(latlng) {
  if (!latlng) { if (hoverMarker) { map.removeLayer(hoverMarker); hoverMarker = null; } return; }
  if (!hoverMarker) hoverMarker = L.marker(latlng, { icon: L.divIcon({ className: '', html: '<div class="hover-dot"></div>', iconSize: [14, 14] }), interactive: false }).addTo(map);
  else hoverMarker.setLatLng(latlng);
}

/** Centre un point en le décalant pour qu'il reste visible à côté du panneau / au-dessus de la feuille. */
export function flyTo(la, lo, zoom = 13, offset = [0, 0]) {
  const z = Math.max(zoom, map.getZoom());
  const p = map.project([la, lo], z).add(L.point(-offset[0] / 2, offset[1] / 2));
  map.flyTo(map.unproject(p, z), z, { duration: 0.7 });
}
export function fitBbox([s, w, n, e]) { map.fitBounds([[s, w], [n, e]]); }
export function invalidate() { map?.invalidateSize(); }
