import { useCallback, useEffect, useState } from 'react';

/**
 * THE THREE ANSWERS A FETCH CAN GIVE, KEPT APART.
 *
 * Six screens in this app did `useState<CatalogEntry[]>([])` and then
 * `.catch(() => setCatalog([]))`. That collapses three different situations
 * into one empty array:
 *
 *   - we have not asked yet
 *   - we asked and the answer is genuinely nothing
 *   - we asked and could not reach it
 *
 * A student on a train therefore saw "No lessons yet" — the app telling them
 * their library is empty when it was only unreachable. And every screen showed
 * its empty state for a frame before the data arrived, so the app flashed
 * "nothing here" on the way to showing something.
 *
 * `Async<T>` is the smallest thing that fixes both: the screen must handle each
 * case, and the compiler makes sure it does.
 */
export type Async<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'failed'; error: Error };

export interface AsyncResult<T> {
  state: Async<T>;
  /** Ask again. Safe to call at any time; the in-flight answer is discarded. */
  retry: () => void;
}

const asError = (thrown: unknown): Error =>
  thrown instanceof Error ? thrown : new Error(String(thrown));

/**
 * Run `load` and report which of the three answers came back.
 *
 * `deps` behaves like useEffect's: change them and it loads again, starting
 * from `loading` rather than showing the previous topic's data under the new
 * title. A load already in flight when the deps change (or when the component
 * unmounts) is ignored rather than cancelled — nothing here can cancel a
 * promise, and the point is only that a late answer never overwrites a newer
 * one.
 *
 * `load` is deliberately NOT a dependency. Callers write it inline, so a new
 * function identity arrives on every render and depending on it would loop
 * forever; `deps` is the honest declaration of what the load actually reads.
 */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]): AsyncResult<T> {
  const [state, setState] = useState<Async<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setState({ status: 'loading' });
    load().then(
      (data) => {
        if (current) setState({ status: 'ready', data });
      },
      (thrown) => {
        if (current) setState({ status: 'failed', error: asError(thrown) });
      },
    );
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}

/**
 * The data when it is there, and `fallback` otherwise.
 *
 * For the parts of a screen that genuinely do not care — a count in a header,
 * a filter list — where forcing all three branches would be noise. The parts
 * that DO care must switch on `status` instead; that is the whole point.
 */
export function dataOr<T>(state: Async<T>, fallback: T): T {
  return state.status === 'ready' ? state.data : fallback;
}
