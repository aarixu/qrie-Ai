import type {
  KnowledgeGraph,
  LearningNode,
  Probe,
} from '../../../packages/knowledge-graph/src/types.ts';
import { loadGraph } from '../../../packages/knowledge-graph/src/graph.ts';
import type { Chapter } from '../../../packages/syllabus/src/syllabus.ts';
import type { LlmAdapter } from './llm.ts';
import {
  buildNodesPrompt,
  buildProbesPrompt,
  type NodesPromptOptions,
  type ProbesPromptOptions,
} from './prompt.ts';

/**
 * The factory loop: prompt → LLM → validate → one repair retry → nodes.
 *
 * Validation is deliberately strict and its errors are the repair fuel. A batch
 * that would corrupt the map — a cycle, a dangling edge, a duplicate id — never
 * reaches disk, because a broken map silently ruins every diagnostic that runs
 * against it afterwards.
 */

export type Outcome<T> = { ok: true; value: T } | { ok: false; errors: string[]; raw: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

function validateNodes(
  raw: unknown,
  opts: Pick<NodesPromptOptions, 'klass' | 'subject' | 'existingIds'>,
  chapterId: string,
): { value: LearningNode[] | null; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(raw) || !Array.isArray(raw.nodes)) {
    return { value: null, errors: ['reply must be an object with a "nodes" array'] };
  }
  if (raw.nodes.length === 0) return { value: null, errors: ['"nodes" is empty'] };

  const batch = new Map<string, LearningNode>();
  raw.nodes.forEach((node, i) => {
    const at = `nodes[${i}]`;
    if (!isObj(node)) {
      errors.push(`${at}: must be an object`);
      return;
    }
    if (!isStr(node.id)) {
      errors.push(`${at}: needs a non-empty id`);
      return;
    }
    const where = `${at} ("${node.id}")`;
    if (batch.has(node.id)) errors.push(`${where}: duplicate id within this batch`);
    if (opts.existingIds.includes(node.id)) {
      errors.push(`${where}: this id already exists in the map — do not re-create it`);
    }
    if (!isStr(node.title)) errors.push(`${where}: needs a non-empty title`);
    if (!isStr(node.outcome)) errors.push(`${where}: needs a non-empty outcome`);
    if (isStr(node.outcome) && /^(understand|know|learn|be aware|appreciate|master)\b/i.test(node.outcome)) {
      errors.push(
        `${where}: outcome "${node.outcome}" is not observable. Start with a verb you could watch a student do (state, identify, calculate, trace, explain...)`,
      );
    }
    if (node.klass !== opts.klass) errors.push(`${where}: klass must be ${opts.klass}`);
    if (node.subject !== opts.subject) errors.push(`${where}: subject must be "${opts.subject}"`);
    if (node.chapter !== chapterId) errors.push(`${where}: chapter must be "${chapterId}"`);
    if (
      typeof node.difficulty !== 'number' ||
      !Number.isInteger(node.difficulty) ||
      node.difficulty < 1 ||
      node.difficulty > 5
    ) {
      errors.push(`${where}: difficulty must be an integer from 1 to 5`);
    }
    if (!Array.isArray(node.prerequisites) || !node.prerequisites.every(isStr)) {
      errors.push(`${where}: prerequisites must be an array of node ids`);
      return;
    }
    // The generator does not get to say what teaches a node. It has never
    // been shown the lesson catalogue, and when the prompt used to invite a
    // "lessonRef" it invented slugs that named nothing — 175 committed nodes
    // ended up with a Start button that landed on an error screen, and 46 more
    // with an empty string. topicRef is filed by --map-topics, against the
    // syllabus; lessonRef is only ever a real catalogue id. Both are stripped
    // here rather than rejected: a whole chapter is not worth losing over a
    // field the model was told not to write.
    const { lessonRef: _lessonRef, topicRef: _topicRef, ...clean } = node;
    batch.set(node.id, clean as unknown as LearningNode);
  });

  // Edges resolve against the batch plus what is already committed.
  const known = new Set([...batch.keys(), ...opts.existingIds]);
  for (const node of batch.values()) {
    for (const prerequisite of node.prerequisites) {
      if (!known.has(prerequisite)) {
        errors.push(
          `node "${node.id}": prerequisite "${prerequisite}" is not in this batch or the existing map`,
        );
      }
      if (prerequisite === node.id) errors.push(`node "${node.id}": cannot be its own prerequisite`);
    }
  }

  const cycle = findCycleWithin(batch);
  if (cycle) errors.push(`prerequisite cycle inside this batch: ${cycle.join(' -> ')}`);

  return errors.length > 0 ? { value: null, errors } : { value: [...batch.values()], errors: [] };
}

/** Cycles that live entirely inside the batch; cross-batch cycles are caught by the merge. */
function findCycleWithin(batch: ReadonlyMap<string, LearningNode>): string[] | null {
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  const path: string[] = [];

  const visit = (id: string): string[] | null => {
    const state = colour.get(id);
    if (state === BLACK) return null;
    if (state === GREY) return [...path.slice(path.indexOf(id)), id];
    colour.set(id, GREY);
    path.push(id);
    for (const next of batch.get(id)?.prerequisites ?? []) {
      if (!batch.has(next)) continue; // outside the batch — the merge checks those
      const found = visit(next);
      if (found) return found;
    }
    path.pop();
    colour.set(id, BLACK);
    return null;
  };

  for (const id of batch.keys()) {
    const found = visit(id);
    if (found) return found;
  }
  return null;
}

export async function generateNodes(
  chapter: Chapter,
  adapter: LlmAdapter,
  opts: NodesPromptOptions,
): Promise<Outcome<LearningNode[]>> {
  const { system, user } = buildNodesPrompt(chapter, opts);

  const first = await adapter.complete(system, user);
  const attempt = parse(first, (json) => validateNodes(json, opts, chapter.id));
  if (attempt.ok) return attempt;

  // ONE repair retry. The model sees its own reply and the validator's exact
  // complaints — far more useful than asking it to "try again".
  const repair = [
    user,
    '',
    'Your previous reply was:',
    first,
    '',
    'It failed validation with these errors. Fix every one and reply with the corrected JSON only:',
    attempt.errors.map((e) => `- ${e}`).join('\n'),
  ].join('\n');

  const second = await adapter.complete(system, repair);
  return parse(second, (json) => validateNodes(json, opts, chapter.id));
}

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

function validateProbes(raw: unknown, nodes: LearningNode[]): { value: Probe[] | null; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(raw) || !Array.isArray(raw.probes)) {
    return { value: null, errors: ['reply must be an object with a "probes" array'] };
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const seen = new Set<string>();
  const probes: Probe[] = [];

  raw.probes.forEach((probe, i) => {
    const at = `probes[${i}]`;
    if (!isObj(probe)) {
      errors.push(`${at}: must be an object`);
      return;
    }
    if (!isStr(probe.id)) errors.push(`${at}: needs a non-empty id`);
    if (!isStr(probe.nodeId) || !nodeIds.has(probe.nodeId)) {
      errors.push(`${at}: nodeId "${String(probe.nodeId)}" is not one of the nodes generated`);
      return;
    }
    const where = `${at} (node "${probe.nodeId}")`;
    if (seen.has(probe.nodeId)) errors.push(`${where}: a second probe for the same node`);
    seen.add(probe.nodeId);

    if (!isStr(probe.question)) errors.push(`${where}: needs a non-empty question`);

    if (!Array.isArray(probe.options) || probe.options.length !== 4 || !probe.options.every(isStr)) {
      errors.push(`${where}: options must be exactly 4 non-empty strings`);
      return;
    }
    if (new Set(probe.options.map((o) => o.trim().toLowerCase())).size !== 4) {
      errors.push(`${where}: options must all be different`);
    }
    for (const banned of ['all of the above', 'none of the above']) {
      if (probe.options.some((o) => o.trim().toLowerCase().includes(banned))) {
        errors.push(`${where}: "${banned}" is not allowed as an option`);
      }
    }
    if (
      typeof probe.correctIndex !== 'number' ||
      !Number.isInteger(probe.correctIndex) ||
      probe.correctIndex < 0 ||
      probe.correctIndex > 3
    ) {
      errors.push(`${where}: correctIndex must be an integer from 0 to 3`);
      return;
    }
    if (probe.misconceptions !== undefined) {
      if (!Array.isArray(probe.misconceptions) || probe.misconceptions.length !== 4) {
        errors.push(`${where}: misconceptions must have exactly 4 entries, aligned to options`);
      } else if (String(probe.misconceptions[probe.correctIndex] ?? '').trim() !== '') {
        errors.push(`${where}: misconceptions[correctIndex] must be an empty string`);
      } else if (
        // Long enough to be a sentence about the student's thinking. The
        // committed-bank test enforces the same floor, and a generator that
        // accepts what the repo rejects just moves the failure downstream:
        // "foam" names an option, not the mistake behind choosing it.
        probe.misconceptions.some(
          (m, idx) => idx !== probe.correctIndex && String(m ?? '').trim().length <= 4,
        )
      ) {
        errors.push(
          `${where}: each wrong option needs a misconception saying WHY a student would pick it, not just a word`,
        );
      } else if (
        probe.misconceptions.some((m, idx) => idx !== probe.correctIndex && !isStr(m))
      ) {
        errors.push(`${where}: every wrong option needs a named misconception`);
      }
    }

    probes.push(probe as unknown as Probe);
  });

  const missing = nodes.filter((n) => !seen.has(n.id)).map((n) => n.id);
  if (missing.length > 0) errors.push(`no probe was written for: ${missing.join(', ')}`);

  return errors.length > 0 ? { value: null, errors } : { value: probes, errors: [] };
}

/**
 * FNV-1a over the probe id. The same probe always lands in the same place, so
 * regenerating a chapter does not reshuffle a bank someone has already seen.
 */
function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Move each correct answer to a position decided by its id, not by the model.
 *
 * The prompt asks for varied positions and the model ignores it: the first
 * chapter generated came back with the answer at A for all thirteen questions,
 * which the committed-bank test caught. A student who notices can score full
 * marks without reading a word, and a placement test they can game measures
 * nothing. Options and misconceptions move together — they are aligned by
 * index, and a swap that forgot the misconceptions would mislabel every gap.
 */
export function balanceAnswerPositions(probes: Probe[]): Probe[] {
  // Rank the batch by a hash of the id, then deal positions round-robin. Pure
  // per-probe hashing is deterministic but lumpy — on thirteen questions it
  // still put nearly half the answers in one slot. Dealing by rank spreads any
  // batch evenly AND stays stable, because the ranking is the id's, not the
  // order the model happened to reply in.
  const rank = new Map(
    probes
      .map((probe, i) => ({ i, key: hash(probe.id) }))
      .sort((a, b) => a.key - b.key || a.i - b.i)
      .map((entry, position) => [entry.i, position]),
  );

  return probes.map((probe, i) => {
    const target = (rank.get(i) ?? 0) % probe.options.length;
    if (target === probe.correctIndex) return probe;

    const swap = <T>(list: T[]): T[] => {
      const next = [...list];
      [next[target], next[probe.correctIndex]] = [next[probe.correctIndex], next[target]];
      return next;
    };
    return {
      ...probe,
      options: swap(probe.options),
      correctIndex: target,
      ...(probe.misconceptions ? { misconceptions: swap(probe.misconceptions) } : {}),
    };
  });
}

export async function generateProbes(
  nodes: LearningNode[],
  adapter: LlmAdapter,
  opts: ProbesPromptOptions,
): Promise<Outcome<Probe[]>> {
  const { system, user } = buildProbesPrompt(nodes, opts);
  const balanced = (out: Outcome<Probe[]>): Outcome<Probe[]> =>
    out.ok ? { ok: true, value: balanceAnswerPositions(out.value) } : out;

  const first = await adapter.complete(system, user);
  const attempt = parse(first, (json) => validateProbes(json, nodes));
  if (attempt.ok) return balanced(attempt);

  const repair = [
    user,
    '',
    'Your previous reply was:',
    first,
    '',
    'It failed validation with these errors. Fix every one and reply with the corrected JSON only:',
    attempt.errors.map((e) => `- ${e}`).join('\n'),
  ].join('\n');

  const second = await adapter.complete(system, repair);
  return balanced(parse(second, (json) => validateProbes(json, nodes)));
}

// ---------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------

/**
 * Append a batch to a graph, then re-validate the WHOLE thing.
 *
 * Two batches can each be acyclic while their union is not, so the merged graph
 * is put back through loadGraph rather than trusted. Growing the map must never
 * be able to corrupt it.
 */
export function mergeIntoGraph(
  existing: KnowledgeGraph,
  incoming: LearningNode[],
): Outcome<KnowledgeGraph> {
  const errors: string[] = [];
  const known = new Set(existing.nodes.map((n) => n.id));

  for (const node of incoming) {
    if (known.has(node.id)) errors.push(`id collision: "${node.id}" is already in the map`);
    known.add(node.id);
  }
  if (errors.length > 0) return { ok: false, errors, raw: '' };

  const merged = { version: 1 as const, nodes: [...existing.nodes, ...incoming] };
  try {
    return { ok: true, value: loadGraph(merged) };
  } catch (e) {
    return {
      ok: false,
      errors: [`merged graph is invalid: ${e instanceof Error ? e.message : String(e)}`],
      raw: '',
    };
  }
}

// ---------------------------------------------------------------------------

/**
 * Parse the reply, then hand it to a validator. A parse failure is reported the
 * same way a validation failure is, so both take the same repair path.
 */
function parse<T>(
  raw: string,
  validate: (json: unknown) => { value: T | null; errors: string[] },
): Outcome<T> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, errors: [`reply is not valid JSON: ${(e as Error).message}`], raw };
  }
  const { value, errors } = validate(json);
  return value ? { ok: true, value } : { ok: false, errors, raw };
}
