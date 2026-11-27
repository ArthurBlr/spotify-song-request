// Runs before the page on every `npm start`: brings a git clone of this repo
// up to date, so that getting the latest version only takes starting again.
//
// Only a clone with no local changes that is behind its remote branch is
// touched, and only by a fast-forward. Local changes, local commits or no
// connection leave the folder as it is. The settings live in .env, which git
// ignores: they are kept. AUTO_UPDATE=0 in .env turns this off.
//
// Whatever happens here, the page starts afterwards.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TIMEOUT_MS = 15_000;
const NEWS_SHOWN = 5;

function git(dir, ...args) {
  const run = spawnSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    // A clone that asks for a password must not keep the page from starting.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return { ok: run.status === 0, out: (run.stdout ?? '').trim() };
}

/**
 * Fast-forwards the clone in `dir` to its remote branch when that is safe.
 * Returns what happened: 'updated', 'current', 'not-a-clone', 'no-upstream',
 * 'offline', 'changed' or 'failed'.
 */
export function update(dir, log = console.log) {
  if (!existsSync(join(dir, '.git'))) return 'not-a-clone';
  if (!git(dir, 'rev-parse', '--verify', '--quiet', '@{u}').ok) return 'no-upstream';

  if (!git(dir, 'fetch', '--quiet').ok) {
    log('Pas pu vérifier les mises à jour (pas de connexion ?) : la version actuelle démarre.');
    return 'offline';
  }
  const behind = Number(git(dir, 'rev-list', '--count', 'HEAD..@{u}').out);
  if (!behind) return 'current';

  if (git(dir, 'status', '--porcelain', '--untracked-files=no').out) {
    log("Une mise à jour est disponible, mais des fichiers de ce dossier ont été modifiés : je n'y touche pas.");
    log('Pour la récupérer quand même : git stash, puis npm start.');
    return 'changed';
  }
  const news = git(dir, 'log', `--max-count=${NEWS_SHOWN}`, '--format=%s', 'HEAD..@{u}').out;
  if (!git(dir, 'merge', '--ff-only', '--quiet', '@{u}').ok) {
    log("Une mise à jour est disponible, mais elle n'a pas pu être appliquée : lance git pull pour voir pourquoi.");
    return 'failed';
  }
  log(`Song request est à jour (${behind} nouveauté${behind > 1 ? 's' : ''}) :`);
  for (const subject of news.split('\n')) log(`  - ${subject}`);
  return 'updated';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = fileURLToPath(new URL('.', import.meta.url));
  try {
    process.loadEnvFile(process.env.ENV_FILE || join(dir, '.env'));
  } catch {
    // No .env yet: first run.
  }
  if (process.env.AUTO_UPDATE !== '0') {
    try {
      update(dir);
    } catch (err) {
      console.error('Mise à jour ignorée :', err.message);
    }
  }
}
