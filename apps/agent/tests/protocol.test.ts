import { describe, expect, it } from 'vitest';
import {
  encodeDoubtBrief,
  parseDoubtBrief,
  readDoubtBrief,
  readDoubtRequest,
  readTokenRequest,
  safeName,
  type DoubtBrief,
} from '../src/protocol.ts';

const brief: DoubtBrief = {
  lessonId: 'photosynthesis',
  beatId: 'b-04',
  beatTopic: 'Where the sugar comes from',
  subject: 'Science',
  title: 'How plants eat',
  transcriptSoFar: 'Plants make their own food.\nThey use sunlight.',
  onScreen: ['leaf', 'arrow-sun'],
  recallableBeats: [
    { id: 'b-01', topic: 'What a leaf does' },
    { id: 'b-04', topic: 'Where the sugar comes from' },
  ],
  studentIdentity: 'student-42',
  studentName: 'Aarav',
  student: { klass: 9, mastery: 0.3, lastAnswer: 'slow-wrong', attendance: { kind: 'streak', days: 4 } },
};

describe('doubt brief', () => {
  it('survives the round trip the dispatch actually makes', () => {
    expect(parseDoubtBrief(encodeDoubtBrief(brief))).toEqual(brief);
  });

  it('refuses metadata that cannot brief anybody', () => {
    expect(parseDoubtBrief(undefined)).toBeNull();
    expect(parseDoubtBrief(null)).toBeNull();
    expect(parseDoubtBrief('')).toBeNull();
    expect(parseDoubtBrief('{ not json')).toBeNull();
    expect(parseDoubtBrief('"a string"')).toBeNull();
    expect(parseDoubtBrief('[]')).toBeNull();
    expect(parseDoubtBrief('{}')).toBeNull();
  });

  it('requires the five fields with no honest default', () => {
    for (const missing of ['lessonId', 'beatId', 'beatTopic', 'studentIdentity', 'student']) {
      const partial: Record<string, unknown> = { ...brief };
      delete partial[missing];
      expect(readDoubtBrief(partial)).toBeNull();
    }
  });

  it('refuses a class this product does not teach rather than guessing one', () => {
    for (const klass of [5, 13, 9.5, '9', null]) {
      expect(readDoubtBrief({ ...brief, student: { klass } })).toBeNull();
    }
    expect(readDoubtBrief({ ...brief, student: { klass: 6 } })?.student.klass).toBe(6);
    expect(readDoubtBrief({ ...brief, student: { klass: 12 } })?.student.klass).toBe(12);
  });

  it('drops student factors it cannot believe, and keeps the ones it can', () => {
    const parsed = readDoubtBrief({
      ...brief,
      student: {
        klass: 7,
        mastery: 'high',
        doubtCount: 4,
        lastAnswer: 'sideways',
        namedMisconception: '   ',
        attendance: { kind: 'returning' },
      },
    });
    expect(parsed?.student).toEqual({ klass: 7, doubtCount: 4 });
  });

  it('keeps a returning student, days and all', () => {
    const parsed = readDoubtBrief({
      ...brief,
      student: { klass: 8, attendance: { kind: 'returning', daysAway: 3 } },
    });
    expect(parsed?.student.attendance).toEqual({ kind: 'returning', daysAway: 3 });
  });

  it('drops recallable beats that are missing an id or a topic', () => {
    const parsed = readDoubtBrief({
      ...brief,
      recallableBeats: [
        { id: 'b-01', topic: 'What a leaf does' },
        { id: 'b-02' },
        { topic: 'orphan' },
        'b-03',
        null,
      ],
    });
    expect(parsed?.recallableBeats).toEqual([{ id: 'b-01', topic: 'What a leaf does' }]);
  });

  it('defaults the optional lesson fields instead of failing', () => {
    const parsed = readDoubtBrief({
      lessonId: 'l',
      beatId: 'b',
      beatTopic: 't',
      studentIdentity: 'student-1',
      student: { klass: 10 },
    });
    expect(parsed).toEqual({
      lessonId: 'l',
      beatId: 'b',
      beatTopic: 't',
      transcriptSoFar: '',
      onScreen: [],
      recallableBeats: [],
      studentIdentity: 'student-1',
      student: { klass: 10 },
    });
  });
});

describe('safeName', () => {
  it('trims and keeps ordinary names', () => {
    expect(safeName('  lesson-photosynthesis-aarav  ')).toBe('lesson-photosynthesis-aarav');
  });

  it('refuses empties, non-strings, control characters and absurd lengths', () => {
    expect(safeName('')).toBeUndefined();
    expect(safeName('   ')).toBeUndefined();
    expect(safeName(42)).toBeUndefined();
    expect(safeName(undefined)).toBeUndefined();
    expect(safeName('room\nINFO: minted a token')).toBeUndefined();
    expect(safeName('r'.repeat(201))).toBeUndefined();
    expect(safeName('r'.repeat(200))).toHaveLength(200);
  });
});

describe('http request bodies', () => {
  it('reads a token request', () => {
    expect(readTokenRequest({ room: 'r-1', identity: 'student-42', name: 'Aarav' })).toEqual({
      room: 'r-1',
      identity: 'student-42',
      name: 'Aarav',
    });
    expect(readTokenRequest({ room: 'r-1', identity: 'student-42' })).toEqual({
      room: 'r-1',
      identity: 'student-42',
    });
  });

  it('refuses a token request without a room or an identity', () => {
    expect(readTokenRequest({ identity: 'student-42' })).toBeNull();
    expect(readTokenRequest({ room: 'r-1' })).toBeNull();
    expect(readTokenRequest('r-1')).toBeNull();
    expect(readTokenRequest(null)).toBeNull();
  });

  it('reads a doubt request and refuses one whose brief is unusable', () => {
    expect(readDoubtRequest({ room: 'r-1', brief })).toEqual({ room: 'r-1', brief });
    expect(readDoubtRequest({ room: 'r-1', brief: { ...brief, student: { klass: 3 } } })).toBeNull();
    expect(readDoubtRequest({ brief })).toBeNull();
    expect(readDoubtRequest({ room: 'r-1' })).toBeNull();
  });
});
