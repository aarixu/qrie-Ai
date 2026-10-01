import { describe, expect, it } from 'vitest';
import { prepareClass, type LlmAdapter } from '../src/prepare';
import type { Blueprint } from '../src/types';
import {
  EXCRETION_OUTCOMES,
  KIDNEY_PARTS,
  asOutcomes,
  excretion,
  excretionFirstPlan,
} from './fixtures/class10Science';

/**
 * WHAT THE KEEP GATE WILL REFUSE IS KNOWN BEFORE THE MONEY IS SPENT.
 *
 * All three Class 10 Science topics refused on 2026-10-01 were refused for a
 * problem the in-prep gate could already see on the plan — before the reviewer
 * ran and before a single picture was paid for (canvas audit, item 1). Prep
 * named it to the one repair round and then, whatever the repair did, enforced
 * only the maths rule: overlap, outcomes and the rest were left to the keep
 * gate at the very end, and about thirty of the thirty-six paid calls bought a
 * class that was always going to be refused. Two more holes made it worse:
 *
 *   - a first plan that failed VALIDATION was never gated, so its gate problems
 *     never reached the repair (excretion: its outcomes problem could not be
 *     repaired because nobody told the planner about it);
 *   - a repaired plan that validated was reported "repaired and passed" even
 *     when its own gate still failed, so the state file could not say why.
 */

const scripted = (...plans: Blueprint[]): LlmAdapter & { asked: string[] } => {
  const asked: string[] = [];
  let n = 0;
  return {
    asked,
    complete: async (_system: string, user: string) => {
      asked.push(user);
      return JSON.stringify(plans[Math.min(n++, plans.length - 1)]);
    },
  };
};
const artist: LlmAdapter = { complete: async () => '<svg/>' };
const outcomes = asOutcomes(EXCRETION_OUTCOMES);

/** Excretion still carrying the b4 ask that claims no outcome, but valid. */
const stillUntagged = (): Blueprint => {
  const plan = excretionFirstPlan();
  plan.beats = plan.beats.filter((b) => b.id !== 'b5');
  return plan;
};

/** A reviewer, a picture maker and eyes that count every call they are paid for. */
const meters = () => {
  const calls = { review: 0, draw: 0, look: 0 };
  return {
    calls,
    reviewer: {
      complete: async () => {
        calls.review += 1;
        return JSON.stringify({ ok: true, problems: [] });
      },
    } satisfies LlmAdapter,
    imageArtist: {
      draw: async () => {
        calls.draw += 1;
        return 'data:image/png;base64,AAAA';
      },
    },
    eyes: {
      look: async () => {
        calls.look += 1;
        return JSON.stringify({ _count: 1, ...KIDNEY_PARTS });
      },
    },
  };
};

describe('the repair round hears every problem the first plan has', () => {
  it('names the gate’s problems even when the plan also fails validation', async () => {
    const planner = scripted(excretionFirstPlan(), excretion());
    await prepareClass({ topic: 'Excretion in Human Beings', klass: 10, planner, artist, outcomes });
    expect(planner.asked).toHaveLength(2);
    const told = planner.asked[1];
    expect(told).toMatch(/both taught and checked/);
    // b4's teaching ask claims nothing: the gate says so, and now it is heard.
    expect(told).toMatch(/Beat "b4": it asks a question but claims no outcome/);
    // The opening's context question is not one of them (see opening.test.ts).
    expect(told).not.toMatch(/Beat "b1": it asks a question but claims no outcome/);
  });

  it('writes every problem it sent to repair on the report, not only the first', async () => {
    const made = await prepareClass({
      topic: 'Excretion in Human Beings',
      klass: 10,
      planner: scripted(excretionFirstPlan(), excretion()),
      artist,
      outcomes,
    });
    const said = made.report.issues.join('\n');
    expect(said).toMatch(/both taught and checked/);
    expect(said).toMatch(/b4.*claims no outcome/);
  });
});

describe('a repaired plan is said to have passed only when it did', () => {
  it('says what the repaired plan still fails, instead of "repaired and passed"', async () => {
    const made = await prepareClass({
      topic: 'Excretion in Human Beings',
      klass: 10,
      planner: scripted(excretionFirstPlan(), stillUntagged()),
      artist,
      outcomes,
    });
    const said = made.report.issues.join('\n');
    expect(said).not.toContain('repaired and passed');
    expect(said).toMatch(/repaired.*still fails the keep gate.*outcomes@b4/i);
  });

  it('still says "repaired and passed" when it did', async () => {
    const made = await prepareClass({
      topic: 'Excretion in Human Beings',
      klass: 10,
      planner: scripted(excretionFirstPlan(), excretion()),
      artist,
      outcomes,
    });
    expect(made.report.issues.join(' ')).toContain('repaired and passed');
  });
});

describe('a caller that only keeps can stop before paying for what it will not keep', () => {
  it('stops before the review and the pictures, and says which rules', async () => {
    const m = meters();
    let opened = false;
    const run = prepareClass({
      topic: 'Excretion in Human Beings',
      klass: 10,
      planner: scripted(excretionFirstPlan(), stillUntagged()),
      artist,
      outcomes,
      reviewer: m.reviewer,
      imageArtist: m.imageArtist,
      eyes: m.eyes,
      stopWhenUnkeepable: true,
      onDraft: () => {
        opened = true;
      },
    });
    await expect(run).rejects.toThrow(/would not be kept.*outcomes@b4/);
    const e = (await run.catch((x: unknown) => x)) as { gateProblems?: { rule: string }[]; issues?: string[] };
    // For the state file: the problems, and what the repair round said.
    expect(e.gateProblems?.map((p) => p.rule)).toContain('outcomes');
    expect(e.issues?.join(' ')).toMatch(/still fails the keep gate/);
    // And nothing after the plan was bought.
    expect(m.calls).toEqual({ review: 0, draw: 0, look: 0 });
    expect(opened).toBe(false);
  });

  it('goes on to the review and the pictures when the plan would be kept', async () => {
    const m = meters();
    const made = await prepareClass({
      topic: 'Excretion in Human Beings',
      klass: 10,
      planner: scripted(excretion()),
      artist,
      outcomes,
      reviewer: m.reviewer,
      imageArtist: m.imageArtist,
      eyes: m.eyes,
      stopWhenUnkeepable: true,
    });
    expect(m.calls.review).toBe(1);
    expect(m.calls.draw).toBe(1);
    expect(made.report.gate).toEqual({ problems: [] });
  });

  it('leaves the live classroom’s posture alone: without the flag the class is taught, not kept', async () => {
    const m = meters();
    const made = await prepareClass({
      topic: 'Excretion in Human Beings',
      klass: 10,
      planner: scripted(excretionFirstPlan(), stillUntagged()),
      artist,
      outcomes,
      reviewer: m.reviewer,
      imageArtist: m.imageArtist,
      eyes: m.eyes,
    });
    expect(made.lesson.beats.length).toBeGreaterThan(0);
    expect(made.report.gate!.problems.map((p) => `${p.rule}@${p.where}`)).toContain('outcomes@b4_2');
    expect(m.calls.review).toBe(1);
  });
});
