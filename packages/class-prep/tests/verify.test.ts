import { describe, expect, it } from 'vitest';
import { verifySvg } from '../src/verify';
import type { VisualBrief } from '../src/types';

const brief: VisualBrief = {
  id: 'd_graph',
  parts: ['axes', 'line_fast'],
  brief: 'a graph',
  alt: 'a distance-time graph',
  box: { x: 90, y: 110, w: 820, h: 400 },
};

const wrap = (inner: string, viewBox = '0 0 1000 620') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${inner}</svg>`;

const good = wrap(
  '<g id="axes"><path d="M1 1 L2 2" stroke="var(--a, #333)"/></g>' +
    '<g id="line_fast"><line x1="1" y1="1" x2="9" y2="9" stroke="var(--b, #f00)"/></g>',
);

describe('a picture that keeps its promises passes', () => {
  it('accepts artwork with every named group, shapes, and no text', () => {
    expect(verifySvg(good, brief)).toEqual([]);
  });

  it('accepts leading whitespace, because models indent', () => {
    expect(verifySvg(`\n  ${good}\n`, brief)).toEqual([]);
  });
});

describe('nothing the browser can execute gets on the board', () => {
  // This markup is inlined into the page so its groups can be lit one at a
  // time. Anything executable here would be executing in our origin.
  const cases: [string, string][] = [
    ['<script>alert(1)</script>', 'contains <script>'],
    ['<foreignObject><b>hi</b></foreignObject>', 'contains <foreignObject>'],
    ['<iframe src="#"></iframe>', 'contains an embedding tag'],
    ['<circle r="5" onclick="steal()"/>', 'contains an inline event handler'],
    ['<a href="javascript:x()"><circle r="5"/></a>', 'contains a javascript: URL'],
    ['<image href="https://evil.example/x.png"/>', 'references an external resource'],
  ];

  for (const [inner, expected] of cases) {
    it(`rejects: ${expected}`, () => {
      const svg = wrap(`<g id="axes"><path d="M1 1"/></g><g id="line_fast">${inner}</g>`);
      expect(verifySvg(svg, brief)).toContain(expected);
    });
  }
});

describe('a picture that breaks the brief is rejected', () => {
  it('rejects a missing named group, naming which', () => {
    const svg = wrap('<g id="axes"><path d="M1 1"/></g>');
    expect(verifySvg(svg, brief)).toContain('missing named group(s): line_fast');
  });

  it('rejects baked-in text — labels stay ours to place and translate', () => {
    const svg = wrap(
      '<g id="axes"><path d="M1 1"/><text x="5" y="5">time</text></g><g id="line_fast"><path d="M1 1"/></g>',
    );
    expect(verifySvg(svg, brief)).toContain('contains <text> — the board draws its own labels');
  });

  it('rejects the wrong viewBox, because the board is a fixed size', () => {
    const svg = wrap(
      '<g id="axes"><path d="M1 1"/></g><g id="line_fast"><path d="M1 1"/></g>',
      '0 0 800 600',
    );
    expect(verifySvg(svg, brief)).toContain('viewBox must be "0 0 1000 620", got "0 0 800 600"');
  });

  it('rejects a picture with the groups but no shapes in them', () => {
    // This passes every other check and shows the student an empty box, so the
    // emptiness has to fail on its own.
    const svg = wrap('<g id="axes"></g><g id="line_fast"></g>');
    expect(verifySvg(svg, brief)).toContain('contains no drawn shapes');
  });

  it('rejects a reply that is not an SVG at all, and stops there', () => {
    const problems = verifySvg('Sure! Here is your diagram:', brief);
    expect(problems).toEqual(['does not start with <svg']);
  });
});
