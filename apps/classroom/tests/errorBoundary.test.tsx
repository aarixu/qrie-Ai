import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../src/ui/ErrorBoundary';

/**
 * A render throw used to take the whole app to a permanent blank page. On a
 * phone that is an uninstall, so the boundary has to do three things: catch
 * it, say something useful, and tell whoever is watching.
 *
 * Rendered on the CLIENT, deliberately: renderToString does not run error
 * boundaries at all, so a server-rendered test would prove nothing.
 */

const Boom = (): never => {
  throw new Error('kaboom');
};

let host: HTMLDivElement;
let quiet: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  // React prints the caught error; the test is not interested in the noise.
  quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  quiet.mockRestore();
  host.remove();
});

const draw = (node: React.ReactNode): string => {
  const root = createRoot(host);
  act(() => root.render(node));
  return host.innerHTML;
};

describe('when a screen throws', () => {
  it('shows a way out instead of a blank page', () => {
    const html = draw(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(html).toContain('stopped working');
    expect(html).toContain('Try again');
  });

  it('tells the student their work is safe, and does not apologise', () => {
    const html = draw(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(html).toMatch(/saved on this device/i);
    expect(html.toLowerCase()).not.toContain('sorry');
  });

  it('hands the error to whoever is watching', () => {
    const seen: Error[] = [];
    draw(
      <ErrorBoundary onError={(e) => seen.push(e)}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(seen[0]?.message).toBe('kaboom');
  });

  it('survives a reporter that throws, rather than replacing the error with its own', () => {
    expect(() =>
      draw(
        <ErrorBoundary
          onError={() => {
            throw new Error('the reporter is also broken');
          }}
        >
          <Boom />
        </ErrorBoundary>,
      ),
    ).not.toThrow();
    expect(host.innerHTML).toContain('stopped working');
  });

  it('renders its children untouched when nothing throws', () => {
    const html = draw(
      <ErrorBoundary>
        <p>all fine</p>
      </ErrorBoundary>,
    );
    expect(html).toContain('all fine');
    expect(html).not.toContain('stopped working');
  });
});
