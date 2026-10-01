import { describe, expect, it } from 'vitest';
import { prepareClass, type LlmAdapter } from '../src/prepare';
import { saveable, whyNotSaveable } from '../src/save';
import type { MathsCheck } from '../src/gate';
import type { Blueprint } from '../src/types';
import {
  EXCRETION_OUTCOMES,
  KIDNEY_PARTS,
  RESPIRATION_OUTCOMES,
  TRANSPORTATION_OUTCOMES,
  asOutcomes,
  excretion,
  respiration,
  transportation,
} from './fixtures/class10Science';

/**
 * THE THREE REFUSED CLASS 10 SCIENCE TOPICS, PREPARED AGAIN WITH NO MODEL.
 *
 * Each is a plan shaped like the one the live run made (fixtures/
 * class10Science.ts), run through prepareClass with stub models and then
 * through the same `saveable` the prewarm runner calls. Every one of them was
 * refused on 2026-10-01; each `it` below names the refusal it used to get.
 */

const planner = (plan: Blueprint): LlmAdapter => ({ complete: async () => JSON.stringify(plan) });
const artist: LlmAdapter = { complete: async () => '<svg/>' };

/** A real PNG header for a picture `w` by `h`, so its shape can be measured. */
const png = (w: number, h: number): string => {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, w);
  view.setUint32(20, h);
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
};

const keep = (made: Awaited<ReturnType<typeof prepareClass>>, topicRef: string) => {
  for (const el of made.lesson.elements) if (el.kind === 'graphic') made.assets[el.id] = '<svg/>';
  const meta = { topicRef, klass: 10, subject: 'Science' };
  return { saved: saveable(made, meta), why: whyNotSaveable(made, meta) };
};

describe('class10-science/life-processes/respiration', () => {
  it('is kept — it was refused for overlap@b3__dough_bowl (a connector label on the scene)', async () => {
    const made = await prepareClass({
      topic: 'Respiration',
      klass: 10,
      planner: planner(respiration()),
      artist,
      outcomes: asOutcomes(RESPIRATION_OUTCOMES),
    });
    const { saved, why } = keep(made, 'class10-science/life-processes/respiration');
    expect(why).toEqual([]);
    expect(saved).not.toBeNull();
  });
});

describe('class10-science/life-processes/transportation-in-human-beings', () => {
  it('is kept — it was refused for overlap@b1__food_air (a connector label on the opening scene)', async () => {
    const made = await prepareClass({
      topic: 'Transportation in Human Beings',
      klass: 10,
      planner: planner(transportation()),
      artist,
      outcomes: asOutcomes(TRANSPORTATION_OUTCOMES),
    });
    const { saved, why } = keep(made, 'class10-science/life-processes/transportation-in-human-beings');
    expect(why).toEqual([]);
    expect(saved).not.toBeNull();
  });
});

describe('class10-science/life-processes/excretion-in-human-beings', () => {
  for (const [w, h] of [
    [1000, 1000],
    [1600, 1000],
    [600, 1000],
  ] as const) {
    it(`is kept once its kidney picture (${w}x${h}) is measured — it was refused for outcomes@b1_3`, async () => {
      const made = await prepareClass({
        topic: 'Excretion in Human Beings',
        klass: 10,
        planner: planner(excretion()),
        artist,
        outcomes: asOutcomes(EXCRETION_OUTCOMES),
        imageArtist: { draw: async () => png(w, h) },
        eyes: { look: async () => JSON.stringify({ _count: 1, _hasText: false, ...KIDNEY_PARTS }) },
      });
      // The parts reached the kept copy: every name has its line.
      expect(made.lesson.elements.filter((el) => el.id.endsWith('_line'))).toHaveLength(5);
      const { saved, why } = keep(made, 'class10-science/life-processes/excretion-in-human-beings');
      expect(why).toEqual([]);
      expect(saved).not.toBeNull();
    });
  }
});

describe('the kept copy is never refused for what the gated draft passed', () => {
  /**
   * A stand-in rule that only the RE-FITTED layout breaks: it fails any lesson
   * whose picture carries measured parts, which only the copy laid out after
   * drawing does. Whatever rule a real re-fit ever trips, the shape is this one
   * — and the answer is to keep the copy the gate passed.
   */
  const failsOnceMeasured: MathsCheck = (lesson) => {
    const measured = lesson.elements.find((el) => el.kind === 'image' && (el.parts?.length ?? 0) > 0);
    return measured
      ? { ok: false, failures: [{ id: measured.id, text: 'a stand-in', reason: 'only the re-fit trips this' }] }
      : { ok: true, failures: [] };
  };

  it('keeps the draft, and says so, when the re-fit would fail the keep gate', async () => {
    const made = await prepareClass({
      topic: 'Excretion in Human Beings',
      klass: 10,
      planner: planner(excretion()),
      artist,
      outcomes: asOutcomes(EXCRETION_OUTCOMES),
      mathsCheck: failsOnceMeasured,
      imageArtist: { draw: async () => png(1000, 1000) },
      eyes: { look: async () => JSON.stringify({ _count: 1, ...KIDNEY_PARTS }) },
    });
    expect(made.report.gate).toEqual({ problems: [] });
    expect(made.report.issues.join(' ')).toMatch(/kept as drafted/i);
    // The art still arrived: the draft's picture is the same picture.
    expect(made.assets.kidney_pic).toMatch(/^data:image\/png/);
  });
});
