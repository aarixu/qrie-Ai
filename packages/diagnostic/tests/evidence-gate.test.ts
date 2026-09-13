import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  GraphIndex,
  applyDoubt,
  applyEvidence,
  evidenceFrom,
  gapsFrom,
  initialMastery,
  loadGraph,
  type Answer,
} from '@ai-tutor/knowledge-graph';
import { buildPlan } from '../src/plan';
import { startSession } from '../src/session';
import type { ProbeBank } from '@ai-tutor/knowledge-graph';

/**
 * THE GATE ITSELF, AGAINST THE REAL MAPS.
 *
 * `gapsFrom` refuses to call a node a weakness unless something actually
 * examined it. That rule closed the 0.46 defect — a difficulty-4 node seeds
 * below the gap threshold, so fifteen nodes nobody asked about used to sit
 * under the line and fill a perfect student's plan with twelve phantom steps.
 *
 * A gate is only as good as both of its edges, and these are the two that
 * matter. Letting the wrong node through puts an invented weakness in front of
 * a student; keeping the right one out silently discards a signal the student
 * gave us on purpose. Both have happened in this file's history.
 */

const load = (file: string) => {
  const raw = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), `packages/knowledge-graph/data/${file}.json`), 'utf8'),
  );
  return new GraphIndex(loadGraph(raw));
};

describe('a node the student got RIGHT never becomes a weakness', () => {
  // The subtle version of the 0.46 defect, and the one a spot check misses:
  // a correct answer puts every ancestor into the evidence region by topology,
  // but belief only moves by a DECAYED amount. An ancestor seeded at 0.46 and
  // several hops up could in principle be admitted by the gate and still sit
  // under the 0.5 line — examined, and wrong about it. So this asks every node
  // in two real maps rather than picking one.
  for (const file of ['class10-science', 'class9-science']) {
    it(file, () => {
      const index = load(file);
      const seed = initialMastery(index, { biasByDifficulty: true });

      const offenders: string[] = [];
      for (const id of index.ids()) {
        const answer: Answer = { nodeId: id, probeId: `probe-${id}`, correct: true, chosenIndex: 0, ms: 3000 };
        const mastery = applyEvidence(seed, index, answer);
        const gaps = gapsFrom(mastery, index, { evidence: evidenceFrom(index, [answer]) });
        if (gaps.length > 0) {
          offenders.push(`${id} → ${gaps.map((g) => `${g.nodeId}@${mastery[g.nodeId]?.toFixed(3)}`).join(', ')}`);
        }
      }
      expect(offenders, offenders.slice(0, 5).join('\n')).toEqual([]);
    });
  }
});

describe('a hand raised in class still reaches the plan', () => {
  const index = load('class10-science');
  const bank: ProbeBank = { probes: [] } as unknown as ProbeBank;

  /**
   * The regression the gate introduced. The classroom lowers belief for an
   * outcome the student stopped the class on, and the plan used to derive
   * "what this test examined" from the ANSWERS alone — so a student could
   * raise their hand on the same outcome four times and get a plan that never
   * mentions it. A raised hand is somebody examining it.
   */
  it('names a node the student stopped the class on, even with no answer about it', () => {
    const stuck = index.ids()[0];
    const fresh = startSession(index, bank, { klass: 10, subjects: ['Science'] });
    // A student who stopped the class on the same outcome three times. One
    // raised hand is a nudge by design and may well leave belief above the
    // line; three is the case the plan must not be silent about.
    let mastery = fresh.mastery;
    for (let i = 0; i < 3; i += 1) mastery = applyDoubt(mastery, [stuck]);
    expect(mastery[stuck]).toBeLessThan(0.5);
    const session = { ...fresh, mastery, seeded: new Set([stuck]) };

    const result = buildPlan(session, index);
    expect(result.gaps.map((g) => g.nodeId)).toContain(stuck);
  });

  it('still says nothing about a node no one has examined at all', () => {
    // The other edge. Without this the fix above would simply reopen the 0.46
    // defect through a different door.
    const fresh = startSession(index, bank, { klass: 10, subjects: ['Science'] });
    expect(buildPlan(fresh, index).gaps).toEqual([]);
  });
});
