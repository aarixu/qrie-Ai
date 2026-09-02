import type { WebCandidate, WebImageAdapter } from './fromWeb.ts';

/**
 * WIKIMEDIA COMMONS AS THE PLACE TO LOOK.
 *
 * The search behind rung three, and the reason it can exist at all: every file
 * on Commons is public domain or Creative Commons by the project's own rule,
 * and every file states which. `mayReuse` was written against exactly that
 * shape — a licence the search reports verbatim — and a general image search
 * cannot honestly fill it in.
 *
 * It also happens to hold the pictures a school lesson wants. Anatomy plates,
 * mineral samples, apparatus, leaves in cross section, the Moon: Commons is
 * largely a museum and a herbarium, which is a better fit for "a kidney cut
 * lengthwise" than the open web is.
 *
 * NO API KEY. Not a small detail — it is why this rung can ship before any
 * paid search is chosen, and why turning it on costs nothing per class beyond
 * the one vision call that verifies what came back.
 *
 * The catch, and it is a real one: Commons is a library of LABELLED plates.
 * Most educational diagrams there have the parts written on them, and the
 * verifier will refuse those, because the tutor writes every label herself.
 * Photographs pass far more often than diagrams do — which is the same reason
 * `medium: "picture"` exists at all.
 */

/** Where the API lives. Overridable so a test never touches the network. */
export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

/**
 * How wide a picture to ask for.
 *
 * Commons holds originals that run to tens of megabytes, and the board draws
 * this into a box a phone can see. A thumbnail at this width is sharp on a
 * high-density screen, downloads in a second on a slow connection, and inlines
 * as a data: URL without bloating the saved class past the store's 12 MB file
 * limit — which an original scan would do on its own.
 */
export const THUMB_WIDTH = 1024;

/** What the API is asked for, without which none of the rest can be filled in. */
const PROPS = 'url|extmetadata|size|mime';

interface CommonsImageInfo {
  thumburl?: string;
  url?: string;
  descriptionurl?: string;
  mime?: string;
  extmetadata?: Record<string, { value?: string } | undefined>;
}

/** Pull the plain text out of a metadata field, which arrives as HTML. */
function plain(field: { value?: string } | undefined): string | undefined {
  const raw = field?.value;
  if (!raw) return undefined;
  const text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || undefined;
}

/**
 * Formats the board can actually draw.
 *
 * SVG is excluded deliberately even though Commons is full of it: an SVG plate
 * is markup the renderer would have to inline and re-style, and every one of
 * them is a labelled diagram anyway. TIFF and PDF are not images to a browser.
 */
const DRAWABLE = /^image\/(jpeg|png|webp|gif)$/;

export function candidatesFrom(body: unknown): WebCandidate[] {
  const pages = (body as { query?: { pages?: Record<string, unknown> } })?.query?.pages;
  if (!pages || typeof pages !== 'object') return [];

  const out: WebCandidate[] = [];
  for (const page of Object.values(pages)) {
    const info = (page as { imageinfo?: CommonsImageInfo[] })?.imageinfo?.[0];
    if (!info) continue;
    if (info.mime && !DRAWABLE.test(info.mime)) continue;

    // The thumbnail, and the original only if no thumbnail was made — for a
    // format the thumbnailer refuses, the original is all there is.
    const url = info.thumburl ?? info.url;
    if (!url) continue;

    const meta = info.extmetadata ?? {};
    const licence = plain(meta.LicenseShortName) ?? plain(meta.UsageTerms);
    const artist = plain(meta.Artist);

    out.push({
      url,
      // The description page, not the file: it is where a person answering a
      // takedown finds the author, the licence and the upload history. The
      // author is folded in because a CC BY credit needs a name, and the page
      // is one click further than whoever is reading the credit will go.
      ...(info.descriptionurl
        ? { source: artist ? `${info.descriptionurl} by ${artist}` : info.descriptionurl }
        : {}),
      ...(licence ? { license: licence } : {}),
      ...(plain(meta.ObjectName) ? { title: plain(meta.ObjectName)! } : {}),
    });
  }
  return out;
}

export interface CommonsOptions {
  /** Injected so tests never reach the network. Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Overridable for a mirror, and so a test can assert the URL it built. */
  endpoint?: string;
}

/**
 * A WebImageAdapter over Commons.
 *
 * Neither method throws for a caller — `findOnTheWeb` treats a failure and an
 * empty result the same way, and both mean generation gets the picture.
 */
export function createCommonsSearch(options: CommonsOptions = {}): WebImageAdapter {
  const doFetch = options.fetch ?? globalThis.fetch;
  const endpoint = options.endpoint ?? COMMONS_API;

  return {
    async search(query, limit) {
      const url = new URL(endpoint);
      url.searchParams.set('action', 'query');
      url.searchParams.set('format', 'json');
      url.searchParams.set('formatversion', '2');
      // origin=* is what makes this callable from the app's own origin. Without
      // it the browser refuses the response and the rung is dead in the one
      // place it needs to work.
      url.searchParams.set('origin', '*');
      url.searchParams.set('generator', 'search');
      url.searchParams.set('gsrsearch', query);
      // Namespace 6 is File:. Without it the search returns article pages,
      // which have no imageinfo and produce an empty list every time.
      url.searchParams.set('gsrnamespace', '6');
      url.searchParams.set('gsrlimit', String(Math.max(1, Math.min(50, limit))));
      url.searchParams.set('prop', 'imageinfo');
      url.searchParams.set('iiprop', PROPS);
      url.searchParams.set('iiurlwidth', String(THUMB_WIDTH));

      const response = await doFetch(url.toString());
      if (!response.ok) return [];
      return candidatesFrom(await response.json());
    },

    async fetch(url) {
      const response = await doFetch(url);
      if (!response.ok) return null;

      const type = response.headers.get('content-type') ?? 'image/jpeg';
      if (!DRAWABLE.test(type.split(';')[0].trim())) return null;

      const bytes = new Uint8Array(await response.arrayBuffer());
      return `data:${type.split(';')[0].trim()};base64,${base64(bytes)}`;
    },
  };
}

/**
 * Bytes to base64, without Buffer.
 *
 * This runs in a browser as often as in Node — the class is prepared on the
 * student's own phone — so it cannot reach for Buffer, and btoa needs a binary
 * string built in chunks: spreading a two-megabyte array into String.fromCharCode
 * in one call overflows the argument stack.
 */
function base64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return typeof btoa === 'function'
    ? btoa(binary)
    : // eslint-disable-next-line no-undef
      Buffer.from(bytes).toString('base64');
}
