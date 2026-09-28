import { describe, expect, it } from 'vitest';
import type { Lesson } from '@ai-tutor/lesson-format';
import { screenSpine } from '../src/screenSpine';
import { prepareClass, type LlmAdapter } from '../src/prepare';
import type { Blueprint } from '../src/types';
import { screen } from '../../safety/src/screen.ts';

/**
 * THE FIRST-STUDENT GAP. The keep gate (relays.ts) screens narration on the
 * server, but a cold topic starts teaching ~14s in — ~80s before keep — so the
 * FIRST student hears whatever the planner wrote, screened by nobody. These
 * tests hold the prep-side screen to both halves of its job: a distress line
 * is caught before the room opens, and the actual syllabus — kidney failure,
 * heart attacks, cells dying, in both tutor languages — sails through. A gate
 * that refuses Class 10 Life Processes is an outage, not safety.
 */

const lessonWith = (narrations: string[]): Lesson => ({
  formatVersion: 1,
  id: 'demo',
  title: 'Life Processes',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements: [{ kind: 'title', id: 't1', x: 40, y: 40, text: 'Life Processes' }],
  beats: narrations.map((narration, i) => ({
    id: `b${i + 1}`,
    topic: 'excretion',
    narration,
    show: ['t1'],
  })),
});

describe('screenSpine', () => {
  it('passes the biology the syllabus actually teaches, in English', () => {
    const flagged = screenSpine(
      lessonWith([
        'When the kidneys fail, wastes build up in the blood and dialysis takes over the filtering.',
        'A heart attack happens when the heart muscle is starved of oxygen.',
        'Without oxygen, cells begin dying within minutes — that is why breathing matters.',
      ]),
    );
    expect(flagged).toEqual([]);
  });

  it('passes the same biology in Hinglish', () => {
    const flagged = screenSpine(
      lessonWith([
        'Jab kidney fail ho jaati hai, toh khoon mein waste jama hone lagta hai.',
        'Heart attack tab hota hai jab dil ki muscle ko oxygen nahi milti.',
        'Oxygen ke bina cells marne lagti hain — isliye respiration zaroori hai.',
      ]),
    );
    expect(flagged).toEqual([]);
  });

  it('flags a narration line that reads as distress', () => {
    const flagged = screenSpine(
      lessonWith(['Some days I want to kill myself, but let us look at the nephron.']),
    );
    expect(flagged).toHaveLength(1);
  });

  it('catches a distress line buried past 1,200 characters — the truncation trap', () => {
    // screen() used to truncate at MAX_STUDENT_WORDS BEFORE the distress scan,
    // so the default limit checked the opening and waved the rest through.
    // Since A13 (2026-09-29) it scans the whole text first, so the trap is
    // closed in screen() itself as well as here.
    const long = `${'The nephron filters the blood. '.repeat(200)}I want to kill myself.`;
    expect(screen(long, 'to-student').kind).toBe('support');
    expect(screenSpine(lessonWith([long]))).toHaveLength(1);
  });

  it('screens what an ask carries, not only narration', () => {
    const lesson = lessonWith(['A perfectly ordinary teaching line.']);
    lesson.beats[0].ask = {
      question: 'What happens next?',
      hint: 'Someone is hitting me at home, think about that.',
    };
    expect(screenSpine(lesson)).toHaveLength(1);
  });
});

describe('prepareClass refuses a spine the screen flags', () => {
  const blueprint: Blueprint = {
    id: 'demo',
    title: 'Speed',
    beats: [
      {
        id: 'b1',
        topic: 'open',
        narration: 'I want to kill myself, and also, speed is distance over time.',
        board: [{ do: 'title', text: 'Speed' }],
      },
    ],
    visuals: [],
  };
  const fakePlanner = (doc: unknown): LlmAdapter => ({
    complete: async () => JSON.stringify(doc),
  });

  it('throws with a named reason before any room opens', async () => {
    let draftSeen = false;
    await expect(
      prepareClass({
        topic: 'Speed',
        klass: 9,
        planner: fakePlanner(blueprint),
        artist: fakePlanner({}),
        onDraft: () => {
          draftSeen = true;
        },
      }),
    ).rejects.toThrow(/distress/);
    // The whole point: the first student never hears the unscreened line.
    expect(draftSeen).toBe(false);
  });
});

/**
 * WHAT THE STRINGIFIED WHOLE MISSES, AND WHAT THE WALK MUST NOT.
 *
 * Stringifying a beat is the right default (a field picked by name is the
 * next field that escapes), but JSON.stringify turns a real newline into the
 * two characters \n, and the distress patterns match across `\s+` — so a line
 * broken mid-sentence screens clean as JSON and dirty as text. Screening the
 * string LEAVES as well as the whole closes that without naming a field.
 */
describe('screenSpine sees what escaping and omission would hide', () => {
  it('catches a distress line broken across a newline inside narration', () => {
    const lesson = lessonWith(['Ma’am I have been hurting\nmyself since last week.']);
    expect(screenSpine(lesson)).toHaveLength(1);
  });

  it('screens the fill — it is one student’s line, but it is spoken first', () => {
    const lesson = lessonWith(['A perfectly ordinary teaching line.']);
    lesson.fill = [{ beatId: 'b1', say: 'I want to kill myself before we start.' }];
    expect(screenSpine(lesson)).toHaveLength(1);
  });

  it('screens the title and subtitle, which are spoken and shown', () => {
    const lesson = lessonWith(['A perfectly ordinary teaching line.']);
    lesson.subtitle = 'Some days I want to kill myself.';
    expect(screenSpine(lesson)).toHaveLength(1);
  });

  it('names WHERE the line is, so a refusal need not quote it back', () => {
    const flagged = screenSpine(lessonWith(['I want to kill myself, but here is the nephron.']));
    expect(flagged[0].where).toBe('b1');
  });
});

describe('the refusal does not read the line back to the child', () => {
  const distressing: Blueprint = {
    id: 'demo',
    title: 'Speed',
    beats: [
      {
        id: 'b1',
        topic: 'open',
        narration: 'I want to kill myself, and also, speed is distance over time.',
        board: [{ do: 'title', text: 'Speed' }],
      },
    ],
    visuals: [],
  };

  it('names the beat, never the text — ClassRoom renders e.message verbatim', async () => {
    const err = await prepareClass({
      topic: 'Speed',
      klass: 9,
      planner: { complete: async () => JSON.stringify(distressing) },
      artist: { complete: async () => '' },
    }).then(
      () => null,
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    expect(err).toMatch(/distress/i);
    expect(err).toContain('b1');
    expect(err).not.toMatch(/kill myself/i);
  });

  it('keeps the DISTRESS reason when it is the corrected plan that reads as distress', async () => {
    const clean: Blueprint = {
      ...distressing,
      beats: [{ ...distressing.beats[0], narration: 'Speed is distance over time.' }],
    };
    // Keyed on the prompt, not a call counter: the structural repair round
    // may fire first, and only the FACTUAL repair must come back distressed.
    const planner = {
      complete: async (_system: string, user: string) =>
        JSON.stringify(/factually wrong/.test(user) ? distressing : clean),
    };
    const reviewer = {
      complete: async () =>
        JSON.stringify({
          ok: false,
          problems: [{ beatId: 'b1', claim: 'speed is distance over time', why: 'say average speed' }],
        }),
    };
    // The class is refused either way; the REASON the caller is handed must
    // still be the distress one, because the classroom maps the two reasons
    // to different words for the student.
    await expect(
      prepareClass({
        topic: 'Speed',
        klass: 9,
        planner,
        artist: { complete: async () => '' },
        reviewer,
      }),
    ).rejects.toThrow(/distress/i);
  });
});
