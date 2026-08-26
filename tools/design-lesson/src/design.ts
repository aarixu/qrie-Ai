// Leaf modules, not the package index files — see the note in prompt.ts.
import { validateLesson } from '../../../packages/lesson-format/src/validate.ts';
import type { Lesson } from '../../../packages/lesson-format/src/types.ts';
import type { Topic } from '../../../packages/syllabus/src/syllabus.ts';
import { pedagogyIssues } from '../../../packages/pedagogy/src/rosenshine.ts';
import type { BeatPlan } from '../../../packages/pedagogy/src/plan.ts';
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

/**
 * The pedagogy half of validation, run only when a blueprint was given.
 *
 * Two things are checked, and they are different questions. First, did the
 * model actually fill the arc it was handed — same beats, same ids, same
 * outcomes — or did it quietly rewrite the plan? Second, does the result hold
 * up against the rules in @ai-tutor/pedagogy, which is the same check the plan
 * itself passed before anyone wrote a word.
 *
 * Both produce plain sentences, because they are fed back to the model as
 * repair instructions verbatim.
 */
function pedagogyErrors(
  lesson: Lesson,
  blueprint: NonNullable<PromptOptions['blueprint']>,
  prerequisites?: ReadonlyMap<string, readonly string[]>,
): string[] {
  const errors: string[] = [];
  const planned = new Map<string, BeatPlan>(blueprint.beats.map((b) => [b.id, b]));

  const gotIds = lesson.beats.map((b) => b.id);
  const wantIds = blueprint.beats.map((b) => b.id);
  if (gotIds.join('|') !== wantIds.join('|')) {
    errors.push(
      `beat ids must be exactly ${wantIds.join(', ')} in that order — you sent ${gotIds.join(', ')}`,
    );
  }

  for (const beat of lesson.beats) {
    const want = planned.get(beat.id);
    if (!want) continue; // already reported by the id check above
    const got = (field: 'teaches' | 'checks') => [...(beat[field] ?? [])].sort().join(',');
    const expected = (field: 'teaches' | 'checks') => [...want[field]].sort().join(',');
    for (const field of ['teaches', 'checks'] as const) {
      if (got(field) !== expected(field)) {
        errors.push(
          `beat "${beat.id}" must carry ${field}: [${want[field].join(', ')}] exactly as planned`,
        );
      }
    }
  }

  const shapes = lesson.beats.map((beat) => ({
    id: beat.id,
    role: planned.get(beat.id)?.role ?? 'teach',
    teaches: beat.teaches ?? [],
    checks: beat.checks ?? [],
  }));
  for (const issue of pedagogyIssues(shapes, {
    prerequisites,
    required: blueprint.beats.flatMap((b) => b.teaches),
  })) {
    errors.push(issue.beatId ? `beat "${issue.beatId}": ${issue.message}` : issue.message);
  }
  return errors;
}

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
  opts: PromptOptions & { prerequisites?: ReadonlyMap<string, readonly string[]> },
): Promise<DesignResult> {
  const { system, user } = buildPrompt(topic, opts);

  // Schema first, then pedagogy: a lesson that will not parse cannot be judged
  // on its teaching, and reporting both at once would bury the real fault.
  const check = (raw: string): { lesson: Lesson | null; errors: string[] } => {
    const parsed = parseAndValidate(raw);
    if (!parsed.lesson || !opts.blueprint) return parsed;
    const issues = pedagogyErrors(parsed.lesson, opts.blueprint, opts.prerequisites);
    return issues.length > 0 ? { lesson: null, errors: issues } : parsed;
  };

  const first = await adapter.complete(system, user);
  const attempt = check(first);
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
  const repaired = check(second);
  if (repaired.lesson) {
    return { ok: true, lesson: repaired.lesson, assetsSpec: deriveAssetsSpec(repaired.lesson) };
  }
  return { ok: false, errors: repaired.errors, raw: second };
}
