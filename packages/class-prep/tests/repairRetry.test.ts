import { describe, expect, it } from 'vitest';
import { prepareClass, REPAIR_WAITS_MS, type LlmAdapter } from '../src/prepare';
import { isNotNow } from '../src/notNow';
import { saveable } from '../src/save';
import type { Blueprint } from '../src/types';
import { RESPIRATION_OUTCOMES, asOutcomes, respiration, respirationFirstPlan } from './fixtures/class10Science';

/**
 * A REPAIR THAT HEARS "NOT NOW" ASKS AGAIN, LATER.
 *
 * Respiration, 2026-10-01: the first plan was sent to repair, the repair call
 * came back "Resource exhausted ... error-code-429" after the relay's own two
 * quick retries (packages/relay/src/vertex.ts: 1 s and 3 s), the round was
 * written off as "Repair failed", and the class went on to buy its review and
 * its pictures — Rs 10 — for a plan nothing had fixed. A rate limit says
 * nothing about the plan, and a paid-for class should not be thrown away over
 * one; so the REPAIR step waits longer and asks again, a bounded number of
 * times. Interactive calls are untouched: this is preparation's own retry.
 */

const VERTEX_429 =
  'Resource exhausted. Please try again later. Please refer to https://cloud.google.com/vertex-ai/generative-ai/docs/error-code-429 for more details.';
const refused = (status: number, reason?: string, retryAfterSeconds?: number): Error =>
  Object.assign(new Error(reason === 'budget' ? 'You have used up today’s classes.' : VERTEX_429), {
    status,
    ...(reason ? { reason } : {}),
    ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
  });

/** Each call answers with the next reply: a plan, a string, or an error to throw. */
const scripted = (...replies: (Blueprint | string | Error)[]): LlmAdapter & { asked: string[] } => {
  const asked: string[] = [];
  let n = 0;
  return {
    asked,
    complete: async (_system: string, user: string) => {
      asked.push(user);
      const reply = replies[Math.min(n++, replies.length - 1)];
      if (reply instanceof Error) throw reply;
      return typeof reply === 'string' ? reply : JSON.stringify(reply);
    },
  };
};
const artist: LlmAdapter = { complete: async () => '<svg/>' };
const outcomes = asOutcomes(RESPIRATION_OUTCOMES);
const keep = (made: Awaited<ReturnType<typeof prepareClass>>) => {
  for (const el of made.lesson.elements) if (el.kind === 'graphic') made.assets[el.id] = '<svg/>';
  return saveable(made, { topicRef: 'class10-science/life-processes/respiration', klass: 10, subject: 'Science' });
};
const clock = () => {
  const waited: number[] = [];
  return { waited, sleep: async (ms: number) => void waited.push(ms) };
};

describe('which refusals are worth waiting out', () => {
  it('waits out a rate limit, and a service that is busy or whose meter is down', () => {
    expect(isNotNow(refused(429))).toBe(true);
    expect(isNotNow(refused(429, 'rate'))).toBe(true);
    expect(isNotNow(refused(503))).toBe(true);
    expect(isNotNow(refused(503, 'unavailable'))).toBe(true);
  });

  it('does not wait out a day’s budget, a project cap or a deliberate halt', () => {
    expect(isNotNow(refused(429, 'budget'))).toBe(false);
    expect(isNotNow(refused(503, 'capped'))).toBe(false);
    expect(isNotNow(refused(503, 'halted'))).toBe(false);
  });

  it('does not wait out anything else', () => {
    expect(isNotNow(new Error(VERTEX_429))).toBe(false); // no status: not known to be a refusal
    expect(isNotNow(Object.assign(new Error('bad request'), { status: 400 }))).toBe(false);
    expect(isNotNow('429')).toBe(false);
  });
});

describe('the structural repair', () => {
  it('waits and asks again when the repair call is rate-limited, and the repaired class is kept', async () => {
    const planner = scripted(respirationFirstPlan(), refused(429), respiration());
    const { waited, sleep } = clock();
    const made = await prepareClass({
      topic: 'Respiration',
      klass: 10,
      planner,
      artist,
      outcomes,
      repairRetry: { sleep },
    });
    expect(planner.asked).toHaveLength(3);
    expect(waited).toEqual([REPAIR_WAITS_MS[0]]);
    expect(made.report.issues.join(' ')).toContain('repaired and passed');
    expect(made.report.issues.join(' ')).not.toContain('Repair failed');
    expect(keep(made)).not.toBeNull();
  });

  it('waits longer each time, and only as many times as it is allowed', async () => {
    const planner = scripted(respirationFirstPlan(), refused(429));
    const { waited, sleep } = clock();
    await expect(
      prepareClass({ topic: 'Respiration', klass: 10, planner, artist, outcomes, repairRetry: { sleep } }),
    ).rejects.toThrow(/not valid/);
    expect(waited).toEqual([...REPAIR_WAITS_MS]);
    expect(REPAIR_WAITS_MS[1]).toBeGreaterThan(REPAIR_WAITS_MS[0]);
    // The plan, then the repair and each of its retries.
    expect(planner.asked).toHaveLength(2 + REPAIR_WAITS_MS.length);
  });

  it('does not wait out a budget refusal: tomorrow is not a backoff', async () => {
    const planner = scripted(respirationFirstPlan(), refused(429, 'budget'));
    const { waited, sleep } = clock();
    await expect(
      prepareClass({ topic: 'Respiration', klass: 10, planner, artist, outcomes, repairRetry: { sleep } }),
    ).rejects.toThrow(/not valid/);
    expect(waited).toEqual([]);
    expect(planner.asked).toHaveLength(2);
  });

  it('honours the relay’s Retry-After when it asks for longer, up to a minute', async () => {
    const asked = clock();
    await prepareClass({
      topic: 'Respiration',
      klass: 10,
      planner: scripted(respirationFirstPlan(), refused(429, 'rate', 45), respiration()),
      artist,
      outcomes,
      repairRetry: { sleep: asked.sleep },
    });
    expect(asked.waited).toEqual([45_000]);

    const capped = clock();
    await prepareClass({
      topic: 'Respiration',
      klass: 10,
      planner: scripted(respirationFirstPlan(), refused(429, 'rate', 600), respiration()),
      artist,
      outcomes,
      repairRetry: { sleep: capped.sleep },
    });
    expect(capped.waited).toEqual([60_000]);
  });

  it('says on the report that it waited, so a slow preparation can be explained', async () => {
    const made = await prepareClass({
      topic: 'Respiration',
      klass: 10,
      planner: scripted(respirationFirstPlan(), refused(429), respiration()),
      artist,
      outcomes,
      repairRetry: { sleep: clock().sleep },
    });
    expect(made.report.issues.join(' ')).toMatch(/rate-limited.*waited 10 s/i);
  });
});

describe('the other two repair rounds', () => {
  it('asks again for a plan that came back garbled, after a rate limit', async () => {
    const { waited, sleep } = clock();
    const made = await prepareClass({
      topic: 'Respiration',
      klass: 10,
      planner: scripted('this is not json', refused(429), respiration()),
      artist,
      outcomes,
      repairRetry: { sleep },
    });
    expect(waited).toEqual([REPAIR_WAITS_MS[0]]);
    expect(made.lesson.beats.length).toBeGreaterThan(0);
  });

  it('corrects the teaching after a rate limit, when the reviewer flagged it', async () => {
    let reviews = 0;
    const reviewer: LlmAdapter = {
      complete: async () =>
        reviews++ === 0
          ? JSON.stringify({ ok: false, problems: [{ beatId: 'b2', claim: 'a wrong claim', why: 'it is wrong' }] })
          : JSON.stringify({ ok: true, problems: [] }),
    };
    const { waited, sleep } = clock();
    const made = await prepareClass({
      topic: 'Respiration',
      klass: 10,
      planner: scripted(respiration(), refused(503), respiration()),
      artist,
      reviewer,
      outcomes,
      repairRetry: { sleep },
    });
    expect(waited).toEqual([REPAIR_WAITS_MS[0]]);
    expect(made.report.review?.repaired).toBe(true);
  });
});
