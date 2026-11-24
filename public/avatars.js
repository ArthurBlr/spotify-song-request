// Everyone who has the page open gets a small character that strolls along the
// bottom of the screen, and can say an emoji in a bubble. Each browser chooses
// its own: the choice is kept in this browser and sent with every poll, so the
// server only passes it on.
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
  const body = BODIES[look.body];
  const extra = EXTRAS[look.extra];
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
  const body = BODIES[look.body].pixels;
  const extra = EXTRAS[look.extra].pixels;
  const shift = extra.anchor ? body[extra.anchor] - (extra.anchor === 'top' ? 3 : 6) : 0;
  const paths = { 'px-body': '', 'px-dark': '', 'px-white': '', 'px-gold': '' };
  const draw = (rows, from) => {
    rows.forEach((line, row) => {
      [...line].forEach((mark, column) => {
        if (PAINTS[mark]) paths[PAINTS[mark]] += `M${column * 4} ${(from + row) * 4}h4v4h-4z`;
      });
    });
  };
  draw(body.rows, 0);
  draw(extra.rows, extra.from + shift);
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

/**
 * The drawing of a look, as SVG markup. It is put together from the constants
 * above only: the name a visitor typed never goes through here.
 */
function drawing(look) {
  return STYLES[look.style].draw(look);
}

function cleanName(name) {
  const plain = String(name ?? '').replace(/\s+/g, ' ').trim();
  return [...plain].slice(0, NAME_MAX).join('').trim();
}

/** Brings any look, ours or someone else's, within what this page can draw. */
function tidy(look) {
  const pick = (n, list) => (Number.isInteger(n) && n >= 0 ? n % list.length : 0);
  return {
    name: cleanName(look.name),
    style: pick(look.style, STYLES),
    color: pick(look.color, COLORS),
    body: pick(look.body, BODIES),
    extra: pick(look.extra, EXTRAS),
  };
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
let lastCrowd = { people: [], dancing: false };
let whenChanged = () => {};

/** The header that carries this browser's look with a poll. */
export function avatarHeader() {
  return mine ? { 'x-avatar': encodeURIComponent(JSON.stringify(mine)) } : {};
}

// --- The crowd -----------------------------------------------------------------

const crowd = document.getElementById('crowd');
const button = document.getElementById('avatar-button');
const walkers = new Map(); // person key -> { node, tag, figure, bubble, shown, heard, x, y, timer }
const lessMotion = matchMedia('(prefers-reduced-motion: reduce)');

const SPEED = 45; // pixels per second
const REACH = 420; // longest stroll, in pixels
const DEPTH = 18; // how far up the screen they may wander, in pixels
const ROOM = 44; // width kept for one character
const BUBBLE_MS = 4000; // how long a reaction stays up: the length of its animation

/**
 * Draws the people present: [{ key, you, avatar, reaction }], `avatar` being a
 * look or null, `reaction` { emoji, at } or null. They dance on the spot while
 * `dancing` is true. Returns true when someone else has just reacted.
 */
export function renderCrowd(people, { dancing = false } = {}) {
  lastCrowd = { people, dancing };
  crowd.classList.toggle('dancing', dancing);

  let lively = false;
  const present = new Set();
  for (const person of people) {
    present.add(person.key);
    if (person.you) myKey = person.key;
    const look = person.you && mine ? mine : person.avatar ? tidy(person.avatar) : defaultLook(person.key);
    const walker = walkers.get(person.key) ?? arrive(person.key);
    dress(walker, look, person.you);
    // One's own reactions are shown on the spot, without waiting for the server.
    if (person.reaction && !person.you && person.reaction.at !== walker.heard) {
      walker.heard = person.reaction.at;
      say(walker, person.reaction.emoji);
      lively = true;
    }
  }
  for (const [key, walker] of walkers) {
    if (!present.has(key)) leave(key, walker);
  }

  button.hidden = !people.some((person) => person.you);
  const me = mine ?? defaultLook(myKey);
  const mini = document.getElementById('avatar-mini');
  mini.style.color = COLORS[me.color].value;
  mini.innerHTML = drawing(me);
  return lively;
}

/** Makes this browser's own character say `emoji`. */
export function reactAsMe(emoji) {
  const walker = walkers.get(myKey);
  if (walker) say(walker, emoji);
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

  const walker = { node, tag, figure, bubble: null, shown: '', heard: 0, x: Math.random(), y: Math.random(), timer: 0 };
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
  walker.node.style.color = COLORS[look.color].value;
  walker.node.classList.toggle('you', you);
  walker.tag.textContent = look.name || (you ? 'Moi' : '');
  walker.tag.hidden = !walker.tag.textContent;
  walker.figure.innerHTML = drawing(look);
}

/** A bubble over the head for a few seconds, and a small jump. */
function say(walker, emoji) {
  walker.bubble?.remove();
  const bubble = document.createElement('span');
  bubble.className = 'bubble';
  bubble.textContent = emoji;
  walker.bubble = bubble;
  walker.node.prepend(bubble);
  setTimeout(() => bubble.remove(), BUBBLE_MS);

  // Taking the class off and reading the layout lets the jump start over.
  walker.figure.classList.remove('hop');
  void walker.figure.offsetWidth;
  walker.figure.classList.add('hop');
}

function leave(key, walker) {
  walkers.delete(key);
  clearTimeout(walker.timer);
  walker.node.classList.add('leaving');
  setTimeout(() => walker.node.remove(), 400);
}

/** Moves a character to its spot, `x` and `y` being fractions of the room it has. */
function place(walker, seconds) {
  const span = Math.max(0, crowd.clientWidth - ROOM);
  const up = Math.round(walker.y * DEPTH);
  walker.node.style.transitionDuration = `${seconds}s`;
  walker.node.style.transform = `translate(${Math.round(walker.x * span)}px, ${-up}px)`;
  // The ones lower on the screen are nearer: they pass in front.
  walker.node.style.zIndex = String(DEPTH - up);
}

/** Walks to a spot nearby, waits there a while, and sets off again. */
function stroll(walker) {
  const span = Math.max(1, crowd.clientWidth - ROOM);
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

// --- Choosing one's look ---------------------------------------------------------

const dialog = document.getElementById('avatar-dialog');
const form = document.getElementById('avatar-form');
const nameInput = document.getElementById('avatar-name');
const preview = document.getElementById('avatar-preview');
let draft = null;

/** One radio button per entry of a list, shown as a picture. */
function buildChoices(field) {
  const holder = document.getElementById(`avatar-${field}`);
  LISTS[field].forEach((entry, index) => {
    const option = document.createElement('label');
    option.className = 'choice';
    option.title = entry.name;
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = field;
    input.value = String(index);
    input.className = 'sr-only';
    input.setAttribute('aria-label', entry.name);
    const picture = document.createElement('span');
    picture.className = 'pick';
    if (field === 'color') picture.style.color = entry.value;
    option.append(input, picture);
    holder.append(option);
  });
}

/** Redraws the preview and the pictures of the choices after a change. */
function paint() {
  dialog.style.setProperty('--avatar', COLORS[draft.color].value);
  preview.innerHTML = drawing(draft);
  const pictures = (field) => form.querySelectorAll(`input[name="${field}"] + .pick`);
  pictures('style').forEach((picture, style) => {
    picture.innerHTML = drawing({ ...draft, style });
  });
  pictures('body').forEach((picture, body) => {
    picture.innerHTML = drawing({ ...draft, body, extra: 0 });
  });
  pictures('extra').forEach((picture, extra) => {
    picture.innerHTML = drawing({ ...draft, extra });
  });
}

function openEditor() {
  draft = { ...(mine ?? defaultLook(myKey)) };
  nameInput.value = draft.name;
  for (const input of form.querySelectorAll('input[type="radio"]')) {
    input.checked = draft[input.name] === Number(input.value);
  }
  paint();
  dialog.showModal();
}

/** Wires the editor. `onChange` is called once a new look has been saved. */
export function setUpAvatars(onChange) {
  whenChanged = onChange;
  for (const field of Object.keys(LISTS)) buildChoices(field);

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
    whenChanged();
  });
}
