// Where each character stands, the same on every screen.
//
// A character's walk is worked out from its key and the time, the same way
// on every screen, and the time is the server's: so everyone sees it at the
// same spot at the same moment, without anything more being sent. Spots are
// shares of the floor, from 0 to 1, so that a phone and a wide screen agree.
//
// Time is cut into legs. In each one a character waits a while, then walks to
// a new spot not far from the last. The part of the floor it keeps to drifts
// slowly, so that in the end it goes everywhere.

export const LEG_MS = 8000;
const SPEED = 45 / 900; // shares of the floor per second: 45 pixels a second on a floor 900 pixels wide
const HOME_LEGS = 12; // the part of the floor a character keeps to drifts over this many legs
const WANDER = 0.15; // how far from that part it goes, as a share of the floor
const SHORTEST_MS = 500;

/** A number in [0, 1) drawn from its arguments: the same on every screen. */
export function draw(...parts) {
  let h = 2166136261;
  for (const char of parts.join('|')) h = Math.imul(h ^ char.codePointAt(0), 16777619);
  // FNV leaves the last bits weak: these few steps mix them in.
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
}

/** Where leg `n` of a character ends: { x, y }, as shares of the floor. */
function stop(key, n) {
  const m = Math.floor(n / HOME_LEGS);
  const along = (n - m * HOME_LEGS) / HOME_LEGS;
  const home = draw(key, 'home', m) * (1 - along) + draw(key, 'home', m + 1) * along;
  return {
    x: WANDER + home * (1 - 2 * WANDER) + (draw(key, 'x', n) * 2 - 1) * WANDER,
    y: draw(key, 'y', n),
  };
}

/**
 * The leg a character is on at `now`, a time on the server's clock in ms:
 * it waits at `from` until `start`, walks to `to` until `end`, and waits
 * there until `next`, when its next leg begins.
 */
export function legAt(key, now) {
  const shift = draw(key, 'shift') * LEG_MS; // so that they do not all set off together
  const n = Math.floor((now + shift) / LEG_MS);
  const begins = n * LEG_MS - shift;
  const from = stop(key, n - 1);
  const to = stop(key, n);
  const walk = Math.min(LEG_MS - SHORTEST_MS, Math.max(SHORTEST_MS, (Math.abs(to.x - from.x) / SPEED) * 1000));
  const start = begins + draw(key, 'wait', n) * (LEG_MS - walk);
  return { from, to, start, end: start + walk, next: begins + LEG_MS };
}

/** Where a character is at `now`: { x, y }, as shares of the floor. */
export function spotAt(key, now) {
  const { from, to, start, end } = legAt(key, now);
  const done = Math.min(1, Math.max(0, (now - start) / (end - start)));
  return { x: from.x + (to.x - from.x) * done, y: from.y + (to.y - from.y) * done };
}
