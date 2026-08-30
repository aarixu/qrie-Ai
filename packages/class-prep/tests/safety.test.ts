import { describe, expect, it } from 'vitest';
import { unsafeMarkup } from '../src/safety';
import { verifyIconSvg } from '../src/drawIcon';
import { verifySvg } from '../src/verify';

/**
 * The gate both picture paths go through.
 *
 * Every case here is a way markup written by a model reaches the network or
 * runs code, in our origin, in a student's browser.
 */

const svg = (inner: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 620">${inner}<path d="M1 1"/></svg>`;

describe('unsafeMarkup', () => {
  it('passes an ordinary drawing', () => {
    expect(unsafeMarkup(svg('<rect x="1" y="1" width="8" height="8" fill="#4aa3df"/>'))).toEqual([]);
  });

  it('refuses a stylesheet, which can fetch without ever looking like a link', () => {
    // The hole a review found: neither picture path looked at <style> at all.
    expect(unsafeMarkup(svg('<style>@import url(https://evil.example/x.css);</style>'))).toContain(
      'contains <style>',
    );
    expect(unsafeMarkup(svg('<style>*{fill:red}</style>'))).toContain('contains <style>');
  });

  it('refuses @import wherever it appears', () => {
    expect(unsafeMarkup(svg('<defs>@import "x.css"</defs>'))).toContain('contains an @import');
  });

  it('refuses a url() that leaves the document, in an attribute or anywhere else', () => {
    for (const inner of [
      '<rect style="fill:url(https://evil.example/x.png)" width="4" height="4"/>',
      '<rect fill="url(&quot;//evil.example/x&quot;)" width="4" height="4"/>',
      '<circle r="3" style="background-image:url(data:image/svg+xml,x)"/>',
    ]) {
      expect(unsafeMarkup(svg(inner))).toContain('references an external resource');
    }
  });

  it('still allows a reference INTO the same document, which is how gradients work', () => {
    expect(unsafeMarkup(svg('<rect fill="url(#grad)" width="4" height="4"/>'))).toEqual([]);
  });

  it('refuses script, handlers, embeds and javascript: URLs', () => {
    expect(unsafeMarkup(svg('<script>x()</script>'))).toContain('contains <script>');
    expect(unsafeMarkup(svg('<circle r="2" onclick="x()"/>'))).toContain(
      'contains an inline event handler',
    );
    expect(unsafeMarkup(svg('<image href="/x.png"/>'))).toContain('contains an embedding tag');
    expect(unsafeMarkup(svg('<a href="javascript:x()"><circle r="2"/></a>'))).toContain(
      'contains a javascript: URL',
    );
  });
});

describe('both picture paths are behind the same gate', () => {
  const brief = { id: 'd1', alt: 'a cell', parts: [], prompt: 'draw a cell' };

  it('the diagram verifier refuses a stylesheet', () => {
    const withStyle =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 620">' +
      '<style>@import url(https://evil.example/x.css);</style><path d="M1 1"/></svg>';
    expect(verifySvg(withStyle, brief)).toContain('contains <style>');
  });

  it('the icon artist refuses one too', () => {
    const withStyle =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<style>*{fill:red}</style><path d="M1 1"/></svg>';
    expect(verifyIconSvg(withStyle)).toContain('contains <style>');
  });
});
