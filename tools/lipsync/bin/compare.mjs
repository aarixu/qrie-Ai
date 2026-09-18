#!/usr/bin/env node
// THE COMPARISON HARNESS — the measurement this phase exists to produce.
//
//   node tools/lipsync/bin/compare.mjs
//   node tools/lipsync/bin/compare.mjs --lesson class10-blood --out results.json
//
// It runs five arms over the same six clips and prints what is observable
// about each. It does NOT print an accuracy figure, because there is no
// hand-labelled ground truth and inventing one would make the most quotable
// number in the report the only false one in it.
//
// THE FIVE ARMS, and what each is for:
//
//   rhubarb+dialog   the intended production path: Rhubarb with the lesson
//                    script passed as dialogText, biasing recognition toward
//                    words it expects. The best case.
//   rhubarb-bare     the same audio with NO script. This is the proxy arm.
//                    An out-of-dictionary Hinglish word cannot be biased
//                    toward — there is no entry to make more likely — so the
//                    distance between these two arms bounds how much of
//                    Rhubarb's advantage the language switch can take away.
//                    It is a PROXY: it removes the script from English audio
//                    rather than feeding Hinglish audio, which this repo does
//                    not have.
//   rules-en         the rule table on the same English script.
//   rules-hi         the rule table on the hand-written Hinglish script for
//                    the same beat, scaled to the same measured duration.
//                    Duration held fixed on purpose, so the difference
//                    between rules-en and rules-hi is attributable to the
//                    language and not to the clock.
//   rhubarb+hi-dialog
//                    Rhubarb over the SAME English audio, biased by the
//                    HINGLISH script — a script whose words are mostly not in
//                    its dictionary. It answers the question the OOV rate
//                    cannot: does an unmatchable script MIS-bias the
//                    recogniser, or merely stop helping it? Compared against
//                    rhubarb+dialog and against rhubarb-bare, whose distance
//                    from rhubarb+dialog is the no-help baseline. The audio is
//                    English in every arm, so this measures the SCRIPT channel
//                    only and says nothing about Hinglish acoustics.
//
// Plus the one hard number: dictionary coverage, read out of the acoustic
// model Rhubarb actually ships. See lib/dictionary.mjs.

import { writeFileSync } from 'node:fs';

import { checkFfmpeg, decodePcm16k, pcmDurationSec, probeDurationSec } from '../lib/audio.mjs';
import { allNarration, audioCorpus, hinglishCorpus } from '../lib/corpus.mjs';
import { validateTimeline } from '../lib/format.mjs';
import { coverage, loadDictionary } from '../lib/dictionary.mjs';
import { clipMetrics, disagreement } from '../lib/metrics.mjs';
import { INSTALL_HINT, alignByRhubarb, loadRhubarb } from '../lib/rhubarb-driver.mjs';
import { alignByRules } from '../lib/rules-driver.mjs';

// 100 Hz. Finer than any renderer will run (a sprite swap at 30 fps is 33 ms)
// and coarse enough that a one-sample boundary difference does not register
// as a disagreement.
const SAMPLE_RATE_HZ = 100;

const args = process.argv.slice(2);
const lessonId = valueOf('--lesson') ?? 'class10-blood';
const outPath = valueOf('--out');

function valueOf(flag) {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

const ffmpegProblem = checkFfmpeg();
if (ffmpegProblem) {
  console.error(`refused: ${ffmpegProblem}`);
  process.exit(1);
}

const rhubarbAvailable = await loadRhubarb();
if (!rhubarbAvailable.ok) {
  console.error('rhubarb-lip-sync-wasm is not installed, so only the rule-table arms can run.');
  console.error(`install it with:\n  ${INSTALL_HINT}\n`);
}

const corpus = audioCorpus(lessonId);
const hinglish = hinglishCorpus();

console.log(`# lipsync comparison — ${lessonId}`);
console.log(`voice ${corpus.voice}, model ${corpus.model}, lesson language "${corpus.language}"`);
console.log(`rhubarb: ${rhubarbAvailable.ok ? rhubarbAvailable.from : 'NOT INSTALLED'}`);
console.log('');

const results = [];

for (const clip of corpus.clips) {
  const probed = probeDurationSec(clip.audioPath);
  const pcm = decodePcm16k(clip.audioPath);
  const decoded = pcmDurationSec(pcm);
  const hinglishText = hinglish.beats?.[clip.id] ?? null;

  const arms = {};

  arms['rules-en'] = { cues: alignByRules(clip.text, probed), elapsedMs: null };
  if (hinglishText) arms['rules-hi'] = { cues: alignByRules(hinglishText, probed), elapsedMs: null };

  if (rhubarbAvailable.ok) {
    const withDialog = await alignByRhubarb(pcm, { dialogText: clip.text, duration: probed });
    arms['rhubarb+dialog'] = { cues: withDialog.cues, elapsedMs: withDialog.elapsedMs, rawCount: withDialog.raw.length };
    const bare = await alignByRhubarb(pcm, { dialogText: '', duration: probed });
    arms['rhubarb-bare'] = { cues: bare.cues, elapsedMs: bare.elapsedMs, rawCount: bare.raw.length };

    if (hinglishText) {
      const hiDialog = await alignByRhubarb(pcm, { dialogText: hinglishText, duration: probed });
      arms['rhubarb+hi-dialog'] = {
        cues: hiDialog.cues,
        elapsedMs: hiDialog.elapsedMs,
        rawCount: hiDialog.raw.length,
      };
    }

    // How badly the raw aligner output breaks the format contract. Counted,
    // not assumed: this is the evidence behind normaliseCues existing.
    arms['rhubarb+dialog'].rawProblems = validateTimeline(
      withDialog.raw.map((c) => ({ t: c.start, d: c.end - c.start, v: c.value })),
    ).length;
  }

  const row = {
    clip: clip.id,
    manifestDurationSec: clip.manifestDurationSec,
    probedDurationSec: probed,
    decodedDurationSec: decoded,
    englishChars: clip.text.length,
    hinglishChars: hinglishText?.length ?? null,
    arms: {},
    disagreements: {},
  };

  for (const [name, arm] of Object.entries(arms)) {
    row.arms[name] = {
      ...clipMetrics(arm.cues, probed),
      elapsedMs: arm.elapsedMs,
      rawCueCount: arm.rawCount ?? null,
      rawFormatProblems: arm.rawProblems ?? null,
      timelineProblems: validateTimeline(arm.cues),
    };
  }

  const pairs = [
    ['rhubarb+dialog', 'rules-en'],
    ['rhubarb+dialog', 'rhubarb-bare'],
    ['rules-en', 'rules-hi'],
    // The fifth arm's two comparisons. Read them together or not at all: the
    // first is how far a wrong-language script moves the mouth, the second is
    // how far no script at all moves it. Either number alone says nothing.
    ['rhubarb+dialog', 'rhubarb+hi-dialog'],
  ];
  for (const [a, b] of pairs) {
    if (!arms[a] || !arms[b]) continue;
    row.disagreements[`${a} vs ${b}`] = disagreement(arms[a].cues, arms[b].cues, {
      rateHz: SAMPLE_RATE_HZ,
      duration: probed,
    });
  }

  results.push(row);

  console.log(`## ${clip.id}  (${probed.toFixed(2)}s, ${clip.text.length} chars EN / ${row.hinglishChars ?? '-'} chars HI)`);
  console.log('   arm                 cues  mean ms  shut%   cues/s   bytes  KB/min  gzKB/min     ms');
  for (const [name, m] of Object.entries(row.arms)) {
    console.log(
      `   ${name.padEnd(19)}${String(m.cueCount).padStart(4)}` +
        `${m.meanDurationMs.toFixed(0).padStart(9)}` +
        `${(m.shutFraction * 100).toFixed(1).padStart(7)}` +
        `${m.cuesPerSecond.toFixed(1).padStart(9)}` +
        `${String(m.bytes).padStart(8)}` +
        `${(m.bytesPerMinute / 1024).toFixed(2).padStart(8)}` +
        `${(m.gzipBytesPerMinute / 1024).toFixed(2).padStart(9)}` +
        `${(m.elapsedMs === null ? '-' : String(m.elapsedMs)).padStart(7)}`,
    );
  }
  for (const [pair, d] of Object.entries(row.disagreements)) {
    console.log(
      `   ${pair.padEnd(38)} shape ${(d.frameDisagreement * 100).toFixed(1)}%   open/shut ${(d.openShutDisagreement * 100).toFixed(1)}%`,
    );
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// The hard number: how much of each script the English dictionary has ever
// heard of. No ground truth needed — this is a lookup, not a judgement.
// ---------------------------------------------------------------------------
const dict = await loadDictionary();
const dictionaryReport = { available: dict.ok };

if (dict.ok) {
  console.log(`## dictionary coverage — ${dict.words.size.toLocaleString('en-IN')} words, ${dict.entries.toLocaleString('en-IN')} entries`);
  console.log('   (packed inside rhubarb-lip-sync-wasm as /res/sphinx/cmudict-en-us.dict)');
  console.log('   clip              EN tokens  EN OOV   HI tokens  HI OOV');
  dictionaryReport.dictionaryWords = dict.words.size;
  dictionaryReport.perClip = [];
  let enTokens = 0;
  let enOov = 0;
  let hiTokens = 0;
  let hiOov = 0;
  for (const clip of corpus.clips) {
    const en = coverage(clip.text, dict.words);
    const hiText = hinglish.beats?.[clip.id];
    const hi = hiText ? coverage(hiText, dict.words) : null;
    enTokens += en.tokens;
    enOov += en.outOfVocabulary;
    if (hi) {
      hiTokens += hi.tokens;
      hiOov += hi.outOfVocabulary;
    }
    dictionaryReport.perClip.push({ clip: clip.id, en, hi });
    console.log(
      `   ${clip.id.padEnd(16)}${String(en.tokens).padStart(10)}` +
        `${`${(en.oovRate * 100).toFixed(1)}%`.padStart(9)}` +
        `${String(hi?.tokens ?? '-').padStart(12)}` +
        `${(hi ? `${(hi.oovRate * 100).toFixed(1)}%` : '-').padStart(8)}`,
    );
  }
  dictionaryReport.totals = {
    en: { tokens: enTokens, oov: enOov, oovRate: enTokens ? enOov / enTokens : 0 },
    hi: { tokens: hiTokens, oov: hiOov, oovRate: hiTokens ? hiOov / hiTokens : 0 },
  };
  console.log(
    `   ${'TOTAL'.padEnd(16)}${String(enTokens).padStart(10)}` +
      `${`${((enOov / enTokens) * 100).toFixed(1)}%`.padStart(9)}` +
      `${String(hiTokens).padStart(12)}` +
      `${`${((hiOov / hiTokens) * 100).toFixed(1)}%`.padStart(8)}`,
  );
  // EVERY committed lesson, not just the one that has rendered audio. The six
  // clips above are one lesson's worth of English; this is the English OOV
  // baseline across the whole content tree, which is what makes the Hinglish
  // figure a comparison rather than an isolated number.
  const tree = allNarration();
  let treeTokens = 0;
  let treeOov = 0;
  const treeMissing = new Set();
  for (const lesson of tree) {
    for (const line of lesson.lines) {
      const c = coverage(line, dict.words);
      treeTokens += c.tokens;
      treeOov += c.outOfVocabulary;
      for (const w of c.missingTypes) treeMissing.add(w);
    }
  }
  dictionaryReport.allLessons = {
    lessons: tree.length,
    languages: [...new Set(tree.map((l) => l.language))].sort(),
    tokens: treeTokens,
    oov: treeOov,
    oovRate: treeTokens ? treeOov / treeTokens : 0,
    missingTypes: [...treeMissing].sort(),
  };
  console.log('');
  console.log(
    `   ALL ${tree.length} COMMITTED LESSONS (language ${dictionaryReport.allLessons.languages.join('/')}): ` +
      `${treeTokens} tokens, ${((treeOov / treeTokens) * 100).toFixed(1)}% OOV`,
  );
  console.log(`   the misses: ${[...treeMissing].sort().join(', ') || 'none'}`);
  console.log('');
  console.log('   A dictionary HIT is not a correct pronunciation. "beta" is in this');
  console.log('   dictionary as the Greek letter (B EY T AH), not as the Hindi word a');
  console.log('   tutor says to a child. The OOV rate is a FLOOR on the damage.');
  console.log('');
} else {
  console.log(`## dictionary coverage — unavailable: ${dict.reason}`);
  console.log('');
  dictionaryReport.reason = dict.reason;
}

console.log('NO ACCURACY NUMBER APPEARS ABOVE, AND NONE CAN. Nothing here has been');
console.log('hand-labelled, so there is no answer to compare against. Every column is a');
console.log('fact about the OUTPUT: how often the mouth is asked to change, how long it');
console.log('holds, how much of the clip it spends shut, and how often two recognisers');
console.log('name a different shape. Two pipelines agreeing does not make either right.');

if (outPath) {
  writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        lessonId,
        lessonLanguage: corpus.language,
        voice: corpus.voice,
        model: corpus.model,
        sampleRateHz: SAMPLE_RATE_HZ,
        rhubarb: rhubarbAvailable.ok ? rhubarbAvailable.from : null,
        generatedBy: 'tools/lipsync/bin/compare.mjs',
        results,
        dictionary: dictionaryReport,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.error(`\nwrote ${outPath}`);
}
