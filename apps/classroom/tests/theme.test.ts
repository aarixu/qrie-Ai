import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, isDark, watchTheme } from '../src/lib/theme';

/** jsdom has no matchMedia; each test states what the OS is asking for. */
function stubOs(prefersDark: boolean, listeners: { fn?: (e: unknown) => void } = {}) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) => ({
      matches: query.includes('dark') ? prefersDark : false,
      addEventListener: (_: string, fn: (e: unknown) => void) => {
        listeners.fn = fn;
      },
      removeEventListener: () => {
        listeners.fn = undefined;
      },
    }),
  );
}

beforeEach(() => {
  document.documentElement.className = '';
  document.head.innerHTML = '<meta name="theme-color" content="#faf7f0" />';
});
afterEach(() => vi.unstubAllGlobals());

const chrome = () => document.querySelector('meta[name="theme-color"]')!.getAttribute('content');

describe('isDark', () => {
  it('honours an explicit choice whatever the OS says', () => {
    stubOs(true);
    expect(isDark('light')).toBe(false);
    stubOs(false);
    expect(isDark('dark')).toBe(true);
  });

  it('follows the OS on system', () => {
    stubOs(true);
    expect(isDark('system')).toBe(true);
    stubOs(false);
    expect(isDark('system')).toBe(false);
  });
});

describe('applyTheme', () => {
  it('drives the class and the browser chrome together', () => {
    stubOs(false);
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    // An app that goes dark while the address bar stays white looks broken.
    expect(chrome()).toBe('#141318');

    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(chrome()).toBe('#faf7f0');
  });
});

describe('watchTheme', () => {
  it('re-applies when the OS flips, while following system', () => {
    const listeners: { fn?: (e: unknown) => void } = {};
    stubOs(false, listeners);
    const stop = watchTheme('system');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    stubOs(true, listeners);
    listeners.fn?.({});
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    stop();
  });

  it('ignores OS flips once the student has chosen', () => {
    const listeners: { fn?: (e: unknown) => void } = {};
    stubOs(true, listeners);
    watchTheme('light');
    // No listener is even registered — the choice is the answer.
    expect(listeners.fn).toBeUndefined();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});

describe('nothing hardcodes the page ground', () => {
  it('main.tsx leaves the body colourless — html owns the ground', () => {
    const main = fs.readFileSync(path.resolve(__dirname, '../src/main.tsx'), 'utf8');
    // An inline background here is a literal hex that beats every dark rule,
    // and the student sees it the moment the page overscrolls.
    expect(main).not.toMatch(/body\.style\.(background|backgroundColor)/);
  });

  it('index.css paints the ground from the theme variable', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../src/index.css'), 'utf8');
    expect(css).toMatch(/html\s*\{[^}]*background-color:\s*rgb\(var\(--c-background\)\)/);
  });
});

describe('the pre-paint script in index.html', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');

  it('reads the same store key the preferences store writes', () => {
    expect(html).toContain('ai-tutor:preferences');
  });

  it('uses the same dark background as theme.css, so the two cannot drift', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../src/theme.css'), 'utf8');
    const darkBlock = css.slice(css.indexOf('.dark {'));
    const background = /--c-background:\s*(\d+) (\d+) (\d+)/.exec(darkBlock)!;
    const hex =
      '#' +
      [background[1], background[2], background[3]]
        .map((n) => Number(n).toString(16).padStart(2, '0'))
        .join('');
    expect(html).toContain(hex);
  });

  it('runs before the app bundle — a late script is a white flash', () => {
    expect(html.indexOf('ai-tutor:preferences')).toBeLessThan(html.indexOf('/src/main.tsx'));
  });
});
