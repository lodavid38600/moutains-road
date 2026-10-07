// Chargeur de tuiles MNT Terrarium dans le navigateur (décodage via canvas).
import { Dem, terrariumUrl, terrarium } from './lib/dem.js';

async function loadTile(z, x, y) {
  const res = await fetch(terrariumUrl(z, x, y));
  if (!res.ok) return null;
  const bmp = await createImageBitmap(await res.blob());
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const { data } = ctx.getImageData(0, 0, 256, 256);
  const out = new Float32Array(256 * 256);
  for (let i = 0; i < out.length; i++) out[i] = terrarium(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  return out;
}

let dem;
export const browserDem = () => (dem ||= new Dem(loadTile, { maxTiles: 120 }));
