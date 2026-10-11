import { normaliseStem, primaryFirst } from '../../../packages/knowledge-graph/src/probes.ts';
import type { KnowledgeGraph, Probe, ProbeRole } from '../../../packages/knowledge-graph/src/types.ts';
import { balanceAnswerPositions, lengthLeak, parse, probeShapeErrors, type Outcome } from './generate.ts';
import type { LlmAdapter } from './llm.ts';
import {
  buildLabelCheckPrompt,
  buildMoreProbesPrompt,
  buildSolvePrompt,
  type MoreProbesRequest,
  type ProbesPromptOptions,
} from './prompt.ts';

/**
 * MORE THAN ONE QUESTION PER OUTCOME (lam-one-brain Task 16).
 *
 * A review that can only ask the question the learner already answered tests
 * memory of that question. This pass gives a node that has its first question
 * further ones, each in a role (`retest`, `review`, `transfer`), in the same
 * shape as the first: four options, a key, and a sentence per wrong option.
 *
 * Nothing unconfirmed reaches the bank. A batch is validated (shape, the roles
 * asked, no repeated stem, the length leak) with one repair retry, as the
 * first-question pass does; then a second reader checks it in two calls that
 * share nothing with the writer: one answers each question without being told
 * the key, the other reads each wrong option's label against the key. A
 * question either check does not confirm is dropped.
 *
 * Resumable like the other passes: the plan is the roles each node still
 * lacks in the bank on disk, and each batch is saved as it is confirmed, so a
 * second run asks only for what the first did not add (dropped ones included).
 */

export type MoreRequest = MoreProbesRequest;

/** Nodes per writer call: two roles each is about the twelve questions the first-question pass sends. */
export const MORE_BATCH = 6;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/**
 * The nodes in scope that have a first question and lack one of `roles`, in
 * the map's order, with the questions they already hold (first one first). A
 * node without a first question is the first-question pass's (`--probes-only`).
 */
export function planMoreProbes(
  graph: KnowledgeGraph,
  probes: readonly Probe[],
  roles: readonly ProbeRole[],
  inScope: (chapterId: string) => boolean,
): MoreRequest[] {
  const byNode = new Map<string, Probe[]>();
  for (const p of probes) byNode.set(p.nodeId, [...(byNode.get(p.nodeId) ?? []), p]);
  const plan: MoreRequest[] = [];
  for (const node of graph.nodes) {
    if (!inScope(node.chapter)) continue;
    const own = byNode.get(node.id) ?? [];
    if (!own.some((p) => p.role === undefined)) continue;
    const lacking = roles.filter((r) => !own.some((p) => p.role === r));
    if (lacking.length > 0) plan.push({ node, existing: [...own].sort(primaryFirst), roles: lacking });
  }
  return plan;
}

interface Written {
  nodeId: string;
  role: ProbeRole;
  question: string;
  options: string[];
  correctIndex: number;
  misconceptions: string[];
}

function validateMore(raw: unknown, requests: readonly MoreRequest[]): { value: Written[] | null; errors: string[] } {
  if (!isObj(raw) || !Array.isArray(raw.probes)) {
    return { value: null, errors: ['reply must be an object with a "probes" array'] };
  }
  const errors: string[] = [];
  const byNode = new Map(requests.map((r) => [r.node.id, r]));
  const seen = new Set<string>();
  const newStems = new Map<string, Set<string>>();
  const written: Written[] = [];

  raw.probes.forEach((probe, i) => {
    const at = `probes[${i}]`;
    if (!isObj(probe)) {
      errors.push(`${at}: must be an object`);
      return;
    }
    const request = isStr(probe.nodeId) ? byNode.get(probe.nodeId) : undefined;
    if (!request) {
      errors.push(`${at}: nodeId "${String(probe.nodeId)}" is not one of the nodes asked for`);
      return;
    }
    const nodeId = request.node.id;
    if (!isStr(probe.role) || !request.roles.includes(probe.role as ProbeRole)) {
      errors.push(`${at}: role "${String(probe.role)}" was not asked for node "${nodeId}"`);
      return;
    }
    const role = probe.role as ProbeRole;
    const where = `${at} (node "${nodeId}", ${role})`;
    if (seen.has(`${nodeId} ${role}`)) errors.push(`${where}: a second ${role} question for the same node`);
    seen.add(`${nodeId} ${role}`);

    const shape = probeShapeErrors(probe, where, true);
    errors.push(...shape);
    if (isStr(probe.question)) {
      const stem = normaliseStem(probe.question);
      const mine = newStems.get(nodeId) ?? new Set<string>();
      if (request.existing.some((p) => normaliseStem(p.question) === stem)) {
        errors.push(`${where}: repeats a question node "${nodeId}" already has; ask it differently`);
      } else if (mine.has(stem)) {
        errors.push(`${where}: repeats another new question for node "${nodeId}"`);
      }
      mine.add(stem);
      newStems.set(nodeId, mine);
    }
    if (shape.length === 0) {
      written.push({
        nodeId,
        role,
        question: probe.question as string,
        options: probe.options as string[],
        correctIndex: probe.correctIndex as number,
        misconceptions: probe.misconceptions as string[],
      });
    }
  });

  for (const { node, roles } of requests) {
    for (const role of roles) {
      if (!seen.has(`${node.id} ${role}`)) errors.push(`no ${role} question was written for node "${node.id}"`);
    }
  }
  const leak = lengthLeak(written.map((w, i) => ({ id: String(i), ...w })));
  if (leak !== null) errors.push(leak);
  return errors.length > 0 ? { value: null, errors } : { value: written, errors: [] };
}

/**
 * The further questions for `requests`, validated with one repair retry, each
 * with its role and an id of its own: the node's first question's id and the
 * role (`probe-x-retest`), numbered on when `bank` already holds that id.
 * Answer positions are dealt by id, as the first-question pass deals them.
 */
export async function generateMoreProbes(
  requests: readonly MoreRequest[],
  adapter: LlmAdapter,
  opts: ProbesPromptOptions,
  bank: readonly Probe[],
): Promise<Outcome<Probe[]>> {
  const { system, user } = buildMoreProbesPrompt(requests, opts);
  const first = await adapter.complete(system, user);
  let attempt = parse(first, (json) => validateMore(json, requests));
  if (!attempt.ok) {
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
    attempt = parse(second, (json) => validateMore(json, requests));
  }
  if (!attempt.ok) return attempt;

  const taken = new Set(bank.map((p) => p.id));
  const firstId = new Map(requests.map((r) => [r.node.id, r.existing.find((p) => p.role === undefined)!.id]));
  const probes: Probe[] = attempt.value.map((w) => {
    const base = `${firstId.get(w.nodeId)}-${w.role}`;
    let id = base;
    for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
    taken.add(id);
    return {
      id,
      nodeId: w.nodeId,
      role: w.role,
      question: w.question,
      options: w.options,
      correctIndex: w.correctIndex,
      misconceptions: w.misconceptions,
    };
  });
  return { ok: true, value: balanceAnswerPositions(probes) };
}

export interface Review {
  kept: Probe[];
  dropped: { id: string; reason: string }[];
}

/**
 * THE SECOND READER. Two calls: the solver answers each question without the
 * key or the labels (buildSolvePrompt); the label checker reads each wrong
 * option's label against the key (buildLabelCheckPrompt). A question is kept
 * only when the solver's answer is the key and no label is called bad. A
 * question either reply leaves out, or a check that cannot run, is dropped:
 * what cannot be confirmed does not go in.
 */
export async function reviewProbes(probes: readonly Probe[], adapter: LlmAdapter, opts: ProbesPromptOptions): Promise<Review> {
  if (probes.length === 0) return { kept: [], dropped: [] };
  const all = (reason: string): Review => ({ kept: [], dropped: probes.map((p) => ({ id: p.id, reason })) });

  let answers: Map<string, unknown>;
  let reviews: Map<string, unknown>;
  try {
    const solve = buildSolvePrompt(probes, opts);
    const solved = JSON.parse(await adapter.complete(solve.system, solve.user)) as unknown;
    const labels = buildLabelCheckPrompt(probes, opts);
    const checked = JSON.parse(await adapter.complete(labels.system, labels.user)) as unknown;
    const list = (reply: unknown, key: string): Record<string, unknown>[] =>
      isObj(reply) && Array.isArray(reply[key]) ? (reply[key] as unknown[]).filter(isObj) : [];
    answers = new Map(list(solved, 'answers').map((a) => [String(a.ref), a.answerIndex]));
    reviews = new Map(list(checked, 'reviews').map((r) => [String(r.ref), r.bad]));
  } catch (error) {
    return all(`the check failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const out: Review = { kept: [], dropped: [] };
  probes.forEach((probe, i) => {
    const ref = `q${i + 1}`;
    const drop = (reason: string) => out.dropped.push({ id: probe.id, reason });
    if (!answers.has(ref)) return drop('the checker did not answer it');
    const answer = answers.get(ref);
    if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < 0 || answer > 3) {
      return drop('the checker found no single right option');
    }
    if (answer !== probe.correctIndex) {
      return drop(`the checker answered option ${answer}, the key says ${probe.correctIndex}`);
    }
    const bad = reviews.get(ref);
    if (!Array.isArray(bad)) return drop('the checker did not check its labels');
    if (bad.length === 1) return drop(`the checker does not believe the label of option ${String(bad[0])}`);
    if (bad.length > 1) return drop(`the checker does not believe the labels of options ${bad.join(', ')}`);
    out.kept.push(probe);
  });
  return out;
}

export interface MoreRun {
  graph: KnowledgeGraph;
  /** The bank as it stands on disk. */
  probes: readonly Probe[];
  roles: readonly ProbeRole[];
  inScope: (chapterId: string) => boolean;
  /** The writer. */
  adapter: LlmAdapter;
  /** The second reader; the writer's adapter, in calls of its own, when not given. */
  reviewer?: LlmAdapter;
  klass: number;
  subject: string;
  batchNodes?: number;
  /** Puts confirmed questions on disk; called once per batch that kept any. */
  save: (incoming: readonly Probe[]) => void;
  log?: (line: string) => void;
}

export interface MoreTally {
  /** Questions the plan asked for. */
  requested: number;
  added: number;
  /** Written and valid, but not confirmed by the second reader. */
  dropped: number;
  /** Batches lost to the transport or to validation after the repair. */
  failed: number;
}

/** The whole pass over one bank: plan, then write, check and save batch by batch. */
export async function addMoreProbes(run: MoreRun): Promise<MoreTally> {
  const log = run.log ?? ((line: string) => console.log(line));
  const opts = { klass: run.klass, subject: run.subject };
  const plan = planMoreProbes(run.graph, run.probes, run.roles, run.inScope);
  const tally: MoreTally = { requested: plan.reduce((n, r) => n + r.roles.length, 0), added: 0, dropped: 0, failed: 0 };
  if (plan.length === 0) return tally;
  log(`  ${plan.length} node(s) need ${tally.requested} further question(s).`);

  const bank = [...run.probes];
  const size = run.batchNodes ?? MORE_BATCH;
  for (let i = 0; i < plan.length; i += size) {
    const batch = plan.slice(i, i + size);
    let written: Outcome<Probe[]>;
    try {
      written = await generateMoreProbes(batch, run.adapter, opts, bank);
    } catch (error) {
      tally.failed += 1;
      log(`  ✗ batch ${i / size + 1}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!written.ok) {
      tally.failed += 1;
      log(`  ✗ batch ${i / size + 1}: ${written.errors.slice(0, 3).join('; ')}`);
      continue;
    }
    const review = await reviewProbes(written.value, run.reviewer ?? run.adapter, opts);
    tally.dropped += review.dropped.length;
    for (const d of review.dropped) log(`  - dropped ${d.id}: ${d.reason}`);
    if (review.kept.length === 0) continue;
    run.save(review.kept);
    bank.push(...review.kept);
    tally.added += review.kept.length;
    log(`  ✓ ${review.kept.length} further question(s) confirmed and saved`);
  }
  return tally;
}
