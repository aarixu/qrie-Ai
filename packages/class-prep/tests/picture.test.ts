import { describe, expect, it } from 'vitest';
import {
  drawPicture,
  parseParts,
  picturePrompt,
  type ImageAdapter,
  type PictureBrief,
  type VisionAdapter,
} from '../src/picture';

const brief: PictureBrief = {
  id: 'kidney',
  alt: 'a kidney cut in half',
  brief: 'A human kidney cut in half lengthwise',
  parts: ['cortex', 'renal pelvis'],
};

const pixel = 'data:image/png;base64,iVBORw0KGgo=';
const draws = (src: string | null): ImageAdapter => ({ draw: async () => src });
const sees = (reply: string): VisionAdapter => ({ look: async () => reply });

describe('picturePrompt', () => {
  it('asks for one specimen, no text, and a white background', () => {
    // White is what lets a picture sit ON the board rather than in a panel,
    // and the tutor writes every label herself.
    const p = picturePrompt(brief);
    expect(p).toContain('EXACTLY ONE of the subject');
    expect(p).toContain('#ffffff');
    expect(p.toLowerCase()).toContain('no text');
    expect(p).toContain(brief.brief);
  });
});

describe('parseParts', () => {
  it('reads the boxes it was promised', () => {
    const parts = parseParts(
      '{"cortex":{"x":0.1,"y":0.2,"w":0.3,"h":0.25},"renal pelvis":{"x":0.4,"y":0.45,"w":0.2,"h":0.2}}',
      brief.parts,
    );
    expect(parts.map((p) => p.name)).toEqual(['cortex', 'renal pelvis']);
    expect(parts[0]).toEqual({ name: 'cortex', x: 0.1, y: 0.2, w: 0.3, h: 0.25 });
  });

  it('drops a part the model could not find, rather than guessing one', () => {
    // A confident circle round the wrong thing teaches the wrong thing.
    const parts = parseParts('{"cortex":null,"renal pelvis":{"x":0.4,"y":0.4,"w":0.2,"h":0.2}}', brief.parts);
    expect(parts.map((p) => p.name)).toEqual(['renal pelvis']);
  });

  it('drops a box that is nonsense or vanishingly small', () => {
    expect(parseParts('{"cortex":{"x":4,"y":0.2,"w":0.3,"h":0.2}}', brief.parts)).toEqual([]);
    expect(parseParts('{"cortex":{"x":0.1,"y":0.2,"w":0,"h":0.2}}', brief.parts)).toEqual([]);
    expect(parseParts('not json at all', brief.parts)).toEqual([]);
  });

  it('keeps a box that runs a little past an edge, clamped', () => {
    const [part] = parseParts('{"cortex":{"x":0.8,"y":0.1,"w":0.5,"h":0.2}}', brief.parts);
    expect(part.x + part.w).toBeCloseTo(1, 5);
  });

  it('reads a reply wrapped in a fence', () => {
    const fence = String.fromCharCode(96).repeat(3);
    const parts = parseParts(`${fence}json\n{"cortex":{"x":0.1,"y":0.1,"w":0.2,"h":0.2}}\n${fence}`, [
      'cortex',
    ]);
    expect(parts).toHaveLength(1);
  });
});

describe('drawPicture', () => {
  it('draws, then looks to find the parts', async () => {
    const got = await drawPicture(
      brief,
      draws(pixel),
      sees('{"cortex":{"x":0.1,"y":0.2,"w":0.3,"h":0.25}}'),
    );
    expect(got?.src).toBe(pixel);
    expect(got?.parts.map((p) => p.name)).toEqual(['cortex']);
  });

  it('does not look when there is nothing to point at', async () => {
    let looked = false;
    const eyes: VisionAdapter = {
      look: async () => {
        looked = true;
        return '{}';
      },
    };
    await drawPicture({ ...brief, parts: [] }, draws(pixel), eyes);
    expect(looked).toBe(false);
  });

  it('still shows a picture whose parts could not be found', async () => {
    const eyes: VisionAdapter = {
      look: async () => {
        throw new Error('vision timeout');
      },
    };
    const got = await drawPicture(brief, draws(pixel), eyes);
    expect(got?.src).toBe(pixel);
    expect(got?.parts).toEqual([]);
  });

  it('gives back nothing when the drawing fails, so the beat can be dropped', async () => {
    expect(await drawPicture(brief, draws(null), sees('{}'))).toBeNull();
    expect(await drawPicture(brief, draws('https://example.com/x.png'), sees('{}'))).toBeNull();
    const angry: ImageAdapter = {
      draw: async () => {
        throw new Error('429');
      },
    };
    expect(await drawPicture(brief, angry, sees('{}'))).toBeNull();
  });
});
