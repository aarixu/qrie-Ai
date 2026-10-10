import type { CSSProperties } from 'react';

/** Every sequence inside one element is finished this long after it appears (~34 characters of speech). */
export const SEQUENCE_CAP_MS = 2400;

/**
 * When each of `count` pieces starts: `gapMs` apart, squeezed so the last
 * starts no later than `capMs`. Nothing is dropped; the gaps give way.
 */
export function staggerDelays(count: number, gapMs: number, capMs: number, startMs = 0): number[] {
  if (count <= 0) return [];
  const gap = count > 1 ? Math.min(gapMs, Math.max(0, capMs - startMs) / (count - 1)) : 0;
  return Array.from({ length: count }, (_, i) => Math.round(startMs + i * gap));
}

/**
 * One animated piece: its class and its start, or nothing at all when the
 * element is not new — a board the student seeks back to is drawn complete.
 */
export function animAt(
  isNew: boolean,
  cls: string,
  delayMs: number,
  style: CSSProperties = {},
): { className?: string; style?: CSSProperties } {
  return isNew ? { className: cls, style: { ...style, animationDelay: `${Math.round(delayMs)}ms` } } : {};
}
