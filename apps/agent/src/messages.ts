/**
 * THE ROOM CONTROL CONTRACT — the only thing the agent says to the browser
 * that is not sound.
 *
 * It lives in one module, with no LiveKit and no Node imports, so the browser
 * adapter can import these exact types instead of re-declaring them. Two copies
 * of a wire format drift the moment one side adds a field, and the symptom of
 * that drift is a canvas that silently stops responding mid-doubt.
 *
 * Everything here is a data packet on one named topic. Voice goes over the
 * audio track; only these two control messages go over data.
 */

/**
 * The data-packet topic. The browser must ignore packets on every other topic:
 * LiveKit itself publishes transcriptions on `lk.transcription`, and a future
 * feature will publish on topics of its own.
 */
export const TUTOR_CONTROL_TOPIC = 'tutor-control';

/**
 * These two strings are BOTH the tool name the model calls and the message
 * type the browser switches on. One string with two jobs cannot drift; two
 * strings for the same event eventually do, and the failure is silent — the
 * model calls a tool, the agent publishes a message, and the browser ignores it.
 */
export const RECALL_MOMENT = 'recall_moment';
export const END_DOUBT = 'end_doubt';

/** Put an earlier moment of the class back on the canvas. */
export interface RecallMomentMessage {
  readonly type: typeof RECALL_MOMENT;
  /** A beat id the agent already validated against the brief it was given. */
  readonly beatId: string;
}

/**
 * Why the room is going back to the recording. The browser says a different
 * line for each: the tutor has already spoken her closing line when the doubt
 * resolved, and has said nothing at all when it failed.
 */
export type DoubtEnd = 'resolved' | 'failed';

/** The doubt is over — resume the recording. */
export interface EndDoubtMessage {
  readonly type: typeof END_DOUBT;
  readonly reason: DoubtEnd;
}

export type TutorControlMessage = RecallMomentMessage | EndDoubtMessage;

export function encodeTutorControl(message: TutorControlMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(message));
}

/**
 * Bytes (or text) off the wire to a message, or null if this is not one of
 * ours. Anyone in the room can publish anything on any topic, so the browser
 * must be able to ask "is this mine?" without a try/catch at the call site.
 */
export function decodeTutorControl(payload: Uint8Array | string): TutorControlMessage | null {
  let parsed: unknown;
  try {
    const text = typeof payload === 'string' ? payload : new TextDecoder().decode(payload);
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const message = parsed as { type?: unknown; beatId?: unknown; reason?: unknown };

  if (message.type === RECALL_MOMENT) {
    if (typeof message.beatId !== 'string' || message.beatId.length === 0) return null;
    return { type: RECALL_MOMENT, beatId: message.beatId };
  }

  if (message.type === END_DOUBT) {
    // An unrecognised reason resumes the class as if the doubt was resolved.
    // A version skew between the two sides must never leave a student sitting
    // in front of a paused recording, and "failed" would make her apologise
    // for a doubt she actually answered.
    return { type: END_DOUBT, reason: message.reason === 'failed' ? 'failed' : 'resolved' };
  }

  return null;
}
