import type { AgentAdapter, AgentIO, AgentSession } from './agent';
import type { DoubtContext } from './context';
import { entryLine, exitLine } from './bridge';

export type HandoffState =
  | 'PLAYING'
  | 'PAUSING'
  | 'AGENT_ENTERING'
  | 'LIVE'
  | 'AGENT_LEAVING'
  | 'RESUMING';

export type HandoffEvent = 'statechange' | 'agent-say';

export interface HandoffOptions {
  agent: AgentAdapter;
  /** How bridge lines and agent lines get voiced. Resolves when spoken. */
  speak(text: string): Promise<void>;
  /** Pause the recording (called during PAUSING). */
  onPause(): void;
  /** Resume the recording (called during RESUMING). */
  onResume(): void;
  /** Canvas jump during LIVE. */
  onRecall?(beatId: string): void;
}

export interface Handoff {
  readonly state: HandoffState;
  /** Legal only from PLAYING; otherwise a no-op (a double-tap must not crash a class). */
  raiseHand(ctx: DoubtContext): void;
  /** Forward a student message to the live session. No-op outside LIVE. */
  sendUserText(text: string): void;
  /** Manual end; the agent's io.done() ends it too. */
  endDoubt(): void;
  on(event: HandoffEvent, cb: (payload?: string) => void): () => void;
}

/**
 * The handoff machine — the seam between the recording and the live agent:
 *
 *   PLAYING → PAUSING → AGENT_ENTERING → LIVE → AGENT_LEAVING → RESUMING → PLAYING
 *
 * The machine owns no timers and talks to no real TTS or player — only the
 * injected callbacks — so the whole seam tests in milliseconds with fakes.
 *
 * Illegal calls are no-ops, never throws: a double-tap on ✋ must not crash a
 * class, and the state guard on every entry point is what enforces that.
 *
 * Async continuations (a speak() resolving) are guarded by an epoch counter:
 * starting any sequence bumps it, and a continuation created under an older
 * epoch quietly dies. That is what turns "endDoubt() while the entry line is
 * still being spoken" into a clean cancel instead of a machine that goes LIVE
 * after the student already left.
 */
export function createHandoff(opts: HandoffOptions): Handoff {
  let state: HandoffState = 'PLAYING';
  let session: AgentSession | null = null;
  let currentCtx: DoubtContext | null = null;
  let epoch = 0;

  const listeners: Record<HandoffEvent, Set<(payload?: string) => void>> = {
    statechange: new Set(),
    'agent-say': new Set(),
  };

  const emit = (event: HandoffEvent, payload?: string): void => {
    // Iterate a copy so a listener unsubscribing mid-emit can't skip its neighbours.
    for (const cb of [...listeners[event]]) cb(payload);
  };

  const setState = (next: HandoffState): void => {
    state = next;
    emit('statechange', next);
  };

  // A rejected speak() must never wedge the seam: a lost voice line is
  // recoverable, a machine stuck forever in AGENT_ENTERING is not.
  const speakSafe = (text: string): Promise<void> => opts.speak(text).catch(() => undefined);

  // Every line the room hears is surfaced as an event (captions/UI) AND voiced.
  const voice = async (text: string): Promise<void> => {
    emit('agent-say', text);
    await speakSafe(text);
  };

  const io: AgentIO = {
    say: (text) => voice(text),
    recall: (beatId) => {
      // Only meaningful while the agent holds the room; a late recall from a
      // stopping agent must not yank the canvas mid-resume.
      if (state === 'LIVE') opts.onRecall?.(beatId);
    },
    done: () => beginLeaving(),
  };

  function beginLeaving(): void {
    // Legal from LIVE, and from AGENT_ENTERING as a cancel. AGENT_LEAVING and
    // RESUMING are already on the way out — a second done()/endDoubt() no-ops.
    if (state !== 'LIVE' && state !== 'AGENT_ENTERING') return;
    const ctx = currentCtx;
    if (ctx === null) return; // unreachable past raiseHand; keeps TS honest
    const myEpoch = ++epoch; // kills a pending entry continuation (the cancel case)

    setState('AGENT_LEAVING');
    if (session !== null) {
      session.stop();
      session = null;
    }
    void (async () => {
      await voice(exitLine(ctx));
      if (myEpoch !== epoch) return; // superseded while the exit line played
      setState('RESUMING');
      opts.onResume();
      setState('PLAYING');
    })();
  }

  function raiseHand(ctx: DoubtContext): void {
    // Covers the double-tap AND ✋ during a leaving sequence: nothing but
    // PLAYING accepts a new hand, so mid-seam taps wait for the seam to close.
    if (state !== 'PLAYING') return;
    currentCtx = ctx;
    const myEpoch = ++epoch;

    // Pause first and synchronously — the recording must stop talking before
    // anyone (bridge or agent) opens their mouth.
    setState('PAUSING');
    opts.onPause();
    setState('AGENT_ENTERING');
    void (async () => {
      await voice(entryLine(ctx));
      if (myEpoch !== epoch) return; // cancelled (endDoubt) while the bridge line played
      session = opts.agent.start(ctx, io);
      setState('LIVE');
    })();
  }

  return {
    get state(): HandoffState {
      return state;
    },
    raiseHand,
    sendUserText(text: string): void {
      if (state === 'LIVE' && session !== null) session.sendUserText(text);
    },
    endDoubt(): void {
      beginLeaving();
    },
    on(event: HandoffEvent, cb: (payload?: string) => void): () => void {
      const set = listeners[event];
      set.add(cb);
      return () => {
        set.delete(cb);
      };
    },
  };
}
