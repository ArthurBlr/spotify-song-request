// GET /api/login -> sends the owner to Spotify's consent screen.
// Used once at install, then again whenever the refresh token expires.

import { randomBytes } from 'node:crypto';
import { getConfig } from '../lib/config.js';
import { page, publicOrigin, setCookie } from '../lib/http.js';
import { authorizeUrl } from '../lib/spotify.js';

export function GET(request) {
  const cfg = getConfig();
  if (!cfg.clientId || !cfg.clientSecret) {
    return page(
      'Configuration incomplète',
      `<p>Les variables <code>SPOTIFY_CLIENT_ID</code> et <code>SPOTIFY_CLIENT_SECRET</code> ne sont pas définies.</p>
<p>Ajoute-les dans les réglages du projet, redéploie, puis reviens sur cette page.</p>`,
      503,
    );
  }

  const state = randomBytes(16).toString('hex');
  const redirectUri = `${publicOrigin(request)}/api/callback`;
  return new Response(null, {
    status: 302,
    headers: {
      location: authorizeUrl(cfg, redirectUri, state),
      'set-cookie': setCookie(request, 'sr_state', state, 600),
      'cache-control': 'no-store',
    },
  });
}
