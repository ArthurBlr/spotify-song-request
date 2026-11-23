// Runs the project on your own computer: `npm start`.
//
// The first run asks for the Spotify keys, opens the Spotify consent screen
// and stores everything in .env. Later runs start straight away.
// It serves public/ and maps /api/<name> to the handlers in api/, which use
// the same Web-standard Request/Response signature as on Vercel.

import { spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import * as login from './api/login.js';
import * as queue from './api/queue.js';
import * as request from './api/request.js';
import * as search from './api/search.js';
import { getConfig } from './lib/config.js';
import { saveEnv, UNSAFE_VALUE } from './lib/envfile.js';
import { page } from './lib/http.js';
import { completeLogin, TOKEN_LIFETIME_MONTHS, tokenExpiryText } from './lib/login.js';

const envFile = process.env.ENV_FILE || fileURLToPath(new URL('.env', import.meta.url));
try {
  process.loadEnvFile(envFile);
} catch {
  // No .env yet: the first-run questions below create it.
}

const PORT = Number(process.env.PORT) || 3000;
// All network interfaces, so colleagues on the same network can open the page.
// HOST=127.0.0.1 keeps it private to this computer.
const HOST = process.env.HOST || '0.0.0.0';
// Spotify only accepts a plain-http Redirect URI on this exact loopback address.
const LOCAL_HOST = `127.0.0.1:${PORT}`;
const LOCAL_ORIGIN = `http://${LOCAL_HOST}`;

const publicDir = fileURLToPath(new URL('public', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function saveSettings(values) {
  await saveEnv(envFile, values);
  Object.assign(process.env, values);
}

// --- First run ---------------------------------------------------------------

async function askForSpotifyKeys() {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (label, { fallback = '' } = {}) => {
    for (;;) {
      const answer = (await terminal.question(fallback ? `${label} [${fallback}] : ` : `${label} : `)).trim() || fallback;
      if (answer && !UNSAFE_VALUE.test(answer)) return answer;
      console.log('  Valeur vide ou contenant " ou \\ : recommence.');
    }
  };

  console.log(`
Première utilisation : il me faut les identifiants de ton app Spotify.
Tu les trouves sur developer.spotify.com/dashboard, dans ton app, onglet Settings.
La Redirect URI de l'app doit être : ${LOCAL_ORIGIN}/api/callback
`);
  try {
    const cfg = getConfig();
    await saveSettings({
      SPOTIFY_CLIENT_ID: await ask('Client ID', { fallback: cfg.clientId }),
      SPOTIFY_CLIENT_SECRET: await ask('Client secret', { fallback: cfg.clientSecret }),
      ACCESS_CODE: await ask("Code d'accès à donner à tes collègues", {
        fallback: cfg.accessCode || String(randomInt(1000, 10_000)),
      }),
    });
  } finally {
    terminal.close();
  }
  console.log('\nEnregistré dans .env.');
}

function openBrowser(url) {
  // BROWSER=none: same opt-out as most dev tools.
  if (!process.stdout.isTTY || process.env.BROWSER === 'none') return;
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    spawn(command, args, { stdio: 'ignore', detached: true })
      .on('error', () => {})
      .unref();
  } catch {
    // The address is printed as well.
  }
}

function lanAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return null;
}

function printStatus() {
  const cfg = getConfig();
  if (!cfg.clientId || !cfg.clientSecret) {
    console.log(`\nIl manque SPOTIFY_CLIENT_ID et SPOTIFY_CLIENT_SECRET dans ${envFile}.`);
    return;
  }
  if (!cfg.refreshToken) {
    console.log(
      `\nIl reste à relier ton compte Spotify. Si ton navigateur ne s'ouvre pas tout seul, va sur ${LOCAL_ORIGIN}/api/login`,
    );
    openBrowser(`${LOCAL_ORIGIN}/api/login`);
    return;
  }
  const code = cfg.accessCode ? `/?code=${encodeURIComponent(cfg.accessCode)}` : '/';
  const lan = HOST === '0.0.0.0' ? lanAddress() : null;
  console.log(`\nSong request est prêt.`);
  console.log(`  Sur cet ordinateur : ${LOCAL_ORIGIN}${code}`);
  if (lan) console.log(`  Pour tes collègues : http://${lan}:${PORT}${code}   (même réseau que toi)`);
  console.log('Laisse cette fenêtre ouverte. Ctrl+C pour arrêter.');
}

// --- Routes ------------------------------------------------------------------

// Here the refresh token goes straight into .env, instead of being displayed
// for a copy-paste as on a hosted deployment.
const callback = {
  async GET(req) {
    const result = await completeLogin(req);
    if (result.failure) return result.failure;
    await saveSettings({ SPOTIFY_REFRESH_TOKEN: result.refreshToken });
    printStatus();

    const { accessCode } = getConfig();
    const home = accessCode ? `/?code=${encodeURIComponent(accessCode)}` : '/';
    const response = page(
      'Compte Spotify relié',
      `<p>C’est prêt. Le lien à partager est affiché dans ton terminal.</p>
<p>Spotify désactive cette autorisation au bout de ${TOKEN_LIFETIME_MONTHS} mois, soit vers le <strong>${tokenExpiryText()}</strong>. Il suffira alors de rouvrir <code>/api/login</code> sur cet ordinateur.</p>
<p><a class="button" href="${home}">Ouvrir la page</a></p>`,
    );
    response.headers.append('set-cookie', result.clearState);
    return response;
  },
};

const routes = new Map(Object.entries({ callback, login, queue, request, search }));
// Linking the Spotify account replaces the stored token: owner's computer only.
const OWNER_ONLY = new Set(['login', 'callback']);

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

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

async function send(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') res.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader('set-cookie', cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function handleApi(req, res, url, name) {
  const handler = routes.get(name)[req.method];
  if (typeof handler !== 'function') {
    res.writeHead(405).end();
    return;
  }

  if (OWNER_ONLY.has(name)) {
    if (!isLoopback(req.socket.remoteAddress)) {
      await send(
        res,
        page(
          'Réservé à l’ordinateur hôte',
          '<p>La connexion à Spotify se fait depuis l’ordinateur qui fait tourner cette page.</p>',
          403,
        ),
      );
      return;
    }
    if (req.headers.host !== LOCAL_HOST) {
      // e.g. opened through "localhost": Spotify would refuse that Redirect URI.
      res.writeHead(302, { location: `${LOCAL_ORIGIN}${url.pathname}${url.search}` }).end();
      return;
    }
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    // No proxy sits in front of this server, so forwarded headers can only be forged.
    if (value === undefined || key.startsWith('x-forwarded-') || key === 'x-real-ip') continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  headers.set('x-forwarded-for', req.socket.remoteAddress ?? 'unknown');

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  await send(
    res,
    await handler(new Request(url, { method: req.method, headers, body: hasBody ? await readBody(req) : undefined })),
  );
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
    const url = new URL(req.url, `http://${req.headers.host ?? LOCAL_HOST}`);
    const name = url.pathname.match(/^\/api\/([a-z]+)$/)?.[1];
    if (routes.has(name)) await handleApi(req, res, url, name);
    else if (url.pathname.startsWith('/api/')) res.writeHead(404).end('Not found');
    else await handleStatic(req, res, url);
  } catch (err) {
    if (!err.status) console.error(err);
    if (!res.headersSent) res.statusCode = err.status ?? 500;
    res.end();
  }
});

// --- Start -------------------------------------------------------------------

const { clientId, clientSecret } = getConfig();
if ((!clientId || !clientSecret) && process.stdin.isTTY) await askForSpotifyKeys();

server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(
    `Le port ${PORT} est déjà pris. Ferme l'autre programme, ou lance « PORT=3001 npm start » ` +
      `après avoir déclaré http://127.0.0.1:3001/api/callback dans ton app Spotify.`,
  );
  process.exit(1);
});
server.listen(PORT, HOST, printStatus);
