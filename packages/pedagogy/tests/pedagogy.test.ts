import { describe, expect, it } from 'vitest';
import { isSound, pedagogyIssues, type BeatShape } from '../src/rosenshine';
import { planBeats, type LessonOutcome } from '../src/plan';

const beat = (over: Partial<BeatShape> & Pick<BeatShape, 'id' | 'role'>): BeatShape => ({
  teaches: [],
  checks: [],
  ...over,
});

/** The shape every rule is judged against: hook, teach, check, recap. */
const sound = (): BeatShape[] => [
  beat({ id: 'b1', role: 'hook' }),
  beat({ id: 'b2', role: 'teach', teaches: ['a'] }),
  beat({ id: 'b3', role: 'teach', teaches: ['b'] }),
  beat({ id: 'b4', role: 'check', checks: ['a', 'b'] }),
  beat({ id: 'b5', role: 'recap', checks: ['a', 'b'] }),
];

const rules = (beats: BeatShape[], opts = {}) => pedagogyIssues(beats, opts).map((i) => i.rule);

describe('the arc opens and closes correctly', () => {
  it('accepts a well-shaped lesson', () => {
    expect(pedagogyIssues(sound())).toEqual([]);
    expect(isSound(sound())).toBe(true);
  });

  it('demands a hook — teaching before attention is teaching to nobody', () => {
    const beats = sound();
    beats[0] = beat({ id: 'b1', role: 'teach', teaches: ['z'] });
    expect(rules(beats)).toContain('no-hook');
  });

  it('will not let the hook teach: its job is to buy attention', () => {
    const beats = sound();
    beats[0] = beat({ id: 'b1', role: 'hook', teaches: ['z'] });
    expect(rules(beats)).toContain('hook-teaches');
  });

  it('demands a recap, and one that retrieves rather than adds', () => {
    const noRecap = sound();
    noRecap[noRecap.length - 1] = beat({ id: 'b5', role: 'teach', teaches: ['c'] });
    expect(rules(noRecap)).toContain('no-recap');

    const fatRecap = sound();
    fatRecap[fatRecap.length - 1] = beat({ id: 'b5', role: 'recap', teaches: ['c'] });
    expect(rules(fatRecap)).toContain('recap-teaches');
  });

  it('says so plainly for an empty lesson rather than passing it', () => {
    expect(pedagogyIssues([])).toHaveLength(1);
  });
});

describe('cognitive load', () => {
  it('rejects a beat that introduces three new ideas at once', () => {
    const beats = sound();
    beats[1] = beat({ id: 'b2', role: 'teach', teaches: ['a', 'b', 'c'] });
    expect(rules(beats)).toContain('too-much-at-once');
  });

  it('allows two, which is the stated limit', () => {
    const beats = [
      beat({ id: 'b1', role: 'hook' }),
      beat({ id: 'b2', role: 'teach', teaches: ['a', 'b'] }),
      beat({ id: 'b3', role: 'check', checks: ['a', 'b'] }),
      beat({ id: 'b4', role: 'recap', checks: ['a', 'b'] }),
    ];
    expect(rules(beats)).not.toContain('too-much-at-once');
  });
});

describe('checking often enough', () => {
  it('flags a long run of new material with nothing asking', () => {
    const beats = [
      beat({ id: 'b1', role: 'hook' }),
      beat({ id: 'b2', role: 'teach', teaches: ['a', 'b'] }),
      beat({ id: 'b3', role: 'teach', teaches: ['c', 'd'] }),
      beat({ id: 'b4', role: 'teach', teaches: ['e'] }),
      beat({ id: 'b5', role: 'recap', checks: ['a'] }),
    ];
    expect(rules(beats)).toContain('unchecked-run');
  });

  it('reports one run once, not once per beat after it', () => {
    const beats = [
      beat({ id: 'b1', role: 'hook' }),
      beat({ id: 'b2', role: 'teach', teaches: ['a', 'b'] }),
      beat({ id: 'b3', role: 'teach', teaches: ['c', 'd'] }),
      beat({ id: 'b4', role: 'teach', teaches: ['e', 'f'] }),
      beat({ id: 'b5', role: 'teach', teaches: ['g', 'h'] }),
      beat({ id: 'b6', role: 'recap', checks: ['a'] }),
    ];
    const runs = pedagogyIssues(beats).filter((i) => i.rule === 'unchecked-run');
    expect(runs.length).toBeLessThan(4);
  });

  it('will not check something no beat has taught', () => {
    const beats = sound();
    beats[3] = beat({ id: 'b4', role: 'check', checks: ['never-taught'] });
    expect(rules(beats)).toContain('check-before-teach');
  });
});

describe('modelling before independent work', () => {
  it('rejects asking a student to work alone with no example shown', () => {
    const beats = [
      beat({ id: 'b1', role: 'hook' }),
      beat({ id: 'b2', role: 'independent', teaches: ['a'] }),
      beat({ id: 'b3', role: 'recap', checks: ['a'] }),
    ];
    expect(rules(beats)).toContain('model-before-independent');
  });

  it('accepts it once a beat has worked one aloud', () => {
    const beats = [
      beat({ id: 'b1', role: 'hook' }),
      beat({ id: 'b2', role: 'model', teaches: ['a'] }),
      beat({ id: 'b3', role: 'independent', teaches: ['b'] }),
      beat({ id: 'b4', role: 'recap', checks: ['a', 'b'] }),
    ];
    expect(rules(beats)).not.toContain('model-before-independent');
  });
});

describe('prerequisite order inside the lesson', () => {
  const prerequisites = new Map([['b', ['a']]]);

  it('rejects teaching something before what it rests on', () => {
    const beats = [
      beat({ id: 'b1', role: 'hook' }),
      beat({ id: 'b2', role: 'teach', teaches: ['b'] }),
      beat({ id: 'b3', role: 'teach', teaches: ['a'] }),
      beat({ id: 'b4', role: 'recap', checks: ['a', 'b'] }),
    ];
    expect(rules(beats, { prerequisites })).toContain('prerequisite-order');
  });

  it('ignores prerequisites this lesson never claims to teach', () => {
    // "a" came from an earlier lesson; requiring it here would make every
    // lesson teach the whole chapter.
    const beats = [
      beat({ id: 'b1', role: 'hook' }),
      beat({ id: 'b2', role: 'teach', teaches: ['b'] }),
      beat({ id: 'b3', role: 'recap', checks: ['b'] }),
    ];
    expect(rules(beats, { prerequisites })).not.toContain('prerequisite-order');
  });

  it('catches the same outcome introduced twice', () => {
    const beats = [
      beat({ id: 'b1', role: 'hook' }),
      beat({ id: 'b2', role: 'teach', teaches: ['a'] }),
      beat({ id: 'b3', role: 'teach', teaches: ['a'] }),
      beat({ id: 'b4', role: 'recap', checks: ['a'] }),
    ];
    expect(rules(beats)).toContain('taught-twice');
  });
});

describe('the lesson delivers what it promised', () => {
  it('names any required outcome no beat teaches', () => {
    const issues = pedagogyIssues(sound(), { required: ['a', 'b', 'missing'] });
    expect(issues.map((i) => i.rule)).toEqual(['outcome-not-taught']);
    expect(issues[0].message).toContain('missing');
  });
});

// ─────────────────────────────────────────────────────────────────────────

const outcome = (id: string, difficulty: number, prerequisites: string[] = []): LessonOutcome => ({
  id,
  difficulty,
  prerequisites,
});

describe('planBeats — backward design', () => {
  /** The real Class 9 ladder from the map: d1 recall up to a d4 estimate. */
  const ladder = (): LessonOutcome[] => [
    outcome('particles', 1),
    outcome('matter', 1, ['particles']),
    outcome('space-between', 2, ['particles']),
    outcome('everyday', 2, ['space-between']),
    outcome('dilution', 2, ['particles']),
    outcome('factor', 3, ['dilution']),
    outcome('size-limit', 4, ['factor']),
  ];

  it('produces a plan its own rules accept', () => {
    const beats = planBeats(ladder());
    const prerequisites = new Map(ladder().map((o) => [o.id, o.prerequisites]));
    expect(pedagogyIssues(beats, { prerequisites, required: ladder().map((o) => o.id) })).toEqual(
      [],
    );
  });

  it('opens on a hook and closes on a recap, neither teaching', () => {
    const beats = planBeats(ladder());
    expect(beats[0].role).toBe('hook');
    expect(beats[0].teaches).toEqual([]);
    expect(beats[beats.length - 1].role).toBe('recap');
    expect(beats[beats.length - 1].teaches).toEqual([]);
  });

  it('teaches every outcome exactly once', () => {
    const taught = planBeats(ladder()).flatMap((b) => b.teaches);
    expect([...taught].sort()).toEqual(ladder().map((o) => o.id).sort());
  });

  it('never teaches an outcome before what it rests on', () => {
    const beats = planBeats(ladder());
    const at = new Map<string, number>();
    beats.forEach((b, i) => b.teaches.forEach((id) => at.set(id, i)));
    for (const o of ladder()) {
      for (const p of o.prerequisites) {
        expect(at.get(p)!, `${p} before ${o.id}`).toBeLessThan(at.get(o.id)!);
      }
    }
  });

  it('models before it ever asks the student to work alone', () => {
    const beats = planBeats(ladder());
    const model = beats.findIndex((b) => b.role === 'model');
    const independent = beats.findIndex((b) => b.role === 'independent');
    expect(model).toBeGreaterThan(-1);
    if (independent > -1) expect(model).toBeLessThan(independent);
  });

  it('climbs: easy work is done before the hard work starts', () => {
    const beats = planBeats(ladder());
    const at = new Map<string, number>();
    beats.forEach((b, i) => b.teaches.forEach((id) => at.set(id, i)));
    expect(at.get('particles')!).toBeLessThan(at.get('size-limit')!);
  });

  it('is deterministic — the same outcomes give the same plan', () => {
    expect(planBeats(ladder())).toEqual(planBeats(ladder()));
  });

  it('still returns a usable arc when there is nothing to teach', () => {
    const beats = planBeats([]);
    expect(beats.map((b) => b.role)).toEqual(['hook', 'recap']);
  });

  it('lands inside the 6-12 beats the lesson format allows', () => {
    const beats = planBeats(ladder());
    expect(beats.length).toBeGreaterThanOrEqual(6);
    expect(beats.length).toBeLessThanOrEqual(12);
  });
});
