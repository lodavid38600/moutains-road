// Utilitaires pour les scripts de collecte (Node ≥ 18, sans dépendance).
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CACHE_DIR = join(ROOT, '.cache');
export const DATA_DIR = join(ROOT, 'data');
export const RAW_DIR = join(CACHE_DIR, 'raw');
export const USER_AGENT = 'MountainsRoad/1.0 (https://github.com/lodavid38600/moutains-road; collecte de données de randonnée)';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function readJson(path, fallback = undefined) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (e) {
    if (fallback !== undefined) return fallback;
    throw e;
  }
}

export async function writeJson(path, data, pretty = false) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data));
}

export async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

export const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);

/** Mise en cache disque d'un calcul asynchrone (durée de vie en jours). */
export async function cached(name, maxAgeDays, fn) {
  const path = join(CACHE_DIR, 'http', name + '.json');
  try {
    const s = await stat(path);
    if (Date.now() - s.mtimeMs < maxAgeDays * 86400e3) return JSON.parse(await readFile(path, 'utf8'));
  } catch { /* pas en cache */ }
  const data = await fn();
  await writeJson(path, data);
  return data;
}

export function log(...args) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}]`, ...args);
}

/** Lit les options « --cle=valeur » / « --drapeau » de la ligne de commande. */
export function args() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] ?? true;
  }
  return out;
}
