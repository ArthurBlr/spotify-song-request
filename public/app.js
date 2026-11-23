const $ = (id) => document.getElementById(id);

const views = { setup: $('view-setup'), code: $('view-code'), main: $('view-main') };
const POLL_MS = 15_000;

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
let currentView = null;
let playingUri = null;
let cooldownUntil = 0;
let cooldownTimer = 0;
let searchTimer = 0;
let searchAbort = null;
let toastTimer = 0;

// A shared link can carry the code: https://…/?code=XXXX
{
  const params = new URLSearchParams(location.search);
  const fromLink = params.get('code');
  if (fromLink) {
    accessCode = fromLink;
    storage.set('sr_code', fromLink);
    params.delete('code');
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
  if (name !== 'main') renderPresent(0);
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

function renderNow(track, errorMessage) {
  const box = $('now');
  if (errorMessage) {
    box.replaceChildren(el('p', 'error', errorMessage));
  } else if (!track) {
    box.replaceChildren(
      el('p', '', 'Rien pour l’instant. Les demandes passeront dès que la musique tourne.'),
    );
  } else {
    box.replaceChildren(trackRow(track, { tag: 'div' }));
  }
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
  try {
    const data = await api('/api/queue');
    show('main');
    playingUri = data.playing?.uri ?? null;
    renderNow(data.playing);
    renderNext(data.next);
    renderPresent(data.present);
    renderSkip(data.skip);
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
    renderNow(null, err.message);
    renderNext([]);
    renderPresent(0);
    renderSkip(null);
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

$('skip').addEventListener('click', voteSkip);

for (const tab of document.querySelectorAll('.tabs button')) {
  tab.addEventListener('click', () => selectTab(tab.dataset.tab));
}

$('code-form').addEventListener('submit', (event) => {
  event.preventDefault();
  accessCode = $('code-input').value.trim();
  storage.set('sr_code', accessCode);
  refreshQueue();
});

// Keep "now playing" fresh while the page is on screen.
setInterval(() => {
  if (currentView === 'main' && document.visibilityState === 'visible') refreshQueue();
}, POLL_MS);

document.addEventListener('visibilitychange', () => {
  if (currentView === 'main' && document.visibilityState === 'visible') refreshQueue();
});

refreshQueue();
