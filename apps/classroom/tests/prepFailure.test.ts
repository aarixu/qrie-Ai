import { afterEach, describe, expect, it, vi } from 'vitest';

const tracked = vi.hoisted(() => ({ calls: [] as [string, Record<string, unknown>][] }));
vi.mock('../src/lib/telemetry', () => ({
  track: (event: string, props: Record<string, unknown>) => void tracked.calls.push([event, props]),
}));

import { reportPrepFailure } from '../src/lib/prepFailure';

describe('a preparation refused for its maths', () => {
  afterEach(() => {
    tracked.calls.length = 0;
    vi.restoreAllMocks();
  });

  it('logs the lines and reasons, and sends their ids and reasons to telemetry', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const problems = [{ rule: 'maths', where: 'b2_10', message: '`2x = 8` gives x = 4, but the next line says x = 5' }];
    reportPrepFailure(Object.assign(new Error('does not add up'), { mathsProblems: problems }));
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('did not add up'), problems);
    expect(tracked.calls).toEqual([
      ['prep_refused', { rule: 'maths', lines: 1, problems: [{ where: 'b2_10', message: problems[0].message }] }],
    ]);
  });

  it('says nothing about any other failure', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    reportPrepFailure(new Error('network'));
    reportPrepFailure('a string');
    expect(logged).not.toHaveBeenCalled();
    expect(tracked.calls).toEqual([]);
  });
});
