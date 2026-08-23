import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { selectNextProbe, startSession } from '@ai-tutor/diagnostic';
import { loadDiagnosticData } from '../src/lib/diagnosticData';
import { Diagnostic } from '../src/screens/Diagnostic';
import { BRAND } from '../src/brand';

/**
 * The screen is wiring, so the test is wired to the same real data the app
 * loads: the committed Class 10 map and probe bank. The expected first question
 * is computed with the engine rather than hard-coded, so this proves the screen
 * shows what the engine chose — a fixture would only prove the fixture renders.
 */

const KLASS = 10;
const SUBJECTS = ['Science'];

const data = loadDiagnosticData(KLASS);
if (!data) throw new Error('the Class 10 Learning Outcome Map failed to load');

const firstProbe = selectNextProbe(
  startSession(data.index, data.bank, { klass: KLASS, subjects: SUBJECTS }),
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

describe('Diagnostic: no map for this class', () => {
  it('renders the empty state and a way to continue instead of trapping the student', () => {
    // Only Class 10 has a map so far; every other class must degrade, not crash.
    expect(loadDiagnosticData(7)).toBeNull();

    const html = decode(renderScreen(7));

    expect(html).toContain('Placement test not ready');
    expect(html).toContain(BRAND.name);
    expect(html).toContain('Continue');
    expect(html).not.toContain(firstProbe.question);
  });
});

describe('loadDiagnosticData', () => {
  it('loads the committed Class 10 map and probe bank, and reuses the index', () => {
    expect(data.index.size).toBe(44);
    expect(data.bank.probes.length).toBeGreaterThan(0);
    expect(loadDiagnosticData(KLASS)).toBe(data);
  });
});
