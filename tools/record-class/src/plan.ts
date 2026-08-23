import type { Beat, Lesson } from '../../../packages/lesson-format/src/types.ts';
import { expectedDurationMs } from './audio.ts';
import { hashNarration, type NarrationEntry, type NarrationManifest } from './manifest.ts';

/**
 * WHAT THIS RUN WOULD DO, decided before anything is spent.
 *
 * Pure: no fs, no network, no clock. That is what lets --dry-run print exactly
 * the run the real command would perform, and it is what makes "re-run after
 * fixing one sentence" a cheap, boring operation rather than a decision the
 * author has to weigh.
 */

export type RenderReason =
  | 'new'
  | 'narration changed'
  | 'audio file missing'
  | 'forced'
  | 'voice changed'
  | 'model changed';

export interface PlannedRender {
  beatId: string;
  reason: RenderReason;
  /** Predicted from the word count — the only estimate available before rendering. */
  estimatedMs: number;
}

export interface PlannedSkip {
  beatId: string;
  /** Real measured duration, carried over from the manifest. */
  durationMs: number;
}

export interface RenderPlan {
  render: PlannedRender[];
  skip: PlannedSkip[];
  /** Manifest entries whose beat no longer exists in the lesson. */
  stale: string[];
}

export interface PlanOptions {
  voice: string;
  model: string;
  force?: boolean;
  /** True when the .m4a named by a manifest entry is already on disk. */
  audioExists: (fileName: string) => boolean;
}

type Decision = { render: RenderReason } | { skip: NarrationEntry };

/**
 * A manifest rendered in a different voice or from a different model cannot be
 * mixed with new takes: half a class in one voice and half in another is a seam
 * a student hears instantly, which is the one thing this product may not do.
 */
function decide(beat: Beat, manifest: NarrationManifest | null, opts: PlanOptions): Decision {
  if (opts.force) return { render: 'forced' };
  if (!manifest) return { render: 'new' };
  if (manifest.voice !== opts.voice) return { render: 'voice changed' };
  if (manifest.model !== opts.model) return { render: 'model changed' };

  const entry = manifest.beats[beat.id];
  if (!entry) return { render: 'new' };
  if (entry.hash !== hashNarration(beat.narration)) return { render: 'narration changed' };
  if (!opts.audioExists(entry.file)) return { render: 'audio file missing' };
  return { skip: entry };
}

export function planRender(
  lesson: Lesson,
  manifest: NarrationManifest | null,
  opts: PlanOptions,
): RenderPlan {
  const plan: RenderPlan = { render: [], skip: [], stale: [] };

  for (const beat of lesson.beats) {
    const decision = decide(beat, manifest, opts);
    if ('render' in decision) {
      plan.render.push({
        beatId: beat.id,
        reason: decision.render,
        estimatedMs: expectedDurationMs(beat.narration),
      });
    } else {
      plan.skip.push({ beatId: beat.id, durationMs: decision.skip.durationMs });
    }
  }

  if (manifest) {
    const live = new Set(lesson.beats.map((b) => b.id));
    plan.stale = Object.keys(manifest.beats).filter((beatId) => !live.has(beatId));
  }
  return plan;
}
