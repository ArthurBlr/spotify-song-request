import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { closeVote, markPresent, presentCount, resetRoom, skipTally, voteToSkip } from '../lib/room.js';

beforeEach(resetRoom);

test('a browser that stopped polling is no longer present', () => {
  markPresent('a', 0);
  markPresent('b', 10_000);
  assert.equal(presentCount(30_000), 2);
  assert.equal(presentCount(45_000), 1);
  markPresent('a', 46_000);
  assert.equal(presentCount(46_000), 2);
});

test('a skip needs more than half of the people present', () => {
  for (const [people, needed] of [[1, 1], [2, 2], [3, 2], [4, 3], [5, 3], [10, 6]]) {
    resetRoom();
    for (let i = 0; i < people; i += 1) markPresent(`v${i}`, 0);
    assert.equal(skipTally('track', 'v0', 0).needed, needed, `${people} present`);
  }
});

test('the vote of someone who left stops counting', () => {
  for (const id of ['a', 'b', 'c']) markPresent(id, 0);
  assert.deepEqual(voteToSkip('track', 'a', 0), { votes: 1, needed: 2, voted: true });

  markPresent('b', 30_000);
  markPresent('c', 30_000);
  assert.deepEqual(skipTally('track', 'b', 45_000), { votes: 0, needed: 2, voted: false });

  // Back on the page: the vote counts again.
  markPresent('a', 50_000);
  assert.equal(skipTally('track', 'b', 50_000).votes, 1);
});

test('votes do not carry over to the next track', () => {
  markPresent('a', 0);
  markPresent('b', 0);
  voteToSkip('first', 'a', 0);
  assert.deepEqual(skipTally('second', 'a', 1_000), { votes: 0, needed: 2, voted: false });
});

test('a track that was just skipped cannot be voted on for a moment', () => {
  markPresent('a', 0);
  closeVote('track', 0);
  assert.equal(skipTally('track', 'a', 5_000), null);
  assert.equal(voteToSkip('track', 'a', 5_000), null);
  assert.deepEqual(voteToSkip('track', 'a', 11_000), { votes: 1, needed: 1, voted: true });
  assert.equal(skipTally(null, 'a', 11_000), null);
});
