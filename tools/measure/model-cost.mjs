/**
 * WHAT A CLASS COSTS, AND WHAT IT WOULD COST IF WE CHANGED ONE THING.
 *
 * `tests/measure-class.test.ts` spends real money to find out what one class
 * costs today. This projects that measurement forward: it reads the same
 * `last-class.json` and answers the question the measurement raises rather
 * than settles — which part is worth changing, and at what volume.
 *
 * Every constant here is labelled MEASURED, DERIVED or ESTIMATED, and the
 * distinction is the point. A number that came off the wire and a number
 * somebody reasoned their way to are not the same kind of number, and a model
 * that mixes them silently is how a guess ends up in a price.
 *
 * Run:  node tools/measure/model-cost.mjs
 *       node tools/measure/model-cost.mjs --classes 5000
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};

const RATE = 95.6; // INR per USD

// ---------------------------------------------------------------- the prices
// From tools/sql/model_price.sql, each with its source and date.
const PRICE = {
  llmIn: 0.75 / 1e6, // gemini-3.7-flash, USD per prompt token
  llmOut: 3.75 / 1e6, // and per output token; thinking bills as output
  auraChar: 30 / 1e6, // deepgram/aura-2, USD per character
  novaSec: 0.0043 / 60, // deepgram/nova-3, USD per second of audio
  geminiTtsToken: 20 / 1e6, // gemini-3.1-flash-tts-preview, USD per audio token
  geminiTtsTokensPerSec: 32, // MEASURED by tools/record-class, see its README
};

// ------------------------------------------------------------- the class run
const measured = JSON.parse(
  fs.readFileSync(path.resolve('tools/measure/last-class.json'), 'utf8'),
);
const rows = measured.rows;
const firstSpeech = rows.findIndex((r) => r.relay === 'speech');
const prepRows = rows.slice(0, firstSpeech);
const playRows = rows.slice(firstSpeech);

const inr = (usd) => usd * RATE;
const llmInr = (rs) =>
  inr(
    rs.reduce(
      (s, r) =>
        s +
        (r.prompt_tokens ?? 0) * PRICE.llmIn +
        ((r.output_tokens ?? 0) + (r.thought_tokens ?? 0)) * PRICE.llmOut,
      0,
    ),
  );

const PREP_LLM = llmInr(prepRows); // MEASURED — planner x2, artist x2
const JUDGE_LLM = llmInr(playRows.filter((r) => r.relay === 'llm')); // MEASURED
const NARRATION_CHARS = playRows
  .filter((r) => r.relay === 'speech')
  .reduce((s, r) => s + (r.characters ?? 0), 0); // MEASURED
const NARRATION_TTS = inr(NARRATION_CHARS * PRICE.auraChar); // MEASURED
const EAR_SEC = playRows
  .filter((r) => r.relay === 'hear')
  .reduce((s, r) => s + (r.audio_bytes ?? 0) / 32000, 0); // MEASURED
const EAR_STT = inr(EAR_SEC * PRICE.novaSec); // MEASURED

/**
 * The speech the measurement did not make, and the class does.
 *
 * The harness spoke every beat and then judged four answers WITHOUT speaking
 * the judge's replies — but `speakSafely(judged.say)` runs on every one of
 * them in the real classroom, and so does the cross-question close. Their
 * output tokens ARE measured, so the characters are derived rather than
 * imagined: English runs about four characters to the token.
 */
const JUDGE_OUT_TOKENS = playRows
  .filter((r) => r.relay === 'llm')
  .reduce((s, r) => s + (r.output_tokens ?? 0), 0); // MEASURED
const CHARS_PER_TOKEN = 4; // ESTIMATED
const JUDGE_SPOKEN_CHARS = JUDGE_OUT_TOKENS * CHARS_PER_TOKEN; // DERIVED
const JUDGE_TTS = inr(JUDGE_SPOKEN_CHARS * PRICE.auraChar); // DERIVED

/**
 * Recording the narration once, as tools/record-class already does.
 *
 * The seconds come from a real recorded take: content/class10-blood/audio
 * holds 121.8s of speech for 1,462 characters of narration, so this voice runs
 * at 12.0 characters a second. That is measured on a committed artefact rather
 * than assumed from a speaking-rate table.
 */
const CHARS_PER_SEC = 12.0; // MEASURED from content/class10-blood/audio
const NARRATION_SEC = NARRATION_CHARS / CHARS_PER_SEC; // DERIVED
const RECORD_ON_GEMINI = inr(
  NARRATION_SEC * PRICE.geminiTtsTokensPerSec * PRICE.geminiTtsToken,
); // DERIVED
const RECORD_ON_AURA = NARRATION_TTS; // the same characters, one time
const AUDIO_KB = (512 / 121.8) * NARRATION_SEC; // MEASURED 512 KB for 121.8s
const EGRESS_INR_PER_GB = 8.6; // ESTIMATED — Supabase overage $0.09/GB
const SERVE_AUDIO = (AUDIO_KB / 1024 / 1024) * EGRESS_INR_PER_GB; // DERIVED

const CLASSES = arg('classes', 1000);
const VPS_MONTHLY = arg('vps', 2000); // ESTIMATED — a 4 vCPU box, INR/month

// ------------------------------------------------------------------ scenarios
const scenarios = [
  {
    name: 'A. Today — every line synthesised for every student',
    once: PREP_LLM,
    per: NARRATION_TTS + JUDGE_TTS + EAR_STT + JUDGE_LLM,
    parts: {
      'narration TTS': NARRATION_TTS,
      "judge's replies TTS": JUDGE_TTS,
      'the ear (STT)': EAR_STT,
      'judge LLM': JUDGE_LLM,
    },
  },
  {
    name: 'B. Record the narration once  (tools/record-class, already built)',
    once: PREP_LLM + RECORD_ON_AURA,
    per: JUDGE_TTS + EAR_STT + JUDGE_LLM + SERVE_AUDIO,
    parts: {
      'narration TTS': SERVE_AUDIO,
      "judge's replies TTS": JUDGE_TTS,
      'the ear (STT)': EAR_STT,
      'judge LLM': JUDGE_LLM,
    },
  },
  {
    name: 'C. B, plus the live speech self-hosted on a VPS',
    once: PREP_LLM + RECORD_ON_AURA,
    per: JUDGE_LLM + SERVE_AUDIO,
    parts: {
      'narration TTS': SERVE_AUDIO,
      "judge's replies TTS": 0,
      'the ear (STT)': 0,
      'judge LLM': JUDGE_LLM,
    },
    monthly: VPS_MONTHLY,
  },
];

const rs = (n) => `₹${n.toFixed(2)}`;
const minutes = measured.activeMs / 60000;

console.log(`
ONE CLASS — ${measured.topicRef}
  ${measured.beats} beats, ${measured.asks} asks, ~${minutes.toFixed(1)} min on task
  MEASURED against the deployed relay on 2026-09-13; ${rows.length} calls, ${rows.length} usage rows.
`);

const line = (label, value) => console.log(`    ${label.padEnd(46)}${rs(value).padStart(8)}`);

console.log('  MEASURED, once per topic (then the class is cached and reused)');
line('planner + artist, 4 LLM calls', PREP_LLM);
console.log('\n  MEASURED, every student every time');
line(`narration, ${NARRATION_CHARS} characters of TTS`, NARRATION_TTS);
line(`the ear, ${EAR_SEC.toFixed(0)} seconds of STT`, EAR_STT);
line('judge + cross-question, 8 LLM calls', JUDGE_LLM);
console.log('\n  DERIVED — the classroom does this and the harness did not');
line(`her ${JUDGE_OUT_TOKENS} reply tokens spoken aloud, ~${JUDGE_SPOKEN_CHARS} chars`, JUDGE_TTS);

const today = scenarios[0];
console.log(`\n  A COLD class   ${rs(today.once + today.per)}`);
console.log(`  A CACHED class ${rs(today.per)}   =  ₹${((today.per * 60) / minutes).toFixed(0)} per student-hour`);

console.log(`\n\nWHAT CHANGES IF WE CHANGE ONE THING  (at ${CLASSES.toLocaleString('en-IN')} classes a month)\n`);
for (const s of scenarios) {
  const monthly = s.monthly ?? 0;
  const perClass = s.per + monthly / CLASSES;
  console.log(`  ${s.name}`);
  for (const [k, v] of Object.entries(s.parts)) {
    console.log(`      ${k.padEnd(24)} ${(v === 0 ? 'self-hosted' : rs(v)).padStart(11)}`);
  }
  if (monthly) console.log(`      ${'the VPS, spread out'.padEnd(24)} ${rs(monthly / CLASSES).padStart(11)}`);
  console.log(
    `      ${'PER CACHED CLASS'.padEnd(24)} ${rs(perClass).padStart(11)}   ` +
      `₹${((perClass * 60) / minutes).toFixed(0)}/student-hour   first class of a topic ${rs(s.once + s.per)}`,
  );
  console.log('');
}

// ------------------------------------------------------------- break-even
console.log('BREAK-EVEN\n');
/**
 * Recording the SAME characters through the SAME vendor costs exactly what
 * speaking them once costs — so the first student pays what they pay today and
 * the second student is free. There is no volume at which this is the wrong
 * call; there is only the question of whether a topic gets a second student.
 */
console.log(
  `  Recording the narration costs ${rs(RECORD_ON_AURA)} — the same characters, once. ` +
    `The first\n  student on a topic pays what they pay today; the SECOND one is free. There is no\n` +
    `  volume at which this loses.`,
);
console.log(
  `\n  tools/record-class defaults to Gemini TTS, which would cost ${rs(RECORD_ON_GEMINI)} for this class —\n` +
    `  ${(RECORD_ON_GEMINI / RECORD_ON_AURA).toFixed(1)}x the same words on Aura. Worth a flag to pick the vendor, not a reason to wait.`,
);
const vpsSaves = scenarios[1].per - scenarios[2].per;
console.log(
  `\n  The VPS saves ${rs(vpsSaves)} a class, so a ₹${VPS_MONTHLY.toLocaleString('en-IN')}/month box pays for itself at ` +
    `${Math.ceil(VPS_MONTHLY / vpsSaves).toLocaleString('en-IN')} classes a month ` +
    `(~${Math.ceil(VPS_MONTHLY / vpsSaves / 30)} a day).`,
);

const TOPICS = 1099;
console.log(`\n\nTHE WHOLE CATALOGUE — ${TOPICS} topics, paid once, ever\n`);
console.log(`  preparing every class            ${rs(PREP_LLM * TOPICS).padStart(12)}`);
console.log(`  recording every narration        ${rs(RECORD_ON_AURA * TOPICS).padStart(12)}`);
console.log(`  ${'TOTAL'.padEnd(32)} ${rs((PREP_LLM + RECORD_ON_AURA) * TOPICS).padStart(12)}`);
console.log(
  `  audio to store                   ${((AUDIO_KB * TOPICS) / 1024).toFixed(0).padStart(9)} MB\n`,
);

console.log(`WHAT STAYS EXPENSIVE WHATEVER WE DO\n`);
console.log(
  `  The judge. ${rs(JUDGE_LLM)} of LLM per class, on every student, forever — it reads a\n` +
    `  spoken answer and decides right from wrong, and that cannot be cached because\n` +
    `  every student says something different. Self-hosting it means running a model\n` +
    `  good enough to mark a child's Hinglish answer, which is not a VPS question.\n`,
);
