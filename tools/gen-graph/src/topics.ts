import type { LearningNode } from '../../../packages/knowledge-graph/src/types.ts';
import type { Chapter } from '../../../packages/syllabus/src/syllabus.ts';
import type { LlmAdapter } from './llm.ts';
import type { Outcome } from './generate.ts';

/**
 * THE TOPIC PASS — joining the outcome map to the content that teaches it.
 *
 * Nodes are generated a chapter at a time, and the generator was allowed to
 * name a "lessonRef" freely. It duly invented slugs ("euclid-fifth",
 * "word-problems") that named nothing, and the study plan pointed its Start
 * button at them: 175 of 681 committed nodes led to "This lesson does not
 * exist." The rest led nowhere at all.
 *
 * This pass gives every node a `topicRef` instead — "<syllabusId>/<chapterId>/
 * <topicId>", the key the lesson catalogue, the chapter screen and the live
 * classroom already address content by. A node with one can always be taught:
 * the topic's recording if there is one, a class prepared on the spot if not.
 *
 * Two rules make the mapping trustworthy rather than plausible:
 *
 *  - A node may only be placed in a topic of its OWN chapter. The chapter is
 *    already committed data the generator had to get right for the map to
 *    load, so the search space is a handful of topics, not a thousand.
 *  - Every node in the batch must be placed. A partial reply is rejected,
 *    because an unplaced node is exactly the dead end being repaired.
 */

export interface TopicsPromptOptions {
  klass: number;
  subject: string;
}

export interface AssignOptions extends TopicsPromptOptions {
  syllabusId: string;
}

const RULES = `WHAT YOU ARE DOING

You are filing atomic learning outcomes under the syllabus topic that teaches
them. Each outcome came from this chapter; your job is to say WHICH SECTION of
the chapter a teacher would cover it in.

Rules:
- Choose from the listed topic ids ONLY. Nothing else is a valid answer.
- EVERY NODE MUST GET A TOPIC. There is no "none" and no "other": a node you
  leave out becomes a step in a student's study plan with nowhere to go.
- Judge by the OUTCOME, not by the node id. The id is a slug; the outcome is
  the thing being taught.
- When an outcome is genuinely groundwork for the chapter as a whole — naming
  a set, stating a definition everything later uses — the introduction topic is
  the honest answer, not the topic that happens to share a word with it.
- Prefer the topic whose objectives the outcome would be TESTED under.`;

export function buildTopicsPrompt(
  nodes: readonly LearningNode[],
  chapter: Chapter,
  opts: TopicsPromptOptions,
): { system: string; user: string } {
  const system = [
    `You file learning outcomes under syllabus topics for Indian school students (NCERT/CBSE), Class ${opts.klass} ${opts.subject}.`,
    RULES,
    'REPLY SHAPE — exactly this, nothing else:\n{ "assignments": [ { "nodeId": "<node id>", "topicId": "<topic id>" }, ... ] }',
    'Reply with ONLY that JSON object. No markdown fences, no commentary.',
  ].join('\n\n');

  const topics = chapter.topics
    .map((topic) => {
      const objectives = topic.objectives.map((o) => `      ${o}`).join('\n');
      return `  ${topic.id}  —  ${topic.title}\n${objectives}`;
    })
    .join('\n');

  const list = nodes.map((n) => `  ${n.id}: ${n.outcome}`).join('\n');

  const user = `CHAPTER: ${chapter.title} (id: "${chapter.id}"), Class ${opts.klass} ${opts.subject}.

ITS TOPICS — the only ids you may answer with:
${topics}

NODES TO FILE (${nodes.length}) — every one of these must appear in your reply:
${list}

Reply with the assignments JSON.`;

  return { system, user };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Node id -> topic id, or the complaints that make the repair attempt worth
 * making. Strict on both sides: an unknown topic would write a topicRef that
 * resolves to nothing, and a missing node would leave the dead end in place.
 */
export function validateAssignments(
  raw: unknown,
  nodes: readonly LearningNode[],
  chapter: Chapter,
): { value: Map<string, string> | null; errors: string[] } {
  if (!isObj(raw) || !Array.isArray(raw.assignments)) {
    return { value: null, errors: ['reply must be an object with an "assignments" array'] };
  }

  const topicIds = new Set(chapter.topics.map((t) => t.id));
  const wanted = new Set(nodes.map((n) => n.id));
  const errors: string[] = [];
  const placed = new Map<string, string>();

  for (const [i, item] of raw.assignments.entries()) {
    const at = `assignments[${i}]`;
    if (!isObj(item)) {
      errors.push(`${at}: must be an object`);
      continue;
    }
    const { nodeId, topicId } = item as Record<string, unknown>;
    if (typeof nodeId !== 'string' || typeof topicId !== 'string') {
      errors.push(`${at}: needs a string nodeId and a string topicId`);
      continue;
    }
    if (!wanted.has(nodeId)) {
      errors.push(`${at}: "${nodeId}" is not one of the nodes you were asked to file`);
      continue;
    }
    if (!topicIds.has(topicId)) {
      errors.push(
        `${at} (${nodeId}): "${topicId}" is not a topic of chapter "${chapter.id}". Choose one of: ${[...topicIds].join(', ')}`,
      );
      continue;
    }
    // Last wins rather than first: a model that corrects itself mid-reply
    // means the later line, and neither choice is worth a whole repair round.
    placed.set(nodeId, topicId);
  }

  const missing = [...wanted].filter((id) => !placed.has(id));
  if (missing.length > 0) {
    errors.push(
      `these nodes were left unplaced and every node must get a topic: ${missing.join(', ')}`,
    );
  }

  return errors.length > 0 ? { value: null, errors } : { value: placed, errors: [] };
}

/**
 * One enormous request is slower, likelier to be truncated, and loses every
 * assignment when it fails validation. Chapters run to ~48 nodes.
 */
const BATCH = 24;

/**
 * Node id -> full topicRef, for one chapter.
 *
 * Batched, with the same one-repair-attempt loop the node, probe and link
 * passes use. There is deliberately no shortcut from the old `lessonRef`: the
 * values sitting in it were invented by the same model, against a prompt that
 * never showed it the objectives, and a topic that "matches" a made-up slug is
 * not evidence of anything.
 */
export async function assignTopics(
  nodes: readonly LearningNode[],
  chapter: Chapter,
  adapter: LlmAdapter,
  opts: AssignOptions,
): Promise<Outcome<Map<string, string>>> {
  const ref = (topicId: string) => `${opts.syllabusId}/${chapter.id}/${topicId}`;

  if (chapter.topics.length === 0) {
    // Nothing to choose from. Saying so is the honest answer; inventing a topic
    // id would write a topicRef that resolves to nothing.
    return {
      ok: false,
      errors: [`chapter "${chapter.id}" has no topics in the syllabus`],
      raw: '',
    };
  }

  const out = new Map<string, string>();

  for (let i = 0; i < nodes.length; i += BATCH) {
    const slice = nodes.slice(i, i + BATCH);
    const { system, user } = buildTopicsPrompt(slice, chapter, opts);

    const attemptFrom = (reply: string): Outcome<Map<string, string>> => {
      try {
        const result = validateAssignments(JSON.parse(reply), slice, chapter);
        return result.value !== null
          ? { ok: true, value: result.value }
          : { ok: false, errors: result.errors, raw: reply };
      } catch {
        return { ok: false, errors: ['reply is not valid JSON'], raw: reply };
      }
    };

    let attempt = attemptFrom(await adapter.complete(system, user));
    if (!attempt.ok) {
      const repair = [
        user,
        '',
        'Your previous reply was:',
        attempt.raw,
        '',
        'It failed validation with these errors. Fix every one and reply with the corrected JSON only:',
        attempt.errors.map((e) => `- ${e}`).join('\n'),
      ].join('\n');
      attempt = attemptFrom(await adapter.complete(system, repair));
    }
    if (!attempt.ok) return attempt;

    for (const [nodeId, topicId] of attempt.value) out.set(nodeId, ref(topicId));
  }

  return { ok: true, value: out };
}
