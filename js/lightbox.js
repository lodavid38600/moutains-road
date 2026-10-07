// Visionneuse de photos plein écran (clavier + balayage).
import { $, esc } from './util.js';

let photos = [], index = 0, startX = null;
const lb = () => $('#lightbox');

function render() {
  const p = photos[index];
  const img = lb().querySelector('img');
  img.src = p.full || (p.thumb || '').replace(/\/\d+px-/, '/1600px-').replace(/width=\d+/, 'width=1600');
  img.alt = p.desc || '';
  const credit = [p.author, p.license].filter(Boolean).join(' · ');
  lb().querySelector('figcaption').innerHTML = `${p.desc ? esc(p.desc) + '<br>' : ''}${credit ? esc(credit) + ' · ' : ''}${p.page ? `<a href="${esc(p.page)}" target="_blank" rel="noopener">Voir sur Wikimedia Commons</a>` : ''} <span style="opacity:.7">(${index + 1}/${photos.length})</span>`;
  lb().querySelector('.lb-prev').hidden = photos.length < 2;
  lb().querySelector('.lb-next').hidden = photos.length < 2;
}

export function openLightbox(list, i = 0) {
  photos = list; index = i;
  lb().hidden = false;
  render();
  lb().querySelector('.lb-close').focus();
}
const close = () => { lb().hidden = true; lb().querySelector('img').src = ''; };
const move = (d) => { index = (index + d + photos.length) % photos.length; render(); };

export function initLightbox() {
  const el = lb();
  el.querySelector('.lb-close').addEventListener('click', close);
  el.querySelector('.lb-prev').addEventListener('click', () => move(-1));
  el.querySelector('.lb-next').addEventListener('click', () => move(1));
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  el.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (startX == null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) move(dx < 0 ? 1 : -1);
    startX = null;
  });
  document.addEventListener('keydown', (e) => {
    if (el.hidden) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') move(-1);
    if (e.key === 'ArrowRight') move(1);
  });
}
