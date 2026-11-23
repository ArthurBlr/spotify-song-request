// GET /api/search?q=... -> { tracks: [...] }

import { getConfig } from '../lib/config.js';
import { checkAccess, rateLimit } from '../lib/guard.js';
import { clientIp, fail, json, requestUrl } from '../lib/http.js';
import { searchTracks, spotifyFailure } from '../lib/spotify.js';

export async function GET(request) {
  const denied = checkAccess(request, getConfig());
  if (denied) return denied;

  const query = (requestUrl(request).searchParams.get('q') ?? '').trim();
  if (query.length < 2) return json({ tracks: [] });
  if (query.length > 200) return fail(400, 'bad_request', 'Recherche trop longue.');

  // Generous: a whole office often shares one public IP.
  const wait = rateLimit(`search:${clientIp(request)}`, 90, 60_000);
  if (wait) return fail(429, 'rate_limited', 'Trop de recherches, réessaie dans un instant.', { retryAfter: wait });

  try {
    return json({ tracks: await searchTracks(query) });
  } catch (err) {
    return spotifyFailure(err);
  }
}
