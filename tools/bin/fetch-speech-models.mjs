/**
 * THE SPEECH MODELS, INTO THE APP ITSELF.
 *
 * transformers.js will happily download these from Hugging Face on first use.
 * That is the wrong shape for this app twice over: a student on a phone would
 * wait through three hundred megabytes before the tutor said a word, and a
 * student with no network — which is most of the ways a class gets taken here
 * — would never get a voice at all. So they ship inside the APK and the app
 * loads them from its own origin.
 *
 * Only the variants that are actually used. whisper-tiny.en publishes fp32,
 * fp16, int8, uint8, q4 and bnb4 of every graph; taking all of them would be
 * 800 MB for the 43 MB the app asks for.
 *
 *   node tools/bin/fetch-speech-models.mjs
 *
 * Writes content/models/<repo>/…, which is gitignored: a downloadable artefact
 * that would dwarf the repository.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const OUT = 'content/models';

/**
 * What each model needs, listed rather than globbed.
 *
 * `keep` is matched against the path inside the repo. The TTS has no quantized
 * build at all — one variant per graph, each a stub plus external .onnx_data —
 * so it takes everything under onnx/. Whisper has six, and takes two.
 */
const MODELS = [
  {
    repo: 'onnx-community/Supertonic-TTS-2-ONNX',
    keep: (f) =>
      f.startsWith('onnx/') ||
      f === 'config.json' ||
      f.startsWith('tokenizer') ||
      // One voice. The other nine are 52 KB each and nobody has chosen them.
      f === 'voices/F1.bin',
  },
  {
    repo: 'onnx-community/whisper-tiny.en',
    keep: (f) =>
      f === 'onnx/encoder_model_quantized.onnx' ||
      f === 'onnx/decoder_model_merged_quantized.onnx' ||
      (!f.startsWith('onnx/') && f.endsWith('.json')) ||
      f === 'merges.txt' ||
      f === 'vocab.txt',
  },
];

const mb = (n) => (n / 1e6).toFixed(1);

let fetched = 0;
let bytes = 0;

for (const model of MODELS) {
  const listing = await fetch(`https://huggingface.co/api/models/${model.repo}?blobs=true`);
  if (!listing.ok) throw new Error(`${model.repo}: HTTP ${listing.status}`);
  const files = ((await listing.json()).siblings ?? []).filter((f) => model.keep(f.rfilename));

  const want = files.reduce((n, f) => n + (f.size ?? 0), 0);
  console.log(`\n=== ${model.repo} — ${files.length} files, ${mb(want)} MB`);

  for (const file of files) {
    const dest = path.join(OUT, model.repo, file.rfilename);
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    // Already here and the right size: a re-run after a failed build should
    // not re-download a quarter of a gigabyte.
    if (fs.existsSync(dest) && fs.statSync(dest).size === file.size) {
      console.log(`    have  ${file.rfilename}`);
      bytes += file.size ?? 0;
      continue;
    }

    const url = `https://huggingface.co/${model.repo}/resolve/main/${file.rfilename}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`    FAILED ${file.rfilename} — HTTP ${res.status}`);
      process.exitCode = 1;
      continue;
    }
    // Streamed to disk. A 132 MB .onnx_data through arrayBuffer() is 132 MB
    // held in memory for no reason.
    await streamPipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
    const got = fs.statSync(dest).size;
    bytes += got;
    fetched += 1;
    console.log(`    ${String(mb(got)).padStart(7)} MB  ${file.rfilename}`);
  }
}

console.log(`\n${fetched} downloaded, ${mb(bytes)} MB in ${OUT}`);

/**
 * THE RUNTIME'S OWN WASM, out of node_modules and into the bundle.
 *
 * onnxruntime-web fetches these from a CDN by default, which would make the
 * voice depend on a network in exactly the situation the models exist to
 * survive. Copied rather than imported: they are loaded by URL at runtime, not
 * by the bundler.
 *
 * Both the plain build and the jsep one. jsep is the WebGPU path — a phone
 * that has it is several times faster, and a phone that does not falls back to
 * the plain build rather than to nothing.
 */
const WASM_OUT = 'content/wasm';
const WASM_FILES = [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
];

const wasmSrc = 'node_modules/onnxruntime-web/dist';
if (fs.existsSync(wasmSrc)) {
  fs.mkdirSync(WASM_OUT, { recursive: true });
  let wasmBytes = 0;
  for (const name of WASM_FILES) {
    const from = path.join(wasmSrc, name);
    if (!fs.existsSync(from)) continue;
    fs.copyFileSync(from, path.join(WASM_OUT, name));
    wasmBytes += fs.statSync(from).size;
  }
  console.log(`${WASM_FILES.length} runtime files, ${mb(wasmBytes)} MB in ${WASM_OUT}`);
} else {
  console.error('onnxruntime-web is not installed; the voice will fetch its runtime from a CDN.');
}
