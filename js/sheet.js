// Feuille qui monte depuis le bas (mobile), façon Google Maps :
// trois positions (aperçu, moitié, plein écran), glisser avec le doigt.
// Sur grand écran, la feuille devient un panneau latéral fixe.

const mobile = () => matchMedia('(max-width: 760px)').matches;

export class Sheet {
  /**
   * @param {HTMLElement} el
   * @param {{ snaps?: number[], initial?: number, onClose?: Function, onSnap?: Function }} opts
   *   snaps : hauteurs visibles en fraction de la hauteur de la feuille (croissantes).
   */
  constructor(el, { snaps = [0.36, 0.62, 1], initial = 0, onClose, onSnap } = {}) {
    this.el = el;
    this.body = el.querySelector('.sheet-body');
    this.snaps = snaps;
    this.initial = initial;
    this.index = initial;
    this.onClose = onClose;
    this.onSnap = onSnap;
    for (const b of el.querySelectorAll('[data-close]')) b.addEventListener('click', () => this.close());
    for (const h of el.querySelectorAll('.sheet-handle, .sheet-head')) this._drag(h);
    // Faire défiler le contenu vers le bas depuis le haut d'une feuille ouverte la referme d'un cran.
    this._dragContent();
    window.addEventListener('resize', () => this._apply());
  }

  get open() { return !this.el.hidden; }

  show(index = this.initial) {
    this.el.hidden = false;
    this.index = index;
    this._apply();
  }

  close() {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.onClose?.();
  }

  snap(i) { this.index = Math.max(0, Math.min(this.snaps.length - 1, i)); this._apply(); this.onSnap?.(this.index); }

  /** Hauteur (px) de la feuille visible au-dessus du bas de l'écran (0 sur grand écran). */
  visibleHeight() {
    if (!this.open || !mobile()) return 0;
    return this.el.offsetHeight * this.snaps[this.index];
  }

  _apply() {
    if (!mobile()) { this.el.style.removeProperty('--sheet-y'); return; }
    this.el.style.setProperty('--sheet-y', `${(1 - this.snaps[this.index]) * 100}%`);
  }

  _drag(handle) {
    let startY = 0, startFrac = 0, lastY = 0, lastT = 0, v = 0, dragging = false, moved = false;
    handle.addEventListener('pointerdown', (e) => {
      if (!mobile() || e.target.closest('button, select, input, a')) return;
      dragging = true; moved = false;
      startY = lastY = e.clientY; lastT = e.timeStamp; v = 0;
      startFrac = this.snaps[this.index];
      this.el.classList.add('dragging');
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 4) moved = true;
      const frac = Math.max(0.05, Math.min(1, startFrac - dy / this.el.offsetHeight));
      this.el.style.setProperty('--sheet-y', `${(1 - frac) * 100}%`);
      const dt = e.timeStamp - lastT;
      if (dt > 0) v = (e.clientY - lastY) / dt;
      lastY = e.clientY; lastT = e.timeStamp;
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      this.el.classList.remove('dragging');
      if (!moved) { this.snap(this.index < this.snaps.length - 1 ? this.index + 1 : 0); return; }
      const frac = startFrac - (e.clientY - startY) / this.el.offsetHeight;
      // Geste rapide : on va dans la direction du geste.
      if (v > 0.6) return this.index === 0 ? this.close() : this.snap(this.index - 1);
      if (v < -0.6) return this.snap(this.index + 1);
      if (frac < this.snaps[0] * 0.6) return this.close();
      let best = 0;
      this.snaps.forEach((s, i) => { if (Math.abs(s - frac) < Math.abs(this.snaps[best] - frac)) best = i; });
      this.snap(best);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  _dragContent() {
    if (!this.body) return;
    let y0 = null;
    this.body.addEventListener('touchstart', (e) => { y0 = this.body.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
    this.body.addEventListener('touchmove', (e) => {
      if (y0 == null || !mobile()) return;
      const dy = e.touches[0].clientY - y0;
      // Feuille pas encore en plein écran : glisser vers le haut l'agrandit.
      if (dy < -30 && this.index < this.snaps.length - 1) { this.snap(this.index + 1); y0 = null; }
      else if (dy > 60 && this.body.scrollTop <= 0) { this.index > 0 ? this.snap(this.index - 1) : this.close(); y0 = null; }
    }, { passive: true });
  }
}

export const isMobile = mobile;
