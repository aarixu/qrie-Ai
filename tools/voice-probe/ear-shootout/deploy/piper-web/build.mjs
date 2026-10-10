// Bundles @mintplex-labs/piper-tts-web 1.0.5 for the browser with three patches:
//  1. voices come from the OFFICIAL rhasspy/piper-voices repo (the package points at a mirror that predates the Hindi voices);
//  2. the three Hindi voices (pratham, priyamvada, rohan; medium) are added to its voice map;
//  3. onnxruntime-web is pinned to 1.18.0 in node_modules so its JS matches the 1.18.0 wasm files the package loads from cdnjs.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const dist = 'node_modules/@mintplex-labs/piper-tts-web/dist';
let src = readFileSync(`${dist}/piper-tts-web.js`, 'utf8');

const before = src.length;
src = src.replace('https://huggingface.co/diffusionstudio/piper-voices/resolve/main', 'https://huggingface.co/rhasspy/piper-voices/resolve/main');
if (!src.includes('rhasspy/piper-voices')) throw new Error('HF_BASE patch did not apply');

const hindi = ['pratham', 'priyamvada', 'rohan']
  .map((v) => `  "hi_IN-${v}-medium": "hi/hi_IN/${v}/medium/hi_IN-${v}-medium.onnx",\n`)
  .join('');
src = src.replace('const PATH_MAP = {\n', `const PATH_MAP = {\n${hindi}`);
if (!src.includes('hi_IN-pratham-medium')) throw new Error('PATH_MAP patch did not apply');

writeFileSync(`${dist}/piper-tts-web.patched.js`, src);
console.log('patched', before, '->', src.length, 'chars');

writeFileSync('entry.js', `import { TtsSession } from './${dist}/piper-tts-web.patched.js';\nwindow.PiperTts = { TtsSession };\nwindow.dispatchEvent(new Event('piper-ready'));\n`);

rmSync('out', { recursive: true, force: true });
mkdirSync('out', { recursive: true });
const res = await build({
  entryPoints: ['entry.js'],
  bundle: true,
  format: 'esm',
  splitting: true,
  outdir: 'out',
  minify: true,
  target: 'es2020',
  platform: 'browser',
  external: ['node:*', 'fs', 'path', 'os', 'worker_threads', 'child_process', 'crypto'],
  logLevel: 'info',
  metafile: true,
});
for (const [f, m] of Object.entries(res.metafile.outputs)) console.log(f.padEnd(34), (m.bytes / 1024).toFixed(0).padStart(6), 'KB');
