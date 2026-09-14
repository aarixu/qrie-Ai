import { createMicCapture, micLevelOf, MIC_SAMPLE_RATE } from '@ai-tutor/voice';
import { relayFetch } from './relay';

/**
 * THE EAR - the mic that turns itself on when she asks.
 *
 * Aarav's spec, verbatim: when the tutor asks a question the mic opens on its
 * own, waits for the student's spoken answer, and closes when it has one. The
 * raise-hand button stays for the doubts the STUDENT starts; this ear only
 * exists inside a held ask.
 *
 * Split the same way voice/audio.ts is: the decisions (when has the student
 * started speaking, when have they finished) are a pure endpointer that is
 * unit-tested; the shell around the mic and the fetch holds no logic worth
 * testing without a device.
 *
 * The endpointer thinks in the mic's own chunks (~100 ms each) and in
 * micLevelOf's 0..1 loudness, where speech sits roughly 0.12-0.9:
 *
 *   waiting    nobody has spoken yet. Give up after graceMs - an unanswered
 *              question is the chips' job, not a mic held open forever.
 *   listening  speech has started. A dip below stopLevel is only the end
 *              after silenceMs of it - students breathe mid-answer.
 *   heard      the answer is over (trailing silence, or the hard cap).
 *   nothing    the grace ran out with no speech at all.
 */

export interface EndpointConfig {
  /** Loudness that counts as speech beginning. */
  startLevel: number;
  /** Loudness below which the student has (maybe) stopped. */
  stopLevel: number;
  /** How much trailing quiet ends the answer. */
  silenceMs: number;
  /** The longest answer taken whole, silence or not. */
  maxSpeechMs: number;
  /** How long to wait for the first word before giving up. */
  graceMs: number;
}

export const EAR_DEFAULTS: EndpointConfig = {
  startLevel: 0.1,
  stopLevel: 0.06,
  silenceMs: 900,
  maxSpeechMs: 10_000,
  graceMs: 7_000,
};

export type EarState = 'waiting' | 'listening' | 'heard' | 'nothing';

export function createEndpointer(overrides: Partial<EndpointConfig> = {}) {
  const cfg = { ...EAR_DEFAULTS, ...overrides };
  let speaking = false;
  let waitedMs = 0;
  let spokenMs = 0;
  let silentMs = 0;
  return {
    /** One mic chunk: its loudness and how many milliseconds it covers. */
    feed(level: number, ms: number): EarState {
      if (!speaking) {
        if (level >= cfg.startLevel) {
          speaking = true;
          return 'listening';
        }
        waitedMs += ms;
        return waitedMs >= cfg.graceMs ? 'nothing' : 'waiting';
      }
      spokenMs += ms;
      if (level < cfg.stopLevel) silentMs += ms;
      else silentMs = 0;
      if (silentMs >= cfg.silenceMs || spokenMs >= cfg.maxSpeechMs) return 'heard';
      return 'listening';
    },
  };
}

/**
 * 16-bit mono PCM in a WAV wrapper - 44 bytes of header so the transcriber
 * knows the rate without being told.
 */
export function wavOf(pcm: Int16Array, sampleRate: number): ArrayBuffer {
  const bytes = pcm.length * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const v = new DataView(buf);
  const ascii = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i += 1) v.setUint8(at + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + bytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  v.setUint32(40, bytes, true);
  for (let i = 0; i < pcm.length; i += 1) v.setInt16(44 + i * 2, pcm[i], true);
  return buf;
}

/** A few chunks from just before speech started, so the first syllable is kept. */
const PREROLL_CHUNKS = 3;
const CHUNK_MS = 100;

export interface Heard {
  /** What the student said, or null when nothing usable arrived. */
  text: string | null;
  reason: 'heard' | 'silence' | 'cancelled' | 'error';
}

/**
 * Open the mic, take one spoken answer, close the mic, transcribe.
 *
 * Never throws: a silent room, a denied mic and a dead network are all
 * ordinary outcomes - the chips under the question carry those cases.
 */
export async function listenOnce(opts: { isCancelled?: () => boolean } = {}): Promise<Heard> {
  const isCancelled = opts.isCancelled ?? ((): boolean => false);
  const preroll: Int16Array[] = [];
  const kept: Int16Array[] = [];
  const pointer = createEndpointer();

  let finish: (state: 'heard' | 'nothing' | 'cancelled') => void = () => undefined;
  let done = false;
  const outcome = new Promise<'heard' | 'nothing' | 'cancelled'>((resolve) => {
    finish = (state) => {
      if (!done) {
        done = true;
        resolve(state);
      }
    };
  });

  const mic = createMicCapture((chunk) => {
    if (done) return;
    if (isCancelled()) {
      finish('cancelled');
      return;
    }
    const state = pointer.feed(micLevelOf(chunk), CHUNK_MS);
    if (state === 'waiting') {
      // A rolling tail of quiet, so the answer's first syllable is not clipped.
      preroll.push(chunk);
      if (preroll.length > PREROLL_CHUNKS) preroll.shift();
      return;
    }
    kept.push(chunk);
    if (state === 'heard' || state === 'nothing') finish(state);
  }, CHUNK_MS);

  try {
    await mic.start();
  } catch {
    return { text: null, reason: 'error' };
  }
  const state = await outcome;
  mic.stop();

  if (state === 'cancelled') return { text: null, reason: 'cancelled' };
  if (state === 'nothing') return { text: null, reason: 'silence' };

  const all = [...preroll, ...kept];
  const pcm = new Int16Array(all.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of all) {
    pcm.set(c, at);
    at += c.length;
  }

  /**
   * IT USED TO BE HEARD ON THE PHONE FIRST, AND THAT WAS WRONG.
   *
   * `onnx-community/whisper-tiny.en` ran here before the relay and any
   * non-empty string it returned was taken as the student's answer. The `.en`
   * is the whole problem: it is an ENGLISH-ONLY model, and these students
   * answer in Hinglish.
   *
   * An English-only model given Hindi does not go quiet. It invents fluent
   * English. Seen here, from this model in this browser: "Har cell apne aap
   * zinda hai isliye oxygen chahiye" came back as "her celibnate arps in the
   * high-islii oxygen-chehi-ai" — confidently, with no error and nothing
   * downstream able to tell. The benched version of the same failure is in
   * `tools/speech/README.md`, where faster-whisper called Hinglish English and
   * returned garbage at avg logprob −0.79 against −0.22 for the same sentence
   * in English. Those words went to the judge as the child's
   * answer and to the ledger as the child's own words, so a correct Hinglish
   * answer could be marked wrong for free, offline, with no model behind it to
   * catch the mistake. That is the one failure this product must never make,
   * and it cost about a second of latency to make it.
   *
   * Moonshine hid it before: it returned an EMPTY string on real speech, so
   * the fall-through ran and nothing was harmed. Swapping in a model that
   * always answers turned a harmless failure into a silent one.
   *
   * So the relay hears everything. When an on-device ear returns — and it
   * needs to be multilingual, and to expose a confidence the caller can refuse
   * on, because `tools/speech` measured the same family at 0.30x realtime and
   * hopeless on Hinglish — it goes back in FRONT of this, not instead of it.
   */
  try {
    const res = await relayFetch('/api/hear', {
      method: 'POST',
      headers: { 'content-type': 'audio/wav' },
      body: wavOf(pcm, MIC_SAMPLE_RATE),
    });
    const data = (await res.json().catch(() => ({}))) as { text?: string };
    if (!res.ok) return { text: null, reason: 'error' };
    const text = (data.text ?? '').trim();
    return text ? { text, reason: 'heard' } : { text: null, reason: 'silence' };
  } catch {
    return { text: null, reason: 'error' };
  }
}
