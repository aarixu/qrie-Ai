import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { selectNextProbe, startSession } from '@ai-tutor/diagnostic';
import { LOOK_BACK, loadDiagnosticDataFor } from '../src/lib/diagnosticData';
import { Diagnostic } from '../src/screens/Diagnostic';
import { BRAND } from '../src/brand';

/**
 * The screen is wiring, so the test is wired to the same real data the app
 * loads — including the earlier classes the placement now looks back into, so
 * the expected question moves when the map grows rather than going stale. It
 * is computed with the engine rather than hard-coded, which proves the screen
 * shows what the engine chose; a fixture would only prove the fixture renders.
 */

const KLASS = 10;
const SUBJECTS = ['Science'];

// Loaded exactly as the screen loads it — same merge, same lineage, same
// look-back. A session built with different config picks a different first
// question, which is how this test drifted from the screen once before.
const data = loadDiagnosticDataFor(KLASS, SUBJECTS);
if (!data) throw new Error('the Class 10 Learning Outcome Map failed to load');

const firstProbe = selectNextProbe(
  startSession(data.index, data.bank, {
    klass: KLASS,
    subjects: data.subjects,
    lookBack: data.lookBack,
  }),
  data.index,
  data.bank,
);
if (!firstProbe) throw new Error('the engine chose no first probe for Class 10 Science');

const noop = () => {};

/** React escapes text on the way out; assertions read better against the source copy. */
const decode = (html: string): string =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const renderScreen = (klass: number): string =>
  renderToString(
    <Diagnostic klass={klass} subjects={SUBJECTS} onComplete={noop} onSkip={noop} />,
  );

describe('Diagnostic: the question', () => {
  it('renders the probe the engine chose, with all four options', () => {
    const html = decode(renderScreen(KLASS));

    expect(html).toContain(firstProbe.question);
    for (const option of firstProbe.options) expect(html).toContain(option);
  });

  it('letters the options A to D', () => {
    const html = renderScreen(KLASS);

    for (const letter of ['A', 'B', 'C', 'D']) expect(html).toContain(`>${letter}</span>`);
  });

  it('names the subject and chapter of the probed node', () => {
    const node = data.index.node(firstProbe.nodeId);
    if (!node) throw new Error(`probe ${firstProbe.id} points at a node not in the map`);

    expect(decode(renderScreen(KLASS))).toContain(`${node.subject} ·`);
  });

  it('shows the count and a progress bar, starting at the first of twenty', () => {
    const html = renderScreen(KLASS);

    expect(html).toContain('1 / 20');
    expect(html).toContain('role="progressbar"');
  });

  it('offers the skip control', () => {
    expect(decode(renderScreen(KLASS))).toContain("I'm not sure");
  });

  it('gives every option identical styling, so nothing hints at the answer', () => {
    const html = renderScreen(KLASS);
    const classes = [...html.matchAll(/<button class="(group [^"]*)"/g)].map((m) => m[1]);

    // A diagnostic that reveals correctness stops measuring the student, so the
    // four cards must be indistinguishable — including to a careless future edit.
    expect(classes).toHaveLength(4);
    expect(new Set(classes).size).toBe(1);
  });
});

/**
 * DERIVED, never pinned — for the reason stated three blocks below about map
 * sizes, and learned the hard way here.
 *
 * This used to name Class 7, on the note that "only Class 10 has a map so far".
 * Generating the Class 6-12 curriculum gave Class 7 a map, and the test failed
 * on the generation run rather than on a defect — it had stopped exercising the
 * empty state at all. Asking which class has no map keeps it honest however far
 * the curriculum grows, and turns the day every class is covered into a skip
 * rather than a red build.
 */
const UNMAPPED = [6, 7, 8, 9, 10, 11, 12].find(
  (klass) => loadDiagnosticDataFor(klass, SUBJECTS) === null,
);

describe.skipIf(UNMAPPED === undefined)('Diagnostic: no map for this class', () => {
  it('renders the empty state and a way to continue instead of trapping the student', () => {
    const klass = UNMAPPED!;
    expect(loadDiagnosticDataFor(klass, SUBJECTS)).toBeNull();

    const html = decode(renderScreen(klass));

    expect(html).toContain('Placement test not ready');
    expect(html).toContain(BRAND.name);
    expect(html).toContain('Continue');
    expect(html).not.toContain(firstProbe.question);
  });
});

describe('the merged map the screen is given', () => {
  it('carries the student class and the levels behind it, and nothing above', () => {
    // Sizes are derived, never pinned: the map grows chapter by chapter, and a
    // hard-coded count would fail on the next generation run rather than on a
    // real defect.
    expect(data.index.size).toBeGreaterThan(0);
    expect(data.bank.probes.length).toBeGreaterThan(0);

    for (const id of data.index.ids()) {
      const node = data.index.node(id)!;
      expect(node.klass, id).toBeLessThanOrEqual(KLASS);
      expect(node.klass, id).toBeGreaterThanOrEqual(KLASS - LOOK_BACK);
    }
  });

  it('is memoised per student, so the index is built once', () => {
    expect(loadDiagnosticDataFor(KLASS, SUBJECTS)).toBe(data);
  });

  it('every probe points at a node the merged index can see', () => {
    for (const probe of data.bank.probes) {
      expect(data.index.node(probe.nodeId), probe.id).toBeTruthy();
    }
  });
});
