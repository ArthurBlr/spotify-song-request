import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { update } from '../update.js';

function git(dir, ...args) {
  const identity = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false'];
  return execFileSync('git', [...identity, ...args], { cwd: dir, encoding: 'utf8' });
}

async function commit(dir, file, content) {
  await writeFile(join(dir, file), content);
  git(dir, 'add', file);
  git(dir, 'commit', '-q', '-m', `Change ${file}`);
}

/** The author's repo, the remote, and a colleague's clone of it with its own .env. */
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'song-request-update-'));
  const author = join(root, 'author');
  const remote = join(root, 'remote.git');
  const clone = join(root, 'clone');
  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  git(root, 'init', '-q', '-b', 'main', author);
  await commit(author, '.gitignore', '.env\n');
  await commit(author, 'app.js', 'v1');
  git(author, 'remote', 'add', 'origin', remote);
  git(author, 'push', '-q', '-u', 'origin', 'main');
  git(root, 'clone', '-q', remote, clone);
  await writeFile(join(clone, '.env'), 'ACCESS_CODE=4821\n');
  return { root, author, clone };
}

async function publish(author, content) {
  await commit(author, 'app.js', content);
  git(author, 'push', '-q');
}

test('a clean clone that is behind is brought up to date, and keeps its .env', async () => {
  const { author, clone } = await setup();
  await publish(author, 'v2');
  const lines = [];
  assert.equal(update(clone, (line) => lines.push(line)), 'updated');
  assert.equal(await readFile(join(clone, 'app.js'), 'utf8'), 'v2');
  assert.equal(await readFile(join(clone, '.env'), 'utf8'), 'ACCESS_CODE=4821\n');
  assert.deepEqual(lines, ['Song request est à jour (1 nouveauté) :', '  - Change app.js']);
});

test('a clone that is up to date is left alone, quietly', async () => {
  const { clone } = await setup();
  const lines = [];
  assert.equal(update(clone, (line) => lines.push(line)), 'current');
  assert.deepEqual(lines, []);
});

test('local changes are never overwritten', async () => {
  const { author, clone } = await setup();
  await publish(author, 'v2');
  await writeFile(join(clone, 'app.js'), 'mine');
  assert.equal(update(clone, () => {}), 'changed');
  assert.equal(await readFile(join(clone, 'app.js'), 'utf8'), 'mine');
});

test('local commits are never rewritten', async () => {
  const { author, clone } = await setup();
  await publish(author, 'v2');
  await commit(clone, 'app.js', 'mine');
  assert.equal(update(clone, () => {}), 'failed');
  assert.equal(await readFile(join(clone, 'app.js'), 'utf8'), 'mine');
});

test('a folder that is not a clone, such as an unzipped download, is left alone', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'song-request-zip-'));
  assert.equal(update(folder, () => {}), 'not-a-clone');
  assert.equal(existsSync(join(folder, '.git')), false);
});
