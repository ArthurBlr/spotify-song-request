import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  act,
  cleanAvatar,
  closeVote,
  markPresent,
  noteRequests,
  presentCount,
  presentPeople,
  requesterOf,
  resetRoom,
  skipTally,
  voteToSkip,
  wear,
  whoAsked,
} from '../lib/room.js';

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

test('an avatar is a short name and three choices, whatever was sent', () => {
  assert.deepEqual(cleanAvatar({ name: 'Zoé', style: 1, color: 7, body: 4, extra: 6 }), {
    name: 'Zoé',
    style: 1,
    color: 7,
    body: 4,
    extra: 6,
  });
  assert.equal(cleanAvatar({ name: ' à  la\tligne\n' }).name, 'à la ligne');
  // Sixteen characters as people count them, an emoji being one.
  assert.equal(cleanAvatar({ name: '🎧'.repeat(20) }).name, '🎧'.repeat(16));
  // Nothing that could reverse the reading order of what follows.
  assert.equal(cleanAvatar({ name: 'abc\u202Edef' }).name, 'abcdef');
  assert.deepEqual(cleanAvatar({ name: 42, color: 1.5, body: 32, extra: '3' }), {
    name: '',
    style: 0,
    color: 0,
    body: 0,
    extra: 0,
  });
  for (const junk of [null, undefined, 'text', 7]) assert.equal(cleanAvatar(junk), null);

  // From 100 on, a choice is reserved: kept for a visitor who holds a code, dropped for the others.
  const special = { name: '', style: 0, color: 101, body: 100, extra: 131 };
  assert.deepEqual(cleanAvatar(special, true), special);
  assert.deepEqual(cleanAvatar(special), { name: '', style: 0, color: 0, body: 0, extra: 0 });
  assert.equal(cleanAvatar({ color: 132 }, true).color, 0);
  assert.equal(cleanAvatar({ color: 50 }, true).color, 0);
});

test('people are listed with their avatar for as long as they stay', () => {
  const look = cleanAvatar({ name: 'A', color: 1 });
  markPresent('a', 0);
  wear('a', look);
  markPresent('b', 10_000);
  wear('gone', look); // not on the page: nothing to remember

  const people = presentPeople('b', 20_000);
  assert.deepEqual(
    people.map(({ you, avatar }) => ({ you, avatar })),
    [
      { you: false, avatar: look },
      { you: true, avatar: null },
    ],
  );
  assert.notEqual(people[0].key, people[1].key);
  assert.equal(presentPeople('b', 21_000)[0].key, people[0].key);

  // "a" stopped polling: gone from the list, and their avatar with them.
  assert.equal(presentPeople('b', 45_000).length, 1);
  markPresent('a', 46_000);
  assert.equal(presentPeople('b', 46_000).find((person) => !person.you).avatar, null);
});

test('no more than thirty people are drawn, the latest ones', () => {
  for (let i = 0; i < 35; i += 1) markPresent(`v${i}`, i);
  const people = presentPeople('v34', 100);
  assert.equal(people.length, 30);
  assert.equal(people.at(-1).you, true);
  assert.equal(presentCount(100), 35);
});

test('what an avatar did is handed out long enough for every page to get it, then dropped', () => {
  markPresent('a', 0);
  markPresent('b', 0);
  assert.equal(act('a', 'emoji', '🔥', { now: 1_000 }), true);
  assert.equal(act('a', 'emoji', '<script>', { now: 1_000 }), false);
  assert.equal(act('a', 'constructor', 'name', { now: 1_000 }), false);
  assert.equal(act('nobody', 'emoji', '🔥', { now: 1_000 }), false);

  const done = (now) => presentPeople('b', now).find((person) => !person.you).acts;
  assert.deepEqual(done(2_000), [{ at: 1_000, kind: 'emoji', value: '🔥' }]);
  // A page polls every 15 seconds at its slowest.
  assert.equal(done(17_000).length, 1);
  assert.deepEqual(done(21_000), []);

  // Several in a row are all kept, in order, each with its own time.
  act('a', 'emoji', '👏', { now: 22_000 });
  act('a', 'move', 'spin', { now: 22_000 });
  act('a', 'say', 'Encore !', { now: 22_000 });
  assert.deepEqual(done(23_000), [
    { at: 22_000, kind: 'emoji', value: '👏' },
    { at: 22_001, kind: 'move', value: 'spin' },
    { at: 22_002, kind: 'say', value: 'Encore !' },
  ]);

  // No more than five are kept: the oldest go first.
  for (let i = 0; i < 6; i += 1) act('a', 'emoji', '🔥', { now: 30_000 + i });
  assert.equal(done(30_010).length, 5);

  // Gone with the person who did them.
  markPresent('b', 60_000);
  markPresent('a', 71_000);
  assert.deepEqual(done(71_000), []);
});

test('a gift goes to someone else who is here', () => {
  markPresent('a', 0);
  markPresent('b', 0);
  const [a, b] = presentPeople('b', 0);
  assert.equal(act('a', 'gift', '👏', { to: b.key, now: 1_000 }), true);
  assert.deepEqual(presentPeople('b', 2_000)[0].acts, [{ at: 1_000, kind: 'gift', value: '👏', to: b.key }]);
  assert.equal(act('a', 'gift', '👏', { to: a.key, now: 1_000 }), false);
  assert.equal(act('a', 'gift', '👏', { to: 'elsewhere', now: 1_000 }), false);
  assert.equal(act('a', 'gift', '🔥', { to: b.key, now: 1_000 }), false);
});

test('whoever asked for a track is named while it plays, even after leaving', () => {
  const HOUR = 60 * 60_000;
  markPresent('a', 0);
  wear('a', cleanAvatar({ name: 'Ada' }));
  markPresent('b', 0);
  noteRequests('a', [{ uri: 'x', at: 1_000 }], 2_000);

  assert.equal(requesterOf('other', 'b', 3_000), null);
  // While it waits in the queue, and then while it plays.
  assert.equal(whoAsked('x', 'b', 3_000).name, 'Ada');
  const asked = requesterOf('x', 'b', 4_000);
  assert.deepEqual(asked, { key: asked.key, name: 'Ada', you: false, avatar: cleanAvatar({ name: 'Ada' }) });
  assert.equal(asked.key, presentPeople('b', 4_000)[0].key);
  assert.equal(requesterOf('x', 'a', 4_000).you, true);

  // "a" is gone from the page: the name was kept with the request.
  markPresent('b', 50_000);
  assert.equal(presentPeople('b', 50_000).length, 1);
  assert.equal(requesterOf('x', 'b', 50_000).name, 'Ada');

  // One play only, even though the browser of "a" still lists the request.
  assert.equal(requesterOf('y', 'b', 60_000), null);
  markPresent('a', 61_000);
  noteRequests('a', [{ uri: 'x', at: 1_000 }], 61_000);
  assert.equal(whoAsked('x', 'b', 62_000), null);
  assert.equal(requesterOf('x', 'b', 62_000), null);

  // A later request for the same track counts again, and the latest one wins.
  requesterOf('y', 'b', 63_000);
  noteRequests('a', [{ uri: 'x', at: 70_000 }], 71_000);
  noteRequests('b', [{ uri: 'x', at: 80_000 }], 81_000);
  noteRequests('a', [{ uri: 'x', at: 70_000 }], 82_000);
  assert.equal(requesterOf('x', 'b', 83_000).you, true);

  // Too old, or dated in the future: ignored.
  requesterOf('y', 'b', 84_000);
  noteRequests('a', [{ uri: 'z', at: 90_000 }], 90_000 + 13 * HOUR);
  noteRequests('a', [{ uri: 'w', at: 200_000 }], 100_000);
  assert.equal(requesterOf('z', 'b', 90_000 + 13 * HOUR), null);
  assert.equal(requesterOf('w', 'b', 100_000), null);
});
