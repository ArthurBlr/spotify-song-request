// Everything that talks to Spotify: OAuth tokens and the Web API calls.

import { getConfig } from './config.js';
import { fail } from './http.js';

const ACCOUNTS_URL = 'https://accounts.spotify.com';
const API_URL = 'https://api.spotify.com/v1';

// Add to the queue, skip a track, set the volume, and read what is playing / coming next.
export const SCOPES = [
  'user-modify-playback-state',
  'user-read-playback-state',
  'user-read-currently-playing',
].join(' ');

// Spotify caps search at 10 results per call for apps in development mode.
const SEARCH_LIMIT = 10;

const TRACK_LINK = /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/|spotify:track:)([A-Za-z0-9]{22})/;
export const TRACK_URI = /^spotify:track:[A-Za-z0-9]{22}$/;

export class SpotifyError extends Error {
  constructor(message, { status = 502, code = 'spotify_error', retryAfter } = {}) {
    super(message);
    this.name = 'SpotifyError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

// --- OAuth -------------------------------------------------------------------

export function authorizeUrl(cfg, redirectUri, state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
  });
  return `${ACCOUNTS_URL}/authorize?${params}`;
}

async function tokenRequest(params, cfg) {
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const res = await fetch(`${ACCOUNTS_URL}/api/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    // invalid_grant = the refresh token was revoked or is past its 6-month life.
    throw new SpotifyError(data.error_description || data.error || `HTTP ${res.status}`, {
      status: res.status,
      code: data.error === 'invalid_grant' ? 'reauth_required' : 'token_error',
    });
  }
  return data;
}

/** One-time exchange of the authorization code for a refresh token. */
export function exchangeCode(code, redirectUri, cfg = getConfig()) {
  return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }, cfg);
}

// Access tokens last an hour; keep the current one for as long as this
// server instance lives, and share a refresh that is already in flight.
let cached = null;
let refreshing = null;

async function accessToken({ force = false } = {}) {
  const cfg = getConfig();
  if (!force && cached?.key === cfg.refreshToken && Date.now() < cached.expiresAt) {
    return cached.token;
  }
  refreshing ??= tokenRequest({ grant_type: 'refresh_token', refresh_token: cfg.refreshToken }, cfg)
    .then((data) => {
      const lifetime = Number(data.expires_in) || 3600;
      cached = {
        key: cfg.refreshToken,
        token: data.access_token,
        expiresAt: Date.now() + (lifetime - 60) * 1000,
      };
      return cached.token;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

// --- Web API -----------------------------------------------------------------

async function api(path, { method = 'GET', retry = true } = {}) {
  const token = await accessToken();
  const res = await fetch(API_URL + path, { method, headers: { authorization: `Bearer ${token}` } });

  if (res.status === 401 && retry) {
    await accessToken({ force: true });
    return api(path, { method, retry: false });
  }

  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Player endpoints sometimes answer with an empty or non-JSON body.
  }
  if (res.ok) return body;

  const reason = body?.error?.reason;
  const message = body?.error?.message || `HTTP ${res.status}`;
  let code = 'spotify_error';
  if (res.status === 429) code = 'spotify_busy';
  else if (reason === 'PREMIUM_REQUIRED') code = 'premium_required';
  else if (reason === 'VOLUME_CONTROL_DISALLOW') code = 'volume_unavailable';
  else if (reason === 'NO_ACTIVE_DEVICE' || (res.status === 404 && path.startsWith('/me/player'))) {
    code = 'no_active_device';
  } else if (res.status === 403) code = 'forbidden';
  throw new SpotifyError(message, {
    status: res.status,
    code,
    retryAfter: Number(res.headers.get('retry-after')) || undefined,
  });
}

function pickImage(images) {
  const usable = (images ?? []).filter((image) => image?.url);
  // Smallest cover that still looks sharp in a 48-64 px slot on a retina screen.
  const sharp = usable.filter((image) => (image.width ?? 0) >= 128).sort((a, b) => a.width - b.width);
  return (sharp[0] ?? usable[0])?.url ?? null;
}

/** Trims a Spotify track (or podcast episode) down to what the page shows. */
function toItem(item) {
  if (!item?.uri || !item.name) return null;
  const isEpisode = item.type === 'episode';
  return {
    uri: item.uri,
    name: item.name,
    artists: isEpisode
      ? (item.show?.name ?? '')
      : (item.artists ?? []).map((artist) => artist.name).join(', '),
    image: pickImage(isEpisode ? item.images : item.album?.images),
    durationMs: item.duration_ms ?? 0,
    explicit: Boolean(item.explicit),
  };
}

/** Free-text search, or a direct lookup when the query is a Spotify track link. */
export async function searchTracks(query) {
  const id = query.match(TRACK_LINK)?.[1];
  if (id) {
    try {
      const track = toItem(await api(`/tracks/${id}`));
      return track ? [track] : [];
    } catch (err) {
      if (err instanceof SpotifyError && (err.status === 400 || err.status === 404)) return [];
      throw err;
    }
  }
  const params = new URLSearchParams({ q: query, type: 'track', limit: String(SEARCH_LIMIT) });
  const data = await api(`/search?${params}`);
  return (data?.tracks?.items ?? []).map(toItem).filter(Boolean);
}

export async function getQueue() {
  const data = await api('/me/player/queue');
  return {
    playing: toItem(data?.currently_playing),
    next: (data?.queue ?? []).map(toItem).filter(Boolean),
  };
}

export async function addToQueue(uri) {
  await api(`/me/player/queue?${new URLSearchParams({ uri })}`, { method: 'POST' });
}

export async function skipToNext() {
  await api('/me/player/next', { method: 'POST' });
}

/**
 * What the player is doing: { volume, uri, progressMs, paused }.
 * `volume` goes from 0 to 100, and is null when the device does not let it be
 * set from elsewhere. `uri` and `progressMs` say how far into which track it
 * is, both null when nothing is loaded.
 */
export async function getPlayback() {
  const data = await api('/me/player?additional_types=episode');
  const device = data?.device;
  const settable = device && !device.is_restricted && device.supports_volume !== false;
  return {
    volume: settable && Number.isInteger(device.volume_percent) ? device.volume_percent : null,
    uri: data?.item?.uri ?? null,
    progressMs: Number.isFinite(data?.progress_ms) ? data.progress_ms : null,
    paused: !data?.is_playing,
  };
}

/** Volume of the device that is playing, or null when it cannot be set from here. */
export async function getVolume() {
  return (await getPlayback()).volume;
}

export async function setVolume(percent) {
  await api(`/me/player/volume?${new URLSearchParams({ volume_percent: String(percent) })}`, { method: 'PUT' });
}

// --- Errors shown to visitors --------------------------------------------------

const FAILURES = {
  no_active_device: {
    status: 409,
    message: () => "Rien n'est en lecture sur Spotify pour l'instant. Réessaie quand la musique tourne.",
  },
  premium_required: {
    status: 403,
    message: () => 'Le compte Spotify relié à cette page doit être Premium.',
  },
  volume_unavailable: {
    status: 409,
    message: () => "L'appareil qui joue la musique ne permet pas de régler son volume à distance.",
  },
  reauth_required: {
    status: 503,
    message: () =>
      'La connexion au compte Spotify a expiré (elle dure 6 mois). La personne qui gère cette page doit la renouveler via /api/login.',
  },
  spotify_busy: {
    status: 503,
    message: () => 'Spotify limite les requêtes pour le moment. Réessaie dans un instant.',
  },
  forbidden: {
    status: 403,
    message: (err) =>
      `Spotify refuse la demande (${err.message}). Si ça persiste, vérifie que le compte est ajouté dans « User Management » de l'app Spotify.`,
  },
};

/** Turns anything thrown by the calls above into the JSON error for the page. */
export function spotifyFailure(err) {
  if (!(err instanceof SpotifyError)) {
    console.error('Unexpected error', err);
    return fail(500, 'server_error', 'Erreur inattendue du serveur.');
  }
  console.error(`Spotify error ${err.status} (${err.code}): ${err.message}`);
  const known = FAILURES[err.code];
  return fail(
    known?.status ?? 502,
    err.code,
    known ? known.message(err) : `Spotify a renvoyé une erreur : ${err.message}`,
    err.retryAfter ? { retryAfter: err.retryAfter } : {},
  );
}
