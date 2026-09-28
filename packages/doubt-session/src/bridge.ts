import type { DoubtContext } from './context';

/**
 * The bridging lines — the two sentences that stitch the recording and the
 * live agent into what feels like one continuous class. Entry acknowledges
 * the pause and names the topic the student just raised a hand on; exit hands
 * back to the recording as if the same teacher simply carried on.
 *
 * A few variants each so the seam doesn't sound canned over a whole lesson.
 * The choice is a pure hash of beatId: the same moment always gets the same
 * line, which is what lets tests assert the seam exactly.
 */

/** Small stable string hash. Not crypto — just deterministic variant spread. */
function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

const pick = <T>(variants: readonly T[], seed: string): T =>
  variants[hashOf(seed) % variants.length];

const ENTRY: readonly ((topic: string) => string)[] = [
  (t) =>
    `Yes, go ahead — good place to stop, actually. We were right in the middle of '${t}'. What's your doubt?`,
  (t) =>
    `One second, I've paused the class. We were just looking at '${t}' — tell me, where did you get stuck?`,
  (t) =>
    `Take your time, no hurry at all. '${t}' can feel a little tricky — ask me, what didn't make sense?`,
  (t) =>
    `Yes yes, ask away — that's exactly what I'm here for. We were on '${t}' — what would you like to know?`,
];

const EXIT: readonly string[] = [
  `All clear? Good. Let's pick the class back up right where we left it.`,
  `Makes sense now? Great. Let's continue from exactly where we stopped.`,
  `Alright, that doubt is sorted. Back to the lesson — same spot we paused at.`,
  `And if anything else comes up, just raise your hand again — I'm right here. Let's move on.`,
];

/**
 * The way out when a doubt reaches the turn cap (handoff.ts), said INSTEAD of
 * an exit line rather than before one. It does not claim the doubt is solved —
 * the cap knows how many turns were taken, not whether any of them landed — so
 * it offers the lesson as the next thing to try and the raised hand as still
 * open.
 */
const CLOSING: readonly string[] = [
  `We have talked this one through properly now. Let's go back to the class — it often clicks once you see the next part. Raise your hand again any time.`,
  `That was a good long look at it. Let's carry on with the class from where we paused, and if it still feels unclear, raise your hand again.`,
];

export function entryLine(ctx: DoubtContext): string {
  return pick(ENTRY, ctx.beatId)(ctx.beatTopic);
}

export function exitLine(ctx: DoubtContext): string {
  return pick(EXIT, ctx.beatId);
}

export function closingLine(ctx: DoubtContext): string {
  return pick(CLOSING, ctx.beatId);
}
