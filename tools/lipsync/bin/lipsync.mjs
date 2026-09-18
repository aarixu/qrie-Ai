#!/usr/bin/env node
// THE CLI — audio in, narration text in, the one format out.
//
//   node tools/lipsync/bin/lipsync.mjs --audio clip.m4a --text script.txt
//   node tools/lipsync/bin/lipsync.mjs --audio clip.m4a --text - --driver rules
//   node tools/lipsync/bin/lipsync.mjs --duration 19.68 --text script.txt -o out.json
//
// --driver auto (the default) uses Rhubarb when it is installed and falls
// back to the rule table when it is not. The output format is IDENTICAL
// either way, which is the entire point of the exercise: the renderer, the
// illustrator and the app never learn which one ran.
//
// EXIT CODES: 0 clean, 1 refused. It refuses rather than guessing — a build
// step that silently emits an empty timeline ships a tutor whose mouth never
// moves, and that failure is invisible until a child is watching it.

import { readFileSync, writeFileSync } from 'node:fs';

import { checkFfmpeg, decodePcm16k, pcmDurationSec, probeDurationSec } from '../lib/audio.mjs';
import { MOUTH_SHAPES, SHAPE_NOTES, SHUT_SHAPES, timelineBytes, validateTimeline } from '../lib/format.mjs';
import { clipMetrics } from '../lib/metrics.mjs';
import { INSTALL_HINT, alignByRhubarb, loadRhubarb } from '../lib/rhubarb-driver.mjs';
import { readableFraction } from '../lib/rules.mjs';
import { alignByRules } from '../lib/rules-driver.mjs';

const USAGE = `
lipsync — narration audio + script -> [{ t, d, v }] mouth timeline

  --audio <file>      audio to align (any format ffmpeg reads)
  --text <file|->     narration script; - reads stdin
  --duration <sec>    clip length, when there is no audio file (rules driver only)
  --driver <name>     auto | rhubarb | rules      (default: auto)
  --lead-ms <n>       shift the mouth earlier by n ms (rules driver only; the
                      rhubarb driver takes its timing from the audio)
  --out <file>        write JSON here (default: stdout)
  --shapes            print the nine mouth shapes and exit
  --check             report whether rhubarb and ffmpeg are available, and exit
`.trim();

function parseArgs(argv) {
  const args = { driver: 'auto', leadMs: 0 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => argv[++i];
    if (flag === '--audio') args.audio = value();
    else if (flag === '--text') args.text = value();
    else if (flag === '--duration') args.duration = Number.parseFloat(value());
    else if (flag === '--driver') args.driver = value();
    else if (flag === '--lead-ms') args.leadMs = Number.parseFloat(value());
    else if (flag === '--out' || flag === '-o') args.out = value();
    else if (flag === '--shapes') args.shapes = true;
    else if (flag === '--check') args.check = true;
    else if (flag === '--help' || flag === '-h') args.help = true;
    else throw new Error(`unknown flag ${flag}`);
  }
  return args;
}

function readText(spec) {
  if (spec === '-') return readFileSync(0, 'utf8');
  return readFileSync(spec, 'utf8');
}

function die(message) {
  console.error(message);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(USAGE);
  process.exit(0);
}

if (args.shapes) {
  // The commission brief, printable. Nine drawings over one locked face.
  for (const shape of MOUTH_SHAPES) console.log(`${shape}  ${SHAPE_NOTES[shape]}`);
  process.exit(0);
}

if (args.check) {
  const ffmpegProblem = checkFfmpeg();
  console.log(`ffmpeg   ${ffmpegProblem ? `NO — ${ffmpegProblem}` : 'yes'}`);
  const rhubarb = await loadRhubarb();
  console.log(`rhubarb  ${rhubarb.ok ? `yes — ${rhubarb.from}` : `NO — install with:\n         ${INSTALL_HINT}`}`);
  process.exit(0);
}

if (!args.text) die(`${USAGE}\n\nrefused: --text is required. The script is the input this tool is built around.`);
if (!args.audio && !Number.isFinite(args.duration)) {
  die('refused: give --audio, or --duration for a text-only run. Without one of them there is no clock to scale to.');
}

const text = readText(args.text).trim();
if (!text) die('refused: the narration text is empty.');

let duration = args.duration;
let pcm = null;

if (args.audio) {
  const ffmpegProblem = checkFfmpeg();
  if (ffmpegProblem) die(`refused: ${ffmpegProblem}`);
  duration = probeDurationSec(args.audio);
}

// The rhubarb driver reads its timing off the waveform, so there is nothing
// for a lead to shift. Accepting the flag and dropping it would hand somebody
// an unshifted timeline and exit 0 — the quiet kind of wrong this tool is
// built to refuse.
if (args.leadMs && args.driver === 'rhubarb') {
  die('refused: --lead-ms is a rule-table lever. The rhubarb driver takes its timing from the audio.');
}

let driver = args.driver;
if (driver === 'auto') {
  const rhubarb = await loadRhubarb();
  driver = rhubarb.ok && args.audio ? 'rhubarb' : 'rules';
}

let cues;
if (driver === 'rhubarb') {
  if (!args.audio) die('refused: the rhubarb driver reads audio. Pass --audio, or use --driver rules.');
  pcm = decodePcm16k(args.audio);
  // A container duration and a decoded-sample duration that disagree mean the
  // timeline is being scaled against the wrong clock. Say so; do not average.
  const decoded = pcmDurationSec(pcm);
  if (Math.abs(decoded - duration) > 0.05) {
    console.error(`note: container says ${duration.toFixed(3)}s, decoded PCM says ${decoded.toFixed(3)}s`);
  }
  ({ cues } = await alignByRhubarb(pcm, { dialogText: text, duration }));
} else if (driver === 'rules') {
  // The table reads Latin letters. Anything else becomes a pause, so a script
  // it can only half-read yields a mouth that rests through the half it cannot
  // — not a refusal, but not the thing anybody thinks they asked for either.
  const readable = readableFraction(text);
  if (readable < 1) {
    console.error(
      `note: the rule table read ${(readable * 100).toFixed(0)}% of this script's letters. ` +
        'The rest is not Latin, so it becomes a pause — a shut mouth, not a shape.',
    );
  }
  cues = alignByRules(text, duration, { leadMs: args.leadMs });
} else {
  die(`refused: unknown driver ${JSON.stringify(driver)}. Use auto, rhubarb or rules.`);
}

const problems = validateTimeline(cues);
if (problems.length > 0) die(`refused: the timeline this run produced is not valid:\n  ${problems.join('\n  ')}`);
if (cues.length === 0) die('refused: produced an empty timeline. A mouth that never moves is not an output.');

// Belt-and-braces on the same failure the rules driver already refuses: a
// timeline made only of A and X is a face that never opens its mouth. It is a
// structurally valid timeline, which is exactly what makes it dangerous — it
// passes validateTimeline, it passes a length check, and it ships.
if (cues.every((c) => SHUT_SHAPES.has(c.v))) {
  die('refused: this script produced a mouth that never opens. The rule table reads Latin letters only.');
}

const json = JSON.stringify(cues);
if (args.out) {
  writeFileSync(args.out, `${json}\n`, 'utf8');
  const m = clipMetrics(cues, duration);
  console.error(
    `${args.out}  driver=${driver}  ${cues.length} cues  ${duration.toFixed(2)}s  ` +
      `${timelineBytes(cues)} bytes (${(m.bytesPerMinute / 1024).toFixed(2)} KB/min)`,
  );
} else {
  process.stdout.write(`${json}\n`);
}
