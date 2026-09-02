import type { Lesson } from "@ai-tutor/lesson-format";
import { relayFetch } from './relay';
import {
  drawMissingIcons,
  pickIcons,
  prepareClass,
  type LlmAdapter,
  type PrepProgress,
  type PrepReport,
} from "@ai-tutor/class-prep";
import { createBrowserLlm } from "./browserLlm";
import { createBrowserImageArtist, createBrowserVision } from "./browserImage";

/**
 * PREPARING ONE CLASS, LIVE.
 *
 * The recipe for turning a cold topic into a class that can be taught: plan
 * it, draw what it needs, find pictures for the nouns it places. It lives here
 * rather than in the screen that first used it because there are two callers
 * now — the canvas lab, which is how the board is verified, and the classroom
 * itself. Two copies of a four-model recipe would drift, and the lab would
 * stop being evidence about the room.
 */

/**
 * Both jobs run on gemini-3.7-flash — measured as fastest AND best on this
 * exact prompt pair (plan 13.7s Rs 0.74, draw 25.9s Rs 1.51; the pro model was
 * four times slower, eight times dearer, and drew a worse diagram).
 */
const PLANNER_MODEL = 'google/gemini-3.7-flash';
const ARTIST_MODEL = 'google/gemini-3.7-flash';
/** Picks which meaning of a word to draw. One small call, so the fastest model. */
const PICKER_MODEL = 'google/gemini-3.1-flash-lite';
/**
 * Draws a picture of a real thing on white — a kidney, a cross-section.
 *
 * Measured on a half-cut kidney: 11s and about Rs 5.75, against Rs 2.25 for
 * the whole class without one. So it is worth it exactly when the subject has
 * to LOOK right, which is why the planner is told to earn it.
 */
const IMAGE_MODEL = 'google/gemini-3.1-flash-image';
/** Looks at a generated picture to find where its named parts are. */
const VISION_MODEL = 'google/gemini-3.7-flash';

/**
 * The pictures for the nouns a lesson places.
 *
 * Fetched from our own origin because the icon sets are a 443 MB package that
 * must never reach a browser: the dev server holds them and answers for the
 * handful one class needs. A noun no set has comes back as a pencilled circle
 * with the word in it, so the board is never blank and never wrong.
 */
/**
 * The pictures for the nouns a lesson places.
 *
 * Two steps, because the first one cannot be trusted on its own. The dev server
 * searches the bundled icon sets by name and returns every plausible candidate;
 * a model then picks which one the LESSON means. String matching put an
 * armoured vehicle on a board about water tanks, and no better matching fixes
 * that — "tank" is two things and only the topic says which.
 *
 * The choice never blocks the class: if the model fails, each noun keeps the
 * best name match, which is exactly what it had before.
 */
async function fetchGraphics(
  lesson: Lesson,
  topic: string,
  llm: LlmAdapter,
  /** Draws the nouns nothing depicts. A stronger model than the picker. */
  drawIcon: LlmAdapter,
): Promise<Record<string, string>> {
  const nouns = [
    ...new Set(lesson.elements.filter((el) => el.kind === 'graphic').map((el) => el.noun)),
  ];
  if (nouns.length === 0) return {};

  // One parameter per noun. Joined with commas, a noun containing one was
  // torn in half and quietly lost both its lookup and its fallback.
  const query = new URLSearchParams();
  for (const noun of nouns) query.append('noun', noun);
  const res = await relayFetch(`/api/icons?${query}`);
  if (!res.ok) return {};

  type Glyph = { body: string; width: number; height: number };
  type Found = {
    candidates: { glyph: Glyph; source: { set: string; icon: string }; category?: string }[];
    pencil: Glyph;
  };
  const found = (await res.json()) as Record<string, Found>;

  const options = Object.fromEntries(
    Object.entries(found).map(([noun, f]) => [
      noun,
      f.candidates.map((c) => ({
        icon: c.source.icon,
        set: c.source.set,
        ...(c.category ? { category: c.category } : {}),
      })),
    ]),
  );
  const chosen = await pickIcons(topic, options, llm);

  /**
   * The picked glyph, or null when this noun has no picture worth using —
   * the model refused every option, or nothing was found at all.
   *
   * The order matters: a deliberate null falling through to candidates[0]
   * once put the very icon the model refused — a military tank — back on a
   * board about water.
   */
  const glyphFor = (noun: string): Glyph | null => {
    const f = found[noun];
    if (!f) return null;
    const pick = chosen[noun];
    if (pick?.deliberate) {
      const named =
        pick.icon && pick.set
          ? f.candidates.find((c) => c.source.icon === pick.icon && c.source.set === pick.set)
          : undefined;
      return named?.glyph ?? null;
    }
    return f.candidates[0]?.glyph ?? null;
  };

  // The nouns nothing depicts get DRAWN — a small flat SVG made to order, the
  // way a code-drawing model makes a chart with code instead of pixels. Only
  // the misses cost anything; the library answered the rest for free. What
  // fails to draw falls back to the pencilled circle, never delays the class.
  const missing = nouns.filter((n) => glyphFor(n) === null);
  const drawn =
    missing.length > 0 ? await drawMissingIcons(topic, missing, drawIcon) : {};

  const assets: Record<string, string> = {};
  for (const el of lesson.elements) {
    if (el.kind !== 'graphic') continue;
    const custom = drawn[el.noun];
    if (custom) {
      // Keyed by ELEMENT id, not by noun: the same noun placed twice is two
      // pictures, and the renderer looks each one up by its own id.
      assets[el.id] = custom;
      continue;
    }
    const glyph = glyphFor(el.noun) ?? found[el.noun]?.pencil;
    if (!glyph) continue;
    assets[el.id] =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${glyph.width} ${glyph.height}">` +
      `${glyph.body}</svg>`;
  }
  return assets;
}

/** Everything a class needs to be taught, made just now rather than fetched. */
export interface LivePrep {
  lesson: Lesson;
  /** Artwork by element id: SVG markup, or a picture as a data URL. */
  assets: Record<string, string>;
  report: PrepReport;
}

/**
 * Plan the class, draw it, and dress its nouns.
 *
 * The pictures are a second, much cheaper fetch than the plan, and they never
 * take the class down with them: the icon relay went down once mid-session and
 * a fully prepared lesson was thrown away with it, which is the opposite of
 * what this path promises. A noun with no picture is a gap; a thrown error
 * here would be a class nobody gets to attend.
 */
export async function prepareLiveClass(
  ask: {
    topic: string;
    klass: number;
    minutes: number;
    studentLines?: readonly string[];
    /**
     * How a REAL teacher being cloned teaches (styleBrief). Absent for every
     * ordinary class - Curie own tutor has a persona of her own.
     */
    teacherStyle?: string;
  },
  onProgress: (progress: PrepProgress) => void,
): Promise<LivePrep> {
  const result = await prepareClass({
    topic: ask.topic,
    ...(ask.teacherStyle ? { teacherStyle: ask.teacherStyle } : {}),
    klass: ask.klass,
    minutes: ask.minutes,
    studentLines: ask.studentLines,
    planner: createBrowserLlm(PLANNER_MODEL, { json: true }),
    artist: createBrowserLlm(ARTIST_MODEL),
    imageArtist: createBrowserImageArtist(IMAGE_MODEL),
    eyes: createBrowserVision(VISION_MODEL),
    onProgress,
  });

  let graphics: Record<string, string> = {};
  try {
    graphics = await fetchGraphics(
      result.lesson,
      ask.topic,
      createBrowserLlm(PICKER_MODEL, { json: true }),
      createBrowserLlm(ARTIST_MODEL),
    );
  } catch {
    // The board shows what it has.
  }

  return { lesson: result.lesson, assets: { ...result.assets, ...graphics }, report: result.report };
}
