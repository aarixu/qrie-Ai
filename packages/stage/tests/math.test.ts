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

describe('which formulas are typeset (seventh review)', () => {
  it('typesets maths, and leaves words, percentages and arrows as written', async () => {
    const { typesetsAsMaths } = await import('../src/math');
    expect(typesetsAsMaths('2x + 3 = 11')).toBe(true);
    expect(typesetsAsMaths('v = s / t')).toBe(true);
    expect(typesetsAsMaths('sin 30 = 1/2')).toBe(true);
    expect(typesetsAsMaths('$\text{Mass} = 5$')).toBe(true);
    expect(typesetsAsMaths('Mass of Reactants = Mass of Products')).toBe(false);
    expect(typesetsAsMaths('Profit % = (Profit / CP) × 100')).toBe(false);
    expect(typesetsAsMaths('A --> B')).toBe(false);
    expect(typesetsAsMaths('1 nm = 10^-9 m')).toBe(false);
  });
  it('typesets powers and products, and leaves a chemical formula as written (eighth review)', async () => {
    const { typesetsAsMaths } = await import('../src/math');
    expect(typesetsAsMaths('(a+b)^2=a^2+2ab+b^2')).toBe(true);
    expect(typesetsAsMaths('x^2-5x+6=0')).toBe(true);
    expect(typesetsAsMaths('H = I^2Rt')).toBe(true);
    expect(typesetsAsMaths('PE = mgh')).toBe(true);
    expect(typesetsAsMaths('d = √((x2 - x1)^2 + (y2 - y1)^2)')).toBe(true);
    expect(typesetsAsMaths('H2O = 2(1) + 16 = 18 u')).toBe(false);
    expect(typesetsAsMaths('CO2 + H2O')).toBe(false);
    expect(typesetsAsMaths('2^10 = 1024')).toBe(false);
  });
  it('leaves abbreviations and units plain (third review)', async () => {
    const { typesetsAsMaths } = await import('../src/math');
    expect(typesetsAsMaths('HCF × LCM = a × b')).toBe(false);
    expect(typesetsAsMaths('LCM(4, 6) = 12')).toBe(false);
    expect(typesetsAsMaths('MRP = 500')).toBe(false);
    expect(typesetsAsMaths('v = 60 kmph')).toBe(false);
    expect(typesetsAsMaths('PE = mgh')).toBe(true);
  });
  it('typesets formulas written in capitals (fourth review)', async () => {
    const { typesetsAsMaths } = await import('../src/math');
    expect(typesetsAsMaths('SI = PRT/100')).toBe(true);
    expect(typesetsAsMaths('∠PQR = 60°')).toBe(true);
    expect(typesetsAsMaths('ΔPQR ≅ ΔXYZ')).toBe(true);
    expect(typesetsAsMaths('HCF × LCM = a × b')).toBe(false);
  });
  it('raises a whole bracketed power', async () => {
    const { formulaTex } = await import('../src/math');
    expect(formulaTex('a^m × a^n = a^(m+n)')).toBe('a^m × a^n = a^{m+n}');
  });
  it('sets sin, cos and log upright, as functions', async () => {
    const { formulaTex } = await import('../src/math');
    expect(formulaTex('sin 30 = 1/2')).toBe(String.raw`\sin 30 = 1/2`);
    expect(formulaTex('cosec A = 1 / sin A')).toBe(String.raw`\operatorname{cosec} A = 1 / \sin A`);
  });
  it('will not typeset a runaway or oversized piece of maths', async () => {
    const { texToHtml } = await import('../src/math');
    expect(texToHtml('x'.repeat(401))).toBeNull();
    expect(texToHtml(String.raw`\rule{5000px}{5000px}`) ?? '').not.toContain('5000');
  });
});
