import { describe, expect, it } from 'vitest';
import { lineToHtml, texToHtml } from '../src/math';

/** T6: maths typeset, and nothing a model wrote reaches the page as HTML. */
describe('maths on the board', () => {
  it('typesets the maths and keeps the words', () => {
    const html = lineToHtml('If $x + y = 7$, write $x$ in terms of $y$.');
    expect(html).toContain('katex');
    expect(html).toContain('If ');
    expect(html).toContain(', write ');
  });

  it('escapes the words around the maths', () => {
    const html = lineToHtml('<img src=x onerror=alert(1)> and $x$');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('refuses KaTeX commands that would reach out of the maths', () => {
    expect(texToHtml(String.raw`\href{javascript:alert(1)}{x}`) ?? '').not.toContain('javascript:');
  });

  it('shows maths it cannot read as its source, never an error box', () => {
    expect(lineToHtml(String.raw`$\frac{1}{$`)).not.toContain('katex-error');
    expect(texToHtml(String.raw`\frac{1}{`)).toBeNull();
  });
});

describe('a formula line as LaTeX', () => {
  it('sets a trailing equation number the way a textbook does', async () => {
    const { formulaTex } = await import('../src/math');
    expect(formulaTex('x + y = 14 --- (1)')).toBe(String.raw`x + y = 14 \qquad (1)`);
    expect(formulaTex('x - y = 4 ... (2)')).toBe(String.raw`x - y = 4 \qquad (2)`);
    expect(formulaTex('$v = s / t$')).toBe('v = s / t');
  });
});
