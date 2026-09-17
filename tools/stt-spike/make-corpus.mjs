// STARTER CORPUS FOR THE GPU STT SPIKE — synthesised, and honest about it.
//
// ============================================================================
// READ THIS BEFORE TRUSTING ANY NUMBER THE CORPUS PRODUCES:
//
//   TTS-FED STT IS AN OPTIMISTIC BOUND. A Piper voice is clean studio audio —
//   no phone microphone, no classroom noise, no child's cadence, no real
//   code-switching mid-sentence. A model that fails on THIS corpus certainly
//   fails on real students; a model that passes has only earned the right to
//   the real test. The protocol (docs/research/stt-spike-protocol.md)
//   requires TEN REAL PHONE RECORDINGS before the verdict counts. This file
//   exists so the GPU hour is not spent on an empty directory, nothing more.
//
//   A second honesty note: every committed lesson's narration is English
//   (`language: "en"` in each content/*/lesson.json), because the app chrome
//   is English and Hinglish is the tutor's spoken register, generated at
//   runtime, not stored. So what this corpus actually measures is
//   Hindi-voice-accented English carrying the product's own science
//   vocabulary — the CPU baseline's second-worst case ("Hinglish, Hindi
//   voice", avg_logprob -3.59, tools/speech/README.md). Real code-switched
//   Hinglish arrives only with the phone recordings.
// ============================================================================
//
// WHY the lines come from committed lessons and not from a phrase list: the
// ear's job is to hear THESE words — "evaporation", "mitochondria", "law of
// conservation of mass" — spoken by Indian children. A generic corpus scores
// a generic ear. Pulling narration straight from content/*/lesson.json means
// the vocabulary under test is exactly the vocabulary the product speaks.
//
// WHAT IT DOES:
//   1. Always: picks 20 narration lines, spread round-robin across every
//      committed lesson (deterministic — same tree, same corpus), and writes
//      them to corpus/lines.txt.
//   2. If a local speech server (tools/speech/server.py) is answering on
//      CURIE_SPEECH_URL (default http://127.0.0.1:8123): synthesises each
//      line through Piper, rotating the three Hindi voices, and writes
//      corpus/NN-<voice>.wav with a sibling NN-<voice>.txt reference —
//      exactly the layout run.py consumes.
//
//   node tools/stt-spike/make-corpus.mjs
//
// This script MAY read the repo (unlike run.py, which must run on a bare
// pod): it is the bridge between the tree and the pod, run once on a laptop.

import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const CONTENT = join(REPO, "content");
const CORPUS = join(HERE, "corpus");
const SPEECH_URL = process.env.CURIE_SPEECH_URL ?? "http://127.0.0.1:8123";

// The three Hindi voices Piper ships (tools/speech/README.md — there is no
// Indian English voice at any price, which is why a Hindi voice reading
// English is not an artificial test: it is the deployed configuration).
const VOICES = [
  "hi_IN-pratham-medium",
  "hi_IN-priyamvada-medium",
  "hi_IN-rohan-medium",
];

const TARGET_LINES = 20;
// Too short and the clip is one word (WER of 0% or 100%, nothing between);
// too long and Whisper's own segmentation becomes the variable under test.
const MIN_CHARS = 40;
const MAX_CHARS = 160;

// ---------------------------------------------------------------------------
// 1. Pull candidate lines, per lesson, in beat order.
// ---------------------------------------------------------------------------
const lessons = readdirSync(CONTENT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(CONTENT, d.name, "lesson.json")))
  .map((d) => d.name)
  .sort(); // sorted so the corpus is deterministic across machines

const perLesson = lessons.map((name) => {
  const lesson = JSON.parse(readFileSync(join(CONTENT, name, "lesson.json"), "utf8"));
  const lines = (lesson.beats ?? [])
    .map((b) => (b.narration ?? "").trim())
    // No digits: Piper verbalises "100 mL" one way and Whisper may write it
    // back as digits or as "one hundred millilitres" — a number-SPELLING
    // mismatch that WER counts as a hearing error. Against the protocol's
    // tight synthetic gate (mean WER <= 10%), one such clip in twenty eats
    // real headroom measuring nothing about hearing.
    .filter((n) => n.length >= MIN_CHARS && n.length <= MAX_CHARS && !/\d/.test(n));
  return { name, lines };
});

// Round-robin one line per lesson so no single lesson's vocabulary dominates
// a 20-line corpus — the ear has to hear blood AND atoms AND evaporation.
const picked = [];
const seen = new Set();
for (let round = 0; picked.length < TARGET_LINES; round++) {
  let tookAny = false;
  for (const { lines } of perLesson) {
    if (picked.length >= TARGET_LINES) break;
    const line = lines[round];
    if (line && !seen.has(line)) {
      seen.add(line);
      picked.push(line);
      tookAny = true;
    }
  }
  if (!tookAny) break; // every lesson exhausted — take what we have
}

if (picked.length < TARGET_LINES) {
  console.warn(`only ${picked.length} qualifying lines found (wanted ${TARGET_LINES})`);
}

mkdirSync(CORPUS, { recursive: true });
writeFileSync(join(CORPUS, "lines.txt"), picked.join("\n") + "\n", "utf8");
console.log(`wrote ${picked.length} reference lines to ${join(CORPUS, "lines.txt")}`);

// ---------------------------------------------------------------------------
// 2. Synthesise, if — and only if — a local speech server is up. No server is
//    not an error: lines.txt alone is a valid deliverable (the pod operator
//    can synthesise there, or go straight to phone recordings).
// ---------------------------------------------------------------------------
let health = null;
try {
  const res = await fetch(`${SPEECH_URL}/health`, { signal: AbortSignal.timeout(2000) });
  if (res.ok) health = await res.json();
} catch {
  // unreachable — fall through with health === null
}

if (!health) {
  console.log(`no speech server at ${SPEECH_URL} — wavs not synthesised.`);
  console.log(`to synthesise: pip install piper-tts, download the three Hindi`);
  console.log(`voices (tools/speech/README.md), python tools/speech/server.py,`);
  console.log(`then re-run this script.`);
  console.log(``);
  console.log(`REMINDER: even with wavs, TTS-fed STT is an OPTIMISTIC bound —`);
  console.log(`the verdict needs 10 real phone recordings (see the protocol).`);
  process.exit(0);
}

// The quickstart (tools/speech/README.md) downloads only ONE voice, so the
// most likely first-run state is a healthy server missing two of the three.
// Rotating voices the server does not have would 404 thirteen of twenty
// /speak calls and leave a one-voice corpus that silently weakens the test —
// so check /health's `available` list (server.py:166-171) and make the
// operator fix it rather than proceed diminished.
const available = Array.isArray(health.available) ? health.available : [];
const missing = VOICES.filter((v) => !available.includes(v));
if (missing.length > 0) {
  console.error(`speech server is up but missing ${missing.length} of the ${VOICES.length} Hindi voices.`);
  console.error(`A one-voice corpus silently weakens the test. Download the missing ones:`);
  for (const v of missing) {
    console.error(`  python -m piper.download_voices ${v} --download-dir tools/speech/voices`);
  }
  console.error(`then restart the server and re-run this script.`);
  process.exit(1);
}

console.log(`speech server up at ${SPEECH_URL} — synthesising ${picked.length} clips`);
let failures = 0;
for (let i = 0; i < picked.length; i++) {
  const line = picked[i];
  const voice = VOICES[i % VOICES.length];
  const short = voice.replace("hi_IN-", "").replace("-medium", "");
  const stem = `${String(i + 1).padStart(2, "0")}-${short}`;
  try {
    const res = await fetch(
      `${SPEECH_URL}/speak?text=${encodeURIComponent(line)}&voice=${encodeURIComponent(voice)}`,
      { signal: AbortSignal.timeout(60000) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const wav = Buffer.from(await res.arrayBuffer());
    writeFileSync(join(CORPUS, `${stem}.wav`), wav);
    writeFileSync(join(CORPUS, `${stem}.txt`), line + "\n", "utf8");
    console.log(`  ${stem}.wav  (${(wav.length / 1024).toFixed(0)} KiB)  "${line.slice(0, 50)}..."`);
  } catch (err) {
    failures++;
    console.error(`  FAILED ${stem}: ${err.message}`);
  }
}

console.log(``);
console.log(`done: ${picked.length - failures}/${picked.length} clips in ${CORPUS}`);
console.log(``);
console.log(`==========================================================================`);
console.log(`THIS CORPUS IS AN OPTIMISTIC BOUND: clean TTS audio, no phone microphone,`);
console.log(`no classroom noise, English narration in a Hindi voice rather than true`);
console.log(`code-switched Hinglish. The protocol requires 10 REAL PHONE RECORDINGS`);
console.log(`(docs/research/stt-spike-protocol.md) before any pass/fail verdict counts.`);
console.log(`==========================================================================`);
