import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TRIES,
  findOnTheWeb,
  mayReuse,
  parseVerdict,
  MAX_QUERY_WORDS,
  refusalFor,
  searchQuery,
  VERIFIER_SYSTEM,
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

const yes = JSON.stringify({ saw: 'a kidney cross section', right: true, text: false, count: 1, safe: true });
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
    for (const ok of ['CC0 1.0', 'Public Domain', 'CC BY 4.0', 'CC BY-SA 3.0', 'No restrictions']) {
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

  it('refuses a bare "attribution" that carries a restriction with it', () => {
    // No NC token and no ND token, and it used to pass on the substring
    // 'attribution' alone.
    expect(mayReuse('Attribution required — editorial use only')).toBe(false);
    expect(mayReuse('Attribution, personal use')).toBe(false);
    expect(mayReuse('Royalty-free with attribution')).toBe(false);
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
      safe: true,
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
    const v = parseVerdict(JSON.stringify({ right: true, text: false, safe: true, saw: 'a kidney' }));
    expect(refusalFor(v)).toBeNull();
  });

  it('says why, in words a prep report can print', () => {
    expect(refusalFor(parseVerdict(JSON.stringify({ right: false, saw: 'an army tank' })))).toBe(
      'it is an army tank',
    );
    expect(
      refusalFor(parseVerdict(JSON.stringify({ right: true, text: true, count: 1, safe: true }))),
    ).toMatch(/words printed on it/);
    expect(
      refusalFor(parseVerdict(JSON.stringify({ right: true, text: false, count: 3, safe: true }))),
    ).toMatch(/3 of the subject/);
  });

  it('refuses a right picture that is not for a school child (2026-10-07)', () => {
    // "human heart" on Commons brought back an autopsy photograph: the right
    // organ, and not something to put in front of a class of twelve-year-olds.
    const v = parseVerdict(JSON.stringify({ right: true, text: false, count: 1, safe: false, saw: 'a heart at autopsy' }));
    expect(refusalFor(v)).toMatch(/not for a school child/);
  });

  it('counts a reply that never said whether it is safe as a no', () => {
    const v = parseVerdict(JSON.stringify({ right: true, text: false, count: 1 }));
    expect(v.safe).toBe(false);
    expect(refusalFor(v)).not.toBeNull();
  });

  it('asks the verifier whether a child may be shown it', () => {
    expect(VERIFIER_SYSTEM).toMatch(/"safe"/);
    expect(VERIFIER_SYSTEM).toMatch(/blood|surgery|autopsy/);
  });
});

describe('the query', () => {
  /**
   * MEASURED, not guessed. Wikimedia Commons is a keyword search over file
   * titles: the whole artist brief returned ZERO results for eleven of twelve
   * real briefs, and the head clause alone returned six openly licensed hits
   * for the first one tried.
   */
  it('is the head of the brief, not the brief', () => {
    expect(searchQuery(brief)).toBe('kidney cut lengthwise');
  });

  it('stops where the brief starts listing what must be visible', () => {
    // Those details are what the verifier is for. In a keyword search they
    // only narrow the match to nothing.
    expect(searchQuery({ ...brief, brief: 'a leaf in cross section showing the epidermis' })).toBe(
      'leaf in cross section',
    );
    expect(searchQuery({ ...brief, brief: 'a bar magnet with iron filings around it' })).toBe(
      'bar magnet',
    );
  });

  it('does not cut a word that merely contains a stop word', () => {
    expect(searchQuery({ ...brief, brief: 'a beaker without a lid' })).toBe('beaker without a lid');
    expect(searchQuery({ ...brief, brief: 'a within-cell diagram' })).toBe('within-cell diagram');
  });

  it('drops the leading article, which matches nothing and costs a word', () => {
    expect(searchQuery({ ...brief, brief: 'the Moon at full phase' })).toBe('Moon at full phase');
    // "in" and "at" stay: they are usually part of the subject's own name, and
    // "leaf" alone finds a hedge where "leaf in cross section" finds nine.
    expect(searchQuery({ ...brief, brief: 'a leaf in cross section' })).toBe(
      'leaf in cross section',
    );
  });

  it('collapses the whitespace a multi-line brief arrives with', () => {
    expect(searchQuery({ ...brief, brief: 'a leaf\n  in  cross   section' })).toBe(
      'leaf in cross section',
    );
  });

  it('never hands a keyword search a sentence', () => {
    const long = 'a really quite extraordinarily detailed anatomical rendering of something';
    expect(searchQuery({ ...brief, brief: long }).split(' ')).toHaveLength(MAX_QUERY_WORDS);
  });

  it('carries no "unlabelled photograph" hint', () => {
    // It reads like an instruction and lands as two more required keywords,
    // which is the opposite of what it was for.
    expect(searchQuery(brief)).not.toMatch(/unlabelled|photograph/);
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
      JSON.stringify({ right: true, text: true, count: 1, safe: true }),
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

  it('looks at its three best results at once, not one after another (2026-10-07)', async () => {
    // One at a time, three refusals and a generation behind them took six
    // minutes for one picture. Each look below answers only once all three
    // have started: one after another, the first would wait for ever.
    let started = 0;
    const release: Array<() => void> = [];
    const eyes = {
      look: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            started += 1;
            release.push(() => resolve(JSON.stringify({ right: false, saw: 'something else' })));
            if (started === 3) for (const go of release) go();
          }),
      ),
    };
    const many = Array.from({ length: 5 }, (_, i) => openly({ url: `u${i}` }));
    const { found, refusals } = await findOnTheWeb(brief, webOf(many), eyes);
    expect(found).toBeNull();
    expect(refusals).toHaveLength(3);
  }, 2000);

  it('keeps the best-ranked of those that pass', async () => {
    const web: WebImageAdapter = {
      search: async () => [openly({ url: 'a' }), openly({ url: 'b' }), openly({ url: 'c' })],
      fetch: async (url) => `${PNG}#${url}`,
    };
    const eyes = {
      look: vi.fn(async (src: string, system: string) =>
        system === VERIFIER_SYSTEM ? (src.endsWith('#a') ? JSON.stringify({ right: false, saw: 'a tank' }) : yes) : boxes,
      ),
    };
    const { found } = await findOnTheWeb(brief, web, eyes);
    expect(found?.src.endsWith('#b')).toBe(true);
  });

  it('treats a look that never answers as a refusal, and does not wait for it', async () => {
    const eyes = { look: vi.fn(() => new Promise<string>(() => {})) };
    const { found, refusals } = await findOnTheWeb(brief, webOf([openly()]), eyes, { lookTimeoutMs: 30 });
    expect(found).toBeNull();
    expect(refusals).toEqual(['the check did not answer in time']);
  }, 2000);

  it('carries the credit a found picture needs', async () => {
    const web = webOf([openly({ author: 'A. Person', licenseUrl: 'https://creativecommons.org/licenses/by/4.0', page: 'https://commons.wikimedia.org/wiki/File:K.jpg' })]);
    const { found } = await findOnTheWeb({ ...brief, parts: [] }, web, eyesSaying(yes));
    expect(found?.credit).toEqual({
      author: 'A. Person',
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0',
      page: 'https://commons.wikimedia.org/wiki/File:K.jpg',
    });
  });

  describe('a picture of something moving (2026-10-07)', () => {
    const loop = [{ src: 'https://upload.wikimedia.org/x/Heart.webm.480p.vp9.webm', type: 'video/webm' }];
    const moving = { ...brief, parts: [], motion: true };
    const webWithVideo = (videos: WebCandidate[], stills: WebCandidate[] = [openly({ url: 'still' })]) => ({
      search: vi.fn(async () => stills),
      searchVideo: vi.fn(async () => videos),
      fetch: async () => PNG,
    });

    it('plays a checked loop, its still drawn first', async () => {
      const web = webWithVideo([openly({ url: 'poster', video: loop })]);
      const { found } = await findOnTheWeb(moving, web, eyesSaying(yes));
      expect(found?.video).toEqual(loop);
      expect(found?.src).toBe(PNG);
      expect(web.search).not.toHaveBeenCalled();
    });

    it('takes a still when no loop passes, and says why the loops did not', async () => {
      const web = webWithVideo([openly({ url: 'poster', video: loop })]);
      const eyes = eyesSaying(JSON.stringify({ right: false, saw: 'a surgery' }), yes);
      const { found, refusals } = await findOnTheWeb(moving, web, eyes);
      expect(found?.video).toBeUndefined();
      expect(web.search).toHaveBeenCalled();
      expect(refusals).toEqual(['a video: it is a surgery']);
    });

    it('never looks for a loop of a picture whose parts are to be pointed at', async () => {
      const web = webWithVideo([openly({ url: 'poster', video: loop })]);
      await findOnTheWeb({ ...moving, parts: ['cortex'] }, web, eyesSaying(yes, boxes));
      expect(web.searchVideo).not.toHaveBeenCalled();
    });

    it('never looks for a loop the lesson did not ask for', async () => {
      const web = webWithVideo([openly({ url: 'poster', video: loop })]);
      await findOnTheWeb({ ...brief, parts: [] }, web, eyesSaying(yes));
      expect(web.searchVideo).not.toHaveBeenCalled();
    });
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
    // Page AND licence in one string: a credit's whole job is to be readable
    // by a person who has to answer a takedown.
    expect(result.report.credits).toEqual({
      kidney: 'https://commons.example.org/kidney (CC BY-SA 4.0)',
    });
  });

  it('puts the found picture\'s credit on the picture the board draws, and keeps it to lay out again (2026-10-07)', async () => {
    const result = await prepareClass({
      topic: 'The Kidney',
      klass: 10,
      planner,
      artist,
      eyes: eyesSaying(yes, JSON.stringify({ cortex: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } })),
      web: webOf([openly({ author: 'A. Person', page: 'https://commons.wikimedia.org/wiki/File:K.jpg' })]),
    });
    const picture = result.lesson.elements.find((el) => el.kind === 'image' && el.id === 'kidney');
    expect(picture && 'credit' in picture ? picture.credit : undefined).toEqual({
      author: 'A. Person',
      license: 'CC BY-SA 4.0',
      page: 'https://commons.wikimedia.org/wiki/File:K.jpg',
    });
    expect(result.replay?.credits).toEqual({ kidney: picture && 'credit' in picture ? picture.credit : null });
  });

  it('plays a found loop on a picture the plan says moves, and keeps it to lay out again (2026-10-07)', async () => {
    const loop = [{ src: 'https://upload.wikimedia.org/x/Heart.webm.480p.vp9.webm', type: 'video/webm' }];
    const moving: Blueprint = {
      ...plan,
      visuals: [{ id: 'kidney', medium: 'picture', motion: true, parts: [], brief: 'a human heart beating', alt: 'a heart beating' }],
    };
    const result = await prepareClass({
      topic: 'The Heart',
      klass: 10,
      planner: { complete: async () => JSON.stringify(moving) },
      artist,
      eyes: eyesSaying(yes),
      web: { ...webOf([openly()]), searchVideo: async () => [openly({ url: 'poster', video: loop })] },
    });
    const picture = result.lesson.elements.find((el) => el.kind === 'image' && el.id === 'kidney');
    expect(picture && 'video' in picture ? picture.video : undefined).toEqual(loop);
    expect(picture && 'credit' in picture ? picture.credit?.license : undefined).toBe('CC BY-SA 4.0');
    expect(result.replay?.videos).toEqual({ kidney: loop });
  });

  it('never asks for a loop the plan did not mark as moving, whatever it wrote', async () => {
    const searchVideo = vi.fn(async () => []);
    const loose = { ...plan, visuals: [{ ...plan.visuals[0], parts: [], motion: 'yes' }] } as unknown as Blueprint;
    await prepareClass({
      topic: 'The Kidney',
      klass: 10,
      planner: { complete: async () => JSON.stringify(loose) },
      artist,
      eyes: eyesSaying(yes),
      web: { ...webOf([openly()]), searchVideo },
    });
    expect(searchVideo).not.toHaveBeenCalled();
  });

  it('puts no credit on a picture that was made, not found', async () => {
    const result = await prepareClass({
      topic: 'The Kidney',
      klass: 10,
      planner,
      artist,
      imageArtist: generator,
      eyes: eyesSaying(JSON.stringify({ right: false, saw: 'a bean' }), JSON.stringify({ cortex: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } })),
      web: webOf([openly()]),
    });
    const picture = result.lesson.elements.find((el) => el.kind === 'image');
    expect(picture && 'credit' in picture ? picture.credit : undefined).toBeUndefined();
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

  it('finds a picture with no generator configured at all', async () => {
    /**
     * Rung three used to be gated on rung four's adapter. With a search and no
     * generator every "picture" brief fell through to the SVG artist, which
     * was then asked to hand-draw a kidney cross-section — the outcome
     * picture.ts opens by saying is impossible.
     */
    const result = await prepareClass({
      topic: 'The Kidney',
      klass: 10,
      planner,
      artist,
      eyes: eyesSaying(yes, JSON.stringify({ cortex: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } })),
      web: webOf([openly()]),
    });

    expect(result.report.visuals[0]).toMatchObject({ ok: true, from: 'web' });
  });

  it('says so honestly when there is nothing to find and nothing to make one', async () => {
    const result = await prepareClass({
      topic: 'The Kidney',
      klass: 10,
      planner,
      artist,
      eyes: eyesSaying(JSON.stringify({ right: false, saw: 'an army tank' })),
      web: webOf([openly()]),
    });

    expect(result.report.visuals[0].ok).toBe(false);
    expect(result.report.visuals[0].problems.join(' ')).toMatch(/nothing configured to make one/);
    expect(result.report.visuals[0].problems.join(' ')).toMatch(/an army tank/);
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
