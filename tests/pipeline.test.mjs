// Tests du pipeline de données (node --test tests/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { parseOverpass, applyMetrics, classify } from '../js/lib/normalize.js';
import { Dem, routeMetrics, gainLoss, resample } from '../js/lib/dem.js';
import { encode, decode, simplify } from '../js/lib/polyline.js';
import { chainWays } from '../js/lib/geo.js';
import { estimateHours, plainDifficulty, accessSentence } from '../js/lib/categories.js';
import { decodePng } from '../scripts/lib/dem-node.mjs';

const line = (la1, lo1, la2, lo2, n = 20) =>
  Array.from({ length: n + 1 }, (_, i) => ({ lat: la1 + ((la2 - la1) * i) / n, lon: lo1 + ((lo2 - lo1) * i) / n }));

test('parseOverpass : itinéraire, difficulté, accès au sommet', () => {
  const json = {
    elements: [
      { type: 'relation', id: 1, center: { lat: 45.05, lon: 6.05 }, tags: { type: 'route', route: 'hiking', name: 'Tour test', network: 'lwn' },
        members: [{ type: 'way', ref: 10, role: '' }, { type: 'way', ref: 11, role: '' }, { type: 'node', ref: 5, role: 'guidepost' }] },
      { type: 'way', id: 11, tags: { highway: 'path', sac_scale: 'demanding_mountain_hiking' }, geometry: line(45.05, 6.05, 45.1, 6.05) },
      { type: 'way', id: 10, tags: { highway: 'path', sac_scale: 'hiking' }, geometry: line(45.0, 6.05, 45.05, 6.05) },
      { type: 'node', id: 100, lat: 45.1, lon: 6.05, tags: { natural: 'peak', name: 'Pic Test', ele: '2 345' } },
      { type: 'node', id: 101, lat: 46.0, lon: 7.0, tags: { natural: 'peak', name: 'Pic Sauvage', ele: '3800' } },
      { type: 'node', id: 103, lat: 42.0, lon: 9.0, tags: { natural: 'peak', name: 'Colline du maquis', ele: '420' } },
      { type: 'node', id: 102, lat: 46.0, lon: 7.1, tags: { sport: 'climbing', leisure: 'sports_centre', name: 'Salle' } },
    ],
  };
  const { features, routeWays } = parseOverpass(json);
  const byId = Object.fromEntries(features.map((f) => [f.id, f]));
  const r = byId.r1;
  assert.equal(r.k, 'route');
  assert.equal(r.t, 3);
  assert.equal(r.c, 'montagne');
  assert.ok(Math.abs(r.km - 11.1) < 0.3, `km=${r.km}`);
  assert.equal(routeWays.get('r1').length, 2);
  assert.equal(byId.n100.e, 2345);
  assert.equal(byId.n100.acc.t, 3);
  assert.equal(byId.n100.c, 'montagne');
  assert.equal(byId.n101.c, 'alpinisme');
  assert.equal(accessSentence(byId.n101).text, 'Pas de sentier : terrain d’alpinisme');
  assert.equal(byId.n103.c, undefined, 'une colline sans sentier n’est pas de l’alpinisme');
  assert.equal(accessSentence(byId.n103).text, 'Pas de sentier balisé jusqu’au sommet');
  assert.equal(byId.n102, undefined, 'salle d’escalade exclue');
});

test('chainWays raccorde des chemins dans le désordre', () => {
  const a = [[0, 0], [0, 1]], b = [[0, 2], [0, 1]], c = [[0, 2], [0, 3]];
  const chains = chainWays([c, a, b]);
  assert.equal(chains.length, 1);
  assert.equal(chains[0].pts.length, 4);
  // Raccord par l'arrière : le premier tronçon n'est pas au début.
  const back = chainWays([[[0, 1], [0, 2]], [[0, 0], [0, 1]]]);
  assert.deepEqual(back[0].pts, [[0, 0], [0, 1], [0, 2]]);
});

test('chainWays reste rapide sur un très long itinéraire (GR)', () => {
  const ways = [];
  for (let i = 0; i < 5000; i++) ways.push([[45, 6 + i * 0.001], [45, 6 + (i + 1) * 0.001]]);
  ways.sort(() => 0.5 - Math.random());
  const t0 = Date.now();
  const chains = chainWays(ways);
  assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
  assert.equal(chains.length, 1);
  assert.equal(chains[0].pts.length, 5001);
});

test('dénivelé : une montée régulière de 1000 m', async () => {
  // MNT synthétique : altitude = 1000 + (lat - 45) * 10000 (1000 m pour 0,1°).
  const dem = new Dem(async () => null);
  dem.at = async (la) => 1000 + (la - 45) * 10000;
  const m = await routeMetrics([line(45, 6, 45.1, 6).map((p) => [p.lat, p.lon])], dem);
  assert.ok(Math.abs(m.up - 1000) < 15, `up=${m.up}`);
  assert.ok(m.dn < 15);
  assert.equal(m.emax, 2000);
  assert.ok(m.profile.length > 10 && m.profile.length <= 400);
  const f = applyMetrics({ k: 'route', km: null, tg: {} }, m);
  assert.equal(f.upSrc, 'mnt');
  assert.ok(f.h > 3 && f.h < 6, `h=${f.h}`);
  const g = applyMetrics({ k: 'route', tg: { ascent: '1200' } }, m);
  assert.equal(g.up, 1200, 'le tag OSM ascent est prioritaire');
});

test('gainLoss ignore le bruit', () => {
  const noisy = Array.from({ length: 200 }, (_, i) => 1000 + (i % 2 ? 1.5 : -1.5));
  const r = gainLoss(noisy);
  assert.ok(r.up < 5 && r.dn < 5, JSON.stringify(r));
});

test('resample respecte le pas', () => {
  const s = resample([[45, 6], [45.01, 6]], 0.1);
  assert.ok(s.length >= 11 && s.length <= 13);
});

test('polyline encode/decode/simplify', () => {
  const pts = [[45.12345, 6.54321], [45.2, 6.6], [45.3, 6.61]];
  assert.deepEqual(decode(encode(pts)), pts);
  assert.equal(simplify([[0, 0], [0.00001, 0.5], [0, 1]], 1e-3).length, 2);
});

test('durée DIN 33466', () => {
  assert.equal(estimateHours(12, 0, 0), 3);
  assert.equal(estimateHours(4, 900, 0), 3.5); // 1 h horizontal, 3 h vertical
});

test('difficulté en langage simple', () => {
  assert.deepEqual(plainDifficulty({ k: 'route', t: 3 }), { code: 'T3', text: 'Sentier raide, pied sûr nécessaire' });
  assert.equal(plainDifficulty(classify({ k: 'ferrata', vf: 2 })).code, 'PD');
});

test('décodage PNG (filtres 0 à 4, RGB)', () => {
  const w = 4, h = 5, ch = 3;
  const px = Buffer.alloc(w * h * ch);
  for (let i = 0; i < px.length; i++) px[i] = (i * 37 + 11) & 0xff;
  // Encode chaque ligne avec un filtre différent.
  const raw = [];
  for (let y = 0; y < h; y++) {
    const f = y % 5;
    raw.push(f);
    for (let x = 0; x < w * ch; x++) {
      const v = px[y * w * ch + x];
      const a = x >= ch ? px[y * w * ch + x - ch] : 0;
      const b = y ? px[(y - 1) * w * ch + x] : 0;
      const c = y && x >= ch ? px[(y - 1) * w * ch + x - ch] : 0;
      let pred = 0;
      if (f === 1) pred = a; else if (f === 2) pred = b; else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      raw.push((v - pred) & 0xff);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(raw))), chunk('IEND', Buffer.alloc(0))]);
  const out = decodePng(png);
  assert.deepEqual(Buffer.from(out.pixels), px);
});

test('lieux traversés par un itinéraire, avec leur position sur le profil', async () => {
  const { mainLines, placesAlong } = await import('../js/lib/along.js');
  const line = Array.from({ length: 11 }, (_, i) => [45 + i * 0.01, 6]); // ~11 km vers le nord
  const main = mainLines([line]);
  const wp = placesAlong(main, [
    { id: 'sommet', la: 45.05, lo: 6.001 },   // ~80 m du tracé, à mi-parcours
    { id: 'loin', la: 45.05, lo: 6.02 },      // ~1,6 km : ignoré
    { id: 'refuge', la: 45.1, lo: 6 },        // à l'arrivée
  ]);
  assert.deepEqual(wp.map((w) => w.id), ['sommet', 'refuge']);
  assert.ok(Math.abs(wp[0].km - 5.56) < 0.1, `km=${wp[0].km}`);
});

test('voies d’ascension : plusieurs départs distincts, sans doublon', async () => {
  const { findAscents } = await import('../js/lib/ascent.js');
  // Sommet en (45.05, 6.05). Trois sentiers : nord (parking N), sud (refuge S),
  // et un prolongement du sentier nord vers un second parking plus loin (doit être écarté).
  let nid = 1;
  const nodes = [];
  const way = (id, pts, tags) => {
    const ids = pts.map((p) => {
      const found = nodes.find((n) => n.la === p[0] && n.lo === p[1]);
      if (found) return found.id;
      const n = { id: nid++, la: p[0], lo: p[1] }; nodes.push(n); return n.id;
    });
    return { type: 'way', id, nodes: ids, geometry: pts.map(([lat, lon]) => ({ lat, lon })), tags: { highway: 'path', ...tags } };
  };
  const line = (a, b, n = 10) => Array.from({ length: n + 1 }, (_, i) => [+(a[0] + (b[0] - a[0]) * i / n).toFixed(6), +(a[1] + (b[1] - a[1]) * i / n).toFixed(6)]);
  const S = [45.05, 6.05];
  const json = { elements: [
    way(1, line([45.08, 6.05], S), { sac_scale: 'mountain_hiking' }),
    way(2, line([45.02, 6.05], S), { sac_scale: 'alpine_hiking' }),
    way(3, line([45.10, 6.05], [45.08, 6.05]), {}),
    { type: 'node', id: 900, lat: 45.0801, lon: 6.0501, tags: { amenity: 'parking', name: 'Parking du Nord' } },
    { type: 'node', id: 901, lat: 45.1001, lon: 6.0501, tags: { amenity: 'parking' } },
    { type: 'node', id: 902, lat: 45.0201, lon: 6.0499, tags: { tourism: 'alpine_hut', name: 'Refuge du Sud' } },
    { type: 'node', id: 903, lat: 45.09, lon: 6.06, tags: { place: 'village', name: 'Villard' } },
  ] };
  const dem = { many: async (pts) => pts.map(([la]) => 1000 + (0.05 - Math.abs(la - 45.05)) * 30000) };
  const { ascents } = await findAscents({ la: 45.05, lo: 6.05, e: 2500 }, json, dem);
  const names = ascents.map((a) => a.start.name).sort();
  assert.deepEqual(names, ['Parking du Nord', 'Refuge du Sud']);
  const sud = ascents.find((a) => a.start.kind === 'hut');
  assert.equal(sud.t, 4);
  assert.ok(sud.up > 800 && sud.up < 1000, `D+=${sud.up}`);
  assert.ok(sud.km > 3 && sud.km < 3.6, `km=${sud.km}`);
  assert.ok(sud.profile.at(-1)[1] > sud.profile[0][1], 'le profil va du départ vers le sommet');
});

test('sommet dont toutes les voies sont d’alpinisme', async () => {
  const { classify } = await import('../js/lib/normalize.js');
  const f = classify({ k: 'peak', n: 'Mont Blanc', e: 4807, acc: { nw: 2, t: 4 }, c2cAlpi: 1 });
  assert.equal(f.c, 'alpinisme');
  assert.equal(plainDifficulty(f), null);
  assert.equal(accessSentence(f).text, 'Sommet d’alpinisme');
});
