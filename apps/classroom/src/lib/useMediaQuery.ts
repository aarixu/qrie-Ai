import { useEffect, useState } from 'react';

/**
 * Whether a CSS media query matches, kept current as the screen turns.
 *
 * Where there is no `matchMedia` (a test's jsdom), it never matches — the
 * room then lays itself out for a phone held upright, the default shape.
 */
export function useMediaQuery(query: string): boolean {
  const read = (): boolean =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const update = (): void => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}
