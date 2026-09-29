import { describe, expect, it } from 'vitest';
import {
  REVEAL_WINDOW_MS,
  createRevealMemory,
  type RevealHolder,
} from '../src/lib/quizReveal';

/**
 * B5 — A RETAKE RIGHT AFTER THE REVEAL IS NOT A COLD ANSWER.
 *
 * Checking a quiz question marks the right option on screen, and "Try again"
 * rebuilds the SAME quiz (it is deterministic on purpose). So a retake minutes
 * later is answered with the answer fresh in view — and `quizLedger` filed it
 * at rung 0 with attempt 1, the strongest evidence the product has, which is
 * exactly the manufactured mastery the ladder exists to stop.
 */

const holder = (): RevealHolder & { value: Record<string, { at: number; times: number }> } => {
  const h = {
    value: {} as Record<string, { at: number; times: number }>,
    get: () => h.value,
    set: (next: Record<string, { at: number; times: number }>) => {
      h.value = next;
    },
  };
  return h;
};

const T0 = Date.parse('2026-09-29T10:00:00.000Z');
const MINUTE = 60_000;

describe('the reveal memory', () => {
  it('files a question never revealed as cold, first try', () => {
    const memory = createRevealMemory(holder());
    expect(memory.helpFor('p1', T0)).toEqual({ assistanceRung: 0, attempt: 1, hintsShown: 0 });
  });

  it('files a retake right after the reveal at rung 7 or above, as a second try', () => {
    const memory = createRevealMemory(holder());
    memory.markRevealed('p1', T0);
    const help = memory.helpFor('p1', T0 + 3 * MINUTE);
    expect(help.assistanceRung).toBeGreaterThanOrEqual(7);
    expect(help.attempt).toBe(2);
    expect(help.hintsShown).toBeGreaterThanOrEqual(1);
  });

  it('counts each retake inside the window as the next try', () => {
    const memory = createRevealMemory(holder());
    memory.markRevealed('p1', T0);
    memory.markRevealed('p1', T0 + MINUTE);
    expect(memory.helpFor('p1', T0 + 2 * MINUTE).attempt).toBe(3);
  });

  it('leaves every other question cold', () => {
    const memory = createRevealMemory(holder());
    memory.markRevealed('p1', T0);
    expect(memory.helpFor('p2', T0 + MINUTE).assistanceRung).toBe(0);
  });

  it('treats a retake a full window later as a real retest again', () => {
    const memory = createRevealMemory(holder());
    memory.markRevealed('p1', T0);
    expect(memory.helpFor('p1', T0 + REVEAL_WINDOW_MS)).toEqual({
      assistanceRung: 0,
      attempt: 1,
      hintsShown: 0,
    });
  });

  it('does not launder a reveal through a clock that stepped backwards', () => {
    const memory = createRevealMemory(holder());
    memory.markRevealed('p1', T0);
    expect(memory.helpFor('p1', T0 - 5 * MINUTE).assistanceRung).toBeGreaterThanOrEqual(7);
  });

  it('survives a reload: a new memory over the same storage still knows', () => {
    const shared = holder();
    createRevealMemory(shared).markRevealed('p1', T0);
    expect(createRevealMemory(shared).helpFor('p1', T0 + MINUTE).assistanceRung).toBeGreaterThanOrEqual(7);
  });

  it('forgets reveals older than the window, so the record cannot grow forever', () => {
    const shared = holder();
    const memory = createRevealMemory(shared);
    memory.markRevealed('old', T0);
    memory.markRevealed('new', T0 + REVEAL_WINDOW_MS + MINUTE);
    expect(Object.keys(shared.value)).toEqual(['new']);
  });

  it('still answers when storage throws, erring toward help', () => {
    const broken: RevealHolder = {
      get: () => {
        throw new Error('storage blocked');
      },
      set: () => {
        throw new Error('storage blocked');
      },
    };
    const memory = createRevealMemory(broken);
    expect(() => memory.markRevealed('p1', T0)).not.toThrow();
    // Remembered in memory for this page, so the retake the Try-again button
    // leads to is still not filed as cold.
    expect(memory.helpFor('p1', T0 + MINUTE).assistanceRung).toBeGreaterThanOrEqual(7);
  });
});
