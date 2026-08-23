import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/brand';
import { Logo, Wordmark } from '../src/ui/Logo';
import { MIN_SPLASH_MS, Splash } from '../src/screens/Splash';

/**
 * Source with comments stripped. Prose is allowed to name the product — the
 * mark's etymology is worth explaining — but code is not: a literal there is
 * exactly the bug brand.ts exists to prevent.
 */
const codeOf = (relPath: string): string =>
  readFileSync(resolve(process.cwd(), relPath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

describe('Splash', () => {
  it('renders the product name from BRAND as visible text', () => {
    // Templated from the constant, so renaming the product renames the
    // expectation too and this test can never pass against a stale literal.
    expect(renderToString(<Splash />)).toContain(`>${BRAND.name}<`);
  });

  it('renders the tagline from BRAND', () => {
    expect(renderToString(<Splash />)).toContain(BRAND.tagline);
  });

  it('gives the loading indicator a role and an accessible label', () => {
    const html = renderToString(<Splash />);
    expect(html).toContain('role="status"');
    expect(html).toContain(`aria-label="Loading ${BRAND.name}"`);
  });

  it('holds long enough that the splash cannot read as a flash', () => {
    expect(MIN_SPLASH_MS).toBeGreaterThanOrEqual(600);
  });

  it('names the product nowhere in its own code', () => {
    expect(codeOf('apps/classroom/src/screens/Splash.tsx')).not.toContain(BRAND.name);
  });
});

describe('Logo', () => {
  it('renders square at the size it is given', () => {
    const html = renderToString(<Logo size={64} />);
    expect(html).toContain('width="64"');
    expect(html).toContain('height="64"');
    // The mark scales by viewBox, so one drawing serves 24px and 120px alike.
    expect(html).toContain('viewBox="0 0 32 32"');
  });

  it('takes its colour from a token class, never a literal hex', () => {
    const html = renderToString(<Logo size={24} />);
    expect(html).toContain('text-primary');
    expect(html).toContain('currentColor');
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it('is hidden from assistive tech, since the wordmark carries the name', () => {
    expect(renderToString(<Logo size={24} />)).toContain('aria-hidden="true"');
  });

  it('names the product nowhere in its own code', () => {
    expect(codeOf('apps/classroom/src/ui/Logo.tsx')).not.toContain(BRAND.name);
  });
});

describe('Wordmark', () => {
  it('pairs the mark with the name read from BRAND', () => {
    const html = renderToString(<Wordmark size={48} />);
    expect(html).toContain('width="48"');
    expect(html).toContain(`>${BRAND.name}<`);
    expect(html).toContain('font-headline-lg');
  });
});
