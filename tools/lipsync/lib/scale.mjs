// SCALING — the step that turns a list of letters into a mouth.
//
// The rule table emits UNITLESS relative durations (avatar-3.md:1F). This
// file is the only place they become seconds, and it is the only thing
// standing between the fallback pipeline and a mouth that finishes the
// sentence before the voice does.
//
// WHY THE LAST CUE ABSORBS THE REMAINDER, stated as what is measurable rather
// than as a failure story. Proportional durations sum to `duration` only to
// float precision — about 1e-16 on a sentence-length span. Giving the last cue
// the remainder makes the sum exact BY CONSTRUCTION rather than by luck.
//
// MEASURED, so nobody reads this as a bug report: removing the `isLast` branch
// leaves all twelve class10-blood timelines (six English beats, six Hinglish)
// byte-identical under JSON.stringify. alignByRules re-anchors every
// sentence from allocate() and normaliseCues rounds ABSOLUTE start and end
// times to whole milliseconds (format.mjs), never per-cue durations, so a
// float residue of 1e-16 cannot survive to the output. The three-equal-weights
// case lands on exactly 1.000 either way. This branch is belt-and-braces
// against a future consumer that rounds differently, not a fix for a defect
// this pipeline has.

/**
 * Lay unitless weighted units end to end across a real span of time.
 *
 * @param {Array<{v:string,w:number}>} units
 * @param {{start:number, duration:number}} span in seconds
 * @returns {Array<{t:number,d:number,v:string}>}
 */
export function scaleUnits(units, { start, duration }) {
  if (!units || units.length === 0) return [];
  const total = units.reduce((sum, u) => sum + u.w, 0);
  if (!(total > 0)) return [];

  const out = [];
  let cursor = start;
  for (let i = 0; i < units.length; i++) {
    const isLast = i === units.length - 1;
    const d = isLast ? start + duration - cursor : (duration * units[i].w) / total;
    out.push({ t: cursor, d, v: units[i].v });
    cursor += d;
  }
  return out;
}

/**
 * Split one clip's duration across its sentences in proportion to weight.
 *
 * The weights handed in are sums of mouth-movement units, NOT measured speech
 * time — see the honest limit at the top of sentences.mjs. This function does
 * proportional division correctly; what it divides is an approximation.
 *
 * @param {number[]} weights one per sentence
 * @param {number} duration clip length in seconds
 * @returns {number[]} durations summing to exactly `duration`
 */
export function allocate(weights, duration) {
  if (!weights || weights.length === 0) return [];
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (!(total > 0)) return weights.map(() => duration / weights.length);

  const parts = [];
  let used = 0;
  for (let i = 0; i < weights.length; i++) {
    if (i === weights.length - 1) parts.push(duration - used);
    else {
      const part = (duration * weights[i]) / total;
      parts.push(part);
      used += part;
    }
  }
  return parts;
}
