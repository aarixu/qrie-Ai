import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { validateLesson } from '../src/index';

/**
 * The whyProbe is the MVP-1 half of the Rs 5 fix: the class carries its own
 * pre-authored judgement, so the playback judge (Rs 18.70/student-hour) is not
 * called for the answers a planner could see coming. These tests hold the
 * VALIDATOR to the format's promises — exactly one correct option, a spoken
 * "why" on every option, 2 to 4 options — because the player will trust every
 * one of them without a model in the loop to notice a hole.
 */

const fixturePath = path.resolve(
  process.cwd(),
  'packages/lesson-format/tests/fixtures/heart.lesson.json',
);
const fixture = () => JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as Record<string, unknown>;

type LooseBeat = {
  ask?: {
    question: string;
    options?: unknown;
    whyProbe?: unknown;
  };
  checks?: string[];
};

/** The fixture with an ask (and optionally a whyProbe) planted on its first beat. */
const withAsk = (ask: LooseBeat['ask'], checks?: string[]): Record<string, unknown> => {
  const doc = fixture();
  const beat = (doc.beats as LooseBeat[])[0];
  beat.ask = ask;
  if (checks) beat.checks = checks;
  return doc;
};

const goodProbe = {
  askedAs: 'open' as const,
  options: [
    { text: 'the heart has four chambers', correct: true, why: 'Right — two atria on top, two ventricles below.' },
    {
      text: 'the heart has three chambers',
      why: 'That is a frog heart. Yours has four, so used and fresh blood never mix.',
      hint: 'Count the top pair and the bottom pair separately.',
    },
  ],
};

describe('whyProbe validation', () => {
  it('accepts an ask carrying a well-formed whyProbe', () => {
    const r = validateLesson(withAsk({ question: 'How many chambers?', whyProbe: goodProbe }));
    expect(r.ok, r.ok ? '' : (r as { errors: string[] }).errors.join('\n')).toBe(true);
  });

  it('still accepts an ask with no whyProbe at all — 15 committed lessons have none', () => {
    const r = validateLesson(withAsk({ question: 'How many chambers?' }));
    expect(r.ok).toBe(true);
  });

  it('rejects a whyProbe with no correct option', () => {
    const probe = {
      ...goodProbe,
      options: goodProbe.options.map((o) => ({ ...o, correct: undefined })),
    };
    const r = validateLesson(withAsk({ question: 'Q?', whyProbe: probe }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/exactly one/i);
  });

  it('rejects a whyProbe with two correct options', () => {
    const probe = {
      ...goodProbe,
      options: goodProbe.options.map((o) => ({ ...o, correct: true })),
    };
    const r = validateLesson(withAsk({ question: 'Q?', whyProbe: probe }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/exactly one/i);
  });

  it('rejects an option without a why — the why is what she says', () => {
    const probe = {
      ...goodProbe,
      options: [goodProbe.options[0], { text: 'three chambers' }],
    };
    const r = validateLesson(withAsk({ question: 'Q?', whyProbe: probe }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/why/);
  });

  it('rejects fewer than two and more than four options', () => {
    const one = { ...goodProbe, options: [goodProbe.options[0]] };
    const five = {
      ...goodProbe,
      options: [
        goodProbe.options[0],
        ...[1, 2, 3, 4].map((n) => ({ text: `wrong ${n}`, why: `no, because ${n}` })),
      ],
    };
    expect(validateLesson(withAsk({ question: 'Q?', whyProbe: one })).ok).toBe(false);
    expect(validateLesson(withAsk({ question: 'Q?', whyProbe: five })).ok).toBe(false);
  });

  it('rejects an askedAs outside options|open', () => {
    const r = validateLesson(
      withAsk({ question: 'Q?', whyProbe: { ...goodProbe, askedAs: 'quiz' } }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/askedAs/);
  });
});

describe('the checks cap on ask beats (PRD-4 req 2)', () => {
  it('rejects an ask beat that checks three outcomes', () => {
    const r = validateLesson(
      withAsk({ question: 'Q?' }, ['lo-one', 'lo-two', 'lo-three']),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/at most (two|2)/i);
  });

  it('accepts an ask beat that checks two', () => {
    expect(validateLesson(withAsk({ question: 'Q?' }, ['lo-one', 'lo-two'])).ok).toBe(true);
  });

  it('leaves an askless beat with three checks alone — class10-excretion has one', () => {
    // The recap beat in content/class10-excretion/lesson.json carries three
    // checks and no ask. The cap is about one ANSWER being filed as evidence
    // about too many things, so it binds only where an answer exists.
    const doc = fixture();
    (doc.beats as LooseBeat[])[0].checks = ['lo-one', 'lo-two', 'lo-three'];
    expect(validateLesson(doc).ok).toBe(true);
  });
});

/**
 * C6/C7 (2026-09-29): an ask may carry a worked example of a SIMILAR problem
 * (the L5 rung) and each whyProbe distractor a diagnostic follow-up. Both are
 * optional; when present they are held to a shape the player can trust.
 */
describe('worked example and follow-up (C6/C7)', () => {
  const worked = {
    steps: [
      { say: 'Here is a similar one: three y plus five is twenty.', line: '3y + 5 = 20' },
      { say: 'Take five from both sides.', line: '3y = 15' },
    ],
  };

  it('accepts a well-formed worked example and a distractor follow-up', () => {
    const probe = {
      ...goodProbe,
      options: [goodProbe.options[0], { ...goodProbe.options[1], followUp: 'How many chambers did you count on the top?' }],
    };
    const r = validateLesson(withAsk({ question: 'How many chambers?', whyProbe: probe, workedExample: worked } as LooseBeat['ask']));
    expect(r.ok, r.ok ? '' : (r as { errors: string[] }).errors.join('\n')).toBe(true);
  });

  it('refuses a worked example with a blank step or too many steps', () => {
    const blank = validateLesson(withAsk({ question: 'Q?', workedExample: { steps: [{ say: '', line: 'x' }] } } as LooseBeat['ask']));
    expect(blank.ok).toBe(false);
    const long = validateLesson(
      withAsk({ question: 'Q?', workedExample: { steps: Array.from({ length: 7 }, () => ({ say: 's', line: 'l' })) } } as LooseBeat['ask']),
    );
    expect(long.ok).toBe(false);
  });

  it('refuses a follow-up that is not a non-empty string', () => {
    const probe = { ...goodProbe, options: [goodProbe.options[0], { ...goodProbe.options[1], followUp: '' }] };
    expect(validateLesson(withAsk({ question: 'Q?', whyProbe: probe })).ok).toBe(false);
  });
});
