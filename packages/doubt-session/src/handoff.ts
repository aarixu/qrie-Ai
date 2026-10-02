import type { AgentAdapter, AgentIO, AgentSession, SayOptions, SendOptions } from './agent';
import type { DoubtContext } from './context';
import { closingLine, entryLine, exitLine } from './bridge';

/**
 * `HALTED` is terminal. Nothing leads out of it: not a raised hand, not an
 * agent's `done()`, not the exit bridge. See `halt()`.
 */
export type HandoffState =
  | 'PLAYING'
  | 'PAUSING'
  | 'AGENT_ENTERING'
  | 'LIVE'
  | 'AGENT_LEAVING'
  | 'RESUMING'
  | 'HALTED';

export type HandoffEvent = 'statechange' | 'agent-say';

/**
 * What a speaker may report back about a line.
 *
 * `halted: true` means the caller's safety screen found distress and the line
 * that came out was a support reply: the student has just been told to talk to
 * somebody, and the machine must not say or do anything after it. A speaker
 * that resolves with nothing is read as "not halted", which keeps a caller
 * written before this existed on its old seam.
 */
export interface SpeakResult {
  halted: boolean;
}

/**
 * How many student messages one raised hand may carry.
 *
 * Every typed turn is one `/api/llm` call, and nothing bounded how many a
 * single doubt could make. Six is room for a question, a follow-up and a few
 * rounds of "still don't get it" — a starting number, not a measured one: how
 * many turns real doubts take is UNVERIFIED.
 */
export const DEFAULT_MAX_STUDENT_TURNS = 6;

export interface HandoffOptions {
  agent: AgentAdapter;
  /**
   * Say this line, and report THE LINE ACTUALLY SAID through `onSaid` as soon
   * as it is decided — before the audio, not after it.
   *
   * The callback exists for a child-safety reason and its TIMING is the second
   * half of that reason. The caller screens what the model produced: a
   * distress-flagged line is replaced with a support reply rather than spoken
   * as written. This seam is also what feeds the captions and the text-mode
   * transcript, and while it reported nothing, `voice` below had only the
   * model's raw text to surface — so a replaced line was SPOKEN safely and
   * DISPLAYED verbatim. Text-only is the mode that ships, which made the
   * display the whole output.
   *
   * Returning the line instead of reporting it would fix the safety and break
   * the captions: `speak` resolves when the line has finished playing, so the
   * caption would appear at the END of every spoken sentence. The screen is
   * pure and decides instantly; the audio is what takes time. So the decision
   * is reported when it is made.
   *
   * A caller that never calls `onSaid` surfaces nothing, which is the safe
   * direction: no caption is better than an unscreened one.
   *
   * It resolves when the line has been spoken, with `{ halted: true }` when
   * the screen replaced it with a support reply. The machine halts itself on
   * that report (see `halt()`), so a doubt cannot carry on over it even if the
   * caller forgets to.
   *
   * `onStart`, when the agent passed one, is the speaker's to call once her
   * voice has started the line — the board reveals that step's ink then
   * (T2.4). The machine never calls it: a line it does not speak reveals
   * nothing. Only an agent's own lines carry one; the bridge lines do not.
   */
  speak(
    text: string,
    onSaid: (said: string) => void,
    onStart?: () => void,
  ): Promise<SpeakResult | void>;
  /** Pause the recording (called during PAUSING). */
  onPause(): void;
  /** Resume the recording (called during RESUMING). Never called once HALTED. */
  onResume(): void;
  /** Canvas jump during LIVE. */
  onRecall?(beatId: string): void;
  /** Fetch a line's audio ahead of time (the streamed voice's `prime`). */
  prime?(text: string): void;
  /**
   * Student messages one doubt may carry before she closes it with
   * `closingLine`. Defaults to DEFAULT_MAX_STUDENT_TURNS.
   */
  maxStudentTurns?: number;
}

export interface Handoff {
  readonly state: HandoffState;
  /**
   * Legal only from PLAYING; otherwise a no-op (a double-tap must not crash a class).
   * `quiet`: the student opened this doubt by talking over her and is already
   * saying it, so her entry line is not spoken over them — the class pauses and
   * the tutor is ready at once (Aarav, 2026-10-02).
   */
  raiseHand(ctx: DoubtContext, opts?: { quiet?: boolean }): void;
  /** Forward a student message to the live session. No-op outside LIVE. */
  sendUserText(text: string, opts?: SendOptions): void;
  /** Manual end; the agent's io.done() ends it too. */
  endDoubt(): void;
  /**
   * Stop for good, from any state: the session is stopped, nothing further is
   * spoken, the exit line is skipped, the recording is never resumed and no
   * new hand is accepted. For a caller whose safety screen stopped the class
   * on a path the machine cannot see — a spoken answer, a typed doubt.
   */
  halt(): void;
  on(event: HandoffEvent, cb: (payload?: string) => void): () => void;
}

/**
 * The handoff machine — the seam between the recording and the live agent:
 *
 *   PLAYING → PAUSING → AGENT_ENTERING → LIVE → AGENT_LEAVING → RESUMING → PLAYING
 *
 *   any state → HALTED   (terminal; see `halt()`)
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
  const maxStudentTurns = opts.maxStudentTurns ?? DEFAULT_MAX_STUDENT_TURNS;
  /** Student messages forwarded in THIS doubt. Reset by every raised hand. */
  let studentTurns = 0;

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
  // recoverable, a machine stuck forever in AGENT_ENTERING is not. Null is
  // "the room heard nothing", which is different from "it heard this".
  const speakSafe = (
    text: string,
    onSaid: (said: string) => void,
    onStart?: () => void,
  ): Promise<SpeakResult | void> =>
    (onStart ? opts.speak(text, onSaid, onStart) : opts.speak(text, onSaid)).catch(() => undefined);

  /**
   * Every line the room HEARD is surfaced as an event (captions/UI).
   *
   * What is emitted is what the speaker says came out, never what the model
   * produced. Those differ exactly when the safety screen replaced a line, and
   * emitting the model's version was a hole: the audio was safe and the text
   * on screen was not. A speak that failed emits nothing, because nothing was
   * heard and a caption for an unheard line is a caption for a line nobody can
   * check.
   */
  const voice = async (text: string, onStart?: () => void): Promise<void> => {
    // Once halted, nothing is spoken — not a late line from an agent that had
    // not yet seen its stop(), not a bridge line.
    if (state === 'HALTED') return;
    let surfaced = false;
    const result = await speakSafe(
      text,
      (said) => {
        // Once per line. A speaker that reports twice must not double the
        // transcript, and the first report is the one the screen decided.
        if (surfaced || said === '') return;
        surfaced = true;
        emit('agent-say', said);
      },
      onStart,
    );
    // The screen replaced this line with a support reply. Whoever is waiting
    // on it — the agent's next line, the exit bridge, the resume — must not
    // run, and halting here is what makes that true whether or not the caller
    // also halts.
    if (result && result.halted) halt();
  };

  const io: AgentIO = {
    say: async (text, options?: SayOptions) => {
      await voice(text, options?.onStart);
      // THE TURN CAP, closing after her answer to the last allowed turn rather
      // than on the next message — a student who asked a sixth question gets
      // it answered, and is then walked back to the class instead of having a
      // seventh question met with a goodbye. The first line she finishes after
      // the cap was reached, that is not followed by another line of the same
      // reply (`more`), is taken as the end of that answer. That is exact for
      // an agent that marks every line but its reply's last with `more` (the
      // typed tutor's steps) or says one line per message (the stub), and
      // early for one that had a reply to an EARLIER turn still queued.
      if (state === 'LIVE' && studentTurns >= maxStudentTurns && options?.more !== true) {
        beginLeaving(closingLine);
      }
    },
    recall: (beatId) => {
      // Only meaningful while the agent holds the room; a late recall from a
      // stopping agent must not yank the canvas mid-resume.
      if (state === 'LIVE') opts.onRecall?.(beatId);
    },
    done: () => beginLeaving(exitLine),
    prime: (text) => {
      if (state === 'LIVE') opts.prime?.(text);
    },
  };

  function beginLeaving(line: (ctx: DoubtContext) => string): void {
    // Legal from LIVE, and from AGENT_ENTERING as a cancel. AGENT_LEAVING and
    // RESUMING are already on the way out — a second done()/endDoubt() no-ops.
    // HALTED is not a way out at all.
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
      await voice(line(ctx));
      if (myEpoch !== epoch) return; // superseded (or halted) while the line played
      setState('RESUMING');
      opts.onResume();
      setState('PLAYING');
    })();
  }

  /**
   * THE ONE WAY INTO HALTED, and there is no way out of it.
   *
   * Bumping the epoch kills every continuation in flight: an entry line that
   * resolves afterwards does not start the agent, and an exit line that
   * resolves afterwards does not resume the recording. The session is stopped
   * so the agent makes no more calls of its own. No exit line is spoken — "all
   * clear, let's pick the class back up" is exactly the sentence a child who
   * has just been told to talk to somebody must not hear next.
   */
  function halt(): void {
    if (state === 'HALTED') return;
    ++epoch;
    if (session !== null) {
      session.stop();
      session = null;
    }
    setState('HALTED');
  }

  function raiseHand(ctx: DoubtContext, raise: { quiet?: boolean } = {}): void {
    // Covers the double-tap AND ✋ during a leaving sequence: nothing but
    // PLAYING accepts a new hand, so mid-seam taps wait for the seam to close.
    // HALTED never accepts one.
    if (state !== 'PLAYING') return;
    currentCtx = ctx;
    studentTurns = 0;
    const myEpoch = ++epoch;

    // Pause first and synchronously — the recording must stop talking before
    // anyone (bridge or agent) opens their mouth.
    setState('PAUSING');
    opts.onPause();
    setState('AGENT_ENTERING');
    void (async () => {
      if (!raise.quiet) await voice(entryLine(ctx));
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
    sendUserText(text: string, opts?: SendOptions): void {
      if (state !== 'LIVE' || session === null) return;
      // The app's own opener is not a student turn: not capped, not counted.
      if (opts?.opener) {
        session.sendUserText(text, opts);
        return;
      }
      /**
       * Past the cap, the message is dropped — it would be one more model
       * call on a doubt that is already closing — and NOTHING ELSE happens.
       *
       * Still LIVE past the cap means no line has finished since the last
       * allowed turn was forwarded (io.say closes the doubt on the first one
       * that does), so her answer to it has not been said yet. Leaving here
       * would stop the session, and stopping the typed tutor aborts its call
       * in flight: the last question, already paid for, would never be
       * answered. io.say closes the doubt once that answer has been said. An
       * agent that never answers leaves the doubt open until the student
       * ends it, as it did before there was a cap.
       */
      if (studentTurns >= maxStudentTurns) return;
      // Counted BEFORE forwarding: an agent may answer synchronously, and
      // the cap check in io.say must already see this turn.
      studentTurns += 1;
      session.sendUserText(text);
    },
    endDoubt(): void {
      beginLeaving(exitLine);
    },
    halt,
    on(event: HandoffEvent, cb: (payload?: string) => void): () => void {
      const set = listeners[event];
      set.add(cb);
      return () => {
        set.delete(cb);
      };
    },
  };
}
