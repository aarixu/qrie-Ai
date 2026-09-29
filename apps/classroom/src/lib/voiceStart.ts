import type { TtsAdapter } from '@ai-tutor/player';

/**
 * WHEN HER VOICE ACTUALLY STARTS A LINE — so the board can write while she talks.
 *
 * A live turn is a list of steps, each a sentence and the ink that appears
 * while she says it (@ai-tutor/live-board). "While she says it" has to mean
 * while the student can HEAR it. The streamed voice asks the relay for a line
 * and hears its first audio 1.2-2.1 s later (measured on Vertex, 2026-09-28,
 * packages/voice/src/pcmStreamTts.ts); ink revealed when the line is REQUESTED
 * would sit on the board in silence for that long, and the working would run a
 * sentence ahead of her.
 *
 * So the voice announces a line here when its first sample reaches the
 * speaker (`createPcmStreamTts`'s `onStart`, wired in lib/lessonVoice.ts), and
 * `sayRevealing` holds a step's ink until that announcement.
 *
 * REVEAL-ON-SPEAK, WHERE A VOICE CANNOT SAY. The browser's own voice and the
 * silent one have no way to report when their sound starts; `withStartOnSpeak`
 * makes them announce a line the moment they are asked to speak it, which is
 * when the browser starts it. The streamed voice falls back to the browser's
 * voice when its stream fails, and that fallback is wrapped too, so the
 * announcement still comes.
 *
 * AND IF NOTHING ANNOUNCES IT — a voice that failed silently, a line the relay
 * answered with no audio — the ink is revealed once `say` has resolved,
 * unless the class halted. Ink is never lost to a mute voice; at worst it
 * arrives at the end of its sentence instead of the start.
 *
 * Matched by the line's words (trimmed), because that is what the voice is
 * handed. Two identical sentences in flight at once would be told apart by
 * nothing; the handoff says one line at a time, so there is only ever one.
 */

type Listener = (text: string) => void;

const listeners = new Set<Listener>();

/** Her voice has started saying `text` — the student can hear it now. */
export function announceStart(text: string): void {
  // A copy, so a listener that unsubscribes while being told cannot make its
  // neighbour miss the announcement.
  for (const listen of [...listeners]) listen(text);
}

/** Be told whenever a line starts. Returns the way to stop being told. */
export function onLineStart(listen: Listener): () => void {
  listeners.add(listen);
  return () => {
    listeners.delete(listen);
  };
}

/**
 * A voice that cannot report when its sound starts, made to announce a line
 * the moment it is asked to speak it. `prime`, `drop` and `cancel` pass
 * straight through.
 */
export function withStartOnSpeak(inner: TtsAdapter): TtsAdapter {
  return {
    speak: (text: string) => {
      announceStart(text.trim());
      return inner.speak(text);
    },
    cancel: () => inner.cancel(),
    ...(inner.prime ? { prime: inner.prime.bind(inner) } : {}),
    ...(inner.drop ? { drop: inner.drop.bind(inner) } : {}),
  };
}

/**
 * Say one line, and call `onStart` once — when her voice announces that line,
 * or, if nothing announces it, when the line is over. Never on a halted line:
 * a line the safety screen replaced with the support reply, or one the class
 * halted in the middle of, reveals nothing (`halted` is asked at the moment
 * of revealing, so a halt that lands mid-sentence is seen).
 *
 * `say` is whatever speaks through the safety screen — in ClassRoom, the
 * session halt's `say` — so this adds timing and nothing else. With no
 * `onStart` it is exactly `say`.
 */
export async function sayRevealing<R extends { halted: boolean }>(
  say: (text: string) => Promise<R>,
  text: string,
  onStart: (() => void) | undefined,
  halted: () => boolean,
): Promise<R> {
  if (!onStart) return say(text);
  let fired = false;
  const fire = (): void => {
    if (fired || halted()) return;
    fired = true;
    onStart();
  };
  const key = text.trim();
  const off = onLineStart((started) => {
    if (started.trim() === key) fire();
  });
  try {
    const result = await say(text);
    if (!result.halted) fire();
    return result;
  } finally {
    off();
  }
}
