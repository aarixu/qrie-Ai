import { describe, expect, it } from 'vitest';
import {
  drawPicture,
  redrawPrompt,
  faults,
  imageAspect,
  PART_FINDER_SYSTEM,
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
    expect(p).toContain(brief.brief);
  });

  it('puts the no-text demand first, where a model weighs it heaviest', () => {
    // It is the rule that matters most: printed labels fight with her
    // handwriting and give away her next line.
    const p = picturePrompt(brief);
    expect(p.slice(0, 90)).toContain('UNLABELLED');
    expect(p.indexOf('No words')).toBeLessThan(p.indexOf(brief.brief));
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

describe('a picture that came back with labels printed on it', () => {
  // The whole point is that SHE writes the labels, by hand, as she speaks.
  // Printed ones fight with her handwriting and give away her next line.
  const withText = '{"_hasText":true,"cortex":{"x":0.1,"y":0.2,"w":0.2,"h":0.2}}';
  const clean = '{"_hasText":false,"cortex":{"x":0.3,"y":0.3,"w":0.2,"h":0.2}}';

  const twice = (first: string, second: string) => {
    let n = 0;
    return {
      artist: { draw: async () => (n++ === 0 ? first : second) } as ImageAdapter,
      seen: () => n,
    };
  };
  const answers = (replies: string[]) => {
    let n = 0;
    return { look: async () => replies[Math.min(n++, replies.length - 1)] } as VisionAdapter;
  };

  it('draws it once more, and keeps the clean one', async () => {
    const a = twice(pixel, 'data:image/png;base64,SECOND');
    const got = await drawPicture(brief, a.artist, answers([withText, clean]));
    expect(a.seen()).toBe(2);
    expect(got?.src).toBe('data:image/png;base64,SECOND');
    expect(got?.parts[0].x).toBeCloseTo(0.3, 5);
  });

  it('keeps the first when the second is no better, rather than paying twice for nothing', async () => {
    const a = twice(pixel, 'data:image/png;base64,SECOND');
    const got = await drawPicture(brief, a.artist, answers([withText, withText]));
    expect(got?.src).toBe(pixel);
  });

  it('never draws twice when the first picture was already clean', async () => {
    // Image models ignore "no text" often enough to matter and not often
    // enough to pay for a second picture every time.
    const a = twice(pixel, 'data:image/png;base64,SECOND');
    await drawPicture(brief, a.artist, answers([clean]));
    expect(a.seen()).toBe(1);
  });

  it('reads the flag, and shrugs at a reply it cannot parse', () => {
    expect(faults(withText)).toContain('words printed on it');
    expect(faults(clean)).toEqual([]);
    expect(faults('not json')).toEqual([]);
  });

  it('says plainly what was wrong the first time', () => {
    expect(redrawPrompt(brief, ['words printed on it'])).toContain('words printed on it');
  });
});

describe('a picture that came back as a mirrored pair', () => {
  // The prompt says EXACTLY ONE, twice, and the image model still sometimes
  // draws the pair. The eyes are already looking at the picture to find its
  // parts, so they count the subject in the same breath — no second call, no
  // extra cost, and the redraw path built for printed labels does the rest.
  const pair = '{"_count":2,"_hasText":false,"cortex":{"x":0.1,"y":0.2,"w":0.2,"h":0.2}}';
  const single = '{"_count":1,"_hasText":false,"cortex":{"x":0.3,"y":0.3,"w":0.2,"h":0.2}}';

  const twice = (first: string, second: string) => {
    let n = 0;
    return {
      artist: { draw: async () => (n++ === 0 ? first : second) } as ImageAdapter,
      seen: () => n,
    };
  };
  const answers = (replies: string[]) => {
    let n = 0;
    return { look: async () => replies[Math.min(n++, replies.length - 1)] } as VisionAdapter;
  };

  it('counts two of the subject as a fault worth one more go', () => {
    expect(faults(pair)).toContain('more than one of the subject in it');
    expect(faults(single)).toEqual([]);
  });

  it('says nothing about the count when the eyes did not report one', () => {
    // Every reply written before the eyes were asked to count is still a
    // perfectly good reply about a perfectly good picture.
    expect(faults('{"cortex":{"x":0.1,"y":0.2,"w":0.2,"h":0.2}}')).toEqual([]);
  });

  it('draws it once more, and keeps the single one', async () => {
    const a = twice(pixel, 'data:image/png;base64,SECOND');
    const got = await drawPicture(brief, a.artist, answers([pair, single]));
    expect(a.seen()).toBe(2);
    expect(got?.src).toBe('data:image/png;base64,SECOND');
  });

  it('keeps the first when the second is a pair too', async () => {
    const a = twice(pixel, 'data:image/png;base64,SECOND');
    const got = await drawPicture(brief, a.artist, answers([pair, pair]));
    expect(got?.src).toBe(pixel);
    expect(got?.faults).toEqual(['more than one of the subject in it']);
  });

  it('never draws twice for a picture with one subject and no words on it', async () => {
    const a = twice(pixel, 'data:image/png;base64,SECOND');
    await drawPicture(brief, a.artist, answers([single]));
    expect(a.seen()).toBe(1);
  });

  it('names every fault in the one redraw, not one fault per redraw', async () => {
    let asked = '';
    const artist: ImageAdapter = {
      draw: async (prompt) => {
        asked = prompt;
        return pixel;
      },
    };
    const both = '{"_count":2,"_hasText":true,"cortex":{"x":0.1,"y":0.2,"w":0.2,"h":0.2}}';
    await drawPicture(brief, artist, answers([both, both]));
    expect(asked).toContain('words printed on it');
    expect(asked).toContain('more than one of the subject in it');
  });

  it('asks the eyes to count, so there is something to read', () => {
    expect(PART_FINDER_SYSTEM).toContain('_count');
  });
});

describe('a box bigger than the part it claims to be', () => {
  // The circle drawn on the board is this box. Asking the model nicely for a
  // tight box has not held, so the size a part may be is settled here, in one
  // place, the way every other measurement in this engine is.
  it('shrinks a box that is too wide, around its own centre', () => {
    const [part] = parseParts('{"cortex":{"x":0.2,"y":0.3,"w":0.6,"h":0.2}}', brief.parts);
    expect(part.w).toBeCloseTo(0.45, 5);
    expect(part.x + part.w / 2).toBeCloseTo(0.5, 5);
    expect(part.y).toBeCloseTo(0.3, 5);
  });

  it('shrinks a box that is too tall the same way', () => {
    const [part] = parseParts('{"cortex":{"x":0.3,"y":0.1,"w":0.2,"h":0.8}}', brief.parts);
    expect(part.h).toBeCloseTo(0.45, 5);
    expect(part.y + part.h / 2).toBeCloseTo(0.5, 5);
  });

  it('drops a box that swallowed the whole subject', () => {
    // A circle around everything points at nothing. Better no circle: the
    // name is still written, just without a line to draw from it.
    expect(parseParts('{"cortex":{"x":0.05,"y":0.05,"w":0.9,"h":0.9}}', brief.parts)).toEqual([]);
  });

  it('leaves a box that was already a sensible size alone', () => {
    const [part] = parseParts('{"cortex":{"x":0.1,"y":0.2,"w":0.3,"h":0.25}}', brief.parts);
    expect(part).toEqual({ name: 'cortex', x: 0.1, y: 0.2, w: 0.3, h: 0.25 });
  });
});

describe('how big the picture actually is', () => {
  /**
   * The board has to place the picture at the shape it will be DRAWN at.
   * The renderer fits an image inside the box it is given and centres it, so a
   * square picture in a wide box is drawn narrower than the box with empty
   * board either side — and every part box, being a fraction of the box rather
   * than of the picture, then lands in that empty strip. The circle misses.
   */
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

  it('reads the shape out of the PNG the model sent', () => {
    expect(imageAspect(png(1024, 1024))).toBeCloseTo(1, 5);
    expect(imageAspect(png(1024, 512))).toBeCloseTo(2, 5);
  });

  it('says nothing about a picture it cannot measure', () => {
    // Nothing is better than a wrong shape: an unmeasured picture is placed
    // the way it always was.
    expect(imageAspect('data:image/webp;base64,AAAA')).toBeNull();
    expect(imageAspect('not a data url')).toBeNull();
    expect(imageAspect(png(0, 0))).toBeNull();
  });

  it('hands the shape on with the picture, so the board can place it', async () => {
    const got = await drawPicture(brief, draws(png(800, 400)), sees('{"_count":1}'));
    expect(got?.aspect).toBeCloseTo(2, 5);
  });
});
