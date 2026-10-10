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
  chapter?: string;
  title?: string;
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
 * The classes whose banks were written from the old NCERT books, which the
 * current syllabus has replaced: their questions and chapter lists are wrong
 * for a class today. The library loader leaves them out unless asked
 * (cli.ts, --include-old-books-6-9). The demo seed (tools/lms-demo) still
 * loads every bank.
 */
export const OLD_BOOK_GRADES: readonly number[] = [6, 7, 8, 9];

/** What withoutOldBooks left out of one class. */
export interface SkippedGrade {
  grade: number;
  /** Probes on that class's outcomes: the library items not loaded. */
  items: number;
  outcomes: number;
  /** The banks those came from. */
  banks: string[];
}

/**
 * The banks with every outcome of an old-book class taken out, and the
 * probes on those outcomes with them; and what was left out, class by class.
 * An outcome's class is its node's `klass` — the same field an item's grade
 * comes from — not the bank's name. A probe whose node is missing is kept,
 * so libraryItems still refuses it.
 */
export function withoutOldBooks(banks: Bank[]): { kept: Bank[]; skipped: SkippedGrade[] } {
  const old = new Set(OLD_BOOK_GRADES);
  const skipped = new Map<number, SkippedGrade>();
  const tally = (grade: number, bank: string): SkippedGrade => {
    const s = skipped.get(grade) ?? { grade, items: 0, outcomes: 0, banks: [] };
    if (!s.banks.includes(bank)) s.banks.push(bank);
    skipped.set(grade, s);
    return s;
  };
  const kept: Bank[] = [];
  for (const bank of banks) {
    const gradeOf = new Map(bank.graph.nodes.map((n) => [n.id, n.klass]));
    for (const n of bank.graph.nodes) if (old.has(n.klass)) tally(n.klass, bank.name).outcomes += 1;
    for (const p of bank.probes.probes) {
      const grade = gradeOf.get(p.nodeId);
      if (grade !== undefined && old.has(grade)) tally(grade, bank.name).items += 1;
    }
    const nodes = bank.graph.nodes.filter((n) => !old.has(n.klass));
    const probes = bank.probes.probes.filter((p) => !old.has(gradeOf.get(p.nodeId) ?? -1));
    if (nodes.length === bank.graph.nodes.length && probes.length === bank.probes.probes.length) kept.push(bank);
    else if (nodes.length || probes.length) {
      kept.push({ name: bank.name, graph: { ...bank.graph, nodes }, probes: { ...bank.probes, probes } });
    }
  }
  return { kept, skipped: [...skipped.values()].sort((a, b) => a.grade - b.grade) };
}

/** A row of lms.outcome (0027): where an outcome sits in the curriculum. */
export interface Outcome {
  id: string;
  grade: number;
  subject: string;
  chapter: string;
  title: string;
  /** Order within the map: chapters, and topics in them, as the syllabus teaches them. */
  position: number;
}

/**
 * Every outcome of every bank's map, with its chapter, so a teacher's view
 * of what the brain believes can be grouped the way a syllabus is.
 */
export function outcomes(banks: Bank[]): Outcome[] {
  return banks.flatMap((b) =>
    b.graph.nodes.map((n, position) => ({
      id: n.id,
      grade: n.klass,
      subject: n.subject,
      chapter: n.chapter ?? n.id,
      title: n.title ?? n.id,
      position,
    })),
  );
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
