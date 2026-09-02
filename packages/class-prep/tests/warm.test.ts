import { describe, expect, it } from 'vitest';
import { prepareClass, type LlmAdapter } from '../src/prepare';
import type { Blueprint } from '../src/types';

/**
 * WARM ENTRY — the student is in the room while the class is still being made.
 *
 * Aarav's shape, 2026-09-02: in the room in ten to fifteen seconds, the class
 * building behind them, the tutor making real conversation. It is also what
 * removes the case for batch-preparing content at all, so the property these
 * tests hold is not a nicety: NOTHING the drawing does may change the teaching
 * the student was handed.
 *
 * Everything below drives real timing rather than a mock clock, so it uses
 * artists that resolve when told to.
 */

const blueprint: Blueprint = {
  id: 'warm',
  title: 'Speed',
  beats: [
    { id: 'b1', topic: 'open', narration: 'What do you already know about speed?', board: [{ do: 'title', text: 'Speed' }] },
    {
      id: 'b2',
      topic: 'graph',
      narration: 'Look at the slope.',
      board: [
        { do: 'diagram', ref: 'd_graph' },
        { do: 'caption', text: 'Steeper means faster.' },
      ],
    },
  ],
  visuals: [
    { id: 'd_graph', parts: ['axes'], brief: 'a graph', alt: 'a distance-time graph' },
  ],
};

const planner: LlmAdapter = { complete: async () => JSON.stringify(blueprint) };

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 620">' +
  '<g id="axes"><path d="M10 10 L20 20" stroke="var(--a, #333)"/></g></svg>';

/** An artist that answers only when `finish()` is called. */
function heldArtist(): LlmAdapter & { finish: () => void; asked: Promise<void> } {
  let release: () => void = () => {};
  let asked: () => void = () => {};
  const askedPromise = new Promise<void>((res) => {
    asked = res;
  });
  return {
    asked: askedPromise,
    finish: () => release(),
    complete: async () => {
      asked();
      await new Promise<void>((res) => {
        release = res;
      });
      return SVG;
    },
  };
}

describe('the room opens before the artwork exists', () => {
  it('hands over a whole, playable class while the artist is still working', async () => {
    const artist = heldArtist();
    let draft: { lesson: { beats: { id: string }[] }; assets: Record<string, string> } | null = null;

    const running = prepareClass({
      topic: 'Speed',
      klass: 9,
      planner,
      artist,
      onDraft: (d) => {
        draft = d as typeof draft;
      },
    });

    // The artist has been asked and has NOT answered. If the draft is already
    // here, the student is already in the room.
    await artist.asked;

    expect(draft).not.toBeNull();
    expect(draft!.lesson.beats.map((b) => b.id)).toEqual(['b1', 'b2']);
    // Nothing drawn yet, which is the entire point.
    expect(Object.keys(draft!.assets)).toEqual([]);

    artist.finish();
    await running;
  });

  it('fills the draft’s own assets object, so the board catches up', async () => {
    const artist = heldArtist();
    let draft: { assets: Record<string, string> } | null = null;
    let landed = 0;

    const running = prepareClass({
      topic: 'Speed',
      klass: 9,
      planner,
      artist,
      onDraft: (d) => {
        draft = d as typeof draft;
      },
      onAsset: () => {
        landed += 1;
      },
    });

    await artist.asked;
    expect(Object.keys(draft!.assets)).toEqual([]);

    artist.finish();
    await running;

    // The same object the room is holding, now with the picture in it.
    expect(draft!.assets.d_graph).toContain('<svg');
    expect(landed).toBeGreaterThan(0);
  });

  it('teaches the same beats it promised', async () => {
    // The one property warm entry rests on. If drawing could change the
    // teaching, handing the class over early would mean handing over a class
    // that is about to become a different one under a student watching it.
    let draft: { lesson: { beats: { id: string }[] } } | null = null;

    const result = await prepareClass({
      topic: 'Speed',
      klass: 9,
      planner,
      artist: { complete: async () => SVG },
      onDraft: (d) => {
        draft = d as typeof draft;
      },
    });

    expect(draft!.lesson.beats.map((b) => b.id)).toEqual(
      result.lesson.beats.map((b) => b.id),
    );
  });

  it('costs nothing when nobody is listening', async () => {
    // A caller that ignores onDraft gets exactly what it got before.
    const result = await prepareClass({
      topic: 'Speed',
      klass: 9,
      planner,
      artist: { complete: async () => SVG },
    });

    expect(result.lesson.beats).toHaveLength(2);
    expect(result.assets.d_graph).toContain('<svg');
  });
});

describe('a plan that will not hold is refused before anything is drawn', () => {
  it('never asks the artist when the plan cannot be repaired', async () => {
    // The old order drew first and checked afterwards, so a plan that could
    // never work still cost every picture in it.
    let artistCalls = 0;
    const artist: LlmAdapter = {
      complete: async () => {
        artistCalls += 1;
        return SVG;
      },
    };
    const broken: LlmAdapter = { complete: async () => JSON.stringify({ id: 'x', beats: [] }) };

    await expect(
      prepareClass({ topic: 'Speed', klass: 9, planner: broken, artist }),
    ).rejects.toThrow();
    expect(artistCalls).toBe(0);
  });
});
