import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphIndex } from '@ai-tutor/knowledge-graph';
import { emptyConceptState, emptyModel } from '@ai-tutor/learner-model';

vi.mock('../src/lib/supabase', () => ({ supabase: () => null }));
vi.mock('../src/lib/content', () => ({
  fetchCatalog: async () => [
    { id: 'lesson-a', title: 'A', class: 10, subject: 'Maths', path: 'a/lesson.json', topicRef: 'x/ch/a' },
    { id: 'lesson-d', title: 'D', class: 10, subject: 'Maths', path: 'd/lesson.json', topicRef: 'x/ch/d' },
  ],
}));
vi.mock('../src/lib/quiz', () => ({ buildQuiz: (id: string) => (id === 'lesson-a' ? [{}] : null) }));

const { beforeNext } = await import('../src/lib/nextStep');
const { learnerModelStore } = await import('../src/lib/learnerModel');

const node = (id: string, prerequisites: string[] = []) => ({
  id, klass: 10, subject: 'Maths', chapter: 'ch', title: `Outcome ${id.toUpperCase()}`, outcome: id,
  prerequisites, difficulty: 2, topicRef: `x/ch/${id}`,
});
const index = new GraphIndex({ version: 1, nodes: [node('a'), node('d', ['a'])] } as never);
const entry = (id: string, topicRef: string) => ({ id, title: id, class: 10, subject: 'Maths', path: '', topicRef });

describe('before the next lesson (E6-E8)', () => {
  beforeEach(() => localStorage.clear());

  it('sends a due review to the practice for the lesson that teaches it', async () => {
    learnerModelStore.set({
      ...emptyModel(),
      states: { a: { ...emptyConceptState('a'), box: 1, nextReviewAt: '2026-09-20T10:00:00.000Z' } },
    });
    const step = await beforeNext({ index, done: entry('lesson-x', 'x/ch/x'), next: entry('lesson-d', 'x/ch/d'), now: new Date('2026-09-29T10:00:00Z') });
    expect(step).toMatchObject({ kind: 'review', titles: ['Outcome A'], route: '/quiz/lesson-a' });
  });

  it('says nothing when nothing is due and nothing it rests on is shaky', async () => {
    learnerModelStore.set(emptyModel());
    expect(await beforeNext({ index, done: null, next: entry('lesson-d', 'x/ch/d') })).toBeNull();
  });
});
