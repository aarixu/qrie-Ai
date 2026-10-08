import { useCallback, useEffect, useRef, useState } from 'react';
import { failed, type Loaded } from './load-state.ts';

/**
 * One read for a screen, in the four states of load-state.ts. The read runs
 * again when `deps` change (a different school: back to loading) and on
 * reload() (the same thing again: a failure keeps the last good data on
 * screen with the error beside it, as Today does).
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): { view: Loaded<T>; reload(): void } {
  const [view, setView] = useState<Loaded<T>>({ state: 'loading' });
  const [tick, setTick] = useState(0);
  const latest = useRef(load);
  latest.current = load;
  // Which deps the data on screen belongs to.
  const shownFor = useRef<string | null>(null);
  const key = JSON.stringify(deps);

  useEffect(() => {
    let live = true;
    if (shownFor.current !== key) setView({ state: 'loading' });
    latest.current().then(
      (data) => {
        if (!live) return;
        shownFor.current = key;
        setView({ state: 'ready', data });
      },
      (e: unknown) => {
        if (!live) return;
        const f = failed(e);
        setView((prev) =>
          prev.state === 'ready' && shownFor.current === key
            ? { ...prev, error: f.state === 'error' ? f.message : 'Your role cannot see this.' }
            : f,
        );
      },
    );
    return () => {
      live = false;
    };
  }, [key, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { view, reload };
}
