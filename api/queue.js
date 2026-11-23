// GET /api/queue -> { playing, next, cooldown }

import { getConfig } from '../lib/config.js';
import { checkAccess, cooldownRemaining } from '../lib/guard.js';
import { json } from '../lib/http.js';
import { getQueue, spotifyFailure } from '../lib/spotify.js';

// Every open page polls this; a short cache keeps that to one Spotify call.
const CACHE_MS = 4000;
const SHOWN = 10;
let cached = null;

export async function GET(request) {
  const cfg = getConfig();
  const denied = checkAccess(request, cfg);
  if (denied) return denied;

  try {
    if (cached?.key !== cfg.refreshToken || Date.now() - cached.at > CACHE_MS) {
      cached = { key: cfg.refreshToken, at: Date.now(), queue: await getQueue() };
    }
    const { playing, next } = cached.queue;
    return json({ playing, next: next.slice(0, SHOWN), cooldown: cooldownRemaining(request, cfg) });
  } catch (err) {
    return spotifyFailure(err);
  }
}
