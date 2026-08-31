import type { Instruction, ScriptBeat } from '@ai-tutor/board-layout';

/**
 * WHAT WAS SAID BUT NEVER WRITTEN.
 *
 * "The board shows what you are saying" is a prompt rule, and the model
 * follows it four beats out of five. The fifth is what a teacher marked on a
 * real transcript: the spoken question whose ANSWER got written but not the
 * question, and a beat's closing line — "there is a force between particles" —
 * said over a board that gained nothing.
 *
 * A prompt asks; this CHECKS. Two rules, both deterministic, both taken
 * straight from that mark-up:
 *
 *   1. A `say` that asks a question is matched, in the same breath, by a
 *      written question — some ink that ends in a question mark. Not the
 *      answer; the question. The student is meant to sit with it.
 *   2. The LAST say of a beat writes something. The landing line is the key
 *      point, and a key point that is only heard is homework nobody can copy.
 *      Earlier says may be bare — a teacher talks to a blank board while
 *      setting a scene — but the landing is ink.
 *
 * The errors feed the same one-round repair every other validation failure
 * uses, so the model fixes exactly what is named and nothing else moves.
 */

const writtenTextOf = (step: Instruction): string => {
  switch (step.do) {
    case 'write':
    case 'note':
    case 'caption':
      return step.text;
    case 'card':
      return `${step.heading} ${step.body}`;
    case 'label':
      return step.text;
    case 'equation':
      return step.text;
    case 'list':
      return `${step.heading ?? ''} ${step.items.map((i) => `${i.term} ${i.meaning ?? ''}`).join(' ')}`;
    default:
      return '';
  }
};

export function saidButNotWritten(beats: readonly ScriptBeat[]): string[] {
  const errors: string[] = [];

  for (const beat of beats) {
    /** The instructions each say carries: everything up to the next say. */
    const stretches: { say: Extract<Instruction, { do: 'say' }>; after: Instruction[] }[] = [];
    for (const step of beat.board) {
      if (step.do === 'say') stretches.push({ say: step, after: [] });
      else stretches[stretches.length - 1]?.after.push(step);
    }
    if (stretches.length === 0) continue;

    for (const { say, after } of stretches) {
      if (!say.text.includes('?')) continue;
      const questionWritten = after.some((step) => writtenTextOf(step).includes('?'));
      if (!questionWritten) {
        errors.push(
          `${beat.id}: the line "${say.text.slice(0, 60)}…" asks a question, but no question is ` +
            `written on the board in that step. Write the question itself (a "write" or "note" ` +
            `ending in ?), then ask the student for the answer.`,
        );
      }
    }

    const landing = stretches[stretches.length - 1];
    // Landing means the board GAINED something — words, a drawing, a mark. A
    // final line that places the scene it just described has landed; only
    // `point`, which merely relights what is already there, does not count.
    if (!landing.after.some((step) => step.do !== 'point')) {
      errors.push(
        `${beat.id}: the beat's final say — "${landing.say.text.slice(0, 60)}…" — writes nothing. ` +
          `The line that lands a beat is its key point; put it on the board (a "write", "list" ` +
          `or "card") so the student can copy it.`,
      );
    }
  }

  return errors;
}

/**
 * "Involve them through question and answer — teach, don't make them recite."
 *
 * Aarav's rule, made structural after a class shipped without a single
 * question. The first beat must ask what they already know (that ask is the
 * opening's whole point), and every beat must carry at least one ask — a beat
 * in which nobody is asked anything is a beat being recited at.
 *
 * Feeds the same repair round as everything else, and like the rest of this
 * file it is never fatal: a class that still under-asks after repair runs,
 * and the report says so.
 */
export function classMustAsk(beats: readonly ScriptBeat[]): string[] {
  const errors: string[] = [];
  // Only beats that SPEAK are held to it: recitation happens in says, and a
  // legacy or synthetic beat with bare narration has no lines to hang an ask
  // on. The first speaking beat is the opening.
  const speaking = beats.filter((b) => b.board.some((step) => step.do === 'say'));
  speaking.forEach((beat, i) => {
    const asks = beat.board.filter((step) => step.do === 'ask').length;
    if (asks > 0) return;
    if (i === 0) {
      errors.push(
        `${beat.id}: the opening beat never asks what the student already knows. ` +
          `Its whole point is a real {"do":"ask"} — greet them, say what today builds, ` +
          `then ask and WAIT.`,
      );
    } else {
      errors.push(
        `${beat.id}: nobody is asked anything in this beat — it is being recited, not taught. ` +
          `Add one {"do":"ask"}: retrieve what was just taught, or ask for a prediction ` +
          `before the next reveal.`,
      );
    }
  });
  return errors;
}
