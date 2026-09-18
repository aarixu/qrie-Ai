// THE RULE TABLE — a recogniser with no model, no weights, no audio and no
// licence surface. avatar-3.md:1F calls it "cruder, but immune to language,
// immune to licensing, immune to tooling".
//
// THE FIRST OF THOSE THREE IS TOO STRONG, AND THE CORRECTION MATTERS FOR THIS
// PRODUCT: the table is immune to LANGUAGE and dependent on SCRIPT. It reads
// Latin letters. Romanised Hinglish — "khoon", "dekho", "samjho" — is simply
// input. Devanagari is not: every character falls through to the pause branch
// in textToUnits, so a whole beat of देवनागरी narration produces one idle
// shape and a mouth that never opens. That is a silent failure, so the driver
// refuses it (rules-driver.mjs) rather than returning it.
//
// LINEAGE, stated plainly because it is somebody else's idea: the approach is
// TalkingHead's lipsync-en.mjs (MIT, @met4citizen) — letter-to-sound rules in
// the lineage of NRL Report 7948 (1976), plus a per-shape relative duration
// table, scaled afterwards to a measured clip length. The rules here are
// WRITTEN rather than imported, for one reason: lipsync-en targets the 15
// Oculus visemes, and the thing this repo will pay an illustrator to draw is
// Rhubarb's NINE Hanna-Barbera shapes (avatar-3.md:191). Mapping 15 down to 9
// after the fact throws away the chance to pick the right one of the nine in
// the first place.
//
// ============================================================================
// WHAT THIS TABLE IS NOT: a pronunciation dictionary. English spelling is not
// a function of sound — "though", "through", "rough" and "cough" share four
// letters and no vowel — so this table is wrong, on purpose, and often. It is
// built to be wrong in the way a stylised cartoon mouth forgives: it spends
// its accuracy on the shapes a viewer consciously notices (lips SHUT on
// P/B/M, teeth on the lip for F/V, a pucker for W/OO) and shrugs at the
// difference between one open vowel and another.
//
// A photoreal face would be unwatchable driven by this. That trade is the
// whole reason the stylised route was chosen (avatar-3.md, LAYER 1).
// ============================================================================
//
// AND ON HINGLISH, which is the question this tool exists to answer: this
// table reads LATIN LETTERS, so ROMANISED Hindi is simply input — "khoon",
// "dekho", "samjho" all produce shapes and nothing throws. Whether those
// shapes match the sound is a separate matter, measured in
// docs/research/lipsync-hinglish-result.md, not asserted here. Text in any
// other script produces no shapes at all; readableFraction() below is how a
// caller finds that out before it reaches a renderer.

/**
 * Relative duration per shape, unitless. Vowel shapes are held longer than
 * consonant shapes because they are; the absolute numbers mean nothing until
 * scale.mjs divides a measured clip length among them.
 *
 * These weights are hand-set in the spirit of lipsync-en's own per-viseme
 * table (aa 0.95, PP 1.08, SS 1.23 ...). They are NOT measured from this
 * repo's audio, and nothing here claims they are.
 */
export const SHAPE_WEIGHT = {
  A: 0.95,
  B: 0.9,
  C: 1.05,
  D: 1.15,
  E: 1.05,
  F: 1.1,
  G: 1.0,
  H: 0.95,
  X: 1.0,
};

/**
 * How long the mouth rests at each kind of break. This is the only prosody
 * the driver has: a mouth that never rests reads as a machine, and a mouth
 * that rests equally at a comma and a full stop reads as a metronome.
 */
export const PAUSE_WEIGHT = {
  space: 0.6,
  dash: 1.0,
  comma: 1.5,
  sentence: 2.2,
};

// The rules, longest match first. Position constraints: `start` means only at
// the beginning of a word, `end` only at the end.
const RULES = [
  ['tion', ['B', 'E']],
  ['sion', ['B', 'E']],
  ['ough', ['E']],
  ['augh', ['C']],
  ['eigh', ['C']],
  ['tch', ['B']],
  ['sch', ['B']],
  ['ear', ['D']], // heart, learn, earth — before `ea` can eat the vowel
  ['air', ['C']],
  ['ing', ['B']],
  ['ch', ['B']],
  ['sh', ['B']],
  ['th', ['B']],
  ['ph', ['G']],
  ['gh', ['B']],
  ['ck', ['B']],
  ['ng', ['B']],
  ['qu', ['B', 'F']],
  ['wh', ['F']],
  ['wr', ['B']],
  ['kn', ['B'], 'start'],
  ['ee', ['B']],
  ['ea', ['B']],
  ['ie', ['B']],
  ['ei', ['B']],
  ['oo', ['F']],
  ['ou', ['F']],
  ['ow', ['F']],
  ['oa', ['E']],
  ['oi', ['E', 'B']],
  ['oy', ['E', 'B']],
  ['au', ['E']],
  ['aw', ['E']],
  ['ai', ['C']],
  ['ay', ['C']],
  ['ey', ['C']],
  ['ar', ['D']],
  ['or', ['E']],
  ['er', ['E']],
  ['ir', ['E']],
  ['ur', ['E']],
  ['ue', ['F']],
  ['ui', ['F']],
];

const SINGLE = {
  a: 'C',
  e: 'C',
  i: 'B',
  o: 'E',
  u: 'E',
  y: 'B',
  b: 'A',
  p: 'A',
  m: 'A',
  f: 'G',
  v: 'G',
  l: 'H',
  w: 'F',
  r: 'E', // English /r/ is lip-rounded; E reads better than a neutral B
  c: 'B',
  d: 'B',
  g: 'B',
  h: 'B',
  j: 'B',
  k: 'B',
  n: 'B',
  q: 'B',
  s: 'B',
  t: 'B',
  x: 'B',
  z: 'B',
};

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

/**
 * Map one word to a sequence of mouth shapes.
 *
 * Consecutive identical shapes are collapsed, because two identical shapes in
 * a row is ONE drawing held twice as long, never two mouth movements —
 * counting them separately would inflate every cue-count number the
 * comparison harness reports.
 *
 * @param {string} word
 * @returns {string[]} shapes, possibly empty
 */
export function wordToShapes(word) {
  const w = (word ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return [];

  const out = [];
  const push = (shape) => {
    if (out[out.length - 1] !== shape) out.push(shape);
  };

  let i = 0;
  while (i < w.length) {
    // Silent final E: "five", "bubble", "waste". Emitting a vowel there opens
    // the mouth after the word has finished, which reads as a stutter.
    if (
      w[i] === 'e' &&
      i === w.length - 1 &&
      w.length >= 3 &&
      !VOWELS.has(w[i - 1]) &&
      w[i - 1] !== 'y'
    ) {
      break;
    }

    let matched = false;
    for (const [pattern, shapes, position] of RULES) {
      if (!w.startsWith(pattern, i)) continue;
      if (position === 'start' && i !== 0) continue;
      if (position === 'end' && i + pattern.length !== w.length) continue;
      for (const s of shapes) push(s);
      i += pattern.length;
      matched = true;
      break;
    }
    if (matched) continue;

    const single = SINGLE[w[i]];
    if (single) push(single);
    i += 1;
  }

  return out;
}

/**
 * Map a whole line of narration to weighted units, idle shapes included for
 * the gaps between words and at punctuation.
 *
 * @param {string} text
 * @returns {Array<{v:string,w:number}>}
 */
export function textToUnits(text) {
  const source = (text ?? '').trim();
  if (!source) return [];

  const units = [];
  const push = (v, w) => {
    const last = units[units.length - 1];
    // Same shape twice running is one held shape. Summing the weights keeps
    // the timing identical and keeps the cue count honest.
    if (last && last.v === v) last.w += w;
    else units.push({ v, w });
  };

  // Words are runs of letters (apostrophes kept so "carries'" does not split
  // into two words with a pause between them); everything else is a break.
  const tokens = source.match(/[A-Za-zÀ-ɏ']+|[^A-Za-zÀ-ɏ']+/g) ?? [];
  for (const token of tokens) {
    if (/^[A-Za-zÀ-ɏ']+$/.test(token)) {
      for (const shape of wordToShapes(token)) push(shape, SHAPE_WEIGHT[shape]);
      continue;
    }
    push('X', pauseWeight(token));
  }

  return units;
}

/**
 * How much of a line the table can actually read: of the LETTERS in the text,
 * the share that are Latin. Punctuation and whitespace are not counted either
 * way, because they are pauses in every script.
 *
 * WHY A CALLER NEEDS THIS. Everything the table cannot read becomes a pause,
 * and a pause is a shut mouth. A line of Devanagari scores 0 and yields a
 * mouth that never opens; a code-switched line scores somewhere in between and
 * yields a mouth that opens for the Latin words and rests through the rest —
 * not a refusal, but also not the thing anybody thinks they asked for.
 * MEASURED on this repo's corpus: every English beat and every hand-written
 * romanised Hinglish beat in corpus/hinglish.json scores 1.00.
 *
 * @param {string} text
 * @returns {number} 0..1; 0 when there are no letters at all to read
 */
export function readableFraction(text) {
  const letters = (text ?? '').match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 0;
  const latin = letters.filter((c) => /[A-Za-zÀ-ɏ]/.test(c)).length;
  return latin / letters.length;
}

function pauseWeight(separator) {
  if (/[.?!।…]/.test(separator)) return PAUSE_WEIGHT.sentence;
  if (/[,;:]/.test(separator)) return PAUSE_WEIGHT.comma;
  if (/[—–-]/.test(separator)) return PAUSE_WEIGHT.dash;
  return PAUSE_WEIGHT.space;
}
