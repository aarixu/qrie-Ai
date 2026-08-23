import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Lesson } from '../../../packages/lesson-format/src/types.ts';
import { TUTOR } from '../../../packages/persona/src/traits.ts';
import {
  buildSpeechPrompt,
  hashNarration,
  parseManifest,
  type NarrationManifest,
} from '../../../packages/voice/src/index.ts';
import { checkTake, expectedDurationMs } from '../src/audio.ts';
import { audioTokensForMs, costForDurationMs, estimateCostUsd, formatUsd } from '../src/cost.ts';
import { planRender } from '../src/plan.ts';
import { planForLesson } from '../src/render.ts';

/**
 * The decisions taken before a single request is paid for: what to re-render,
 * whether a take that came back is usable, and what the run will cost. All of
 * it is pure, so all of it is tested without a network, a clock or ffmpeg.
 */

const lesson = (narrations: Record<string, string>): Lesson => ({
  formatVersion: 1,
  id: 'test-lesson',
  title: 'Blood & Its Components',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements: [{ kind: 'title', id: 't', x: 500, y: 80, text: 'Blood' }],
  beats: Object.entries(narrations).map(([id, narration]) => ({
    id,
    topic: `About ${id}`,
    narration,
    show: ['t'],
  })),
});

const manifestFor = (lessonId: string, beats: Record<string, string>): NarrationManifest => ({
  formatVersion: 1,
  lessonId,
  voice: 'Sulafat',
  model: 'gemini-3.1-flash-tts-preview',
  beats: Object.fromEntries(
    Object.entries(beats).map(([id, narration]) => [
      id,
      { file: `${id}.m4a`, durationMs: 8000, hash: hashNarration(narration) },
    ]),
  ),
});

const OPTS = { voice: 'Sulafat', model: 'gemini-3.1-flash-tts-preview', audioExists: () => true };

describe('planRender', () => {
  const AS_RECORDED = 'Blood is a tissue, not a fluid, and it does four jobs at once.';
  const EDITED = 'Blood is a tissue, not a fluid, and it does three jobs at once.';

  it('skips a beat whose narration still hashes to what was recorded', () => {
    const plan = planRender(
      lesson({ hook: AS_RECORDED }),
      manifestFor('test-lesson', { hook: AS_RECORDED }),
      OPTS,
    );

    expect(plan.render).toEqual([]);
    expect(plan.skip).toEqual([{ beatId: 'hook', durationMs: 8000 }]);
  });

  it('re-renders a beat whose narration has been edited since it was recorded', () => {
    const plan = planRender(
      lesson({ hook: AS_RECORDED, recap: EDITED }),
      manifestFor('test-lesson', { hook: AS_RECORDED, recap: AS_RECORDED }),
      OPTS,
    );

    expect(plan.skip.map((s) => s.beatId)).toEqual(['hook']);
    expect(plan.render).toEqual([
      { beatId: 'recap', reason: 'narration changed', estimatedMs: expectedDurationMs(EDITED) },
    ]);
  });

  it('does not re-render a beat that was only re-wrapped', () => {
    const plan = planRender(
      lesson({ hook: `Blood is a tissue, not a fluid,\n  and it does four jobs at once.` }),
      manifestFor('test-lesson', { hook: AS_RECORDED }),
      OPTS,
    );

    expect(plan.render).toEqual([]);
  });
});

describe('checkTake', () => {
  // 40 words: an unhurried reading of this runs about 17 seconds.
  const narration = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');

  it('accepts a take of a plausible length for its word count', () => {
    expect(checkTake(narration, 17_000)).toEqual({ ok: true });
  });

  it('rejects a take far too short for its word count', () => {
    const result = checkTake(narration, 1_200);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('truncated');
  });

  it("rejects a take long enough to be the director's notes read aloud", () => {
    const result = checkTake(narration, 90_000);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("director's notes");
  });
});

describe('cost', () => {
  it('bills a known token count at the published rate', () => {
    expect(audioTokensForMs(1_000)).toBe(32);
    expect(estimateCostUsd(1_000_000)).toBeCloseTo(20, 10);
    expect(estimateCostUsd(115_200)).toBeCloseTo(2.304, 10);
  });

  it('prices an hour of finished narration at about $2.30', () => {
    expect(audioTokensForMs(60 * 60 * 1000)).toBe(115_200);
    expect(formatUsd(costForDurationMs(60 * 60 * 1000))).toBe('$2.30');
  });

  it('never rounds a real sub-cent cost away to nothing', () => {
    expect(formatUsd(costForDurationMs(5_000))).toBe('$0.0032');
    expect(formatUsd(0)).toBe('$0.00');
  });
});

describe('buildSpeechPrompt', () => {
  const prompt = buildSpeechPrompt('Blood is a tissue.', {
    lessonTitle: 'Blood & Its Components',
    beatTopic: 'What blood is',
  });

  it('speaks as the one persona rather than as a locally worded tutor', () => {
    expect(prompt).toContain(TUTOR.name);
    expect(prompt).toContain(TUTOR.voice);
  });

  it('carries the lesson and the beat into the scene, and the words last', () => {
    expect(prompt).toContain('Blood & Its Components');
    expect(prompt).toContain('What blood is');
    expect(prompt.trimEnd().endsWith('Blood is a tissue.')).toBe(true);
  });
});

/**
 * THE COMMITTED CLASS. This lesson was rendered by this tool and its audio is
 * in the repo; if a change here made the plan want to re-render any of it, the
 * committed take and the committed script would have quietly stopped agreeing.
 */
describe('content/class10-blood', () => {
  const lessonDir = path.join(process.cwd(), 'content', 'class10-blood');
  const recorded = JSON.parse(
    fs.readFileSync(path.join(lessonDir, 'lesson.json'), 'utf8'),
  ) as Lesson;

  it('has a manifest @ai-tutor/voice accepts', () => {
    const json: unknown = JSON.parse(
      fs.readFileSync(path.join(lessonDir, 'audio', 'narration.json'), 'utf8'),
    );
    const manifest = parseManifest(json);
    expect(manifest).not.toBeNull();
    expect(manifest?.lessonId).toBe('class10-blood');
    expect(Object.keys(manifest?.beats ?? {})).toEqual(recorded.beats.map((b) => b.id));
  });

  it('was recorded in the voice the live tutor still speaks in', () => {
    // Changing TUTOR.speechVoiceName re-records nothing. Without this check the
    // recording would keep the old voice, the live doubt agent would answer in
    // the new one, and a student would meet two teachers inside one class.
    const manifest = parseManifest(
      JSON.parse(fs.readFileSync(path.join(lessonDir, 'audio', 'narration.json'), 'utf8')),
    );
    expect(manifest?.voice).toBe(TUTOR.speechVoiceName);
  });

  it('is entirely up to date — every beat still hashes to its take', () => {
    const { plan, problem } = planForLesson(recorded, lessonDir, {
      voice: 'Sulafat',
      model: 'gemini-3.1-flash-tts-preview',
    });

    expect(problem).toBeUndefined();
    expect(plan.render).toEqual([]);
    expect(plan.stale).toEqual([]);
    expect(plan.skip).toHaveLength(6);
  });
});
