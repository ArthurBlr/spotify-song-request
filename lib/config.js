// Settings come from environment variables and are read on every call,
// so a changed value is picked up without any module-level state.

function seconds(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function getConfig() {
  const env = process.env;
  return {
    clientId: (env.SPOTIFY_CLIENT_ID ?? '').trim(),
    clientSecret: (env.SPOTIFY_CLIENT_SECRET ?? '').trim(),
    refreshToken: (env.SPOTIFY_REFRESH_TOKEN ?? '').trim(),
    accessCode: (env.ACCESS_CODE ?? '').trim(),
    cooldownSeconds: seconds(env.COOLDOWN_SECONDS, 3),
  };
}

/** Names of the required variables that are still empty. */
export function missingSettings(cfg) {
  const missing = [];
  if (!cfg.clientId) missing.push('SPOTIFY_CLIENT_ID');
  if (!cfg.clientSecret) missing.push('SPOTIFY_CLIENT_SECRET');
  if (!cfg.refreshToken) missing.push('SPOTIFY_REFRESH_TOKEN');
  return missing;
}
