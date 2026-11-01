#!/usr/bin/env node
/**
 * Build (and optionally serve) the static playground.
 *
 * The page imports the compiled `dist/` modules directly — they have no `node:`
 * imports, so no bundler is involved. That keeps the zero-dependency promise and
 * means the playground runs the same code as the CLI, not a copy of it.
 *
 *   node scripts/playground.mjs                # build site/ and serve it
 *   node scripts/playground.mjs --build-only   # build site/ only (used by Pages)
 *   node scripts/playground.mjs --port 8080
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const site = join(root, 'site');
const buildOnly = process.argv.includes('--build-only');
const portFlag = process.argv.indexOf('--port');
const port = portFlag === -1 ? 8080 : Number(process.argv[portFlag + 1]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function build() {
  if (!existsSync(join(root, 'dist', 'analyze.js'))) {
    console.error('dist/ 不存在或不完整，先运行 npm run build');
    process.exit(2);
  }
  rmSync(site, { recursive: true, force: true });
  mkdirSync(site, { recursive: true });
  cpSync(join(root, 'dist'), join(site, 'dist'), { recursive: true });
  cpSync(join(root, 'playground', 'index.html'), join(site, 'index.html'));
  console.log(`已生成 ${site}`);
}

function serve() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = join(site, decodeURIComponent(requested));

    // Refuse anything that escapes site/.
    if (!resolve(file).startsWith(resolve(site) + sep)) {
      response.writeHead(403).end('forbidden');
      return;
    }
    if (!existsSync(file)) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    response.end(readFileSync(file));
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`playground: http://127.0.0.1:${port}`);
  });
}

build();
if (!buildOnly) serve();
