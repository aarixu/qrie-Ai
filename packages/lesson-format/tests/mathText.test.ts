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
