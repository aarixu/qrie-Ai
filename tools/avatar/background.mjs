/**
 * THE ROOM BEHIND HER — a background for the 3D tutor's tile (Aarav,
 * 2026-10-02: "normal BG like drawing room or anything relevant to AI tutor",
 * not tied to the topic).
 *
 * One still, generated once with the project's own Gemini image model, and
 * kept as an asset beside the avatar (content/avatars/backgrounds/). Nothing is
 * downloaded from anywhere else, so there is no third-party licence to track.
 * It is soft and out of focus on purpose: she is what a student looks at, and a
 * sharp room behind her competes with her face for a tile a few hundred pixels
 * wide.
 *
 *   node tools/avatar/background.mjs            # says what it would do
 *   node tools/avatar/background.mjs --spend    # generates the candidates
 *
 * Candidates are written as PNG to tools/avatar/out/ (ignored); the one chosen
 * is converted with ffmpeg (libwebp, as bake-f02.mjs does) by
 *   node tools/avatar/background.mjs --keep <candidate.png>
 * The key is read from .env.local inside this process and never printed.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnvLocal } from '../prewarm/lib/envLocal.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const OUT = join(HERE, 'out');
const KEEP = join(ROOT, 'content/avatars/backgrounds/study.webp');
/**
 * The model class preparation draws its pictures with, asked through the
 * project's own relay (Vertex), the way a class's pictures are. The AI Studio
 * key came back 429 "quota exceeded" for every image model (2026-10-02).
 */
const MODEL = 'google/gemini-3.1-flash-image';
const CANDIDATES = 3;

const PROMPT = [
  'A photograph of a warm, tidy home study corner in an Indian home, seen from where a video-call camera would sit,',
  'used as the background of a friendly tutor on a video call.',
  'Wooden bookshelf with neatly arranged books, a small potted plant, a desk lamp glowing softly, a window with daylight,',
  'a cream wall. Calm, inviting, uncluttered.',
  'Shallow depth of field: the whole room is softly out of focus, like a portrait-mode background.',
  'Nobody in the frame. No text, no logos, no screens, no posters with writing.',
  'Landscape, 16:9.',
].join(' ');

const args = process.argv.slice(2);

if (args[0] === '--keep') {
  const from = args[1];
  if (!from) throw new Error('--keep needs the candidate PNG to keep');
  mkdirSync(dirname(KEEP), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', from, '-vf', 'scale=1280:-2', '-c:v', 'libwebp', '-quality', '78', KEEP]);
  console.log(`kept ${KEEP} (${Math.round(statSync(KEEP).size / 1024)} KB)`);
  process.exit(0);
}

if (!args.includes('--spend')) {
  console.log(`Would ask ${MODEL} for ${CANDIDATES} candidates (one paid image call each) and write them to ${OUT}.`);
  console.log('Re-run with --spend to do it.');
  process.exit(0);
}

const env = readEnvLocal(join(ROOT, '.env.local'));
mkdirSync(OUT, { recursive: true });
// One anonymous identity, as the app makes for a student, metered like one.
const signup = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/signup`, {
  method: 'POST',
  headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'content-type': 'application/json' },
  body: '{}',
});
const { access_token: auth } = await signup.json();
if (!auth) throw new Error(`anonymous sign-up failed (${signup.status})`);

for (let n = 1; n <= CANDIDATES; n += 1) {
  const res = await fetch(`${env.VITE_RELAY_URL}/api/llm`, {
    method: 'POST',
    headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: PROMPT }] }),
  });
  const body = await res.json().catch(() => ({}));
  const url = body.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  const data = typeof url === 'string' ? /^data:image\/\w+;base64,(.+)$/.exec(url)?.[1] : undefined;
  if (!res.ok || !data) {
    console.log(`candidate ${n}: ${res.status} ${JSON.stringify(body.error ?? body).slice(0, 300)}`);
    continue;
  }
  const file = join(OUT, `study-${n}.png`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`candidate ${n}: ${file} (${Math.round(statSync(file).size / 1024)} KB)`);
}
void readFileSync;
