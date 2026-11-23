// GET /api/callback -> Spotify comes back here after the consent screen.
// Shows the refresh token once, for the owner to store as an environment variable.
// (The local server saves it to .env by itself instead: see local-server.js.)

import { escapeHtml, page } from '../lib/http.js';
import { completeLogin, TOKEN_LIFETIME_MONTHS, tokenExpiryText } from '../lib/login.js';

export async function GET(request) {
  const login = await completeLogin(request);
  if (login.failure) return login.failure;

  const response = page(
    'Compte Spotify relié',
    `<p>Dernière étape : enregistre ce token dans la variable d’environnement <code>SPOTIFY_REFRESH_TOKEN</code>, puis redéploie.</p>
<pre class="secret" id="token">${escapeHtml(login.refreshToken)}</pre>
<p><button class="button" type="button" id="copy">Copier le token</button></p>
<p>Sur Vercel : <em>Settings → Environment Variables</em>, puis <em>Deployments → Redeploy</em>.</p>
<p>Ce token donne accès à ta file d’attente : ne le partage pas. Spotify le désactive au bout de ${TOKEN_LIFETIME_MONTHS} mois, soit vers le <strong>${escapeHtml(tokenExpiryText())}</strong>. Il suffira alors de rouvrir <code>/api/login</code> et de remplacer la variable.</p>
<script>
document.getElementById('copy').addEventListener('click', async (event) => {
  await navigator.clipboard.writeText(document.getElementById('token').textContent);
  event.target.textContent = 'Copié';
});
</script>`,
  );
  response.headers.append('set-cookie', login.clearState);
  return response;
}
