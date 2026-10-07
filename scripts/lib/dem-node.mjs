// Chargeur de tuiles MNT pour Node : téléchargement + cache disque + décodage PNG
// (décodeur minimal intégré, sans dépendance).
import { inflateSync } from 'node:zlib';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { Dem, terrariumUrl, terrarium } from '../../js/lib/dem.js';
import { CACHE_DIR, USER_AGENT, sleep } from './util.mjs';

/** Décode un PNG 8 bits RGB / RGBA (non entrelacé). Renvoie { width, height, channels, pixels }. */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG invalide');
  let pos = 8, width, height, bitDepth, colorType, interlace;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || interlace || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`PNG non géré (profondeur ${bitDepth}, type ${colorType}, entrelacé ${interlace})`);
  }
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const o = y * stride, p = o - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[o + x - ch] : 0;
      const b = y ? out[p + x] : 0;
      const c = y && x >= ch ? out[p + x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[o + x] = v & 0xff;
    }
  }
  return { width, height, channels: ch, pixels: out };
}

async function loadTerrarium(z, x, y) {
  const path = join(CACHE_DIR, 'dem', String(z), String(x), `${y}.png`);
  let buf;
  try { buf = await readFile(path); } catch {
    for (let attempt = 0; attempt < 4 && !buf; attempt++) {
      try {
        const res = await fetch(terrariumUrl(z, x, y), { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30000) });
        if (res.status === 404 || res.status === 403) return null; // océan / hors couverture
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        buf = Buffer.from(await res.arrayBuffer());
      } catch (e) {
        if (attempt === 3) throw e;
        await sleep(1000 * (attempt + 1));
      }
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buf);
  }
  const { width, channels, pixels } = decodePng(buf);
  if (width !== 256) throw new Error('Tuile MNT inattendue');
  const out = new Float32Array(256 * 256);
  for (let i = 0; i < out.length; i++) {
    out[i] = terrarium(pixels[i * channels], pixels[i * channels + 1], pixels[i * channels + 2]);
  }
  return out;
}

export const createDem = (opts) => new Dem(loadTerrarium, opts);
