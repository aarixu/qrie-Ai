import { Component, type ErrorInfo, type ReactNode } from 'react';
import { BRAND } from '../brand';

/**
 * THE WHITE SCREEN, PREVENTED.
 *
 * React unmounts the whole tree when a render throws. Without a boundary that
 * is a permanent blank page with no way back — and on a phone a blank page is
 * an uninstall, not a bug report. This catches it and offers the two things a
 * student actually wants: try again, or go home.
 *
 * A class boundary because that is the only thing React gives us; there is no
 * hook for this.
 *
 * `onError` is where crash reporting attaches. Deliberately injected rather
 * than imported, so this file has no opinion about which service that is and
 * the tests need none.
 */

interface Props {
  children: ReactNode;
  /** Reported to whatever is watching. Never allowed to throw of its own. */
  onError?: (error: Error, info: ErrorInfo) => void;
  /** Changing this clears the error — the router passes the path, so a
   * navigation away from a broken screen recovers on its own. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    try {
      this.props.onError?.(error, info);
    } catch {
      // A reporter that throws must not replace the error it was reporting.
    }
  }

  componentDidUpdate(previous: Props): void {
    // Navigating away from the screen that broke is itself a recovery.
    if (this.state.error !== null && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    if (this.state.error === null) return this.props.children;

    return (
      <div className="bg-background text-on-background min-h-screen font-body-md grid place-items-center px-margin-mobile py-10">
        <div className="w-full max-w-[360px] flex flex-col items-center text-center gap-4">
          <h1 className="font-headline-md text-headline-md font-bold text-on-surface">
            That screen stopped working
          </h1>
          {/* No apology and no blame: what happened, and what to do. */}
          <p className="font-body-md text-body-md text-on-surface-variant max-w-[32ch]">
            Nothing you have done is lost — your progress is saved on this device. Try that screen
            again, or go back to the start.
          </p>

          <div className="w-full flex flex-col gap-3 mt-2">
            <button
              onClick={() => this.setState({ error: null })}
              className="h-13 py-3 rounded-2xl bg-primary text-on-primary font-label-md text-label-md font-bold border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all"
            >
              Try again
            </button>
            <button
              onClick={() => {
                // A hard navigation, not a router push: the router itself may
                // be the thing that threw.
                window.location.href = '/';
              }}
              className="py-3 rounded-2xl bg-surface-container-lowest text-on-surface-variant font-label-md text-label-md border-2 border-surface-variant"
            >
              Back to {BRAND.name}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
