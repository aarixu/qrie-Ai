import { describe, expect, it } from 'vitest';
import { MOMENTS } from '../src/moments';
import { SURFACES, buildSystemPrompt, type LessonContext } from '../src/prompt';
import { CORE, MOVES, likesBlock, safetyBlock, SPEAKING } from '../src/meera';
import { REGISTER } from '../src/language';
import { TUTOR } from '../src/traits';
import type { StudentContext } from '../src/factors';

const student: StudentContext = { klass: 9 };

const lesson: LessonContext = {
  subject: 'Science',
  title: 'Life Processes',
  beatTopic: 'how the heart moves blood',
  transcriptSoFar: 'The heart has four chambers...',
  onScreen: ['heart_diagram', 'left_ventricle'],
  recallableBeats: [
    { id: 'b1', topic: 'why blood needs to move at all' },
    { id: 'b2', topic: 'the four chambers' },
  ],
};

describe('buildSystemPrompt (v3 composition)', () => {
  it('opens on the core, on every surface', () => {
    for (const surface of SURFACES) {
      const prompt = buildSystemPrompt({ moment: 'DOUBT_ANSWERING', student, surface });
      expect(prompt.startsWith(CORE)).toBe(true);
      expect(prompt).toContain(TUTOR.name);
    }
  });

  it('adds her likes only where she chats (voice and text), never to narration', () => {
    expect(buildSystemPrompt({ moment: 'DOUBT_ANSWERING', student, surface: 'voice' })).toContain(likesBlock());
    expect(buildSystemPrompt({ moment: 'DOUBT_ANSWERING', student, surface: 'text' })).toContain(likesBlock());
    expect(buildSystemPrompt({ moment: 'TEACHING', student, surface: 'narration' })).not.toContain('YOUR LIKES');
  });

  it('runs from the most permanent block to the most situational', () => {
    const prompt = buildSystemPrompt({
      moment: 'DOUBT_ANSWERING',
      student: { klass: 9, language: 'hi-en', namedMisconception: 'a wrong idea' },
      lesson,
      surface: 'voice',
    });
    const order = [
      'WHO YOU ARE',
      'YOUR LIKES',
      'SAFETY (outranks everything)',
      'LANGUAGE\n',
      'HOW TO SPEAK',
      'THE LEARNER',
      'THIS LESSON',
      'COVERED SO FAR',
      'MOMENTS YOU CAN BRING BACK',
      'THIS MOMENT — DOUBT_ANSWERING',
    ].map((h) => prompt.indexOf(h));
    for (const at of order) expect(at).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('carries the safety block for the surface: words when heard, digits when read', () => {
    expect(buildSystemPrompt({ moment: 'DOUBT_ANSWERING', student, surface: 'voice' })).toContain(safetyBlock('en', 'IN', 'voice'));
    expect(buildSystemPrompt({ moment: 'DOUBT_ANSWERING', student, surface: 'text' })).toContain(safetyBlock('en', 'IN', 'text'));
    expect(buildSystemPrompt({ moment: 'TEACHING', student, surface: 'narration' })).toContain(safetyBlock('en', 'IN', 'voice'));
  });

  it('is deterministic for the same input', () => {
    const input = {
      moment: 'DOUBT_ANSWERING',
      student: {
        klass: 10,
        mastery: 0.2,
        namedMisconception: 'thinks arteries always carry oxygenated blood',
        doubtCount: 4,
        lastAnswer: 'fast-wrong',
        attendance: { kind: 'returning', daysAway: 2 },
      },
      lesson,
      surface: 'voice',
    } as const;
    expect(buildSystemPrompt(input)).toBe(buildSystemPrompt(input));
  });

  it('names the misconception verbatim inside the learner notes', () => {
    const misconception = 'thinks arteries always carry oxygenated blood';
    const prompt = buildSystemPrompt({ moment: 'WRONG_ANSWER', student: { klass: 10, namedMisconception: misconception }, surface: 'text' });
    expect(prompt).toContain(`"${misconception}"`);
  });

  it('speaks to a Class 6 learner differently from a Class 12 one (the app\'s line, not the persona\'s)', () => {
    const six = buildSystemPrompt({ moment: 'TEACHING', student: { klass: 6 }, surface: 'narration' });
    const twelve = buildSystemPrompt({ moment: 'TEACHING', student: { klass: 12 }, surface: 'narration' });
    expect(six).toContain('vocabulary stays at everyday words');
    expect(twelve).toContain('full subject vocabulary');
    expect(twelve).not.toContain('vocabulary stays at everyday words');
  });

  it('marks the learner notes private and reads out no number', () => {
    const prompt = buildSystemPrompt({ moment: 'RIGHT_ANSWER', student: { klass: 8, mastery: 0.9 }, surface: 'voice' });
    expect(prompt).toContain('THE LEARNER (private notes: never read them out)');
    expect(prompt).toContain('Never read out scores or say you are adapting.');
    expect(prompt).not.toContain('0.9');
  });

  it('builds for every moment on every surface, with that moment\'s rule last', () => {
    for (const moment of MOMENTS) {
      for (const surface of SURFACES) {
        const prompt = buildSystemPrompt({ moment, student, lesson, surface });
        const card = prompt.lastIndexOf('\n\n');
        expect(prompt.slice(card + 2).startsWith(`THIS MOMENT — ${moment}`)).toBe(true);
      }
    }
  });
});

describe('the language module', () => {
  it('is English when nobody chose one (English is the base)', () => {
    const prompt = buildSystemPrompt({ moment: 'DOUBT_ANSWERING', student, surface: 'voice' });
    expect(prompt).toContain(`LANGUAGE\n${REGISTER.en}`);
    expect(prompt).not.toContain(REGISTER['hi-en']);
  });

  it('is the Hinglish module only for a learner who chose it', () => {
    const hi = buildSystemPrompt({ moment: 'DOUBT_ANSWERING', student: { klass: 9, language: 'hi-en' }, surface: 'voice' });
    expect(hi).toContain(`LANGUAGE\n${REGISTER['hi-en']}`);
    expect(hi).not.toContain(REGISTER.en);
    const en = buildSystemPrompt({ moment: 'DOUBT_ANSWERING', student: { klass: 9, language: 'en' }, surface: 'voice' });
    expect(en).not.toMatch(/hinglish|devanagari/i);
  });

  it('treats a value the app does not store as English, never as an instruction', () => {
    const prompt = buildSystemPrompt({ moment: 'DOUBT_ANSWERING', student: { klass: 9, language: 'hi' as never }, surface: 'voice' });
    expect(prompt).toContain(`LANGUAGE\n${REGISTER.en}`);
    expect(prompt).not.toContain("'hi'");
  });
});

describe('surfaces', () => {
  it('holds a spoken turn to about thirty words, with no screen formatting', () => {
    const prompt = buildSystemPrompt({ moment: 'DOUBT_ANSWERING', student, surface: 'voice' });
    expect(prompt).toContain(SPEAKING.voice);
    expect(prompt).toContain('one or two short sentences, about thirty words at most');
    expect(prompt).toContain('No markdown, lists or emoji.');
  });

  it('keeps a read reply just as short, with a formula on its own line', () => {
    const prompt = buildSystemPrompt({ moment: 'DOUBT_ANSWERING', student, surface: 'text' });
    expect(prompt).toContain(SPEAKING.text);
    expect(prompt).toContain('A formula goes on its own line.');
    expect(prompt).not.toContain('No markdown');
  });

  it('keeps the authored beat length for narration', () => {
    const prompt = buildSystemPrompt({ moment: 'TEACHING', student, surface: 'narration' });
    expect(prompt).toContain('30 to 60 words for this beat');
  });
});

describe('lesson context', () => {
  it('lists the recall targets by id and forbids inventing one', () => {
    const prompt = buildSystemPrompt({ moment: 'DOUBT_ANSWERING', student, lesson, surface: 'voice' });
    expect(prompt).toContain('- id "b1": why blood needs to move at all');
    expect(prompt).toContain('- id "b2": the four chambers');
    expect(prompt).toContain('never invent one');
  });

  it('names what is on the board so she cannot claim more', () => {
    const prompt = buildSystemPrompt({ moment: 'TEACHING', student, lesson, surface: 'voice' });
    expect(prompt).toContain('On the board now: heart_diagram, left_ventricle. Refer only to these as visible.');
  });

  it('omits the lesson blocks entirely when there is no lesson', () => {
    const prompt = buildSystemPrompt({ moment: 'DOUBT_OPENING', student, surface: 'voice' });
    expect(prompt).not.toContain('THIS LESSON');
    expect(prompt).not.toContain('COVERED SO FAR');
    expect(prompt).not.toContain('BRING BACK ONTO THE BOARD');
  });

  it('omits the parts the caller left out', () => {
    const prompt = buildSystemPrompt({ moment: 'TEACHING', student, lesson: { subject: 'Mathematics' }, surface: 'narration' });
    expect(prompt).toContain('Subject: Mathematics');
    expect(prompt).not.toContain('Lesson:');
    expect(prompt).not.toContain('COVERED SO FAR');
    expect(prompt).not.toContain('On the board now');
  });

  it('states the outcome as something they will be able to do, and nothing when none is known', () => {
    const base = { moment: 'TEACHING' as const, student, surface: 'voice' as const };
    expect(buildSystemPrompt({ ...base, lesson: { beatTopic: 'Dilution', outcome: 'Calculate the dilution factor' } })).toContain(
      'By the end they should be able to: Calculate the dilution factor.',
    );
    expect(buildSystemPrompt({ ...base, lesson: { beatTopic: 'Dilution' } })).not.toContain('should be able to');
  });

  it('lists the foundations, marks the shaky one, and never as a number', () => {
    const prompt = buildSystemPrompt({
      moment: 'DOUBT_ANSWERING',
      student,
      surface: 'voice',
      lesson: {
        outcome: 'Calculate the dilution factor',
        restsOn: [
          { statement: 'Describe serial dilution', secure: true },
          { statement: 'Divide by a power of ten', secure: false },
        ],
      },
    });
    expect(prompt).toContain('WHAT THIS RESTS ON');
    expect(prompt).toContain('Divide by a power of ten  (they may not have this yet)');
    expect(prompt).not.toMatch(/0\.\d+/);
  });
});

describe('a conductor turn (v3 move cards; no conductor is wired yet)', () => {
  it('puts the move card last, with the conductor\'s reasons', () => {
    const prompt = buildSystemPrompt({ move: 'HINT', rung: 3, helped: 2, because: 'two wrong answers on the same step', student, lesson, surface: 'voice' });
    const turn = prompt.slice(prompt.lastIndexOf('\n\n') + 2);
    expect(turn.startsWith('THIS TURN.')).toBe(true);
    expect(turn).toContain(`MOVE: HINT\n${MOVES.HINT}`);
    expect(turn).toContain('RUNG: 3');
    expect(turn).toContain('HELPED: they have had help (rung 2).');
    expect(turn).toContain('WHY THIS MOVE: two wrong answers on the same step');
    expect(prompt).not.toContain('THIS MOMENT');
  });

  it('hands over the verified prepared item, and forbids inventing beyond it', () => {
    const prompt = buildSystemPrompt({
      move: 'WORKED_EXAMPLE',
      student,
      surface: 'text',
      payload: { question: 'What is 3/4 of 20?', expected: '15', wrongIdeas: ['adds 3 and 4'], workedExample: '20 / 4 = 5, 5 x 3 = 15' },
    });
    expect(prompt).toContain('PREPARED. Use exactly this; invent no number, formula, example or fact beyond it.');
    expect(prompt).toContain('Question: What is 3/4 of 20?');
    expect(prompt).toContain('A good answer is: 15');
    expect(prompt).toContain('Known wrong ideas: adds 3 and 4');
    expect(prompt).toContain('Worked example: 20 / 4 = 5, 5 x 3 = 15');
    expect(prompt.indexOf('PREPARED.')).toBeLessThan(prompt.indexOf('THIS TURN.'));
  });

  it('carries no turn card when neither a move nor a moment is given', () => {
    const prompt = buildSystemPrompt({ student, surface: 'voice' });
    expect(prompt).not.toContain('THIS TURN.');
    expect(prompt).not.toContain('THIS MOMENT');
  });
});
