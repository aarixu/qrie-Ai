import { describe, expect, it } from 'vitest';
import { checkWrite, describeFlagChange } from '../src/lib/confirm.ts';

const ok = { expectedEnv: 'HOSTED', databaseEnv: 'HOSTED', typed: 'HOSTED', reason: 'vendor outage' };

describe('a write from the console', () => {
  it('goes ahead with the BUILD\'s environment as p_env, so the server judges it, and a trimmed reason', () => {
    expect(checkWrite({ ...ok, reason: '  vendor outage ' })).toEqual({ ok: true, env: 'HOSTED', reason: 'vendor outage' });
  });

  it('is refused when the build was made for another environment than the database says', () => {
    const v = checkWrite({ ...ok, expectedEnv: 'DEMO', typed: 'DEMO' });
    expect(v).toEqual({ ok: false, error: 'This build is for DEMO but the database says HOSTED. Nothing was changed.' });
  });

  it('is refused when the build has no environment at all', () => {
    expect(checkWrite({ ...ok, expectedEnv: '' }).ok).toBe(false);
  });

  it('wants the environment typed exactly', () => {
    expect(checkWrite({ ...ok, typed: 'hosted' })).toEqual({ ok: false, error: 'Type HOSTED to confirm.' });
    expect(checkWrite({ ...ok, typed: '' }).ok).toBe(false);
  });

  it('wants a reason of a few words', () => {
    expect(checkWrite({ ...ok, reason: ' x ' })).toEqual({ ok: false, error: 'Say why, in a few words.' });
  });
});

describe('what a switch change will touch, said before it happens', () => {
  // Each line names the apps that obey the switch and whether the database
  // enforces it (lib/app-readers.ts lists who reads what).

  it('tutor.enabled: the database refuses classes, the tutor app pauses, reports still go', () => {
    expect(describeFlagChange('tutor.enabled', false)).toBe(
      'The database refuses new tutor classes for every child, at a school or not, except at a school whose own switch is on;' +
        ' the tutor app shows them a pause notice with the helplines. A report already waiting on a phone is still delivered.',
    );
    expect(describeFlagChange('tutor.enabled', true)).toBe(
      'Children can take tutor classes again, except at a school whose own switch is off or whose licence is suspended.',
    );
  });

  it('tutor.only_prepared: only the tutor app obeys it', () => {
    expect(describeFlagChange('tutor.only_prepared', true)).toBe(
      'The tutor app lets children open only classes that are already prepared, and prepares no new one. Only the app obeys this: the relay does not check it.',
    );
    expect(describeFlagChange('tutor.only_prepared', false)).toBe(
      'The tutor app lets children open any topic again, which prepares a new class when none exists (and costs money).',
    );
  });

  it('tutor.compose_live_classes: saved, and nothing reads it in this build', () => {
    const line = 'Saved, but nothing changes for children: no screen in this build reads it until the board composer is merged.';
    expect(describeFlagChange('tutor.compose_live_classes', true)).toBe(line);
    expect(describeFlagChange('tutor.compose_live_classes', false)).toBe(line);
  });

  it('the contest switches: the form says so and the database refuses', () => {
    expect(describeFlagChange('contest.entries_open', false)).toBe(
      'The contest form says entries are closed, and the database refuses new entries. An entry already made can still be corrected.',
    );
    expect(describeFlagChange('contest.entries_open', true)).toBe('The contest form takes new entries again, up to the daily limit.');
    expect(describeFlagChange('contest.daily_limit', 500)).toBe(
      'The database takes at most 500 new contest entries in one India day; after that, the form says entries are full until midnight.',
    );
  });

  it('the banner names the three apps that show it', () => {
    expect(describeFlagChange('banner.message', '')).toBe('The notice is removed from the tutor, student and teacher apps.');
    expect(describeFlagChange('banner.message', 'Back at 7 pm')).toBe(
      'The tutor, student and teacher apps show this notice at the top: "Back at 7 pm".',
    );
    expect(describeFlagChange('banner.tone', 'warning')).toBe('The notice, when there is one, is shown as a warning.');
    expect(describeFlagChange('banner.tone', 'info')).toBe('The notice, when there is one, is shown as information.');
  });

  it('a minimum build names the app and the first build that reads it', () => {
    expect(describeFlagChange('app.min_version.student', '0.2.0')).toBe(
      'A student app older than 0.2.0 asks to be updated and opens nothing else. Builds older than 0.1.0 do not read this and are not stopped.',
    );
    expect(describeFlagChange('app.min_version.classroom', '0.3.0')).toBe(
      'A tutor app older than 0.3.0 asks to be updated and opens nothing else. Builds older than 0.1.0 do not read this and are not stopped.',
    );
    expect(describeFlagChange('app.min_version.lms', '3.0.0')).toBe(
      'A teacher app older than 3.0.0 asks to be updated and opens nothing else. Builds older than 2.3.0 do not read this and are not stopped.',
    );
    expect(describeFlagChange('app.min_version.lms', '0.0.0')).toBe('No teacher app build is asked to update.');
  });

  it('a key no app reads says so', () => {
    expect(describeFlagChange('x.unknown', 1)).toBe('Saved. No app reads x.unknown.');
  });

  it('no line says no app reads the switches', () => {
    const cases: [string, unknown][] = [
      ['tutor.enabled', false],
      ['tutor.enabled', true],
      ['tutor.only_prepared', true],
      ['tutor.only_prepared', false],
      ['tutor.compose_live_classes', true],
      ['contest.entries_open', false],
      ['contest.entries_open', true],
      ['contest.daily_limit', 500],
      ['banner.message', ''],
      ['banner.message', 'Back at 7 pm'],
      ['banner.tone', 'warning'],
      ['banner.tone', 'info'],
      ['app.min_version.student', '0.2.0'],
      ['app.min_version.classroom', '0.3.0'],
      ['app.min_version.lms', '3.0.0'],
      ['app.min_version.lms', '0.0.0'],
    ];
    for (const [key, value] of cases) expect(describeFlagChange(key, value)).not.toMatch(/plan 4|No app reads this switch yet/);
  });
});
