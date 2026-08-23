import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LOOK_BACK,
  applyLinks,
  lineageSubjects,
  loadDiagnosticData,
  loadDiagnosticDataFor,
} from '../src/lib/diagnosticData';

/**
 * These tests derive their expectations from whatever maps have actually been
 * generated — the data directory grows chapter by chapter as tools/gen-graph
 * runs, and a test pinned to today's file list would fail on tomorrow's.
 */
const DATA_DIR = path.resolve(__dirname, '../../../packages/knowledge-graph/data');
const mappedClasses = new Set(
  fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.probes.json'))
    .map((f) => Number(/^class(\d+)-/.exec(f)?.[1]))
    .filter((k) => Number.isFinite(k)),
);

describe('lineageSubjects', () => {
  it('carries the senior sciences back to Science', () => {
    expect(lineageSubjects(['Biology']).sort()).toEqual(['Biology', 'Science']);
    expect(lineageSubjects(['Chemistry', 'Mathematics']).sort()).toEqual([
      'Chemistry',
      'Mathematics',
      'Science',
    ]);
  });

  it('leaves already-continuous subjects alone', () => {
    expect(lineageSubjects(['Mathematics'])).toEqual(['Mathematics']);
    expect(lineageSubjects([])).toEqual([]);
  });
});

describe('loadDiagnosticDataFor', () => {
  it('serves every class that has its own map, scoped to the class window', () => {
    for (const klass of mappedClasses) {
      const data = loadDiagnosticDataFor(klass, []);
      expect(data, `class ${klass}`).not.toBeNull();
      for (const id of data!.index.ids()) {
        const node = data!.index.node(id)!;
        expect(node.klass, id).toBeLessThanOrEqual(klass);
        expect(node.klass, id).toBeGreaterThanOrEqual(klass - LOOK_BACK);
      }
      // Every probe must point at a node the merged index can see.
      for (const probe of data!.bank.probes) {
        expect(data!.index.node(probe.nodeId), probe.id).toBeTruthy();
      }
      expect(data!.lookBack).toBeGreaterThanOrEqual(0);
      expect(data!.lookBack).toBeLessThanOrEqual(LOOK_BACK);
    }
  });

  it('returns null for a class with no map of its own — looking back needs somewhere to place into', () => {
    const unmapped = [6, 7, 8, 9, 10, 11, 12].find((k) => !mappedClasses.has(k));
    // Once every class is mapped this guard has nothing to check — that is a
    // milestone, not a failure.
    if (unmapped === undefined) return;
    expect(loadDiagnosticDataFor(unmapped, [])).toBeNull();
  });

  it('subject scoping keeps only the chosen lineage', () => {
    for (const klass of mappedClasses) {
      const data = loadDiagnosticDataFor(klass, ['Biology']);
      if (data === null) continue; // that class has no Biology/Science map
      const allowed = new Set(['Biology', 'Science']);
      for (const id of data.index.ids()) {
        expect(allowed.has(data.index.node(id)!.subject), id).toBe(true);
      }
    }
  });

  it('the classic one-argument loader still answers', () => {
    for (const klass of mappedClasses) {
      expect(loadDiagnosticData(klass)).not.toBeNull();
    }
  });
});

describe('applyLinks', () => {
  const node = (id: string, klass: number, prerequisites: string[] = []) => ({
    id, klass, subject: 'Science', chapter: 'c', title: id,
    outcome: 'state ' + id, prerequisites, difficulty: 2,
  });

  it('adds the edge when both ends are in the window, without touching the source', () => {
    const c9 = node('c9-a', 9);
    const merged = applyLinks([c9, node('c8-x', 8)], [{ nodeId: 'c9-a', prerequisiteId: 'c8-x' }]);
    expect(merged.find((n) => n.id === 'c9-a')!.prerequisites).toEqual(['c8-x']);
    // The module's own node object must stay untouched — it is shared.
    expect(c9.prerequisites).toEqual([]);
  });

  it('drops a link whose far end fell outside the window', () => {
    const merged = applyLinks([node('c9-a', 9)], [{ nodeId: 'c9-a', prerequisiteId: 'c7-gone' }]);
    expect(merged.find((n) => n.id === 'c9-a')!.prerequisites).toEqual([]);
  });

  it('never doubles an edge the node already carries', () => {
    const merged = applyLinks(
      [node('c9-a', 9, ['c8-x']), node('c8-x', 8)],
      [{ nodeId: 'c9-a', prerequisiteId: 'c8-x' }],
    );
    expect(merged.find((n) => n.id === 'c9-a')!.prerequisites).toEqual(['c8-x']);
  });
});
