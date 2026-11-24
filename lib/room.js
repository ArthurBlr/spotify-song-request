// Who has the page open right now, the avatar each of them chose, their
// reactions, and their votes to skip the track that is playing.
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

/** What an avatar can say in a bubble. The page builds its buttons from this list. */
export const REACTIONS = ['🔥', '❤️', '😂', '👏', '💃', '🤘', '😴', '👎'];
// A reaction is handed out for longer than a page waits between two polls, so
// that every page gets it once; each page then shows it for a few seconds.
const REACTION_MS = 20_000;

const lastSeen = new Map(); // visitor id -> time of its last poll, oldest first
const avatars = new Map(); // visitor id -> the avatar that browser chose
const reactions = new Map(); // visitor id -> { emoji, at }: their latest reaction
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
    reactions.delete(id);
  }
  return lastSeen.size;
}

/**
 * What a browser sent as its avatar, made safe to hand to the others:
 * { name, style, color, body, extra }, or null when it is not an avatar at all.
 */
export function cleanAvatar(value) {
  if (!value || typeof value !== 'object') return null;
  const pick = (n) => (Number.isInteger(n) && n >= 0 && n < CHOICES ? n : 0);
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

/**
 * Makes the avatar of a visitor say `emoji`. False when it is not one of
 * REACTIONS, or when the visitor does not have the page open.
 */
export function react(id, emoji, now = Date.now()) {
  if (!lastSeen.has(id) || !REACTIONS.includes(emoji)) return false;
  reactions.set(id, { emoji, at: now });
  return true;
}

/**
 * The people to draw, as visitor `selfId` gets them: { key, you, avatar, reaction }.
 * `key` tells them apart from one poll to the next without giving their id
 * away; `avatar` is null for someone who has not chosen one; `reaction` is
 * { emoji, at } for a recent one, `at` telling it from the one before.
 */
export function presentPeople(selfId, now = Date.now()) {
  presentCount(now);
  for (const [id, reaction] of reactions) {
    if (now - reaction.at >= REACTION_MS) reactions.delete(id);
  }
  return [...lastSeen.keys()].slice(-SHOWN).map((id) => ({
    key: createHash('sha256').update(id).digest('base64url').slice(0, 10),
    you: id === selfId,
    avatar: avatars.get(id) ?? null,
    reaction: reactions.get(id) ?? null,
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
  reactions.clear();
  reopenVote();
  ballot = { uri: null, voters: new Set() };
}
