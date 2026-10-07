// Définitions partagées (navigateur + scripts Node) : types d'objets,
// catégories d'activité, échelles de difficulté et estimations.

/** Types d'objets géographiques. */
export const KINDS = {
  peak:      { label: 'Sommet',         plural: 'Sommets',          icon: '▲', color: '#8a5a2b' },
  volcano:   { label: 'Volcan',         plural: 'Volcans',          icon: '▲', color: '#c0392b' },
  col:       { label: 'Col',            plural: 'Cols',             icon: '⌒', color: '#6c7a89' },
  route:     { label: 'Itinéraire',     plural: 'Itinéraires',      icon: '〰', color: '#2e7d32' },
  ferrata:   { label: 'Via ferrata',    plural: 'Via ferrata',      icon: '⛓', color: '#ef6c00' },
  climbing:  { label: 'Site d’escalade', plural: 'Sites d’escalade', icon: '🧗', color: '#ad1457' },
  hut:       { label: 'Refuge',         plural: 'Refuges',          icon: '⌂', color: '#5d4037' },
  shelter:   { label: 'Abri / cabane',  plural: 'Abris & cabanes',  icon: '⌂', color: '#8d6e63' },
  viewpoint: { label: 'Point de vue',   plural: 'Points de vue',    icon: '◉', color: '#0277bd' },
  glacier:   { label: 'Glacier',        plural: 'Glaciers',         icon: '❄', color: '#4fc3f7' },
};

/** Catégories d'activité (« est-ce une rando ? de l'alpinisme ? ... »). */
export const CATEGORIES = {
  rando:     { label: 'Randonnée',            short: 'Rando',         color: '#2e7d32', desc: 'Sentiers faciles à moyens (T1–T2) : chemins balisés, sans difficulté technique.' },
  montagne:  { label: 'Randonnée en montagne', short: 'Rando montagne', color: '#1565c0', desc: 'Sentiers de montagne exigeants (T3) : passages raides, pierriers, pied sûr nécessaire.' },
  alpine:    { label: 'Randonnée alpine',     short: 'Rando alpine',  color: '#c62828', desc: 'Itinéraires alpins (T4–T5) : souvent hors sentier marqué, mains nécessaires, névés possibles.' },
  alpinisme: { label: 'Alpinisme',            short: 'Alpinisme',     color: '#7b3fc4', desc: 'Terrain alpin difficile (T6), glaciers, arêtes : matériel et expérience d’alpinisme requis.' },
  ferrata:   { label: 'Via ferrata',          short: 'Via ferrata',   color: '#ef6c00', desc: 'Parcours équipés de câbles et échelons : baudrier, longes et casque obligatoires.' },
  escalade:  { label: 'Escalade',             short: 'Escalade',      color: '#c2185b', desc: 'Sites et falaises d’escalade.' },
};

/**
 * Échelle SAC (randonnée) telle que taguée dans OpenStreetMap (sac_scale).
 * `plain` : formulation simple affichée partout ; `label` : nom officiel.
 */
export const SAC = {
  hiking:                    { t: 1, code: 'T1', plain: 'Sentier facile, bien tracé',                     label: 'Randonnée' },
  mountain_hiking:           { t: 2, code: 'T2', plain: 'Sentier de montagne, quelques passages raides',   label: 'Randonnée en montagne' },
  demanding_mountain_hiking: { t: 3, code: 'T3', plain: 'Sentier raide, pied sûr nécessaire',              label: 'Randonnée en montagne exigeante' },
  alpine_hiking:             { t: 4, code: 'T4', plain: 'Terrain alpin, mains parfois nécessaires',        label: 'Randonnée alpine' },
  demanding_alpine_hiking:   { t: 5, code: 'T5', plain: 'Terrain alpin exigeant, passages d’escalade facile', label: 'Randonnée alpine exigeante' },
  difficult_alpine_hiking:   { t: 6, code: 'T6', plain: 'Terrain alpin difficile, réservé aux alpinistes',  label: 'Randonnée alpine difficile' },
};
export const SAC_BY_T = Object.fromEntries(Object.values(SAC).map((s) => [s.t, s]));

/** Échelle via ferrata (via_ferrata_scale 0–6) → cotation française approx. */
export const FERRATA_SCALE = {
  0: 'Sentier aménagé', 1: 'F (facile)', 2: 'PD (peu difficile)', 3: 'AD (assez difficile)',
  4: 'D (difficile)', 5: 'TD (très difficile)', 6: 'ED (extrêmement difficile)',
};
export const FERRATA_PLAIN = {
  0: 'Sentier équipé, sans difficulté', 1: 'Facile, idéale pour débuter', 2: 'Peu difficile, quelques passages verticaux',
  3: 'Assez difficile, bonne condition physique', 4: 'Difficile, passages verticaux et déversants',
  5: 'Très difficile, très physique', 6: 'Extrême, réservée aux experts',
};

/** Difficulté en mots simples : « T3 · Sentier raide, pied sûr nécessaire ». */
export function plainDifficulty(f) {
  if ((f.k === 'ferrata' || f.c === 'ferrata') && f.vf != null) {
    return { code: FERRATA_SCALE[f.vf].split(' ')[0], text: FERRATA_PLAIN[f.vf] };
  }
  const t = f.t || f.acc?.t;
  if (!t) return null;
  return { code: SAC_BY_T[t].code, text: SAC_BY_T[t].plain };
}

/** Phrase d'accès à un sommet, en langage courant. */
export function accessSentence(f) {
  const a = f.acc;
  if (!a) return null;
  if (a.t) {
    const s = SAC_BY_T[a.t];
    if (a.t <= 2) return { c: categoryFromSac(a.t), text: 'Sommet accessible par un sentier de rando', detail: `${s.code} · ${s.plain}` };
    if (a.t === 3) return { c: 'montagne', text: 'Sommet accessible par un sentier de montagne exigeant', detail: `${s.code} · ${s.plain}` };
    if (a.t <= 5) return { c: 'alpine', text: 'Sommet accessible en randonnée alpine', detail: `${s.code} · ${s.plain}` };
    return { c: 'alpinisme', text: 'Accès difficile : terrain d’alpinisme', detail: `${s.code} · ${s.plain}` };
  }
  if (a.vf != null) return { c: 'ferrata', text: 'Sommet accessible par une via ferrata', detail: FERRATA_PLAIN[a.vf] };
  if (a.nw > 0) return { c: 'rando', text: 'Un sentier mène au sommet', detail: 'Difficulté non renseignée dans OpenStreetMap' };
  if (f.c === 'alpinisme') return { c: 'alpinisme', text: 'Pas de sentier : terrain d’alpinisme', detail: 'Haute montagne sans chemin cartographié jusqu’au sommet' };
  return { c: 'none', text: 'Pas de sentier balisé jusqu’au sommet', detail: 'Accès hors sentier : orientation et pied sûr nécessaires' };
}

export const NETWORKS = {
  iwn: 'Internationale',
  nwn: 'Nationale (GR)',
  rwn: 'Régionale (GR de Pays)',
  lwn: 'Locale (PR)',
};

/** Catégorie d'activité à partir d'un niveau SAC (1–6). */
export function categoryFromSac(t) {
  if (!t) return null;
  if (t <= 2) return 'rando';
  if (t === 3) return 'montagne';
  if (t <= 5) return 'alpine';
  return 'alpinisme';
}

/** Parse un tag sac_scale (gère les valeurs multiples « a;b »). Renvoie [niveaux]. */
export function parseSacList(v) {
  if (!v) return [];
  return String(v).split(';').map((s) => SAC[s.trim()]?.t).filter(Boolean);
}

/** Parse via_ferrata_scale (« 3 », « 3-4 », « 2;4 »). Renvoie [niveaux]. */
export function parseFerrataList(v) {
  if (!v) return [];
  return String(v).split(/[;\-–,]/).map((s) => parseInt(s, 10)).filter((n) => n >= 0 && n <= 6);
}

/** Durée estimée (h) selon la norme DIN 33466 (4 km/h, 300 m/h montée, 500 m/h descente). */
export function estimateHours(km, ascent = 0, descent = 0) {
  if (!km && !ascent) return null;
  const h = (km || 0) / 4;
  const v = (ascent || 0) / 300 + (descent || 0) / 500;
  return Math.max(h, v) + Math.min(h, v) / 2;
}

export function formatHours(h) {
  if (h == null || !isFinite(h)) return '—';
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60 / 5) * 5;
  if (mm === 60) return `${hh + 1} h`;
  return hh ? `${hh} h ${String(mm).padStart(2, '0')}` : `${mm} min`;
}

/** Parse une distance OSM (« 12.5 », « 12,5 km », « 800 m ») en km. */
export function parseDistanceKm(v) {
  if (v == null) return null;
  const m = String(v).replace(',', '.').match(/([\d.]+)\s*(km|m|mi)?/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return null;
  const unit = (m[2] || 'km').toLowerCase();
  return unit === 'm' ? n / 1000 : unit === 'mi' ? n * 1.609 : n;
}

/** Parse une altitude / un dénivelé OSM (« 1234 », « 1 234 m », « 4000 ft »). */
export function parseMeters(v) {
  if (v == null) return null;
  const s = String(v).split(';')[0].replace(/\s/g, '').replace(',', '.');
  const m = s.match(/^(-?[\d.]+)(m|ft|')?/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (!isFinite(n)) return null;
  if (m[2] && /ft|'/i.test(m[2])) n *= 0.3048;
  return Math.round(n);
}
