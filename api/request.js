// POST /api/request { uri: "spotify:track:..." } -> adds the track to the queue.

import { getConfig } from '../lib/config.js';
import {
  checkAccess,
  cooldownCookie,
  cooldownRemaining,
  identify,
  rateLimit,
  requestsCookie,
} from '../lib/guard.js';
import { clientIp, fail, json } from '../lib/http.js';
import { noteRequests } from '../lib/room.js';
import { addToQueue, getQueue, spotifyFailure, TRACK_URI } from '../lib/spotify.js';

export async function POST(request) {
  const cfg = getConfig();
  const denied = checkAccess(request, cfg);
  if (denied) return denied;

  // Requiring JSON keeps other websites from posting here through a plain form.
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return fail(415, 'bad_request', 'Requête invalide.');
  }
  const body = await request.json().catch(() => null);
  const uri = typeof body?.uri === 'string' ? body.uri : '';
  if (!TRACK_URI.test(uri)) return fail(400, 'bad_request', 'Titre invalide.');

  const cooldown = cooldownRemaining(request, cfg);
  if (cooldown) {
    return fail(429, 'cooldown', `Doucement : prochaine demande possible dans ${cooldown} s.`, {
      retryAfter: cooldown,
    });
  }
  const wait = rateLimit(`request:${clientIp(request)}`, 30, 10 * 60_000);
  if (wait) {
    return fail(429, 'rate_limited', 'Beaucoup de demandes en ce moment, réessaie dans quelques minutes.', {
      retryAfter: wait,
    });
  }

  try {
    // Best effort: if the queue cannot be read, the add below reports the real problem.
    const queue = await getQueue().catch(() => null);
    if (queue?.playing?.uri === uri) {
      return fail(409, 'already_queued', 'Ce titre est déjà en cours de lecture.');
    }
    if (queue?.next.some((item) => item.uri === uri)) {
      return fail(409, 'already_queued', "Ce titre est déjà dans la file d'attente.");
    }

    await addToQueue(uri);
    const response = json({ ok: true, cooldown: cfg.cooldownSeconds });
    if (cfg.cooldownSeconds) response.headers.append('set-cookie', cooldownCookie(request, cfg));
    // Remembered in the browser, for the page to say who asked for which track:
    // the browser shows it to /api/queue with its next poll. When both routes
    // run in one process, as with `npm start`, it is known at once.
    const visitor = identify(request, cfg);
    const now = Date.now();
    if (visitor.cookie) response.headers.append('set-cookie', visitor.cookie);
    if (visitor.id) response.headers.append('set-cookie', requestsCookie(request, cfg, visitor.id, uri, now));
    noteRequests(visitor.id, [{ uri, at: now }], now);
    return response;
  } catch (err) {
    return spotifyFailure(err);
  }
}
