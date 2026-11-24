import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nextVolume } from '../lib/volume.js';

const cfg = { volumeMin: 10, volumeMax: 50 };

test('one step at a time, stopping at the limits', () => {
  const cases = [
    [40, 'down', 30],
    [40, 'up', 50],
    [47, 'up', 50],
    [50, 'up', null],
    [14, 'down', 10],
    [10, 'down', null],
  ];
  for (const [from, direction, to] of cases) {
    assert.equal(nextVolume(from, direction, cfg), to, `${from} ${direction}`);
  }
});

test('a volume the owner set outside the limits only comes back towards them', () => {
  assert.equal(nextVolume(80, 'up', cfg), null);
  assert.equal(nextVolume(80, 'down', cfg), 70);
  assert.equal(nextVolume(0, 'down', cfg), null);
  assert.equal(nextVolume(0, 'up', cfg), 10);
});
