// Requêtes Overpass (OpenStreetMap) partagées entre la collecte (Node) et le
// mode « en direct » du navigateur. bbox = [sud, ouest, nord, est].

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const bb = (b) => b.map((n) => +n.toFixed(5)).join(',');

/**
 * Itinéraires de randonnée (relations route=hiking/foot/…) avec leurs membres,
 * puis la géométrie et les tags de tous les chemins qui les composent :
 * longueur, difficulté SAC et dénivelé sont calculés ensuite côté client.
 */
export function routesQuery(b, timeout = 900) {
  return `[out:json][timeout:${timeout}][maxsize:1073741824];
rel[type=route][route~"^(hiking|foot|walking|mountain_hiking|via_ferrata)$"](${bb(b)})->.routes;
.routes out center;
way(r.routes)->.w;
.w out geom;`;
}

/**
 * Sommets, cols, refuges, abris, via ferrata, escalade, points de vue, glaciers,
 * et les chemins à moins de 150 m des sommets nommés (pour savoir s'ils sont
 * accessibles en randonnée et à quelle difficulté).
 */
export function poisQuery(b, timeout = 900) {
  const B = bb(b);
  return `[out:json][timeout:${timeout}][maxsize:1073741824];
(
  node[natural~"^(peak|volcano|saddle)$"](${B});
  node[mountain_pass=yes](${B});
  node[tourism~"^(alpine_hut|wilderness_hut|viewpoint)$"](${B});
  node[amenity=shelter][shelter_type~"^(basic_hut|weather_shelter|lean_to|rock_shelter)$"](${B});
  node[sport=climbing](${B});
)->.n;
(
  way[tourism~"^(alpine_hut|wilderness_hut)$"](${B});
  way[highway=via_ferrata](${B});
  way[sport=climbing](${B});
  rel[sport=climbing](${B});
  way[natural=glacier][name](${B});
  rel[natural=glacier][name](${B});
)->.o;
.n out;
.o out tags center;
node.n[natural~"^(peak|volcano)$"][name]->.pk;
way(around.pk:150)[highway~"^(path|footway|track|via_ferrata|steps|bridleway)$"]->.acc;
.acc out tags geom;`;
}

/** Géométrie complète d'une relation (chemins membres) ou d'un chemin. */
export function geometryQuery(osmType, id) {
  if (osmType === 'r') return `[out:json][timeout:90];rel(${id});way(r);out geom;`;
  return `[out:json][timeout:60];way(${id});out geom;`;
}

/** Chemins (avec difficulté) autour d'un point, pour l'analyse d'accès. */
export function pathsAroundQuery(lat, lon, radius = 150) {
  return `[out:json][timeout:60];
way(around:${radius},${lat},${lon})[highway~"^(path|footway|track|via_ferrata|steps)$"];
out tags geom;`;
}

/**
 * Exécute une requête Overpass avec bascule entre serveurs et nouvelles
 * tentatives. `fetchImpl` permet d'injecter un fetch (Node / navigateur).
 */
export async function runOverpass(query, { endpoints = OVERPASS_ENDPOINTS, retries = 3, signal, userAgent, log = () => {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    for (const url of endpoints) {
      try {
        const headers = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Accept: 'application/json' };
        if (userAgent) headers['User-Agent'] = userAgent;
        const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers, signal });
        if (res.status === 429 || res.status === 504 || res.status === 503) {
          lastErr = new Error(`${url} → HTTP ${res.status}`);
          log(String(lastErr.message));
          continue;
        }
        if (!res.ok) throw new Error(`${url} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const text = await res.text();
        const json = JSON.parse(text);
        // Overpass renvoie parfois 200 avec un message d'erreur (timeout / mémoire).
        if (json.remark && /runtime error|timed out|out of memory/i.test(json.remark)) {
          const e = new Error(`Overpass: ${json.remark}`);
          e.overpassRemark = true;
          throw e;
        }
        return json;
      } catch (e) {
        if (signal?.aborted) throw e;
        lastErr = e;
        log(`${url}: ${e.message}`);
        if (e.overpassRemark) throw e; // inutile d'essayer ailleurs : la zone est trop grosse
      }
    }
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
  throw lastErr || new Error('Overpass indisponible');
}
