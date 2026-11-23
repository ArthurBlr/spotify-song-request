import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseEnv } from 'node:util';

import { saveEnv } from '../lib/envfile.js';

async function tempEnvFile() {
  return join(await mkdtemp(join(tmpdir(), 'song-request-')), '.env');
}

test('saveEnv creates a private file that Node reads back unchanged', async () => {
  const file = await tempEnvFile();
  const values = { SPOTIFY_CLIENT_ID: 'abc123', ACCESS_CODE: 'café du 3e #1' };
  await saveEnv(file, values);
  assert.deepEqual({ ...parseEnv(await readFile(file, 'utf8')) }, values);
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test('saveEnv replaces only the given keys and keeps the other lines', async () => {
  const file = await tempEnvFile();
  await writeFile(file, '# mes réglages\nCOOLDOWN_SECONDS=10\nSPOTIFY_REFRESH_TOKEN=old');
  await saveEnv(file, { SPOTIFY_REFRESH_TOKEN: 'AQ$1-new_token', ACCESS_CODE: '4821' });
  assert.equal(
    await readFile(file, 'utf8'),
    '# mes réglages\nCOOLDOWN_SECONDS=10\nSPOTIFY_REFRESH_TOKEN="AQ$1-new_token"\nACCESS_CODE=4821\n',
  );
  assert.equal(parseEnv(await readFile(file, 'utf8')).SPOTIFY_REFRESH_TOKEN, 'AQ$1-new_token');
});

test('saveEnv refuses values a .env file cannot hold', async () => {
  const file = await tempEnvFile();
  await assert.rejects(saveEnv(file, { ACCESS_CODE: 'a"b' }));
  await assert.rejects(saveEnv(file, { ACCESS_CODE: 'a\nb' }));
});
