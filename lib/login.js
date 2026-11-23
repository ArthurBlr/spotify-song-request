// Second half of the Spotify login: checks what Spotify sent back to
// /api/callback and exchanges it for the refresh token.

import { getConfig } from './config.js';
import { escapeHtml, page, publicOrigin, readCookies, requestUrl, setCookie } from './http.js';
import { exchangeCode } from './spotify.js';

// Spotify refresh tokens stop working 6 months after the consent.
export const TOKEN_LIFETIME_MONTHS = 6;

/** Date around which a token granted now will expire, e.g. "23 mai 2027". */
export function tokenExpiryText(from = new Date()) {
  const expiry = new Date(from);
  expiry.setMonth(expiry.getMonth() + TOKEN_LIFETIME_MONTHS);
  return expiry.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function retry(title, detailHtml, status = 400) {
  return page(title, `${detailHtml}\n<p><a class="button" href="/api/login">Recommencer</a></p>`, status);
}

/**
 * Resolves to { refreshToken, clearState } when Spotify granted access
 * (clearState is the Set-Cookie value that drops the one-time state), or to
 * { failure } holding the error page to send back.
 */
export async function completeLogin(request) {
  const cfg = getConfig();
  const params = requestUrl(request).searchParams;
  const redirectUri = `${publicOrigin(request)}/api/callback`;

  if (params.get('error')) {
    return {
      failure: retry('Connexion annulée', `<p>Spotify a répondu : <code>${escapeHtml(params.get('error'))}</code>.</p>`),
    };
  }
  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state || state !== readCookies(request).sr_state) {
    return { failure: retry('Lien expiré', '<p>Cette tentative de connexion n’est plus valide.</p>') };
  }
  if (!cfg.clientId || !cfg.clientSecret) {
    return {
      failure: retry(
        'Configuration incomplète',
        '<p>Les variables <code>SPOTIFY_CLIENT_ID</code> et <code>SPOTIFY_CLIENT_SECRET</code> ne sont pas définies.</p>',
        503,
      ),
    };
  }

  let tokens;
  try {
    tokens = await exchangeCode(code, redirectUri, cfg);
  } catch (err) {
    console.error('Token exchange failed', err);
    return {
      failure: retry(
        'Échec de la connexion',
        `<p>Spotify a refusé l’échange : <code>${escapeHtml(err.message)}</code>.</p>
<p>Vérifie le <em>Client secret</em>, et que la Redirect URI déclarée dans ton app Spotify est exactement :</p>
<pre class="secret">${escapeHtml(redirectUri)}</pre>`,
        502,
      ),
    };
  }
  if (!tokens.refresh_token) {
    return { failure: retry('Échec de la connexion', '<p>Spotify n’a pas renvoyé de refresh token.</p>', 502) };
  }
  return { refreshToken: tokens.refresh_token, clearState: setCookie(request, 'sr_state', '', 0) };
}
