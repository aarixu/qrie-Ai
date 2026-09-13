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

// ------------------------------------------------------------------ scenarios
/**
 * THE LEVERS, AND WHO PULLS THEM.
 *
 * Four of them, and they are not independent: each assumes the ones above it.
 *
 *  1. RECORD THE NARRATION. The words never change between students, so
 *     synthesising them per student is paying repeatedly for one answer.
 *     tools/record-class and createRecordedTts already exist.
 *  2. LET THE CLASS ANSWER IN ITS OWN WORDS. Every option in the probe bank
 *     already carries an authored `why` and `hint`, and the TAP path already
 *     speaks them with no model call at all. Only the SPOKEN path asks a model
 *     to write fresh prose for something the lesson already said better.
 *  3. LET THE LEARNER MODEL DECIDE. The question has four known options and a
 *     named misconception per distractor. Asking an LLM which one a student
 *     meant is the LLM doing the model's job — and being billed for it. Only
 *     what local matching cannot resolve should reach a model.
 *  4. PUT THE SPEECH ON THE DEVICE. Only the Android build can: measured on a
 *     4 GB Mali phone, synthesis runs at 0.45-0.81x realtime with a 3-4s fixed
 *     cost per call, so it can pre-render a class during prep but cannot hold
 *     a live conversation. Which is fine once (2) makes the replies files.
 */
/**
 * MEASURED, 2026-09-13, over 6,251 answers to the real committed probe bank:
 * `packages/tutor-judge/src/match.ts` resolves 72% of class10-science and 70%
 * of class9-science with NO model call, and gets 0.1% wrong.
 *
 * Read it as an upper bound and not a promise. The answers were built FROM
 * each probe's own options — said exactly, lowercased, wrapped in Hinglish
 * filler, hedged, shortened, reversed — so they reuse the option's words. A
 * student who paraphrases the idea in their own words has none of them, and
 * the shape closest to that (`shortened`, four words only) resolves just 23%.
 * The true rate is somewhere in 23-72% and only real student speech settles it.
 */
const MATCH_RATE = arg('match', 0.72); // MEASURED, with the caveat above
const VPS_MONTHLY = arg('vps', 2000); // ESTIMATED — a 4 vCPU box, INR/month

/**
 * MEASURED on 72 real answers through the deployed relay, 2026-09-13: asking
 * for `reasoning_effort: 'none'` cut the judge's bill by 31% and changed no
 * verdict. Not the 75% the thinking share suggests — a budget of zero does not
 * stop gemini-3.7-flash thinking, it only slows it down.
 */
const THINKING_OFF = 0.69;

const web = [
  {
    name: 'W1. Today — every line synthesised for every student',
    once: PREP_LLM,
    parts: {
      'narration TTS': NARRATION_TTS,
      'her replies, TTS': JUDGE_TTS,
      'the ear (STT)': EAR_STT,
      'judge LLM': JUDGE_LLM,
    },
  },
  {
    name: 'W2. + record the narration once per topic',
    once: PREP_LLM + RECORD_ON_AURA,
    parts: {
      'narration TTS': SERVE_AUDIO,
      'her replies, TTS': JUDGE_TTS,
      'the ear (STT)': EAR_STT,
      'judge LLM': JUDGE_LLM,
    },
  },
  {
    name: 'W3. + she answers in the lesson’s own authored words, recorded too',
    once: PREP_LLM + RECORD_ON_AURA * 1.4, // the why/hint lines are ~40% more audio
    parts: {
      'narration TTS': SERVE_AUDIO,
      'her replies, TTS': 0,
      'the ear (STT)': EAR_STT,
      'judge LLM': JUDGE_LLM * THINKING_OFF,
    },
  },
  {
    name: `W4. + the learner model resolves the answer, LLM only for the rest (${(MATCH_RATE * 100).toFixed(0)}%)`,
    once: PREP_LLM + RECORD_ON_AURA * 1.4,
    parts: {
      'narration TTS': SERVE_AUDIO,
      'her replies, TTS': 0,
      'the ear (STT)': EAR_STT,
      'judge LLM': JUDGE_LLM * THINKING_OFF * (1 - MATCH_RATE),
    },
  },
  {
    /**
     * THE BROWSER CAN HOLD THE EAR, ONCE IT NO LONGER HAS TO HOLD THE VOICE.
     *
     * "A browser cannot download 306 MB of speech models" has been the reason
     * web is the expensive platform, and it counts the wrong models. 263 MB of
     * that is Supertonic, the VOICE — and by W3 the voice is a set of files
     * that were rendered once, so the browser never needs it. What is left is
     * the EAR, and whisper-tiny is 39 MB: a one-time download smaller than a
     * single app update, cached after the first visit.
     *
     * So the platform was never the constraint. The constraint is whether any
     * small on-device model can hear a Class 10 student answer in Hinglish.
     */
    name: 'W5. + the ear runs in the browser too — only the voice was ever too big',
    once: PREP_LLM + RECORD_ON_AURA * 1.4,
    parts: {
      'narration TTS': SERVE_AUDIO,
      'her replies, TTS': 0,
      'the ear (STT)': 0,
      'judge LLM': JUDGE_LLM * THINKING_OFF * (1 - MATCH_RATE),
    },
  },
  {
    /**
     * And the rung that makes the platform question disappear.
     *
     * If the class also carries its own cross-question per option, authored at
     * preparation time like the `why` and the `hint` already are, then nothing
     * at playback needs a model at all and web costs exactly what Android
     * costs. The open question is not the money, it is whether a cross-question
     * written before the student spoke can be as good as one written after.
     */
    name: 'W6. + the class carries its own cross-questions (same as A4)',
    once: PREP_LLM * 1.3 + RECORD_ON_AURA * 1.4,
    parts: {
      'narration TTS': SERVE_AUDIO,
      'her replies, TTS': 0,
      'the ear (STT)': 0,
      'judge LLM': 0,
    },
  },
];

const app = [
  {
    name: 'A1. The app as designed today — speech on the device, judge in the cloud',
    once: PREP_LLM,
    parts: {
      'narration TTS': 0,
      'her replies, TTS': 0,
      'the ear (STT)': 0,
      'judge LLM': JUDGE_LLM,
    },
  },
  {
    name: 'A2. + thinking off, and she answers in the lesson’s own words',
    once: PREP_LLM,
    parts: {
      'narration TTS': 0,
      'her replies, TTS': 0,
      'the ear (STT)': 0,
      'judge LLM': JUDGE_LLM * THINKING_OFF,
    },
  },
  {
    name: `A3. + the learner model resolves the answer (${(MATCH_RATE * 100).toFixed(0)}%)`,
    once: PREP_LLM,
    parts: {
      'narration TTS': 0,
      'her replies, TTS': 0,
      'the ear (STT)': 0,
      'judge LLM': JUDGE_LLM * THINKING_OFF * (1 - MATCH_RATE),
    },
  },
  {
    name: 'A4. + the class carries its own cross-questions — no model at playback at all',
    once: PREP_LLM * 1.3, // authoring the cross-question per option at prep time
    parts: {
      'narration TTS': 0,
      'her replies, TTS': 0,
      'the ear (STT)': 0,
      'judge LLM': 0,
    },
  },
];

const rs = (n) => `₹${n.toFixed(2)}`;
const minutes = measured.activeMs / 60000;
const perHour = (perClass) => (perClass * 60) / minutes;
const sum = (s) => Object.values(s.parts).reduce((a, b) => a + b, 0);

const line = (label, value) => console.log(`    ${label.padEnd(46)}${rs(value).padStart(8)}`);

console.log(`
ONE CLASS — ${measured.topicRef}
  ${measured.beats} beats, ${measured.asks} asks, ~${minutes.toFixed(1)} min on task
  MEASURED against the deployed relay on 2026-09-13; ${rows.length} calls, ${rows.length} usage rows.
`);

console.log('  MEASURED, once per topic (then the class is cached and reused)');
line('planner + artist, 4 LLM calls', PREP_LLM);
console.log('\n  MEASURED, every student every time');
line(`narration, ${NARRATION_CHARS} characters of TTS`, NARRATION_TTS);
line(`the ear, ${EAR_SEC.toFixed(0)} seconds of STT`, EAR_STT);
line('judge + cross-question, 8 LLM calls', JUDGE_LLM);
console.log('\n  DERIVED — the classroom does this and the harness did not');
line(`her ${JUDGE_OUT_TOKENS} reply tokens spoken aloud, ~${JUDGE_SPOKEN_CHARS} chars`, JUDGE_TTS);

const todayPer = sum(web[0]);
console.log(`\n  A COLD class   ${rs(web[0].once + todayPer)}`);
console.log(`  A CACHED class ${rs(todayPer)}   =  ₹${perHour(todayPer).toFixed(0)} per student-hour`);

const TARGET = 2;
const table = (title, list, note) => {
  console.log(`\n\n${title}\n`);
  if (note) console.log(`  ${note}\n`);
  for (const s of list) {
    const per = sum(s);
    const hr = perHour(per);
    const hit = hr <= TARGET ? '  <-- TARGET' : '';
    console.log(`  ${s.name}`);
    for (const [k, v] of Object.entries(s.parts)) {
      console.log(`      ${k.padEnd(22)} ${(v === 0 ? 'free' : rs(v)).padStart(10)}`);
    }
    console.log(
      `      ${'PER CACHED CLASS'.padEnd(22)} ${rs(per).padStart(10)}   ₹${hr.toFixed(0)}/student-hour` +
        `   first class of a topic ${rs(s.once + per)}${hit}\n`,
    );
  }
};

table(
  'ON THE WEB',
  web,
  'Each rung assumes the ones above it. A VPS hosting the speech would be a fifth rung, and ' +
    `by W4 it could save at most ${rs(EAR_STT)} a class, which is why it is not listed: ` +
    'by then there is almost nothing left for it to host.',
);

table(
  'ON ANDROID — the models ship inside the APK, so speech costs nothing',
  app,
  'MEASURED on a 4 GB Mali phone: synthesis 0.45-0.81x realtime with a 3-4s fixed cost, ' +
    '255 MB of models cache and reload in 3-5s, memory is not the wall.\n  ' +
    'So the app can PRE-RENDER a class during the prep it already does, but cannot hold a live\n  ' +
    'conversation at speed. Rung A2 is what makes that stop mattering.',
);

console.log(`\nWHERE ₹${TARGET} IS CROSSED\n`);
for (const [where, list] of [
  ['web', web],
  ['app', app],
]) {
  const rung = list.find((s) => perHour(sum(s)) <= TARGET);
  console.log(
    rung
      ? `  ${where}: at "${rung.name.split('.')[0]}" — ₹${perHour(sum(rung)).toFixed(2)}/student-hour`
      : `  ${where}: NOT REACHED. The cheapest rung here is ₹${perHour(Math.min(...list.map(sum))).toFixed(2)}/student-hour.`,
  );
}

console.log(`\n\nTHE NUMBERS THAT ARE NOT MEASURED, AND DECIDE THIS\n`);
console.log(
  `  MATCH RATE (--match, now ${(MATCH_RATE * 100).toFixed(0)}%). MEASURED at 70-72% over 6,251 answers to the\n` +
    `  matched to one of four known options with no model call. Nobody has measured this.\n` +
    `  It is the difference between ₹${perHour(sum(app[1])).toFixed(2)} and ₹${perHour(sum(app[2])).toFixed(2)} a student-hour on the app.\n`,
);
console.log(
  `  ON-DEVICE HINGLISH SPEECH RECOGNITION. Measured on Aarav's own phone 2026-08-30:\n` +
    `  Moonshine-tiny transcribed five seconds in 5.6s and returned an EMPTY STRING on real\n` +
    `  speech, because it is English-only and these students are not. Every app figure above\n` +
    `  assumes this gets solved. It is the one blocker between here and launching on Android.\n`,
);
console.log(
  `  THE DOUBT TUTOR. A raised hand is a real conversation with a model and cannot be\n` +
    `  pre-rendered or matched. It was never exercised in the measurement, so it is in none\n` +
    `  of these figures. It is also the only place left where an LLM is doing work the\n` +
    `  learner model could not have done instead.\n`,
);

const TOPICS = 1099;
console.log(`\nTHE WHOLE CATALOGUE — ${TOPICS} topics, paid once, ever\n`);
console.log(`  preparing every class            ${rs(PREP_LLM * TOPICS).padStart(12)}`);
console.log(`  recording narration + replies    ${rs(RECORD_ON_AURA * 1.4 * TOPICS).padStart(12)}`);
console.log(`  ${'TOTAL'.padEnd(32)} ${rs((PREP_LLM + RECORD_ON_AURA * 1.4) * TOPICS).padStart(12)}`);
console.log(`  audio to store                   ${((AUDIO_KB * 1.4 * TOPICS) / 1024).toFixed(0).padStart(9)} MB\n`);
