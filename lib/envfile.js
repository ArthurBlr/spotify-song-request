// Writes settings into a .env file. Only the local server uses this:
// hosted deployments keep their settings in the host's dashboard.

import { readFile, writeFile } from 'node:fs/promises';

/** Characters that cannot be stored safely in a quoted .env value. */
export const UNSAFE_VALUE = /["\\\r\n]/;

function format(value) {
  return /^[\w.-]*$/.test(value) ? value : `"${value}"`;
}

/** Sets KEY=value lines (file created if needed) and leaves every other line as it is. */
export async function saveEnv(file, values) {
  let text = '';
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  for (const [key, value] of Object.entries(values)) {
    if (UNSAFE_VALUE.test(value)) throw new Error(`${key} contains a character that .env cannot hold`);
    const line = `${key}=${format(value)}`;
    const existing = new RegExp(`^${key}=.*$`, 'm');
    if (existing.test(text)) text = text.replace(existing, () => line);
    else text += `${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`;
  }
  // The file holds the Spotify secret: readable by its owner only.
  await writeFile(file, text, { mode: 0o600 });
}
