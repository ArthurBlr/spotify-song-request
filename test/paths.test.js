import assert from 'node:assert/strict';
import { test } from 'node:test';

import { draw, LEG_MS, legAt, spotAt } from '../public/paths.js';

const KEYS = ['aB3-x_9QzT', 'Zz00000000', 'k', 'ÉtéEmoji🔥'];
const START = Date.UTC(2026, 10, 27, 14);

test('a character is at the same spot for everyone at the same moment', () => {
  for (const key of KEYS) {
    assert.deepEqual(spotAt(key, START + 1234), spotAt(String(key), START + 1234));
  }
  assert.notDeepEqual(spotAt(KEYS[0], START), spotAt(KEYS[1], START));
});

test('draws are spread over [0, 1)', () => {
  const values = Array.from({ length: 2000 }, (_, i) => draw('key', i));
  assert.ok(values.every((v) => v >= 0 && v < 1));
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  assert.ok(Math.abs(mean - 0.5) < 0.03, `mean ${mean}`);
});

test('a character stays on the floor and never jumps', () => {
  for (const key of KEYS) {
    let last = spotAt(key, START);
    for (let t = START; t < START + 30 * LEG_MS; t += 100) {
      const here = spotAt(key, t);
      assert.ok(here.x >= 0 && here.x <= 1 && here.y >= 0 && here.y <= 1, `${key} off the floor at ${t}`);
      // 100 ms at the walking pace covers 0.005 of the floor; a jump would be far more.
      assert.ok(Math.abs(here.x - last.x) < 0.02, `${key} jumped at ${t}`);
      last = here;
    }
  }
});

test('each leg waits, walks, then waits until the next one, which starts where it ended', () => {
  for (const key of KEYS) {
    for (let t = START; t < START + 20 * LEG_MS; t += LEG_MS / 3) {
      const leg = legAt(key, t);
      assert.ok(leg.start <= leg.end && leg.end <= leg.next, `${key} at ${t}`);
      assert.ok(leg.next - leg.start <= LEG_MS);
      assert.deepEqual(legAt(key, leg.next).from, leg.to);
    }
  }
});

test('over a while, a character goes all over the floor', () => {
  const seen = new Set();
  for (let t = START; t < START + 3600_000; t += LEG_MS) seen.add(Math.floor(spotAt(KEYS[0], t).x * 5));
  assert.equal(seen.size, 5);
});
