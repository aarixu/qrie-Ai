import { FIRST_BUILD } from './app-readers.ts';

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

/**
 * What changing a switch does, said before it is confirmed: which apps obey and
 * whether the database enforces it (lib/app-readers.ts lists who reads what).
 */
export function describeFlagChange(key: string, value: unknown): string {
  switch (key) {
    case 'tutor.enabled':
      return value === false
        ? 'The database refuses new tutor classes for every child, at a school or not, except at a school whose own switch is on;' +
            ' the tutor app shows them a pause notice with the helplines, from which they can still send a report and open Settings and Help.' +
            " A report already waiting on a phone is still delivered. Teachers' Draft with AI is not affected."
        : 'Children can take tutor classes again, except at a school whose own switch is off or whose licence is suspended.';
    case 'tutor.only_prepared':
      return value === true
        ? 'The tutor app lets children open only classes that are already prepared, and prepares no new one. Only the app obeys this: the relay does not check it.'
        : 'The tutor app lets children open any topic again, which prepares a new class when none exists (and costs money).';
    case 'tutor.compose_live_classes':
      return 'Saved, but nothing changes for children: no screen in this build reads it until the board composer is merged.';
    case 'contest.entries_open':
      return value === false
        ? 'The contest form says entries are closed, and the database refuses new entries. An entry already made can still be corrected.'
        : 'The contest form takes new entries again, up to the daily limit.';
    case 'contest.daily_limit':
      return `The database takes at most ${String(value)} new contest entries in one India day; after that, the form says entries are full until midnight.`;
    case 'banner.message':
      return value === ''
        ? 'The notice is removed from the tutor, student and teacher apps.'
        : `The tutor, student and teacher apps show this notice at the top: "${String(value)}".`;
    case 'banner.tone':
      return `The notice, when there is one, is shown as ${value === 'warning' ? 'a warning' : 'information'}.`;
    case 'app.min_version.classroom':
      return minimumLine('tutor app', FIRST_BUILD.classroom, value);
    case 'app.min_version.student':
      return minimumLine('student app', FIRST_BUILD.student, value);
    case 'app.min_version.lms':
      return minimumLine('teacher app', FIRST_BUILD.lms, value);
    default:
      return `Saved. No app reads ${key}.`;
  }
}

function minimumLine(app: string, firstBuild: string, value: unknown): string {
  if (value === '0.0.0') return `No ${app} build is asked to update.`;
  return `A ${app} older than ${String(value)} asks to be updated and opens nothing else. Builds older than ${firstBuild} do not read this and are not stopped.`;
}
