import { describe, expect, it } from 'vitest';
import { drawMissingIcons, verifyIconSvg } from '../src/drawIcon';
import type { LlmAdapter } from '../src/prepare';

const good =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<rect x="20" y="30" width="60" height="50" fill="#4aa3df"/>' +
  '<circle cx="50" cy="30" r="12" fill="#2c6e9e"/></svg>';

describe('verifyIconSvg', () => {
  it('accepts a small flat drawing', () => {
    expect(verifyIconSvg(good)).toEqual([]);
  });

  it('rejects everything the browser could execute', () => {
    // Inlined into our origin, same as the diagrams: rejected, never sanitised.
    const cases: [string, string][] = [
      ['<script>x()</script>', 'contains <script>'],
      ['<image href="https://evil.example/x.png"/>', 'contains an embedding tag'],
      ['<circle r="5" onload="x()"/>', 'contains an inline event handler'],
    ];
    for (const [inner, expected] of cases) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inner}<path d="M1 1"/></svg>`;
      expect(verifyIconSvg(svg)).toContain(expected);
    }
  });

  it('rejects text — the board writes its own labels', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="5" y="5">tank</text><path d="M1 1"/></svg>';
    expect(verifyIconSvg(svg)).toContain('contains <text> — the board writes its own labels');
  });

  it('rejects an empty or non-SVG reply outright', () => {
    expect(verifyIconSvg('Sure, here you go!')).toEqual(['does not start with <svg']);
    expect(
      verifyIconSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>'),
    ).toContain('contains no drawn shapes');
  });
});

describe('drawMissingIcons', () => {
  it('draws each missing noun and keeps what verifies', async () => {
    const artist: LlmAdapter = { complete: async (_s, user) => (user.includes('tank') ? good : 'nope') };
    const drawn = await drawMissingIcons('Water flow', ['tank', 'sluice'], artist);
    expect(Object.keys(drawn)).toEqual(['tank']);
    expect(drawn.tank).toContain('<svg');
  });

  it('survives an artist that throws, leaving the pencil to cover it', async () => {
    const artist: LlmAdapter = {
      complete: async () => {
        throw new Error('429');
      },
    };
    expect(await drawMissingIcons('x', ['tank'], artist)).toEqual({});
  });

  it('strips a markdown fence before judging', async () => {
    const fence = String.fromCharCode(96).repeat(3);
    const artist: LlmAdapter = { complete: async () => `${fence}svg\n${good}\n${fence}` };
    const drawn = await drawMissingIcons('x', ['tank'], artist);
    expect(drawn.tank).toBeDefined();
  });
});
