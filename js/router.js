// Routeur par fragment d'URL (#/chemin?param=valeur) : compatible avec un hébergement statique.
const routes = [];
let container, cleanup = null, lastPath = null, token = 0;
const listeners = new Set();

export const onRoute = (fn) => listeners.add(fn);

export function route(pattern, handler) { routes.push({ pattern, handler }); }

export function parse(hash = location.hash) {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  return { path: path.startsWith('/') ? path : '/' + path, query: new URLSearchParams(qs) };
}

/** Met à jour les paramètres de l'URL sans relancer le rendu de la page. */
export function setQuery(params) {
  const { path } = parse();
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) q.set(k, Array.isArray(v) ? v.join(',') : v);
  const s = q.toString();
  history.replaceState(null, '', `#${path}${s ? '?' + s : ''}`);
}

export function navigate(hash) { location.hash = hash.replace(/^#/, ''); }

async function render() {
  const { path, query } = parse();
  // Anciennes adresses (#f=…) : redirection vers la page de l'objet.
  if (/^\/?f=/.test(location.hash.slice(1))) {
    const p = new URLSearchParams(location.hash.slice(1));
    const id = p.get('f'), ll = p.get('ll');
    location.replace(`#/${/^[r]/.test(id) ? 'itineraire' : 'lieu'}/${id}${ll ? '?ll=' + ll : ''}`);
    return;
  }
  for (const { pattern, handler } of routes) {
    const m = path.match(pattern);
    if (!m) continue;
    if (typeof cleanup === 'function') { try { cleanup(); } catch { /* */ } }
    cleanup = null;
    container.innerHTML = '';
    if (path !== lastPath) window.scrollTo(0, 0);
    lastPath = path;
    listeners.forEach((fn) => fn({ path, query }));
    const mine = ++token;
    // Les pages font des chargements asynchrones : `alive()` dit si elles sont encore affichées.
    const alive = () => mine === token;
    try {
      const c = await handler(container, { params: m.slice(1).map(decodeURIComponent), query, path, alive });
      if (alive()) cleanup = c; else if (typeof c === 'function') c();
    } catch (e) {
      if (!alive()) return;
      console.error(e);
      container.innerHTML = `<div class="wrap"><h1 class="page-title">Oups</h1><p class="page-intro">Cette page n’a pas pu s’afficher (${String(e.message || e).replace(/</g, '&lt;')}).</p><p><a class="btn" href="#/">Retour à l’accueil</a></p></div>`;
    }
    return;
  }
  container.innerHTML = '<div class="wrap"><h1 class="page-title">Page introuvable</h1><p><a class="btn primary" href="#/">Retour à l’accueil</a></p></div>';
}

export function start(el) {
  container = el;
  window.addEventListener('hashchange', render);
  render();
}
