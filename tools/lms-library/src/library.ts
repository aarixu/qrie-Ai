import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The Qrie library: every probe in packages/knowledge-graph/data, as items a
 * school's teachers can approve and set (migration 0023). All 13 banks, not
 * the 3 the tutor's quiz happens to wire.
 *
 * These are LLM-written and reviewed by nobody. That is exactly why they
 * enter lms.item as library items that no child sees until a teacher of their
 * school approves one.
 */

export interface LibraryItem {
  libraryRef: string;
  outcomeIds: string[];
  grade: number;
  subject: string;
  stem: string;
  options: string[];
  correctIndex: number;
  misconceptions?: string[];
}

interface GraphNode {
  id: string;
  klass: number;
  subject: string;
}

interface Probe {
  id: string;
  nodeId: string;
  question: string;
  options: string[];
  correctIndex: number;
  misconceptions?: string[];
}

export interface Bank {
  name: string;
  graph: { nodes: GraphNode[] };
  probes: { probes: Probe[] };
}

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/knowledge-graph/data');

export function loadBanks(dir: string = DATA): Bank[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.probes.json'))
    .sort()
    .map((f) => {
      const name = f.replace(/\.probes\.json$/, '');
      const read = (file: string) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      return { name, graph: read(`${name}.json`), probes: read(f) };
    });
}

export function libraryItems(banks: Bank[]): LibraryItem[] {
  const out: LibraryItem[] = [];
  for (const bank of banks) {
    const nodes = new Map(bank.graph.nodes.map((n) => [n.id, n]));
    for (const p of bank.probes.probes) {
      const node = nodes.get(p.nodeId);
      if (!node) throw new Error(`${bank.name}: ${p.id} points at node "${p.nodeId}", which is not in the graph`);
      out.push({
        libraryRef: p.id,
        outcomeIds: [p.nodeId],
        grade: node.klass,
        subject: node.subject,
        stem: p.question,
        options: p.options,
        correctIndex: p.correctIndex,
        ...(p.misconceptions ? { misconceptions: p.misconceptions } : {}),
      });
    }
  }
  return out;
}

/**
 * What a teacher's approval vouches for: the question, its options and its
 * key. A change to any of these makes it a different question, which must
 * not inherit an approval given to the old one. The misconception labels are
 * diagnostic metadata a student never sees, so they are not part of it.
 */
export function fingerprint(item: Pick<LibraryItem, 'stem' | 'options' | 'correctIndex'>): string {
  return JSON.stringify([item.stem, item.options, item.correctIndex]);
}
