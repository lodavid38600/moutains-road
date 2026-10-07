// Météo à 7 jours à une altitude donnée, en langage simple.
import * as api from '../api.js';
import { esc, num, meters } from '../util.js';

const DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const r100 = (n) => Math.round(n / 100) * 100;

export async function renderWeather(el, { la, lo, alt, where }) {
  el.innerHTML = '<p class="loading">Prévisions météo…</p>';
  let days;
  try { days = await api.weather(la, lo, alt ?? undefined); } catch {
    el.innerHTML = '<p class="muted">Prévisions indisponibles pour le moment.</p>';
    return;
  }
  const d0 = days[0];
  const notes = [];
  const [ic0, lbl0] = api.WMO[d0.code] || ['', ''];
  notes.push([ic0, `Aujourd’hui : ${lbl0.toLowerCase()}, ${Math.round(d0.tmax)}° au plus chaud, ${Math.round(d0.tmin)}° au plus froid`]);
  if (d0.iso0 != null) {
    if (alt != null && d0.iso0 < alt) notes.push(['❄️', `Il gèle à cette altitude aujourd’hui (gel dès ${num(r100(d0.iso0))} m)`]);
    else notes.push(['🌡️', `Gel au-dessus de ${num(r100(d0.iso0))} m`]);
  }
  if (d0.gust >= 60) notes.push(['💨', `Vent fort : rafales jusqu’à ${Math.round(d0.gust)} km/h`]);
  else if (d0.wind >= 30) notes.push(['💨', `Vent soutenu : ${Math.round(d0.wind)} km/h`]);
  if (d0.rain >= 1) notes.push([d0.tmax < 1 ? '🌨️' : '🌧️', `${d0.tmax < 1 ? 'Neige' : 'Pluie'} prévue : ${Math.round(d0.rain)} mm`]);
  if ([95, 96, 99].includes(d0.code)) notes.push(['⚡', 'Risque d’orage : partez tôt et évitez les crêtes l’après-midi']);
  el.innerHTML = `
    <div class="wx-days">${days.map((d) => {
      const [i, l] = api.WMO[d.code] || ['', ''];
      const dt = new Date(d.date + 'T12:00');
      return `<div class="wx-day" title="${esc(l)}"><span class="d">${DAYS[dt.getDay()]} ${dt.getDate()}</span><span class="i" aria-hidden="true">${i}</span>
        <span class="hi">${Math.round(d.tmax)}°</span><span class="lo">${Math.round(d.tmin)}°</span>
        ${d.iso0 != null ? `<span class="iso">gel ${num(r100(d.iso0))} m</span>` : ''}</div>`;
    }).join('')}</div>
    <div class="wx-notes">${notes.map(([i, t]) => `<div><span aria-hidden="true">${i}</span> ${esc(t)}</div>`).join('')}</div>
    <p class="muted small" style="margin-top:10px">Températures calculées ${where ? esc(where) : alt != null ? `à ${meters(alt)}` : ''}. Source : <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a>.</p>`;
}
