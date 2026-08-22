import type { DoubtContext } from './context';

/**
 * STUB — replaced by the doubt-session builder.
 *
 * Bridging lines are what make the recording↔live seam invisible. Hinglish,
 * a few variants each, chosen deterministically from ctx.beatId (so tests can
 * assert them). Entry acknowledges the pause and the current topic; exit hands
 * back to the recording naturally.
 */
export function entryLine(_ctx: DoubtContext): string {
  throw new Error('@ai-tutor/doubt-session entryLine: not implemented yet');
}

export function exitLine(_ctx: DoubtContext): string {
  throw new Error('@ai-tutor/doubt-session exitLine: not implemented yet');
}
