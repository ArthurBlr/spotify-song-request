// GET  /api/queue                 -> { playing, next, cooldown, present, skip }
// POST /api/queue { skip: <uri> } -> this browser's vote to skip the track that is playing
//
// The vote is handled here rather than in a route of its own because it needs
// the list of people present, which the GET keeps up to date: on Vercel every
// file under api/ is a separate function with its own memory.

import { getConfig } from '../lib/config.js';
import { checkAccess, cooldownRemaining, identify, rateLimit } from '../lib/guard.js';
import { clientIp, fail, json } from '../lib/http.js';
import { closeVote, markPresent, presentCount, reopenVote, skipTally, voteToSkip } from '../lib/room.js';
import { getQueue, skipToNext, spotifyFailure } from '../lib/spotify.js';

// Every open page polls this; a short cache keeps that to one Spotify call.
const CACHE_MS = 4000;
const SHOWN = 10;
let cached = null;

async function currentQueue(cfg) {
  if (cached?.key !== cfg.refreshToken || Date.now() - cached.at > CACHE_MS) {
    cached = { key: cfg.refreshToken, at: Date.now(), queue: await getQueue() };
  }
  return cached.queue;
}

/** Hands a new visitor their cookie, whatever the answer is. */
function withCookie(response, cookie) {
  if (cookie) response.headers.append('set-cookie', cookie);
  return response;
}

export async function GET(request) {
  const cfg = getConfig();
  const denied = checkAccess(request, cfg);
  if (denied) return denied;

  const visitor = identify(request, cfg);
  markPresent(visitor.id);
  try {
    const { playing, next } = await currentQueue(cfg);
    return withCookie(
      json({
        playing,
        next: next.slice(0, SHOWN),
        cooldown: cooldownRemaining(request, cfg),
        present: presentCount(),
        skip: skipTally(playing?.uri, visitor.id),
      }),
      visitor.cookie,
    );
  } catch (err) {
    return withCookie(spotifyFailure(err), visitor.cookie);
  }
}

export async function POST(request) {
  const cfg = getConfig();
  const denied = checkAccess(request, cfg);
  if (denied) return denied;

  // Requiring JSON keeps other websites from posting here through a plain form.
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return fail(415, 'bad_request', 'Requête invalide.');
  }
  const body = await request.json().catch(() => null);
  const uri = typeof body?.skip === 'string' ? body.skip : '';
  if (!uri) return fail(400, 'bad_request', 'Vote invalide.');

  const visitor = identify(request, cfg);
  const send = (response) => withCookie(response, visitor.cookie);
  if (!visitor.id || rateLimit(`skip:${clientIp(request)}`, 60, 10 * 60_000)) {
    return send(fail(429, 'rate_limited', 'Beaucoup de votes en ce moment, réessaie dans quelques minutes.'));
  }
  markPresent(visitor.id);

  try {
    const { playing } = await currentQueue(cfg);
    if (playing?.uri !== uri) {
      return send(fail(409, 'track_changed', "Ce titre n'est plus en cours de lecture."));
    }

    // No tally: the track has just been skipped, this vote arrived a moment late.
    const tally = voteToSkip(uri, visitor.id);
    if (tally && tally.votes < tally.needed) {
      return send(json({ skipped: false, present: presentCount(), skip: tally }));
    }
    if (tally) {
      closeVote(uri);
      try {
        // The cache can be a few seconds late: never skip the track that came after.
        const fresh = await getQueue();
        if (fresh.playing?.uri === uri) await skipToNext();
      } catch (err) {
        reopenVote();
        throw err;
      }
      cached = null;
    }
    return send(json({ skipped: true, present: presentCount(), skip: null }));
  } catch (err) {
    return send(spotifyFailure(err));
  }
}
