/**
 * EVERY WRITE FROM THE CONSOLE PASSES HERE FIRST. Pure, so the rules are tested.
 *
 * The environment sent to the database (p_env) is the one this BUILD was made for
 * (VITE_ADMIN_ENV), never the database's own answer: the server compares the two
 * and refuses a mismatch, so a console built for DEMO and pointed at the live
 * database cannot change it. The person also types the environment, and gives a
 * reason, on every write.
 */
export interface WriteCheck {
  /** VITE_ADMIN_ENV: the environment this build was made for. */
  expectedEnv: string;
  /** What the database says it is (admin.me().environment). */
  databaseEnv: string;
  /** What the person typed to confirm. */
  typed: string;
  reason: string;
}

export type WriteVerdict = { ok: true; env: string; reason: string } | { ok: false; error: string };

export function checkWrite(c: WriteCheck): WriteVerdict {
  const expected = c.expectedEnv.trim();
  if (!expected) return { ok: false, error: 'This build has no environment set (VITE_ADMIN_ENV), so it cannot change anything.' };
  if (expected !== c.databaseEnv) {
    return { ok: false, error: `This build is for ${expected} but the database says ${c.databaseEnv}. Nothing was changed.` };
  }
  if (c.typed.trim() !== expected) return { ok: false, error: `Type ${expected} to confirm.` };
  const reason = c.reason.trim();
  if (reason.length < 3) return { ok: false, error: 'Say why, in a few words.' };
  return { ok: true, env: expected, reason };
}

/** Nothing in apps/, packages/ or supabase/functions reads public.app_config yet; plan 4 wires the apps to it. */
export const SWITCH_NOT_READ = 'No app reads this switch yet (plan 4)';

/** The blast-radius line shown before a switch changes: that no app reads it yet, then what it will do once they do. */
export function describeFlagChange(key: string, value: unknown): string {
  const effect = flagEffect(key, value);
  return `${SWITCH_NOT_READ}. Once the apps read it: ${effect.charAt(0).toLowerCase()}${effect.slice(1)}`;
}

function flagEffect(key: string, value: unknown): string {
  switch (key) {
    case 'tutor.enabled':
      return value === false
        ? 'The tutor pauses for every child at every school until it is switched back on.'
        : 'The tutor is offered again in every app.';
    case 'tutor.only_prepared':
      return value === true
        ? 'Children can open only classes that are already prepared; no new class is prepared for them.'
        : 'Children can again open classes that have not been prepared yet, which prepares them (and costs money).';
    case 'contest.entries_open':
      return value === false ? 'The contest form stops taking entries.' : 'The contest form takes entries again.';
    case 'banner.message':
      return value === '' ? 'The notice is removed from every app.' : `Every app shows this notice at the top: "${String(value)}".`;
    default:
      return `Every app that reads ${key} follows the new value: ${JSON.stringify(value)}.`;
  }
}
