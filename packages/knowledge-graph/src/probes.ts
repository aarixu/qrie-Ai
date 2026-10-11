import type { Probe, ProbeRole } from './types.ts';

/**
 * SEVERAL QUESTIONS PER OUTCOME (lam-one-brain Task 16).
 *
 * A node keeps its first question (no `role`) and may gain at most one more
 * per role. A review that can only ask the question the learner already
 * answered tests memory of that question, not of the outcome, so a node's
 * questions must be different questions: no two share a stem once case,
 * spacing and punctuation are set aside.
 */
export const PROBE_ROLES: readonly ProbeRole[] = ['retest', 'review', 'transfer'];

/** Lower case, punctuation dropped, spacing collapsed: two stems equal here are one question. */
export function normaliseStem(stem: string): string {
  return stem
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+\-*/=<>%^]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A node's first question before its further ones, then by id. */
export function primaryFirst(a: Probe, b: Probe): number {
  const ra = a.role === undefined ? 0 : 1;
  const rb = b.role === undefined ? 0 : 1;
  return ra - rb || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * What is wrong with a bank's shape, one line each; empty when nothing is.
 * Ids unique; per node at most one first question and one per role, a
 * further question only beside a first one, and no stem repeated within
 * the node. The checks on each question's own options and key are the
 * committed-bank tests' and gen-graph's.
 */
export function bankProblems(probes: readonly Probe[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const byNode = new Map<string, Probe[]>();
  for (const p of probes) {
    if (ids.has(p.id)) problems.push(`${p.id}: id used twice`);
    ids.add(p.id);
    if (p.role !== undefined && !PROBE_ROLES.includes(p.role)) problems.push(`${p.id}: unknown role "${String(p.role)}"`);
    byNode.set(p.nodeId, [...(byNode.get(p.nodeId) ?? []), p]);
  }
  for (const [nodeId, own] of byNode) {
    const firsts = own.filter((p) => p.role === undefined);
    if (firsts.length > 1) problems.push(`${nodeId}: two questions without a role (${firsts.map((p) => p.id).join(', ')})`);
    for (const role of PROBE_ROLES) {
      const inRole = own.filter((p) => p.role === role);
      if (inRole.length > 1) problems.push(`${nodeId}: two ${role} questions (${inRole.map((p) => p.id).join(', ')})`);
      if (inRole.length > 0 && firsts.length === 0) problems.push(`${nodeId}: a ${role} question but no first question`);
    }
    const stems = new Map<string, string>();
    for (const p of [...own].sort(primaryFirst)) {
      const stem = normaliseStem(p.question);
      const earlier = stems.get(stem);
      if (earlier !== undefined && earlier !== p.id) problems.push(`${p.id}: repeats the stem of ${earlier}`);
      else stems.set(stem, p.id);
    }
  }
  return problems;
}
