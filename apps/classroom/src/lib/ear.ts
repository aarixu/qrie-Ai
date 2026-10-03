import { createMicCapture, micLevelOf, MIC_SAMPLE_RATE, type Recorded } from '@ai-tutor/voice';
import { relayFetch } from './relay';

/**
 * THE EAR - the mic that hears the student.
 *
 * Aarav's first spec (2026-10-01) opened it on its own at every question. On
 * 2026-10-02 the class kept ONE mic open instead (`openEar`, below), so a
 * student could talk over her. Since 2026-10-03 that one mic is opened only
 * when the student taps the mic button, and closed when the exchange is over
 * (ClassRoom `talk`). `listenOnce` takes its answer from it while it is open,
 * and opens a mic of its own for one answer when it is not.
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

/**
 * silenceMs 1.5 s and maxSpeechMs 15 s since 2026-10-03 (Aarav: what he said
 * was not understood). A child thinking mid-sentence pauses for a second; at
 * 0.9 s the rest of the sentence was cut off and lost. The mic is on only when
 * they tap it now, so a longer wait costs nothing in a noisy room.
 */
export const EAR_DEFAULTS: EndpointConfig = {
  startLevel: 0.1,
  stopLevel: 0.06,
  silenceMs: 1_500,
  maxSpeechMs: 15_000,
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
/**
 * Quiet kept at the end of a WAV answer. The endpointer only ends an answer
 * after `silenceMs` of quiet, and that quiet used to be uploaded whole: 900 ms
 * of nothing in every answer, a quarter of a typical one.
 */
const TRAILING_QUIET_CHUNKS = 2;
/** How long to wait for the recorder to hand over its recording after stop. */
const RECORDING_FLUSH_MS = 1_000;

export interface Heard {
  /** What the student said, or null when nothing usable arrived. */
  text: string | null;
  reason: 'heard' | 'silence' | 'cancelled' | 'error';
  /**
   * When the endpointer decided they had finished (`performance.now()`), so a
   * caller can split its wait into the endpoint and the transcription.
   */
  speechEndedAt?: number;
}

/**
 * Open the mic, take one spoken answer, close the mic, transcribe.
 *
 * Never throws: a silent room, a denied mic and a dead network are all
 * ordinary outcomes - the chips under the question carry those cases.
 */
/**
 * A mic that has delivered nothing for this long is not a quiet room — the
 * endpointer hears silence as low-level chunks — it is a mic that stopped:
 * an AudioContext suspended by the app going to the background, a device
 * taken by a call. Chunks come every CHUNK_MS.
 */
const MIC_STALL_MS = 3_000;

export async function listenOnce(
  opts: { isCancelled?: () => boolean; stallMs?: number; graceMs?: number } = {},
): Promise<Heard> {
  // The class's mic, still opening: wait for it rather than open a second
  // capture beside it (a phone may mute one for the other).
  if (open === null && opening !== null) await opening;
  if (open !== null) return listenOnOpenEar(open, opts);
  const isCancelled = opts.isCancelled ?? ((): boolean => false);
  const stallMs = opts.stallMs ?? MIC_STALL_MS;
  let lastChunkAt = Date.now();
  const preroll: Int16Array[] = [];
  const kept: Int16Array[] = [];
  const pointer = createEndpointer(opts.graceMs !== undefined ? { graceMs: opts.graceMs } : {});
  const levels: number[] = [];
  let speechEndedAt: number | undefined;

  let finish: (state: 'heard' | 'nothing' | 'cancelled' | 'dead') => void = () => undefined;
  let done = false;
  const outcome = new Promise<'heard' | 'nothing' | 'cancelled' | 'dead'>((resolve) => {
    finish = (state) => {
      if (!done) {
        done = true;
        resolve(state);
      }
    };
  });

  const mic = createMicCapture((chunk) => {
    if (done) return;
    lastChunkAt = Date.now();
    if (isCancelled()) {
      finish('cancelled');
      return;
    }
    const level = micLevelOf(chunk);
    const state = pointer.feed(level, CHUNK_MS);
    if (state === 'waiting') {
      // A rolling tail of quiet, so the answer's first syllable is not clipped.
      preroll.push(chunk);
      if (preroll.length > PREROLL_CHUNKS) preroll.shift();
      return;
    }
    kept.push(chunk);
    levels.push(level);
    if (state === 'heard') speechEndedAt = performance.now();
    if (state === 'heard' || state === 'nothing') finish(state);
    // Recorded as well as streamed: a compressed copy is a tenth of the upload
    // (packages/relay/src/hearFormat.ts). Where the browser cannot record, the
    // PCM below is sent as a WAV, exactly as before.
  }, CHUNK_MS, { record: true });

  try {
    await mic.start();
  } catch {
    return { text: null, reason: 'error' };
  }
  /**
   * THE WATCHDOG (third review, 2026-09-29). Cancellation and the endpointer
   * were only ever looked at when a chunk arrived, so a mic that stopped
   * delivering held this promise forever — and with her cross-question
   * waiting and the chips hidden, the child had no way on. A cancel is now
   * seen within a quarter second, and a stalled mic ends the listen as an
   * error, which every caller already treats as "the mic did not work".
   */
  lastChunkAt = Date.now();
  const watchdog = setInterval(() => {
    if (isCancelled()) finish('cancelled');
    else if (Date.now() - lastChunkAt > stallMs) finish('dead');
  }, 250);
  const state = await outcome;
  clearInterval(watchdog);
  mic.stop();

  if (state === 'cancelled') return { text: null, reason: 'cancelled' };
  if (state === 'dead') return { text: null, reason: 'error' };
  if (state === 'nothing') return { text: null, reason: 'silence' };

  const recording = await Promise.race([
    mic.recording(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), RECORDING_FLUSH_MS)),
  ]);

  // The quiet that ended the answer, all but its first moments.
  let end = kept.length;
  while (end > 1 && levels[end - 1] < EAR_DEFAULTS.stopLevel) end -= 1;
  end = Math.min(kept.length, end + TRAILING_QUIET_CHUNKS);
  const all = [...preroll, ...kept.slice(0, end)];
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
  const ended = speechEndedAt !== undefined ? { speechEndedAt } : {};
  try {
    const res = await postAnswer(recording, pcm);
    const data = (await res.json().catch(() => ({}))) as { text?: string };
    if (!res.ok) return { text: null, reason: 'error', ...ended };
    const text = (data.text ?? '').trim();
    return text ? { text, reason: 'heard', ...ended } : { text: null, reason: 'silence', ...ended };
  } catch {
    return { text: null, reason: 'error', ...ended };
  }
}

/**
 * THE EAR THAT STAYS OPEN (Aarav, 2026-10-02: "STT kaam nahi kar raha, tutor
 * interrupt nahi ho rahi").
 *
 * The ear above opens a mic for each answer, and only once she has finished
 * asking — so a student who answered while she was still talking, or who
 * spoke up to stop her, was never heard at all. On a production class driven
 * by a real Chrome with a fake microphone the ear itself worked (an answer was
 * heard in 2 s and judged right); what a student could not do was talk over
 * her. And a mic whose audio starts long after the last tap is one a phone may
 * never let run.
 *
 * So the room opens ONE mic, on a tap, and keeps it for the class:
 *   - it says when the student starts talking (`onStudentSpeech`) — sustained
 *     speech, BARGE_IN.ms of it, so a cough or a door is not a sentence — and
 *     the room stops her and listens;
 *   - a listen on it keeps the last RING_CHUNKS of audio, so speech that began
 *     before the listen (while she was finishing her question) is part of the
 *     answer, not lost at its start;
 *   - while a listen is taking an answer down, nothing is reported: the
 *     listen is the one deciding when they have finished.
 * Its answers go up as WAV (the compressed recording is per-mic and this mic
 * outlives every answer); the upload is a few hundred kilobytes at most.
 * Echo cancellation stays on (packages/voice createMicCapture): her voice from
 * the same speaker must not read as the student.
 */
const RING_CHUNKS = 15;
/** Talking over her: this loud, for this long, after this much quiet ends a stretch. */
export const BARGE_IN = { level: 0.15, ms: 400, resetMs: 300 };

interface Tap {
  chunk(pcm: Int16Array, level: number): void;
  cancel(): void;
}

interface OpenEar {
  mic: ReturnType<typeof createMicCapture>;
  ring: { pcm: Int16Array; level: number }[];
  taps: Set<Tap>;
  loudMs: number;
  quietMs: number;
  fired: boolean;
  lastChunkAt: number;
}

let open: OpenEar | null = null;
let opening: Promise<boolean> | null = null;
/** Bumped by every close, so a mic that finishes opening after one is let go. */
let generation = 0;
const speechListeners = new Set<() => void>();

/** The student started talking while nothing was listening for them. */
export function onStudentSpeech(listen: () => void): () => void {
  speechListeners.add(listen);
  return () => {
    speechListeners.delete(listen);
  };
}

export function isEarOpen(): boolean {
  return open !== null;
}

function hearChunk(ear: OpenEar, pcm: Int16Array): void {
  ear.lastChunkAt = Date.now();
  const level = micLevelOf(pcm);
  ear.ring.push({ pcm, level });
  if (ear.ring.length > RING_CHUNKS) ear.ring.shift();
  if (ear.taps.size > 0) {
    for (const tap of [...ear.taps]) tap.chunk(pcm, level);
    return;
  }
  if (level >= BARGE_IN.level) {
    ear.loudMs += CHUNK_MS;
    ear.quietMs = 0;
  } else {
    ear.quietMs += CHUNK_MS;
    if (ear.quietMs >= BARGE_IN.resetMs) {
      ear.loudMs = 0;
      ear.fired = false;
    }
  }
  if (!ear.fired && ear.loudMs >= BARGE_IN.ms) {
    ear.fired = true;
    for (const listen of [...speechListeners]) listen();
  }
}

/**
 * Open the class's mic, once. Call it from a tap: a phone lets audio capture
 * start only inside one. Resolves false when there is no mic or it was refused
 * — never throws.
 */
export function openEar(): Promise<boolean> {
  if (open !== null) return Promise.resolve(true);
  if (opening !== null) return opening;
  const mine = generation;
  const ear: OpenEar = {
    mic: undefined as unknown as OpenEar['mic'],
    ring: [],
    taps: new Set(),
    loudMs: 0,
    quietMs: BARGE_IN.resetMs,
    fired: false,
    lastChunkAt: Date.now(),
  };
  ear.mic = createMicCapture((pcm) => hearChunk(ear, pcm), CHUNK_MS);
  const attempt: Promise<boolean> = ear.mic.start().then(
    () => {
      if (opening === attempt) opening = null;
      if (mine !== generation) {
        ear.mic.stop();
        return false;
      }
      open = ear;
      return true;
    },
    () => {
      if (opening === attempt) opening = null;
      ear.mic.stop();
      return false;
    },
  );
  opening = attempt;
  return attempt;
}

/** Close the class's mic. Any listen on it ends as cancelled; one still opening is let go when it opens. */
export function closeEar(): void {
  generation += 1;
  opening = null;
  const ear = open;
  open = null;
  if (ear === null) return;
  for (const tap of [...ear.taps]) tap.cancel();
  ear.mic.stop();
}

/** One answer, from the open mic: `listenOnce`'s contract, with what was already being said. */
async function listenOnOpenEar(
  ear: OpenEar,
  opts: { isCancelled?: () => boolean; stallMs?: number; graceMs?: number },
): Promise<Heard> {
  const isCancelled = opts.isCancelled ?? ((): boolean => false);
  const stallMs = opts.stallMs ?? MIC_STALL_MS;
  const pointer = createEndpointer(opts.graceMs !== undefined ? { graceMs: opts.graceMs } : {});
  const preroll: Int16Array[] = [];
  const kept: Int16Array[] = [];
  const levels: number[] = [];
  let speechEndedAt: number | undefined;

  let finish: (state: 'heard' | 'nothing' | 'cancelled' | 'dead') => void = () => undefined;
  let done = false;
  const outcome = new Promise<'heard' | 'nothing' | 'cancelled' | 'dead'>((resolve) => {
    finish = (state) => {
      if (!done) {
        done = true;
        resolve(state);
      }
    };
  });
  const take = (pcm: Int16Array, level: number): void => {
    if (done) return;
    if (isCancelled()) {
      finish('cancelled');
      return;
    }
    const state = pointer.feed(level, CHUNK_MS);
    if (state === 'waiting') {
      preroll.push(pcm);
      if (preroll.length > PREROLL_CHUNKS) preroll.shift();
      return;
    }
    kept.push(pcm);
    levels.push(level);
    if (state === 'heard') speechEndedAt = performance.now();
    if (state === 'heard' || state === 'nothing') finish(state);
  };

  // The student may already be talking — they began while she was finishing.
  // Then the whole ring is theirs to keep; otherwise only a lead-in.
  const talking = ear.loudMs > 0 || (ear.fired && ear.quietMs < BARGE_IN.resetMs);
  for (const { pcm, level } of talking ? ear.ring : ear.ring.slice(-PREROLL_CHUNKS)) take(pcm, level);

  const tap: Tap = { chunk: take, cancel: () => finish('cancelled') };
  ear.taps.add(tap);
  const watchdog = setInterval(() => {
    if (isCancelled()) finish('cancelled');
    else if (Date.now() - ear.lastChunkAt > stallMs) finish('dead');
  }, 250);
  const state = await outcome;
  clearInterval(watchdog);
  ear.taps.delete(tap);
  // What this listen heard is spent: the next one must not hear it again.
  ear.ring.length = 0;
  ear.loudMs = 0;
  ear.quietMs = BARGE_IN.resetMs;
  ear.fired = false;

  if (state === 'cancelled') return { text: null, reason: 'cancelled' };
  if (state === 'dead') {
    // The class's mic stopped for good (the app went to the background, a
    // call took the device). Closed, so the next answer opens a fresh mic
    // instead of failing at once on this one.
    if (open === ear) closeEar();
    return { text: null, reason: 'error' };
  }
  if (state === 'nothing') return { text: null, reason: 'silence' };

  let end = kept.length;
  while (end > 1 && levels[end - 1] < EAR_DEFAULTS.stopLevel) end -= 1;
  end = Math.min(kept.length, end + TRAILING_QUIET_CHUNKS);
  const all = [...preroll, ...kept.slice(0, end)];
  const pcm = new Int16Array(all.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of all) {
    pcm.set(c, at);
    at += c.length;
  }
  const ended = speechEndedAt !== undefined ? { speechEndedAt } : {};
  try {
    const res = await postAnswer(null, pcm);
    const data = (await res.json().catch(() => ({}))) as { text?: string };
    if (!res.ok) return { text: null, reason: 'error', ...ended };
    const text = (data.text ?? '').trim();
    return text ? { text, reason: 'heard', ...ended } : { text: null, reason: 'silence', ...ended };
  } catch {
    return { text: null, reason: 'error', ...ended };
  }
}

/**
 * The compressed recording when there is one, else the WAV. A relay that
 * does not take compressed audio yet (415, one deployed before 2026-09-30) is
 * asked again with the WAV, so the app and the relay can ship in either order.
 */
async function postAnswer(recording: Recorded | null, pcm: Int16Array): Promise<Response> {
  const wav = (): Promise<Response> =>
    relayFetch('/api/hear', { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wavOf(pcm, MIC_SAMPLE_RATE) });
  if (!recording) return wav();
  const res = await relayFetch('/api/hear', {
    method: 'POST',
    headers: { 'content-type': recording.type },
    body: recording.blob,
  });
  return res.status === 415 ? wav() : res;
}
