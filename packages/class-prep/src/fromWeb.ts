import {
  PART_FINDER_SYSTEM,
  imageAspect,
  parseParts,
  partFinderUser,
  type PictureBrief,
  type PictureResult,
  type VisionAdapter,
} from './picture';

/**
 * TAKING A PICTURE INSTEAD OF MAKING ONE.
 *
 * Generating an image is the most expensive thing this pipeline does and the
 * least reliable: it is the one step that can produce a confident, beautiful
 * picture of the wrong organ. The web already has photographs of a kidney.
 *
 * So the ladder for artwork, cheapest and most trustworthy first:
 *
 *   1. DRAW IT.   A graph, a circuit, a cycle, a force diagram — anything that
 *                 is not a physical thing — is line art the artist writes, and
 *                 its parts can be lit from inside. Already the `diagram`
 *                 medium; nothing here changes it.
 *   2. TAKE IT.   A word on the board that has an icon in the library gets the
 *                 icon. Already `icons.ts`, and a different axis: icons stand
 *                 beside words, not on the board as the subject.
 *   3. FIND IT.   THIS FILE. A real thing — an organ, a leaf, a slice of rock
 *                 — probably exists as a photograph somebody has licensed for
 *                 reuse. One vision call decides whether the thing found is
 *                 actually the thing asked for.
 *   4. MAKE IT.   Only when the first three have nothing. `drawPicture`.
 *
 * TWO THINGS MAKE THIS HARDER THAN IT SOUNDS.
 *
 * The first is that the search engine does not know what the lesson means.
 * `icons.ts` learned this the expensive way — a lesson about water flowing
 * between tanks put an armoured vehicle on the board — and the answer is the
 * same one: something that understands the lesson looks at what was found and
 * says yes or no. It is one call, on a fast model, and the alternative is a
 * board that is confidently wrong in front of a child.
 *
 * The second is that most educational images on the web are LABELLED, and a
 * labelled picture is useless here: the tutor writes every label herself as
 * she speaks, so printed ones both fight with her handwriting and give away
 * her next line. Expect the verifier to reject the majority of what it is
 * shown. That is the rung working, not failing — it falls through to
 * generation, which is where it would have started anyway.
 */

/** One image the search turned up. Nothing here is trusted yet. */
export interface WebCandidate {
  /** Where the image itself lives. */
  url: string;
  /** The page it was found on, for attribution. */
  source?: string;
  /** How the search described it — a clue for the query, never for the choice. */
  title?: string;
  /**
   * The licence the search reported, verbatim.
   *
   * Absent means the search did not say, which is NOT the same as permissive
   * and is treated as a refusal. A class is cached and served publicly; an
   * unlicensed photograph in one is a real liability with a child's name on
   * the account it was served to.
   */
  license?: string;
}

export interface WebImageAdapter {
  /** Images matching a query, best first. */
  search(query: string, limit: number): Promise<readonly WebCandidate[]>;
  /** One image as a `data:` URL, or null if it could not be had. */
  fetch(url: string): Promise<string | null>;
}

/** A found picture, with where it came from so the class can credit it. */
export interface FoundPicture extends PictureResult {
  /** The page the image was found on, when the search said. */
  source: string | null;
  license: string | null;
}

/**
 * Licences that allow a picture to be reused in a served lesson.
 *
 * Deliberately short and deliberately conservative. Everything here permits
 * commercial reuse with attribution at most; anything a search cannot place in
 * this list is refused rather than guessed at, because the cost of guessing
 * wrong is not a bad picture, it is a takedown against a children's app.
 *
 * NonCommercial and NoDerivatives are absent on purpose: this is a paid app
 * and the tutor draws on top of every picture, which is a derivative.
 */
export const REUSABLE_LICENCES: readonly string[] = [
  'public domain',
  'publicdomain',
  'cc0',
  'cc-0',
  'cc by',
  'cc-by',
  'cc by-sa',
  'cc-by-sa',
  'attribution',
  'attribution-sharealike',
];

/**
 * True when a licence string is one we may build on.
 *
 * String matching, because every search API spells these differently, and the
 * ND/NC check comes FIRST: "CC BY-NC-ND 4.0" contains "cc by" and would
 * otherwise pass the very test that exists to stop it.
 */
export function mayReuse(license: string | undefined): boolean {
  if (!license) return false;
  const l = license.toLowerCase();
  if (/\bnc\b|noncommercial|non-commercial|\bnd\b|noderiv/.test(l)) return false;
  return REUSABLE_LICENCES.some((ok) => l.includes(ok));
}

/**
 * What to search for.
 *
 * The brief and not the alt text: `brief` says what the picture must SHOW and
 * is written for an artist, which is close to what an image search wants. The
 * no-text hint is worth adding even though search engines largely ignore it —
 * on the occasions it lands it saves a download and a vision call.
 */
export function searchQuery(brief: PictureBrief): string {
  return `${brief.brief.replace(/\s+/g, ' ').trim()} unlabelled photograph`;
}

export const VERIFIER_SYSTEM = `You look at one picture and say whether it is
the picture a lesson asked for. You are the last check before it goes on a
board in front of a child, and a wrong yes is worse than any no.

Answer with JSON and nothing else:

{"saw":"<what the picture actually shows, in a few words>",
 "right":true|false,
 "text":true|false,
 "count":<how many of the subject are in it>}

- "right" is true ONLY if the picture shows the subject the lesson asked for.
  Not something related to it, not something that shares its name, not a
  different part of the same body. If the lesson asks for a kidney cross
  section and the picture is a whole kidney, that is false.
- "text" is true if ANY words, letters, numbers, labels, leader lines, keys,
  legends, captions, arrows with writing, or watermarks appear anywhere in the
  image. A teacher writes every label on this board herself as she speaks, so
  a printed one both fights with her handwriting and gives away her next line.
  Look at the edges and corners, where watermarks live.
- "count" is how many separate instances of the subject are in the picture.
  She teaches on ONE: with two, every mark she makes lands on one of them and
  the student does not know which.

Say what you actually see in "saw" even when it is not what was asked for.`;

export function verifierUser(brief: PictureBrief): string {
  return `The lesson asked for: ${brief.brief}

It will be read to a student who cannot see it as: ${brief.alt}

Is this that picture?`;
}

export interface Verdict {
  right: boolean;
  hasText: boolean;
  count: number;
  /** What the model said it saw, for a prep report to quote. */
  saw: string;
}

/**
 * Read a verdict.
 *
 * An unreadable reply is a NO, not a shrug. Every other parse failure in this
 * pipeline falls back to something usable; this one would fall back to putting
 * an unverified web image on a child's board, so it fails closed.
 */
export function parseVerdict(raw: string): Verdict {
  const no: Verdict = { right: false, hasText: false, count: 0, saw: '' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
  } catch {
    return no;
  }
  if (typeof parsed !== 'object' || parsed === null) return no;
  const o = parsed as Record<string, unknown>;
  return {
    right: o.right === true,
    hasText: o.text === true,
    // Absent is one, not zero: a model that answered the two questions that
    // matter and left this one out has not thereby failed the picture.
    count: typeof o.count === 'number' ? o.count : 1,
    saw: typeof o.saw === 'string' ? o.saw : '',
  };
}

/** Why a candidate was turned down, in words a prep report can print. */
export function refusalFor(v: Verdict): string | null {
  if (!v.right) return v.saw ? `it is ${v.saw}` : 'it is not the subject';
  if (v.hasText) return 'it has words printed on it';
  if (v.count >= 2) return `it has ${v.count} of the subject in it`;
  return null;
}

export interface FindOptions {
  /**
   * How many candidates to fetch and look at before giving up.
   *
   * Three. Each one costs a download and a vision call, and generation is
   * waiting behind them: a fourth attempt at finding is more expensive than
   * the thing it is trying to avoid.
   */
  tries?: number;
  /** How many results to ask the search for — more, to filter by licence from. */
  searchLimit?: number;
}

export const DEFAULT_TRIES = 3;
export const DEFAULT_SEARCH_LIMIT = 12;

export interface Search {
  found: FoundPicture | null;
  /** Why each candidate was turned down, for the prep report. */
  refusals: string[];
}

/**
 * Find a picture on the web, or come up empty and let generation have it.
 *
 * Never throws. Every rung of this ladder is allowed to come up empty — that
 * is what makes it a ladder — so an adapter that fails, a search that returns
 * nothing, and a verifier that refuses all three all land in the same place.
 */
export async function findOnTheWeb(
  brief: PictureBrief,
  web: WebImageAdapter,
  eyes: VisionAdapter,
  options: FindOptions = {},
): Promise<Search> {
  const tries = options.tries ?? DEFAULT_TRIES;
  const refusals: string[] = [];

  let candidates: readonly WebCandidate[];
  try {
    candidates = await web.search(searchQuery(brief), options.searchLimit ?? DEFAULT_SEARCH_LIMIT);
  } catch {
    return { found: null, refusals: ['the image search could not be reached'] };
  }

  const usable = candidates.filter((c) => c.url && mayReuse(c.license));
  if (usable.length === 0) {
    refusals.push(
      candidates.length === 0
        ? 'the search found nothing'
        : `none of the ${candidates.length} results were licensed for reuse`,
    );
    return { found: null, refusals };
  }

  let looked = 0;
  for (const candidate of usable) {
    if (looked >= tries) break;

    let src: string | null = null;
    try {
      src = await web.fetch(candidate.url);
    } catch {
      src = null;
    }
    // A download that failed cost no vision call, so it does not spend a try:
    // a dead link is not the search being wrong about the picture.
    if (!src || !src.startsWith('data:image/')) continue;

    looked += 1;
    let verdict: Verdict;
    try {
      verdict = parseVerdict(await eyes.look(src, VERIFIER_SYSTEM, verifierUser(brief)));
    } catch {
      verdict = { right: false, hasText: false, count: 0, saw: '' };
    }

    const refusal = refusalFor(verdict);
    if (refusal) {
      refusals.push(refusal);
      continue;
    }

    // It is the right picture. Now find out where its parts are — the same
    // second look a generated picture gets, and for the same reason: layout
    // owns every coordinate on the board, this owns only what is true inside
    // one image, and that can only be learned by looking at the image itself.
    let parts: ReturnType<typeof parseParts> = [];
    if (brief.parts.length > 0) {
      try {
        parts = parseParts(
          await eyes.look(src, PART_FINDER_SYSTEM, partFinderUser(brief.parts)),
          brief.parts,
        );
      } catch {
        parts = [];
      }
    }

    return {
      found: {
        src,
        parts,
        attempts: looked,
        aspect: imageAspect(src),
        faults: [],
        source: candidate.source ?? null,
        license: candidate.license ?? null,
      },
      refusals,
    };
  }

  return { found: null, refusals };
}
