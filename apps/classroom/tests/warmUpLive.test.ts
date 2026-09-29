// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyConceptState, emptyModel } from '@ai-tutor/learner-model';
import { warmUpFor } from '../src/lib/warmUp';
import { learnerModelStore } from '../src/lib/learnerModel';
import { settingsStore } from '../src/stores/settings';

/**
 * THE WARM-UP AGAINST THE MAPS AND THE BANK THAT SHIP — the picker's own tests
 * use a toy map; this is the join a real student gets.
 */
const NODE = 'class9-mathematics-explain-two-number-lines';
const due = { ...emptyConceptState(NODE), box: 1, nextReviewAt: '2026-09-20T10:00:00.000Z' };
const now = new Date('2026-09-29T10:00:00.000Z');

describe('the warm-up on the shipped maps', () => {
  beforeEach(() => {
    localStorage.clear();
    settingsStore.set({ klass: 9 });
  });

  it('asks an authored question about the outcome that is due', async () => {
    learnerModelStore.set({ ...emptyModel(), states: { [NODE]: due } });
    const [question] = await warmUpFor('class9-mathematics/polynomials/zeroes', now);
    expect(question).toMatchObject({ nodeId: NODE, title: 'Two perpendicular number lines' });
    expect(question.options[question.correctIndex]).toBeTruthy();
  });

  it('asks nothing on the topic the class is about to teach', async () => {
    learnerModelStore.set({ ...emptyModel(), states: { [NODE]: due } });
    expect(await warmUpFor('class9-mathematics/coordinate-geometry/introduction', now)).toEqual([]);
  });

  it('asks nothing when nothing is due', async () => {
    learnerModelStore.set(emptyModel());
    expect(await warmUpFor(undefined, now)).toEqual([]);
  });
});
