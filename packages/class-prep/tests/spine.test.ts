import { describe, expect, it } from 'vitest';
import { validateLesson, type Lesson } from '@ai-tutor/lesson-format';
import { namesInSpine, remembersASession, saveable } from '../src/save';
import type { PrepReport } from '../src/types';

/**
 * THE RECORDING IS A SPINE, NOT A SESSION.
 *
 * Decided 2026-08-29 and never built, which meant a class planned for one
 * student was written to disk with their name in it and served to everyone
 * afterwards. The planner is TOLD to "use the name naturally"; a prompt rule
 * is not a mechanism, and this is the mechanism.
 *
 * Two halves:
 *   - the SPINE (title, beats, elements) is what every student gets, and
 *     nothing in it may belong to one of them;
 *   - the FILL is one student's lines, spoken in front of their beat and
 *     thrown away when the class is kept.
 */

const lessonWith = (narration: string, over: Partial<Lesson> = {}): Lesson => {
  const doc = {
    formatVersion: 1 as const,
    id: 'demo',
    title: 'The Human Heart',
    language: 'en' as const,
    canvas: { w: 1000, h: 620 },
    elements: [{ kind: 'title' as const, id: 't', x: 100, y: 80, text: 'The Human Heart' }],
    beats: [{ id: 'b1', topic: 'open', narration, show: ['t'] }],
    ...over,
  };
  const result = validateLesson(doc);
  if (!result.ok) throw new Error(`fixture is not a valid lesson: ${result.errors.join('; ')}`);
  return result.lesson;
};

const cleanReport: PrepReport = {
  topic: 'The Human Heart',
  totalMs: 1,
  planMs: 1,
  visualsMs: 1,
  issues: [],
  visuals: [],
};

const meta = {
  topicRef: 'class10-science/life-processes/transportation-in-human-beings',
  klass: 10,
  subject: 'Science',
};

describe('namesInSpine', () => {
  it('finds a name in the narration', () => {
    expect(namesInSpine(lessonWith('Aarav! Good to see you back.'), ['Aarav'])).toEqual(['Aarav']);
  });

  it('finds it whatever the punctuation around it', () => {
    for (const said of ['aarav, ready?', "That is Aarav's answer.", 'Well done, AARAV.']) {
      expect(namesInSpine(lessonWith(said), ['Aarav']), said).toEqual(['Aarav']);
    }
  });

  it('does not match a longer word that merely contains it', () => {
    // Word boundaries, so a class about the Aravalli range is still keepable.
    expect(namesInSpine(lessonWith('The Aravalli range is older than the Himalayas.'), ['Arav']))
      .toEqual([]);
  });

  it('looks at the title and the board, not only the spoken lines', () => {
    // A name written on the canvas is a name the next student reads.
    const onBoard = lessonWith('Ready?', {
      elements: [{ kind: 'text', id: 't', x: 100, y: 80, text: 'Well done Priya' }],
    });

    expect(namesInSpine(onBoard, ['Priya'])).toEqual(['Priya']);
  });


  it('does not throw on a name carrying regex punctuation', () => {
    // "Md. Arif" made new RegExp throw Unterminated group, and because the
    // caller fires this without awaiting it, the class was silently never
    // saved. A name is user input; every one of these is a real name.
    for (const name of ['Md. Arif', 'D+Souza', 'A(nita)', 'Ka[vya]', 'R^ahul']) {
      expect(() => namesInSpine(lessonWith('Ready?'), [name]), name).not.toThrow();
    }
  });

  it('finds the first name inside a full name', () => {
    // The profile holds "Aarav Sharma"; a tutor says "Aarav". Testing the
    // whole string matched neither, so the check passed on exactly the class
    // it exists to catch.
    expect(namesInSpine(lessonWith('Aarav! Good to see you.'), ['Aarav Sharma'])).toEqual([
      'Aarav',
    ]);
  });

  it('ignores the parts of a name too short to mean anything', () => {
    // "K." in "K. Priya" would otherwise match every K on a board.
    expect(namesInSpine(lessonWith('Point K is the midpoint.'), ['K. Priya'])).toEqual([]);
  });

  it('reads a held question, not only the narration', () => {
    // A held question is asked out loud, its hint is read back on a wrong
    // answer, and an option's why is spoken as the reason.
    const asked = lessonWith('Right, here we go.', {
      beats: [
        {
          id: 'b1',
          topic: 'open',
          narration: 'Right, here we go.',
          show: ['t'],
          ask: {
            question: 'Aarav, what pushes the blood around?',
            expect: 'the heart',
            hint: 'Think about your chest.',
          },
        },
      ],
    });

    expect(namesInSpine(asked, ['Aarav'])).toEqual(['Aarav']);
  });

  it('has nothing to say about an anonymous class', () => {
    expect(namesInSpine(lessonWith('Ready? Let us start.'), ['Aarav'])).toEqual([]);
  });

  it('ignores a name too short to be one', () => {
    // A one-letter "name" would match half the alphabet on the board.
    expect(namesInSpine(lessonWith('A is for apple.'), ['A'])).toEqual([]);
  });
});

describe('saveable', () => {
  it('keeps an anonymous class', () => {
    const saved = saveable(
      { lesson: lessonWith('Ready? Let us start.'), assets: {}, report: cleanReport },
      { ...meta, studentNames: ['Aarav'] },
    );

    expect(saved).not.toBeNull();
  });

  it('REFUSES a class that used the student’s name', () => {
    // The bug this exists to close: this class would otherwise have opened
    // "Aarav! Good to see you back" for every student who came after.
    const saved = saveable(
      { lesson: lessonWith('Aarav! Good to see you back.'), assets: {}, report: cleanReport },
      { ...meta, studentNames: ['Aarav'] },
    );

    expect(saved).toBeNull();
  });

  it('refuses rather than editing the teaching', () => {
    // Taking a word out of somebody's sentence produces a sentence nobody
    // wrote. The honest answer to "this class is personal" is that it is not
    // the one to keep.
    const personal = lessonWith('Aarav, remember the valves?');
    const saved = saveable({ lesson: personal, assets: {}, report: cleanReport }, {
      ...meta,
      studentNames: ['Aarav'],
    });

    expect(saved).toBeNull();
    // And the lesson in front of the student is untouched.
    expect(personal.beats[0].narration).toBe('Aarav, remember the valves?');
  });

  it('strips the fill from what it writes', () => {
    const withFill = lessonWith('Ready? Let us start.', {
      fill: [{ beatId: 'b1', say: 'Aarav! Good to see you back.' }],
    });

    const saved = saveable({ lesson: withFill, assets: {}, report: cleanReport }, meta);
    const doc = JSON.parse(saved!.files.find((f) => f.path === 'lesson.json')!.body) as Lesson;

    expect(doc.fill).toBeUndefined();
    expect(JSON.stringify(doc)).not.toContain('Aarav');
  });

  it('leaves the playing lesson’s fill alone', () => {
    // The student in the room is still being taught by it.
    const withFill = lessonWith('Ready?', {
      fill: [{ beatId: 'b1', say: 'Aarav! Good to see you back.' }],
    });

    saveable({ lesson: withFill, assets: {}, report: cleanReport }, meta);

    expect(withFill.fill).toHaveLength(1);
  });

  it('is safe when the caller knows no names', () => {
    expect(
      saveable({ lesson: lessonWith('Ready?'), assets: {}, report: cleanReport }, meta),
    ).not.toBeNull();
  });
});

describe('a spine that remembers a session', () => {
  // The name check catches "Aarav". It cannot catch "last time we did the
  // nucleus" — just as personal, and now just as likely, because the planner
  // is told what the student did last class so she can open where they left
  // off. That belongs in the fill.
  const claims = [
    'Last time we did the nucleus, so today we go inside it.',
    'Welcome back! Ready for the next one?',
    'Remember what we looked at yesterday?',
    'Picking up from where we left off.',
  ];

  it.each(claims)('is refused: "%s"', (narration) => {
    expect(remembersASession(lessonWith(narration))).not.toEqual([]);
    expect(
      saveable({ lesson: lessonWith(narration), assets: {}, report: cleanReport }, meta),
    ).toBeNull();
  });

  const ordinary = [
    'The nucleus is the control centre of the cell.',
    'Last week the moon was full — that is one lunar cycle.',
    'We will do this one step at a time.',
  ];

  it.each(ordinary)('leaves ordinary teaching alone: "%s"', (narration) => {
    // The TOPIC is not the problem — "the nucleus" belongs in a class about
    // cells. A narration claiming a shared past is.
    expect(remembersASession(lessonWith(narration))).toEqual([]);
  });
});

describe('the format holds the split', () => {
  it('accepts a lesson with no fill at all, which is the ordinary case', () => {
    expect(validateLesson({ ...lessonWith('Ready?'), fill: undefined }).ok).toBe(true);
  });

  it('refuses a personal line pointing at a beat that does not exist', () => {
    // A greeting nobody will ever hear, failing silently, is worse than a
    // lesson that will not load.
    const broken = { ...lessonWith('Ready?'), fill: [{ beatId: 'b9', say: 'Hello!' }] };
    const result = validateLesson(broken);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(' ')).toContain('b9');
  });

  it('refuses a fill line with nothing to say', () => {
    expect(validateLesson({ ...lessonWith('Ready?'), fill: [{ beatId: 'b1' }] }).ok).toBe(false);
  });
});
