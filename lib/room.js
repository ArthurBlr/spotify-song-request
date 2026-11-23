// Who has the page open right now, and their votes to skip the track that is playing.
//
// All of it lives in the memory of one server instance: nothing to install, and
// it starts empty again after a restart. `npm start` is a single instance; a
// hosted deployment that spreads visitors over several instances under-counts.

// Pages poll every 15 s: a browser that missed two polls in a row has left.
const PRESENT_MS = 40_000;
// Right after a skip Spotify may still report the old track: no new vote on it.
const SETTLE_MS = 10_000;

const lastSeen = new Map(); // visitor id -> time of its last poll, oldest first
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
  }
  return lastSeen.size;
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
  reopenVote();
  ballot = { uri: null, voters: new Set() };
}
