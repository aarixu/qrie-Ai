import { describe, expect, it } from 'vitest';
import { parseVerdict, reviewerUser, reviewLesson } from '../src/review';
import { prepareClass, type LlmAdapter } from '../src/prepare';
import type { Blueprint } from '../src/types';
import type { Lesson } from '@ai-tutor/lesson-format';

/**
 * THE FACTUAL GATE. Nothing else anywhere checks whether a generated lesson
 * is TRUE: verifySvg reads markup, validateLesson reads structure, and a
 * wrong class is kept permanently and served to everyone after.
 *
 * Model judgement itself cannot be unit-tested, so every SEAM around it is:
 * the prompt carries the claims and the syllabus context, the parser survives
 * a model reply, a flagged lesson gets exactly one named-problem repair, and
 * a double failure refuses rather than teaches. The judgement in the middle
 * is the reviewer model's, and these tests deliberately mock it.
 */

const wrongBlueprint: Blueprint = {
  id: 'heart-demo',
  title: 'The Heart',
  beats: [
    {
      id: 'b1',
      topic: 'chambers',
      narration: 'The heart has three chambers, and blood moves through them in turn.',
      board: [{ do: 'title', text: 'The Heart' }],
    },
  ],
  visuals: [],
};

const fixedBlueprint: Blueprint = {
  ...wrongBlueprint,
  beats: [
    {
      ...wrongBlueprint.beats[0],
      narration: 'The heart has four chambers, and blood moves through them in turn.',
    },
  ],
};

const outcomes = [
  { id: 'sci10-heart-chambers', statement: 'Name the four chambers of the human heart' },
];

const flagging = JSON.stringify({
  ok: false,
  problems: [
    {
      beatId: 'b1',
      claim: 'the heart has three chambers',
      why: 'the human heart has four chambers — two atria and two ventricles',
    },
  ],
});
const passing = JSON.stringify({ ok: true, problems: [] });

/** An adapter that replays scripted replies and records every prompt it saw. */
const scripted = (replies: string[]) => {
  const calls: { system: string; user: string }[] = [];
  let i = 0;
  const adapter: LlmAdapter = {
    complete: async (system, user) => {
      calls.push({ system, user });
      return replies[Math.min(i++, replies.length - 1)];
    },
  };
  return { adapter, calls };
};

describe('parseVerdict — the house LLM-stage parse, for verdicts', () => {
  it('reads a fenced verdict wrapped in prose', () => {
    const v = parseVerdict('Here is my review:\n```json\n' + flagging + '\n```\nDone.');
    expect(v).not.toBeNull();
    expect(v!.ok).toBe(false);
    expect(v!.problems[0].claim).toContain('three chambers');
  });

  it('returns null for garbage', () => {
    expect(parseVerdict('I could not review this lesson.')).toBeNull();
  });

  it('returns null for a flag with nothing named — a repair needs names to fuel it', () => {
    expect(parseVerdict(JSON.stringify({ ok: false, problems: [] }))).toBeNull();
    expect(parseVerdict(JSON.stringify({ ok: false }))).toBeNull();
  });

  it('returns null when a problem is missing its why', () => {
    expect(
      parseVerdict(JSON.stringify({ ok: false, problems: [{ beatId: 'b1', claim: 'x' }] })),
    ).toBeNull();
  });
});

describe('reviewerUser — the prompt carries the claims and the context', () => {
  it('puts the planted claim, the outcomes and the syllabus frame in front of the reviewer', async () => {
    const { adapter, calls } = scripted([passing]);
    const result = await prepareClass({
      topic: 'The Heart',
      klass: 10,
      planner: { complete: async () => JSON.stringify(wrongBlueprint) },
      artist: { complete: async () => '' },
      reviewer: adapter,
      outcomes,
    });
    expect(result.report.review).toMatchObject({ repaired: false, flagged: [] });
    const prompt = calls[0].user;
    // The claim the reviewer is supposed to catch is actually in front of it…
    expect(prompt).toContain('The heart has three chambers');
    // …beside the definitions it is checked against. No new data source.
    expect(prompt).toContain('Name the four chambers of the human heart');
    expect(prompt).toContain('The Heart');
    expect(prompt).toMatch(/class:?\s*10/i);
  });

  it('carries ask strings — expect, hint, whys — not only narration', () => {
    const lesson: Lesson = {
      formatVersion: 1,
      id: 'x',
      title: 'The Heart',
      language: 'en',
      canvas: { w: 1000, h: 620 },
      elements: [{ kind: 'title', id: 't1', x: 0, y: 0, text: 'The Heart' }],
      beats: [
        {
          id: 'b1',
          topic: 'chambers',
          narration: 'Count the chambers.',
          show: ['t1'],
          ask: {
            question: 'How many chambers does the heart have?',
            expect: 'four',
            whyProbe: {
              askedAs: 'open',
              options: [
                { text: 'four', correct: true, why: 'Two atria and two ventricles.' },
                { text: 'three', why: 'That is a frog heart, not yours.' },
              ],
            },
          },
        },
      ],
    };
    const prompt = reviewerUser(lesson, 'The Heart', 10, outcomes);
    expect(prompt).toContain('How many chambers does the heart have?');
    expect(prompt).toContain('That is a frog heart, not yours.');
  });
});

describe('the gate itself, around a mocked reviewer', () => {
  it('repairs a flagged lesson once, fuelled by the named problems', async () => {
    const reviewer = scripted([flagging, passing]);
    const planner = scripted([JSON.stringify(wrongBlueprint), JSON.stringify(fixedBlueprint)]);

    const result = await prepareClass({
      topic: 'The Heart',
      klass: 10,
      planner: planner.adapter,
      artist: { complete: async () => '' },
      reviewer: reviewer.adapter,
      outcomes,
    });

    // The repair prompt named the problem — the model was told WHAT is wrong,
    // not just that something is.
    expect(planner.calls[1].user).toContain('three chambers');
    expect(planner.calls[1].user).toContain('four chambers');
    // And the repaired teaching is what comes back.
    expect(result.lesson.beats[0].narration).toContain('four chambers');
    expect(result.report.review).toMatchObject({ repaired: true });
    expect(result.report.review!.flagged[0].claim).toContain('three chambers');
  });

  it('REFUSES a lesson still flagged after its one repair — never teaches it', async () => {
    const reviewer = scripted([flagging, flagging]);
    const planner = scripted([JSON.stringify(wrongBlueprint), JSON.stringify(wrongBlueprint)]);
    let draftSeen = false;

    await expect(
      prepareClass({
        topic: 'The Heart',
        klass: 10,
        planner: planner.adapter,
        artist: { complete: async () => '' },
        reviewer: reviewer.adapter,
        outcomes,
        onDraft: () => {
          draftSeen = true;
        },
      }),
    ).rejects.toThrow(/factual review/i);
    expect(draftSeen).toBe(false);
  });

  it('refuses when the reviewer cannot produce a readable verdict, twice', async () => {
    const reviewer = scripted(['not json', 'still not json']);
    await expect(
      prepareClass({
        topic: 'The Heart',
        klass: 10,
        planner: { complete: async () => JSON.stringify(fixedBlueprint) },
        artist: { complete: async () => '' },
        reviewer: reviewer.adapter,
      }),
    ).rejects.toThrow(/readable verdict/i);
  });

  it('runs the review BEFORE the room opens', async () => {
    const order: string[] = [];
    const reviewer: LlmAdapter = {
      complete: async () => {
        order.push('review');
        return passing;
      },
    };
    await prepareClass({
      topic: 'The Heart',
      klass: 10,
      planner: { complete: async () => JSON.stringify(fixedBlueprint) },
      artist: { complete: async () => '' },
      reviewer,
      onDraft: () => order.push('draft'),
    });
    expect(order).toEqual(['review', 'draft']);
  });

  it('without a reviewer, behaves exactly as before and says so in the report', async () => {
    const result = await prepareClass({
      topic: 'The Heart',
      klass: 10,
      planner: { complete: async () => JSON.stringify(fixedBlueprint) },
      artist: { complete: async () => '' },
    });
    expect(result.report.review).toBeUndefined();
  });
});

describe('reviewLesson standalone — exported for the keep-side wiring to come', () => {
  const lesson: Lesson = {
    formatVersion: 1,
    id: 'x',
    title: 'The Heart',
    language: 'en',
    canvas: { w: 1000, h: 620 },
    elements: [{ kind: 'title', id: 't1', x: 0, y: 0, text: 'The Heart' }],
    beats: [
      { id: 'b1', topic: 'chambers', narration: 'The heart has three chambers.', show: ['t1'] },
    ],
  };

  it('gives an unreadable first reply one JSON repair round, then reads it', async () => {
    const { adapter, calls } = scripted(['garbage', passing]);
    const verdict = await reviewLesson(lesson, {
      reviewer: adapter,
      topic: 'The Heart',
      klass: 10,
    });
    expect(verdict.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1].user).toMatch(/not valid JSON/i);
  });
});

/**
 * A REVIEWER THAT CONTRADICTS ITSELF IS A FLAG, NOT A PASS.
 *
 * `{"ok": true, "problems": [<a wrong claim, named>]}` is a plausible reply
 * from a model that fills every field it was shown, and reading only `ok`
 * taught the flagged class and wrote a report the keep side is told to read
 * as "reviewed and passed". Refusing costs one student one class; teaching it
 * costs every student who is ever served the kept copy.
 */
describe('a verdict that says ok while naming a wrong claim', () => {
  const contradictory = JSON.stringify({
    ok: true,
    problems: [
      {
        beatId: 'b1',
        claim: 'the heart has three chambers',
        why: 'the human heart has four chambers',
      },
    ],
  });

  it('parses as a FLAG — fail closed, in one place', () => {
    const v = parseVerdict(contradictory);
    expect(v).not.toBeNull();
    expect(v!.ok).toBe(false);
    expect(v!.problems[0].claim).toContain('three chambers');
  });

  it('is refused by the pipeline rather than taught', async () => {
    const reviewer = scripted([contradictory, contradictory]);
    const planner = scripted([JSON.stringify(wrongBlueprint), JSON.stringify(wrongBlueprint)]);
    let draftSeen = false;
    await expect(
      prepareClass({
        topic: 'The Heart',
        klass: 10,
        planner: planner.adapter,
        artist: { complete: async () => '' },
        reviewer: reviewer.adapter,
        outcomes,
        onDraft: () => {
          draftSeen = true;
        },
      }),
    ).rejects.toThrow(/factual review/i);
    expect(draftSeen).toBe(false);
  });
});

/**
 * THE REPAIR MUST NAME A BEAT THE PLANNER HAS. The reviewer judges the
 * ASSEMBLED lesson, whose beats are split one per spoken moment and renamed
 * `<id>_<n>`; the repair prompt hands the planner the BLUEPRINT, whose beats
 * carry the unsuffixed id. Naming `b1_2` to a model holding `b1` aims the one
 * repair round this design allows at a beat that does not exist.
 */
describe('the factual repair prompt speaks the planner’s own ids', () => {
  const multiSay: Blueprint = {
    id: 'heart-demo',
    title: 'The Heart',
    beats: [
      {
        id: 'b1',
        topic: 'chambers',
        narration: '',
        board: [
          { do: 'title', text: 'The Heart' },
          { do: 'say', text: 'Blood comes back from the body.' },
          { do: 'say', text: 'The heart has three chambers.' },
        ],
      },
    ],
    visuals: [],
  };

  it('strips the assembled sub-beat suffix and leads with the claim', async () => {
    const reviewer = scripted([
      JSON.stringify({
        ok: false,
        problems: [
          { beatId: 'b1_3', claim: 'The heart has three chambers.', why: 'it has four' },
        ],
      }),
      passing,
    ]);
    const planner = scripted([JSON.stringify(multiSay), JSON.stringify(multiSay)]);
    await prepareClass({
      topic: 'The Heart',
      klass: 10,
      planner: planner.adapter,
      artist: { complete: async () => '' },
      reviewer: reviewer.adapter,
      outcomes,
    }).catch(() => undefined);
    // The FACTUAL repair, specifically — a structural repair round may have
    // run before it, and it names nothing the reviewer said.
    const repairPrompt = planner.calls.find((c) => /factually wrong/.test(c.user))!.user;
    expect(repairPrompt).toContain('The heart has three chambers.');
    // The suffixed id names nothing in the blueprint the planner is holding.
    expect(repairPrompt).not.toContain('b1_3');
  });
});

/**
 * The reviewer pays per token on the one new call the Rs 5/student-hour
 * ceiling has to absorb, and `show`/`frame`/`focus` are element-id lists that
 * repeat every id shown so far — measured at roughly half the prompt on
 * committed content, and carrying no claim a reviewer could judge.
 */
describe('reviewerUser pays for claims, not for coordinates', () => {
  it('keeps every spoken string and drops the id lists and geometry', () => {
    const lesson: Lesson = {
      formatVersion: 1,
      id: 'x',
      title: 'The Heart',
      language: 'en',
      canvas: { w: 1000, h: 620 },
      elements: [{ kind: 'title', id: 'zq-elem', x: 111, y: 222, text: 'The Heart' }],
      beats: [
        {
          id: 'b1',
          topic: 'chambers',
          narration: 'The heart has four chambers.',
          show: ['zq-elem'],
          frame: ['zq-elem'],
        },
      ],
    };
    const beatsPart = reviewerUser(lesson, 'The Heart', 10).split('THE BOARD')[0];
    expect(beatsPart).toContain('The heart has four chambers.');
    expect(beatsPart).not.toContain('zq-elem');
    expect(beatsPart).not.toContain('"show"');
    expect(reviewerUser(lesson, 'The Heart', 10)).not.toContain('222');
  });
});
