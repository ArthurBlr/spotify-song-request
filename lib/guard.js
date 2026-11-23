// Who may call the API, and how often.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { missingSettings } from './config.js';
import { fail, publicOrigin, readCookies, setCookie } from './http.js';

const COOLDOWN_COOKIE = 'sr_last';

function sameSecret(a, b) {
  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Returns the error Response to send when the request may not proceed
 * (setup unfinished, or wrong access code), otherwise null.
 */
export function checkAccess(request, cfg) {
  const missing = missingSettings(cfg);
  if (missing.length) {
    return fail(503, 'not_configured', "L'installation n'est pas terminée.", {
      missing,
      redirectUri: `${publicOrigin(request)}/api/callback`,
    });
  }
  // The browser URI-encodes the code so that any character survives a header.
  const given = decode(request.headers.get('x-access-code') ?? '');
  if (cfg.accessCode && !sameSecret(given, cfg.accessCode)) {
    return fail(401, 'bad_code', "Code d'accès requis.");
  }
  return null;
}

// --- Cooldown between two requests from the same browser -------------------
// Kept in a signed cookie, so it needs no storage and holds across instances.
// Someone who clears their cookies gets around it; the per-IP limit below is
// the backstop for that.

function sign(timestamp, cfg) {
  return createHmac('sha256', cfg.clientSecret).update(`cooldown:${timestamp}`).digest('base64url');
}

/** Seconds left before this browser may request again (0 = allowed now). */
export function cooldownRemaining(request, cfg, now = Date.now()) {
  if (!cfg.cooldownSeconds) return 0;
  const [timestamp, signature] = (readCookies(request)[COOLDOWN_COOKIE] ?? '').split('.');
  if (!timestamp || !signature || !sameSecret(signature, sign(timestamp, cfg))) return 0;
  const elapsed = (now - Number(timestamp)) / 1000;
  if (!(elapsed >= 0)) return 0;
  return Math.max(0, Math.ceil(cfg.cooldownSeconds - elapsed));
}

export function cooldownCookie(request, cfg, now = Date.now()) {
  const timestamp = String(now);
  return setCookie(request, COOLDOWN_COOKIE, `${timestamp}.${sign(timestamp, cfg)}`, cfg.cooldownSeconds);
}

// --- Per-IP sliding window ---------------------------------------------------
// Lives in the memory of one server instance: good enough to stop a script
// from flooding the queue, not an exact quota.

const hits = new Map(); // key -> { windowMs, times: number[] }

/** Records a hit; returns 0 when allowed, else the seconds to wait. */
export function rateLimit(key, limit, windowMs, now = Date.now()) {
  if (hits.size > 2000) {
    for (const [k, entry] of hits) {
      if (now - entry.times[entry.times.length - 1] >= entry.windowMs) hits.delete(k);
    }
  }
  const times = (hits.get(key)?.times ?? []).filter((t) => now - t < windowMs);
  const blocked = times.length >= limit;
  if (!blocked) times.push(now);
  hits.set(key, { windowMs, times });
  return blocked ? Math.max(1, Math.ceil((times[0] + windowMs - now) / 1000)) : 0;
}
