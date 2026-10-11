import type { VideoSource } from '@ai-tutor/lesson-format';
import { mayReuse, type WebCandidate, type WebImageAdapter } from './fromWeb.ts';

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
 *
 * And it is one of the widths Wikimedia keeps ready (20, 40, 60, 120, 250, 330,
 * 500, 960, 1280, 1920, 3840): another width is made on request or refused
 * with a 400 (Common thumbnail sizes, mediawiki.org, checked 2026-10-07). It
 * was 1024, which is not one of them.
 */
export const THUMB_WIDTH = 960;

/** What the API is asked for, without which none of the rest can be filled in. */
const PROPS = 'url|extmetadata|size|mime';

/**
 * Who is asking, from a script. Wikimedia limits a client that does not say
 * so to ten requests a minute (API rate limits, 2026), and a page of placed
 * things is more searches than that. A browser is already identified by its
 * own User-Agent and allowed 200 a minute, so a page sends nothing of its own
 * (agentHeaders). A web address to reach the project, no personal one.
 */
export const AGENT = 'QRIE-classroom/0.1 (https://qrie-canvas-demo.vercel.app)';

/** How long a search, and a file, may take before the rung gives up on it. */
export const SEARCH_TIMEOUT_MS = 15_000;
export const FILE_TIMEOUT_MS = 20_000;

/**
 * A signal that aborts after `ms`. AbortSignal.timeout where the browser has
 * it; an AbortController and a timer where it does not (before Chrome 103 and
 * Safari 16, and in older Android WebViews), where calling it threw and the
 * search read as "unreachable": no photo at all, silently (2026-10-11).
 */
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/**
 * The licences this may build on, as Commons states them in `License`: its
 * machine code, not the short name written for people. Public domain, CC0,
 * and CC BY or CC BY-SA at any version or port ("cc-by-sa-3.0-pl"). A short
 * name with no code behind it — "Attribution", "Copyrighted free use" — is not
 * a licence anyone identified, and is refused.
 */
const OPEN_CODE = /^(?:pd|cc0|cc-zero|cc-by(?:-sa)?-\d(?:\.\d)?(?:-[a-z]+)?)$/i;

/**
 * A file whose own name says it is not for a child.
 *
 * Measured 2026-10-07: "human heart" brought back an autopsy photograph third,
 * and "man running" as video a police bodycam recording. The vision check
 * looks too, but a name that already says so costs no download and no look.
 * Words that only ever mean the thing: "sex" is not here, because "sexual
 * reproduction" is a chapter of the syllabus.
 */
const NOT_FOR_A_CHILD =
  /autops|cadaver|corpse|dissect|surgery|surgical|wound|\bgore\b|injur|\bnude\b|naked|porn|execution|gunshot|bodycam|murder|massacre|tortur|lynch|transplant|bypass|incision|biopsy|endoscop|laparoscop|in.situ|ex.vivo/i;

/** One page of the search's reply: its title, and its place in the ranking. */
interface CommonsPage {
  title?: string;
  index?: number;
  imageinfo?: CommonsImageInfo[];
  videoinfo?: CommonsVideoInfo[];
}

/** A transcode Commons made of a video, by its key: "480p.vp9.webm". */
interface CommonsDerivative {
  src?: string;
  type?: string;
  transcodekey?: string;
}

interface CommonsVideoInfo extends CommonsImageInfo {
  duration?: number;
  derivatives?: CommonsDerivative[];
}

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
const DRAWABLE = /^image\/(jpeg|png|webp)$/;

/**
 * The files a search found, best first.
 *
 * Best first by the search's own rank, each page's `index`. The pages arrive
 * sorted by page id, which says nothing about the query: read in that order,
 * "villus cross-section" looked at two book scans ranked ninth and tenth
 * before the micrograph ranked first, and the rung spent its three looks on
 * them (board-composer, 2026-10-06).
 */
export function candidatesFrom(body: unknown): WebCandidate[] {
  const out: WebCandidate[] = [];
  for (const page of rankedPages(body)) {
    const info = page.imageinfo?.[0];
    if (!info) continue;
    if (info.mime && !DRAWABLE.test(info.mime)) continue;

    // The thumbnail, and the original only if no thumbnail was made — for a
    // format the thumbnailer refuses, the original is all there is.
    const url = info.thumburl ?? info.url;
    if (!url) continue;
    out.push(described(url, info));
  }
  return out;
}

/** The pages of a reply in the search's own rank, a page whose name says it is not for a child left out. */
function rankedPages(body: unknown): CommonsPage[] {
  const pages = (body as { query?: { pages?: Record<string, unknown> } })?.query?.pages;
  if (!pages || typeof pages !== 'object') return [];
  return (Object.values(pages) as CommonsPage[])
    .filter((page) => page !== null && typeof page === 'object')
    .map((page, arrived) => ({ page, rank: typeof page.index === 'number' ? page.index : 1e6 + arrived }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ page }) => page)
    .filter((page) => !(page.title && NOT_FOR_A_CHILD.test(page.title)));
}

/**
 * The transcodes a board can play, in the order it tries them. A <source>
 * list plays the first one the browser CAN play, whatever the line — it never
 * picks by bandwidth — so the order is the choice: 360p first, sharp enough
 * for the box a picture gets and light enough for a phone on mobile data,
 * then 240p, and 480p only when neither was made. VP9 WebM only. The original
 * can run to sixty megabytes, and Commons' .mov transcodes are MPEG-4 Part 2
 * ("mp4v"), which no current browser plays.
 */
const PLAYABLE = ['360p.vp9.webm', '240p.vp9.webm', '480p.vp9.webm'] as const;

/**
 * How long a loop may run, in seconds. Long enough to show the movement and
 * short enough to sit beside what she is saying — and to be checked: a few
 * frames looked at say more about thirty seconds than about ninety (review,
 * 2026-10-08).
 */
export const VIDEO_SECONDS = { min: 2, max: 30 } as const;

/**
 * Stills from a clip's middle, to be looked at as well as the one it opens on.
 *
 * One frame passed is not a clip passed: a bypass operation can open on green
 * drapes (review, 2026-10-08). Commons draws any moment of a video as a
 * thumbnail when its name asks for one — "500px-seek=9.6-Heart.webm.jpg" for
 * 9.6 seconds in, fetched and checked 2026-10-08 — so the default still's
 * address, "500px--Heart.webm.jpg", is rewritten for a third and two thirds
 * of the way through. An address that is not that shape gives no frames, and
 * a clip with no frames to look at is not offered.
 */
function framesOf(still: string, seconds: number): string[] {
  const [address] = still.split('?');
  const shape = /^(.*\/)(\d+)px--([^/]+)$/.exec(address);
  if (!shape) return [];
  const [, folder, width, name] = shape;
  return [1 / 3, 2 / 3].map((at) => `${folder}${width}px-seek%3D${Number((seconds * at).toFixed(1))}-${name}`);
}

/**
 * The videos a search found, best first: each as its still (to be looked at,
 * exactly as a photograph is) with the transcodes to play once it passes.
 */
export function videoCandidatesFrom(body: unknown): WebCandidate[] {
  const out: WebCandidate[] = [];
  for (const page of rankedPages(body)) {
    const info = page.videoinfo?.[0];
    if (!info?.thumburl) continue;
    const seconds = info.duration ?? 0;
    if (seconds < VIDEO_SECONDS.min || seconds > VIDEO_SECONDS.max) continue;
    const video: VideoSource[] = [];
    for (const key of PLAYABLE) {
      const found = info.derivatives?.find((d) => d.transcodekey === key && typeof d.src === 'string');
      if (found?.src) video.push({ src: found.src, type: 'video/webm' });
    }
    if (video.length === 0) continue;
    const frames = framesOf(info.thumburl, seconds);
    if (frames.length === 0) continue;
    out.push({ ...described(info.thumburl, info), video, frames });
  }
  return out;
}

/** A file's description: where its picture is, and everything its credit needs. */
function described(url: string, info: CommonsImageInfo): WebCandidate {
  const meta = info.extmetadata ?? {};
  // The name people read, kept only when the code behind it is one this may
  // build on: without it, `mayReuse` sees no licence and refuses the file.
  const code = plain(meta.License);
  // And never a file Commons marks as needing someone's consent for use beyond
  // its licence: an identifiable person ("personality") or a brand
  // ("trademarked"). A paid app is commercial use (review, 2026-10-08).
  const consent = /personality|trademark/i.test(plain(meta.Restrictions) ?? '');
  const licence =
    code && OPEN_CODE.test(code) && !consent ? (plain(meta.LicenseShortName) ?? plain(meta.UsageTerms)) : undefined;
  const artist = plain(meta.Artist);
  const terms = plain(meta.LicenseUrl);

  return {
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
    // What a credit line needs, each on its own, for whoever writes one.
    ...(artist ? { author: artist } : {}),
    ...(terms ? { licenseUrl: terms } : {}),
    ...(info.descriptionurl ? { page: info.descriptionurl } : {}),
  };
}

export interface CommonsOptions {
  /** Injected so tests never reach the network. Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Overridable for a mirror, and so a test can assert the URL it built. */
  endpoint?: string;
  /**
   * How wide a thumbnail to ask for: THUMB_WIDTH unless a smaller picture is
   * wanted. One of the widths Wikimedia keeps ready (see THUMB_WIDTH).
   */
  thumbWidth?: number;
}

/**
 * The headers that say who is asking: User-Agent from a script, and nothing
 * from a page.
 *
 * Any header a page adds makes each search two round trips, a CORS preflight
 * and then the search. Measured on 2026-10-08 on a slow route to Wikimedia:
 * 20-35 seconds a search with Api-User-Agent, 3.5-9 seconds without it, and
 * the browser's own User-Agent already identifies the page.
 */
function agentHeaders(): Record<string, string> {
  const inAPage = typeof document !== 'undefined';
  return inAPage ? {} : { 'User-Agent': AGENT, 'Api-User-Agent': AGENT };
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
  const width = options.thumbWidth ?? THUMB_WIDTH;

  const searchFor = async (words: string, limit: number): Promise<WebCandidate[]> => {
      const url = new URL(endpoint);
      url.searchParams.set('action', 'query');
      url.searchParams.set('format', 'json');
      url.searchParams.set('formatversion', '2');
      // origin=* is what makes this callable from the app's own origin. Without
      // it the browser refuses the response and the rung is dead in the one
      // place it needs to work.
      url.searchParams.set('origin', '*');
      url.searchParams.set('generator', 'search');
      url.searchParams.set('gsrsearch', words);
      // Namespace 6 is File:. Without it the search returns article pages,
      // which have no imageinfo and produce an empty list every time.
      url.searchParams.set('gsrnamespace', '6');
      url.searchParams.set('gsrlimit', String(Math.max(1, Math.min(50, limit))));
      url.searchParams.set('prop', 'imageinfo');
      url.searchParams.set('iiprop', PROPS);
      url.searchParams.set('iiurlwidth', String(width));

      const response = await doFetch(url.toString(), {
        headers: agentHeaders(),
        signal: timeoutSignal(SEARCH_TIMEOUT_MS),
      });
      if (!response.ok) return [];
      return candidatesFrom(await response.json());
  };

  return {
    /**
     * Photographs first, then any picture.
     *
     * A JPEG on Commons is nearly always a photograph and a PNG nearly always
     * a drawn plate with its labels on, which the verifier refuses: asking for
     * JPEG first spends the looks on pictures that can pass. And a query can
     * match nothing but PDFs ("single intestinal villus in cross-section"
     * found twelve), which this never sees.
     */
    async search(query, limit) {
      const photos = await searchFor(`${query} filemime:image/jpeg`, limit);
      if (photos.some((c) => mayReuse(c.license))) return photos;
      const any = await searchFor(`${query} filetype:bitmap`, limit);
      const seen = new Set(photos.map((c) => c.url));
      return [...photos, ...any.filter((c) => !seen.has(c.url))];
    },

    /**
     * Short silent loops of a thing moving, for a picture whose lesson is the
     * movement (2026-10-07). Each comes back as its still, so the same eyes
     * that look at a photograph look at it before it plays.
     */
    async searchVideo(query, limit) {
      const url = new URL(endpoint);
      url.searchParams.set('action', 'query');
      url.searchParams.set('format', 'json');
      url.searchParams.set('formatversion', '2');
      url.searchParams.set('origin', '*');
      url.searchParams.set('generator', 'search');
      url.searchParams.set('gsrsearch', `${query} filetype:video`);
      url.searchParams.set('gsrnamespace', '6');
      url.searchParams.set('gsrlimit', String(Math.max(1, Math.min(50, limit))));
      url.searchParams.set('prop', 'videoinfo');
      url.searchParams.set('viprop', 'url|mime|size|derivatives|extmetadata');
      url.searchParams.set('viurlwidth', String(width));
      const response = await doFetch(url.toString(), {
        headers: agentHeaders(),
        signal: timeoutSignal(SEARCH_TIMEOUT_MS),
      });
      if (!response.ok) return [];
      return videoCandidatesFrom(await response.json());
    },

    async fetch(url) {
      // From a script, say who is asking here too: upload.wikimedia.org holds
      // file downloads to the same User-Agent policy as the API.
      const response = await doFetch(url, { headers: agentHeaders(), signal: timeoutSignal(FILE_TIMEOUT_MS) });
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
