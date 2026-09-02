import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TRIES,
  findOnTheWeb,
  mayReuse,
  parseVerdict,
  refusalFor,
  searchQuery,
  type WebCandidate,
  type WebImageAdapter,
} from '../src/fromWeb';
import { prepareClass, type LlmAdapter } from '../src/prepare';
import type { PictureBrief } from '../src/picture';
import type { Blueprint } from '../src/types';

/**
 * The rung between drawing a picture and paying to generate one.
 *
 * Two failures it exists to prevent, and both of them are quiet. A search
 * engine does not know what a lesson means, so "a tank of water" returns an
 * armoured vehicle and nothing complains. And a picture nobody owns the rights
 * to, cached and served to every student who takes the class, is a takedown
 * against a children's app rather than a bad-looking board.
 */

// A one-pixel PNG, so imageAspect has something real to read.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const brief: PictureBrief = {
  id: 'kidney',
  alt: 'a kidney cut in half',
  brief: 'a kidney cut lengthwise, showing the cortex, medulla and renal pelvis',
  parts: ['cortex', 'medulla'],
};

const yes = JSON.stringify({ saw: 'a kidney cross section', right: true, text: false, count: 1 });
const boxes = JSON.stringify({
  cortex: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
  medulla: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
});

const openly = (over: Partial<WebCandidate> = {}): WebCandidate => ({
  url: 'https://example.org/kidney.png',
  source: 'https://commons.example.org/kidney',
  license: 'CC BY-SA 4.0',
  ...over,
});

const webOf = (candidates: readonly WebCandidate[]): WebImageAdapter => ({
  search: async () => candidates,
  fetch: async () => PNG,
});

/** Eyes that answer the verifier once, then the part-finder, in order. */
const eyesSaying = (...replies: string[]) => {
  let i = 0;
  return { look: vi.fn(async () => replies[Math.min(i++, replies.length - 1)]) };
};

// ================================================================ licences ==

describe('what may be reused', () => {
  it('takes the licences that permit building on the work', () => {
    for (const ok of ['CC0 1.0', 'Public Domain', 'CC BY 4.0', 'CC BY-SA 3.0']) {
      expect(mayReuse(ok)).toBe(true);
    }
  });

  it('refuses NonCommercial and NoDerivatives even when they say CC BY', () => {
    // The whole point of the ordering: "CC BY-NC-ND 4.0" contains "cc by" and
    // would pass the very test that exists to stop it.
    for (const no of ['CC BY-NC 4.0', 'CC BY-NC-ND 4.0', 'CC BY-ND', 'cc by-nc-sa']) {
      expect(mayReuse(no)).toBe(false);
    }
  });

  it('refuses a licence the search did not report', () => {
    // Silence is not permission. A search that does not say is a search that
    // does not know, and guessing costs more than a generated picture does.
    expect(mayReuse(undefined)).toBe(false);
    expect(mayReuse('')).toBe(false);
    expect(mayReuse('All Rights Reserved')).toBe(false);
    expect(mayReuse('Getty Images')).toBe(false);
  });
});

// ================================================================ verdicts ==

describe('reading a verdict', () => {
  it('takes a clean yes', () => {
    expect(parseVerdict(yes)).toEqual({
      right: true,
      hasText: false,
      count: 1,
      saw: 'a kidney cross section',
    });
  });

  it('reads through a code fence', () => {
    expect(parseVerdict('```json\n' + yes + '\n```').right).toBe(true);
  });

  it('is a NO when the reply cannot be read at all', () => {
    // Every other parse in this pipeline falls back to something usable. This
    // one would fall back to an unverified image on a child's board.
    for (const junk of ['', 'Sure! Here you go:', '{', 'null', '[1,2]']) {
      expect(parseVerdict(junk).right).toBe(false);
    }
  });

  it('treats a missing count as one, not as none', () => {
    // A model that answered the two questions that matter and left this one
    // out has not thereby failed the picture.
    const v = parseVerdict(JSON.stringify({ right: true, text: false, saw: 'a kidney' }));
    expect(refusalFor(v)).toBeNull();
  });

  it('says why, in words a prep report can print', () => {
    expect(refusalFor(parseVerdict(JSON.stringify({ right: false, saw: 'an army tank' })))).toBe(
      'it is an army tank',
    );
    expect(
      refusalFor(parseVerdict(JSON.stringify({ right: true, text: true, count: 1 }))),
    ).toMatch(/words printed on it/);
    expect(
      refusalFor(parseVerdict(JSON.stringify({ right: true, text: false, count: 3 }))),
    ).toMatch(/3 of the subject/);
  });
});

describe('the query', () => {
  it('searches for what the picture must show', () => {
    expect(searchQuery(brief)).toContain('kidney cut lengthwise');
  });

  it('collapses the whitespace a multi-line brief arrives with', () => {
    expect(searchQuery({ ...brief, brief: 'a leaf\n  in  cross   section' })).toContain(
      'a leaf in cross section',
    );
  });
});

// ================================================================ the find ==

describe('findOnTheWeb', () => {
  it('takes a verified, openly licensed picture and finds its parts', async () => {
    const eyes = eyesSaying(yes, boxes);
    const { found } = await findOnTheWeb(brief, webOf([openly()]), eyes);

    expect(found?.src).toBe(PNG);
    expect(found?.parts.map((p) => p.name)).toEqual(['cortex', 'medulla']);
    expect(found?.source).toBe('https://commons.example.org/kidney');
    expect(found?.license).toBe('CC BY-SA 4.0');
    expect(eyes.look).toHaveBeenCalledTimes(2);
  });

  it('never looks at a picture it may not use', async () => {
    // The licence filter runs before the download, so an unusable result costs
    // neither a fetch nor a vision call.
    const eyes = eyesSaying(yes, boxes);
    const web = { search: async () => [openly({ license: 'All Rights Reserved' })], fetch: vi.fn() };
    const { found, refusals } = await findOnTheWeb(brief, web, eyes);

    expect(found).toBeNull();
    expect(web.fetch).not.toHaveBeenCalled();
    expect(eyes.look).not.toHaveBeenCalled();
    expect(refusals.join(' ')).toMatch(/licensed for reuse/);
  });

  it('walks past what the verifier refuses and keeps the one it does not', async () => {
    const eyes = eyesSaying(
      JSON.stringify({ right: false, saw: 'an army tank' }),
      JSON.stringify({ right: true, text: true, count: 1 }),
      yes,
      boxes,
    );
    const { found, refusals } = await findOnTheWeb(
      brief,
      webOf([openly({ url: 'a' }), openly({ url: 'b' }), openly({ url: 'c' })]),
      eyes,
    );

    expect(found?.attempts).toBe(3);
    expect(refusals).toEqual(['it is an army tank', 'it has words printed on it']);
  });

  it('gives up after three looks rather than out-spending generation', async () => {
    const eyes = eyesSaying(JSON.stringify({ right: false, saw: 'something else' }));
    const many = Array.from({ length: 10 }, (_, i) => openly({ url: `u${i}` }));
    const { found, refusals } = await findOnTheWeb(brief, webOf(many), eyes);

    expect(found).toBeNull();
    expect(refusals).toHaveLength(DEFAULT_TRIES);
    expect(eyes.look).toHaveBeenCalledTimes(DEFAULT_TRIES);
  });

  it('does not spend a try on a dead link', async () => {
    // A download that failed cost no vision call. Charging it as an attempt
    // would let three broken URLs use up the whole budget.
    let n = 0;
    const web: WebImageAdapter = {
      search: async () => Array.from({ length: 5 }, (_, i) => openly({ url: `u${i}` })),
      fetch: async () => (n++ < 2 ? null : PNG),
    };
    const eyes = eyesSaying(yes, boxes);
    const { found } = await findOnTheWeb(brief, web, eyes);

    expect(found?.src).toBe(PNG);
    expect(found?.attempts).toBe(1);
  });

  it('ignores a fetch that returned something that is not an image', async () => {
    const web: WebImageAdapter = {
      search: async () => [openly()],
      fetch: async () => 'data:text/html;base64,PGh0bWw+',
    };
    const eyes = eyesSaying(yes, boxes);
    expect((await findOnTheWeb(brief, web, eyes)).found).toBeNull();
    expect(eyes.look).not.toHaveBeenCalled();
  });

  it('comes up empty rather than throwing when the search is unreachable', async () => {
    const web: WebImageAdapter = {
      search: async () => {
        throw new Error('DNS');
      },
      fetch: async () => PNG,
    };
    const { found, refusals } = await findOnTheWeb(brief, web, eyesSaying(yes));
    expect(found).toBeNull();
    expect(refusals).toEqual(['the image search could not be reached']);
  });

  it('comes up empty rather than throwing when the verifier fails', async () => {
    const eyes = {
      look: vi.fn(async () => {
        throw new Error('rate limited');
      }),
    };
    expect((await findOnTheWeb(brief, webOf([openly()]), eyes)).found).toBeNull();
  });

  it('takes a picture with no parts to find, without a second look', async () => {
    const eyes = eyesSaying(yes);
    const { found } = await findOnTheWeb({ ...brief, parts: [] }, webOf([openly()]), eyes);
    expect(found?.src).toBe(PNG);
    expect(found?.parts).toEqual([]);
    expect(eyes.look).toHaveBeenCalledTimes(1);
  });
});

// ================================================================ the ladder =

describe('the ladder inside prepareClass', () => {
  const plan: Blueprint = {
    id: 'demo',
    title: 'The Kidney',
    beats: [
      {
        id: 'b1',
        topic: 'the kidney',
        narration: 'This is a kidney.',
        board: [{ do: 'picture', ref: 'kidney' }],
      },
    ],
    visuals: [
      { id: 'kidney', medium: 'picture', parts: ['cortex'], brief: brief.brief, alt: brief.alt },
    ],
  };

  const planner: LlmAdapter = { complete: async () => JSON.stringify(plan) };
  const artist: LlmAdapter = { complete: async () => '<svg/>' };
  const generator = { draw: vi.fn(async () => PNG) };

  it('does not generate when the web already has it', async () => {
    generator.draw.mockClear();
    const result = await prepareClass({
      topic: 'The Kidney',
      klass: 10,
      planner,
      artist,
      imageArtist: generator,
      eyes: eyesSaying(yes, JSON.stringify({ cortex: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } })),
      web: webOf([openly()]),
    });

    expect(generator.draw).not.toHaveBeenCalled();
    expect(result.report.visuals[0]).toMatchObject({ id: 'kidney', ok: true, from: 'web' });
    expect(result.report.credits).toEqual({ kidney: 'https://commons.example.org/kidney' });
  });

  it('generates when the web has nothing it may use, and says what it refused', async () => {
    generator.draw.mockClear();
    const result = await prepareClass({
      topic: 'The Kidney',
      klass: 10,
      planner,
      artist,
      imageArtist: generator,
      eyes: eyesSaying(JSON.stringify({ right: false, saw: 'an army tank' }), '{}'),
      web: webOf([openly()]),
    });

    expect(generator.draw).toHaveBeenCalled();
    expect(result.report.visuals[0].from).toBe('generated');
    expect(result.report.visuals[0].problems.join(' ')).toMatch(/the web had one but it is an army tank/);
    expect(result.report.credits).toBeUndefined();
  });

  it('skips the rung entirely with no search adapter, exactly as before', async () => {
    generator.draw.mockClear();
    const result = await prepareClass({
      topic: 'The Kidney',
      klass: 10,
      planner,
      artist,
      imageArtist: generator,
      eyes: eyesSaying('{}'),
    });

    expect(generator.draw).toHaveBeenCalled();
    expect(result.report.visuals[0].from).toBe('generated');
  });

  it('never takes a web picture nobody looked at', async () => {
    // Without eyes there is no verifier, and an unverified web image is the
    // one thing worse than a generated one.
    generator.draw.mockClear();
    const web = { search: vi.fn(async () => [openly()]), fetch: async () => PNG };
    const result = await prepareClass({
      topic: 'The Kidney',
      klass: 10,
      planner,
      artist,
      imageArtist: generator,
      web,
    });

    expect(web.search).not.toHaveBeenCalled();
    expect(generator.draw).toHaveBeenCalled();
    expect(result.report.visuals[0].from).toBe('generated');
  });
});
