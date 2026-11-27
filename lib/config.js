// Settings come from environment variables and are read on every call,
// so a changed value is picked up without any module-level state.

function seconds(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Some avatar choices are reserved to whoever holds a code. Only the SHA-256
// of each code is kept, in hex: the code itself is written nowhere. This one
// is the author's; VIP_CODE_HASHES adds others, separated by commas.
const VIP_CODE_HASHES = ['2164c7a4c7c4a44c9aa133e5e78aede0c4dfc5e0ed6746ef039ffe8d87372e9f'];

function hashes(value) {
  return (value ?? '')
    .split(',')
    .map((hash) => hash.trim().toLowerCase())
    .filter((hash) => /^[0-9a-f]{64}$/.test(hash));
}

function percent(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback;
}

export function getConfig() {
  const env = process.env;
  const volumeMax = percent(env.VOLUME_MAX, 50);
  return {
    clientId: (env.SPOTIFY_CLIENT_ID ?? '').trim(),
    clientSecret: (env.SPOTIFY_CLIENT_SECRET ?? '').trim(),
    refreshToken: (env.SPOTIFY_REFRESH_TOKEN ?? '').trim(),
    accessCode: (env.ACCESS_CODE ?? '').trim(),
    cooldownSeconds: seconds(env.COOLDOWN_SECONDS, 3),
    // Visitors move the volume between these two. A ceiling of 0 takes the control away.
    volumeMax,
    volumeMin: Math.min(percent(env.VOLUME_MIN, 10), volumeMax),
    vipHashes: [...VIP_CODE_HASHES, ...hashes(env.VIP_CODE_HASHES)],
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
