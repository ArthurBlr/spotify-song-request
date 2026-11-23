// Exercises the API handlers against a fake Spotify (global fetch is replaced),
// so the tests need no account and no network: `npm test`.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { GET as callback } from '../api/callback.js';
import { GET as login } from '../api/login.js';
import { GET as queue } from '../api/queue.js';
import { POST as request } from '../api/request.js';
import { GET as search } from '../api/search.js';
import { rateLimit } from '../lib/guard.js';

const ORIGIN = 'https://songs.example';
const CODE = 'sésame 42';

function track(n, name) {
  return {
    type: 'track',
    uri: `spotify:track:${String(n).padStart(22, '0')}`,
    name,
    artists: [{ name: 'Alpha' }, { name: 'Beta' }],
    album: {
      images: [
        { url: 'https://img.example/640', width: 640 },
        { url: 'https://img.example/300', width: 300 },
        { url: 'https://img.example/64', width: 64 },
      ],
    },
    duration_ms: 201_000,
    explicit: n % 2 === 0,
  };
}

function reply(status, body) {
  const text = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(status === 204 ? null : text, { status });
}

let spotify;
let run = 0;

/** Replaces fetch with a scriptable Spotify and records every call made to it. */
function fakeSpotify() {
  const state = {
    calls: [],
    token: () => reply(200, { access_token: 'access-1', token_type: 'Bearer', expires_in: 3600 }),
    queue: () => reply(200, { currently_playing: track(1, 'En cours'), queue: [track(2, 'Suivant')] }),
    search: () => reply(200, { tracks: { items: [track(3, 'Trouvé'), track(4, 'Autre')] } }),
    track: () => reply(200, track(5, 'Par lien')),
    add: () => reply(204),
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const call = { method, url, headers: init.headers ?? {}, body: init.body };
    state.calls.push(call);
    const route = `${method} ${url.host}${url.pathname}`;
    if (route === 'POST accounts.spotify.com/api/token') return state.token(call);
    if (route === 'GET api.spotify.com/v1/me/player/queue') return state.queue(call);
    if (route === 'POST api.spotify.com/v1/me/player/queue') return state.add(call);
    if (route === 'GET api.spotify.com/v1/search') return state.search(call);
    if (route.startsWith('GET api.spotify.com/v1/tracks/')) return state.track(call);
    throw new Error(`Unexpected call to Spotify: ${route}`);
  };
  state.count = (method, path) =>
    state.calls.filter((c) => c.method === method && c.url.pathname === path).length;
  return state;
}

function call(path, { method = 'GET', code = CODE, headers = {}, body } = {}) {
  return new Request(ORIGIN + path, {
    method,
    headers: {
      host: 'songs.example',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'songs.example',
      'x-forwarded-for': `10.0.0.${run}`,
      ...(code === null ? {} : { 'x-access-code': encodeURIComponent(code) }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  run += 1;
  process.env.SPOTIFY_CLIENT_ID = 'client-id';
  process.env.SPOTIFY_CLIENT_SECRET = 'client-secret';
  // A new token per test starts each one with empty token and queue caches.
  process.env.SPOTIFY_REFRESH_TOKEN = `refresh-${run}`;
  process.env.ACCESS_CODE = CODE;
  process.env.COOLDOWN_SECONDS = '30';
  spotify = fakeSpotify();
});

test('reports an unfinished installation with the redirect URI to declare', async () => {
  delete process.env.SPOTIFY_REFRESH_TOKEN;
  const res = await queue(call('/api/queue'));
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), {
    error: 'not_configured',
    message: "L'installation n'est pas terminée.",
    missing: ['SPOTIFY_REFRESH_TOKEN'],
    redirectUri: `${ORIGIN}/api/callback`,
  });
  assert.equal(spotify.calls.length, 0);
});

test('refuses a missing or wrong access code on every endpoint', async () => {
  for (const code of [null, 'nope']) {
    assert.equal((await queue(call('/api/queue', { code }))).status, 401);
    assert.equal((await search(call('/api/search?q=abc', { code }))).status, 401);
    const post = await request(call('/api/request', { method: 'POST', code, body: { uri: track(9).uri } }));
    assert.equal(post.status, 401);
    assert.equal((await post.json()).error, 'bad_code');
  }
  assert.equal(spotify.calls.length, 0);
});

test('is open to everyone when no access code is set', async () => {
  delete process.env.ACCESS_CODE;
  assert.equal((await queue(call('/api/queue', { code: null }))).status, 200);
});

test('search returns trimmed tracks and asks Spotify for 10 results', async () => {
  const res = await search(call('/api/search?q=daft%20punk'));
  assert.equal(res.status, 200);
  const { tracks } = await res.json();
  assert.deepEqual(tracks[0], {
    uri: 'spotify:track:0000000000000000000003',
    name: 'Trouvé',
    artists: 'Alpha, Beta',
    image: 'https://img.example/300',
    durationMs: 201_000,
    explicit: false,
  });
  assert.equal(tracks.length, 2);

  const sent = spotify.calls.find((c) => c.url.pathname === '/v1/search');
  assert.equal(sent.url.searchParams.get('q'), 'daft punk');
  assert.equal(sent.url.searchParams.get('type'), 'track');
  assert.equal(sent.url.searchParams.get('limit'), '10');
  assert.equal(sent.headers.authorization, 'Bearer access-1');
});

test('search skips Spotify for queries under two characters', async () => {
  const res = await search(call('/api/search?q=%20a%20'));
  assert.deepEqual(await res.json(), { tracks: [] });
  assert.equal(spotify.calls.length, 0);
});

test('a pasted Spotify link is looked up directly', async () => {
  const id = 'A'.repeat(22);
  const link = `https://open.spotify.com/intl-fr/track/${id}?si=abc`;
  const res = await search(call(`/api/search?q=${encodeURIComponent(link)}`));
  assert.equal((await res.json()).tracks[0].name, 'Par lien');
  assert.equal(spotify.count('GET', `/v1/tracks/${id}`), 1);
  assert.equal(spotify.count('GET', '/v1/search'), 0);

  spotify.track = () => reply(404, { error: { status: 404, message: 'Not found' } });
  const missing = await search(call(`/api/search?q=${encodeURIComponent(link)}`));
  assert.deepEqual(await missing.json(), { tracks: [] });
});

test('queue shows what is playing and what comes next, with one token for all calls', async () => {
  const res = await queue(call('/api/queue'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.playing.name, 'En cours');
  assert.deepEqual(body.next.map((t) => t.name), ['Suivant']);
  assert.equal(body.cooldown, 0);

  await queue(call('/api/queue'));
  await search(call('/api/search?q=abc'));
  assert.equal(spotify.count('POST', '/api/token'), 1);
  // The second /api/queue was served from the short cache.
  assert.equal(spotify.count('GET', '/v1/me/player/queue'), 1);

  const token = spotify.calls.find((c) => c.url.pathname === '/api/token');
  assert.equal(token.headers.authorization, `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`);
  assert.equal(token.body, `grant_type=refresh_token&refresh_token=refresh-${run}`);
});

test('queue copes with nothing playing', async () => {
  spotify.queue = () => reply(200, { currently_playing: null, queue: [] });
  const body = await (await queue(call('/api/queue'))).json();
  assert.deepEqual(body, { playing: null, next: [], cooldown: 0 });
});

test('a request adds the track, then the same browser has to wait', async () => {
  const uri = track(7).uri;
  const res = await request(call('/api/request', { method: 'POST', body: { uri } }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, cooldown: 30 });

  const added = spotify.calls.find((c) => c.method === 'POST' && c.url.pathname === '/v1/me/player/queue');
  assert.equal(added.url.searchParams.get('uri'), uri);

  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /^sr_last=\d+\.[\w-]+; Path=\/; Max-Age=30; HttpOnly; SameSite=Lax; Secure$/);
  const pair = cookie.split(';')[0];

  const again = await request(
    call('/api/request', { method: 'POST', body: { uri: track(8).uri }, headers: { cookie: pair } }),
  );
  assert.equal(again.status, 429);
  const refused = await again.json();
  assert.equal(refused.error, 'cooldown');
  assert.ok(refused.retryAfter > 0 && refused.retryAfter <= 30);
  assert.equal(spotify.count('POST', '/v1/me/player/queue'), 1);

  // The page restores the countdown after a reload.
  const state = await (await queue(call('/api/queue', { headers: { cookie: pair } }))).json();
  assert.ok(state.cooldown > 0);

  // A cookie that was not signed by this server is ignored.
  const forged = await request(
    call('/api/request', {
      method: 'POST',
      body: { uri: track(8).uri },
      headers: { cookie: `sr_last=${Date.now()}.forged` },
    }),
  );
  assert.equal(forged.status, 200);
});

test('COOLDOWN_SECONDS=0 removes the wait', async () => {
  process.env.COOLDOWN_SECONDS = '0';
  const res = await request(call('/api/request', { method: 'POST', body: { uri: track(7).uri } }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('set-cookie'), null);
});

test('a track already playing or queued is not added twice', async () => {
  for (const n of [1, 2]) {
    const res = await request(call('/api/request', { method: 'POST', body: { uri: track(n).uri } }));
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, 'already_queued');
  }
  assert.equal(spotify.count('POST', '/v1/me/player/queue'), 0);
});

test('nothing playing: clear message and no cooldown consumed', async () => {
  spotify.queue = () => reply(200, { currently_playing: null, queue: [] });
  spotify.add = () =>
    reply(404, { error: { status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE' } });
  const res = await request(call('/api/request', { method: 'POST', body: { uri: track(7).uri } }));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'no_active_device');
  assert.equal(res.headers.get('set-cookie'), null);
});

test('a non-Premium account is reported as such', async () => {
  spotify.add = () =>
    reply(403, { error: { status: 403, message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' } });
  const res = await request(call('/api/request', { method: 'POST', body: { uri: track(7).uri } }));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'premium_required');
});

test('rejects anything that is not a JSON body with a track URI', async () => {
  const bad = ['spotify:album:0000000000000000000001', 'spotify:track:short', '', 42, undefined];
  for (const uri of bad) {
    const res = await request(call('/api/request', { method: 'POST', body: { uri } }));
    assert.equal(res.status, 400, `uri ${uri}`);
  }
  const form = await request(
    call('/api/request', {
      method: 'POST',
      body: { uri: track(7).uri },
      headers: { 'content-type': 'text/plain' },
    }),
  );
  assert.equal(form.status, 415);
  assert.equal(spotify.calls.length, 0);
});

test('an expired refresh token asks the owner to log in again', async () => {
  spotify.token = () => reply(400, { error: 'invalid_grant', error_description: 'Refresh token revoked' });
  const res = await queue(call('/api/queue'));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'reauth_required');
  assert.match(body.message, /\/api\/login/);
});

test('an access token rejected by Spotify is renewed once and the call retried', async () => {
  let tokens = 0;
  spotify.token = () => reply(200, { access_token: `access-${(tokens += 1)}`, expires_in: 3600 });
  spotify.search = ({ headers }) =>
    headers.authorization === 'Bearer access-1'
      ? reply(401, { error: { status: 401, message: 'The access token expired' } })
      : reply(200, { tracks: { items: [track(3, 'Trouvé')] } });
  const res = await search(call('/api/search?q=abc'));
  assert.equal(res.status, 200);
  assert.equal(tokens, 2);
  assert.equal(spotify.count('GET', '/v1/search'), 2);
});

test('Spotify rate limiting is passed on with its delay', async () => {
  spotify.search = () =>
    new Response(JSON.stringify({ error: { status: 429, message: 'API rate limit exceeded' } }), {
      status: 429,
      headers: { 'retry-after': '7' },
    });
  const res = await search(call('/api/search?q=abc'));
  assert.equal(res.status, 503);
  assert.deepEqual(
    { error: 'spotify_busy', retryAfter: 7 },
    (({ error, retryAfter }) => ({ error, retryAfter }))(await res.json()),
  );
});

test('login redirects to Spotify, and the callback shows the refresh token', async () => {
  const redirect = login(call('/api/login', { code: null }));
  assert.equal(redirect.status, 302);
  const target = new URL(redirect.headers.get('location'));
  assert.equal(target.origin + target.pathname, 'https://accounts.spotify.com/authorize');
  assert.equal(target.searchParams.get('client_id'), 'client-id');
  assert.equal(target.searchParams.get('response_type'), 'code');
  assert.equal(target.searchParams.get('redirect_uri'), `${ORIGIN}/api/callback`);
  assert.equal(
    target.searchParams.get('scope'),
    'user-modify-playback-state user-read-playback-state user-read-currently-playing',
  );
  const state = target.searchParams.get('state');
  const cookie = redirect.headers.get('set-cookie').split(';')[0];
  assert.equal(cookie, `sr_state=${state}`);

  spotify.token = () =>
    reply(200, { access_token: 'access-1', expires_in: 3600, refresh_token: 'AQD<fresh&token>' });
  const done = await callback(
    call(`/api/callback?code=auth-code&state=${state}`, { code: null, headers: { cookie } }),
  );
  assert.equal(done.status, 200);
  const html = await done.text();
  assert.ok(html.includes('AQD&lt;fresh&amp;token&gt;'), 'token is shown, HTML-escaped');
  assert.equal(
    spotify.calls[0].body,
    `grant_type=authorization_code&code=auth-code&redirect_uri=${encodeURIComponent(`${ORIGIN}/api/callback`)}`,
  );
});

test('the callback refuses a state it did not issue', async () => {
  const res = await callback(
    call('/api/callback?code=auth-code&state=abc', { code: null, headers: { cookie: 'sr_state=other' } }),
  );
  assert.equal(res.status, 400);
  assert.equal(spotify.calls.length, 0);

  const denied = await callback(call('/api/callback?error=access_denied&state=abc', { code: null }));
  assert.equal(denied.status, 400);
  assert.match(await denied.text(), /access_denied/);
});

test('login explains what is missing before the Spotify keys are set', async () => {
  delete process.env.SPOTIFY_CLIENT_SECRET;
  const res = login(call('/api/login', { code: null }));
  assert.equal(res.status, 503);
  assert.match(await res.text(), /SPOTIFY_CLIENT_SECRET/);
});

test('rateLimit allows a burst, then blocks until the window slides', () => {
  const key = `unit-${run}`;
  const start = 1_000_000;
  for (let i = 0; i < 3; i += 1) assert.equal(rateLimit(key, 3, 10_000, start + i), 0);
  assert.equal(rateLimit(key, 3, 10_000, start + 5_000), 5);
  assert.equal(rateLimit(key, 3, 10_000, start + 10_001), 0);
});

test('requests from one address are capped', async () => {
  process.env.COOLDOWN_SECONDS = '0';
  let last;
  for (let i = 0; i < 31; i += 1) {
    last = await request(call('/api/request', { method: 'POST', body: { uri: track(100 + i).uri } }));
  }
  assert.equal(last.status, 429);
  assert.equal((await last.json()).error, 'rate_limited');
  assert.equal(spotify.count('POST', '/v1/me/player/queue'), 30);
});
