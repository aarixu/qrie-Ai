/**
 * DOES ON-DEVICE SPEECH ACTUALLY WORK, AND HOW BIG AND HOW SLOW IS IT?
 *
 * Three numbers decide whether the tutor can speak and listen without a
 * network, and none of them can be reasoned about from a model card:
 *
 *   1. Does it run at all through transformers.js, which is the only way it
 *      reaches a Capacitor WebView without a native plugin.
 *   2. What it WEIGHS once quantised, because a sideloaded APK has no size
 *      limit but a Play release has 150 MB and the app is already 18.
 *   3. What it COSTS in time per sentence. A tutor who pauses four seconds
 *      before every line is not a tutor, however local she is.
 *
 * Node here rather than a browser, deliberately: transformers.js runs the same
 * ONNX through the same onnxruntime, so a failure here is a real failure and a
 * success is a floor. The phone is slower and that is the next measurement,
 * not this one.
 *
 *   node tools/bin/speech-spike.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const OUT = '.scratch/speech';
fs.mkdirSync(OUT, { recursive: true });

const say = (line) => {
  console.log(line);
  fs.appendFileSync(path.join(OUT, 'spike.txt'), line + String.fromCharCode(10));
};

fs.writeFileSync(path.join(OUT, 'spike.txt'), '');

/** What a tutor really says, not "hello world". */
const LINES = [
  'Namaste. Today we are going to look inside a kidney.',
  'Look at the outer layer. That is the cortex, and it is where the filtering starts.',
  'So tell me — where do you think the blood goes after that?',
];

const dirSize = (dir) => {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(full) : fs.statSync(full).size;
  }
  return total;
};

const CACHE = path.resolve(OUT, 'models');
process.env.HF_HOME = CACHE;
process.env.TRANSFORMERS_CACHE = CACHE;

const { pipeline, env } = await import('@huggingface/transformers');
env.cacheDir = CACHE;
env.allowLocalModels = false;

// ------------------------------------------------------------------- TTS --

say('=== TTS: Supertonic through transformers.js ===');
try {
  const t0 = Date.now();
  /**
   * fp32, because that is ALL THERE IS.
   *
   * The repo publishes one variant per graph — text_encoder, latent_denoiser
   * and voice_decoder, each as a stub plus external .onnx_data — and no
   * quantized build at all. Asking for q8 fails looking for a file that was
   * never uploaded. The int8 Supertonic that does exist is packaged for
   * sherpa-onnx, whose npm package is a Node native addon and cannot enter a
   * WebView, so it is 262 MB here or a native plugin there.
   */
  const tts = await pipeline('text-to-speech', 'onnx-community/Supertonic-TTS-2-ONNX');
  say(`  loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  say(`  weights on disk: ${(dirSize(CACHE) / 1e6).toFixed(1)} MB`);

  const speaker = 'https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/voices/F1.bin';
  let spoken = 0;
  let took = 0;
  for (const line of LINES) {
    const t = Date.now();
    const audio = await tts(`<en>${line}</en>`, { speaker_embeddings: speaker });
    const ms = Date.now() - t;
    const seconds = audio.audio.length / audio.sampling_rate;
    spoken += seconds;
    took += ms;
    say(`  ${(ms / 1000).toFixed(2)}s to make ${seconds.toFixed(2)}s of speech  (${(seconds / (ms / 1000)).toFixed(1)}x realtime)`);
  }
  say(`  OVERALL ${(spoken / (took / 1000)).toFixed(1)}x realtime on this machine`);
} catch (e) {
  say(`  FAILED: ${e.message.slice(0, 300)}`);
}

// ------------------------------------------------------------------- STT --

say('');
say('=== STT: Whisper through transformers.js ===');
try {
  const before = dirSize(CACHE);
  const t0 = Date.now();
  // q8 here is real: encoder 10 MB, merged decoder 31 MB.
  const stt = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', {
    dtype: 'q8',
  });
  say(`  loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  say(`  weights on disk: ${((dirSize(CACHE) - before) / 1e6).toFixed(1)} MB`);

  // Five seconds of 16 kHz silence: this measures the RUNTIME, not accuracy.
  // Accuracy needs a real voice and belongs on the phone, with a real student.
  const audio = new Float32Array(16000 * 5);
  const t = Date.now();
  await stt(audio);
  say(`  ${((Date.now() - t) / 1000).toFixed(2)}s for 5s of audio`);
} catch (e) {
  say(`  FAILED: ${e.message.slice(0, 300)}`);
}

say('');
say(`total weights: ${(dirSize(CACHE) / 1e6).toFixed(1)} MB`);
