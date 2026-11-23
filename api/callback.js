// GET /api/callback -> Spotify comes back here after the consent screen.
// Shows the refresh token once, for the owner to store as an environment variable.

import { getConfig } from '../lib/config.js';
import { escapeHtml, page, publicOrigin, readCookies, requestUrl, setCookie } from '../lib/http.js';
import { exchangeCode } from '../lib/spotify.js';

// Spotify refresh tokens stop working 6 months after the consent.
const TOKEN_LIFETIME_MONTHS = 6;

function retry(title, detailHtml, status = 400) {
  return page(title, `${detailHtml}\n<p><a class="button" href="/api/login">Recommencer</a></p>`, status);
}

export async function GET(request) {
  const cfg = getConfig();
  const params = requestUrl(request).searchParams;
  const redirectUri = `${publicOrigin(request)}/api/callback`;

  if (params.get('error')) {
    return retry('Connexion annulée', `<p>Spotify a répondu : <code>${escapeHtml(params.get('error'))}</code>.</p>`);
  }
  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state || state !== readCookies(request).sr_state) {
    return retry('Lien expiré', '<p>Cette tentative de connexion n’est plus valide.</p>');
  }
  if (!cfg.clientId || !cfg.clientSecret) {
    return retry(
      'Configuration incomplète',
      '<p>Les variables <code>SPOTIFY_CLIENT_ID</code> et <code>SPOTIFY_CLIENT_SECRET</code> ne sont pas définies.</p>',
      503,
    );
  }

  let tokens;
  try {
    tokens = await exchangeCode(code, redirectUri, cfg);
  } catch (err) {
    console.error('Token exchange failed', err);
    return retry(
      'Échec de la connexion',
      `<p>Spotify a refusé l’échange : <code>${escapeHtml(err.message)}</code>.</p>
<p>Vérifie le <em>Client secret</em>, et que la Redirect URI déclarée dans ton app Spotify est exactement :</p>
<pre class="secret">${escapeHtml(redirectUri)}</pre>`,
      502,
    );
  }
  if (!tokens.refresh_token) {
    return retry('Échec de la connexion', '<p>Spotify n’a pas renvoyé de refresh token.</p>', 502);
  }

  const expiry = new Date();
  expiry.setMonth(expiry.getMonth() + TOKEN_LIFETIME_MONTHS);
  const expiryText = expiry.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  const response = page(
    'Compte Spotify relié',
    `<p>Dernière étape : enregistre ce token dans la variable d’environnement <code>SPOTIFY_REFRESH_TOKEN</code>, puis redéploie.</p>
<pre class="secret" id="token">${escapeHtml(tokens.refresh_token)}</pre>
<p><button class="button" type="button" id="copy">Copier le token</button></p>
<ul>
<li>Sur Vercel : <em>Settings → Environment Variables</em>, puis <em>Deployments → Redeploy</em>.</li>
<li>En local : dans le fichier <code>.env</code>, puis relance <code>npm start</code>.</li>
</ul>
<p>Ce token donne accès à ta file d’attente : ne le partage pas. Spotify le désactive au bout de ${TOKEN_LIFETIME_MONTHS} mois, soit vers le <strong>${escapeHtml(expiryText)}</strong>. Il suffira alors de rouvrir <code>/api/login</code> et de remplacer la variable.</p>
<script>
document.getElementById('copy').addEventListener('click', async (event) => {
  await navigator.clipboard.writeText(document.getElementById('token').textContent);
  event.target.textContent = 'Copié';
});
</script>`,
  );
  // The state has served its purpose.
  response.headers.append('set-cookie', setCookie(request, 'sr_state', '', 0));
  return response;
}
