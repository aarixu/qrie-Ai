import { describe, expect, it } from 'vitest';
import { validateLesson, LIST_ITEM_SIZE, NOTE_FONT, STAGE_ASPECT, type Element, type Lesson } from '@ai-tutor/lesson-format';
import { computeFrame } from '../../stage/src/frame.ts';
import { assemble } from '../src/prepare';
import { fuzzPlan } from './fixtures/fuzzPlans';

/**
 * HOW BIG HER WRITING COMES OUT ON A SCREEN, over the same 300 seeded classes
 * as boardFuzz (canvas C2).
 *
 * Every line of reading text a beat puts on the board, at the size the camera
 * shows it in that beat: its size in board units times the stage's pixels per
 * unit for that beat's frame (stage `computeFrame` at 16:9, with Scene's cap of
 * 1.6 px a unit).
 *
 * MEASURED 2026-10-02, the stage 16:9 on every screen:
 *   phone held sideways (812x375, a 652 px stage): median 22 px; 11.3% of lines
 *     under 14 px, 7.1% under 12 px. Most of the small ones are a connector's
 *     label, which shrinks to fit the run between two drawn things (17 units).
 *   laptop (a 944 px stage): median 30 px; 1.6% under 14 px, none under 12.
 *   phone held upright (390 px across): median 13 px; 40% under 12 px. That
 *     view is the video in portrait, and the class is read sideways.
 * Tried and left: a connector-label floor of 19 or 20 units cut the sideways
 * lines under 12 px to ~2.5%, and turned one overlapping class in 300 into two
 * or three — each a class the keep gate refuses after its spend.
 *
 * MEASURED AGAIN 2026-10-07, her lines drawn in Quicksand instead of Caveat
 * (Aarav: "writing font ko normal kr do") at 0.9 of their old sizes:
 *   phone held sideways: median 17.7 px; 22.9% under 14 px, 8.0% under 12 px.
 *   laptop: median 25.4 px; 0.5% under 14 px, none under 12.
 * Smaller numbers, larger letters: these are font sizes, and Quicksand's
 * lowercase stands 0.54 of its size against Caveat's 0.36. Her lowercase on a
 * phone held sideways went from about 7.9 px tall (22 x 0.36) to 9.6 px
 * (17.7 x 0.54) — the measure a reader's eye actually meets.
 * The guards below hold those numbers.
 */

const sizeOf = (el: Element): number | null => {
  switch (el.kind) {
    case 'text':
      return el.size ?? 20;
    case 'handwrite':
      return el.size ?? 26;
    case 'list':
      return el.size ?? LIST_ITEM_SIZE;
    case 'note':
      return NOTE_FONT;
    default:
      return null;
  }
};

/** Scene never draws a board unit larger than this many pixels. */
const MAX_UNIT_PX = 1.6;
const SCREENS = { sideways: 652, laptop: 944, upright: 390 } as const;
type Screen = keyof typeof SCREENS;

function measure(): Record<Screen, number[]> {
  const px: Record<Screen, number[]> = { sideways: [], laptop: [], upright: [] };
  for (let seed = 1; seed <= 300; seed += 1) {
    const { plan, drawn, parts, shapes } = fuzzPlan(seed);
    const made = assemble(plan, drawn, parts, shapes);
    const checked = validateLesson(made.lesson);
    if (!checked.ok) continue;
    const lesson = checked.lesson as Lesson;
    const byId = new Map(lesson.elements.map((el) => [el.id, el]));
    lesson.beats.forEach((beat, n) => {
      const before = new Set(n > 0 ? lesson.beats[n - 1].show : []);
      const fresh = beat.show
        .filter((id) => !before.has(id))
        .map((id) => byId.get(id))
        .filter((el): el is Element => el !== undefined);
      for (const screen of Object.keys(SCREENS) as Screen[]) {
        const w = SCREENS[screen];
        const frame = computeFrame(lesson, beat.frame ?? beat.show, beat.focus ?? [], STAGE_ASPECT, w / MAX_UNIT_PX);
        for (const el of fresh) {
          const size = sizeOf(el);
          if (size !== null) px[screen].push((size * w) / frame.w);
        }
      }
    });
  }
  return px;
}

describe('how big her writing comes out, 300 seeded classes at 16:9', () => {
  const px = measure();
  const under = (screen: Screen, limit: number): number =>
    px[screen].filter((v) => v < limit).length / px[screen].length;
  const median = (screen: Screen): number => [...px[screen]].sort((a, b) => a - b)[Math.floor(px[screen].length / 2)];

  it('reads at about 18 px on a phone held sideways, few lines under 12', () => {
    expect(median('sideways')).toBeGreaterThanOrEqual(17);
    expect(under('sideways', 12)).toBeLessThanOrEqual(0.085);
    expect(under('sideways', 14)).toBeLessThanOrEqual(0.24);
  });

  it('reads at about 25 px on a laptop, nothing under 12', () => {
    expect(median('laptop')).toBeGreaterThanOrEqual(25);
    expect(under('laptop', 12)).toBe(0);
  });
});
