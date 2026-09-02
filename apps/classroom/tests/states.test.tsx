import { renderToString } from 'react-dom/server';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useAsync, dataOr, type Async } from '../src/lib/async';
import { __setOnlineForTests, isOnline, useOnline } from '../src/lib/online';
import {
  AsyncSection,
  ErrorState,
  InlineError,
  OfflineNotice,
  Skeleton,
  SkeletonList,
} from '../src/ui/States';

/**
 * LOADING, EMPTY, FAILED AND OFFLINE ARE FOUR DIFFERENT THINGS.
 *
 * Six screens collapsed them into an empty array — `useState([])` plus
 * `.catch(() => setCatalog([]))` — so a student with no signal was told their
 * library was empty, and every screen flashed its "nothing here" state on the
 * way to showing something. These are the pieces that keep them apart.
 */

const decode = (html: string): string =>
  html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

// --------------------------------------------------------------- useAsync ---

/** Renders a hook and reports every state it passed through, in order. */
function trackAsync<T>(load: () => Promise<T>, deps: readonly unknown[] = []) {
  const seen: Async<T>[] = [];
  let retry = () => {};

  function Probe() {
    const result = useAsync(load, deps);
    seen.push(result.state);
    retry = result.retry;
    return null;
  }

  const host = document.createElement('div');
  const root = createRoot(host);
  return {
    seen,
    render: () => act(() => root.render(<Probe />)),
    retry: () => act(() => retry()),
    unmount: () => act(() => root.unmount()),
  };
}

describe('useAsync', () => {
  it('starts loading and ends ready', async () => {
    const probe = trackAsync(() => Promise.resolve(['a']));
    probe.render();
    await act(async () => {});

    expect(probe.seen[0]).toEqual({ status: 'loading' });
    expect(probe.seen.at(-1)).toEqual({ status: 'ready', data: ['a'] });
    probe.unmount();
  });

  it('reports a rejection as failed rather than as empty data', () => {
    // The whole point. `.catch(() => setCatalog([]))` is what made a train
    // tunnel look like an empty library.
    const probe = trackAsync(() => Promise.reject(new Error('offline')));
    probe.render();

    return act(async () => {}).then(() => {
      const last = probe.seen.at(-1)!;
      expect(last.status).toBe('failed');
      expect(last.status === 'failed' && last.error.message).toBe('offline');
      probe.unmount();
    });
  });

  it('wraps a thrown non-Error so callers always get a message', async () => {
    // eslint-disable-next-line prefer-promise-reject-errors
    const probe = trackAsync(() => Promise.reject('just a string'));
    probe.render();
    await act(async () => {});

    const last = probe.seen.at(-1)!;
    expect(last.status === 'failed' && last.error.message).toBe('just a string');
    probe.unmount();
  });

  it('runs the load again on retry, and goes back through loading', async () => {
    let calls = 0;
    const probe = trackAsync(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('nope')) : Promise.resolve(['ok']);
    });
    probe.render();
    await act(async () => {});
    expect(probe.seen.at(-1)!.status).toBe('failed');

    probe.retry();
    await act(async () => {});

    expect(calls).toBe(2);
    // A retry that jumped straight from failed to ready would leave the error
    // on screen for the whole request.
    expect(probe.seen.some((s) => s.status === 'loading')).toBe(true);
    expect(probe.seen.at(-1)).toEqual({ status: 'ready', data: ['ok'] });
    probe.unmount();
  });

  it('ignores an answer that arrives after unmount', async () => {
    let settle: (v: string[]) => void = () => {};
    const probe = trackAsync(() => new Promise<string[]>((res) => (settle = res)));
    probe.render();
    probe.unmount();

    // React would warn — and in a real screen this is the late answer that
    // overwrites a newer one — if the result were still applied.
    expect(() => {
      settle(['late']);
    }).not.toThrow();
    await act(async () => {});
  });
});

describe('dataOr', () => {
  it('gives the data when it is there and the fallback otherwise', () => {
    expect(dataOr({ status: 'ready', data: [1] }, [])).toEqual([1]);
    expect(dataOr({ status: 'loading' }, ['fallback'])).toEqual(['fallback']);
    expect(dataOr({ status: 'failed', error: new Error('x') }, ['fallback'])).toEqual(['fallback']);
  });
});

// ----------------------------------------------------------------- online ---

describe('useOnline', () => {
  afterEach(() => __setOnlineForTests(true));

  it('reports online when the browser says nothing useful', () => {
    // navigator.onLine is trustworthy in ONE direction. Unknown must read as
    // online, or a real error gets explained away as a lost connection.
    expect(isOnline()).toBe(true);
  });

  it('follows the offline event', () => {
    function Probe() {
      return <span>{useOnline() ? 'on' : 'off'}</span>;
    }
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(<Probe />));
    expect(host.textContent).toBe('on');

    act(() => __setOnlineForTests(false));
    expect(host.textContent).toBe('off');

    act(() => __setOnlineForTests(true));
    expect(host.textContent).toBe('on');
    act(() => root.unmount());
  });
});

// ------------------------------------------------------------------- UI ----

describe('Skeleton', () => {
  it('is hidden from screen readers — it is a shape, not information', () => {
    expect(renderToString(<Skeleton />)).toContain('aria-hidden="true"');
  });

  it('stops pulsing for a student who asked for less motion', () => {
    expect(renderToString(<Skeleton />)).toContain('motion-reduce:animate-none');
  });
});

describe('SkeletonList', () => {
  const html = renderToString(<SkeletonList rows={4} label="Loading your lessons" />);

  it('draws the number of rows asked for', () => {
    expect(html.split('animate-pulse').length - 1).toBe(4);
  });

  it('announces once, in words, rather than row by row', () => {
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Loading your lessons');
    expect(html.split('aria-busy').length - 1).toBe(1);
  });
});

describe('ErrorState', () => {
  afterEach(() => __setOnlineForTests(true));

  it('names what failed and offers a way to try again', () => {
    const html = decode(renderToString(<ErrorState title="We could not load your lessons" onRetry={() => {}} />));

    expect(html).toContain('We could not load your lessons');
    expect(html).toContain('Try again');
    expect(html).toContain('role="alert"');
  });

  it('has no Try again when there is nothing to retry', () => {
    expect(renderToString(<ErrorState title="Gone" />)).not.toContain('Try again');
  });
});

describe('OfflineNotice', () => {
  afterEach(() => __setOnlineForTests(true));

  it('says nothing at all while there is a connection', () => {
    expect(renderToString(<OfflineNotice />)).toBe('');
  });
});

describe('InlineError', () => {
  it('explains what is missing without taking over the screen', () => {
    const html = decode(
      renderToString(<InlineError message="We could not load your lesson titles." onRetry={() => {}} />),
    );

    expect(html).toContain('We could not load your lesson titles.');
    expect(html).toContain('Try again');
    // Not an alert: the screen still works, and this is a note beside it.
    expect(html).not.toContain('role="alert"');
  });
});

describe('AsyncSection', () => {
  const render = (state: Async<string[]>) =>
    decode(
      renderToString(
        <AsyncSection
          state={state}
          loading={<SkeletonList rows={2} label="Loading" />}
          errorTitle="We could not load this"
          isEmpty={(rows) => rows.length === 0}
          empty={<p>Nothing here yet</p>}
          onRetry={() => {}}
        >
          {(rows) => <ul>{rows.map((r) => <li key={r}>{r}</li>)}</ul>}
        </AsyncSection>,
      ),
    );

  it('shows the skeleton while loading, and neither empty nor error', () => {
    const html = render({ status: 'loading' });

    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('Nothing here yet');
    expect(html).not.toContain('We could not load this');
  });

  it('shows the error, with a retry, when the load failed', () => {
    const html = render({ status: 'failed', error: new Error('x') });

    expect(html).toContain('We could not load this');
    expect(html).toContain('Try again');
    // The one that mattered: a failure must never read as "you have nothing".
    expect(html).not.toContain('Nothing here yet');
  });

  it('shows the empty state only once the data is genuinely in hand', () => {
    expect(render({ status: 'ready', data: [] })).toContain('Nothing here yet');
  });

  it('shows the content when there is some', () => {
    const html = render({ status: 'ready', data: ['one', 'two'] });

    expect(html).toContain('one');
    expect(html).toContain('two');
    expect(html).not.toContain('Nothing here yet');
  });
});
