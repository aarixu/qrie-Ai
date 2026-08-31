/**
 * TEXT TO MOUTH SHAPES.
 *
 * The lipsync problem, stated honestly: the streaming voice gives us the LINE
 * being spoken and the sound's loudness, not phoneme timestamps. So the mouth
 * is driven by both — the TEXT decides the SHAPE (an O line rounds the lips,
 * an M presses them shut), the LOUDNESS decides how much of it shows. Wrong
 * per-phoneme by tens of milliseconds, and exactly the trick every classic
 * talking-photo engine shipped on, because at conversation distance the eye
 * checks shape-against-sound, not timestamps.
 *
 * Pure functions, no clock of their own: the component samples the timeline
 * with the audio element's currentTime, so sync self-corrects every frame.
 */

/** The five mouth shapes the warp can actually show, plus rest. */
export type Viseme = 'rest' | 'open' | 'wide' | 'round' | 'press' | 'teeth';

export interface VisemeStep {
  /** When this shape starts, in nominal ms from line start. */
  t: number;
  v: Viseme;
  /** How long it holds, nominal ms. */
  d: number;
}

const VOWEL_MS = 110;
const CONSONANT_MS = 65;
const GAP_MS = 90;

const shapeOf = (ch: string): Viseme | null => {
  if ('aáà'.includes(ch)) return 'open';
  if ('eiy'.includes(ch)) return 'wide';
  if ('ou'.includes(ch)) return 'round';
  if ('mbp'.includes(ch)) return 'press';
  if ('fv'.includes(ch)) return 'teeth';
  if ('cdghjklnqrstwxz'.includes(ch)) return 'open';
  return null; // spaces, digits, punctuation — handled by the caller
};

const isVowelShape = (v: Viseme): boolean => v === 'open' || v === 'wide' || v === 'round';

/**
 * A line of text becomes a timeline of mouth shapes.
 *
 * Repeated shapes merge (the "ll" in "yellow" is one gesture), consonant runs
 * are short, vowels long, and every space is a beat of rest — which is what
 * separates words visually and stops the mouth flapping like a flag.
 */
export function visemeTimeline(text: string): VisemeStep[] {
  const steps: VisemeStep[] = [];
  let t = 0;
  const push = (v: Viseme, d: number): void => {
    const last = steps[steps.length - 1];
    if (last && last.v === v) {
      last.d += d;
    } else {
      steps.push({ t, v, d });
    }
    t += d;
  };

  for (const raw of text.toLowerCase()) {
    const v = shapeOf(raw);
    if (v === null) {
      if (raw === ' ' || raw === ',' || raw === '.' || raw === '?' || raw === '!') push('rest', GAP_MS);
      continue;
    }
    push(v, isVowelShape(v) ? VOWEL_MS : CONSONANT_MS);
  }
  push('rest', GAP_MS);
  return steps;
}

/** Total nominal length, for scaling against the audio's real duration. */
export function nominalMs(steps: readonly VisemeStep[]): number {
  const last = steps[steps.length - 1];
  return last ? last.t + last.d : 0;
}

/**
 * The shape at a moment of real playback.
 *
 * `elapsedMs` is real audio time; the timeline is stretched to `actualMs`
 * (the audio's duration when known) so the last shape lands with the last
 * sound. Past the end, the mouth rests.
 */
export function sampleViseme(
  steps: readonly VisemeStep[],
  elapsedMs: number,
  actualMs?: number,
): Viseme {
  const total = nominalMs(steps);
  if (total === 0) return 'rest';
  const scale = actualMs && actualMs > 0 ? total / actualMs : 1;
  const t = elapsedMs * scale;
  if (t < 0 || t >= total) return 'rest';
  for (const step of steps) {
    if (t < step.t + step.d) return step.v;
  }
  return 'rest';
}
