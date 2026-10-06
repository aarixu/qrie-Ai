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
  it('pausing the tutor names everybody it reaches', () => {
    expect(describeFlagChange('tutor.enabled', false)).toBe("The tutor pauses for every child at every school until it is switched back on.");
  });

  it('a banner says where it appears, and removing it says so', () => {
    expect(describeFlagChange('banner.message', 'Back at 7 pm')).toBe('Every app shows this notice at the top: "Back at 7 pm".');
    expect(describeFlagChange('banner.message', '')).toBe('The notice is removed from every app.');
  });

  it('closing the contest says what stops', () => {
    expect(describeFlagChange('contest.entries_open', false)).toBe('The contest form stops taking entries.');
  });

  it('any other switch still says it reaches every app that reads it', () => {
    expect(describeFlagChange('app.min_version.lms', '2.0.0')).toBe('Every app that reads app.min_version.lms follows the new value: "2.0.0".');
  });
});
