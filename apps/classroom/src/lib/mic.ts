/**
 * Microphone permission, asked once and remembered for the session.
 *
 * The live doubt tutor needs the mic, but asking at the wrong moment is a
 * broken experience: a browser permission prompt that appears *while* the
 * tutor is already greeting the student means the first sentence is lost. So
 * the app requests permission BEFORE opening the live session, and falls back
 * to the typed-doubt path when it is refused.
 */

export type MicStatus = 'unknown' | 'granted' | 'denied' | 'unavailable';

let cached: MicStatus = 'unknown';

export function micStatus(): MicStatus {
  return cached;
}

/**
 * Ask for mic access. Resolves to the resulting status — never throws, because
 * a refused mic is an ordinary outcome (the student types instead), not an error.
 */
export async function requestMic(): Promise<MicStatus> {
  if (cached === 'granted' || cached === 'unavailable') return cached;

  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    cached = 'unavailable';
    return cached;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Release immediately — the live session opens its own capture. Holding
    // this one would leave the recording indicator on between doubts.
    for (const track of stream.getTracks()) track.stop();
    cached = 'granted';
  } catch {
    cached = 'denied';
  }
  return cached;
}

/** Test seam: reset the memoised status. */
export function resetMicStatusForTest(): void {
  cached = 'unknown';
}
