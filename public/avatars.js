// Everyone who has the page open gets a small character that strolls along the
// bottom of the screen. It shows what its owner does: emojis float up from
// it, it dances, says a few words, and sends gifts to the others. Each browser
// chooses its own: the choice is kept in this browser and sent with every
// poll, so the server only passes it on.
//
// A look is { name, style, color, body, extra }: a typed name and four numbers
// that point into the lists below. Each body and each accessory is drawn
// twice, once per style: as glowing outlines, and as pixels.

/** Turns a drawing made of lines of characters into its rows. */
const grid = (text) => text.trim().split(/\s+/);

const COLORS = [
  { name: 'Rose', value: '#ff4fa3' },
  { name: 'Cyan', value: '#3df0e0' },
  { name: 'Jaune', value: '#ffe066' },
  { name: 'Orange', value: '#ff8a5c' },
  { name: 'Violet', value: '#a98bff' },
  { name: 'Vert', value: '#7dff8a' },
  { name: 'Bleu', value: '#5cb8ff' },
  { name: 'Blanc', value: '#f5f1ff' },
];

// Outlines are drawn in a box of 48 by 56, feet on the ground at y = 54; `top`
// is where the head ends, for what sits on it.
// Pixels are a grid of 12 by 14: # is the body, o a hole for an eye or the
// mouth. `top` and `eye` are the rows where the head and the eyes start.
const BODIES = [
  {
    name: 'Rond',
    top: 14,
    feet: true,
    shape: '<rect x="8" y="14" width="32" height="34" rx="16"/>',
    pixels: {
      top: 3,
      eye: 6,
      rows: grid(`
        ............
        ............
        ............
        ...######...
        ..########..
        .##########.
        .##o####o##.
        .##o####o##.
        .##########.
        .###o##o###.
        ..###oo###..
        ...######...
        ..##....##..
        ..##....##..`),
    },
  },
  {
    name: 'Robot',
    top: 16,
    feet: true,
    shape: '<rect x="8" y="16" width="32" height="32" rx="7"/>',
    pixels: {
      top: 3,
      eye: 5,
      rows: grid(`
        ............
        ............
        ............
        .##########.
        .##########.
        .#oo####oo#.
        .#oo####oo#.
        .##########.
        .##########.
        .##oooooo##.
        .##########.
        .##########.
        ..##....##..
        ..##....##..`),
    },
  },
  {
    name: 'Fantôme',
    top: 12,
    feet: false,
    shape: '<path d="M8 50V28a16 16 0 0 1 32 0v22l-5.3-5-5.4 5-5.3-5-5.3 5-5.4-5z"/>',
    pixels: {
      top: 2,
      eye: 5,
      rows: grid(`
        ............
        ............
        ....####....
        ..########..
        .##########.
        .##o####o##.
        .##o####o##.
        .##########.
        .##########.
        .####oo####.
        .##########.
        .##########.
        .##.####.##.
        .#...##...#.`),
    },
  },
  {
    name: 'Chat',
    top: 16,
    feet: true,
    shape: '<path d="M8 30v-8l3-14 10 8h6l10-8 3 14v13a13 13 0 0 1-13 13h-6a13 13 0 0 1-13-13z"/>',
    pixels: {
      top: 4,
      eye: 6,
      rows: grid(`
        ............
        ............
        .#........#.
        .##......##.
        .##########.
        .##########.
        .##o####o##.
        .##o####o##.
        .##########.
        .####oo####.
        .##########.
        ..########..
        ..##....##..
        ..##....##..`),
    },
  },
  {
    name: 'Ours',
    top: 15,
    feet: true,
    shape:
      '<circle cx="13" cy="16" r="5.5"/><circle cx="35" cy="16" r="5.5"/><rect x="8" y="15" width="32" height="33" rx="14"/>',
    pixels: {
      top: 4,
      eye: 6,
      rows: grid(`
        ............
        ............
        .##......##.
        .###....###.
        ..########..
        .##########.
        .##o####o##.
        .##o####o##.
        .##########.
        .###oooo###.
        .####oo####.
        ..########..
        ..##....##..
        ..##....##..`),
    },
  },
];

// Outlines are drawn for a head that ends at y = 14; `onHead` ones are moved
// to fit each body.
// Pixels are drawn for a head that starts at row 3 and eyes at row 6, from row
// `from` down, and follow the `anchor`. w is white, y gold, k black, c the
// colour of the body.
const EXTRAS = [
  { name: 'Rien', onHead: false, shape: '', pixels: { anchor: '', from: 0, rows: [] } },
  {
    name: 'Casque audio',
    onHead: true,
    shape:
      '<path class="line band" d="M8 31v-5a16 16 0 0 1 32 0v5"/><rect class="solid" x="3" y="27" width="7" height="11" rx="3"/><rect class="solid" x="38" y="27" width="7" height="11" rx="3"/>',
    pixels: {
      anchor: 'top',
      from: 2,
      rows: grid(`
        ..wwwwwwww..
        ............
        ............
        c..........c
        c..........c
        c..........c`),
    },
  },
  {
    name: 'Lunettes noires',
    onHead: false,
    shape:
      '<path class="shade" d="M11 26h11v5a3 3 0 0 1-3 3h-5a3 3 0 0 1-3-3zM26 26h11v5a3 3 0 0 1-3 3h-5a3 3 0 0 1-3-3z"/><path class="line band" d="M22 27.5h4"/>',
    pixels: {
      anchor: 'eye',
      from: 6,
      rows: grid(`
        .kkkkkkkkkk.
        ..kkk..kkk..`),
    },
  },
  {
    name: 'Chapeau',
    onHead: true,
    shape: '<path class="body" d="M16 14V4h16v10"/><path class="line" d="M10 14h28"/>',
    pixels: {
      anchor: 'top',
      from: 0,
      rows: grid(`
        ...wwwwww...
        ...wwwwww...
        .wwwwwwwwww.`),
    },
  },
  {
    name: 'Couronne',
    onHead: true,
    shape: '<path class="gold" d="M14 15V5l5.5 5L24 3l4.5 7L34 5v10z"/>',
    pixels: {
      anchor: 'top',
      from: 0,
      rows: grid(`
        ..y.y..y.y..
        ..yyyyyyyy..
        ..yyyyyyyy..`),
    },
  },
  {
    name: 'Antennes',
    onHead: true,
    shape:
      '<path class="line" d="M18 15l-3-9M30 15l3-9"/><circle class="solid" cx="15" cy="5" r="2.6"/><circle class="solid" cx="33" cy="5" r="2.6"/>',
    pixels: {
      anchor: 'top',
      from: 0,
      rows: grid(`
        ..c......c..
        ...c....c...
        ...c....c...`),
    },
  },
  {
    name: 'Nœud papillon',
    onHead: false,
    shape: '<path class="solid" d="M24 43.5l-7-4v8zM24 43.5l7-4v8z"/>',
    pixels: { anchor: '', from: 11, rows: grid('...wwkkww...') },
  },
];

const FEET =
  '<rect class="foot foot-l" x="13" y="46" width="9" height="8" rx="3.5"/><rect class="foot foot-r" x="26" y="46" width="9" height="8" rx="3.5"/>';
const FACE =
  '<g class="eyes"><ellipse cx="18" cy="30" rx="2.6" ry="3.4"/><ellipse cx="30" cy="30" rx="2.6" ry="3.4"/></g><path class="line" d="M20 38q4 3.5 8 0"/>';

function neonDrawing(look) {
  const body = entry('body', look.body);
  const extra = entry('extra', look.extra);
  const lift = extra.onHead ? body.top - 14 : 0;
  return (
    `<svg class="sprite" viewBox="0 0 48 56" aria-hidden="true">${body.feet ? FEET : ''}` +
    `<g class="body">${body.shape}</g>${FACE}<g transform="translate(0 ${lift})">${extra.shape}</g></svg>`
  );
}

// Which paint each character of a pixel drawing stands for. The paints are
// laid one over the other in this order.
const PAINTS = { '#': 'px-body', c: 'px-body', o: 'px-dark', k: 'px-dark', w: 'px-white', y: 'px-gold' };

function pixelDrawing(look) {
  const body = entry('body', look.body).pixels;
  const extra = entry('extra', look.extra).pixels;
  const shift = extra.anchor ? body[extra.anchor] - (extra.anchor === 'top' ? 3 : 6) : 0;
  const paths = { 'px-body': '', 'px-dark': '', 'px-white': '', 'px-gold': '' };
  const draw = (rows, from, left = 0) => {
    rows.forEach((line, row) => {
      [...line].forEach((mark, column) => {
        if (PAINTS[mark]) paths[PAINTS[mark]] += `M${(left + column) * 4} ${(from + row) * 4}h4v4h-4z`;
      });
    });
  };
  draw(body.rows, 0);
  draw(extra.rows, extra.from + shift, extra.left);
  const painted = Object.entries(paths)
    .map(([paint, d]) => (d ? `<path class="${paint}" d="${d}"/>` : ''))
    .join('');
  return `<svg class="sprite pixel" viewBox="0 0 48 56" shape-rendering="crispEdges" aria-hidden="true">${painted}</svg>`;
}

const STYLES = [
  { name: 'Néon', draw: neonDrawing },
  { name: 'Pixel', draw: pixelDrawing },
];

const NAME_MAX = 16;
const STORE_KEY = 'sr_avatar';
const LISTS = { style: STYLES, color: COLORS, body: BODIES, extra: EXTRAS };

// Choices reserved to whoever holds a code: the server only passes them on for
// a visitor it knows as such, so that nobody else can wear them. They are
// numbered from 100 on. A colour can come with an effect, played by the
// style sheet.
const RESERVED = 100;
const RESERVED_LISTS = {
  style: [],
  color: [
    { name: 'Or', value: '#ffd34d', effect: 'gold' },
    { name: 'Arc-en-ciel', value: '#ff4fa3', effect: 'rainbow' },
  ],
  body: [
    {
      name: 'Diablotin',
      top: 14,
      feet: true,
      shape:
        '<path d="M13 21q-6-8 0-15 1 8 7 11zM35 21q6-8 0-15-1 8-7 11z"/><rect x="8" y="14" width="32" height="34" rx="16"/>',
      pixels: {
        top: 3,
        eye: 6,
        rows: grid(`
          ............
          .#........#.
          .##......##.
          ..########..
          ..########..
          .##########.
          .##o####o##.
          .##o####o##.
          .##########.
          .###o##o###.
          ..###oo###..
          ...######...
          ..##....##..
          ..##....##..`),
      },
    },
  ],
  extra: [
    {
      name: 'Auréole',
      onHead: true,
      shape: '<ellipse class="gold" cx="24" cy="6" rx="11" ry="3.5"/>',
      pixels: { anchor: 'top', from: 0, rows: grid('..yyyyyyyy..') },
    },
    {
      name: 'Ailes',
      onHead: false,
      shape:
        '<path class="wing" d="M9 36C1 34-3 24 1 13c5 3 8 9 8 23zM39 36c8-2 12-12 8-23-5 3-8 9-8 23z"/>',
      // Wider than the body: these rows start two squares to its left.
      pixels: {
        anchor: 'eye',
        from: 4,
        left: -2,
        rows: grid(`
          w..............w
          ww............ww
          www..........www
          .ww..........ww.
          ..w..........w..`),
      },
    },
  ],
};

/** What a number stands for in the list of a field: an open choice, or a reserved one. */
function entry(field, n) {
  return (n >= RESERVED ? RESERVED_LISTS[field][n - RESERVED] : LISTS[field][n]) ?? LISTS[field][0];
}

/**
 * The drawing of a look, as SVG markup. It is put together from the constants
 * above only: the name a visitor typed never goes through here.
 */
function drawing(look) {
  return `<span class="skin">${entry('style', look.style).draw(look)}</span>`;
}

/** Gives an element the colour of a look, and the effect that goes with a reserved colour. */
function tint(node, look) {
  const color = entry('color', look.color);
  node.style.color = color.value;
  node.dataset.effect = color.effect ?? '';
}

function cleanName(name) {
  const plain = String(name ?? '').replace(/\s+/g, ' ').trim();
  return [...plain].slice(0, NAME_MAX).join('').trim();
}

/** Brings any look, ours or someone else's, within what this page can draw. */
function tidy(look) {
  const pick = (field) => {
    const n = look[field];
    if (!Number.isInteger(n) || n < 0) return 0;
    if (n >= RESERVED) return RESERVED_LISTS[field][n - RESERVED] ? n : 0;
    return n % LISTS[field].length;
  };
  return { name: cleanName(look.name), style: pick('style'), color: pick('color'), body: pick('body'), extra: pick('extra') };
}

/** The same look without the reserved choices, for a browser that does not hold a code. */
function open(look) {
  const plain = (n) => (n >= RESERVED ? 0 : n);
  return { ...look, style: plain(look.style), color: plain(look.color), body: plain(look.body), extra: plain(look.extra) };
}

/** Someone who has not chosen yet still gets a character, the same on every screen. */
function defaultLook(key) {
  let n = 7;
  for (const char of key) n = (n * 31 + char.charCodeAt(0)) >>> 0;
  return tidy({ name: '', style: n >>> 17, color: n, body: n >>> 5, extra: n >>> 11 });
}

function readSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    return saved && typeof saved === 'object' ? tidy(saved) : null;
  } catch {
    return null;
  }
}

// Null until this browser has chosen.
let mine = readSaved();
let myKey = '';
// Whether the server knows this browser as holding a code for the reserved choices.
let vip = false;
let lastCrowd = { people: [], dancing: false };
// What the page does when a look is saved, when a gift is picked for
// someone, and when one arrives for this browser.
let on = { changed() {}, give() {}, gifted() {} };

/** The header that carries this browser's look with a poll. */
export function avatarHeader() {
  return mine ? { 'x-avatar': encodeURIComponent(JSON.stringify(mine)) } : {};
}

/** This browser's look as the others get it: without the reserved choices unless it holds a code. */
function myLook() {
  const look = mine ?? defaultLook(myKey);
  return vip ? look : open(look);
}

// --- The crowd -----------------------------------------------------------------

const crowd = document.getElementById('crowd');
const button = document.getElementById('avatar-button');
const walkers = new Map(); // person key -> { key, node, tag, figure, look, shown, heard, x, y, timer }
const lessMotion = matchMedia('(prefers-reduced-motion: reduce)');

const SPEED = 45; // pixels per second
const REACH = 420; // longest stroll, in pixels
const DEPTH = 18; // how far up the screen they may wander, in pixels
const ROOM = 44; // width kept for one character
const EDGE = 34; // how far they stay from the sides, so that their name is not cut off
const FLOAT_MS = 4200; // no reaction takes longer than this to float away
const SPEECH_MS = 4000; // how long a few words stay up: the length of their animation
// The dance moves this page knows, and how long each one lasts.
const MOVES = { spin: 900, jump: 800, wave: 1200 };
// What floats up from an avatar when its owner votes to skip, adds a track or moves the volume.
const DEEDS = { skip: ['👎'], add: ['🎵', '🎶', '🎵'], quieter: ['🤫'], louder: ['🔊'] };
// As many people sending a 🔥 within these few seconds make the whole crowd jump.
const HYPE = { people: 3, withinMs: 8000, restMs: 12_000 };
let hypedAt = 0;

/**
 * Draws the people present: [{ key, you, avatar, acts }], `avatar` being a
 * look or null, `acts` what their avatar did lately: [{ at, kind, value, to }].
 * They dance on the spot while `dancing` is true, and the one whose key is
 * `star` is in the spotlight: the track that is playing is theirs. `gifts`
 * are the emojis that can be sent to someone with a click on their character.
 * `holdsCode` is whether the server lets this browser wear the reserved choices.
 * Returns true when someone else's avatar did something lately.
 */
export function renderCrowd(people, { dancing = false, star = '', gifts = [], holdsCode = false } = {}) {
  lastCrowd = { people, dancing, star, gifts, holdsCode };
  crowd.classList.toggle('dancing', dancing);
  vip = holdsCode;
  if (vip) offerReserved();

  let lively = false;
  const present = new Set();
  for (const person of people) {
    present.add(person.key);
    if (person.you) myKey = person.key;
    const known = walkers.get(person.key);
    const walker = known ?? arrive(person.key);
    dress(walker, lookOf(person), person.you);
    walker.node.classList.toggle('star', person.key === star);

    const fresh = person.acts.filter((done) => done.at > walker.heard);
    if (!fresh.length) continue;
    walker.heard = fresh.at(-1).at;
    // One's own are shown on the spot, without waiting for the server.
    if (person.you) continue;
    lively = true;
    // Someone new on this screen: what they did before we saw them is not played back.
    if (known) fresh.forEach((done, i) => setTimeout(() => perform(walker, done), i * 400));
  }
  for (const [key, walker] of walkers) {
    if (!present.has(key)) leave(key, walker);
  }
  if (lively) cheerTogether(people);

  button.hidden = !people.some((person) => person.you);
  const mini = document.getElementById('avatar-mini');
  tint(mini, myLook());
  mini.innerHTML = drawing(myLook());
  return lively;
}

/** Makes this browser's own character do something: see `perform`. */
export function actAsMe(kind, value, to) {
  const walker = walkers.get(myKey);
  if (walker) perform(walker, { kind, value, to });
}

/** The whole crowd claps: a track someone asked for has just ended. */
export function applaud() {
  for (const walker of walkers.values()) {
    setTimeout(() => cheer(walker, ['👏']), Math.random() * 700);
  }
}

/** The look of a person, { key, you, avatar }: ours, theirs, or the one drawn for those who have not chosen. */
function lookOf(person) {
  if (person.you && mine) return myLook();
  return person.avatar ? tidy(person.avatar) : defaultLook(person.key);
}

/** A small picture of the character of a person, { key, you, avatar }, in their colour. */
export function portrait(person) {
  const look = lookOf(person);
  const picture = document.createElement('span');
  picture.className = 'mini';
  tint(picture, look);
  picture.innerHTML = drawing(look);
  return picture;
}

function arrive(key) {
  const node = document.createElement('div');
  node.className = 'walker';
  // Keeps them from dancing all in step.
  node.style.setProperty('--offset', `${(-Math.random()).toFixed(2)}s`);
  const tag = document.createElement('span');
  tag.className = 'tag';
  const figure = document.createElement('span');
  figure.className = 'figure';
  node.append(tag, figure);

  const walker = { key, node, tag, figure, look: null, shown: '', heard: 0, x: Math.random(), y: Math.random(), timer: 0 };
  place(walker, 0);
  crowd.append(node);
  walkers.set(key, walker);
  if (!lessMotion.matches) walker.timer = setTimeout(() => stroll(walker), 400 + Math.random() * 3000);
  return walker;
}

function dress(walker, look, you) {
  const shown = JSON.stringify([look, you]);
  if (shown === walker.shown) return;
  walker.shown = shown;
  walker.look = look;
  tint(walker.node, look);
  walker.node.classList.toggle('you', you);
  walker.tag.textContent = look.name || (you ? 'Moi' : '');
  walker.tag.hidden = !walker.tag.textContent;
  walker.figure.innerHTML = drawing(look);
}

/**
 * Plays what an avatar did, { kind, value, to }:
 * - emoji: the emoji floats up, with two smaller ones in its wake;
 * - did: the same for what the server reports by itself (a vote, a track added, the volume);
 * - move: a dance move;
 * - say: a few words in a bubble;
 * - gift: an emoji thrown to the avatar whose key is `to`.
 */
function perform(walker, { kind, value, to }) {
  if (!walker.node.isConnected) return;
  if (kind === 'emoji') cheer(walker, [value, value, value]);
  else if (kind === 'did' && DEEDS[value]) cheer(walker, DEEDS[value]);
  else if (kind === 'move' && MOVES[value]) dance(walker, value);
  else if (kind === 'say') speak(walker, value);
  else if (kind === 'gift') give(walker, value, to);
}

/** Where a character is on the screen right now: the middle of its head, measured from the bottom. */
function spot(walker) {
  const box = walker.node.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: innerHeight - box.top };
}

/** The emojis float up from the character one after the other, the first one bigger, and it jumps. */
function cheer(walker, emojis) {
  const { x, y } = spot(walker);
  emojis.forEach((emoji, i) => {
    setTimeout(() => float(emoji, x, y, walker.node.style.color, i > 0), i * 170);
  });
  animate(walker, 'hop', 550);
}

/** Plays one animation of the figure, from its start even when another was running. */
function animate(walker, name, ms) {
  const { figure } = walker;
  figure.classList.remove('hop', ...Object.keys(MOVES).map((move) => `move-${move}`));
  // Reading the layout lets the same animation start over.
  void figure.offsetWidth;
  figure.classList.add(name);
  clearTimeout(walker.moving);
  walker.moving = setTimeout(() => figure.classList.remove(name), ms);
}

function dance(walker, move) {
  animate(walker, `move-${move}`, MOVES[move]);
  if (move === 'wave') {
    const { x, y } = spot(walker);
    float('👋', x, y, walker.node.style.color, true);
  }
}

/** A few words in a bubble over the head. `words` is one of the server's sayings, shown as plain text. */
function speak(walker, words) {
  walker.speech?.remove();
  const speech = document.createElement('span');
  speech.className = 'speech';
  speech.textContent = words;
  walker.speech = speech;
  walker.node.prepend(speech);
  // Near a side of the screen the bubble slides back in, and its tail stays over the head.
  const middle = spot(walker).x;
  const half = speech.offsetWidth / 2;
  const slide = Math.max(0, 6 - (middle - half)) - Math.max(0, middle + half - (innerWidth - 6));
  speech.style.left = `${slide}px`;
  speech.style.setProperty('--tail', `${-slide}px`);
  setTimeout(() => speech.remove(), SPEECH_MS);
}

/** Throws an emoji from one character to another, who catches it with a jump. */
function give(walker, emoji, toKey) {
  const target = walkers.get(toKey);
  const land = () => {
    if (!target?.node.isConnected) return;
    cheer(target, [emoji]);
    if (toKey === myKey) on.gifted(walker.look.name, emoji);
  };
  if (!target || lessMotion.matches) {
    if (!target) cheer(walker, [emoji]);
    land();
    return;
  }

  const from = spot(walker);
  const to = spot(target);
  const gift = document.createElement('span');
  gift.className = 'gift';
  gift.style.left = `${from.x}px`;
  gift.style.bottom = `${from.y}px`;
  gift.style.color = walker.node.style.color;
  const rising = document.createElement('span');
  rising.textContent = emoji;
  gift.append(rising);
  crowd.append(gift);

  // Across at a steady pace, and up then down on top of that: an arc.
  const across = to.x - from.x;
  const top = 90 + Math.abs(across) * 0.18;
  const duration = 650 + Math.min(700, Math.abs(across) * 0.9);
  gift.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${across}px)` }], { duration, fill: 'forwards' });
  rising.animate(
    [
      { transform: 'translate(-50%, 0) scale(0.5)', easing: 'ease-out' },
      { transform: `translate(-50%, ${-top}px) scale(1.5)`, easing: 'ease-in', offset: 0.5 },
      { transform: `translate(-50%, ${from.y - to.y}px) scale(1)` },
    ],
    { duration, fill: 'forwards' },
  ).onfinish = () => {
    gift.remove();
    land();
  };
}

/** When several people send a 🔥 within a few seconds, the whole crowd jumps. */
function cheerTogether(people) {
  const latest = Math.max(0, ...people.flatMap((person) => person.acts.map((done) => done.at)));
  const onFire = people.filter((person) =>
    person.acts.some((done) => done.kind === 'emoji' && done.value === '🔥' && latest - done.at < HYPE.withinMs),
  );
  const needed = Math.min(HYPE.people, Math.max(2, people.length));
  if (onFire.length < needed || Date.now() - hypedAt < HYPE.restMs) return;
  hypedAt = Date.now();
  for (const walker of walkers.values()) {
    setTimeout(() => dance(walker, 'jump'), 300 + Math.random() * 250);
  }
}

/**
 * One emoji that rises from a point of the screen, swaying, and fades out
 * higher up. Each takes its own path: the height, the drift, the size and
 * the time are drawn at random.
 */
function float(emoji, x, y, color, small) {
  const emote = document.createElement('span');
  emote.className = 'emote';
  emote.style.left = `${x}px`;
  emote.style.bottom = `${y}px`;
  emote.style.color = color;
  emote.style.setProperty('--rise', `${-Math.round(innerHeight * (0.3 + Math.random() * 0.3))}px`);
  emote.style.setProperty('--drift', `${Math.round((Math.random() * 2 - 1) * 70)}px`);
  emote.style.setProperty('--size', (small ? 0.55 + Math.random() * 0.25 : 1).toFixed(2));
  emote.style.animationDuration = `${(2.6 + Math.random() * 1.4).toFixed(2)}s`;
  const swaying = document.createElement('span');
  swaying.textContent = emoji;
  swaying.style.animationDelay = `${(-Math.random()).toFixed(2)}s`;
  emote.append(swaying);
  crowd.append(emote);
  setTimeout(() => emote.remove(), FLOAT_MS);
}

function leave(key, walker) {
  walkers.delete(key);
  clearTimeout(walker.timer);
  walker.node.classList.add('leaving');
  setTimeout(() => walker.node.remove(), 400);
}

/** Moves a character to its spot, `x` and `y` being fractions of the room it has. */
function place(walker, seconds) {
  const span = Math.max(0, crowd.clientWidth - ROOM - 2 * EDGE);
  const up = Math.round(walker.y * DEPTH);
  walker.node.style.transitionDuration = `${seconds}s`;
  walker.node.style.transform = `translate(${EDGE + Math.round(walker.x * span)}px, ${-up}px)`;
  // The ones lower on the screen are nearer: they pass in front.
  walker.node.style.zIndex = String(DEPTH - up);
}

/** Walks to a spot nearby, waits there a while, and sets off again. */
function stroll(walker) {
  const span = Math.max(1, crowd.clientWidth - ROOM - 2 * EDGE);
  const from = walker.x;
  const step = (Math.random() * 2 - 1) * Math.min(1, REACH / span);
  walker.x = Math.min(1, Math.max(0, from + step));
  walker.y = Math.random();
  const seconds = Math.max(0.5, (Math.abs(walker.x - from) * span) / SPEED);

  walker.node.classList.add('walking');
  walker.node.classList.toggle('left', walker.x < from);
  place(walker, seconds);
  walker.timer = setTimeout(() => {
    walker.node.classList.remove('walking');
    walker.timer = setTimeout(() => stroll(walker), 1500 + Math.random() * 6000);
  }, seconds * 1000);
}

// A narrower window must not leave anyone outside.
addEventListener('resize', () => {
  for (const walker of walkers.values()) place(walker, 0);
});

// --- A gift for someone: a click on their character, then on what to send -------------

const picker = document.getElementById('gift-picker');
let pickerTimer = 0;

function closePicker() {
  clearTimeout(pickerTimer);
  picker.hidden = true;
}

/** Opens the choice of gifts by the pointer. The character walks on: the gift will find it. */
function openPicker(walker, gifts, x, y) {
  const name = walker.look.name;
  document.getElementById('gift-for').textContent = name ? `Pour ${name}` : 'Pour cet avatar';
  document.getElementById('gift-choices').replaceChildren(
    ...gifts.map((emoji) => {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'react';
      choice.textContent = emoji;
      choice.setAttribute('aria-label', `Envoyer ${emoji}`);
      choice.addEventListener('click', () => {
        closePicker();
        on.give(walker.key, emoji);
      });
      return choice;
    }),
  );
  picker.hidden = false;
  const box = picker.getBoundingClientRect();
  picker.style.left = `${Math.min(innerWidth - box.width - 8, Math.max(8, x - box.width / 2))}px`;
  picker.style.top = `${Math.max(8, y - box.height - 18)}px`;
  clearTimeout(pickerTimer);
  pickerTimer = setTimeout(closePicker, 6000);
}

crowd.addEventListener('click', (event) => {
  const node = event.target.closest('.walker');
  const walker = [...walkers.values()].find((one) => one.node === node);
  const gifts = lastCrowd.gifts ?? [];
  if (!walker || walker.key === myKey || !gifts.length) return;
  event.stopPropagation();
  openPicker(walker, gifts, event.clientX, event.clientY);
});
document.addEventListener('click', (event) => {
  if (!picker.hidden && !picker.contains(event.target)) closePicker();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closePicker();
});

// --- Choosing one's look ---------------------------------------------------------

const dialog = document.getElementById('avatar-dialog');
const form = document.getElementById('avatar-form');
const nameInput = document.getElementById('avatar-name');
const preview = document.getElementById('avatar-preview');
let draft = null;

/** One radio button for a choice, shown as a picture: `value` is its number in `field`. */
function addChoice(field, value, reserved) {
  const choice = entry(field, value);
  const option = document.createElement('label');
  option.className = reserved ? 'choice reserved' : 'choice';
  option.title = reserved ? `${choice.name} (réservé)` : choice.name;
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = field;
  input.value = String(value);
  input.className = 'sr-only';
  input.setAttribute('aria-label', option.title);
  const picture = document.createElement('span');
  picture.className = 'pick';
  if (field === 'color') tint(picture, { color: value });
  option.append(input, picture);
  document.getElementById(`avatar-${field}`).append(option);
}

/** Adds the reserved choices to the editor, the first time the server says this browser holds a code. */
function offerReserved() {
  if (form.querySelector('.choice.reserved')) return;
  for (const [field, list] of Object.entries(RESERVED_LISTS)) {
    list.forEach((_, index) => addChoice(field, RESERVED + index, true));
  }
}

/** Redraws the preview and the pictures of the choices after a change. */
function paint() {
  dialog.style.setProperty('--avatar', entry('color', draft.color).value);
  tint(preview, draft);
  preview.innerHTML = drawing(draft);
  for (const input of form.querySelectorAll('input[type="radio"]:not([name="color"])')) {
    const value = Number(input.value);
    // An accessory is shown on the body chosen; a body, without any accessory.
    const shown = input.name === 'body' ? { ...draft, body: value, extra: 0 } : { ...draft, [input.name]: value };
    input.nextElementSibling.innerHTML = drawing(shown);
  }
}

function openEditor() {
  draft = { ...myLook() };
  nameInput.value = draft.name;
  for (const input of form.querySelectorAll('input[type="radio"]')) {
    input.checked = draft[input.name] === Number(input.value);
  }
  paint();
  dialog.showModal();
}

/**
 * Wires the editor and the gifts. `handlers` is what the page does:
 * changed() once a new look has been saved, give(key, emoji) when a gift has
 * been picked for someone, gifted(name, emoji) when one arrives for this browser.
 */
export function setUpAvatars(handlers) {
  on = { ...on, ...handlers };
  for (const [field, list] of Object.entries(LISTS)) list.forEach((_, index) => addChoice(field, index, false));

  button.addEventListener('click', openEditor);
  document.getElementById('avatar-cancel').addEventListener('click', () => dialog.close());
  form.addEventListener('change', (event) => {
    if (event.target.type !== 'radio') return;
    draft[event.target.name] = Number(event.target.value);
    paint();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    mine = tidy({ ...draft, name: nameInput.value });
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(mine));
    } catch {
      // Storage is blocked: the look then only lasts for this page view.
    }
    dialog.close();
    renderCrowd(lastCrowd.people, lastCrowd);
    on.changed();
  });
}
