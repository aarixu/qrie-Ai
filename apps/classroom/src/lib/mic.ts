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

/**
 * HAVE WE EXPLAINED OURSELVES YET?
 *
 * Remembered across launches, not just for the session, because the cost of
 * getting this wrong is permanent: Android stops showing the system prompt
 * after two refusals and iOS after one, and the only way back is a Settings
 * screen nobody finds. So the app explains once, in its own words, and after
 * that never asks again — a student who said "not now" has answered, and
 * asking every lesson would be nagging.
 *
 * Storage failing is not a reason to skip the explanation: an extra warm
 * screen costs a tap, and a system prompt out of nowhere costs the microphone
 * for good.
 */
const EXPLAINED_KEY = 'mic:explained';

export function micExplained(): boolean {
  try {
    return localStorage.getItem(EXPLAINED_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberMicExplained(): void {
  try {
    localStorage.setItem(EXPLAINED_KEY, '1');
  } catch {
    // Private mode. The screen shows again next launch, which is the harmless
    // direction to be wrong in.
  }
}

/** Test seam: reset the memoised status. */
export function resetMicStatusForTest(): void {
  cached = 'unknown';
  try {
    localStorage.removeItem(EXPLAINED_KEY);
  } catch {
    // nothing stored, nothing to clear
  }
}
