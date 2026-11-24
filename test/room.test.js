import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  cleanAvatar,
  closeVote,
  markPresent,
  presentCount,
  presentPeople,
  react,
  resetRoom,
  skipTally,
  voteToSkip,
  wear,
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

test('a reaction is handed out long enough for every page to get it, then dropped', () => {
  markPresent('a', 0);
  markPresent('b', 0);
  assert.equal(react('a', '🔥', 1_000), true);
  assert.equal(react('a', '<script>', 1_000), false);
  assert.equal(react('nobody', '🔥', 1_000), false);

  const said = (now) => presentPeople('b', now).find((person) => !person.you).reaction;
  assert.deepEqual(said(2_000), { emoji: '🔥', at: 1_000 });
  // A page polls every 15 seconds at its slowest.
  assert.deepEqual(said(17_000), { emoji: '🔥', at: 1_000 });
  assert.equal(said(21_000), null);

  assert.equal(react('a', '👏', 22_000), true);
  assert.deepEqual(said(23_000), { emoji: '👏', at: 22_000 });

  // Gone with the person who made it.
  markPresent('b', 60_000);
  markPresent('a', 61_000);
  assert.equal(said(61_000), null);
});
