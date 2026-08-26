/**
 * The lesson format — the contract of the whole product.
 *
 * A lesson is a timeline of BEATS over a set of canvas ELEMENTS. Both sides of
 * the product speak this format and nothing else:
 *
 *   - The FACTORY (tools/design-lesson) emits it: an LLM composes elements and
 *     beats from this closed vocabulary. It cannot emit arbitrary drawings or
 *     code, so a generated lesson can never render garbage.
 *   - The CLASSROOM (packages/player + packages/stage) consumes it.
 *   - The DOUBT AGENT recalls any moment of the class by beat id, because a
 *     beat fully describes what is on screen at that moment.
 *
 * Coordinates live in a fixed 1000x620 canvas space, scaled to fit the device.
 */

export interface Point {
  x: number;
  y: number;
}

/** Visual tone. The renderer maps these to theme colors — content never picks hex codes. */
export type Tone = 'neutral' | 'good' | 'bad' | 'accent';

export type Element =
  | { kind: 'title'; id: string; x: number; y: number; text: string; sub?: string }
  | { kind: 'text'; id: string; x: number; y: number; text: string; size?: number; muted?: boolean }
  | { kind: 'note'; id: string; x: number; y: number; w: number; text: string; tone?: Tone }
  | { kind: 'box'; id: string; x: number; y: number; w: number; h: number; label: string; tone?: Tone }
  | { kind: 'doc'; id: string; x: number; y: number; w: number; h: number; label?: string; lines?: number }
  | { kind: 'arrow'; id: string; from: Point; to: Point; label?: string; dashed?: boolean; tone?: Tone }
  | { kind: 'pen'; id: string; points: Point[]; tone?: Tone }
  | { kind: 'formula'; id: string; x: number; y: number; text: string }
  | { kind: 'image'; id: string; x: number; y: number; w: number; h: number; src: string; alt: string; label?: string }
  | { kind: 'model3d'; id: string; x: number; y: number; w: number; h: number; asset?: string; label?: string };

export type ElementKind = Element['kind'];

export interface Beat {
  /** Stable id. The doubt agent recalls a moment of the class by this id. */
  id: string;
  /** Plain-language label of this moment, so the agent can name it to a student. */
  topic: string;
  /** What the tutor says during this beat. Spoken by TTS, shown as captions. */
  narration: string;
  /**
   * The COMPLETE set of element ids visible during this beat (not a delta).
   * Complete-set semantics is what makes recall trivial: any beat's canvas can
   * be reconstructed from that beat alone.
   */
  show: string[];
  /** Element ids emphasised during this beat. Must be a subset of `show`. */
  focus?: string[];
  /**
   * Learning Outcome Map node ids this beat TEACHES — the outcomes a student
   * should hold afterwards that they may not have held before.
   *
   * This is the field that turns a lesson from a video into a measurement.
   * Without it a finished lesson is a tick against a lesson id and a raised
   * hand puts a whole chapter under suspicion. With it, finishing raises belief
   * on exactly these outcomes, a hand raised here names exactly what confused
   * the student, and the beat that collects doubts all term names the outcome
   * the factory should rewrite.
   *
   * Beats that teach nothing new leave it empty, and that is a real answer, not
   * a gap: a hook earns attention and a recap retrieves what is already there.
   * Neither should raise belief in anything.
   *
   * Optional because five lessons were authored before the map existed. New
   * lessons are expected to carry it; see `pedagogyErrors`.
   */
  teaches?: string[];
  /**
   * Node ids this beat CHECKS rather than teaches — a question about something
   * already covered. Kept separate from `teaches` because a check that raised
   * belief would be a test that grades itself.
   */
  checks?: string[];
  /** Minimum time on this beat even if narration finishes sooner. */
  minMs?: number;
}

export interface Lesson {
  formatVersion: 1;
  id: string;
  title: string;
  subtitle?: string;
  /** 'en' = English (the product default). 'hi-en' (Hinglish) stays valid for future regional variants. */
  language: 'hi-en' | 'en';
  /** Optional back-reference to the syllabus topic this lesson teaches. */
  topicRef?: string;
  /** Fixed canvas coordinate space. Always 1000x620 in format v1. */
  canvas: { w: number; h: number };
  elements: Element[];
  beats: Beat[];
}

export const CANVAS_W = 1000;
export const CANVAS_H = 620;
