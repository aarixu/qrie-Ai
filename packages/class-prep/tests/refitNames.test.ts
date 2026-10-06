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

describe('the copy kept, after the picture is made', () => {
  it('writes the names nothing was found for down the notes column, and keeps that copy', async () => {
    const planner: LlmAdapter = { complete: async () => JSON.stringify(PLAN) };
    const artist: LlmAdapter = { complete: async () => '' };
    const imageArtist: ImageAdapter = { draw: async () => PNG };
    // It looked, and found none of the parts.
    const eyes: VisionAdapter = { look: async () => '{}' };
    const made = await prepareClass({ topic: 'Villi', klass: 10, planner, artist, imageArtist, eyes, composed: true });

    expect(made.report.issues.some((i) => i.startsWith('Kept as drafted'))).toBe(false);
    const names = made.lesson.elements.filter(
      (e) => e.kind === 'handwrite' && ['Capillaries', 'Lacteal', 'Epithelium'].includes(e.text),
    );
    expect(names).toHaveLength(3);
    // Down the notes column, right of the picture's hero region (which ends at x 630).
    for (const name of names) expect((name as { x: number }).x).toBeGreaterThan(640);
  });
});
