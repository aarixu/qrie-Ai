import { beforeEach, describe, expect, it } from 'vitest';
import type { DiagnosticResult } from '@ai-tutor/knowledge-graph';
import { emptyConceptState, emptyModel } from '@ai-tutor/learner-model';
import { adaptToQuiz } from '../src/lib/adaptPlan';
import { learnerModelStore } from '../src/lib/learnerModel';
import { loadDiagnosticDataFor } from '../src/lib/diagnosticData';
import type { QuizOutcome } from '../src/lib/quiz';
import { profileStore } from '../src/stores/profile';
import { settingsStore } from '../src/stores/settings';

/**
 * THE QUIZ MOVES THE PLAN, AND ONLY THE PLAN.
 *
 * profile.diagnostic used to be rewritten wholesale after every quiz — the
 * placement's mastery evolved into a hybrid that was neither the placement's
 * record nor the model's belief, and it was still read as live belief by two
 * surfaces. Task 3.4's own words are "after this nothing writes belief
 * directly"; these tests are the guard that sentence never had.
 *
 * Real map, real probe bank — a fixture would only prove the fixture adapts.
 */

const data = loadDiagnosticDataFor(10, ['Science']);
if (!data) throw new Error('the Class 10 Science map failed to load');

const probe = data.bank.probes[0];
const nodeId = probe.nodeId;

/** The placement called this node solid. The MODEL has never heard of it. */
const placement = (): DiagnosticResult => ({
  mastery: { [nodeId]: 0.99 },
  gaps: [],
  plan: [],
  answers: [],
});

const quiz = (correct: boolean, rows: number): QuizOutcome => ({
  lessonRef: 'class10-science/life-processes/nutrition',
  score: correct ? rows : 0,
  total: rows,
  rows: Array.from({ length: rows }, (_, i) => ({
    questionId: `${probe.id}:${i}`,
    nodeId,
    title: 'a step',
    question: 'a question',
    chosenIndex: correct ? 0 : 1,
    correctIndex: 0,
    correct,
    ms: 4000,
    misconception: null,
  })),
  elapsedMs: 60_000,
  bestStreak: correct ? rows : 0,
});

beforeEach(() => {
  localStorage.clear();
  // The store caches in memory, so clearing localStorage alone does not empty
  // it: a model one test sets would otherwise be the next test's belief.
  learnerModelStore.set(emptyModel());
  profileStore.update((p) => ({
    ...p,
    name: 'Asha',
    klass: 10,
    subjects: ['Science'],
    diagnostic: placement(),
    diagnosedAt: '2026-09-01T10:00:00.000Z',
  }));
  settingsStore.update((s) => ({ ...s, klass: 10 }));
});

describe('adaptToQuiz', () => {
  it('a failed quiz grows the plan without rewriting the placement record', () => {
    const change = adaptToQuiz(quiz(false, 3));

    // Belief comes from the MODEL, which holds nothing on this node — so three
    // wrong answers sink it from the prior and it becomes a step. Under the
    // old blob seeding the placement's 0.99 would have vetoed the gap the
    // student just demonstrated.
    expect(change).not.toBeNull();
    expect(change!.added.map((s) => s.nodeId)).toContain(nodeId);

    const stored = profileStore.get().diagnostic!;
    expect(stored.plan.map((s) => s.nodeId)).toContain(nodeId);
    // And the placement stays what it was: a record of that day, not a live
    // belief store for quizzes to evolve.
    expect(stored.mastery).toEqual({ [nodeId]: 0.99 });
  });

  /**
   * B6. The plan's gaps are decisions, so they read what the student did
   * ALONE. An outcome whose only evidence is a hinted answer has no cold
   * reading at all — unknown, not weak — and a blended 0.1 from help must not
   * put it on the plan. (Finding out, with a cold item, is E6's job.)
   */
  it('plans no gap from belief that only help produced', () => {
    const other = data.index.ids().find((id) => id !== nodeId && data.index.node(id)?.klass === 10);
    if (!other) throw new Error('the map has only one Class 10 node');
    learnerModelStore.set({
      ...emptyModel(),
      states: {
        [other]: {
          ...emptyConceptState(other),
          mastery: 0.1,
          assistedPerformance: 0.1,
          observations: 1,
          answerObservations: 1,
        },
      },
    });

    const change = adaptToQuiz(quiz(true, 3));
    expect(change!.added.map((s) => s.nodeId)).not.toContain(other);
  });

  it('still plans a gap the student showed cold', () => {
    const other = data.index.ids().find((id) => id !== nodeId && data.index.node(id)?.klass === 10);
    if (!other) throw new Error('the map has only one Class 10 node');
    learnerModelStore.set({
      ...emptyModel(),
      states: {
        [other]: {
          ...emptyConceptState(other),
          mastery: 0.1,
          unassistedMastery: 0.1,
          observations: 1,
          answerObservations: 1,
          unassistedObservations: 1,
        },
      },
    });

    const change = adaptToQuiz(quiz(true, 3));
    expect(change!.added.map((s) => s.nodeId)).toContain(other);
  });

  it('a clean quiz rewrites nothing at all', () => {
    const before = profileStore.get();
    const change = adaptToQuiz(quiz(true, 3));

    expect(change).not.toBeNull();
    expect(change!.added).toEqual([]);
    expect(change!.dropped).toEqual([]);
    // Same object, not merely equal: no write means no churned sync stamp.
    expect(profileStore.get().diagnostic).toBe(before.diagnostic);
  });
});
