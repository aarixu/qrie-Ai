import { describe, expect, it } from 'vitest';
import {
  REGISTER,
  TUTOR,
  TUTOR_LANGUAGES,
  buildSystemPrompt,
  describeFactors,
  registerLine,
  type StudentContext,
} from '../src/index';

/**
 * THE LANGUAGE THE CHILD CHOSE, CARRIED INTO EVERY PROMPT SHE SPEAKS FROM.
 *
 * Onboarding asks each student whether the tutor should speak English or
 * Hinglish (apps/classroom/src/lib/workspace.ts, `tutorLanguage()`), and until
 * this field existed that choice reached the class PLANNER and nothing else. A
 * Hinglish class narrated in Hinglish and then answered a doubt in English,
 * because the doubt brief had nowhere to put the choice. These tests pin the one
 * line each language renders, so it cannot be softened or dropped silently.
 */

const HINGLISH =
  'Speak Hinglish the way a friendly Delhi tutor talks to a Class 6-10 student: Hindi sentence structure in Roman script with English science and maths terms; never Devanagari.';

const prompt = (student: StudentContext): string =>
  buildSystemPrompt({ moment: 'DOUBT_ANSWERING', student, surface: 'voice' });

describe('the register line', () => {
  it('spells the two languages the app stores, and no third', () => {
    // The same two spellings workspace.ts validates on the way in. A third
    // value is not a language, it is a bug reaching a child's class.
    expect([...TUTOR_LANGUAGES]).toEqual(['en', 'hi-en']);
  });

  it('asks a Hinglish tutor for Roman-script Hinglish, in these exact words', () => {
    expect(REGISTER['hi-en']).toBe(HINGLISH);
    expect(registerLine('hi-en')).toBe(HINGLISH);
  });

  it('asks an English tutor for plain Indian English, and says nothing about Hinglish', () => {
    expect(REGISTER.en).toMatch(/plain Indian English/);
    expect(REGISTER.en).not.toMatch(/hinglish/i);
    expect(REGISTER.en).not.toMatch(/devanagari/i);
    expect(registerLine('en')).toBe(REGISTER.en);
  });

  it('is one short line for each language, because it rides on every call', () => {
    for (const language of TUTOR_LANGUAGES) {
      expect(REGISTER[language]).not.toContain('\n');
      expect(REGISTER[language].length).toBeLessThanOrEqual(200);
    }
  });
});

describe('the persona prompt, per language', () => {
  it('carries the Hinglish line for a Hinglish child', () => {
    const p = prompt({ klass: 9, language: 'hi-en' });
    expect(p).toContain(HINGLISH);
    expect(p).not.toContain(REGISTER.en);
  });

  it('carries the English line, and no Hinglish line, for an English child', () => {
    const p = prompt({ klass: 9, language: 'en' });
    expect(p).toContain(REGISTER.en);
    expect(p).not.toContain(HINGLISH);
    expect(p).not.toMatch(/hinglish/i);
    expect(p).not.toMatch(/devanagari/i);
  });

  it('says nothing about language when nobody told it one', () => {
    // Persona's whole contract: absent means unknown, and unknown says
    // nothing. A default invented here would read to the model exactly like a
    // choice the child made.
    const p = prompt({ klass: 9 });
    expect(p).not.toContain(HINGLISH);
    expect(p).not.toContain(REGISTER.en);
  });

  it('ignores a language the app does not speak rather than guessing one', () => {
    const p = prompt({ klass: 9, language: 'hi' as never });
    expect(p).not.toContain(HINGLISH);
    expect(p).not.toContain(REGISTER.en);
  });

  it('does not contradict a Hinglish register anywhere above it', () => {
    // "Teaching the syllabus in English" and "Plain English first" in who she
    // is would argue with the register line a Hinglish child gets, and a
    // model handed both picks one — not reliably the child's.
    // Every class band, because each renders its own vocabulary line.
    for (const klass of [7, 9, 12] as const) {
      const p = prompt({ klass, language: 'hi-en' });
      expect(p).not.toMatch(/syllabus in English/);
      expect(p).not.toMatch(/plain English/i);
      expect(p).not.toMatch(/plain-English/i);
    }
  });

  it('keeps the register out of the private notes, because it is an instruction to follow', () => {
    // The student section is "never read them out" notes about the child. The
    // language is how every word she says comes out, so it sits with the
    // speaking rules, and the notes stay exactly as long as they were.
    expect(describeFactors({ klass: 9, language: 'hi-en' })).toHaveLength(1);
    const p = prompt({ klass: 9, language: 'hi-en' });
    const notes = p.split('\n\n').find((block) => block.startsWith('THIS STUDENT')) ?? '';
    expect(notes).not.toContain(HINGLISH);
    expect(p.indexOf(HINGLISH)).toBeGreaterThan(p.indexOf('THIS MOMENT'));
    expect(p.indexOf(HINGLISH)).toBeLessThan(p.indexOf('HOW TO SPEAK'));
  });

  it('is deterministic for the same language', () => {
    const student: StudentContext = { klass: 7, language: 'hi-en', mastery: 0.2 };
    expect(prompt(student)).toBe(prompt({ ...student }));
  });
});

/**
 * A TUTOR, NOT A CHATBOT.
 *
 * Aarav's bar is a real, warm, proactive human tutor. The three things that
 * most give a model away are the length of its turns, praise that carries no
 * information, and explaining before it has asked what the child already
 * thinks. Each is pinned here, on the persona every live prompt is built from.
 */
describe('how she sounds', () => {
  it('bans stock praise, and says what to do instead', () => {
    const ban = TUTOR.neverDoes.find((line) => /Great job/.test(line));
    expect(ban).toBeDefined();
    expect(ban).toMatch(/Great question/);
    expect(ban).toMatch(/name that thing/i);
  });

  it('keeps a spoken turn to one or two short sentences', () => {
    const p = buildSystemPrompt({ moment: 'DOUBT_ANSWERING', student: { klass: 9 }, surface: 'voice' });
    expect(p).toMatch(/One or two short sentences/);
  });

  it('keeps a typed doubt reply just as short, since the app voices it as well', () => {
    const p = buildSystemPrompt({ moment: 'DOUBT_ANSWERING', student: { klass: 9 }, surface: 'text' });
    expect(p).toMatch(/One or two short sentences/);
  });

  it('asks before it tells when answering a doubt', () => {
    const p = buildSystemPrompt({ moment: 'DOUBT_ANSWERING', student: { klass: 9 }, surface: 'text' });
    expect(p).toMatch(/Ask before you tell/);
  });
});
