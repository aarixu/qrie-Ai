import { describe, it, expect } from 'vitest';
import type { Lesson } from '@ai-tutor/lesson-format';
import { REGISTER, TUTOR, momentGuidance, type StudentContext } from '@ai-tutor/persona';
import { buildContext, type DoubtContext } from '../src/context';
import { buildDoubtBrief, isRecallable, recallTargets } from '../src/brief';

/** Three beats, small enough that every id in a prompt can be accounted for. */
function miniLesson(): Lesson {
  return {
    formatVersion: 1,
    id: 'blood',
    title: 'How blood moves',
    language: 'en',
    canvas: { w: 1000, h: 620 },
    elements: [
      { kind: 'title', id: 'e1', x: 0, y: 0, text: 'The heart' },
      { kind: 'text', id: 'e2', x: 0, y: 100, text: 'Four chambers' },
      { kind: 'box', id: 'e3', x: 0, y: 200, w: 100, h: 50, label: 'Valve' },
    ],
    beats: [
      { id: 'beat-pump', topic: 'the heart is a pump', narration: 'A pump, not a feeling.', show: ['e1'] },
      { id: 'beat-chambers', topic: 'the four chambers', narration: 'Four rooms, two sides.', show: ['e1', 'e2'] },
      { id: 'beat-valves', topic: 'valves and one-way flow', narration: 'Doors that open one way.', show: ['e2', 'e3'] },
    ],
  };
}

/** The student paused on the middle beat, so beat-valves is still unseen. */
const midLesson = (): DoubtContext => buildContext(miniLesson(), 1);

/** Only what onboarding actually knows. Every other signal is genuinely absent. */
const KLASS_ONLY: StudentContext = { klass: 9 };

/** Every "- id "x"" line the prompt enumerates as a legal recall target. */
const idsListedIn = (prompt: string): string[] =>
  [...prompt.matchAll(/- id "([^"]+)"/g)].map((m) => m[1]);

describe('buildDoubtBrief', () => {
  it('brings the one tutor into the room, rules and all', () => {
    const prompt = buildDoubtBrief(midLesson(), KLASS_ONLY, {
      moment: 'opening',
      surface: 'voice',
    });

    // Not "a warm Indian tutor" written out again by this package: her actual
    // name and her actual lists, so the live tutor cannot drift from the
    // recorded one the way the three hand-written prompts did.
    expect(prompt).toContain(TUTOR.name);
    expect(prompt).toContain(TUTOR.role);
    for (const value of TUTOR.values) expect(prompt).toContain(value);
    for (const ban of TUTOR.neverDoes) expect(prompt).toContain(ban);
  });

  it('carries the moment the caller asked for', () => {
    const opening = buildDoubtBrief(midLesson(), KLASS_ONLY, {
      moment: 'opening',
      surface: 'voice',
    });
    const closing = buildDoubtBrief(midLesson(), KLASS_ONLY, {
      moment: 'closing',
      surface: 'voice',
    });

    expect(opening).toContain(momentGuidance('DOUBT_OPENING'));
    expect(opening).not.toContain(momentGuidance('DOUBT_CLOSING'));
    expect(closing).toContain(momentGuidance('DOUBT_CLOSING'));
    expect(closing).not.toContain(momentGuidance('DOUBT_OPENING'));
  });

  it('carries the surface the caller asked for', () => {
    const spoken = buildDoubtBrief(midLesson(), KLASS_ONLY, {
      moment: 'answering',
      surface: 'voice',
    });
    const typed = buildDoubtBrief(midLesson(), KLASS_ONLY, {
      moment: 'answering',
      surface: 'text',
    });

    expect(spoken).toContain('spoken out loud');
    expect(typed).toContain('read on a phone screen');
    expect(spoken).not.toBe(typed);
  });

  it('hands persona the moment of the class the student paused on', () => {
    const ctx = midLesson();
    const prompt = buildDoubtBrief(ctx, KLASS_ONLY, {
      moment: 'answering',
      surface: 'voice',
      subject: 'Science',
      title: 'How blood moves',
    });

    expect(prompt).toContain(ctx.beatTopic);
    expect(prompt).toContain(ctx.transcriptSoFar);
    expect(prompt).toContain('Subject: Science');
    expect(prompt).toContain('Lesson: How blood moves');
    for (const id of ctx.visibleElementIds) expect(prompt).toContain(id);
  });

  it('says nothing about the lesson document the caller did not supply', () => {
    const prompt = buildDoubtBrief(midLesson(), KLASS_ONLY, {
      moment: 'answering',
      surface: 'voice',
    });

    // Same rule as the student factors: absent means unknown, and unknown says
    // nothing. A guessed subject would read to the model as a measured one.
    expect(prompt).not.toContain('Subject:');
    expect(prompt).not.toContain('Lesson:');
  });

  it('lists every beat the student has seen, and no beat they have not', () => {
    const ctx = midLesson();
    const prompt = buildDoubtBrief(ctx, KLASS_ONLY, { moment: 'answering', surface: 'voice' });

    expect(idsListedIn(prompt)).toEqual(['beat-pump', 'beat-chambers']);
    // The beat after the pause is the one that must never appear: pulling it
    // onto the board would show the student the part of the class they have
    // not reached yet.
    expect(prompt).not.toContain('beat-valves');
    for (const target of recallTargets(ctx)) expect(prompt).toContain(target.topic);
  });

  it('offers exactly the ids the validator accepts', () => {
    const ctx = midLesson();
    const prompt = buildDoubtBrief(ctx, KLASS_ONLY, { moment: 'answering', surface: 'voice' });

    // The bug this pins down: a prompt that offers an id the validator refuses
    // shows up as the tutor promising a diagram and the board staying blank.
    const offered = idsListedIn(prompt);
    expect(offered).toEqual(recallTargets(ctx).map((target) => target.id));
    for (const id of offered) expect(isRecallable(ctx, id)).toBe(true);

    for (const rejected of ['beat-valves', 'beat-pump ', 'BEAT-PUMP', 'made-up', '']) {
      expect(offered).not.toContain(rejected);
      expect(isRecallable(ctx, rejected)).toBe(false);
    }
  });

  it('is silent about a mastery nobody measured', () => {
    const unknown = buildDoubtBrief(midLesson(), KLASS_ONLY, {
      moment: 'answering',
      surface: 'voice',
    });
    const measured = buildDoubtBrief(
      midLesson(),
      { klass: 9, mastery: 0.2 },
      { moment: 'answering', surface: 'voice' },
    );

    expect(unknown).not.toContain('grasp of this outcome');
    expect(measured).toContain('Their grasp of this outcome is weak');
  });

  it('is silent about a misconception nobody caught', () => {
    const unknown = buildDoubtBrief(midLesson(), KLASS_ONLY, {
      moment: 'answering',
      surface: 'voice',
    });
    const caught = buildDoubtBrief(
      midLesson(),
      { klass: 9, namedMisconception: 'thinks the heart makes blood' },
      { moment: 'answering', surface: 'voice' },
    );

    expect(unknown).not.toContain('wrong idea');
    expect(caught).toContain('thinks the heart makes blood');
  });

  it('invents no student signal of its own', () => {
    // Whatever the app measured is what the model is told — this function adds
    // no defaults on the way past. With only a class known, the student section
    // is exactly one line long.
    const prompt = buildDoubtBrief(midLesson(), KLASS_ONLY, {
      moment: 'answering',
      surface: 'voice',
    });

    const section = prompt.split('\n\n').find((block) => block.startsWith('THIS STUDENT'));
    expect(section).toBeDefined();
    expect(section?.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(1);
    expect(section).toContain('Class 9');
  });

  /**
   * THE CHILD'S LANGUAGE, IN THE LIVE TUTOR'S OWN BRIEF.
   *
   * The class planner has always been told which language a student chose;
   * the doubt tutor was not, so a Hinglish class could pause for a raised hand
   * and answer it in English. The choice rides on the student, like every
   * other signal, and persona renders the one register line the judge and the
   * close carry too.
   */
  it('speaks Hinglish to a child who chose Hinglish', () => {
    const prompt = buildDoubtBrief(
      midLesson(),
      { klass: 9, language: 'hi-en' },
      { moment: 'answering', surface: 'text' },
    );
    expect(prompt).toContain(REGISTER['hi-en']);
    expect(prompt).not.toContain(REGISTER.en);
  });

  it('speaks plain English to a child who chose English, with no Hinglish line at all', () => {
    const prompt = buildDoubtBrief(
      midLesson(),
      { klass: 9, language: 'en' },
      { moment: 'answering', surface: 'text' },
    );
    expect(prompt).toContain(REGISTER.en);
    expect(prompt).not.toContain(REGISTER['hi-en']);
    expect(prompt).not.toMatch(/hinglish/i);
    expect(prompt).not.toMatch(/devanagari/i);
  });

  it('invents no language when the caller did not say one', () => {
    const prompt = buildDoubtBrief(midLesson(), KLASS_ONLY, {
      moment: 'answering',
      surface: 'text',
    });
    expect(prompt).not.toContain(REGISTER.en);
    expect(prompt).not.toContain(REGISTER['hi-en']);
  });

  it('is pure: the same inputs build a byte-identical prompt', () => {
    const options = { moment: 'answering', surface: 'voice', subject: 'Science' } as const;
    const student: StudentContext = { klass: 9, mastery: 0.31, doubtCount: 4 };

    const first = buildDoubtBrief(midLesson(), student, options);
    const second = buildDoubtBrief(midLesson(), { ...student }, { ...options });

    // Two separately built contexts, two separately built student objects: if
    // anything in this path reached for a clock, a random or a mutable module
    // variable, these two strings would differ.
    expect(second).toBe(first);
  });
});

describe('recallTargets', () => {
  it('ends at the beat the student is on, in teaching order', () => {
    expect(recallTargets(midLesson())).toEqual([
      { id: 'beat-pump', topic: 'the heart is a pump' },
      { id: 'beat-chambers', topic: 'the four chambers' },
    ]);
  });

  it('hands out copies, so a caller cannot edit the briefing through them', () => {
    const ctx = midLesson();
    const targets = recallTargets(ctx);
    (targets[0] as { topic: string }).topic = 'nonsense';

    expect(ctx.recentBeats[0].topic).toBe('the heart is a pump');
    expect(recallTargets(ctx)[0].topic).toBe('the heart is a pump');
  });

  it('offers the opening beat alone at the very start of a class', () => {
    const ctx = buildContext(miniLesson(), 0);
    expect(recallTargets(ctx).map((target) => target.id)).toEqual(['beat-pump']);
    expect(isRecallable(ctx, 'beat-chambers')).toBe(false);
  });
});
