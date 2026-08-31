import { describe, expect, it } from 'vitest';
import { parseVerdict } from '../src/lib/judge';

describe('holding the judge to shape', () => {
  it('takes a clean verdict', () => {
    const v = parseVerdict('{"verdict":"right","say":"And why does that work? Because the gaps hold it."}');
    expect(v.verdict).toBe('right');
    expect(v.say).toContain('gaps');
  });

  it('digs the JSON out of a chatty reply', () => {
    const v = parseVerdict(
      'Sure! Here is my judgement:\n{"verdict":"wrong","say":"Think about where the smell goes."}',
    );
    expect(v.verdict).toBe('wrong');
  });

  it('treats an invented verdict as unclear rather than trusting it', () => {
    const v = parseVerdict('{"verdict":"amazing","say":"Say that once more?"}');
    expect(v.verdict).toBe('unclear');
  });

  it('refuses a verdict with nothing to say - silence is not teaching', () => {
    expect(() => parseVerdict('{"verdict":"right","say":""}')).toThrow();
    expect(() => parseVerdict('no json at all')).toThrow();
  });
});

describe('holding the close to shape', () => {
  it('takes the closing line', async () => {
    const { parseFollowUp } = await import('../src/lib/judge');
    expect(parseFollowUp('{"say":"Exactly - the gaps hold it, so the level stays."}')).toContain('gaps');
  });

  it('refuses a wordless close', async () => {
    const { parseFollowUp } = await import('../src/lib/judge');
    expect(() => parseFollowUp('{"say":"  "}')).toThrow();
    expect(() => parseFollowUp('nope')).toThrow();
  });
});
