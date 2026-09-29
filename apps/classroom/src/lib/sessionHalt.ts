import { screen } from '@ai-tutor/safety';
import { fromStudent, toStudent } from './safety';

/**
 * ONE HALT FOR EVERY PATH.
 *
 * When a student says something that needs a person — or a model says it back
 * to them — the class stops. That used to be a habit each path kept or did
 * not: the spoken-answer path returned early and left the room otherwise
 * alive; the typed doubt said the support line and went on taking questions,
 * because the screen's verdict was thrown away; a model reply replaced with
 * the support line was followed by the agent's next line, the exit bridge
 * ("all clear, let's pick the class back up") and the recording resuming.
 *
 * So there is one halt, and every way into the class reaches it through this
 * object rather than deciding for itself:
 *
 *   ear          a spoken answer or a spoken reason      → `heard(…, 'ear')`
 *   ear          the judge's or the close's reply to it  → `say(…, 'ear')`
 *   typed doubt  what the student types mid-doubt        → `typedDoubt(…)`
 *   model reply  the doubt tutor's line                  → `say(…, 'model-reply')`
 *
 * A TAP IS NOT A WAY IN. It carries no words of the student's, and what she
 * says about the tapped option — its why or hint — is the lesson's own text,
 * as is a whyProbe reply matched on the device. Those go through
 * `sayAuthored`: refused once the class has halted like everything else, but
 * never the cause of a halt. See `sayAuthored` for why.
 *
 * There is no typed-answer surface in the classroom at this tip; a typed
 * answer, when one exists, is student words like the ear's and belongs on
 * `heard`.
 *
 * What the halt does, in this order, once and never again:
 *
 *   1. the doubt session is halted — no agent line, no exit bridge, no resume,
 *      no new hand (`Handoff.halt()` in @ai-tutor/doubt-session);
 *   1b. the board is frozen — no ink is placed, drawn or recalled after this,
 *      including the rest of a turn whose sentences were still being spoken
 *      (lib/boardSession.ts `freeze`);
 *   2. the ear is closed — in ClassRoom a listen in flight polls `halted` on
 *      every chunk and closes the mic on the next one;
 *   3. the recording is paused where it stands, so the board holds still;
 *   4. whatever she is saying is cancelled;
 *   5. the line the voice had primed for the next beat is thrown away, and
 *      its fetch aborted — on a voice that primes (`drop`, the streamed
 *      voice in packages/voice/src/pcmStreamTts.ts);
 *   6. the support screen goes up, carrying the line;
 *   7. the support line is spoken — the last thing the voice is ever asked to
 *      say in this session. Every later `say` and `sayAuthored` is refused.
 *
 * Nothing here resumes anything. There is no timer, and no path out of
 * `halted` except leaving the class.
 *
 * WHAT IT DOES NOT REACH, written down rather than implied: a warm class's
 * preparation, still running behind the room in LiveClass, is not this
 * object's to stop.
 */

export type HaltCause = 'ear' | 'typed-doubt' | 'model-reply';

/** Everything the halt has to reach, injected so it tests without a room. */
export interface HaltRoom {
  /**
   * Her voice. After the halt it is asked for the support line and nothing
   * else. `drop` throws away a primed line; a voice that primes nothing may
   * leave it out.
   */
  tts: { speak(text: string): Promise<void>; cancel(): void; drop?(): void };
  player: { pause(): void };
  /** Close the mic and stop listening. */
  ear: { close(): void };
  /** End the doubt for good: no exit line, no resume, no new hand. */
  doubt: { halt(): void };
  /**
   * Stop the live board: nothing written or drawn after the halt. Optional
   * for a room with no live board; ClassRoom always passes one.
   */
  board?: { freeze(): void };
  /** Put the support screen up with the line she said. */
  showSupport(line: string): void;
  /** Which lesson a recorded flag belongs to. */
  lessonId?: () => string | undefined;
}

export interface SessionHalt {
  readonly halted: boolean;
  /** Which way in stopped the class, or null while it has not stopped. */
  readonly haltedBy: HaltCause | null;
  /** THE halt. Idempotent: the second call does nothing at all. */
  haltSession(cause: HaltCause, supportLine: string): void;
  /**
   * Her words, on their way to the student's ears.
   *
   * Screened first. A line the screen replaces halts the class, and the
   * support line is what is said instead. Resolves with whether the class is
   * halted NOW — so a caller whose ordinary line was cut short by a halt from
   * elsewhere also stops — and with the line that actually came out, for the
   * caption.
   */
  say(
    text: string,
    cause: HaltCause,
    onSaid?: (said: string) => void,
  ): Promise<{ halted: boolean; said: string }>;
  /**
   * THE LESSON'S OWN WORDS, said now: a tapped option's why or hint, or the
   * reply to a spoken answer that a whyProbe matched on the device. Not a
   * model's, and not the student's.
   *
   * Refused once the class has halted, like every line. Otherwise screened,
   * and a line that screens as distress is WITHHELD — not said, and resolved
   * with `said: ''` — and the class carries on. It never halts, and it records
   * no flag.
   *
   * Why not the halt `say` gives a model's line: those lines were written
   * into the lesson and screened where it was made (prepareClass runs
   * `screenSpine` over every string in every beat, whys and hints and the
   * whyProbe included), with a reader that lets a curriculum line through —
   * Premchand's farmer, a poem, a history lesson; class-prep's
   * distressReading.ts measured seven of eleven ordinary lines tripping the
   * patterns. This screen has no reader. Halting on such a line put a student
   * who had said nothing onto the helpline screen with no way back into the
   * class, and filed a distress flag that was not theirs.
   *
   * Why not say it anyway: nothing at this point can tell a line a reader
   * approved from one that never met a reader — a lesson carries no record
   * of that reading, and a lesson loaded from the catalogue may never have
   * been through prepareClass here at all. Withholding costs one explanation;
   * speaking an unread flagged line to a child is the thing the screen is
   * for. A caller that filed the help as given before calling this (the
   * `ledger.helped` rung-3 record on a wrong answer) is left with a record
   * that overstates the help on the rare withheld line.
   *
   * `onSaid` gets the line only when it is actually going to be said — the
   * caption never shows a withheld one.
   */
  sayAuthored(text: string, onSaid?: (said: string) => void): Promise<{ halted: boolean; said: string }>;
  /**
   * The student's words, AFTER the screen that records them has run.
   *
   * True when the class is halted — because these words are distress, or
   * because it already was. It records NO flag: the flag was written by
   * whichever screen ran first (`resolveSpokenAnswer`, `resolveCrossQuestion`),
   * and writing it again here would push a real flag out of a log that keeps
   * fifty. It only asks the same pure `screen` which verdict that was.
   */
  heard(text: string, cause: HaltCause): boolean;
  /**
   * A typed doubt: flagged once (by `fromStudent`), then one of three things.
   * `forward` is the text to hand the tutor, already quoted for a prompt;
   * `reply` is a line she says instead (an off-limits question); both null
   * means the class halted, or was already halted, and nothing goes anywhere.
   */
  typedDoubt(text: string): { forward: string | null; reply: string | null };
}

export function createSessionHalt(room: HaltRoom): SessionHalt {
  let halted = false;
  let haltedBy: HaltCause | null = null;
  const lessonId = (): string | undefined => room.lessonId?.();

  const haltSession = (cause: HaltCause, supportLine: string): void => {
    if (halted) return;
    // First, so anything the steps below set off — a listen loop polling,
    // a handoff continuation resolving — already sees the class as stopped.
    halted = true;
    haltedBy = cause;
    room.doubt.halt();
    room.board?.freeze();
    room.ear.close();
    room.player.pause();
    room.tts.cancel();
    room.tts.drop?.();
    room.showSupport(supportLine);
    // A voice that fails still leaves the support screen up with the same
    // words; the screen is the part that cannot be missed.
    void room.tts.speak(supportLine).catch(() => undefined);
  };

  /** True, and halted, when these words from the student are distress. */
  const distressFrom = (text: string, cause: HaltCause): boolean => {
    const verdict = screen(text, 'from-student');
    if (verdict.kind !== 'support') return false;
    haltSession(cause, verdict.say);
    return true;
  };

  return {
    get halted(): boolean {
      return halted;
    },
    get haltedBy(): HaltCause | null {
      return haltedBy;
    },

    haltSession,

    async say(text, cause, onSaid) {
      if (halted) return { halted: true, said: '' };
      const screened = toStudent(text, lessonId());
      if (screened.say !== null) {
        // Reported before anything else happens, like every line: the caption
        // shows the support line, never the one it replaced.
        onSaid?.(screened.say);
        haltSession(cause, screened.say);
        return { halted: true, said: screened.say };
      }
      onSaid?.(text);
      // A lost voice line counts as spoken — a stuck class is worse — which
      // is the same rule `screenedSpeech` keeps.
      await room.tts.speak(text).catch(() => undefined);
      return { halted, said: text };
    },

    async sayAuthored(text, onSaid) {
      if (halted) return { halted: true, said: '' };
      // The pure screen, not `toStudent`: that one files a 'distress' flag,
      // and a flag of that kind means the CHILD said something.
      if (screen(text, 'to-student').kind === 'support') return { halted: false, said: '' };
      onSaid?.(text);
      await room.tts.speak(text).catch(() => undefined);
      return { halted, said: text };
    },

    heard(text, cause) {
      if (halted) return true;
      return distressFrom(text, cause);
    },

    typedDoubt(text) {
      if (halted) return { forward: null, reply: null };
      const screened = fromStudent(text, lessonId());
      if (screened.text !== null) return { forward: screened.text, reply: null };
      // `fromStudent` stopped it and has recorded why, but its answer does
      // not say WHICH verdict it was; the pure `screen` is asked again for
      // that, and records nothing. Only distress halts. An off-limits
      // question gets her redirect and the doubt carries on.
      if (distressFrom(text, 'typed-doubt')) return { forward: null, reply: null };
      return { forward: null, reply: screened.say };
    },
  };
}
