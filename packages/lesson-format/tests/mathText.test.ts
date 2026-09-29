import { describe, expect, it } from 'vitest';
import { hasMath, mathPlain, textWidth, wrapLines } from '../src/index';

/** T6: board lines may carry LaTeX between $…$; the layout measures what it reads as. */
describe('maths in a board line', () => {
  it('knows a line with maths in it', () => {
    expect(hasMath('If $x + y = 7$, write $x$')).toBe(true);
    expect(hasMath('It costs $5')).toBe(false);
  });

  it('measures LaTeX by what it reads as', () => {
    expect(mathPlain(String.raw`$\frac{a}{b} = 2$`)).toBe('a/b = 2');
    expect(mathPlain('$x^{2} + 3x$')).toBe('x2 + 3x');
    expect(textWidth('$x + y = 7$', 30)).toBe(textWidth('x + y = 7', 30));
  });

  it('never breaks maths across two lines', () => {
    const lines = wrapLines('If $x + y = 7$, how do you write $x$ in terms of $y$?', 200, 30);
    for (const line of lines) expect((line.match(/\$/g) ?? []).length % 2).toBe(0);
    expect(lines.join(' ')).toContain('$x + y = 7$,');
  });
});

/** Seventh review: the checker reads what the LaTeX MEANS, or refuses to guess. */
describe('latexToPlain', () => {
  it('keeps powers, fractions and operators as they mean', async () => {
    const { latexToPlain } = await import('../src/index');
    expect(latexToPlain(String.raw`Find $x$: $2^{x} = 32$`)).toBe('Find x: 2^(x) = 32');
    expect(latexToPlain(String.raw`$12 \div 3 = 4$`)).toBe('12 ÷ 3 = 4');
    expect(latexToPlain(String.raw`$\frac{x+1}{2} = 4$`)).toBe('(x+1)/(2) = 4');
    expect(latexToPlain(String.raw`$\dfrac{3}{4} = 0.75$`)).toBe('(3)/(4) = 0.75');
    expect(latexToPlain(String.raw`$10^{-2} = 0.01$`)).toBe('10^(-2) = 0.01');
    expect(latexToPlain('$3^2+4^2=5^2$')).toBe('3^2+4^2=5^2');
  });
  it('refuses a command it cannot translate', async () => {
    const { latexToPlain } = await import('../src/index');
    expect(latexToPlain(String.raw`$\int x\,dx$`)).toBeNull();
  });
  // Eighth review: "2(1)/(2)" reads as 1, and x_{1} and x_{2} both read as x.
  it('refuses a mixed number and a subscript rather than misread them', async () => {
    const { latexToPlain } = await import('../src/index');
    expect(latexToPlain(String.raw`Find $x$: $x - 1\frac{1}{4} = 2$`)).toBeNull();
    expect(latexToPlain(String.raw`$2\frac{3}{5} = \frac{13}{5}$`)).toBeNull();
    expect(latexToPlain(String.raw`Given: $x_{1} = 2$, $x_{2} = 6$`)).toBeNull();
    expect(latexToPlain(String.raw`$a_n = a + (n - 1)d$`)).toBeNull();
    // A product with a fraction is still read: "3 × ½" is not a mixed number.
    expect(latexToPlain(String.raw`$3 \times \frac{1}{2} = 1.5$`)).toBe('3 × (1)/(2) = 1.5');
  });
});
