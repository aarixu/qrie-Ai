import { AdminError } from '@ai-tutor/admin-client';

/**
 * The four states of every read on a screen. `refused` is the role's limit
 * ("Your role cannot see this."), shown without a retry; `error` carries a
 * message fit to show, with a retry. A ready view may also carry the error of
 * a reload that failed, while the last good data stays on screen.
 */
export type Loaded<T> =
  | { state: 'loading' }
  | { state: 'ready'; data: T; error?: string }
  | { state: 'refused' }
  | { state: 'error'; message: string };

export function failed(e: unknown): Loaded<never> {
  if (e instanceof AdminError && e.code === 'not-allowed') return { state: 'refused' };
  return { state: 'error', message: e instanceof Error ? e.message : String(e) };
}
