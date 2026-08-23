import { describe, expect, it } from 'vitest';
import { MOMENTS } from '../src/moments';
import { SURFACES, buildSystemPrompt, type LessonContext } from '../src/prompt';
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

describe('buildSystemPrompt', () => {
  it('always carries who she is and what she will not do', () => {
    const prompt = buildSystemPrompt({ moment: 'TEACHING', student, surface: 'narration' });
    expect(prompt).toContain(TUTOR.name);
    expect(prompt).toContain(TUTOR.role);
    for (const value of TUTOR.values) expect(prompt).toContain(value);
    for (const ban of TUTOR.neverDoes) expect(prompt).toContain(ban);
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

  it('names the misconception verbatim inside the prompt', () => {
    const misconception = 'thinks arteries always carry oxygenated blood';
    const prompt = buildSystemPrompt({
      moment: 'WRONG_ANSWER',
      student: { klass: 10, namedMisconception: misconception },
      surface: 'text',
    });
    expect(prompt).toContain(`"${misconception}"`);
  });

  it('speaks to a Class 6 student differently from a Class 12 student', () => {
    const six = buildSystemPrompt({ moment: 'TEACHING', student: { klass: 6 }, surface: 'narration' });
    const twelve = buildSystemPrompt({ moment: 'TEACHING', student: { klass: 12 }, surface: 'narration' });

    expect(six).not.toBe(twelve);
    expect(six).toContain('vocabulary stays at everyday words');
    expect(twelve).toContain('full subject vocabulary');
    expect(twelve).not.toContain('vocabulary stays at everyday words');
  });

  it('carries the moment rule, and only that moment rule', () => {
    const prompt = buildSystemPrompt({ moment: 'DOUBT_CLOSING', student, surface: 'voice' });
    expect(prompt).toContain('THIS MOMENT — DOUBT_CLOSING');
    expect(prompt).toContain('hand back');
    expect(prompt).not.toContain('THIS MOMENT — TEACHING');
  });

  it('builds a prompt for every moment on every surface', () => {
    for (const moment of MOMENTS) {
      for (const surface of SURFACES) {
        const prompt = buildSystemPrompt({ moment, student, lesson, surface });
        expect(prompt).toContain(`THIS MOMENT — ${moment}`);
        expect(prompt.length).toBeGreaterThan(400);
      }
    }
  });

  describe('surfaces', () => {
    it('caps a spoken turn and bans screen formatting on voice', () => {
      const prompt = buildSystemPrompt({ moment: 'DOUBT_ANSWERING', student, surface: 'voice' });
      expect(prompt).toContain('20 to 60 words per turn');
      expect(prompt.toLowerCase()).toContain('no markdown');
    });

    it('does neither on text, which is read rather than heard', () => {
      const prompt = buildSystemPrompt({ moment: 'DOUBT_ANSWERING', student, surface: 'text' });
      expect(prompt.toLowerCase()).not.toContain('markdown');
      expect(prompt).not.toContain('words per turn');
      expect(prompt).toContain('Short paragraphs');
    });

    it('uses the authored beat length for narration', () => {
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

    it('names what is on the canvas so she cannot claim more', () => {
      const prompt = buildSystemPrompt({ moment: 'TEACHING', student, lesson, surface: 'voice' });
      expect(prompt).toContain('heart_diagram, left_ventricle');
    });

    it('omits the lesson block entirely when there is no lesson', () => {
      const prompt = buildSystemPrompt({ moment: 'DOUBT_OPENING', student, surface: 'voice' });
      expect(prompt).not.toContain('THIS LESSON');
      expect(prompt).not.toContain('WHAT THE CLASS HAS COVERED SO FAR');
      expect(prompt).not.toContain('BRING BACK ONTO THE BOARD');
    });

    it('omits the parts of the lesson block the caller left out', () => {
      const prompt = buildSystemPrompt({
        moment: 'TEACHING',
        student,
        lesson: { subject: 'Mathematics' },
        surface: 'narration',
      });
      expect(prompt).toContain('Subject: Mathematics');
      expect(prompt).not.toContain('Lesson:');
      expect(prompt).not.toContain('WHAT THE CLASS HAS COVERED SO FAR');
      expect(prompt).not.toContain('On the canvas at this moment');
    });
  });

  it('marks the student notes private so no score is ever read out', () => {
    const prompt = buildSystemPrompt({
      moment: 'RIGHT_ANSWER',
      student: { klass: 8, mastery: 0.9 },
      surface: 'voice',
    });
    expect(prompt).toContain('private notes');
    expect(prompt).toContain('never say you are adapting');
    // The belief itself is a number the student must never hear.
    expect(prompt).not.toContain('0.9');
  });
});
