// THE CORPUS — assembled the way tools/stt-spike/make-corpus.mjs assembles
// its own, and for the same stated reason: the mouth's job is to say THESE
// words. "haemoglobin", "capillaries", "platelets" — a generic corpus
// measures a generic mouth.
//
// The difference from the STT spike is what each arm needs. The STT spike
// needed audio for everything, so a missing Piper server meant a missing
// corpus. Here only ONE of the two recognisers needs audio at all, which is
// why this file returns text and audio as separate facts and lets each driver
// take what it can use.
//
// ============================================================================
// THE GROUND-TRUTH AUDIO, AND ALL OF IT.
//
//   content/class10-blood/audio — six .m4a beats, 121.76 s total for 1,462
//   characters of narration, rendered by gemini-3.1-flash-tts-preview in the
//   Sulafat voice (narration.json).
//
// That is the entire stock of rendered narration audio in this repository —
// `find` over the tree returns those six files and their two build copies
// under apps/classroom/dist and the Android assets, nothing else. It is also
// ENGLISH, because every committed lesson is English. Both facts constrain
// every Rhubarb number this tool can produce, and the report leads with them
// rather than burying them.
// ============================================================================

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
const CONTENT = join(REPO, 'content');

/**
 * The beats of one lesson that have BOTH a narration script and a rendered
 * audio file — the only clips on which the two recognisers can be compared at
 * all, because one of them reads audio.
 *
 * @param {string} lessonId
 */
export function audioCorpus(lessonId) {
  const dir = join(CONTENT, lessonId);
  const lesson = JSON.parse(readFileSync(join(dir, 'lesson.json'), 'utf8'));
  const manifestPath = join(dir, 'audio', 'narration.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`${lessonId} has no rendered audio (${manifestPath} missing)`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  const clips = [];
  for (const beat of lesson.beats ?? []) {
    const entry = manifest.beats?.[beat.id];
    const narration = (beat.narration ?? '').trim();
    if (!entry || !narration) continue;
    const audioPath = join(dir, 'audio', entry.file);
    if (!existsSync(audioPath)) continue;
    clips.push({
      id: beat.id,
      audioPath,
      text: narration,
      // The manifest's own millisecond figure. ffprobe is asked separately in
      // the harness and the two are printed side by side: if the manifest and
      // the container disagree, every scaled timeline is built on the wrong
      // clock and that must be visible rather than averaged away.
      manifestDurationSec: entry.durationMs / 1000,
    });
  }
  return {
    lessonId,
    language: lesson.language ?? 'unknown',
    voice: manifest.voice ?? null,
    model: manifest.model ?? null,
    clips,
  };
}

/** The hand-written Hinglish register lines, beat for beat. See corpus/hinglish.json. */
export function hinglishCorpus() {
  return JSON.parse(readFileSync(join(HERE, '..', 'corpus', 'hinglish.json'), 'utf8'));
}

/**
 * Every committed lesson's narration. No audio is required, so this reaches
 * the whole content tree rather than the one lesson that has been rendered —
 * which is what turns the English OOV rate from a fact about `class10-blood`
 * into a baseline the Hinglish figure can be read against.
 *
 * Used by bin/compare.mjs's dictionary section. Nothing else reads it: the
 * rule-table arms need a beat-for-beat Hinglish counterpart, and only
 * class10-blood has one.
 */
export function allNarration() {
  const lessons = readdirSync(CONTENT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(CONTENT, d.name, 'lesson.json')))
    .map((d) => d.name)
    .sort(); // sorted so the corpus is the same on every machine

  return lessons.map((name) => {
    const lesson = JSON.parse(readFileSync(join(CONTENT, name, 'lesson.json'), 'utf8'));
    return {
      lessonId: name,
      language: lesson.language ?? 'unknown',
      lines: (lesson.beats ?? []).map((b) => (b.narration ?? '').trim()).filter(Boolean),
    };
  });
}
