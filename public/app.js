import { actAsMe, applaud, avatarHeader, portrait, renderCrowd, setUpAvatars } from './avatars.js';

const $ = (id) => document.getElementById(id);

const views = { setup: $('view-setup'), code: $('view-code'), main: $('view-main') };
const POLL_MS = 15_000;
// While reactions fly, the page looks more often, so that they arrive in time.
const LIVELY_POLL_MS = 3_000;
const LIVELY_FOR_MS = 30_000;

// localStorage can be unavailable (private mode, blocked site data).
const storage = {
  get(key) {
    try {
      return localStorage.getItem(key) ?? '';
    } catch {
      return '';
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // The code then only lasts for this page view.
    }
  },
};

let accessCode = storage.get('sr_code');
// The code for the reserved avatar choices, when this browser was given one. It
// is shown to the server until the server has answered with a cookie that
// stands for it.
let vipCode = storage.get('sr_vip');
let vipKnown = false;
let currentView = null;
let playingUri = null;
// Whether someone here asked for the track that is playing: the crowd claps when it ends.
let playingRequested = false;
// Where the track was when the server last said: { ms, paused, at, total, uri }.
let progress = null;
let endTimer = 0;
let livelyUntil = 0;
let pollTimer = 0;
let volume = null;
let volumeBusy = false;
let volumeUntil = 0;
let volumeTimer = 0;
// Counts the changes made from this page, to tell when a poll answers with an older volume.
let volumeChanges = 0;
let cooldownUntil = 0;
let cooldownTimer = 0;
let searchTimer = 0;
let searchAbort = null;
let toastTimer = 0;

// A shared link can carry the code: https://…/?code=XXXX
// A private one can also carry the code that unlocks the reserved avatar choices: &vip=YYYY
{
  const params = new URLSearchParams(location.search);
  const fromLink = params.get('code');
  const vipFromLink = params.get('vip');
  if (fromLink) {
    accessCode = fromLink;
    storage.set('sr_code', fromLink);
  }
  if (vipFromLink) {
    vipCode = vipFromLink;
    storage.set('sr_vip', vipFromLink);
  }
  if (fromLink || vipFromLink) {
    params.delete('code');
    params.delete('vip');
    const rest = params.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : ''));
  }
}

class ApiError extends Error {
  constructor(code, message, data = {}) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      ...options,
      headers: { ...options.headers, 'x-access-code': encodeURIComponent(accessCode) },
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('network', 'Connexion impossible. Vérifie ton réseau.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? 'unknown', data.message ?? 'Erreur inattendue.', data);
  return data;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function show(name) {
  currentView = name;
  for (const [key, node] of Object.entries(views)) node.hidden = key !== name;
  if (name !== 'main') {
    renderPresent(0);
    renderCrowd([]);
  }
}

/** Narrow screens only: which of the two panes is on screen. */
function selectTab(name) {
  $('panes').dataset.tab = name;
  for (const tab of document.querySelectorAll('.tabs button')) {
    tab.setAttribute('aria-pressed', String(tab.dataset.tab === name));
  }
}

/** Switches to the setup or code screen when the error calls for it. */
function handleGate(err) {
  if (err.code === 'not_configured') {
    renderSetup(err.data);
    show('setup');
    return true;
  }
  if (err.code === 'bad_code') {
    $('code-error').hidden = !accessCode;
    const wasShown = currentView === 'code';
    show('code');
    if (!wasShown) $('code-input').focus();
    return true;
  }
  return false;
}

function toast(message, kind = 'ok') {
  const node = $('toast');
  node.textContent = message;
  node.className = kind === 'error' ? 'toast error' : 'toast';
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 4500);
}

function duration(ms) {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// --- Rendering ---------------------------------------------------------------

function trackRow(track, { button = false, tag = 'li' } = {}) {
  const row = el(tag, 'track');

  const cover = track.image ? el('img', 'cover') : el('div', 'cover');
  if (track.image) {
    cover.src = track.image;
    cover.alt = '';
    cover.loading = 'lazy';
  }

  const meta = el('div', 'meta');
  meta.append(el('span', 'title', track.name));
  const artist = el('span', 'artist');
  if (track.explicit) {
    const badge = el('span', 'explicit', 'E');
    badge.title = 'Paroles explicites';
    artist.append(badge, ' ');
  }
  const details = [track.artists, button && track.durationMs ? duration(track.durationMs) : ''];
  artist.append(details.filter(Boolean).join(' · '));
  meta.append(artist);

  row.append(cover, meta);
  if (track.requester) row.append(asker(track.requester));
  if (button) {
    const add = el('button', 'add', 'Ajouter');
    add.type = 'button';
    add.setAttribute('aria-label', `Ajouter ${track.name} à la file d’attente`);
    add.disabled = cooldownLeft() > 0;
    add.addEventListener('click', () => requestTrack(track, add));
    row.append(add);
  }
  return row;
}

/** The name to show for whoever asked for a track: { name, you }. */
function askerName(requester) {
  return requester.you ? 'toi' : requester.name;
}

/** In the queue, who asked for a track: their avatar, and their name when there is room. */
function asker(requester) {
  const name = askerName(requester);
  const picture = portrait(requester);
  const chip = el('span', 'asker');
  chip.style.color = picture.style.color;
  chip.title = name ? `Ajouté par ${name}` : 'Ajouté depuis cette page';
  chip.setAttribute('aria-label', chip.title);
  chip.append(picture);
  if (name) chip.append(el('span', 'asker-name', name));
  return chip;
}

/** `requester` is who asked for the track, { key, name, you, avatar }, or null when nobody here did. */
function renderNow(track, errorMessage, requester) {
  const box = $('now');
  if (errorMessage) {
    box.replaceChildren(el('p', 'error', errorMessage));
  } else if (!track) {
    box.replaceChildren(
      el('p', '', 'Rien pour l’instant. Les demandes passeront dès que la musique tourne.'),
    );
  } else {
    const row = trackRow(track, { tag: 'div' });
    if (requester) {
      const by = el('span', 'by', 'Ajouté par ');
      by.append(portrait(requester), askerName(requester));
      row.querySelector('.meta').append(by);
    }
    box.replaceChildren(row);
  }
}

/**
 * `state` is { ms, paused }, how far into `track` the player is, or null when
 * that is not known. The bar then moves on its own between two polls.
 */
function renderProgress(state, track) {
  clearTimeout(endTimer);
  const total = track?.durationMs ?? 0;
  const sameTrack = progress?.uri === track?.uri;
  progress = state && total > 0 ? { ...state, at: Date.now(), total, uri: track.uri } : null;
  $('progress').hidden = !progress;
  document.querySelector('.now').classList.toggle('paused', Boolean(progress?.paused));
  if (!progress) return;

  $('progress-end').textContent = duration(total);
  $('progress-bar').setAttribute('aria-valuemax', String(Math.round(total / 1000)));
  // A new track starts from the left at once, instead of sliding back there.
  const fill = $('progress-fill');
  if (!sameTrack) fill.style.transition = 'none';
  tickProgress();
  if (!sameTrack) {
    void fill.offsetWidth;
    fill.style.transition = '';
  }

  // The track changes when it ends: do not wait for the next poll to show the next one.
  if (!progress.paused && total > progress.ms) {
    endTimer = setTimeout(() => {
      if (currentView === 'main' && document.visibilityState === 'visible') refreshQueue();
    }, total - progress.ms + 1500);
  }
}

function tickProgress() {
  if (!progress) return;
  const ms = Math.min(progress.total, progress.ms + (progress.paused ? 0 : Date.now() - progress.at));
  const elapsed = duration(Math.floor(ms / 1000) * 1000);
  $('progress-now').textContent = elapsed;
  $('progress-fill').style.width = `${(ms / progress.total) * 100}%`;
  $('progress-bar').setAttribute('aria-valuenow', String(Math.floor(ms / 1000)));
  $('progress-bar').setAttribute('aria-valuetext', `${elapsed} sur ${duration(progress.total)}`);
}

function renderNext(tracks) {
  $('next').replaceChildren(...tracks.map((track) => trackRow(track)));
  $('next-empty').hidden = tracks.length > 0;
}

function renderPresent(count) {
  const node = $('present');
  node.hidden = !(count > 0);
  node.textContent = count > 1 ? `${count} personnes en ligne` : '1 personne en ligne';
}

/** `skip` is the vote on the track that is playing: { votes, needed, voted }, or null. */
function renderSkip(skip) {
  const button = $('skip');
  button.hidden = !skip;
  if (!skip) return;
  const count = `${skip.votes} ${skip.votes > 1 ? 'votes' : 'vote'} sur ${skip.needed}`;
  button.disabled = skip.voted;
  button.classList.toggle('voted', skip.voted);
  button.textContent = `${skip.voted ? 'Voté' : 'Passer'} · ${skip.votes}/${skip.needed}`;
  button.title = 'Le titre est passé dès que plus de la moitié des personnes en ligne ont voté.';
  button.setAttribute(
    'aria-label',
    skip.voted ? `Tu as voté pour passer ce titre : ${count}` : `Voter pour passer ce titre : ${count}`,
  );
}

/**
 * `state` is { percent, min, max, wait }, or null when the volume cannot be set
 * from here. `wait` is the seconds before this browser may move it again.
 */
function renderVolume(state) {
  volume = state ?? null;
  $('volume').hidden = !volume;
  if (!volume) return;
  $('volume-level').textContent = `${volume.percent} %`;
  if (volume.wait > 0) holdVolume(volume.wait);
  updateVolumeButtons();
}

function holdVolume(seconds) {
  volumeUntil = Date.now() + seconds * 1000;
  clearTimeout(volumeTimer);
  volumeTimer = setTimeout(updateVolumeButtons, seconds * 1000 + 50);
}

function updateVolumeButtons() {
  if (!volume) return;
  const held = volumeBusy || Date.now() < volumeUntil;
  const atMin = volume.percent <= volume.min;
  const atMax = volume.percent >= volume.max;
  $('volume-down').disabled = held || atMin;
  $('volume-up').disabled = held || atMax;
  $('volume-down').title = atMin ? `Pas en dessous de ${volume.min} % depuis cette page.` : '';
  $('volume-up').title = atMax ? `Pas au-dessus de ${volume.max} % depuis cette page.` : '';
}

// The dance moves this page has a button for, among those the server knows.
const MOVE_LABELS = { spin: '↻ Tourner', jump: '⤒ Sauter', wave: '👋 Saluer' };

/**
 * What this browser's avatar can be made to do, as the server lists it:
 * { react, move, say }. One row of emojis, and one of dance moves and sayings.
 */
function renderExpressions({ react = [], move = [], say = [] } = {}) {
  const emojis = $('reactions');
  const words = $('sayings');
  const moves = move.filter((name) => MOVE_LABELS[name]);
  emojis.hidden = react.length === 0;
  words.hidden = moves.length + say.length === 0;
  const shown = JSON.stringify([react, moves, say]);
  if (emojis.dataset.shown === shown) return;
  emojis.dataset.shown = shown;

  const button = (className, text, label, kind, value) => {
    const node = el('button', className, text);
    node.type = 'button';
    node.setAttribute('aria-label', label);
    node.addEventListener('click', () => express(kind, value));
    return node;
  };
  emojis.replaceChildren(...react.map((emoji) => button('react', emoji, `Réagir avec ${emoji}`, 'emoji', emoji)));
  words.replaceChildren(
    ...moves.map((name) => button('word move', MOVE_LABELS[name], `Mon avatar : ${MOVE_LABELS[name]}`, 'move', name)),
    ...say.map((text) => button('word', text, `Mon avatar dit : ${text}`, 'say', text)),
  );
}

function renderResults(tracks) {
  $('results').replaceChildren(...tracks.map((track) => trackRow(track, { button: true })));
}

function renderSetup({ missing = [], redirectUri = '' } = {}) {
  const box = $('setup-body');
  const keys = missing.filter((name) => name !== 'SPOTIFY_REFRESH_TOKEN');

  if (keys.length) {
    const intro = el('p', '', 'Il manque des variables d’environnement :');
    const list = el('ul');
    for (const name of keys) {
      const item = el('li');
      item.append(el('code', '', name));
      list.append(item);
    }
    box.replaceChildren(intro, list, el('p', '', 'Ajoute-les dans les réglages du projet, puis redéploie.'));
    return;
  }

  const steps = el('ol');
  const first = el('li', '', 'Dans ton app Spotify, déclare cette Redirect URI : ');
  first.append(el('code', '', redirectUri));
  const second = el('li');
  const link = el('a', 'button', 'Relier mon compte Spotify');
  link.href = '/api/login';
  second.append(link);
  steps.append(first, second);
  box.replaceChildren(el('p', '', 'Il reste à relier le compte Spotify.'), steps);
}

// --- Cooldown between two requests ---------------------------------------------

function cooldownLeft() {
  return Math.ceil((cooldownUntil - Date.now()) / 1000);
}

function startCooldown(seconds) {
  if (!(seconds > 0)) return;
  cooldownUntil = Date.now() + seconds * 1000;
  clearInterval(cooldownTimer);
  cooldownTimer = setInterval(updateCooldown, 500);
  updateCooldown();
}

function updateCooldown() {
  const left = cooldownLeft();
  const active = left > 0;
  if (!active) clearInterval(cooldownTimer);
  $('cooldown').hidden = !active;
  $('cooldown').textContent = active ? `Prochaine demande possible dans ${left} s.` : '';
  for (const button of document.querySelectorAll('.add:not(.done):not(.busy)')) {
    button.disabled = active;
  }
}

// --- Actions -----------------------------------------------------------------

async function refreshQueue() {
  const changes = volumeChanges;
  try {
    const proving = Boolean(vipCode) && !vipKnown;
    const data = await api('/api/queue', {
      headers: { ...avatarHeader(), ...(proving && { 'x-vip': encodeURIComponent(vipCode) }) },
    });
    vipKnown = data.vip;
    if (proving && !data.vip) {
      // Not a code the server knows: no point in showing it again.
      vipCode = '';
      storage.set('sr_vip', '');
    }
    show('main');
    // A track someone asked for has played to its end: the crowd claps. Not when it was skipped.
    const uri = data.playing?.uri ?? null;
    if (playingRequested && uri !== playingUri && nearItsEnd()) applaud();
    playingUri = uri;
    playingRequested = Boolean(data.requester);
    // They dance while the music plays and stop when it is paused. Whoever asked for the track is in the spotlight.
    const dancing = Boolean(data.playing) && !data.progress?.paused;
    const crowd = { dancing, star: data.requester?.key, gifts: data.can.give, holdsCode: data.vip };
    if (renderCrowd(data.people, crowd)) stayLively();
    renderNow(data.playing, '', data.requester);
    renderProgress(data.progress, data.playing);
    renderNext(data.next);
    renderPresent(data.present);
    renderExpressions(data.can);
    renderSkip(data.skip);
    // An answer that was on its way while the volume was being changed is out of date.
    if (changes === volumeChanges) renderVolume(data.volume);
    if (data.cooldown > cooldownLeft()) startCooldown(data.cooldown);
  } catch (err) {
    if (handleGate(err)) return;
    if (currentView && currentView !== 'main') {
      // Stay on the code or setup screen; the problem is elsewhere (network, Spotify).
      toast(err.message, 'error');
      return;
    }
    show('main');
    playingUri = null;
    playingRequested = false;
    renderNow(null, err.message);
    renderProgress(null, null);
    renderNext([]);
    renderPresent(0);
    renderCrowd([]);
    renderExpressions();
    renderSkip(null);
    renderVolume(null);
  }
}

/** True when the track that was playing had no more than a few seconds left. */
function nearItsEnd() {
  if (!progress || progress.paused) return false;
  return progress.ms + (Date.now() - progress.at) > progress.total - 8000;
}

/**
 * Makes this browser's avatar do something: an emoji, a dance move, a few
 * words, or a gift `to` the key of someone else.
 */
async function express(kind, value, to) {
  // Shown at once on this screen; the others get it with their next poll.
  actAsMe(kind, value, to);
  stayLively();
  const field = { emoji: 'react', move: 'move', say: 'say', gift: 'gift' }[kind];
  try {
    await api('/api/queue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ [field]: value, to }),
    });
  } catch (err) {
    if (handleGate(err)) return;
    toast(err.message, 'error');
  }
}

async function voteSkip() {
  const button = $('skip');
  button.disabled = true;
  try {
    const data = await api('/api/queue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skip: playingUri }),
    });
    renderPresent(data.present);
    renderSkip(data.skip);
    actAsMe('did', 'skip');
    if (data.skipped) {
      toast('Titre passé.');
      // Spotify takes a moment to move on to the next track.
      setTimeout(refreshQueue, 2000);
    } else {
      toast(`Vote enregistré : ${data.skip.votes} sur ${data.skip.needed}.`);
    }
  } catch (err) {
    button.disabled = false;
    if (handleGate(err)) return;
    toast(err.message, 'error');
    if (err.code === 'track_changed') refreshQueue();
  }
}

async function changeVolume(direction) {
  volumeBusy = true;
  volumeChanges += 1;
  updateVolumeButtons();
  try {
    const data = await api('/api/queue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ volume: direction }),
    });
    renderVolume(data.volume);
    actAsMe('did', direction === 'down' ? 'quieter' : 'louder');
    const next = data.volume.wait > 0 ? ` Prochain réglage dans ${data.volume.wait} s.` : '';
    toast(`Volume à ${data.volume.percent} %.${next}`);
  } catch (err) {
    if (handleGate(err)) return;
    if (err.code === 'volume_unavailable' || err.code === 'volume_off') renderVolume(null);
    else if (err.data.volume) renderVolume(err.data.volume);
    else if (err.code === 'volume_wait') holdVolume(err.data.retryAfter);
    toast(err.message, 'error');
  } finally {
    volumeBusy = false;
    // Also sets aside a poll that left while the change was under way.
    volumeChanges += 1;
    updateVolumeButtons();
  }
}

async function runSearch() {
  const query = $('q').value.trim();
  searchAbort?.abort();
  if (query.length < 2) {
    searchAbort = null;
    renderResults([]);
    $('status').textContent = '';
    return;
  }
  const controller = new AbortController();
  searchAbort = controller;
  $('status').textContent = 'Recherche…';
  try {
    const { tracks } = await api(`/api/search?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    });
    if (controller !== searchAbort) return;
    renderResults(tracks);
    $('status').textContent = tracks.length ? '' : 'Aucun résultat.';
  } catch (err) {
    if (err.name === 'AbortError' || controller !== searchAbort) return;
    if (handleGate(err)) return;
    renderResults([]);
    $('status').textContent = err.message;
  }
}

async function requestTrack(track, button) {
  button.classList.add('busy');
  button.disabled = true;
  button.textContent = 'Envoi…';
  try {
    const data = await api('/api/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uri: track.uri }),
    });
    button.classList.replace('busy', 'done');
    button.textContent = 'Ajouté ✓';
    button.setAttribute('aria-label', `${track.name} ajouté à la file d’attente`);
    toast(`« ${track.name} » est dans la file d’attente.`);
    startCooldown(data.cooldown);
    actAsMe('did', 'add');
    // Spotify takes a moment to reflect the new queue.
    setTimeout(refreshQueue, 5000);
  } catch (err) {
    button.classList.remove('busy');
    button.textContent = 'Ajouter';
    button.disabled = cooldownLeft() > 0;
    if (handleGate(err)) return;
    if (err.code === 'cooldown') startCooldown(err.data.retryAfter);
    toast(err.message, 'error');
  }
}

// --- Wiring ------------------------------------------------------------------

$('q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 300);
});

$('search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  clearTimeout(searchTimer);
  runSearch();
});

setUpAvatars({
  // A new look is sent with the next poll: do not wait for it.
  changed: refreshQueue,
  give: (key, emoji) => express('gift', emoji, key),
  gifted: (name, emoji) => toast(`${name || 'Quelqu’un'} t’envoie ${emoji}`),
});

$('skip').addEventListener('click', voteSkip);
$('volume-down').addEventListener('click', () => changeVolume('down'));
$('volume-up').addEventListener('click', () => changeVolume('up'));

for (const tab of document.querySelectorAll('.tabs button')) {
  tab.addEventListener('click', () => selectTab(tab.dataset.tab));
}

$('code-form').addEventListener('submit', (event) => {
  event.preventDefault();
  accessCode = $('code-input').value.trim();
  storage.set('sr_code', accessCode);
  refreshQueue();
});

setInterval(tickProgress, 1000);

// Keep "now playing" and the people fresh while the page is on screen.
function planPoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(
    async () => {
      if (currentView === 'main' && document.visibilityState === 'visible') await refreshQueue();
      planPoll();
    },
    Date.now() < livelyUntil ? LIVELY_POLL_MS : POLL_MS,
  );
}

/** Someone has just reacted: look more often for a while. */
function stayLively() {
  livelyUntil = Date.now() + LIVELY_FOR_MS;
  planPoll();
}

planPoll();

document.addEventListener('visibilitychange', () => {
  if (currentView === 'main' && document.visibilityState === 'visible') refreshQueue();
});

refreshQueue();
