// Leaf modules, not the package index files — see the note in prompt.ts.
import { validateLesson } from '../../../packages/lesson-format/src/validate.ts';
import type { Lesson } from '../../../packages/lesson-format/src/types.ts';
import type { Topic } from '../../../packages/syllabus/src/syllabus.ts';
import type { LlmAdapter } from './llm.ts';
import { buildPrompt, type PromptOptions } from './prompt.ts';

/**
 * The factory loop: prompt → LLM → validate → (one repair retry) → lesson.
 * Validation errors are the repair fuel — lesson-format writes them to be
 * specific and actionable precisely so they can be fed back verbatim here.
 */

/** One image/model3d element the lesson wants generated in a later phase. */
export interface AssetSpecEntry {
  elementId: string;
  kind: 'image' | 'model3d';
  description: string;
  suggestedPrompt: string;
}

export type DesignResult =
  | { ok: true; lesson: Lesson; assetsSpec: AssetSpecEntry[] }
  | { ok: false; errors: string[]; raw: string };

function parseAndValidate(raw: string): { lesson: Lesson | null; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // A parse failure is just another validation error — it goes through the
    // same repair path as a schema violation.
    return { lesson: null, errors: [`reply is not valid JSON: ${(err as Error).message}`] };
  }
  const result = validateLesson(parsed);
  return result.ok ? { lesson: result.lesson, errors: [] } : { lesson: null, errors: result.errors };
}

/** Generation comes later; the spec records what each placeholder element needs. */
export function deriveAssetsSpec(lesson: Lesson): AssetSpecEntry[] {
  const entries: AssetSpecEntry[] = [];
  for (const el of lesson.elements) {
    if (el.kind === 'image') {
      entries.push({
        elementId: el.id,
        kind: 'image',
        description: el.alt,
        suggestedPrompt: `Clean, flat educational illustration for an Indian school lesson: ${el.alt}. Simple shapes, high contrast, no embedded text.`,
      });
    } else if (el.kind === 'model3d') {
      const description = el.label ?? el.id;
      entries.push({
        elementId: el.id,
        kind: 'model3d',
        description,
        suggestedPrompt: `Low-poly 3D model for an educational viewer: ${description}. Clear silhouette, neutral materials, readable while rotating slowly on a phone screen.`,
      });
    }
  }
  return entries;
}

export async function designLesson(
  topic: Topic,
  adapter: LlmAdapter,
  opts: PromptOptions,
): Promise<DesignResult> {
  const { system, user } = buildPrompt(topic, opts);

  const first = await adapter.complete(system, user);
  const attempt = parseAndValidate(first);
  if (attempt.lesson) {
    return { ok: true, lesson: attempt.lesson, assetsSpec: deriveAssetsSpec(attempt.lesson) };
  }

  // ONE repair retry: the model sees its own reply plus the validator's exact
  // words. More retries than one rarely converge — a second failure goes to a
  // human via *.rejected.json instead.
  const repairUser = [
    user,
    'Your previous reply was rejected. Here is what you sent:',
    first,
    'It failed validation with these errors:',
    attempt.errors.map((error) => `- ${error}`).join('\n'),
    'Fix every error and reply again with the complete corrected lesson as PURE JSON only.',
  ].join('\n\n');

  const second = await adapter.complete(system, repairUser);
  const repaired = parseAndValidate(second);
  if (repaired.lesson) {
    return { ok: true, lesson: repaired.lesson, assetsSpec: deriveAssetsSpec(repaired.lesson) };
  }
  return { ok: false, errors: repaired.errors, raw: second };
}
