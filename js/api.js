// Enrichissements en direct depuis les API ouvertes (toutes accessibles en CORS) :
// Wikipedia, Wikidata, Wikimedia Commons, Open-Meteo (météo + altitudes), Overpass.
import { fetchJson } from './util.js';
import { runOverpass, geometryQuery, pathsAroundQuery } from './lib/overpass.js';

const memo = new Map();
const once = (key, fn) => {
  if (!memo.has(key)) memo.set(key, fn().catch((e) => { memo.delete(key); throw e; }));
  return memo.get(key);
};

/** Résumé Wikipedia (« fr:Mont Blanc »). */
export function wikiSummary(wp) {
  return once('wp:' + wp, async () => {
    const m = /^([a-z-]+):(.+)$/.exec(wp);
    if (!m) return null;
    const url = `https://${m[1]}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(m[2].replace(/ /g, '_'))}`;
    const j = await fetchJson(url);
    return { title: j.title, extract: j.extract, url: j.content_urls?.desktop?.page, lang: m[1], thumb: j.originalimage?.source };
  });
}

/** Infos Wikidata d'un élément (pour les objets OSM liés à Wikidata). */
export function wikidataEntity(q) {
  return once('wd:' + q, async () => {
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${q}&props=claims|sitelinks|labels|descriptions&languages=fr|en&format=json&origin=*`;
    const j = await fetchJson(url);
    const e = j.entities?.[q];
    if (!e) return null;
    const claim = (p) => e.claims?.[p]?.[0]?.mainsnak?.datavalue?.value;
    const qty = (p) => { const v = claim(p); return v ? Math.round(parseFloat(v.amount)) : null; };
    const sl = e.sitelinks || {};
    return {
      label: e.labels?.fr?.value || e.labels?.en?.value,
      description: e.descriptions?.fr?.value || e.descriptions?.en?.value,
      img: claim('P18') || null,
      e: qty('P2044'),
      pr: qty('P2660'),
      wp: sl.frwiki ? `fr:${sl.frwiki.title}` : sl.enwiki ? `en:${sl.enwiki.title}` : null,
      sl: Object.keys(sl).filter((k) => k.endsWith('wiki')).length,
    };
  });
}

/** Photos Wikimedia Commons géolocalisées autour d'un point. */
export function commonsNearby(lat, lon, radius = 1500, limit = 24) {
  return once(`cn:${lat.toFixed(4)},${lon.toFixed(4)},${radius}`, async () => {
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*' +
      `&generator=geosearch&ggscoord=${lat}|${lon}&ggsradius=${radius}&ggsnamespace=6&ggslimit=${limit}` +
      '&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=400&iiextmetadatafilter=Artist|LicenseShortName|ImageDescription';
    const j = await fetchJson(url);
    return Object.values(j.query?.pages || {})
      .filter((p) => /image\/(jpeg|png|webp)/.test(p.imageinfo?.[0]?.mime || ''))
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((p) => fileInfo(p));
  });
}

/** Métadonnées d'un fichier Commons (auteur, licence). */
export function commonsFile(file) {
  return once('cf:' + file, async () => {
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*' +
      `&titles=File:${encodeURIComponent(file)}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=400` +
      '&iiextmetadatafilter=Artist|LicenseShortName|ImageDescription';
    const j = await fetchJson(url);
    const p = Object.values(j.query?.pages || {})[0];
    return p?.imageinfo ? fileInfo(p) : null;
  });
}

const stripHtml = (s) => (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
function fileInfo(p) {
  const ii = p.imageinfo[0];
  const md = ii.extmetadata || {};
  return {
    file: p.title.replace(/^File:/, ''),
    thumb: ii.thumburl || ii.url,
    page: ii.descriptionurl,
    author: stripHtml(md.Artist?.value).slice(0, 120),
    license: stripHtml(md.LicenseShortName?.value),
    desc: stripHtml(md.ImageDescription?.value).slice(0, 200),
  };
}

/** Prévisions à 7 jours (températures corrigées à l'altitude donnée). */
export function weather(lat, lon, ele) {
  return once(`wx:${lat.toFixed(3)},${lon.toFixed(3)},${ele}`, async () => {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      (ele != null ? `&elevation=${ele}` : '') +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max' +
      '&hourly=freezing_level_height&timezone=auto&forecast_days=7';
    const j = await fetchJson(url);
    const d = j.daily;
    // Isotherme 0 °C : valeur à midi pour chaque jour.
    const iso = {};
    j.hourly?.time?.forEach((t, i) => { if (t.endsWith('T12:00')) iso[t.slice(0, 10)] = j.hourly.freezing_level_height[i]; });
    return d.time.map((t, i) => ({
      date: t, code: d.weather_code[i], tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i],
      rain: d.precipitation_sum[i], wind: d.wind_speed_10m_max[i], gust: d.wind_gusts_10m_max[i], iso0: iso[t],
    }));
  });
}

export const WMO = {
  0: ['☀️', 'Ciel dégagé'], 1: ['🌤️', 'Peu nuageux'], 2: ['⛅', 'Partiellement nuageux'], 3: ['☁️', 'Couvert'],
  45: ['🌫️', 'Brouillard'], 48: ['🌫️', 'Brouillard givrant'],
  51: ['🌦️', 'Bruine légère'], 53: ['🌦️', 'Bruine'], 55: ['🌧️', 'Bruine forte'], 56: ['🌧️', 'Bruine verglaçante'], 57: ['🌧️', 'Bruine verglaçante'],
  61: ['🌦️', 'Pluie faible'], 63: ['🌧️', 'Pluie'], 65: ['🌧️', 'Pluie forte'], 66: ['🌧️', 'Pluie verglaçante'], 67: ['🌧️', 'Pluie verglaçante'],
  71: ['🌨️', 'Neige faible'], 73: ['🌨️', 'Neige'], 75: ['❄️', 'Neige forte'], 77: ['🌨️', 'Grains de neige'],
  80: ['🌦️', 'Averses'], 81: ['🌧️', 'Averses'], 82: ['⛈️', 'Fortes averses'], 85: ['🌨️', 'Averses de neige'], 86: ['❄️', 'Averses de neige'],
  95: ['⛈️', 'Orage'], 96: ['⛈️', 'Orage avec grêle'], 99: ['⛈️', 'Orage avec grêle'],
};

/** Altitudes (modèle numérique de terrain Copernicus 90 m via Open-Meteo). */
export async function elevations(points) {
  const out = [];
  for (let i = 0; i < points.length; i += 100) {
    const chunk = points.slice(i, i + 100);
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${chunk.map((p) => p[0].toFixed(5)).join(',')}&longitude=${chunk.map((p) => p[1].toFixed(5)).join(',')}`;
    const j = await fetchJson(url);
    out.push(...j.elevation);
  }
  return out;
}

/** Géométrie d'un itinéraire / chemin OSM → liste de chemins [[lat, lon], …]. */
export function osmGeometry(id) {
  return once('geom:' + id, async () => {
    const j = await runOverpass(geometryQuery(id[0], id.slice(1)), { retries: 2 });
    return j.elements.filter((e) => e.geometry).map((e) => e.geometry.map((p) => [p.lat, p.lon]));
  });
}

/** Chemins autour d'un sommet (analyse d'accès en direct). */
export function pathsAround(lat, lon, radius) {
  return once(`pa:${lat},${lon},${radius}`, async () => {
    const j = await runOverpass(pathsAroundQuery(lat, lon, radius), { retries: 2 });
    return j.elements.filter((e) => e.geometry);
  });
}
