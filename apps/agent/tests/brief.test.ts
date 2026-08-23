import { describe, expect, it } from 'vitest';
import { TUTOR } from '@ai-tutor/persona';
import {
  doubtInstructions,
  findRecallable,
  recallConfirmation,
  recallRejection,
} from '../src/brief.ts';
import type { DoubtBrief } from '../src/protocol.ts';

const brief: DoubtBrief = {
  lessonId: 'photosynthesis',
  beatId: 'b-04',
  beatTopic: 'Where the sugar comes from',
  subject: 'Science',
  title: 'How plants eat',
  transcriptSoFar: 'Plants make their own food.',
  onScreen: ['leaf', 'arrow-sun'],
  recallableBeats: [
    { id: 'b-01', topic: 'What a leaf does' },
    { id: 'b-04', topic: 'Where the sugar comes from' },
  ],
  studentIdentity: 'student-42',
  student: { klass: 9, mastery: 0.3 },
};

describe('doubtInstructions', () => {
  const prompt = doubtInstructions(brief);

  it('is the persona, not a prompt written in this service', () => {
    expect(prompt).toContain(TUTOR.name);
    expect(prompt).toContain(TUTOR.values[0]);
    expect(prompt).toContain(TUTOR.neverDoes[0]);
  });

  it('opens the doubt rather than answering one nobody has asked yet', () => {
    expect(prompt).toContain('DOUBT_OPENING');
  });

  it('is briefed for a spoken room', () => {
    expect(prompt).toContain('HOW TO SPEAK — VOICE');
  });

  it('carries the moment of the class the hand went up on', () => {
    expect(prompt).toContain('Where the sugar comes from');
    expect(prompt).toContain('Plants make their own food.');
    expect(prompt).toContain('leaf');
  });

  it('enumerates every legal recall target by id', () => {
    expect(prompt).toContain('"b-01"');
    expect(prompt).toContain('"b-04"');
  });

  it('adapts to the student it was given', () => {
    const younger = doubtInstructions({ ...brief, student: { klass: 6 } });
    expect(younger).toContain('Class 6');
    expect(younger).not.toContain('Class 9');
  });

  it('is deterministic — the same brief is the same prompt', () => {
    expect(doubtInstructions(brief)).toBe(prompt);
  });
});

describe('recall validation', () => {
  it('finds a beat that exists', () => {
    expect(findRecallable(brief, 'b-01')).toEqual({ id: 'b-01', topic: 'What a leaf does' });
  });

  it('returns null for an id nobody listed', () => {
    expect(findRecallable(brief, 'b-99')).toBeNull();
    expect(findRecallable(brief, '')).toBeNull();
    expect(findRecallable(brief, 'B-01')).toBeNull();
  });

  it('tells the model what it may show instead, and that carrying on is allowed', () => {
    const message = recallRejection(brief, 'b-99');
    expect(message).toContain('b-99');
    expect(message).toContain('the board has not changed');
    expect(message).toContain('"b-01"');
    expect(message).toContain('What a leaf does');
    expect(message).toContain('carry on');
  });

  it('says so plainly when there is nothing to recall at all', () => {
    const message = recallRejection({ ...brief, recallableBeats: [] }, 'b-01');
    expect(message).toContain('nothing to bring back');
    expect(message).not.toContain('The ids you can show');
  });

  it('describes what landed on the board, because the model cannot see it', () => {
    expect(recallConfirmation({ id: 'b-01', topic: 'What a leaf does' })).toContain(
      'What a leaf does',
    );
  });
});
