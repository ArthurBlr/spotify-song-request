// Who may call the API, and how often.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { missingSettings } from './config.js';
import { clientIp, fail, publicOrigin, readCookies, setCookie } from './http.js';

const COOLDOWN_COOKIE = 'sr_last';
const VOLUME_COOKIE = 'sr_vol';
const VISITOR_COOKIE = 'sr_id';
const VISITOR_MAX_AGE = 180 * 24 * 3600;

function sameSecret(a, b) {
  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/** Proof that a cookie value was issued by this server. */
function sign(value, cfg) {
  return createHmac('sha256', cfg.clientSecret).update(value).digest('base64url');
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

// --- Waits between two actions from the same browser -------------------------
// Each is the time of the last action, kept in a signed cookie: it needs no
// storage and holds across instances. Someone who clears their cookies gets
// around it; the per-IP limits below are the backstop for that.

/** Seconds between two volume changes from the same browser. */
export const VOLUME_WAIT = 10;

function waitLeft(request, cfg, cookie, seconds, now) {
  if (!seconds) return 0;
  const [timestamp, signature] = (readCookies(request)[cookie] ?? '').split('.');
  // The cookie's name is part of what is signed: one wait cannot pass for another.
  if (!timestamp || !signature || !sameSecret(signature, sign(`${cookie}:${timestamp}`, cfg))) return 0;
  const elapsed = (now - Number(timestamp)) / 1000;
  if (!(elapsed >= 0)) return 0;
  return Math.max(0, Math.ceil(seconds - elapsed));
}

function waitCookie(request, cfg, cookie, seconds, now) {
  const timestamp = String(now);
  return setCookie(request, cookie, `${timestamp}.${sign(`${cookie}:${timestamp}`, cfg)}`, seconds);
}

/** Seconds left before this browser may request a track again (0 = allowed now). */
export function cooldownRemaining(request, cfg, now = Date.now()) {
  return waitLeft(request, cfg, COOLDOWN_COOKIE, cfg.cooldownSeconds, now);
}

export function cooldownCookie(request, cfg, now = Date.now()) {
  return waitCookie(request, cfg, COOLDOWN_COOKIE, cfg.cooldownSeconds, now);
}

/** Seconds left before this browser may move the volume again (0 = allowed now). */
export function volumeWait(request, cfg, now = Date.now()) {
  return waitLeft(request, cfg, VOLUME_COOKIE, VOLUME_WAIT, now);
}

export function volumeCookie(request, cfg, now = Date.now()) {
  return waitCookie(request, cfg, VOLUME_COOKIE, VOLUME_WAIT, now);
}

// --- Telling browsers apart ----------------------------------------------------
// A random id in a signed cookie: it is what the presence counter and the skip
// votes count. Clearing cookies gives a new id, so new ids are capped per
// address to keep one person from voting as a crowd.

/**
 * The visitor behind a request: `id`, plus the `cookie` to send back when the
 * id was just created. `id` is null when this address asked for too many ids.
 */
export function identify(request, cfg) {
  const [id, signature] = (readCookies(request)[VISITOR_COOKIE] ?? '').split('.');
  if (id && signature && sameSecret(signature, sign(`visitor:${id}`, cfg))) return { id, cookie: null };
  if (rateLimit(`visitor:${clientIp(request)}`, 30, 10 * 60_000)) return { id: null, cookie: null };
  const fresh = randomBytes(12).toString('base64url');
  const value = `${fresh}.${sign(`visitor:${fresh}`, cfg)}`;
  return { id: fresh, cookie: setCookie(request, VISITOR_COOKIE, value, VISITOR_MAX_AGE) };
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
