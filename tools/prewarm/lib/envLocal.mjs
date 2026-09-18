/**
 * .env.local, read once and defensively.
 *
 * Three tools in this phase read that file (the runner, cost-report,
 * apply-prices) and two of them used to read it UNGUARDED — so on a machine
 * without .env.local the operator got a raw ENOENT stack trace instead of the
 * carefully worded "you need the service role key" refusal that was written
 * for exactly that moment. A missing file is an ordinary state here, not a
 * fault: it means this machine holds no project secrets, which is the normal
 * condition of the machine an operator runs the pre-warm from.
 *
 * Never writes, never logs, never returns a default for a key it did not find.
 */
import fs from 'node:fs';

export function readEnvLocal(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  );
}
