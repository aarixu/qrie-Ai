// THE ONE FORMAT, AND THE ONLY PLACE THAT IS ALLOWED TO PRODUCE IT.
//
// ============================================================================
//   [{ t: 1.240, d: 0.085, v: "D" }, ...]   start, duration, mouth shape.
//
// docs/research/avatar-3.md:208 fixes this shape and explains why it is the
// real deliverable of the whole avatar decision: it is renderer-agnostic and
// vendor-agnostic ON PURPOSE. Sprites today, Rive later, and the alignment
// pipeline never changes. Nothing downstream may invent a second spelling of
// it, because the moment two exist the renderer choice and the aligner choice
// are welded together again.
// ============================================================================
//
// WHY normaliseCues EXISTS AND IS NOT OPTIONAL: the aligner this repo
// actually ran does not emit a clean timeline. rhubarb-lip-sync-wasm@0.1.8,
// run over content/class10-blood/audio/hook.m4a, returned cues that OVERLAP
// one another — measured, in docs/research/lipsync-hinglish-result.md, with
// the offending cues quoted. A renderer stepping through that array would be
// told to draw two mouths at the same instant, which is not a thing a face
// does. The overlap is resolved here, once, rather than in every consumer.

/**
 * The nine mouth shapes. This list IS the illustrator's commission brief —
 * Rhubarb's six Hanna-Barbera basics plus its three extended shapes
 * (avatar-3.md:191). Nine drawings over one locked face; nothing else about
 * the character is decided by this pipeline.
 */
export const MOUTH_SHAPES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X'];

/**
 * WHY THE NOTES LIVE IN CODE. Nine letters is not a brief. The descriptions
 * are what an illustrator is paid against, and Rhubarb's own documentation
 * adds one constraint that is easy to lose and expensive to rediscover: C and
 * E double as in-betweens, so A->C->D and C->E->F must read smoothly when
 * swapped at speed. That constraint is the entire art direction, and it is
 * free.
 */
export const SHAPE_NOTES = {
  A: 'shut — P, B, M. The only shape an audience notices consciously.',
  B: 'slightly open, teeth clenched — most consonants, and the EE vowel.',
  C: 'open — EH, AE. Doubles as the in-between from A to D.',
  D: 'wide open — AA. The widest the jaw goes.',
  E: 'slightly rounded — AO, ER. Doubles as the in-between from C to F.',
  F: 'puckered — UW, OW, W.',
  G: 'upper teeth on lower lip — F, V. Extended shape.',
  H: 'tongue raised behind the upper teeth — a long L. Extended shape.',
  X: 'relaxed idle, mouth shut. What the face does between words. Extended shape.',
};

/** The two shapes in which no part of the mouth interior is showing. */
export const SHUT_SHAPES = new Set(['A', 'X']);

const SHAPE_SET = new Set(MOUTH_SHAPES);
const IDLE = 'X';

const toMs = (seconds) => Math.round(seconds * 1000);
const toSec = (ms) => Math.round(ms) / 1000;

/**
 * Turn a raw aligner's {start, end, value} cues into the canonical
 * {t, d, v} timeline: ordered, non-overlapping, gapless, and with runs of the
 * same shape collapsed into one cue.
 *
 * Everything is done in whole milliseconds. Doing it in floating-point
 * seconds leaves cues that end at 0.7699999999999999 and a "gap" of 1e-16
 * that then gets padded with a zero-length idle cue — a class of rubbish that
 * is invisible in a test and visible on a mouth.
 *
 * @param {Array<{start:number,end:number,value:string}>} raw
 * @param {{duration?:number, padStart?:boolean}} [options]
 *   duration  — clip length in seconds. Cues are clamped to it and the tail
 *               is padded with idle, so the renderer can always answer
 *               "what shape at t?" for any t inside the audio.
 *   padStart  — pad the gap before the first cue with idle. Default true.
 * @returns {Array<{t:number,d:number,v:string}>}
 */
export function normaliseCues(raw, options = {}) {
  const { duration, padStart = true } = options;
  const limitMs = typeof duration === 'number' ? toMs(duration) : null;

  const cues = [];
  for (const cue of raw ?? []) {
    const v = cue.value ?? cue.v;
    if (!SHAPE_SET.has(v)) {
      // Dropping it silently would ship a timeline with a hole where a mouth
      // should be, and the hole would be found by a child, not by a test.
      throw new Error(`unknown mouth shape ${JSON.stringify(v)} — the nine are ${MOUTH_SHAPES.join('')}`);
    }
    let start = toMs(cue.start ?? cue.t ?? 0);
    let end = toMs(cue.end ?? (cue.t ?? 0) + (cue.d ?? 0));
    if (limitMs !== null) {
      start = Math.min(Math.max(start, 0), limitMs);
      end = Math.min(Math.max(end, 0), limitMs);
    } else {
      start = Math.max(start, 0);
      end = Math.max(end, 0);
    }
    if (end > start) cues.push({ start, end, v });
  }

  // Sort by start, then by end. A cue that starts later wins its own span:
  // the aligner emitting an overlap has told us about a shape change at that
  // instant, and the later shape is the newer information.
  cues.sort((a, b) => a.start - b.start || a.end - b.end);

  // Resolve the overlaps by PAINTING rather than by clipping each cue against
  // the one after it. The difference only shows when an early cue ENCLOSES a
  // later one — clipping would end the enclosing cue at the nested cue's start
  // and hand the rest of it to idle, so an open mouth would silently become a
  // shut one for the remainder of the span. Painting keeps the tail.
  //
  // MEASURED, so nobody reads this as a bug report: rhubarb-lip-sync-wasm@0.1.8
  // over content/class10-blood/audio emits overlapping cues in quantity — 168
  // format violations, 170 overlapping pairs in 794 raw cues — and ZERO pairs
  // where one cue strictly encloses another. So painting and clipping produce
  // identical output on today's aligner. It is here because the contract is
  // what the renderer consumes, and the next aligner is not obliged to be as
  // tidy. Pinned in tests/format.test.ts.
  let painted = [];
  for (const cue of cues) {
    const kept = [];
    for (const seg of painted) {
      if (seg.end <= cue.start || seg.start >= cue.end) {
        kept.push(seg);
        continue;
      }
      if (seg.start < cue.start) kept.push({ start: seg.start, end: cue.start, v: seg.v });
      if (seg.end > cue.end) kept.push({ start: cue.end, end: seg.end, v: seg.v });
    }
    kept.push({ ...cue });
    painted = kept;
  }
  painted.sort((a, b) => a.start - b.start);
  const clipped = painted.filter((c) => c.end > c.start);

  // Fill the gaps (and, unless told otherwise, the lead-in) with idle, then
  // merge neighbouring cues that carry the same shape.
  const filled = [];
  let cursor = 0;
  for (const cue of clipped) {
    const wantLead = filled.length > 0 || padStart;
    if (wantLead && cue.start > cursor) filled.push({ start: cursor, end: cue.start, v: IDLE });
    filled.push(cue);
    cursor = cue.end;
  }
  if (limitMs !== null && cursor < limitMs && filled.length > 0) {
    filled.push({ start: cursor, end: limitMs, v: IDLE });
  }

  const merged = [];
  for (const cue of filled) {
    const last = merged[merged.length - 1];
    if (last && last.v === cue.v && last.end === cue.start) last.end = cue.end;
    else merged.push({ ...cue });
  }

  return merged.map((c) => ({ t: toSec(c.start), d: toSec(c.end - c.start), v: c.v }));
}

/**
 * Report everything wrong with a timeline, as sentences, rather than throwing
 * on the first one. A build step wants the whole list in one pass.
 *
 * @param {Array<{t:number,d:number,v:string}>} cues
 * @returns {string[]} empty when the timeline is clean
 */
export function validateTimeline(cues) {
  const problems = [];
  let previousEnd = null;
  cues.forEach((cue, i) => {
    if (!SHAPE_SET.has(cue.v)) problems.push(`cue ${i}: unknown mouth shape ${JSON.stringify(cue.v)}`);
    if (!(cue.d > 0)) problems.push(`cue ${i}: duration ${cue.d} is not positive`);
    if (!(cue.t >= 0)) problems.push(`cue ${i}: start ${cue.t} is negative`);
    if (previousEnd !== null && cue.t < previousEnd - 1e-9) {
      problems.push(`cue ${i}: overlaps the cue before it (starts ${cue.t}, previous ended ${previousEnd})`);
    }
    previousEnd = cue.t + cue.d;
  });
  return problems;
}

/**
 * The serialised size of a timeline. avatar-3.md:208 estimates "roughly 2 KB
 * per minute" — that is a claim about OUR output, so it is measurable, and
 * the report quotes the measurement rather than the estimate.
 */
export function timelineBytes(cues) {
  return Buffer.byteLength(JSON.stringify(cues), 'utf8');
}

/** The shape in force at a given instant; idle wherever the timeline is silent. */
export function shapeAt(cues, tSec) {
  for (const cue of cues) {
    if (tSec >= cue.t && tSec < cue.t + cue.d) return cue.v;
  }
  return IDLE;
}
