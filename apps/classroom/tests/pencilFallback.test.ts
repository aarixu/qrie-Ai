import { describe, expect, it } from 'vitest';
import { pencilsFor } from '../src/lib/liveClass';
import { saveable } from '@ai-tutor/class-prep';
import type { Lesson } from '@ai-tutor/lesson-format';

/**
 * A CLASS PREPARED IN PRODUCTION MUST BE KEEPABLE, AND UNTIL THIS IT WAS NOT.
 *
 * `/api/icons` answers 501 on the deployed relay, deliberately: the icon index
 * is a 443 MB package that must never reach a browser, and handler.ts says so
 * beside the refusal. `fetchGraphics` used to answer that with `{}`.
 *
 * That looked like "a board with fewer pictures" and was something worse.
 * `saveable()` refuses to keep a class whose `graphic` elements carry no
 * artwork, so every cold topic with a noun in it was taught once and thrown
 * away — the next student paid the full preparation again, and the catalogue
 * could never warm itself. The tests below are about that consequence, not
 * about how a circle looks.
 */

const lesson = (): Lesson =>
  ({
    id: 'photosynthesis',
    title: 'Photosynthesis',
    language: 'en',
    beats: [{ id: 'b1', kind: 'say', narration: 'Leaves make food from light.' }],
    elements: [
      { id: 'e1', kind: 'graphic', noun: 'leaf' },
      { id: 'e2', kind: 'graphic', noun: 'sun' },
      // The same noun placed twice is two pictures, and the renderer looks each
      // one up by its own id — so this must get its own asset, not share e2's.
      { id: 'e3', kind: 'graphic', noun: 'sun' },
      { id: 'e4', kind: 'handwrite', text: 'CO2 + H2O' },
    ],
  }) as never;

const report = {
  planMs: 10_000,
  visualsMs: 20_000,
  issues: [],
  visuals: [],
} as never;

const meta = {
  topicRef: 'class10-science/life-processes/photosynthesis',
  klass: 10,
  subject: 'Science',
};

describe('the pencil fallback when no icon relay answered', () => {
  it('draws something for every graphic element, keyed by element id', () => {
    const assets = pencilsFor(lesson());
    expect(Object.keys(assets).sort()).toEqual(['e1', 'e2', 'e3']);
  });

  it('gives the same noun placed twice its own picture', () => {
    const assets = pencilsFor(lesson());
    expect(assets.e2).toBeDefined();
    expect(assets.e3).toBeDefined();
    // Same word, so the same drawing — pencilGlyph is deterministic on purpose.
    // What matters is that BOTH ids are filled; a shared key would leave one
    // element unarmed and saveable would refuse the class.
    expect(assets.e3).toBe(assets.e2);
  });

  it('leaves alone the kinds that need no artwork', () => {
    expect(pencilsFor(lesson()).e4).toBeUndefined();
  });

  it('is standalone markup a board can render', () => {
    const svg = pencilsFor(lesson()).e1;
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+">/);
    expect(svg).toMatch(/<\/svg>$/);
  });

  /**
   * THE POINT OF ALL OF IT. Without the fallback this class is thrown away
   * after being taught once; with it, the next student gets it as a download.
   */
  it('makes the class KEEPABLE, which returning {} did not', () => {
    const prep = { lesson: lesson(), assets: pencilsFor(lesson()), report };
    expect(saveable(prep, meta)).not.toBeNull();
  });

  it('and a class with no artwork at all is still refused, as it should be', () => {
    const prep = { lesson: lesson(), assets: {}, report };
    expect(saveable(prep, meta)).toBeNull();
  });
});
