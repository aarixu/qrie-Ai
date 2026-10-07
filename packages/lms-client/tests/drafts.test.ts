// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DRAFT_MODEL, draftChat, readDrafts, type DraftAsk } from '../src/index.ts';

/**
 * AI-DRAFTED QUESTIONS: WHAT IS ASKED, AND WHAT IS KEPT OF THE ANSWER.
 * Written first.
 *
 * A teacher asks for a few multiple-choice questions on a chapter or topic.
 * The model is asked for exactly the shape lms.item holds — four options,
 * one right, and for each wrong option the mistake it catches — and its
 * answer is read strictly: anything that is not a usable question is
 * dropped and counted, never patched up and never shown to a child (the
 * teacher reviews every draft first, lms.item_draft).
 */

const ask: DraftAsk = { grade: 8, subject: 'Mathematics', chapter: 'Rational numbers', topic: 'Closure', count: 3 };

const good = (over: Record<string, unknown> = {}) => ({
  stem: 'Is the set of rational numbers closed under subtraction?',
  options: ['Yes, always', 'No, never', 'Only for positive numbers', 'Only for integers'],
  correctIndex: 0,
  misconceptions: ['', 'Thinks subtraction can leave the set', 'Thinks negatives are not rational', 'Confuses rationals with integers'],
  ...over,
});
const reply = (questions: unknown[]) => JSON.stringify({ questions });

describe('what is asked', () => {
  it('names the class, subject, chapter, topic and how many, on an allowed model, as JSON', () => {
    const chat = draftChat(ask);
    expect(chat.model).toBe(DRAFT_MODEL);
    expect(DRAFT_MODEL).toBe('google/gemini-3.7-flash');
    expect(chat.response_format).toEqual({ type: 'json_object' });
    const words = chat.messages.map((m) => m.content).join('\n');
    for (const said of ['Class 8', 'Mathematics', 'Rational numbers', 'Closure', '3 questions', 'CBSE', 'NCERT']) {
      expect(words).toContain(said);
    }
    expect(chat.max_tokens).toBeGreaterThan(0);
  });

  it('asks for 1 to 10 at a time, and carries the teacher’s note, cut to 300 characters', () => {
    expect(draftChat({ ...ask, count: 40 }).messages.at(-1)!.content).toContain('10 questions');
    expect(draftChat({ ...ask, count: 0 }).messages.at(-1)!.content).toContain('1 question');
    const note = 'Use word problems about a school canteen. '.repeat(20);
    const said = draftChat({ ...ask, note }).messages.at(-1)!.content;
    expect(said).toContain('Use word problems about a school canteen.');
    expect(said).not.toContain(note);
    expect(said).toContain(note.slice(0, 300).trim());
  });

  it('leaves the topic out when none is chosen', () => {
    const words = draftChat({ ...ask, topic: null }).messages.map((m) => m.content).join('\n');
    expect(words).not.toContain('Topic:');
  });
});

describe('what is kept of the answer', () => {
  it('keeps each usable question as lms.item holds it', () => {
    const { drafts, rejected } = readDrafts(reply([good()]), ask);
    expect(rejected).toBe(0);
    expect(drafts).toEqual([
      {
        stem: 'Is the set of rational numbers closed under subtraction?',
        options: ['Yes, always', 'No, never', 'Only for positive numbers', 'Only for integers'],
        correctIndex: 0,
        misconceptions: ['', 'Thinks subtraction can leave the set', 'Thinks negatives are not rational', 'Confuses rationals with integers'],
      },
    ]);
  });

  it('reads JSON wrapped in a code fence, or a bare list', () => {
    expect(readDrafts('```json\n' + reply([good()]) + '\n```', ask).drafts).toHaveLength(1);
    expect(readDrafts(JSON.stringify([good()]), ask).drafts).toHaveLength(1);
  });

  it('drops and counts anything that is not a usable question', () => {
    const bad = [
      good({ stem: '   ' }),
      good({ options: ['Only one'] }),
      good({ correctIndex: 4 }),
      good({ correctIndex: 1.5 }),
      good({ options: ['Yes', 'yes ', 'No', 'Maybe'] }),
      good({ options: ['Yes', '', 'No', 'Maybe'] }),
      good({ options: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] }),
      good({ stem: 'x'.repeat(601) }),
      good({ options: ['Yes', 'No', 'Maybe', 'y'.repeat(201)] }),
      'not a question',
      null,
    ];
    const { drafts, rejected } = readDrafts(reply([...bad, good()]), { ...ask, count: 10 });
    expect(drafts).toHaveLength(1);
    expect(rejected).toBe(bad.length);
  });

  it('keeps one of two questions with the same wording, and no more than were asked for', () => {
    const twice = readDrafts(reply([good(), good({ stem: '  is the set of RATIONAL numbers closed under subtraction? ' })]), ask);
    expect(twice.drafts).toHaveLength(1);
    expect(twice.rejected).toBe(1);
    const many = Array.from({ length: 5 }, (_, i) => good({ stem: `Question number ${i + 1}?` }));
    expect(readDrafts(reply(many), { ...ask, count: 2 }).drafts.map((d) => d.stem)).toEqual(['Question number 1?', 'Question number 2?']);
  });

  it('keeps a question whose mistakes are missing or do not line up, without them', () => {
    const none = readDrafts(reply([good({ misconceptions: undefined })]), ask).drafts[0];
    expect(none.misconceptions).toEqual(['', '', '', '']);
    const short = readDrafts(reply([good({ misconceptions: ['', 'One'] })]), ask).drafts[0];
    expect(short.misconceptions).toEqual(['', '', '', '']);
    // The right option never carries a mistake, whatever the model wrote there; a label is 120 characters at most.
    const odd = readDrafts(reply([good({ misconceptions: ['Should not be here', 'z'.repeat(130), 7, '  Fine  '] })]), ask).drafts[0];
    expect(odd.misconceptions).toEqual(['', '', '', 'Fine']);
  });

  it('trims every piece of text', () => {
    const d = readDrafts(reply([good({ stem: '\n  What is 1/2 + 1/3?\t', options: [' 5/6 ', '2/5', '1/6', '2/6'] })]), ask).drafts[0];
    expect(d.stem).toBe('What is 1/2 + 1/3?');
    expect(d.options[0]).toBe('5/6');
  });

  it('says so in plain words when the answer is not JSON, or has no questions in it', () => {
    expect(() => readDrafts('Sure! Here are some questions: 1. ...', ask)).toThrow(/could not be read/);
    expect(() => readDrafts(JSON.stringify({ questions: 'none' }), ask)).toThrow(/could not be read/);
  });
});
