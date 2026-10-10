import { describe, expect, it } from 'vitest';
import { CORE, coreFor } from '@ai-tutor/persona';
import { PLANNER_SYSTEM, plannerPersona, plannerSystemFor } from '../src/prompts';
import { prepareClass, type LlmAdapter } from '../src/prepare';

/**
 * HER CORE IN THE PLANNER'S CALL (persona v3, Aarav 2026-10-10: a small core
 * in EVERY model call: planner, judge, close, doubt, live).
 *
 * Every spoken line the planner writes comes out of her mouth, and until
 * 2026-10-11 the planner was told her name, a one-line voice and that she was
 * "an AI tutor" — none of her values, bans or safety. Now the core sits above
 * the plan, in the learner's language.
 */

describe('the planner\'s system prompt', () => {
  it('opens on who she is, then the plan, for an English class', () => {
    const text = plannerSystemFor(false, 'en');
    expect(text.startsWith(plannerPersona('en'))).toBe(true);
    expect(plannerPersona('en')).toContain(coreFor('en'));
    expect(text).toBe(`${plannerPersona('en')}\n\n${PLANNER_SYSTEM}`);
  });

  it('carries the Hinglish module for a Hinglish class', () => {
    expect(plannerSystemFor(false, 'hi-en')).toContain(coreFor('hi-en'));
    expect(plannerSystemFor(false, 'hi-en')).not.toContain(coreFor('en'));
  });

  it('is English when no language is given', () => {
    expect(plannerSystemFor(false)).toBe(plannerSystemFor(false, 'en'));
  });

  it('keeps the core on the composed board too, with the page contract after the plan', () => {
    const text = plannerSystemFor(true, 'hi-en');
    expect(text.indexOf(CORE)).toBe(text.indexOf(plannerPersona('hi-en')) + plannerPersona('hi-en').indexOf(CORE));
    expect(text.indexOf('the page contract')).toBeGreaterThan(text.indexOf(CORE));
  });

  it('no longer calls her "an AI tutor" (she says what she is only when asked)', () => {
    expect(PLANNER_SYSTEM).not.toMatch(/an AI tutor/);
    expect(plannerSystemFor(true, 'en')).not.toMatch(/an AI tutor/);
  });
});

describe('prepareClass hands the planner her core in the class\'s language', () => {
  const PLAN = {
    id: 'digestion',
    title: 'Digestion',
    visuals: [],
    beats: [
      {
        id: 'b1',
        topic: 'Digestion',
        narration: '',
        board: [
          { do: 'title', text: 'Digestion' },
          { do: 'say', text: 'Food goes on a journey through four places.' },
          { do: 'say', text: 'So food is broken down, then taken in.' },
        ],
      },
    ],
  };

  it.each(['en', 'hi-en'] as const)('for a %s class', async (language) => {
    const systems: string[] = [];
    const planner: LlmAdapter = {
      complete: async (system: string) => {
        systems.push(system);
        return JSON.stringify(PLAN);
      },
    };
    const artist: LlmAdapter = { complete: async () => '' };
    await prepareClass({ topic: 'Digestion', klass: 7, planner, artist, language }).catch(() => undefined);
    expect(systems.length).toBeGreaterThan(0);
    for (const system of systems.filter((s) => s.includes('You plan one short lesson'))) {
      expect(system).toContain(coreFor(language));
    }
  });
});
