import type { Credit, VideoSource } from '@ai-tutor/lesson-format';
import {
  PART_FINDER_SYSTEM,
  imageAspect,
  parseParts,
  partFinderUser,
  type PictureBrief,
  type PictureResult,
  type VisionAdapter,
} from './picture.ts';

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
  /** Who made it, for the credit a CC BY licence asks for. */
  author?: string;
  /** Where the licence's own terms are, for the same credit. */
  licenseUrl?: string;
  /** The page that describes the file — the place a credit links to. */
  page?: string;
  /**
   * For a video: the sources to play once its still, at `url`, has been
   * looked at and passed.
   */
  video?: VideoSource[];
  /**
   * For a video: stills from its middle, each of which must pass too — one
   * frame passed is not a clip passed (review, 2026-10-08).
   */
  frames?: string[];
}

export interface WebImageAdapter {
  /** Images matching a query, best first. */
  search(query: string, limit: number): Promise<readonly WebCandidate[]>;
  /** One image as a `data:` URL, or null if it could not be had. */
  fetch(url: string): Promise<string | null>;
  /**
   * Videos matching a query, best first, each as its still with `video` set.
   * Optional: a search with no videos is a search for stills.
   */
  searchVideo?(query: string, limit: number): Promise<readonly WebCandidate[]>;
}

export type { Credit };

/** A found picture, with where it came from so the class can credit it. */
export interface FoundPicture extends PictureResult {
  /** The page the image was found on, when the search said. */
  source: string | null;
  license: string | null;
  /** Everything a credit needs, when the search reported a licence. */
  credit: Credit | null;
  /** When what was found is a loop: the sources to play over `src`, its still. */
  video?: VideoSource[];
}

/** The credit a candidate carries, or null when it has no licence to name. */
export function creditOf(c: WebCandidate): Credit | null {
  if (!c.license) return null;
  const author = c.author ? shortened(c.author, CREDIT_AUTHOR_MAX) : undefined;
  const licenseUrl = webPage(c.licenseUrl);
  const page = webPage(c.page);
  return {
    ...(author ? { author } : {}),
    license: shortened(c.license, CREDIT_LICENCE_MAX),
    ...(licenseUrl ? { licenseUrl } : {}),
    ...(page ? { page } : {}),
  };
}

/**
 * A CREDIT THE CLASS FORMAT WILL KEEP (review, 2026-10-08).
 *
 * Commons' Artist text runs to any length and its LicenseUrl is sometimes
 * http or protocol-relative ("//creativecommons.org/…"). The format keeps a
 * credit's words under 200 characters and its links as https pages under 600
 * (lesson-format validate.ts), and a credit it refuses makes the keep fail —
 * so the next student pays to prepare the same class again. Made to fit
 * here, where it is made.
 */
const CREDIT_AUTHOR_MAX = 120;
const CREDIT_LICENCE_MAX = 80;
const LINK_MAX = 600;

const shortened = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/** An https web page, from what a source wrote; undefined when it is not one. */
function webPage(link: string | undefined): string | undefined {
  if (!link) return undefined;
  const https = link.trim().replace(/^\/\//, 'https://').replace(/^http:\/\//i, 'https://');
  return https.length <= LINK_MAX && /^https:\/\/[^\s"'<>]+$/.test(https) ? https : undefined;
}

/** The loop sources the class format keeps: https, under its length. */
export const keepableVideo = (sources: readonly VideoSource[] | undefined): VideoSource[] =>
  (sources ?? []).filter((s) => s.src.length <= LINK_MAX && /^https:\/\/[^\s"'<>]+$/.test(s.src));

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
  // Commons states some files exactly this way, and it means free. Measured:
  // it was the only usable candidate for one of the twelve briefs tried.
  'no restrictions',
];

/**
 * True when a licence string is one we may build on.
 *
 * String matching, because every search API spells these differently, and the
 * ND/NC check comes FIRST: "CC BY-NC-ND 4.0" contains "cc by" and would
 * otherwise pass the very test that exists to stop it.
 */
/**
 * Anything that restricts the use, however it is spelled.
 *
 * Checked BEFORE the allow-list, and that ordering is the whole point: "CC
 * BY-NC-ND 4.0" contains "cc by" and would otherwise pass the very test that
 * exists to stop it.
 *
 * A bare "Attribution" used to be on the allow-list and is not any more, for
 * the same reason: "Attribution required — editorial use only" contains it,
 * carries neither an NC nor an ND token, and is not a licence this may build
 * on. A licence that does not name Creative Commons or the public domain is
 * one the search did not really identify.
 */
const RESTRICTED =
  /\bnc\b|noncommercial|non-commercial|\bnd\b|noderiv|editorial|rights reserved|royalty|watermark|personal use/;

export function mayReuse(license: string | undefined): boolean {
  if (!license) return false;
  const l = license.toLowerCase();
  if (RESTRICTED.test(l)) return false;
  return REUSABLE_LICENCES.some((ok) => l.includes(ok));
}

/**
 * Words a filename search can match. NOT the brief.
 *
 * Measured against Wikimedia Commons, which is a keyword search over file
 * titles and descriptions rather than anything semantic. The whole artist
 * brief returned ZERO openly licensed candidates for eleven of twelve real
 * briefs; the subject alone returns a dozen for most of them.
 *
 * The stop words are PARTICIPLES, not prepositions. "showing", "with" and
 * "used" begin the artist's staging notes; "in" and "at" are usually part of
 * the subject's own name — "leaf in cross section" finds nine and "leaf"
 * finds a hedge, "Moon at full phase" finds eleven and "Moon" finds a lot of
 * things that are not it.
 *
 * Everything after a stop word is the artist being told how the thing is
 * posed, cut or arranged, and a filename search has no idea what to do with
 * it: "simple pendulum hanging from a stand" finds nothing usable and "simple
 * pendulum" finds six; "an ammeter used in a school laboratory" nothing and
 * "ammeter" plenty. Those details are what the VERIFIER is for.
 *
 * And no "unlabelled photograph" hint. It reads like an instruction and lands
 * as two more required keywords, which is the opposite of what it was for.
 */
const STOPS =
  /,|;|\b(?:showing|displaying|with|seen|used|hanging|standing|held|placed|viewed|drawn|labelled|labeled|so that|such that|next to|beside)\b/i;
const LEADING_ARTICLE = /^(?:an?|the)\s+/i;

export const MAX_QUERY_WORDS = 5;

export function searchQuery(brief: PictureBrief): string {
  const head = brief.brief.replace(/\s+/g, ' ').trim().split(STOPS)[0] ?? '';
  return head
    .replace(LEADING_ARTICLE, '')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, MAX_QUERY_WORDS)
    .join(' ');
}

export const VERIFIER_SYSTEM = `You look at one picture and say whether it is
the picture a lesson asked for. You are the last check before it goes on a
board in front of a child, and a wrong yes is worse than any no.

Answer with JSON and nothing else:

{"saw":"<what the picture actually shows, in a few words>",
 "right":true|false,
 "text":true|false,
 "count":<how many of the subject are in it>,
 "safe":true|false,
 "photo":true|false}

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
- "safe" is true ONLY if a class of school children, aged 11 to 18, may be
  shown it. False for blood, a wound or injury, surgery, an autopsy or a dead
  body, an organ cut out of a body, nudity, violence or a weapon, or anything
  meant to frighten. A model, a drawing, or a clean photograph of a living
  thing, a place or an object is fine.
- "photo" is true ONLY if it is a photograph of a real thing (a real model
  counts). False for a drawing, an illustration, a cartoon, a pictogram, an
  icon, a diagram, a chart or a computer render.

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
  /** Whether a class of children may be shown it. Absent is a no. */
  safe: boolean;
  /** Whether it is a photograph of a real thing. Absent is a no. */
  photo: boolean;
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
  const no: Verdict = { right: false, hasText: false, count: 0, safe: false, photo: false, saw: '' };
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
    // Unlike the count, NOT given the benefit of the doubt: a reply that did
    // not say a picture is fit for a class has not said it.
    safe: o.safe === true,
    photo: o.photo === true,
    saw: typeof o.saw === 'string' ? o.saw : '',
  };
}

/** Why a candidate was turned down, in words a prep report can print. */
export function refusalFor(
  v: Verdict,
  rules: Pick<FindOptions, 'allowText' | 'photoOnly' | 'allowMany'> = {},
): string | null {
  if (!v.right) return v.saw ? `it is ${v.saw}` : 'it is not the subject';
  if (!v.safe) return v.saw ? `it is not for a school child (${v.saw})` : 'it is not for a school child';
  if (rules.photoOnly && !v.photo) return v.saw ? `it is not a photograph (${v.saw})` : 'it is not a photograph';
  if (v.hasText && !rules.allowText) return 'it has words printed on it';
  if (v.count >= 2 && !rules.allowMany) return `it has ${v.count} of the subject in it`;
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
  /** How long one look may take before it counts as a refusal. */
  lookTimeoutMs?: number;
  /**
   * Take a picture with words in it. The no-words rule is for a picture she
   * labels part by part, whose printed labels would fight hers; a placed
   * thing's photograph has none written on it, and a street sign or a race
   * number behind a runner is no reason to refuse it (heart class,
   * 2026-10-08). Commons' rules keep watermarks off its files.
   */
  allowText?: boolean;
  /**
   * Take only a photograph of the real thing. A placed thing's picture stands
   * in for an icon, and the first "running person" the search found was a
   * stick-figure pictogram — the very cartoon Aarav's rule replaces (heart
   * class, 2026-10-08).
   */
  photoOnly?: boolean;
  /**
   * Take a picture with several of the subject in it. One-of-the-subject is
   * for a picture she marks part by part; a placed thing's photograph of a
   * race of runners is still a picture of running (heart class, 2026-10-08).
   */
  allowMany?: boolean;
}

export const DEFAULT_TRIES = 3;
/**
 * How many results to look at for a photograph only (`photoOnly`). More than
 * for a picture: a keyword search on file names is crowded with posters, film
 * stills and drawings, and the heart class's "running person" had its first
 * real photograph of one fifth in the list (2026-10-08). They are looked at in
 * waves of DEFAULT_TRIES, and a passing wave ends the search.
 */
export const PHOTO_TRIES = 6;

/**
 * A file whose own name says it is not a photograph. Dropped before it costs
 * a download and a look, when only a photograph will do: the names Commons
 * gives its drawings, posters, pictograms and material textures.
 */
const NOT_A_PHOTO =
  /poster|pictogram|icon|logo|diagram|drawing|illustration|clip.?art|cartoon|caricature|painting|engraving|lithograph|etching|woodcut|sketch|\bmap\b|_map_|chart|texture|_8k_|\bsvg\b|coat.of.arms|\bflag\b/i;
export const DEFAULT_SEARCH_LIMIT = 12;
/**
 * A minute. A vision call has been seen to hang for more than five (board
 * composer, 2026-10-06), and the class waits on this rung: a look that has
 * not answered by now is a refusal, and the ladder moves on.
 */
export const LOOK_TIMEOUT_MS = 60_000;

const NO_ANSWER = 'the check did not answer in time';

/** A promise that settles, or a rejection with NO_ANSWER after `ms`. */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(NO_ANSWER)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

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
  /**
   * A PICTURE OF SOMETHING MOVING, MOVING (Aarav, 2026-10-07: "images ya
   * videos ya kuch or jo bhi ho").
   *
   * When the lesson is the movement itself — a heart pumping, a person
   * running — a short silent loop is looked for first, each judged by its
   * still exactly as a photograph is. Never for a picture with parts to point
   * at: nothing in a loop holds still to be circled. No loop passing, the
   * still photograph is looked for as always.
   */
  const limit = options.searchLimit ?? DEFAULT_SEARCH_LIMIT;
  if (brief.motion && brief.parts.length === 0 && web.searchVideo) {
    const loops = await firstThatPasses(
      brief,
      () => web.searchVideo!(searchQuery(brief), limit),
      'the video search could not be reached',
      web,
      eyes,
      options,
    );
    if (loops.found) return loops;
    const stills = await firstThatPasses(
      brief,
      () => web.search(searchQuery(brief), limit),
      'the image search could not be reached',
      web,
      eyes,
      options,
    );
    return { found: stills.found, refusals: [...loops.refusals.map((r) => `a video: ${r}`), ...stills.refusals] };
  }
  return firstThatPasses(brief, () => web.search(searchQuery(brief), limit), 'the image search could not be reached', web, eyes, options);
}

/** The best-ranked of a search's results that the eyes pass, or why none did. */
async function firstThatPasses(
  brief: PictureBrief,
  searching: () => Promise<readonly WebCandidate[]>,
  unreachable: string,
  web: WebImageAdapter,
  eyes: VisionAdapter,
  options: FindOptions,
): Promise<Search> {
  const tries = options.tries ?? (options.photoOnly ? PHOTO_TRIES : DEFAULT_TRIES);
  const refusals: string[] = [];

  let candidates: readonly WebCandidate[];
  try {
    candidates = await searching();
  } catch {
    return { found: null, refusals: [unreachable] };
  }

  // A loop keeps only the sources the class format keeps, and a loop left with
  // none is no loop at all.
  const usable = candidates
    .map((c) => (c.video ? { ...c, video: keepableVideo(c.video) } : c))
    .filter((c) => c.url && mayReuse(c.license) && (c.video === undefined || c.video.length > 0))
    .filter((c) => !options.photoOnly || !NOT_A_PHOTO.test(`${c.page ?? ''} ${c.title ?? ''}`));
  if (usable.length === 0) {
    refusals.push(
      candidates.length === 0
        ? 'the search found nothing'
        : `none of the ${candidates.length} results were licensed for reuse`,
    );
    return { found: null, refusals };
  }

  /**
   * THE BEST FEW, LOOKED AT TOGETHER.
   *
   * One after another, three refusals and the generation behind them took
   * six minutes for one picture (board composer, 2026-10-06). The looks do
   * not depend on each other, so up to `tries` are downloaded and looked at
   * at once, and the best-ranked that passes is kept. A wave whose downloads
   * failed spent no looks, and the next candidates take their places.
   */
  const lookMs = options.lookTimeoutMs ?? LOOK_TIMEOUT_MS;

  /**
   * Why a clip's middle fails, or null when every frame from it passes: the
   * right subject, and fit for a class of children. A frame that cannot be
   * fetched or looked at fails the clip — a part of it nobody saw is a part
   * that might show anything. Printed text and a second subject are allowed
   * here: a caption over a moment, or two hearts in one frame, are not reasons
   * to refuse a clip whose still already passed on them.
   */
  const framesRefusal = async (frames: readonly string[]): Promise<string | null> => {
    const verdicts = await Promise.all(
      frames.map(async (frame) => {
        try {
          const still = await web.fetch(frame);
          if (!still || !still.startsWith('data:image/')) return null;
          return parseVerdict(await within(eyes.look(still, VERIFIER_SYSTEM, verifierUser(brief)), lookMs));
        } catch {
          return null;
        }
      }),
    );
    for (const v of verdicts) {
      if (!v) return 'a frame from its middle could not be looked at';
      if (!v.safe) return v.saw ? `a frame in it is not for a school child (${v.saw})` : 'a frame in it is not for a school child';
      if (!v.right) return v.saw ? `a frame in it is ${v.saw}` : 'a frame in it is not the subject';
    }
    return null;
  };

  let looked = 0;
  let next = 0;
  while (looked < tries && next < usable.length) {
    // At most DEFAULT_TRIES at once: a longer search (PHOTO_TRIES) goes on in
    // a second wave only when the first found nothing.
    const wave = usable.slice(next, next + Math.min(DEFAULT_TRIES, tries - looked));
    next += wave.length;

    const seen = await Promise.all(
      wave.map(async (candidate) => {
        let src: string | null = null;
        try {
          src = await web.fetch(candidate.url);
        } catch {
          src = null;
        }
        // A download that failed cost no vision call, so it does not spend a
        // try: a dead link is not the search being wrong about the picture.
        if (!src || !src.startsWith('data:image/')) return null;

        try {
          const verdict = parseVerdict(await within(eyes.look(src, VERIFIER_SYSTEM, verifierUser(brief)), lookMs));
          const refusal = refusalFor(verdict, options);
          if (refusal !== null || !candidate.frames?.length) return { candidate, src, refusal };
          // A clip: every frame looked at from its middle must pass as well.
          return { candidate, src, refusal: await framesRefusal(candidate.frames) };
        } catch (error) {
          const late = error instanceof Error && error.message === NO_ANSWER;
          return { candidate, src, refusal: late ? NO_ANSWER : 'it is not the subject' };
        }
      }),
    );

    let kept: { candidate: WebCandidate; src: string } | null = null;
    for (const look of seen) {
      if (!look) continue;
      looked += 1;
      if (look.refusal !== null) refusals.push(look.refusal);
      else if (!kept) kept = look;
    }
    if (!kept) continue;
    const { candidate, src } = kept;

    // It is the right picture. Now find out where its parts are — the same
    // second look a generated picture gets, and for the same reason: layout
    // owns every coordinate on the board, this owns only what is true inside
    // one image, and that can only be learned by looking at the image itself.
    let parts: ReturnType<typeof parseParts> = [];
    if (brief.parts.length > 0) {
      try {
        parts = parseParts(
          await within(eyes.look(src, PART_FINDER_SYSTEM, partFinderUser(brief.parts)), lookMs),
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
        credit: creditOf(candidate),
        ...(candidate.video ? { video: candidate.video } : {}),
      },
      refusals,
    };
  }

  return { found: null, refusals };
}
