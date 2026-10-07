#!/usr/bin/env node
// Télécharge les données déjà publiées (GitHub Pages) pour utiliser le site en local
// sans relancer la collecte : node scripts/download-data.mjs --from=https://<compte>.github.io/<depot>/
import { join } from 'node:path';
import { DATA_DIR, writeJson, log, args } from './lib/util.mjs';

const from = String(args().from || '').replace(/\/?$/, '/');
if (!/^https?:\/\//.test(from)) {
  console.error('Usage : node scripts/download-data.mjs --from=https://<compte>.github.io/<depot>/');
  process.exit(1);
}
const get = async (path) => {
  const res = await fetch(from + 'data/' + path);
  if (!res.ok) throw new Error(`${path} : HTTP ${res.status}`);
  return res.json();
};

const meta = await get('meta.json');
const files = ['overview.json', 'stats.json',
  ...meta.searchKeys.map((k) => `search/${k}.json`),
  ...Object.keys(meta.tiles).map((k) => `tiles/${k}.json`)];
log(`${files.length} fichiers à télécharger (+ tracés)…`);
let done = 0;
const queue = files.slice();
async function worker() {
  while (queue.length) {
    const f = queue.shift();
    try {
      await writeJson(join(DATA_DIR, f), await get(f));
      if (f.startsWith('tiles/')) {
        const key = f.slice(6, -5);
        try { await writeJson(join(DATA_DIR, 'geom', `${key}.json`), await get(`geom/${key}.json`)); } catch { /* pas de tracé */ }
      }
    } catch (e) { log(`✗ ${e.message}`); }
    if (++done % 200 === 0) log(`${done}/${files.length}`);
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
await writeJson(join(DATA_DIR, 'meta.json'), meta, true);
log('Données téléchargées dans data/ ✔ — lancez « npm start ».');
