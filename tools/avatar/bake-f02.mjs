#!/usr/bin/env node
/**
 * BAKE F02 — Meera's 3D body as one small GLB plus four WebP textures.
 *
 *   node tools/avatar/bake-f02.mjs
 *
 * Source: Microsoft Rocketbox (MIT), Female_Adult_02 and its female mocap.
 * The raw files are large (a 2 MB model FBX with 175 face shapes, 2K TGAs,
 * and clips of 1.4-5.9 MB each), so they live in assets/raw/rocketbox-f02,
 * which git ignores, and are fetched from GitHub when missing. What is
 * committed is the output in content/avatars/f02.
 *
 * What the bake keeps, and why:
 *   - Face shapes: only the 15 Oculus visemes and the five ARKit shapes the
 *     face loop drives (blinks, brow, smile). The other 155 cost bytes on
 *     every student's phone for nothing.
 *   - The mesh is welded (FBX arrives with every triangle's corners
 *     separate), so each vertex — and each face-shape delta — is stored once.
 *   - Clips: rotations only. Position and scale tracks would walk her out of
 *     the shot, and two 3ds Max helpers (Bip01_Footsteps,
 *     MotionExtractionHelper) are not in the avatar at all.
 *   - Textures leave the GLB as 1K WebP files the page assigns by material
 *     name, so the exporter never needs a canvas.
 * Then gltf-transform resamples the clips (drops keys a straight line
 * already predicts) and meshopt-compresses everything; three.js ships the
 * matching decoder.
 *
 * Needs ffmpeg on PATH (TGA to WebP) and npx (the gltf-transform CLI).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'assets', 'raw', 'rocketbox-f02');
const OUT = join(ROOT, 'content', 'avatars', 'f02');
const GITHUB = 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/';
const AVATAR = 'Assets/Avatars/Adults/Female_Adult_02/';
const CLIP_DIR = 'Assets/Animations/all_animations_max_motextr_static/';

/** The clips HumanAvatar.tsx plays. Keep the two lists in step. */
const CLIPS = [
  'f_idle_neutral_01',
  'f_gestic_presentation_right_01',
  'f_gestic_talk_neutral_01',
  'f_gestic_talk_neutral_02',
  'f_gestic_talk_neutral_03',
  'f_gestic_talk_relaxed_01',
  'f_moderate_01',
  'f_wave_01',
  'f_gestic_thoughtful_01',
  'f_gestic_listen_neutral_01',
  'f_claphands_01',
];

/** Face shapes kept, by their bare FBX name (the "blendShape1." prefix stays on). */
const KEEP_SHAPE = /^(AA_VI_\d\d_\w+|AK_03_BrowInnerUp|AK_09_EyeBlinkLeft|AK_10_EyeBlinkRight|AK_44_MouthSmileLeft|AK_45_MouthSmileRight)$/;

const HELPER_TRACK = /^(Bip01_Footsteps|MotionExtractionHelper)\./;

/** TGA in, 1K WebP out. Quality by eye: colour can lose more than normals can. */
const TEXTURES = [
  { tga: 'f002_head_color.tga', webp: 'f002_head_color.webp', quality: 80 },
  { tga: 'f002_body_color.tga', webp: 'f002_body_color.webp', quality: 80 },
  { tga: 'f002_head_normal.tga', webp: 'f002_head_normal.webp', quality: 85 },
  { tga: 'f002_body_normal.tga', webp: 'f002_body_normal.webp', quality: 85 },
  // Hair, lashes and brows: the alpha channel is the shape, so it must survive.
  { tga: 'f002_opacity_color.tga', webp: 'f002_opacity_color.webp', quality: 85, alpha: true },
];

const kb = (path) => `${(statSync(path).size / 1024).toFixed(0)} KB`;

async function fetchIfMissing(rel, to) {
  if (existsSync(to)) return;
  mkdirSync(dirname(to), { recursive: true });
  const res = await fetch(GITHUB + rel);
  if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`);
  writeFileSync(to, Buffer.from(await res.arrayBuffer()));
  console.log(`fetched ${rel}`);
}

async function sources() {
  await fetchIfMissing('LICENSE.md', join(RAW, 'LICENSE.md'));
  await fetchIfMissing(AVATAR + 'Export/Female_Adult_02_facial.fbx', join(RAW, 'Female_Adult_02_facial.fbx'));
  for (const t of TEXTURES) await fetchIfMissing(AVATAR + 'Textures/' + t.tga, join(RAW, 'tex', t.tga));
  for (const c of CLIPS) await fetchIfMissing(`${CLIP_DIR}${c}.max.fbx`, join(RAW, 'anim', `${c}.fbx`));
}

function textures() {
  for (const t of TEXTURES) {
    const out = join(OUT, t.webp);
    const args = ['-loglevel', 'error', '-y', '-i', join(RAW, 'tex', t.tga), '-vf', 'scale=1024:1024'];
    if (t.alpha) args.push('-pix_fmt', 'yuva420p');
    args.push('-c:v', 'libwebp', '-quality', String(t.quality), out);
    execFileSync('ffmpeg', args);
    console.log(`${t.webp} ${kb(out)}`);
  }
}

/** Just enough DOM for FBXLoader (it asks for texture images) and GLTFExporter (FileReader). */
function nodeShims() {
  const image = () => ({ addEventListener() {}, removeEventListener() {}, style: {}, set src(_v) {} });
  globalThis.document ??= { createElementNS: image, createElement: image };
  globalThis.self ??= globalThis;
  globalThis.FileReader ??= class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onloadend?.();
      });
    }
  };
}

const asArrayBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

async function glb() {
  nodeShims();
  const THREE = await import('three');
  const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const { mergeVertices } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');

  // FBXLoader warns about each face shape's missing normals; that is expected.
  const warn = console.warn;
  console.warn = () => {};
  const model = new FBXLoader().parse(asArrayBuffer(readFileSync(join(RAW, 'Female_Adult_02_facial.fbx'))), '');
  console.warn = warn;

  model.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry;
    const names = Object.keys(o.morphTargetDictionary).sort((a, b) => o.morphTargetDictionary[a] - o.morphTargetDictionary[b]);
    const keep = names.map((n, i) => [n, i]).filter(([n]) => KEEP_SHAPE.test(n.slice(n.lastIndexOf('.') + 1)));
    geo.morphAttributes.position = keep.map(([, i]) => geo.morphAttributes.position[i]);
    const welded = mergeVertices(geo);
    console.log(`mesh ${o.name}: ${geo.attributes.position.count} -> ${welded.attributes.position.count} vertices, ${names.length} -> ${keep.length} face shapes`);
    o.geometry = welded;
    o.morphTargetDictionary = Object.fromEntries(keep.map(([n], j) => [n, j]));
    o.morphTargetInfluences = keep.map(() => 0);
    // Names are what the page keys the WebP textures on; the maps themselves stay out.
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      m.map = null;
      m.normalMap = null;
      m.specularMap = null;
    }
  });

  const clips = CLIPS.map((name) => {
    console.warn = () => {};
    const raw = new FBXLoader().parse(asArrayBuffer(readFileSync(join(RAW, 'anim', `${name}.fbx`))), '').animations[0];
    console.warn = warn;
    const tracks = raw.tracks.filter((t) => t.name.endsWith('.quaternion') && !HELPER_TRACK.test(t.name));
    return new THREE.AnimationClip(name, raw.duration, tracks);
  });

  const data = await new GLTFExporter().parseAsync(model, { binary: true, animations: clips });
  const file = join(tmpdir(), 'f02-unoptimised.glb');
  writeFileSync(file, Buffer.from(data));
  console.log(`unoptimised glb ${kb(file)}`);
  return file;
}

function optimise(input) {
  // npx needs a shell on Windows, and a shell splits paths with spaces (this
  // repo lives under "Ashish Sharma"), so the CLI only ever sees temp paths.
  const resampled = join(tmpdir(), 'f02-resampled.glb');
  const optimised = join(tmpdir(), 'f02-optimised.glb');
  const cli = (...args) =>
    execFileSync('npx', ['-y', '@gltf-transform/cli@4', ...args], { stdio: 'inherit', shell: process.platform === 'win32' });
  cli('resample', input, resampled);
  cli('meshopt', resampled, optimised);
  const out = join(OUT, 'f02.glb');
  copyFileSync(optimised, out);
  console.log(`f02.glb ${kb(out)}`);
}

mkdirSync(OUT, { recursive: true });
await sources();
copyFileSync(join(RAW, 'LICENSE.md'), join(OUT, 'LICENSE.md'));
textures();
optimise(await glb());
