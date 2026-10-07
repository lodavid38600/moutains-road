#!/usr/bin/env node
// Petit serveur statique local (sans dépendance) : node scripts/serve.mjs [--port=8080]
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createGzip } from 'node:zlib';
import { ROOT, args } from './lib/util.mjs';

const port = Number(args().port || process.env.PORT || 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT) || /[\\/]\.(git|cache)/.test(file.slice(ROOT.length))) { res.writeHead(403).end(); return; }
    const s = await stat(file);
    if (!s.isFile()) throw new Error();
    const type = TYPES[extname(file)] || 'application/octet-stream';
    const gzip = /json|javascript|css|html|svg/.test(type) && /gzip/.test(req.headers['accept-encoding'] || '');
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', ...(gzip ? { 'Content-Encoding': 'gzip' } : {}) });
    const stream = createReadStream(file);
    (gzip ? stream.pipe(createGzip()) : stream).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 – introuvable');
  }
}).listen(port, () => console.log(`Mountains Road → http://localhost:${port}`));
