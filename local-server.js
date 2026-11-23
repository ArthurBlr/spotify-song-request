// Runs the project without Vercel: `npm start`.
// Serves public/ and maps /api/<name> to the handlers in api/, which use the
// same Web-standard Request/Response signature as on Vercel.

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as callback from './api/callback.js';
import * as login from './api/login.js';
import * as queue from './api/queue.js';
import * as request from './api/request.js';
import * as search from './api/search.js';

try {
  process.loadEnvFile(fileURLToPath(new URL('.env', import.meta.url)));
} catch {
  // No .env file: settings come from the real environment.
}

const PORT = Number(process.env.PORT) || 3000;
// 127.0.0.1 keeps the page private to this machine; set HOST=0.0.0.0 to share it on the local network.
const HOST = process.env.HOST || '127.0.0.1';

const routes = new Map(Object.entries({ callback, login, queue, request, search }));
const publicDir = fileURLToPath(new URL('public', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function readBody(req, limit = 10_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function handleApi(req, res, url, route) {
  const handler = route[req.method];
  if (typeof handler !== 'function') {
    res.writeHead(405).end();
    return;
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const response = await handler(
    new Request(url, { method: req.method, headers, body: hasBody ? await readBody(req) : undefined }),
  );

  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') res.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader('set-cookie', cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function handleStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  const pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = resolve(publicDir, `.${pathname}`);
  if (!file.startsWith(publicDir + sep)) {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    const content = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? `${HOST}:${PORT}`}`);
    const route = routes.get(url.pathname.match(/^\/api\/([a-z]+)$/)?.[1]);
    if (route) await handleApi(req, res, url, route);
    else if (url.pathname.startsWith('/api/')) res.writeHead(404).end('Not found');
    else await handleStatic(req, res, url);
  } catch (err) {
    if (!err.status) console.error(err);
    if (!res.headersSent) res.statusCode = err.status ?? 500;
    res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Song request : http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`);
});
