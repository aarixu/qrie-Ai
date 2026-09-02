import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

/**
 * PUSH THE RELAY'S SECRETS, WITHOUT ANYBODY TYPING ONE.
 *
 * The alternative is a list of `supabase secrets set KEY=value` commands in a
 * chat window, which puts a live key in three places it should never be: a
 * terminal history, a scrollback buffer, and whatever synced that scrollback.
 * This reads them out of the file they already live in and hands them to the
 * CLI through a temporary env file that is deleted afterwards.
 *
 * It also MAKES the ticket secret if there is not one, because "generate a long
 * random string" is a step people either skip or do badly. It is written back
 * into .env.local — which is gitignored — so the same secret survives the next
 * deploy. A new one would invalidate every speech ticket in flight, which is a
 * class going quiet mid-sentence for every student at once.
 *
 * Supabase supplies SUPABASE_URL, SUPABASE_ANON_KEY and
 * SUPABASE_SERVICE_ROLE_KEY to a function itself. Setting those by hand is
 * both unnecessary and refused.
 *
 * Run: node tools/bin/relay-secrets.mjs
 */

const ROOT = process.cwd();
const ENV_FILE = path.join(ROOT, '.env.local');

/** What the deployed relay needs that Supabase does not already give it. */
const WANTED = ['OPENROUTER_API_KEY', 'RELAY_TICKET_SECRET'];

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const at = line.indexOf('=');
    if (at < 1 || line.trimStart().startsWith('#')) continue;
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

const env = readEnv(ENV_FILE);

if (!env.OPENROUTER_API_KEY) {
  console.error(
    `No OPENROUTER_API_KEY in ${path.relative(ROOT, ENV_FILE)}.\n` +
      'That is the one key the browser must never see and the relay cannot work without.',
  );
  process.exit(1);
}

/**
 * The signing secret for speech tickets.
 *
 * 48 random bytes, base64. Made once and kept, for the reason above — and made
 * HERE rather than asked for, because a secret somebody invented by hand is a
 * secret somebody could invent again.
 */
if (!env.RELAY_TICKET_SECRET) {
  env.RELAY_TICKET_SECRET = crypto.randomBytes(48).toString('base64');
  fs.appendFileSync(
    ENV_FILE,
    `\n# Signs the short-lived passes the speech relay accepts, because an\n` +
      `# <audio> element cannot send an Authorization header. Generated once by\n` +
      `# tools/bin/relay-secrets.mjs; changing it silences every class in flight.\n` +
      `RELAY_TICKET_SECRET=${env.RELAY_TICKET_SECRET}\n`,
  );
  console.log(`Made a RELAY_TICKET_SECRET and saved it in ${path.relative(ROOT, ENV_FILE)}.`);
}

// A temp file rather than command-line arguments: an argument is visible to
// every other process on the machine while it runs, and lands in shell history.
const temp = path.join(ROOT, `.relay-secrets.${process.pid}.env`);
fs.writeFileSync(temp, WANTED.map((k) => `${k}=${env[k]}`).join('\n') + '\n');

try {
  console.log(`Pushing ${WANTED.join(', ')} to the linked Supabase project…`);
  /**
   * `shell: true`, and the failure is CHECKED.
   *
   * Without the shell, spawnSync could not resolve npx on Windows and returned
   * a spawn error rather than an exit code — so `run.status ?? 1` read as
   * undefined, the script printed its "pushing…" line, exited 0, and set
   * nothing at all. A deploy tool that reports success while doing nothing is
   * worse than one that crashes.
   */
  const run = spawnSync('npx supabase secrets set --env-file ' + JSON.stringify(temp), {
    stdio: 'inherit',
    shell: true,
  });
  if (run.error) {
    console.error(`Could not run the Supabase CLI: ${run.error.message}`);
    process.exitCode = 1;
  } else if (run.status !== 0) {
    console.error(`The CLI refused the secrets (exit ${run.status}).`);
    process.exitCode = run.status ?? 1;
  } else {
    console.log('Done.');
  }
} finally {
  // Always, including on a failed push or a Ctrl-C.
  fs.rmSync(temp, { force: true });
}
