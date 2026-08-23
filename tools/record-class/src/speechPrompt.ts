import { TUTOR } from '../../../packages/persona/src/traits.ts';

/**
 * THE TEXT PART OF EVERY TTS CALL.
 *
 * Gemini TTS has no style parameter: tone, pacing and accent are steered by
 * prose sitting in the same text part as the transcript. That makes this
 * function the tutor's voice. The recorded class and any line the runtime
 * synthesises must be built by the same function from the same persona, or a
 * student hears one teacher in the recording and a slightly different one the
 * moment they raise a hand — which is precisely the seam this product exists
 * to hide.
 *
 * The preamble line and the explicit "### TRANSCRIPT" label are not decoration.
 * Google documents that a vague prompt can make the model read the director's
 * notes aloud or reject the request outright, and names both of these as the
 * mitigation. Short, bland narration lines are exactly the vague prompts that
 * trip it, and a lesson is dozens of them.
 *
 * COUPLING: when packages/voice ships buildSpeechPrompt, this file becomes a
 * re-export of it. Two copies of the tutor's voice is two tutors.
 */

export interface SpeechContext {
  /** The lesson's own title, e.g. "Blood & Its Components". */
  lessonTitle: string;
  /** The beat's topic label, e.g. "What blood is". */
  beatTopic: string;
}

export function buildSpeechPrompt(narration: string, ctx: SpeechContext): string {
  return [
    'Synthesize speech for the transcript below. Do not read these instructions aloud.',
    `# AUDIO PROFILE: ${TUTOR.name}`,
    `## ${TUTOR.voice}`,
    '## THE SCENE',
    `A quiet classroom. She is at the board teaching "${ctx.lessonTitle}", and this moment`,
    `is about "${ctx.beatTopic}". One student is listening. There is no hurry and no`,
    'audience - nothing to prove, only to explain.',
    "### DIRECTOR'S NOTES",
    'Style: Warm and encouraging, with a vocal smile. Patient, never condescending.',
    'Pacing: Unhurried. A beat of silence after each new term so it lands.',
    'Accent: Indian English as spoken by an educated schoolteacher in Delhi - clear,',
    'natural Indian English, not anglicised and not a caricature.',
    '### TRANSCRIPT',
    narration.trim(),
  ].join('\n');
}
