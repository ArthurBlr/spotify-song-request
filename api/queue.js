// GET  /api/queue                    -> { playing, progress, next, cooldown, present, people, reactions, skip, volume }
// POST /api/queue { skip: <uri> }    -> this browser's vote to skip the track that is playing
// POST /api/queue { volume: "down" } -> one step down; "up" for one step up, never past the ceiling
// POST /api/queue { react: "🔥" }    -> this browser's avatar says it, for everyone to see
//
// The actions are handled here rather than in routes of their own because
// they share memory with the GET: the people present for the vote and the
// reactions, what was last read from the player for the volume. On Vercel
// every file under api/ is a separate function with its own memory.

import { getConfig } from '../lib/config.js';
import {
  checkAccess,
  cooldownRemaining,
  identify,
  rateLimit,
  VOLUME_WAIT,
  volumeCookie,
  volumeWait,
} from '../lib/guard.js';
import { clientIp, fail, json } from '../lib/http.js';
import {
  cleanAvatar,
  closeVote,
  markPresent,
  presentCount,
  presentPeople,
  react,
  REACTIONS,
  reopenVote,
  skipTally,
  voteToSkip,
  wear,
} from '../lib/room.js';
import { getPlayback, getQueue, getVolume, setVolume, skipToNext, spotifyFailure } from '../lib/spotify.js';
import { nextVolume } from '../lib/volume.js';

// Every open page polls this; a short cache keeps Spotify from being asked each time.
const CACHE_MS = 4000;
const SHOWN = 10;
// Spotify takes a moment to report a volume that has just changed: until then,
// the value that was last set or read on purpose is the one shown.
const VOLUME_SETTLE_MS = 5000;
let cached = null;
let trusted = null;

/**
 * What is playing and how far into it the player is, what comes next, and the
 * volume (null when visitors cannot set it).
 */
async function playerState(cfg) {
  if (cached?.key !== cfg.refreshToken || Date.now() - cached.at > CACHE_MS || trackOver(cached)) {
    const [queue, playback] = await Promise.all([
      getQueue(),
      // Progress and volume are niceties: when they cannot be read, the page still does its job.
      getPlayback().catch(() => null),
    ]);
    cached = { key: cfg.refreshToken, at: Date.now(), ...queue, playback };
  }
  const settling = trusted?.key === cfg.refreshToken && Date.now() < trusted.until;
  const volume = cfg.volumeMax ? (cached.playback?.volume ?? null) : null;
  return {
    playing: cached.playing,
    progress: progressOf(cached),
    next: cached.next,
    volume: settling ? trusted.percent : volume,
  };
}

/**
 * How far into the track the player is right now: { ms, paused }. Null when
 * it is not known, or was read for another track than the one shown.
 */
function progressOf({ playing, playback, at }, now = Date.now()) {
  if (!playing || playback?.progressMs == null || playback.uri !== playing.uri) return null;
  const ms = playback.progressMs + (playback.paused ? 0 : now - at);
  return { ms: playing.durationMs ? Math.min(ms, playing.durationMs) : ms, paused: playback.paused };
}

/** The track that was playing should have ended by now: the cache is out of date. */
function trackOver(state, now = Date.now()) {
  const progress = progressOf(state, now);
  return Boolean(progress && !progress.paused && state.playing.durationMs && progress.ms >= state.playing.durationMs && now - state.at > 1000);
}

function trustVolume(cfg, percent) {
  trusted = { key: cfg.refreshToken, percent, until: Date.now() + VOLUME_SETTLE_MS };
}

/** The volume as the page gets it; `wait` is the seconds before this browser may move it. */
function volumeInfo(percent, wait, cfg) {
  return percent === null ? null : { percent, min: cfg.volumeMin, max: cfg.volumeMax, wait };
}

/**
 * The avatar a browser sends along with every poll, in a header. It is kept
 * in the browser: the server only passes it on, so it survives a restart.
 */
function avatarOf(request) {
  const sent = request.headers.get('x-avatar');
  if (!sent || sent.length > 600) return null;
  try {
    return cleanAvatar(JSON.parse(decodeURIComponent(sent)));
  } catch {
    return null;
  }
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
  wear(visitor.id, avatarOf(request));
  try {
    const { playing, progress, next, volume } = await playerState(cfg);
    return withCookie(
      json({
        playing,
        progress,
        next: next.slice(0, SHOWN),
        cooldown: cooldownRemaining(request, cfg),
        present: presentCount(),
        people: presentPeople(visitor.id),
        reactions: REACTIONS,
        skip: skipTally(playing?.uri, visitor.id),
        volume: volumeInfo(volume, volumeWait(request, cfg), cfg),
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
  if (body?.volume !== undefined) {
    if (body.volume !== 'down' && body.volume !== 'up') return fail(400, 'bad_request', 'Réglage invalide.');
    return changeVolume(request, cfg, body.volume);
  }
  if (body?.react !== undefined) return sendReaction(request, cfg, body.react);
  const uri = typeof body?.skip === 'string' ? body.skip : '';
  if (!uri) return fail(400, 'bad_request', 'Vote invalide.');
  return voteSkip(request, cfg, uri);
}

function sendReaction(request, cfg, emoji) {
  const visitor = identify(request, cfg);
  const send = (response) => withCookie(response, visitor.cookie);
  if (!visitor.id || rateLimit(`react:${visitor.id}`, 5, 10_000)) {
    return send(fail(429, 'rate_limited', 'Doucement sur les réactions.'));
  }
  markPresent(visitor.id);
  if (!react(visitor.id, emoji)) return send(fail(400, 'bad_request', 'Réaction inconnue.'));
  return send(json({ ok: true }));
}

async function voteSkip(request, cfg, uri) {
  const visitor = identify(request, cfg);
  const send = (response) => withCookie(response, visitor.cookie);
  if (!visitor.id || rateLimit(`skip:${clientIp(request)}`, 60, 10 * 60_000)) {
    return send(fail(429, 'rate_limited', 'Beaucoup de votes en ce moment, réessaie dans quelques minutes.'));
  }
  markPresent(visitor.id);

  try {
    const { playing } = await playerState(cfg);
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

async function changeVolume(request, cfg, direction) {
  if (!cfg.volumeMax) return fail(403, 'volume_off', 'Le volume ne se règle pas depuis cette page.');

  const wait = volumeWait(request, cfg);
  if (wait) {
    return fail(429, 'volume_wait', `Doucement : prochain réglage du volume possible dans ${wait} s.`, {
      retryAfter: wait,
    });
  }
  if (rateLimit(`volume:${clientIp(request)}`, 60, 10 * 60_000)) {
    return fail(429, 'rate_limited', 'Beaucoup de réglages du volume en ce moment, réessaie dans quelques minutes.');
  }

  try {
    // Read afresh: the owner may have just moved it, and the limits are judged on the real value.
    const current = await getVolume();
    if (current === null) {
      return fail(
        409,
        'volume_unavailable',
        "Le volume ne peut pas être réglé : rien n'est en lecture, ou l'appareil ne le permet pas.",
      );
    }
    const target = nextVolume(current, direction, cfg);
    if (target === null) {
      trustVolume(cfg, current);
      const message =
        direction === 'up'
          ? `Le volume ne monte pas au-dessus de ${cfg.volumeMax} % depuis cette page.`
          : `Le volume ne descend pas en dessous de ${cfg.volumeMin} % depuis cette page.`;
      return fail(409, 'volume_limit', message, { volume: volumeInfo(current, 0, cfg) });
    }
    await setVolume(target);
    trustVolume(cfg, target);
    return json({ volume: volumeInfo(target, VOLUME_WAIT, cfg) }, 200, {
      'set-cookie': volumeCookie(request, cfg),
    });
  } catch (err) {
    return spotifyFailure(err);
  }
}
