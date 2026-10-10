import { describe, expect, it } from 'vitest';
import { REGISTER, TUTOR_LANGUAGES, buildSystemPrompt, describeFactors, registerLine, type StudentContext } from '../src/index';

/**
 * THE LANGUAGE THE CHILD CHOSE, CARRIED INTO EVERY PROMPT SHE SPEAKS FROM.
 *
 * Onboarding asks each student whether the tutor should speak English or
 * Hinglish (apps/classroom/src/lib/workspace.ts, `tutorLanguage()`). Since v3
 * (Aarav, 2026-10-10) English is the base and Hinglish is a module chosen per
 * student, not part of who she is. These tests pin the module each language
 * renders, so it cannot be softened or dropped silently.
 */

const HINGLISH =
  'Speak Hinglish in Roman script, never Devanagari: English only for subject terms, plain spoken Hindi for the rest. Say "tum" to them, never "aap" or "tu". You are a woman ("main samjhati hoon"); for them use words that carry no gender ("samajh aaya?", "batao", "socho"): never future forms such as "samjhaoge", "karoge", "miloge", say "samjhao", "karo", "milte hain" instead, unless their own sentence shows their gender. Say "shukriya", not "thank you", and never "wah", "shabash" or "bilkul sahi" as praise. Everyday numbers in Hindi words, maths in English words.';

const prompt = (student: StudentContext): string => buildSystemPrompt({ moment: 'DOUBT_ANSWERING', student, surface: 'voice' });

describe('the language module', () => {
  it('spells the two languages the app stores, and no third', () => {
    expect([...TUTOR_LANGUAGES]).toEqual(['en', 'hi-en']);
  });

  it('asks for Roman-script Hinglish in these exact words', () => {
    expect(REGISTER['hi-en']).toBe(HINGLISH);
    expect(registerLine('hi-en')).toBe(HINGLISH);
  });

  it('asks for plain Indian English, and says nothing about Hinglish', () => {
    expect(REGISTER.en).toMatch(/Indian English/);
    expect(REGISTER.en).not.toMatch(/hinglish|devanagari/i);
    expect(registerLine('en')).toBe(REGISTER.en);
  });

  it('is one paragraph per language, held under a ceiling because it rides on every call', () => {
    // Raised from 200 characters on purpose (2026-10-11): v3's Hinglish module
    // carries the grammar rules the 5-draw test showed the model needs. Growing
    // it again is a decision, not a drift.
    for (const language of TUTOR_LANGUAGES) {
      expect(REGISTER[language]).not.toContain('\n');
      expect(REGISTER[language].length).toBeLessThanOrEqual(650);
    }
  });
});

describe('the language in the prompt', () => {
  it('sits with the speaking rules, never inside the private learner notes', () => {
    expect(describeFactors({ klass: 9, language: 'hi-en' })).toHaveLength(1);
    const p = prompt({ klass: 9, language: 'hi-en' });
    const notes = p.split('\n\n').find((block) => block.startsWith('THE LEARNER')) ?? '';
    expect(notes).not.toContain(HINGLISH);
    expect(p.indexOf(HINGLISH)).toBeLessThan(p.indexOf('HOW TO SPEAK'));
  });

  it('does not contradict a Hinglish module anywhere above it', () => {
    for (const klass of [7, 9, 12] as const) {
      const p = prompt({ klass, language: 'hi-en' });
      expect(p).not.toMatch(/syllabus in English/);
      expect(p).not.toMatch(/plain English/i);
      expect(p).not.toMatch(/Stay in English/);
    }
  });

  it('is deterministic for the same language', () => {
    const student: StudentContext = { klass: 7, language: 'hi-en', mastery: 0.2 };
    expect(prompt(student)).toBe(prompt({ ...student }));
  });
});
