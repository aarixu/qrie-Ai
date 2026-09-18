// DRIVER: rules — the one that always runs.
//
// Text in, measured duration in, canonical timeline out. No audio is read, no
// model is loaded, no network is touched, no licence is engaged. If every
// other option in avatar-3.md LAYER 1 became unavailable tomorrow, this still
// produces a mouth.
//
// It re-anchors at every sentence (see sentences.mjs for why that matters),
// so the drift that a rule table accumulates is bounded by one sentence
// rather than by one lesson.
//
// AND IT REFUSES TEXT IT CANNOT READ. The table reads Latin letters, so a beat
// written in Devanagari produces no shapes at all — every character falls into
// the pause branch and the "timeline" is one idle cue holding a SHUT mouth for
// the whole clip. That is a valid timeline by every structural check there is,
// which is exactly what makes it dangerous: it passes validateTimeline, it
// passes a length check, and it ships a tutor who never opens her mouth. An
// empty array is this driver's refusal, and a mouth that never opens is a
// refusal that has to be spelled that way rather than returned as an answer.

import { SHUT_SHAPES, normaliseCues } from './format.mjs';
import { textToUnits } from './rules.mjs';
import { allocate, scaleUnits } from './scale.mjs';
import { splitSentences } from './sentences.mjs';

/**
 * @param {string} text narration script for the clip
 * @param {number} durationSec measured clip length
 * @param {{leadMs?:number}} [options]
 *   leadMs — shift the whole timeline EARLIER by this many milliseconds.
 *     Animators lead the mouth ahead of the sound, and a build-step pipeline
 *     can do it because it can see the future (avatar-3.md, opening).
 *     Defaults to 0 here: leading is an art decision that wants a human eye
 *     on a rendered mouth, and this tool has not earned a default for it.
 * @returns {Array<{t:number,d:number,v:string}>} empty when there is no text,
 *   no clock, or no letter this table can read — all three are refusals.
 */
export function alignByRules(text, durationSec, options = {}) {
  const { leadMs = 0 } = options;
  const sentences = splitSentences(text);
  if (sentences.length === 0 || !(durationSec > 0)) return [];

  const perSentence = sentences.map((s) => textToUnits(s));

  // Nothing that moves the mouth means the table could not read this script.
  // See the header: returning the all-idle timeline would be worse than
  // returning nothing, because nothing downstream can tell the two apart.
  const moves = perSentence.some((units) => units.some((u) => !SHUT_SHAPES.has(u.v)));
  if (!moves) return [];

  const weights = perSentence.map((units) => units.reduce((sum, u) => sum + u.w, 0));
  const spans = allocate(weights, durationSec);

  const raw = [];
  let cursor = 0;
  for (let i = 0; i < perSentence.length; i++) {
    for (const cue of scaleUnits(perSentence[i], { start: cursor, duration: spans[i] })) {
      raw.push({ start: cue.t - leadMs / 1000, end: cue.t + cue.d - leadMs / 1000, value: cue.v });
    }
    cursor += spans[i];
  }

  return normaliseCues(raw, { duration: durationSec });
}
