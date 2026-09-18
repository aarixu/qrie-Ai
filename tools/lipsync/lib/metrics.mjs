// THE OBSERVABLE SIGNALS, AND NOTHING ELSE.
//
// ============================================================================
// THIS FILE DOES NOT COMPUTE ACCURACY, AND CANNOT.
//
// There is no hand-labelled ground truth for these clips. Nobody has sat with
// a waveform and written down which mouth shape is correct at t = 3.480, and
// until somebody does, "accuracy" is a word with no number behind it. An
// accuracy figure invented here would be the most quotable thing in the
// report and the only false one in it.
//
// What is observable, and all that is reported:
//   cueCount        how many mouth changes the recogniser asked for
//   meanDurationMs  how long it holds each one
//   shutFraction    how much of the clip the mouth spends closed
//   shapeHistogram  which of the nine it actually uses
//   disagreement    how often two recognisers name a different shape
//
// These are facts about the OUTPUT. They can tell you two pipelines behave
// alike, or that one of them is flapping, or that one never shuts the mouth
// on a language full of bilabials. They cannot tell you which one is right.
// ============================================================================

import { gzipSync } from 'node:zlib';

import { SHUT_SHAPES, shapeAt, timelineBytes } from './format.mjs';

const IDLE = 'X';

/**
 * The shape in force at each sample instant, sampled at the midpoint of each
 * frame so a cue boundary is never landed on exactly.
 *
 * @param {Array<{t:number,d:number,v:string}>} cues
 * @param {{rateHz:number, duration:number}} options
 * @returns {string[]}
 */
export function sampleTimeline(cues, { rateHz, duration }) {
  const n = Math.max(0, Math.round(duration * rateHz));
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = shapeAt(cues, (i + 0.5) / rateHz);
  return out;
}

/**
 * How often two timelines name a different shape, and how often they disagree
 * about the coarser question of whether the mouth is open at all.
 *
 * WHY BOTH NUMBERS: C and D are both open mouths. Picking the wrong open
 * shape is a small mistake that a stylised face absorbs. Showing a SHUT mouth
 * while the tutor is mid-vowel is the mistake a child notices, and it is
 * hidden inside the first number unless it is pulled out.
 */
export function disagreement(a, b, { rateHz, duration }) {
  const left = sampleTimeline(a, { rateHz, duration });
  const right = sampleTimeline(b, { rateHz, duration });
  const n = Math.min(left.length, right.length);
  if (n === 0) return { frameDisagreement: 0, openShutDisagreement: 0, sampleCount: 0 };

  let shape = 0;
  let openShut = 0;
  for (let i = 0; i < n; i++) {
    if (left[i] !== right[i]) shape++;
    if (SHUT_SHAPES.has(left[i]) !== SHUT_SHAPES.has(right[i])) openShut++;
  }
  return {
    frameDisagreement: shape / n,
    openShutDisagreement: openShut / n,
    sampleCount: n,
  };
}

/**
 * The per-clip signals.
 *
 * Time not covered by any cue counts as SHUT, not as missing: a renderer with
 * nothing to draw draws the idle mouth, so that is what the viewer sees and
 * that is what the number has to describe.
 *
 * @param {Array<{t:number,d:number,v:string}>} cues
 * @param {number} duration seconds
 */
export function clipMetrics(cues, duration) {
  const cueCount = cues.length;
  const totalCueTime = cues.reduce((sum, c) => sum + c.d, 0);
  const shutCueTime = cues.reduce((sum, c) => (SHUT_SHAPES.has(c.v) ? sum + c.d : sum), 0);
  const uncovered = Math.max(0, duration - totalCueTime);

  const shapeHistogram = {};
  for (const cue of cues) shapeHistogram[cue.v] = (shapeHistogram[cue.v] ?? 0) + 1;
  if (uncovered > 0) shapeHistogram[IDLE] = shapeHistogram[IDLE] ?? 0;

  const bytes = timelineBytes(cues);
  // Gzipped as well as raw, because every byte of this file reaches a student
  // over a gzipped connection and a raw figure would overstate what the phone
  // downloads. A timeline is repetitive JSON — nine shape letters and a lot of
  // short decimals — so the two numbers are far apart, and quoting only one
  // of them is quoting the convenient one.
  const gzipBytes = gzipSync(Buffer.from(JSON.stringify(cues), 'utf8')).length;
  return {
    cueCount,
    meanDurationMs: cueCount === 0 ? 0 : (totalCueTime / cueCount) * 1000,
    cuesPerSecond: duration > 0 ? cueCount / duration : 0,
    shutFraction: duration > 0 ? (shutCueTime + uncovered) / duration : 0,
    shapeHistogram,
    bytes,
    bytesPerMinute: duration > 0 ? (bytes / duration) * 60 : 0,
    gzipBytes,
    gzipBytesPerMinute: duration > 0 ? (gzipBytes / duration) * 60 : 0,
  };
}
