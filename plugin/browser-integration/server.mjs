// Static file server for the browser-integration fixtures.
//
// Routes:
//   /                -> browser-integration/fixtures/  (HTML pages)
//   /lib/fixture.js  -> lib/fixture.js                 (projector IIFE bundle)
//
// Path-traversal guard: every resolved file must live under one of the
// declared ROOTS. Anything else returns 403. The server only ever reads
// files inside the plugin working tree.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const PLUGIN_ROOT = resolve(HERE, '..');
const PORT = 3100;

const ROOTS = [
  { prefix: '/lib', dir: join(PLUGIN_ROOT, 'lib') },
  { prefix: '/', dir: join(PLUGIN_ROOT, 'browser-integration', 'fixtures') },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveFile(pathname) {
  for (const { prefix, dir } of ROOTS) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) {
      const rel = pathname.slice(prefix.length) || '/';
      const candidate = normalize(join(dir, rel));
      const baseNorm = normalize(dir);
      // path-traversal guard: ensure resolved file is inside the root
      if (candidate !== baseNorm && !candidate.startsWith(baseNorm + sep)) {
        return { status: 403, body: 'Forbidden' };
      }
      return { status: 200, filePath: candidate };
    }
  }
  return { status: 404, body: 'Not found' };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    const resolved = resolveFile(pathname);
    if (resolved.status !== 200) {
      res.writeHead(resolved.status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(resolved.body);
      return;
    }
    let filePath = resolved.filePath;
    try {
      const s = await stat(filePath);
      if (s.isDirectory()) {
        filePath = join(filePath, 'index.html');
      }
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found: ' + pathname);
      return;
    }
    const data = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Server error: ' + (err instanceof Error ? err.message : String(err)));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[browser-integration] static server listening on http://127.0.0.1:${PORT}`);
  for (const { prefix, dir } of ROOTS) {
    console.log(`  ${prefix.padEnd(6)} -> ${dir}`);
  }
});
