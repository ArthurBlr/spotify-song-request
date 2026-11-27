// Who has the page open right now, the avatar each of them chose, what their
// avatars do, who asked for which track, and their votes to skip the one that
// is playing.
//
// All of it lives in the memory of one server instance: nothing to install, and
// it starts empty again after a restart. `npm start` is a single instance; a
// hosted deployment that spreads visitors over several instances under-counts.

import { createHash } from 'node:crypto';

// Pages poll every 15 s: a browser that missed two polls in a row has left.
const PRESENT_MS = 40_000;
// Right after a skip Spotify may still report the old track: no new vote on it.
const SETTLE_MS = 10_000;

// Every person is drawn on the page: beyond this many, the most recent are shown.
const SHOWN = 30;
const NAME_MAX = 16;
// More than the page offers: it picks a colour or a shape with a modulo.
const CHOICES = 32;
// From this number on, a choice is reserved to those who hold a code.
const RESERVED = 100;

// What an avatar can do for the others to see, by kind. The page builds its
// buttons from the first four lists; the last one is what the server reports
// by itself when someone votes to skip, adds a track or moves the volume.
export const REACTIONS = ['🔥', '❤️', '😂', '👏', '💃', '🤘', '😴', '👎'];
export const SAYINGS = ['Encore !', 'Banger !', 'Bof…', 'Monte le son !', 'Moins fort !', 'Merci DJ !'];
export const GIFTS = ['👏', '❤️'];
export const MOVES = ['spin', 'jump', 'wave'];
const DEEDS = ['skip', 'add', 'quieter', 'louder'];
const KINDS = { emoji: REACTIONS, say: SAYINGS, gift: GIFTS, move: MOVES, did: DEEDS };
// What an avatar did is handed out for longer than a page waits between two
// polls, so that every page gets it once; each page then plays it.
const ACT_MS = 20_000;
const ACTS_KEPT = 5;

// A queued track plays within that time, or the request is forgotten.
const REQUEST_MS = 12 * 60 * 60_000;

const lastSeen = new Map(); // visitor id -> time of its last poll, oldest first
const avatars = new Map(); // visitor id -> the avatar that browser chose
const acts = new Map(); // visitor id -> [{ at, kind, value, to }]: what their avatar did lately
const requests = new Map(); // track uri -> { id, at, avatar }: who asked for it last
const played = new Set(); // "uri@at": requests whose track has come and gone
let onAir = null; // the request whose track is playing: { uri, at }
let ballot = { uri: null, voters: new Set() };
let skipped = { uri: null, at: 0 };

/** Records that this visitor has the page open. */
export function markPresent(id, now = Date.now()) {
  if (!id) return;
  lastSeen.delete(id);
  lastSeen.set(id, now);
}

/** How many browsers have the page open. */
export function presentCount(now = Date.now()) {
  for (const [id, at] of lastSeen) {
    if (now - at < PRESENT_MS) break;
    lastSeen.delete(id);
    avatars.delete(id);
    acts.delete(id);
  }
  return lastSeen.size;
}

/**
 * What a browser sent as its avatar, made safe to hand to the others:
 * { name, style, color, body, extra }, or null when it is not an avatar at
 * all. The reserved choices are kept for a visitor who is `vip`, and fall
 * back to the first choice for anyone else.
 */
export function cleanAvatar(value, vip = false) {
  if (!value || typeof value !== 'object') return null;
  const open = (n) => n >= 0 && n < CHOICES;
  const reserved = (n) => vip && n >= RESERVED && n < RESERVED + CHOICES;
  const pick = (n) => (Number.isInteger(n) && (open(n) || reserved(n)) ? n : 0);
  const typed = typeof value.name === 'string' ? value.name : '';
  // One line of plain text: no control characters, nothing that reverses the reading order.
  const plain = typed
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(/[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu, '')
    .trim();
  return {
    name: [...plain].slice(0, NAME_MAX).join('').trim(),
    style: pick(value.style),
    color: pick(value.color),
    body: pick(value.body),
    extra: pick(value.extra),
  };
}

/** Remembers the avatar of a visitor for as long as they stay. */
export function wear(id, avatar) {
  if (id && avatar && lastSeen.has(id)) avatars.set(id, avatar);
}

/** Tells people apart from one poll to the next, without giving their id away. */
function keyOf(id) {
  return createHash('sha256').update(id).digest('base64url').slice(0, 10);
}

/**
 * Makes the avatar of a visitor do something for all to see: `kind` and
 * `value` are an entry of KINDS, and a gift goes `to` the key of someone else
 * present. False when that is not something an avatar does, or when the
 * visitor does not have the page open.
 */
export function act(id, kind, value, { to, now = Date.now() } = {}) {
  if (!lastSeen.has(id) || !Object.hasOwn(KINDS, kind) || !KINDS[kind].includes(value)) return false;
  if (kind === 'gift' && ![...lastSeen.keys()].some((other) => other !== id && keyOf(other) === to)) return false;
  const recent = (acts.get(id) ?? []).filter((done) => now - done.at < ACT_MS);
  // `at` tells one from the next, so it never repeats for the same visitor.
  const at = Math.max(now, (recent.at(-1)?.at ?? 0) + 1);
  recent.push(kind === 'gift' ? { at, kind, value, to } : { at, kind, value });
  acts.set(id, recent.slice(-ACTS_KEPT));
  return true;
}

/**
 * Learns which tracks a visitor asked for: `asked` is [{ uri, at }], as their
 * browser holds it. Their avatar is kept along, for when they have left.
 */
export function noteRequests(id, asked, now = Date.now()) {
  if (!id) return;
  for (const { uri, at } of asked) {
    if (!(at <= now && now - at < REQUEST_MS) || played.has(`${uri}@${at}`)) continue;
    const known = requests.get(uri);
    if (known && at < known.at) continue;
    // Heard of for the first time, and just made: their avatar shows it.
    if (known?.at !== at && now - at < ACT_MS) act(id, 'did', 'add', { now });
    requests.set(uri, { id, at, avatar: avatars.get(id) ?? null });
  }
}

/**
 * Who asked for a track, as visitor `selfId` gets it: { key, name, you, avatar },
 * or null when nobody here did. `avatar` is null for someone who has not chosen one.
 */
export function whoAsked(uri, selfId, now = Date.now()) {
  const asked = uri ? requests.get(uri) : null;
  if (!asked || now - asked.at >= REQUEST_MS) return null;
  return { key: keyOf(asked.id), name: asked.avatar?.name ?? '', you: asked.id === selfId, avatar: asked.avatar };
}

/**
 * Who asked for the track that is playing: the same as whoAsked, with one
 * more rule. A request is for one play: once the track has gone by, the same
 * track coming back is nobody's.
 */
export function requesterOf(uri, selfId, now = Date.now()) {
  if (onAir && onAir.uri !== uri) {
    if (played.size > 500) played.clear();
    played.add(`${onAir.uri}@${onAir.at}`);
    if (requests.get(onAir.uri)?.at === onAir.at) requests.delete(onAir.uri);
    onAir = null;
  }
  const asked = whoAsked(uri, selfId, now);
  if (asked) onAir = { uri, at: requests.get(uri).at };
  return asked;
}

/**
 * The people to draw, as visitor `selfId` gets them: { key, you, avatar, acts }.
 * `key` tells them apart from one poll to the next without giving their id
 * away; `avatar` is null for someone who has not chosen one; `acts` is what
 * their avatar did lately, oldest first: [{ at, kind, value, to }].
 */
export function presentPeople(selfId, now = Date.now()) {
  presentCount(now);
  for (const [id, done] of acts) {
    const recent = done.filter((one) => now - one.at < ACT_MS);
    if (recent.length) acts.set(id, recent);
    else acts.delete(id);
  }
  return [...lastSeen.keys()].slice(-SHOWN).map((id) => ({
    key: keyOf(id),
    you: id === selfId,
    avatar: avatars.get(id) ?? null,
    acts: acts.get(id) ?? [],
  }));
}

/**
 * Where the vote to skip `uri` stands, seen by visitor `id`: { votes, needed, voted }.
 * Null when there is nothing to vote on. A track is skipped once more than half
 * of the people present have voted; the vote of someone who left stops counting.
 */
export function skipTally(uri, id, now = Date.now()) {
  if (!uri || (skipped.uri === uri && now - skipped.at < SETTLE_MS)) return null;
  // Another track is playing: the previous votes were not about it.
  if (ballot.uri !== uri) ballot = { uri, voters: new Set() };
  const present = presentCount(now);
  let votes = 0;
  for (const voter of ballot.voters) if (lastSeen.has(voter)) votes += 1;
  return { votes, needed: Math.floor(present / 2) + 1, voted: ballot.voters.has(id) };
}

/** Adds this visitor's vote (one per track) and returns the new tally. */
export function voteToSkip(uri, id, now = Date.now()) {
  if (!skipTally(uri, id, now)) return null;
  ballot.voters.add(id);
  return skipTally(uri, id, now);
}

/** Call right before asking Spotify to skip `uri`, so that it is skipped only once. */
export function closeVote(uri, now = Date.now()) {
  skipped = { uri, at: now };
  ballot = { uri: null, voters: new Set() };
}

/** Spotify did not skip after all: the track can be voted on again. */
export function reopenVote() {
  skipped = { uri: null, at: 0 };
}

/** Empties the room. Tests start from here. */
export function resetRoom() {
  lastSeen.clear();
  avatars.clear();
  acts.clear();
  requests.clear();
  played.clear();
  onAir = null;
  reopenVote();
  ballot = { uri: null, voters: new Set() };
}
