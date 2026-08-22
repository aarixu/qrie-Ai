import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GraphIndex, loadGraph, type ProbeBank } from '@ai-tutor/knowledge-graph';
import { answerProbe, isComplete, startSession } from '../src/session';
import { selectNextProbe } from '../src/select';
import { buildPlan } from '../src/plan';

/**
 * The diagnostic run against the REAL committed map, not a toy fixture. This is
 * the test that says the thing works: a student with a specific, deliberately
 * planted misunderstanding must come out the other side with that exact
 * misunderstanding named at the top of their plan.
 */

const index = new GraphIndex(
  loadGraph(
    JSON.parse(
      fs.readFileSync(
        path.resolve(process.cwd(), 'packages/knowledge-graph/data/class10-science.json'),
        'utf8',
      ),
    ),
  ),
);

/**
 * The REAL generated probe bank, not a synthetic one. Running the diagnostic
 * against the actual questions is what makes this an integration test rather
 * than a restatement of the unit tests.
 */
const bank: ProbeBank = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), 'packages/knowledge-graph/data/class10-science.probes.json'),
    'utf8',
  ),
);

/** Answers honestly except for the nodes in `weak`. */
function simulate(weak: ReadonlySet<string>, maxQuestions = 20) {
  let s = startSession(index, bank, { klass: 10, subjects: ['Science'], maxQuestions });
  let asked = 0;
  while (!isComplete(s, index)) {
    const probe = selectNextProbe(s, index, bank);
    if (!probe) break;
    asked += 1;
    const wrong = (probe.correctIndex + 1) % 4;
    s = answerProbe(s, index, probe, weak.has(probe.nodeId) ? wrong : probe.correctIndex);
  }
  return { session: s, asked, result: buildPlan(s, index) };
}

describe('diagnostic over the real Class 10 Science map', () => {
  it('the map is big enough and connected enough to diagnose', () => {
    expect(index.size).toBeGreaterThan(35);
    const hub = Math.max(...index.ids().map((id) => index.blockCount(id)));
    expect(hub).toBeGreaterThan(10);
  });

  it('describes the whole map from at most twenty questions', () => {
    const { asked, session } = simulate(new Set());
    expect(asked).toBeLessThanOrEqual(20);
    // Far more nodes end up with an opinion than were ever asked about — that
    // inference is the entire point of the prerequisite structure.
    const settled = Object.values(session.mastery).filter((b) => b > 0.75 || b < 0.25).length;
    expect(settled).toBeGreaterThan(asked * 2);
  });

  it('a student who is fine everywhere gets a short plan', () => {
    const { result } = simulate(new Set());
    expect(result.plan.length).toBeLessThan(5);
  });

  it("finds a planted gap and names its foundation first", () => {
    // This student cannot balance an equation, so everything that rests on it
    // is shaky too — the plan must start at the foundation, not the symptom.
    const { result } = simulate(
      new Set([
        'sci10-chem-balance-equation',
        'sci10-lp-photo-equation-write',
        'sci10-lp-respiration-equation',
      ]),
    );

    const ids = result.plan.map((p) => p.nodeId);
    expect(ids).toContain('sci10-chem-balance-equation');

    const foundation = ids.indexOf('sci10-chem-balance-equation');
    const symptom = ids.indexOf('sci10-lp-photo-equation-write');
    if (symptom !== -1) expect(foundation).toBeLessThan(symptom);
  });

  it('every plan step is teachable — prerequisites never come later', () => {
    const { result } = simulate(new Set(['sci10-lp-heart-is-pump', 'sci10-lp-double-circulation']));
    const at = (id: string) => result.plan.findIndex((p) => p.nodeId === id);
    for (const step of result.plan) {
      for (const prerequisite of index.prerequisitesOf(step.nodeId)) {
        const before = at(prerequisite);
        if (before !== -1) expect(before).toBeLessThan(at(step.nodeId));
      }
    }
  });

  it('plan steps link into real lessons where one teaches the node', () => {
    // A COHERENT weak student: shaky on the heart and on everything that rests
    // on it. Marking only the foundation would describe a student who explains
    // double circulation while denying the heart is a pump — and the model is
    // right to refuse to believe that, so no gap would ever surface.
    const heart = 'sci10-lp-heart-is-pump';
    const weak = new Set([heart, ...index.descendantsOf(heart)]);
    const { result } = simulate(weak);

    expect(result.plan.length).toBeGreaterThan(0);
    expect(result.plan.filter((p) => p.lessonRef).length).toBeGreaterThan(0);
  });

  it('refuses to believe an incoherent student', () => {
    // Wrong ONLY on the foundation, right on everything built from it. The
    // downstream successes are strong evidence the foundation is held, so the
    // diagnostic should not manufacture a gap out of one odd answer.
    const { result } = simulate(new Set(['sci10-lp-heart-is-pump']));
    expect(result.plan.map((p) => p.nodeId)).not.toContain('sci10-lp-heart-is-pump');
  });

  it('is reproducible — the same student always gets the same plan', () => {
    const weak = new Set(['sci10-lp-absorption-site']);
    expect(simulate(weak).result.plan).toEqual(simulate(weak).result.plan);
  });
});
