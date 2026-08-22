import fs from 'node:fs';
import path from 'node:path';
import type { Element, Lesson } from '../../../packages/lesson-format/src/types.ts';
import type { ImageModel } from './imageModel.ts';
import { buildImagePrompt } from './prompt.ts';

/**
 * Generating a lesson's artwork.
 *
 * Sequential on purpose: image models rate-limit hard, and a parallel burst
 * turns one slow run into a run that fails halfway. A single failure never
 * aborts the batch — the author gets everything that worked plus a precise
 * list of what didn't.
 */

const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
};

/** Deterministic asset path. A lesson's `src` field must match this exactly. */
export function planFilename(elementId: string, mimeType: string): string {
  const ext = EXTENSIONS[mimeType.toLowerCase()] ?? '.png';
  return `assets/${elementId}${ext}`;
}

export interface GenerateOptions {
  /** Regenerate even when the asset file already exists. */
  force?: boolean;
  /** Print the prompts, generate nothing, write nothing. */
  dryRun?: boolean;
}

export interface GenerateReport {
  generated: { elementId: string; file: string; bytes: number }[];
  skipped: { elementId: string; reason: string }[];
  failed: { elementId: string; error: string }[];
  prompts: { elementId: string; prompt: string }[];
}

type ImageElement = Extract<Element, { kind: 'image' }>;

const imageElements = (lesson: Lesson): ImageElement[] =>
  lesson.elements.filter((el): el is ImageElement => el.kind === 'image');

/**
 * @param lessonDir absolute path to the lesson's folder (where assets/ lives)
 */
export async function generateForLesson(
  lesson: Lesson,
  model: ImageModel,
  lessonDir: string,
  opts: GenerateOptions = {},
): Promise<GenerateReport> {
  const report: GenerateReport = { generated: [], skipped: [], failed: [], prompts: [] };

  for (const el of imageElements(lesson)) {
    const prompt = buildImagePrompt(el, lesson);
    report.prompts.push({ elementId: el.id, prompt });

    if (opts.dryRun) {
      report.skipped.push({ elementId: el.id, reason: 'dry run' });
      continue;
    }

    // The element's own src is the source of truth for where the file goes —
    // generating to a different path would leave the lesson pointing at nothing.
    const target = path.join(lessonDir, el.src);
    if (!opts.force && fs.existsSync(target)) {
      report.skipped.push({ elementId: el.id, reason: 'already exists' });
      continue;
    }

    try {
      const image = await model.generate(prompt);
      const bytes = Buffer.from(image.base64, 'base64');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
      report.generated.push({ elementId: el.id, file: el.src, bytes: bytes.length });
    } catch (e) {
      report.failed.push({ elementId: el.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return report;
}
