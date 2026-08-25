import fs from 'node:fs';
import path from 'node:path';

/**
 * Keys, read from a file the repo never commits.
 *
 * Every authoring tool calls this first, so a key is pasted once into
 * `.env.local` at the repo root rather than exported into every shell that
 * ever runs a generation. A key that has to be re-exported is a key that gets
 * pasted into a command line, and a command line is shell history.
 *
 * Real environment variables always win: a CI run or a one-off
 * `OPENROUTER_MODEL=... node tools/...` must not be silently overridden by a
 * file someone edited last week.
 */

/** Files tried in order; every one that exists is read, first value wins. */
const CANDIDATES = ['.env.local', '.env'];

const UNQUOTE = /^(['"])(.*)\1$/s;

/** Parse `KEY=value` lines. Blank lines and # comments are skipped. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key in out) continue;
    out[key] = UNQUOTE.exec(value)?.[2] ?? value;
  }
  return out;
}

/**
 * Load the repo-root env files into `process.env`, without clobbering anything
 * already set there. Returns the names it filled in, for a startup line that
 * says where the key came from.
 */
export function loadEnvFiles(root: string = process.cwd()): string[] {
  const filled: string[] = [];
  for (const name of CANDIDATES) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    for (const [key, value] of Object.entries(parseEnvFile(fs.readFileSync(file, 'utf8')))) {
      if (process.env[key] !== undefined) continue;
      process.env[key] = value;
      filled.push(key);
    }
  }
  return filled;
}
