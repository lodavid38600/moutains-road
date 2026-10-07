// Photos : bandeau d'en-tête et galerie du secteur (Wikimedia Commons).
import * as api from '../api.js';
import { esc, icon, commonsThumb, commonsPage } from '../util.js';
import { openLightbox } from '../lightbox.js';

/** En-tête photo d'une fiche ; renvoie une fonction pour y ajouter des photos plus tard. */
export function heroPhotos(el, f, catVar) {
  let photos = f.img ? [{ file: f.img, thumb: commonsThumb(f.img, 1400), page: commonsPage(f.img) }] : [];
  const draw = () => {
    el.style.setProperty('--c', catVar);
    el.className = `detail-hero${photos.length ? '' : ' nophoto'}`;
    el.innerHTML = photos.length
      ? `<div class="strip">${photos.slice(0, 10).map((p, i) => `<button data-i="${i}" aria-label="Agrandir la photo ${i + 1}"><img src="${esc(p.thumb)}" alt="${esc(p.desc || '')}" loading="${i < 2 ? 'eager' : 'lazy'}"></button>`).join('')}</div>
         ${photos.length > 1 ? `<span class="count">${Math.min(10, photos.length)} photos</span>` : ''}`
      : `<div class="ico">${icon(f.k, { size: 48, width: 1.6 })}</div>`;
    el.querySelectorAll('[data-i]').forEach((b) => {
      b.addEventListener('click', () => openLightbox(photos, +b.dataset.i));
      b.querySelector('img').addEventListener('error', () => {
        const p = photos[+b.dataset.i];
        photos = photos.filter((x) => x !== p);
        draw();
      }, { once: true });
    });
  };
  draw();
  return {
    add(list) {
      const seen = new Set(photos.map((p) => p.thumb));
      const fresh = list.filter((p) => !seen.has(p.thumb));
      if (!fresh.length) return;
      photos = [...photos, ...fresh.map((p) => ({ ...p, thumb: p.thumb.replace(/\/\d+px-/, '/900px-') }))];
      draw();
    },
    get list() { return photos; },
  };
}

/** Galerie des photos géolocalisées autour d'un point ; alimente aussi l'en-tête. */
export async function sectorGallery(el, { la, lo, radius = 1500, hero, skip = [] }) {
  let list = [];
  try { list = await api.commonsNearby(la, lo, radius, 40); } catch { /* */ }
  const skipSet = new Set(skip);
  list = list.filter((p) => !skipSet.has(p.file));
  if (!list.length) { el.closest('.section')?.remove(); return []; }
  hero?.add(list.slice(0, 8));
  el.innerHTML = `<div class="gallery">${list.slice(0, 18).map((p, i) => `<button data-i="${i}" aria-label="Agrandir"><img src="${esc(p.thumb)}" alt="${esc(p.desc || '')}" loading="lazy" onerror="this.parentElement.remove()"></button>`).join('')}</div>
    <p class="muted small" style="margin-top:8px">${list.length} photo${list.length > 1 ? 's' : ''} géolocalisée${list.length > 1 ? 's' : ''} sur <a href="https://commons.wikimedia.org" target="_blank" rel="noopener">Wikimedia Commons</a> (licences libres, auteurs indiqués à l’agrandissement).</p>`;
  el.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => openLightbox(list, +b.dataset.i)));
  return list;
}
