import { buildSystemPrompt } from '@ai-tutor/persona';
import type { DoubtBrief, RecallableBeat } from './protocol.ts';

/**
 * THE BRIEF, TURNED INTO WORDS — and the guard on the one thing the model can
 * break from inside a sentence.
 *
 * Nothing here writes tutor prose. The whole system prompt comes out of
 * @ai-tutor/persona: this file only chooses the moment and the surface and
 * hands over the lesson facts. Three hand-written tutor prompts already drifted
 * apart in this repo once, which is why that package exists, and a live doubt
 * that sounds like a different teacher is exactly the seam we are trying to
 * hide.
 *
 * Pure and deterministic — no clock, no I/O, no LiveKit. It is the half of the
 * worker that can be tested.
 */

/**
 * DOUBT_OPENING, not DOUBT_ANSWERING: the model is briefed at the instant the
 * recording pauses, before anyone has said what the doubt is. Its guidance is
 * "invite the question and stop", which is the correct first turn; the answer
 * follows naturally once the student speaks.
 *
 * (If packages/doubt-session grows a brief module that composes the moments of
 * a whole doubt, this call is the one line to replace.)
 */
export function doubtInstructions(brief: DoubtBrief): string {
  return buildSystemPrompt({
    moment: 'DOUBT_OPENING',
    surface: 'voice',
    student: brief.student,
    lesson: {
      subject: brief.subject,
      title: brief.title,
      beatTopic: brief.beatTopic,
      transcriptSoFar: brief.transcriptSoFar,
      onScreen: brief.onScreen,
      recallableBeats: brief.recallableBeats,
    },
  });
}

/**
 * The beat with this id, or null. Every recall is checked against the list the
 * model was actually shown: a hallucinated id would either blank the board or
 * put a later part of the lesson on screen and spoil it.
 */
export function findRecallable(brief: DoubtBrief, beatId: string): RecallableBeat | null {
  return brief.recallableBeats.find((beat) => beat.id === beatId) ?? null;
}

/**
 * What the model is told when it asks for a beat that does not exist. It is
 * addressed to the model, not to the student, so it says plainly what happened
 * (nothing), what it may pick instead, and that carrying on without a diagram
 * is a legitimate choice — a tool error with no way forward makes a model
 * retry the same wrong id.
 */
export function recallRejection(brief: DoubtBrief, beatId: string): string {
  if (brief.recallableBeats.length === 0) {
    return 'There is nothing to bring back onto the board in this class yet, so the board has not changed. Carry on explaining in words.';
  }
  const ids = brief.recallableBeats.map((beat) => `"${beat.id}" (${beat.topic})`).join(', ');
  return `There is no moment with id "${beatId}" in this class, so the board has not changed. The ids you can show are: ${ids}. Show one of those, or carry on without a diagram.`;
}

/**
 * What the model is told after a successful recall. It names the topic because
 * the model cannot see the canvas — the Gemini Live plugin forwards no video —
 * so this string is its only knowledge of what the student is now looking at.
 */
export function recallConfirmation(beat: RecallableBeat): string {
  return `The board now shows "${beat.topic}". The student can see it. Say what you are showing them as you explain.`;
}
