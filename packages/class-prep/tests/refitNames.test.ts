import { describe, expect, it } from 'vitest';
import { prepareClass, type LlmAdapter } from '../src/prepare';
import type { ImageAdapter, VisionAdapter } from '../src/picture';
import type { Blueprint } from '../src/types';

/**
 * THE COPY KEPT IS LAID OUT AGAIN ONCE THE PICTURE IS MADE, AND IS KEPT WHEN
 * IT IS NO WORSE.
 *
 * The re-fit was thrown away whenever its gate found a problem the draft's did
 * not, and two problems were told apart by their whole message — so a page the
 * draft left 52% written on and the re-fit 55% was a "new" problem, and the
 * class kept the draft: the one whose names float beside a picture nobody had
 * looked at yet (small intestine, 2026-10-06, "Kept as drafted … page-full@b3").
 */

/** The 24 bytes imageAspect reads: a PNG signature and an IHDR of 600 x 800. */
const PNG = (() => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, 600);
  new DataView(bytes.buffer).setUint32(20, 800);
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
})();

const PLAN: Blueprint = {
  id: 'villi',
  title: 'Villi',
  visuals: [
    { id: 'villus', medium: 'picture', parts: ['capillaries', 'lacteal', 'epithelium'], brief: 'One villus, cut lengthwise.', alt: 'A villus' },
  ],
  beats: [
    {
      id: 'b1',
      topic: 'Opening',
      narration: '',
      board: [
        { do: 'say', text: 'You had lunch an hour ago.' },
        { do: 'ask', question: 'Where is it now?', expect: 'In the small intestine.', hint: 'Past the stomach.' },
      ],
    },
    {
      id: 'b2',
      topic: 'Villi',
      narration: '',
      board: [
        { do: 'title', text: 'Villi', path: ['Small intestine', 'Villi'] },
        { do: 'say', text: 'This is one villus.' },
        { do: 'picture', ref: 'villus' },
        { do: 'say', text: 'Capillaries carry sugar away.' },
        { do: 'label', target: 'villus#capillaries', text: 'Capillaries' },
        { do: 'say', text: 'The lacteal takes the fats.' },
        { do: 'label', target: 'villus#lacteal', text: 'Lacteal' },
        { do: 'say', text: 'A thin skin lets food through.' },
        { do: 'label', target: 'villus#epithelium', text: 'Epithelium' },
        { do: 'write', text: 'Villi absorb food' },
        { do: 'say', text: 'So villi soak up food.' },
        { do: 'summary', text: 'Villi absorb food fast' },
      ],
    },
  ],
};

/** The villus beat with the list of its parts beside the picture, as the composed prompt asks. */
const WITH_LIST: Blueprint = {
  ...PLAN,
  beats: [
    PLAN.beats[0],
    {
      ...PLAN.beats[1],
      board: [
        ...PLAN.beats[1].board.slice(0, -2),
        { do: 'say', text: 'Here is what each part does.' },
        {
          do: 'list',
          heading: 'How each part aids absorption',
          items: [
            { term: 'Capillaries', meaning: 'carry sugars and amino acids away' },
            { term: 'Lacteal', meaning: 'takes in the digested fats' },
            { term: 'Epithelium', meaning: 'one cell thick, a short path to cross' },
          ],
        },
        ...PLAN.beats[1].board.slice(-2),
      ],
    },
  ],
};

const prepare = async (plan: Blueprint) => {
  const planner: LlmAdapter = { complete: async () => JSON.stringify(plan) };
  const artist: LlmAdapter = { complete: async () => '' };
  const imageArtist: ImageAdapter = { draw: async () => PNG };
  // It looked, and found none of the parts.
  const eyes: VisionAdapter = { look: async () => '{}' };
  return prepareClass({ topic: 'Villi', klass: 10, planner, artist, imageArtist, eyes, composed: true });
};

const NAMES = ['Capillaries', 'Lacteal', 'Epithelium'];

describe('the copy kept, after the picture is made', () => {
  it('writes the names nothing was found for in a key under the picture, and keeps that copy', async () => {
    const made = await prepare(PLAN);
    expect(made.report.issues.some((i) => i.startsWith('Kept as drafted'))).toBe(false);
    const image = made.lesson.elements.find((e) => e.kind === 'image') as { y: number; h: number };
    const names = made.lesson.elements.filter((e) => e.kind === 'handwrite' && NAMES.includes(e.text));
    expect(names).toHaveLength(3);
    for (const name of names) expect((name as { y: number }).y).toBeGreaterThan(image.y + image.h);
    expect(made.lesson.elements.some((e) => e.kind === 'arrow')).toBe(false);
  });

  /**
   * A DRAFT THAT WOULD NOT BE KEPT EITHER IS NOTHING TO PROTECT (the second
   * small-intestine class, 2026-10-06). The guard keeps the draft so a class
   * that passed in preparation is not refused at the keep; that class's draft
   * already failed (a thin second page), the re-fit found every part of the
   * villus, and the draft — names floating, no lines — was what came back.
   */
  it('keeps the re-fit, its names drawn to their parts, when the draft fails the gate too', async () => {
    // A tall, narrow picture: the draft counts the whole box the layout gave
    // it, the re-fit only the picture, so the re-fit's page reads emptier.
    const narrow = (() => {
      const bytes = new Uint8Array(24);
      bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
      new DataView(bytes.buffer).setUint32(16, 300);
      new DataView(bytes.buffer).setUint32(20, 1200);
      return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
    })();
    const parts = JSON.stringify({
      capillaries: { x: 0.1, y: 0.3, w: 0.2, h: 0.3 },
      lacteal: { x: 0.45, y: 0.2, w: 0.1, h: 0.5 },
      epithelium: { x: 0.7, y: 0.3, w: 0.2, h: 0.4 },
    });
    const plan: Blueprint = {
      ...WITH_LIST,
      beats: [
        WITH_LIST.beats[0],
        {
          ...WITH_LIST.beats[1],
          board: [
            ...WITH_LIST.beats[1].board.slice(0, -2),
            { do: 'write', text: 'Villi make the inner surface enormous' },
            { do: 'write', text: 'Each villus is one cell thick' },
            ...WITH_LIST.beats[1].board.slice(-2),
          ],
        },
        // A thin page of its own: fails page-full in the draft and the re-fit alike.
        {
          id: 'b3',
          topic: 'Recap',
          narration: '',
          board: [
            { do: 'say', text: 'One thing to remember.' },
            { do: 'write', text: 'Villi absorb food' },
          ],
        },
      ],
    };
    const made = await prepareClass({
      topic: 'Villi',
      klass: 10,
      planner: { complete: async () => JSON.stringify(plan) },
      artist: { complete: async () => '' },
      imageArtist: { draw: async () => narrow },
      eyes: { look: async () => parts },
      composed: true,
    });
    expect(made.report.gate!.problems.some((p) => p.rule === 'page-full' && p.where.startsWith('b3'))).toBe(true);
    expect(made.report.issues.filter((i) => i.startsWith('Kept as drafted'))).toEqual([]);
    expect(made.lesson.elements.filter((e) => e.kind === 'arrow').length).toBeGreaterThanOrEqual(3);
  });

  it('keeps that copy with the list of the parts beside the picture, all on one page', async () => {
    const made = await prepare(WITH_LIST);
    expect(made.report.issues.filter((i) => i.startsWith('Kept as drafted'))).toEqual([]);
    const image = made.lesson.elements.find((e) => e.kind === 'image') as { y: number; h: number };
    for (const name of made.lesson.elements.filter((e) => e.kind === 'handwrite' && NAMES.includes(e.text))) {
      expect((name as { y: number }).y).toBeGreaterThan(image.y + image.h);
    }
  });
});
