import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  answerProbe,
  buildPlan,
  isComplete,
  selectNextProbe,
  startSession,
} from '@ai-tutor/diagnostic';
import type { DiagnosticResult } from '@ai-tutor/knowledge-graph';
import { loadDiagnosticData } from '../src/lib/diagnosticData';
import { StudyPlan } from '../src/screens/StudyPlan';

/**
 * The screen renders whatever the engine decided, so the results under test are
 * produced by actually sitting the placement test over the committed Class 10
 * Science map. A hand-written DiagnosticResult would only prove that a
 * hand-written DiagnosticResult renders — it would not catch the plan growing a
 * step shape the screen cannot draw.
 */

const KLASS = 10;
const SUBJECTS = ['Science'];

const data = loadDiagnosticData(KLASS);
if (!data) throw new Error('the Class 10 Learning Outcome Map failed to load');
const index = data.index;
const bank = data.bank;

/** Sits the whole test, answering honestly except on the nodes in `weak`. */
function diagnose(weak: ReadonlySet<string>): DiagnosticResult {
  let session = startSession(index, bank, { klass: KLASS, subjects: SUBJECTS });
  while (!isComplete(session, index)) {
    const probe = selectNextProbe(session, index, bank);
    if (!probe) break;
    const wrong = (probe.correctIndex + 1) % 4;
    session = answerProbe(session, index, probe, weak.has(probe.nodeId) ? wrong : probe.correctIndex);
  }
  return buildPlan(session, index);
}

/**
 * A student weak on a node is weak on everything resting on it — otherwise the
 * engine correctly refuses to believe the gap and the plan comes back empty.
 */
const withDescendants = (id: string): Set<string> => new Set([id, ...index.descendantsOf(id)]);

/**
 * Reading a chemical equation is the one weak spot that produces both kinds of
 * step in a single plan: the two chemistry nodes have no lesson yet, and the
 * life-processes nodes that build on them do.
 */
const mixed = diagnose(withDescendants('sci10-chem-read-equation'));
const clear = diagnose(new Set());

const titleOf = (nodeId: string): string => {
  const node = index.node(nodeId);
  if (!node) throw new Error(`plan step ${nodeId} is not in the map`);
  return node.title;
};

const noop = () => {};

const render = (result: DiagnosticResult): string =>
  renderToString(<StudyPlan result={result} index={index} onStartLesson={noop} onHome={noop} />);

/** React escapes on the way out; assertions read better against the source copy. */
const decode = (html: string): string =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

const countOf = (html: string, needle: string): number => html.split(needle).length - 1;

describe('the engine gives this screen something worth testing', () => {
  it('produces a plan holding both a startable step and one with no lesson yet', () => {
    expect(mixed.plan.length).toBeGreaterThan(1);
    expect(mixed.plan.some((s) => s.lessonRef !== undefined)).toBe(true);
    expect(mixed.plan.some((s) => s.lessonRef === undefined)).toBe(true);
  });

  it('gives a student who answers everything correctly no plan at all', () => {
    expect(clear.plan).toHaveLength(0);
  });
});

describe('StudyPlan: the plan', () => {
  const html = decode(render(mixed));

  it('names how many things were found, in plain language', () => {
    expect(html).toContain(`We found ${mixed.plan.length} things worth fixing first`);
  });

  it('says "thing" for a plan of one', () => {
    const single = decode(render({ ...mixed, plan: mixed.plan.slice(0, 1) }));

    expect(single).toContain('We found 1 thing worth fixing first');
    expect(single).not.toContain('1 things');
  });

  it('numbers every step, from one', () => {
    for (let n = 1; n <= mixed.plan.length; n += 1) expect(html).toContain(`>${n}</div>`);
  });

  it('shows each step title from the map, in the order the engine planned', () => {
    const positions = mixed.plan.map((step) => html.indexOf(titleOf(step.nodeId)));

    for (const at of positions) expect(at).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('shows the reason under each step, so the plan explains itself', () => {
    for (const step of mixed.plan) expect(html).toContain(step.reason);
  });

  it('offers Start on exactly the steps that have a lesson', () => {
    const startable = mixed.plan.filter((s) => s.lessonRef !== undefined);

    expect(startable.length).toBeGreaterThan(0);
    expect(countOf(html, '>Start</button>')).toBe(startable.length);
    for (const step of startable) {
      expect(html).toContain(`aria-label="Start ${titleOf(step.nodeId)}"`);
    }
  });

  it('marks the steps with no lesson as coming soon, rather than hiding them', () => {
    const pending = mixed.plan.filter((s) => s.lessonRef === undefined);

    expect(pending.length).toBeGreaterThan(0);
    expect(countOf(html, 'Coming soon')).toBe(pending.length);
    // The gap is real even without a lesson, so it keeps its place in the list.
    for (const step of pending) expect(html).toContain(titleOf(step.nodeId));
  });

  it('ends with the way back home', () => {
    expect(html).toContain('Go to home');
  });
});

describe('StudyPlan: nothing to fix', () => {
  const html = decode(render(clear));

  it('congratulates rather than reporting a count of zero', () => {
    expect(html).toContain('Nothing to fix');
    expect(html).not.toContain('We found 0');
    expect(html).not.toContain('worth fixing first');
  });

  it('shows no steps and no actions that belong to a step', () => {
    expect(html).not.toContain('>Start</button>');
    expect(html).not.toContain('Coming soon');
    expect(html).not.toContain('>1</div>');
  });

  it('still offers the way back home', () => {
    expect(html).toContain('Go to home');
  });
});

describe('StudyPlan: a step whose node has left the map', () => {
  // A result saved before the map was regenerated can name a node that no longer
  // exists. That has to read as a row, not as "undefined".
  const stale: DiagnosticResult = {
    ...mixed,
    plan: [{ nodeId: 'sci10-chem-balance-equation-removed', reason: 'Worth a look.' }],
  };

  it('renders a readable title instead of undefined', () => {
    expect(index.node('sci10-chem-balance-equation-removed')).toBeNull();

    const html = decode(render(stale));

    expect(html).toContain('Sci10 Chem Balance Equation Removed');
    expect(html).toContain('Worth a look.');
    expect(html.toLowerCase()).not.toContain('undefined');
  });

  it('treats a step with no lesson as coming soon even when the node is gone', () => {
    expect(decode(render(stale))).toContain('Coming soon');
  });
});
