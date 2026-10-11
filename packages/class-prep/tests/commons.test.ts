// @vitest-environment node
// As a script asks (the prewarm runner): a page asks with no header of its own,
// and commonsBrowser.test.ts says so.
import { describe, expect, it, vi } from 'vitest';
import { THUMB_WIDTH, candidatesFrom, createCommonsSearch, videoCandidatesFrom } from '../src/commons';
import { mayReuse } from '../src/fromWeb';

/**
 * The search behind rung three.
 *
 * Every request here is stubbed. Nothing in this file touches the network:
 * a test that reaches Wikimedia is a test that fails on a train, and the point
 * of the adapter is the shape of what it returns, which a fixture states more
 * precisely than a live query ever could.
 */

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/** One file, in the shape formatversion=2 actually returns. */
const page = ({ imageinfo, ...over }: Record<string, unknown> = {}) => ({
  pageid: 1,
  title: 'File:Kidney.jpg',
  ...over,
  imageinfo: [
    {
      thumburl: 'https://upload.wikimedia.org/thumb/Kidney.jpg/1024px-Kidney.jpg',
      url: 'https://upload.wikimedia.org/Kidney.jpg',
      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Kidney.jpg',
      mime: 'image/jpeg',
      extmetadata: {
        License: { value: 'cc-by-sa-4.0' },
        LicenseShortName: { value: 'CC BY-SA 4.0' },
        LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
        Artist: { value: '<a href="/wiki/User:Someone">Someone</a>' },
        ObjectName: { value: 'Kidney cross section' },
      },
      // Last, so an override really overrides: spreading the rest of `over`
      // over the whole page put the override object where the ARRAY goes, and
      // three tests then measured a page with no imageinfo at all.
      ...(imageinfo as object),
    },
  ],
});

const body = (pages: unknown[]) => ({ query: { pages } });

const okJson = (value: unknown) =>
  ({ ok: true, json: async () => value, headers: new Headers() }) as unknown as Response;

describe('reading what Commons sent back', () => {
  it('takes the thumbnail, the description page and the licence', () => {
    const [c] = candidatesFrom(body([page()]));
    expect(c.url).toContain('1024px-Kidney.jpg');
    expect(c.license).toBe('CC BY-SA 4.0');
    expect(c.title).toBe('Kidney cross section');
  });

  it('names the author in the source, because a CC BY credit needs one', () => {
    // And strips the HTML the field arrives wrapped in.
    const [c] = candidatesFrom(body([page()]));
    expect(c.source).toBe('https://commons.wikimedia.org/wiki/File:Kidney.jpg by Someone');
    expect(c.source).not.toContain('<a');
  });

  it('returns a licence mayReuse actually accepts', () => {
    // The two halves have to agree or the rung is dead: Commons states its
    // licences in exactly this form, and the gate was written against it.
    for (const [code, value] of [['cc-by-sa-4.0', 'CC BY-SA 4.0'], ['cc0', 'CC0'], ['pd', 'Public domain'], ['cc-by-3.0', 'CC BY 3.0']]) {
      const [c] = candidatesFrom(
        body([page({ imageinfo: { extmetadata: { License: { value: code }, LicenseShortName: { value } } } })]),
      );
      expect(mayReuse(c.license)).toBe(true);
    }
  });

  it('falls back to UsageTerms when there is no short name', () => {
    const [c] = candidatesFrom(
      body([
        page({
          imageinfo: {
            extmetadata: {
              License: { value: 'cc-by-sa-4.0' },
              UsageTerms: { value: 'Creative Commons Attribution-Share Alike 4.0' },
            },
          },
        }),
      ]),
    );
    expect(c.license).toContain('Attribution-Share Alike');
  });

  it('skips a file the board cannot draw', () => {
    // SVG is excluded on purpose: it is markup the renderer would have to
    // inline and re-style, and on Commons it is always a labelled plate.
    for (const mime of ['image/svg+xml', 'application/pdf', 'image/tiff', 'video/webm']) {
      expect(candidatesFrom(body([page({ imageinfo: { mime } })]))).toEqual([]);
    }
  });

  it('uses the original when the thumbnailer made no thumbnail', () => {
    const [c] = candidatesFrom(body([page({ imageinfo: { thumburl: undefined } })]));
    expect(c.url).toBe('https://upload.wikimedia.org/Kidney.jpg');
  });

  it('is empty rather than broken on a reply it does not understand', () => {
    for (const junk of [null, {}, { query: {} }, { query: { pages: 'no' } }, { error: 'x' }]) {
      expect(candidatesFrom(junk)).toEqual([]);
    }
  });

  it('drops a file with no usable url at all', () => {
    expect(
      candidatesFrom(body([page({ imageinfo: { thumburl: undefined, url: undefined } })])),
    ).toEqual([]);
  });
});

describe('finding photographs a school may show (2026-10-07)', () => {
  it('keeps the order Commons ranked them in, not the order its pages arrive in', () => {
    // generator=search returns pages sorted by page id; the rank is each
    // page's own `index`. Read in arrival order, two book scans ranked 9th
    // and 10th were looked at before the photograph ranked 1st.
    const got = candidatesFrom(
      body([
        page({ pageid: 1, index: 3, title: 'File:Third.jpg', imageinfo: { thumburl: 'https://x/third.jpg' } }),
        page({ pageid: 2, index: 1, title: 'File:First.jpg', imageinfo: { thumburl: 'https://x/first.jpg' } }),
        page({ pageid: 3, index: 2, title: 'File:Second.jpg', imageinfo: { thumburl: 'https://x/second.jpg' } }),
      ]),
    );
    expect(got.map((c) => c.url)).toEqual(['https://x/first.jpg', 'https://x/second.jpg', 'https://x/third.jpg']);
  });

  it('takes the licence from the machine code Commons states, and refuses a file without one', () => {
    // "Attribution" and "Copyrighted free use" arrive as short names with no
    // code behind them: not a licence anybody identified.
    const none = candidatesFrom(
      body([page({ imageinfo: { extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' } } } })]),
    );
    expect(none.every((c) => !mayReuse(c.license))).toBe(true);
    for (const code of ['cc-by-nc-4.0', 'cc-by-nd-3.0', 'gfdl', 'attribution']) {
      const got = candidatesFrom(
        body([page({ imageinfo: { extmetadata: { License: { value: code }, LicenseShortName: { value: 'CC BY 4.0' } } } })]),
      );
      expect(got.every((c) => !mayReuse(c.license)), code).toBe(true);
    }
  });

  it('carries what a credit needs: the author, the licence and where its terms are', () => {
    const [c] = candidatesFrom(body([page()]));
    expect(c.author).toBe('Someone');
    expect(c.licenseUrl).toBe('https://creativecommons.org/licenses/by-sa/4.0');
    expect(c.page).toBe('https://commons.wikimedia.org/wiki/File:Kidney.jpg');
  });

  it('refuses a file Commons marks as needing a person\'s or a brand\'s consent (review, 2026-10-08)', () => {
    // A paid app is commercial use: an identifiable person's photograph marked
    // "personality" needs their consent for that, whatever its licence says.
    for (const value of ['personality', 'trademarked', 'personality|trademarked']) {
      const got = candidatesFrom(body([page({ imageinfo: { extmetadata: { License: { value: 'cc-by-sa-4.0' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, Restrictions: { value } } } })]));
      expect(got.every((c) => !mayReuse(c.license)), value).toBe(true);
    }
  });

  it('never offers a file whose own name says it is not for a child', () => {
    for (const title of [
      'File:Human heart male adult autopsy.jpg',
      'File:Cadaver dissection 3.jpg',
      'File:Open heart surgery.jpg',
      'File:Gunshot wound.jpg',
      'File:Nude study.jpg',
    ]) {
      expect(candidatesFrom(body([page({ title })])), title).toEqual([]);
    }
    expect(candidatesFrom(body([page({ title: 'File:Human heart model.jpg' })]))).toHaveLength(1);
  });
});

describe('the request it builds', () => {
  const capture = () => {
    const seen: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      seen.push(String(url));
      return okJson(body([page()]));
    });
    return { seen, search: createCommonsSearch({ fetch: fetch as never }) };
  };

  it('searches files, not articles', async () => {
    // Namespace 6 is File:. Without it the search returns article pages, which
    // carry no imageinfo, and every query comes back empty.
    const { seen, search } = capture();
    await search.search('a kidney', 12);
    expect(seen[0]).toContain('gsrnamespace=6');
    expect(seen[0]).toContain('generator=search');
  });

  it('asks for CORS, without which the app cannot read the answer', async () => {
    const { seen, search } = capture();
    await search.search('a kidney', 12);
    // Not percent-encoded: URLSearchParams leaves * alone, and the API wants
    // the literal star.
    expect(seen[0]).toContain('origin=*');
  });

  it('asks for a thumbnail rather than a museum scan', async () => {
    const { seen, search } = capture();
    await search.search('a kidney', 12);
    expect(seen[0]).toContain(`iiurlwidth=${THUMB_WIDTH}`);
  });

  it('asks for a width Wikimedia keeps ready, and a smaller one for a small picture', async () => {
    // Only some widths are served as thumbnails; another is a 400.
    expect([500, 960, 1280]).toContain(THUMB_WIDTH);
    const seen: string[] = [];
    const small = createCommonsSearch({
      thumbWidth: 500,
      fetch: (async (url: string) => {
        seen.push(String(url));
        return okJson(body([page()]));
      }) as never,
    });
    await small.search('a kidney', 12);
    expect(seen[0]).toContain('iiurlwidth=500');
  });

  it('asks for photographs first: JPEG files, which are rarely labelled plates', async () => {
    const { seen, search } = capture();
    await search.search('a kidney', 12);
    expect(new URL(seen[0]).searchParams.get('gsrsearch')).toBe('a kidney filemime:image/jpeg');
  });

  it('looks at any picture format when no photograph matched', async () => {
    const seen: string[] = [];
    const search = createCommonsSearch({
      fetch: (async (url: string) => {
        seen.push(String(url));
        return okJson(body(seen.length === 1 ? [] : [page()]));
      }) as never,
    });
    const got = await search.search('a kidney', 12);
    expect(new URL(seen[1]).searchParams.get('gsrsearch')).toBe('a kidney filetype:bitmap');
    expect(got).toHaveLength(1);
  });

  it('says who is asking, as Wikimedia requires, with no personal address in it', async () => {
    const inits: RequestInit[] = [];
    const search = createCommonsSearch({
      fetch: (async (_url: string, init: RequestInit) => {
        inits.push(init);
        return okJson(body([page()]));
      }) as never,
    });
    await search.search('a kidney', 12);
    const agent = new Headers(inits[0]?.headers).get('User-Agent') ?? '';
    expect(agent).toMatch(/^QRIE/);
    expect(agent).toContain('https://');
    expect(agent).not.toContain('@');
  });

  it('says who is asking when it downloads a file too (review, 2026-10-08)', async () => {
    const inits: RequestInit[] = [];
    const search = createCommonsSearch({
      fetch: (async (_url: string, init: RequestInit) => {
        inits.push(init);
        return { ok: false } as Response;
      }) as never,
    });
    await search.fetch('https://upload.wikimedia.org/x.jpg');
    expect(new Headers(inits[0]?.headers).get('User-Agent') ?? '').toMatch(/^QRIE/);
  });

  it('gives up on a search or a file that does not answer, rather than holding the class', async () => {
    const inits: RequestInit[] = [];
    const search = createCommonsSearch({
      fetch: (async (_url: string, init: RequestInit) => {
        inits.push(init);
        return okJson(body([page()]));
      }) as never,
    });
    await search.search('a kidney', 12);
    // What came back is not the point here, only what was asked with.
    await search.fetch('https://upload.wikimedia.org/x.jpg').catch(() => null);
    expect(inits).toHaveLength(2);
    for (const init of inits) expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('keeps the limit inside what the API accepts', async () => {
    const { seen, search } = capture();
    await search.search('a kidney', 5000);
    expect(seen[0]).toContain('gsrlimit=50');
    await search.search('a kidney', 0);
    expect(seen[1]).toContain('gsrlimit=1');
  });

  it('comes up empty on an API that answered with an error code', async () => {
    const search = createCommonsSearch({
      fetch: (async () => ({ ok: false, status: 503 })) as never,
    });
    expect(await search.search('a kidney', 12)).toEqual([]);
  });
});

describe('fetching one file', () => {
  const imageResponse = (type: string) =>
    ({
      ok: true,
      headers: new Headers({ 'content-type': type }),
      arrayBuffer: async () => PNG_BYTES.buffer,
    }) as unknown as Response;

  it('returns a data: URL the board can inline', async () => {
    const search = createCommonsSearch({ fetch: (async () => imageResponse('image/png')) as never });
    const got = await search.fetch('https://upload.wikimedia.org/x.png');
    expect(got).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('strips the charset an image server sometimes appends', async () => {
    const search = createCommonsSearch({
      fetch: (async () => imageResponse('image/jpeg; charset=binary')) as never,
    });
    expect(await search.fetch('x')).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('refuses a body that is not an image', async () => {
    // A 200 with an HTML error page is the shape a rate limit usually takes,
    // and inlining it would put a data: URL of markup on the board.
    const search = createCommonsSearch({ fetch: (async () => imageResponse('text/html')) as never });
    expect(await search.fetch('x')).toBeNull();
  });

  it('returns null on a dead link rather than throwing', async () => {
    const search = createCommonsSearch({ fetch: (async () => ({ ok: false })) as never });
    expect(await search.fetch('x')).toBeNull();
  });
});

describe('a moving picture on Commons (2026-10-07)', () => {
  const derivative = (key: string) => ({
    src: `https://upload.wikimedia.org/wikipedia/commons/transcoded/3/3f/Heart.webm/Heart.webm.${key}`,
    type: key.endsWith('.webm') ? 'video/webm; codecs="vp9, opus"' : 'video/quicktime; codecs="mp4v"',
    transcodekey: key,
  });
  const video = ({ videoinfo, ...over }: Record<string, unknown> = {}) => ({
    pageid: 7,
    index: 1,
    title: 'File:CG heart 90fps.webm',
    ...over,
    videoinfo: [
      {
        thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3f/Heart.webm/500px--Heart.webm.jpg',
        url: 'https://upload.wikimedia.org/wikipedia/commons/3/3f/Heart.webm',
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:CG_heart_90fps.webm',
        mime: 'video/webm',
        duration: 28.9,
        derivatives: [
          { src: 'https://upload.wikimedia.org/wikipedia/commons/3/3f/Heart.webm', type: 'video/webm; codecs="vp9"' },
          derivative('240p.vp9.webm'),
          derivative('360p.mpeg4.mov'),
          derivative('480p.vp9.webm'),
        ],
        extmetadata: {
          License: { value: 'cc-by-sa-4.0' },
          LicenseShortName: { value: 'CC BY-SA 4.0' },
          Artist: { value: 'Someone' },
        },
        ...(videoinfo as object),
      },
    ],
  });

  it('offers its still to be looked at, and its small transcodes to be played, lightest that reads first', () => {
    // A <source> list plays the first the browser can, whatever the line: so
    // the one a phone on mobile data can afford comes first (review, 2026-10-08).
    const [c] = videoCandidatesFrom(body([video()]));
    expect(c.url).toContain('500px--Heart.webm.jpg');
    expect(c.video?.map((v) => v.src.split('.').slice(-3).join('.'))).toEqual(['240p.vp9.webm', '480p.vp9.webm']);
    expect(c.video?.every((v) => v.type === 'video/webm')).toBe(true);
    expect(c.license).toBe('CC BY-SA 4.0');
    expect(c.author).toBe('Someone');
    const withAll = videoCandidatesFrom(
      body([video({ videoinfo: { derivatives: ['480p.vp9.webm', '240p.vp9.webm', '360p.vp9.webm'].map(derivative) } })]),
    );
    expect(withAll[0].video?.map((v) => v.src.split('.').slice(-3).join('.'))).toEqual(['360p.vp9.webm', '240p.vp9.webm', '480p.vp9.webm']);
  });

  it('offers frames from its middle to be looked at too, not only the still it opens on (review, 2026-10-08)', () => {
    // One frame passed is not a clip passed: a bypass operation can open on
    // green drapes. A third and two thirds of the way in, at 28.9 seconds.
    const [c] = videoCandidatesFrom(body([video()]));
    expect(c.frames).toEqual([
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3f/Heart.webm/500px-seek%3D9.6-Heart.webm.jpg',
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3f/Heart.webm/500px-seek%3D19.3-Heart.webm.jpg',
    ]);
  });

  it('offers no clip whose middle cannot be looked at', () => {
    expect(videoCandidatesFrom(body([video({ videoinfo: { thumburl: 'https://thumb.wikimedia.org/odd/still.jpg' } })]))).toEqual([]);
  });

  it('never offers a clip whose name says it shows an operation', () => {
    for (const title of ['File:Beating heart mitral valve repair, bypass.webm', 'File:Heart awaiting transplant.webm', 'File:Biopsy needle.webm']) {
      expect(videoCandidatesFrom(body([video({ title })])), title).toEqual([]);
    }
  });

  it('never offers the original, which can run to sixty megabytes, nor a codec a browser cannot play', () => {
    const [c] = videoCandidatesFrom(body([video()]));
    expect(c.video?.some((v) => v.src.endsWith('/Heart.webm'))).toBe(false);
    expect(c.video?.some((v) => v.src.endsWith('.mov'))).toBe(false);
  });

  it('keeps a loop short enough to watch while she talks, and to check', () => {
    expect(videoCandidatesFrom(body([video({ videoinfo: { duration: 1 } })]))).toEqual([]);
    expect(videoCandidatesFrom(body([video({ videoinfo: { duration: 45 } })]))).toEqual([]);
    expect(videoCandidatesFrom(body([video({ videoinfo: { duration: 400 } })]))).toEqual([]);
  });

  it('keeps the search rank and the same rules a still is held to', () => {
    const got = videoCandidatesFrom(
      body([
        video({ pageid: 1, index: 2, title: 'File:Second.webm' }),
        video({ pageid: 2, index: 1, title: 'File:First.webm' }),
        video({ pageid: 3, index: 3, title: 'File:Open heart surgery.webm' }),
      ]),
    );
    expect(got).toHaveLength(2);
    expect(got[0].page).toBe('https://commons.wikimedia.org/wiki/File:CG_heart_90fps.webm');
    const none = videoCandidatesFrom(body([video({ videoinfo: { extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' } } } })]));
    expect(none.every((c) => !mayReuse(c.license))).toBe(true);
  });

  it('asks for videos, with their transcodes and a still', async () => {
    const seen: string[] = [];
    const search = createCommonsSearch({
      fetch: (async (url: string) => {
        seen.push(String(url));
        return okJson(body([video()]));
      }) as never,
    });
    const got = await search.searchVideo!('heart beating', 12);
    const asked = new URL(seen[0]).searchParams;
    expect(asked.get('gsrsearch')).toBe('heart beating filetype:video');
    expect(asked.get('prop')).toBe('videoinfo');
    expect(asked.get('viprop')).toContain('derivatives');
    expect(asked.get('viurlwidth')).toBe(String(THUMB_WIDTH));
    expect(got).toHaveLength(1);
  });
});

/**
 * AN OLDER PHONE STILL GETS PHOTOS (integration audit, 2026-10-11).
 * AbortSignal.timeout is missing before Chrome 103 and Safari 16 (and in older
 * Android WebViews); there it threw, the search read as "unreachable", and the
 * class silently had no photo at all.
 */
describe('timeoutSignal', () => {
  it('aborts after the time given, with or without AbortSignal.timeout', async () => {
    const { timeoutSignal } = await import('../src/commons');
    const real = AbortSignal.timeout;
    try {
      (AbortSignal as unknown as { timeout?: unknown }).timeout = undefined;
      const signal = timeoutSignal(20);
      expect(signal.aborted).toBe(false);
      await new Promise((r) => setTimeout(r, 40));
      expect(signal.aborted).toBe(true);
    } finally {
      (AbortSignal as unknown as { timeout: typeof real }).timeout = real;
    }
    const native = timeoutSignal(20);
    await new Promise((r) => setTimeout(r, 40));
    expect(native.aborted).toBe(true);
  });
});
