import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { useOnline } from '../lib/online';

/**
 * THE FOUR THINGS A SCREEN CAN BE, OTHER THAN FULL OF CONTENT.
 *
 * Loading, empty, failed, offline. `EmptyState` already lived in Screen.tsx and
 * stays there; the other three are here, and every screen that fetches uses
 * them so a student meets the same shapes and the same words wherever they
 * are. The rule they encode:
 *
 *   - A skeleton is the shape of what is coming, not a spinner. It reserves the
 *     real layout, so nothing jumps when the data lands.
 *   - "Nothing here" and "we could not reach it" are DIFFERENT screens. The
 *     first is a fact about the student's library; the second is a fact about
 *     the network, and it needs a Try again.
 *   - Offline is not an error. It is a state the student is in, often on
 *     purpose, and it is named rather than dressed up as a failure.
 */

/**
 * One shimmering block. `animate-pulse` is switched off for a student who has
 * asked for less motion — the same one-way rule the whole app follows: a
 * preference may quieten motion, never restore it.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`bg-surface-container-high rounded-lg animate-pulse motion-reduce:animate-none ${className}`}
    />
  );
}

/**
 * The placeholder for a list of cards — the shape almost every screen in this
 * app is waiting for.
 *
 * The whole group carries ONE `aria-busy` region with one message, rather than
 * six cards each announcing themselves: a screen reader should hear "loading
 * your lessons", not a description of grey rectangles.
 */
export function SkeletonList({
  rows = 3,
  label = 'Loading',
  className = 'h-[88px]',
}: {
  rows?: number;
  /** What is being waited for, e.g. "Loading your lessons". */
  label?: string;
  /** Height (and any other shape) of one row, so it matches the real card. */
  className?: string;
}) {
  return (
    <div role="status" aria-busy="true" className="grid gap-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={`w-full rounded-[20px] ${className}`} />
      ))}
    </div>
  );
}

/**
 * Something could not be reached.
 *
 * It asks the connection first, because that is the likeliest answer on the
 * phones this product is for, and because the two need different words: an
 * offline student is not looking at a bug and should not be invited to think
 * they are. Either way there is a Try again — an error screen without one is a
 * dead end, which is the thing this whole task exists to remove.
 */
export function ErrorState({
  title,
  body,
  onRetry,
  retryLabel = 'Try again',
}: {
  /** What could not be loaded, e.g. "We could not load your lessons". */
  title: string;
  /** Optional extra line for anything specific to this screen. */
  body?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const online = useOnline();

  return (
    <div role="alert" className="flex flex-col items-center text-center py-16 gap-3">
      <div className="w-16 h-16 rounded-full bg-surface-container grid place-items-center">
        <Icon
          name={online ? 'error' : 'wifi_off'}
          className="text-3xl text-on-surface-variant"
        />
      </div>
      <h2 className="font-headline-md text-[20px] leading-7 text-on-surface">
        {online ? title : 'You are offline'}
      </h2>
      <p className="font-body-md text-body-md text-on-surface-variant max-w-[46ch]">
        {online
          ? (body ?? 'Something went wrong on our side. It is worth another go.')
          : 'Anything you have already opened still works. The rest will be here when you are back on a connection.'}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 bg-primary text-on-primary font-label-md text-label-md px-6 py-3 rounded-xl shadow-md border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}

/**
 * A quiet strip saying the connection has gone, for screens that keep working
 * without one.
 *
 * Deliberately not a dialog and not dismissable: it costs one line, it goes
 * away by itself the moment the connection returns, and a student who taps
 * something that then fails deserves to have already been told why.
 */
export function OfflineNotice({ className = '' }: { className?: string }) {
  const online = useOnline();
  if (online) return null;

  return (
    <div
      role="status"
      className={`flex items-center gap-2 rounded-2xl bg-surface-container-high text-on-surface-variant px-4 py-3 font-label-md text-label-md ${className}`}
    >
      <Icon name="wifi_off" className="text-[18px] shrink-0" />
      <span>You are offline — classes you have already opened still work.</span>
    </div>
  );
}

/**
 * A one-line "this part did not load", for a screen that still works without it.
 *
 * The bookmarks list is the case it was written for: the saved ids are local
 * and always there, but without the catalogue each row is a slug the student
 * cannot open. That is worth explaining in a line and not worth replacing the
 * whole screen for. Offline gets the offline wording, because the student
 * already knows and does not need it called a failure.
 */
export function InlineError({
  message,
  onRetry,
  className = '',
}: {
  /** What did not load, e.g. "We could not load your lesson titles." */
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  const online = useOnline();

  return (
    <div
      role="status"
      className={`flex items-center gap-2 rounded-2xl bg-surface-container-high text-on-surface-variant px-4 py-3 font-label-md text-label-md ${className}`}
    >
      <Icon name={online ? 'error' : 'wifi_off'} className="text-[18px] shrink-0" />
      <span className="flex-1">
        {online ? message : 'You are offline — these will fill in when you are back on a connection.'}
      </span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 underline underline-offset-2 text-on-surface hover:opacity-80"
        >
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * Loading, failed, empty, or content — the whole switch in one place.
 *
 * Screens reach for this when their three states are the ordinary ones, so the
 * decision lives here rather than being re-made (and re-worded) nine times.
 * A screen with something more specific to say still writes its own switch;
 * this is a convenience, not a rule.
 */
export function AsyncSection<T>({
  state,
  onRetry,
  loading,
  errorTitle,
  isEmpty,
  empty,
  children,
}: {
  state: { status: 'loading' } | { status: 'ready'; data: T } | { status: 'failed'; error: Error };
  onRetry?: () => void;
  /** The skeleton to show. Give it the shape of the content it replaces. */
  loading: ReactNode;
  errorTitle: string;
  /** Only asked once the data is in hand. */
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (state.status === 'loading') return <>{loading}</>;
  if (state.status === 'failed') return <ErrorState title={errorTitle} onRetry={onRetry} />;
  if (empty && isEmpty?.(state.data)) return <>{empty}</>;
  return <>{children(state.data)}</>;
}
