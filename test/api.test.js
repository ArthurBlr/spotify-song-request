// Exercises the API handlers against a fake Spotify (global fetch is replaced),
// so the tests need no account and no network: `npm test`.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { GET as callback } from '../api/callback.js';
import { GET as login } from '../api/login.js';
import { GET as queue, POST as vote } from '../api/queue.js';
import { POST as request } from '../api/request.js';
import { GET as search } from '../api/search.js';
import { rateLimit } from '../lib/guard.js';
import { resetRoom } from '../lib/room.js';

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

function device(fields) {
  return { id: 'device-1', is_active: true, is_restricted: false, supports_volume: true, ...fields };
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
    next: () => reply(204),
    player: () =>
      reply(200, { is_playing: true, progress_ms: 60_000, item: track(1, 'En cours'), device: device({ volume_percent: 40 }) }),
    volume: () => reply(204),
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
    if (route === 'POST api.spotify.com/v1/me/player/next') return state.next(call);
    if (route === 'GET api.spotify.com/v1/me/player') return state.player(call);
    if (route === 'PUT api.spotify.com/v1/me/player/volume') return state.volume(call);
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

/** One visitor's browser: it keeps the cookies the server hands out and sends them back. */
function browser() {
  const jar = new Map();
  return async (handler, path, options = {}) => {
    const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    const res = await handler(call(path, { ...options, headers: { ...options.headers, ...(cookie && { cookie }) } }));
    for (const line of res.headers.getSetCookie()) {
      const pair = line.split(';')[0];
      jar.set(pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1));
    }
    return res;
  };
}

const skip = (uri) => ({ method: 'POST', body: { skip: uri } });
const turn = (direction) => ({ method: 'POST', body: { volume: direction } });

/** Gives the fake Spotify a device whose volume can be read and set. */
function speaker(percent, fields = {}) {
  const box = { percent };
  spotify.player = () => reply(200, { is_playing: true, device: device({ volume_percent: box.percent, ...fields }) });
  spotify.volume = ({ url }) => {
    box.percent = Number(url.searchParams.get('volume_percent'));
    return reply(204);
  };
  return box;
}

beforeEach(() => {
  run += 1;
  process.env.SPOTIFY_CLIENT_ID = 'client-id';
  process.env.SPOTIFY_CLIENT_SECRET = 'client-secret';
  // A new token per test starts each one with empty token and queue caches.
  process.env.SPOTIFY_REFRESH_TOKEN = `refresh-${run}`;
  process.env.ACCESS_CODE = CODE;
  delete process.env.COOLDOWN_SECONDS;
  delete process.env.VOLUME_MAX;
  delete process.env.VOLUME_MIN;
  resetRoom();
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
  assert.deepEqual(body.volume, { percent: 40, min: 10, max: 50, wait: 0 });

  await queue(call('/api/queue'));
  await search(call('/api/search?q=abc'));
  assert.equal(spotify.count('POST', '/api/token'), 1);
  // The second /api/queue was served from the short cache.
  assert.equal(spotify.count('GET', '/v1/me/player/queue'), 1);
  assert.equal(spotify.count('GET', '/v1/me/player'), 1);

  const token = spotify.calls.find((c) => c.url.pathname === '/api/token');
  assert.equal(token.headers.authorization, `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`);
  assert.equal(token.body, `grant_type=refresh_token&refresh_token=refresh-${run}`);
});

test('queue copes with nothing playing', async () => {
  spotify.queue = () => reply(200, { currently_playing: null, queue: [] });
  spotify.player = () => reply(204);
  const { people, reactions, ...body } = await (await queue(call('/api/queue'))).json();
  assert.deepEqual(body, {
    playing: null,
    progress: null,
    next: [],
    cooldown: 0,
    present: 1,
    skip: null,
    volume: null,
  });
  assert.equal(people.length, 1);
  assert.ok(reactions.length > 0);
});

test('a request adds the track, then the same browser has to wait', async () => {
  const uri = track(7).uri;
  const res = await request(call('/api/request', { method: 'POST', body: { uri } }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, cooldown: 3 });

  const added = spotify.calls.find((c) => c.method === 'POST' && c.url.pathname === '/v1/me/player/queue');
  assert.equal(added.url.searchParams.get('uri'), uri);

  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /^sr_last=\d+\.[\w-]+; Path=\/; Max-Age=3; HttpOnly; SameSite=Lax; Secure$/);
  const pair = cookie.split(';')[0];

  const again = await request(
    call('/api/request', { method: 'POST', body: { uri: track(8).uri }, headers: { cookie: pair } }),
  );
  assert.equal(again.status, 429);
  const refused = await again.json();
  assert.equal(refused.error, 'cooldown');
  assert.ok(refused.retryAfter > 0 && refused.retryAfter <= 3);
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

test('queue counts the browsers that have the page open', async () => {
  const alice = browser();
  const bob = browser();

  const first = await alice(queue, '/api/queue');
  assert.match(
    first.headers.get('set-cookie'),
    /^sr_id=[\w-]+\.[\w-]+; Path=\/; Max-Age=15552000; HttpOnly; SameSite=Lax; Secure$/,
  );
  assert.equal((await first.json()).present, 1);

  // The same browser again is still one person, and keeps its id.
  const again = await alice(queue, '/api/queue');
  assert.equal(again.headers.get('set-cookie'), null);
  assert.equal((await again.json()).present, 1);

  assert.equal((await (await bob(queue, '/api/queue')).json()).present, 2);

  // An id this server did not sign is replaced by a real one.
  const forged = await queue(call('/api/queue', { headers: { cookie: 'sr_id=alice.forged' } }));
  assert.match(forged.headers.get('set-cookie'), /^sr_id=/);
  assert.equal((await forged.json()).present, 3);
});

test('everyone present is listed with the avatar their browser sent', async () => {
  const wearing = (value) => ({
    headers: { 'x-avatar': typeof value === 'string' ? value : encodeURIComponent(JSON.stringify(value)) },
  });
  const alice = browser();
  const bob = browser();
  const look = { name: 'Alice', style: 1, color: 2, body: 3, extra: 1 };

  const first = await alice(queue, '/api/queue', wearing(look));
  const id = first.headers.get('set-cookie').match(/^sr_id=([\w-]+)\./)[1];
  const [me] = (await first.json()).people;
  assert.deepEqual(me, { key: me.key, you: true, avatar: look, reaction: null });
  // The key tells people apart without giving away the id their cookie holds.
  assert.match(me.key, /^[\w-]{10}$/);
  assert.ok(!id.includes(me.key));

  // Someone who has not chosen has no avatar: the page gives them a default one.
  const seen = (await (await bob(queue, '/api/queue')).json()).people;
  assert.deepEqual(seen, [
    { key: me.key, you: false, avatar: look, reaction: null },
    { key: seen[1].key, you: true, avatar: null, reaction: null },
  ]);

  // Something that is not an avatar leaves the last one in place.
  for (const junk of ['not json', '%E0%A4%A', encodeURIComponent('"text"'), 'x'.repeat(700)]) {
    const kept = (await (await alice(queue, '/api/queue', wearing(junk))).json()).people;
    assert.deepEqual(kept.find((person) => person.you).avatar, look, junk.slice(0, 20));
  }

  // What was typed comes back as one short line; unknown numbers fall back to the first choice.
  const odd = { name: '  <b>Un pseudo\n bien trop long</b> ', style: 2.5, color: 99, body: -1, extra: 'x', admin: true };
  const cleaned = (await (await alice(queue, '/api/queue', wearing(odd))).json()).people;
  assert.deepEqual(cleaned.find((person) => person.you).avatar, {
    name: '<b>Un pseudo bie',
    style: 0,
    color: 0,
    body: 0,
    extra: 0,
  });
});

test('an avatar says a reaction, for the others to see', async () => {
  const saying = (react) => ({ method: 'POST', body: { react } });
  const alice = browser();
  const bob = browser();

  // No need for Spotify, nor to have polled first.
  const said = await alice(vote, '/api/queue', saying('🔥'));
  assert.equal(said.status, 200);
  assert.match(said.headers.get('set-cookie'), /^sr_id=/);
  assert.equal(spotify.calls.length, 0);

  const state = await (await bob(queue, '/api/queue')).json();
  // The page builds its buttons from this list.
  assert.ok(state.reactions.includes('🔥') && state.reactions.length >= 6);
  const [her, him] = state.people;
  assert.equal(her.reaction.emoji, '🔥');
  assert.ok(Number.isInteger(her.reaction.at));
  assert.equal(him.reaction, null);

  // A later one replaces it, and can be told apart even when it is the same emoji.
  await new Promise((resolve) => setTimeout(resolve, 5));
  await alice(vote, '/api/queue', saying('🔥'));
  const again = (await (await bob(queue, '/api/queue')).json()).people[0].reaction;
  assert.ok(again.at > her.reaction.at);

  // Only the emojis of the list, and only with the access code.
  for (const react of ['💩', '<b>', 7, null]) {
    const refused = await bob(vote, '/api/queue', saying(react));
    assert.equal(refused.status, 400, String(react));
  }
  assert.equal((await vote(call('/api/queue', { ...saying('🔥'), code: null }))).status, 401);

  // Five in ten seconds for one browser, then it has to slow down.
  const carol = browser();
  for (let i = 0; i < 5; i += 1) assert.equal((await carol(vote, '/api/queue', saying('👏'))).status, 200);
  const tooMany = await carol(vote, '/api/queue', saying('👏'));
  assert.equal(tooMany.status, 429);
  assert.equal((await tooMany.json()).error, 'rate_limited');
});

test('a new visitor gets their id even when Spotify fails', async () => {
  spotify.queue = () => reply(500, { error: { status: 500, message: 'Server error' } });
  const res = await queue(call('/api/queue'));
  assert.equal(res.status, 502);
  assert.match(res.headers.get('set-cookie'), /^sr_id=/);
});

test('the track is skipped once more than half of the people present have voted', async () => {
  const [alice, bob, chloe] = [browser(), browser(), browser()];
  for (const open of [alice, bob, chloe]) await open(queue, '/api/queue');
  const uri = track(1).uri;

  const first = await alice(vote, '/api/queue', skip(uri));
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), {
    skipped: false,
    present: 3,
    skip: { votes: 1, needed: 2, voted: true },
  });

  // Voting twice does not count twice.
  const twice = await alice(vote, '/api/queue', skip(uri));
  assert.equal((await twice.json()).skip.votes, 1);
  assert.equal(spotify.count('POST', '/v1/me/player/next'), 0);

  // The others see where the vote stands.
  const seen = await (await bob(queue, '/api/queue')).json();
  assert.deepEqual(seen.skip, { votes: 1, needed: 2, voted: false });

  const second = await bob(vote, '/api/queue', skip(uri));
  assert.deepEqual(await second.json(), { skipped: true, present: 3, skip: null });
  assert.equal(spotify.count('POST', '/v1/me/player/next'), 1);

  // Spotify still reports the old track for a moment: no second skip, no new vote.
  const late = await chloe(vote, '/api/queue', skip(uri));
  assert.equal((await late.json()).skipped, true);
  assert.equal((await (await chloe(queue, '/api/queue')).json()).skip, null);
  assert.equal(spotify.count('POST', '/v1/me/player/next'), 1);
});

test('a vote only counts for the track that is playing', async () => {
  const alice = browser();
  const res = await alice(vote, '/api/queue', skip(track(2).uri));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'track_changed');

  // The page was a few seconds late: the voted track ended in the meantime.
  await alice(queue, '/api/queue');
  spotify.queue = () => reply(200, { currently_playing: track(2, 'Suivant'), queue: [] });
  const ended = await alice(vote, '/api/queue', skip(track(1).uri));
  assert.equal(ended.status, 200);
  assert.equal(spotify.count('POST', '/v1/me/player/next'), 0);
});

test('a skip refused by Spotify can be voted again', async () => {
  const alice = browser();
  spotify.next = () =>
    reply(403, { error: { status: 403, message: 'Player command failed: Restriction violated', reason: 'UNKNOWN' } });
  const refused = await alice(vote, '/api/queue', skip(track(1).uri));
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error, 'forbidden');

  spotify.next = () => reply(204);
  const retried = await alice(vote, '/api/queue', skip(track(1).uri));
  assert.equal((await retried.json()).skipped, true);
  assert.equal(spotify.count('POST', '/v1/me/player/next'), 2);
});

test('one address cannot collect visitor ids, and so votes, without end', async () => {
  for (let i = 0; i < 30; i += 1) await queue(call('/api/queue'));
  const res = await queue(call('/api/queue'));
  assert.equal(res.headers.get('set-cookie'), null);
  assert.equal((await res.json()).present, 30);

  const refused = await vote(call('/api/queue', skip(track(1).uri)));
  assert.equal(refused.status, 429);
  assert.equal(spotify.count('POST', '/v1/me/player/next'), 0);
});

test('a vote needs the access code and a JSON body naming the track', async () => {
  const uri = track(1).uri;
  assert.equal((await vote(call('/api/queue', { ...skip(uri), code: null }))).status, 401);
  assert.equal((await vote(call('/api/queue', { ...skip(uri), headers: { 'content-type': 'text/plain' } }))).status, 415);
  assert.equal((await vote(call('/api/queue', { method: 'POST', body: {} }))).status, 400);
  assert.equal(spotify.calls.length, 0);
});

test('queue says how far into the track the player is', async () => {
  const state = { is_playing: true, progress_ms: 60_000, item: track(1, 'En cours'), device: device({ volume_percent: 40 }) };
  spotify.player = () => reply(200, state);
  const first = (await (await queue(call('/api/queue'))).json()).progress;
  assert.equal(first.paused, false);
  assert.ok(first.ms >= 60_000 && first.ms < 61_000);

  // Between two readings of Spotify the position keeps moving on its own.
  await new Promise((resolve) => setTimeout(resolve, 30));
  const later = (await (await queue(call('/api/queue'))).json()).progress;
  assert.ok(later.ms > first.ms && later.ms < 61_000);
  assert.equal(spotify.count('GET', '/v1/me/player'), 1);

  // Paused: it stays where it is.
  process.env.SPOTIFY_REFRESH_TOKEN = `refresh-${run}-paused`;
  Object.assign(state, { is_playing: false, progress_ms: 90_000 });
  assert.deepEqual((await (await queue(call('/api/queue'))).json()).progress, { ms: 90_000, paused: true });

  // Read for another track than the one the queue reports: better nothing than a wrong bar.
  process.env.SPOTIFY_REFRESH_TOKEN = `refresh-${run}-other`;
  state.item = track(2, 'Suivant');
  assert.equal((await (await queue(call('/api/queue'))).json()).progress, null);
});

test('the end of the track is not held back by the cache', async () => {
  // 201 s long, and the player is 400 ms from the end.
  spotify.player = () =>
    reply(200, { is_playing: true, progress_ms: 200_600, item: track(1, 'En cours'), device: device({ volume_percent: 40 }) });
  await queue(call('/api/queue'));
  await queue(call('/api/queue'));
  assert.equal(spotify.count('GET', '/v1/me/player/queue'), 1);

  await new Promise((resolve) => setTimeout(resolve, 1100));
  spotify.queue = () => reply(200, { currently_playing: track(2, 'Suivant'), queue: [] });
  spotify.player = () =>
    reply(200, { is_playing: true, progress_ms: 300, item: track(2, 'Suivant'), device: device({ volume_percent: 40 }) });
  const body = await (await queue(call('/api/queue'))).json();
  assert.equal(body.playing.name, 'Suivant');
  assert.ok(body.progress.ms < 2_000);
});

test('no volume control when the device cannot be set from elsewhere', async () => {
  const devices = [{ supports_volume: false }, { is_restricted: true }, { volume_percent: null }];
  for (const [i, fields] of devices.entries()) {
    process.env.SPOTIFY_REFRESH_TOKEN = `refresh-${run}-${i}`; // a new token starts with an empty cache
    speaker(40, fields);
    const body = await (await queue(call('/api/queue'))).json();
    assert.equal(body.volume, null, JSON.stringify(fields));
    assert.equal(body.playing.name, 'En cours');
  }

  // The rest of the page does not depend on the volume being readable.
  process.env.SPOTIFY_REFRESH_TOKEN = `refresh-${run}-failing`;
  spotify.player = () => reply(500, { error: { status: 500, message: 'Server error' } });
  const res = await queue(call('/api/queue'));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).volume, null);
});

test('a visitor turns the volume down one step, then has to wait', async () => {
  const box = speaker(40);
  const alice = browser();
  const res = await alice(vote, '/api/queue', turn('down'));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { volume: { percent: 30, min: 10, max: 50, wait: 10 } });
  assert.equal(box.percent, 30);
  assert.match(
    res.headers.get('set-cookie'),
    /^sr_vol=\d+\.[\w-]+; Path=\/; Max-Age=10; HttpOnly; SameSite=Lax; Secure$/,
  );

  const again = await alice(vote, '/api/queue', turn('down'));
  assert.equal(again.status, 429);
  const refused = await again.json();
  assert.equal(refused.error, 'volume_wait');
  assert.ok(refused.retryAfter > 0 && refused.retryAfter <= 10);
  assert.equal(spotify.count('PUT', '/v1/me/player/volume'), 1);

  // The page restores the wait after a reload.
  const state = await (await alice(queue, '/api/queue')).json();
  assert.equal(state.volume.percent, 30);
  assert.ok(state.volume.wait > 0 && state.volume.wait <= 10);

  // Someone else does not have to wait.
  const bob = browser();
  assert.equal((await (await bob(vote, '/api/queue', turn('down'))).json()).volume.percent, 20);
});

test('the page shows the volume that was just set, even while Spotify still reports the old one', async () => {
  speaker(40);
  await queue(call('/api/queue'));
  spotify.volume = () => reply(204); // accepted, but not reflected yet in what Spotify reports
  await vote(call('/api/queue', turn('down')));
  assert.equal((await (await queue(call('/api/queue'))).json()).volume.percent, 30);
});

test('a wait cookie only counts for the action it was signed for', async () => {
  speaker(40);
  const requested = await request(call('/api/request', { method: 'POST', body: { uri: track(7).uri } }));
  const signed = requested.headers.get('set-cookie').split(';')[0].replace('sr_last=', '');
  for (const cookie of [`sr_vol=${signed}`, `sr_vol=${Date.now()}.forged`]) {
    const res = await vote(call('/api/queue', { ...turn('down'), headers: { cookie } }));
    assert.equal(res.status, 200, cookie);
  }
});

test('the volume never goes above the ceiling from the page', async () => {
  const box = speaker(45);
  const up = await vote(call('/api/queue', turn('up')));
  assert.equal((await up.json()).volume.percent, 50);
  assert.equal(box.percent, 50);

  const refused = await vote(call('/api/queue', turn('up')));
  assert.equal(refused.status, 409);
  assert.equal(refused.headers.get('set-cookie'), null);
  const body = await refused.json();
  assert.equal(body.error, 'volume_limit');
  assert.deepEqual(body.volume, { percent: 50, min: 10, max: 50, wait: 0 });
  assert.equal(spotify.count('PUT', '/v1/me/player/volume'), 1);

  // The owner went louder from Spotify itself: the page can only bring it down.
  box.percent = 80;
  assert.equal((await vote(call('/api/queue', turn('up')))).status, 409);
  assert.equal(box.percent, 80);
  assert.equal((await (await vote(call('/api/queue', turn('down')))).json()).volume.percent, 70);
});

test('the volume does not go under the floor', async () => {
  const box = speaker(15);
  assert.equal((await (await vote(call('/api/queue', turn('down')))).json()).volume.percent, 10);
  const refused = await vote(call('/api/queue', turn('down')));
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, 'volume_limit');
  assert.equal(box.percent, 10);
});

test('VOLUME_MAX and VOLUME_MIN move the limits, and VOLUME_MAX=0 takes the control away', async () => {
  process.env.VOLUME_MAX = '30';
  process.env.VOLUME_MIN = '20';
  const box = speaker(25);
  assert.deepEqual((await (await vote(call('/api/queue', turn('up')))).json()).volume, {
    percent: 30,
    min: 20,
    max: 30,
    wait: 10,
  });
  assert.equal((await vote(call('/api/queue', turn('up')))).status, 409);
  assert.equal((await (await vote(call('/api/queue', turn('down')))).json()).volume.percent, 20);
  assert.equal((await vote(call('/api/queue', turn('down')))).status, 409);

  process.env.VOLUME_MAX = '0';
  process.env.SPOTIFY_REFRESH_TOKEN = `refresh-${run}-off`;
  spotify.calls.length = 0;
  assert.equal((await (await queue(call('/api/queue'))).json()).volume, null);
  const refused = await vote(call('/api/queue', turn('down')));
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error, 'volume_off');
  assert.equal(box.percent, 20);
});

test('a volume change needs a known direction and a device that accepts it', async () => {
  for (const volume of ['loud', 5, null, '']) {
    assert.equal((await vote(call('/api/queue', { method: 'POST', body: { volume } }))).status, 400);
  }
  assert.equal((await vote(call('/api/queue', { ...turn('down'), code: null }))).status, 401);
  assert.equal(spotify.calls.length, 0);

  spotify.volume = () =>
    reply(403, {
      error: { status: 403, message: 'Player command failed: Cannot control device volume', reason: 'VOLUME_CONTROL_DISALLOW' },
    });
  const refused = await vote(call('/api/queue', turn('down')));
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, 'volume_unavailable');
  assert.equal(refused.headers.get('set-cookie'), null);

  spotify.player = () => reply(204);
  const idle = await vote(call('/api/queue', turn('down')));
  assert.equal(idle.status, 409);
  assert.equal((await idle.json()).error, 'volume_unavailable');
});

test('volume changes from one address are capped', async () => {
  const box = speaker(30);
  let last;
  for (let i = 0; i < 61; i += 1) last = await vote(call('/api/queue', turn(i % 2 ? 'up' : 'down')));
  assert.equal(last.status, 429);
  assert.equal((await last.json()).error, 'rate_limited');
  assert.equal(spotify.count('PUT', '/v1/me/player/volume'), 60);
  assert.equal(box.percent, 30);
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
