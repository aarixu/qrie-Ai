import { describe, expect, it, vi } from 'vitest';
import { THUMB_WIDTH, candidatesFrom, createCommonsSearch } from '../src/commons';
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
        LicenseShortName: { value: 'CC BY-SA 4.0' },
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
    for (const value of ['CC BY-SA 4.0', 'CC0', 'Public domain', 'CC BY 3.0']) {
      const [c] = candidatesFrom(
        body([page({ imageinfo: { extmetadata: { LicenseShortName: { value } } } })]),
      );
      expect(mayReuse(c.license)).toBe(true);
    }
  });

  it('falls back to UsageTerms when there is no short name', () => {
    const [c] = candidatesFrom(
      body([
        page({
          imageinfo: {
            extmetadata: { UsageTerms: { value: 'Creative Commons Attribution-Share Alike 4.0' } },
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
