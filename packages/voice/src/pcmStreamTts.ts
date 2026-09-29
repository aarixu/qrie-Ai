import type { TtsAdapter } from '@ai-tutor/player';

/**
 * HER VOICE, PLAYED AS IT IS MADE (2026-09-28).
 *
 * The relay streams Gemini TTS's raw 16-bit 24 kHz PCM straight from Vertex
 * (`format=pcm`, packages/relay/src/vertexSpeech.ts). This adapter schedules
 * each chunk through Web Audio the moment it lands, gaplessly after the one
 * before, so she starts speaking on the first chunk — measured 1.2-2.1 s to
 * the first audio on Vertex directly, 2026-09-28 — instead of when the whole
 * line is ready.
 *
 * WHY NOT AN `<audio src>`, which is what the aura-2 voice used: an audio
 * element cannot start a WAV early. Measured in Chromium 2026-09-28, a streamed
 * WAV of unknown length did not reach `canplay` until ~240 KB had arrived,
 * which is nearly the whole of a typical line.
 *
 * Every path out of speak() RESOLVES — a refused relay, a 200 with no audio,
 * a cancel, no audio output at all, a stream that stalls — because the board
 * advances on it. A failure with nothing heard speaks the line through
 * `fallback` instead.
 *
 * AND NOTHING WAITS FOREVER (overnight review #12/#31). A stream that sends
 * no audio within `firstChunkMs`, or stops for `stallMs` once it has
 * started, is abandoned: before any audio the line goes to the fallback voice;
 * after some, it ends where it stopped — repeating it from the top would be
 * worse. Before this a stalled network froze the class with the chips hidden.
 */

/** Where the samples go. Web Audio in the app; a fake clock in tests. */
export interface PcmOutput {
  /** The output clock, in seconds. */
  now(): number;
  /** Schedule `samples` (-1..1, mono) to start at `at` seconds on that clock. */
  play(samples: Float32Array, sampleRate: number, at: number): { stop(): void };
  /** Ask a suspended output to run (autoplay policy). */
  resume?(): void;
}

export interface PcmStreamTtsOptions {
  /** The relay's speech route. */
  endpoint: string;
  /** Called per line, not once: a class outlives a pass. */
  ticket?: () => string | null;
  session?: () => string | null;
  /** 'en' or 'hi-en' — the tutor language the child chose at onboarding. */
  lang?: () => string | null;
  /** Null when there is nothing to play through; the line then falls back. */
  output: () => PcmOutput | null;
  fallback?: TtsAdapter;
  fetch?: (url: string, init: { signal: AbortSignal }) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  /** Fired when the line's first sample actually reaches the speaker. */
  onStart?: (text: string) => void;
  sampleRate?: number;
  /** How long to wait for the first audio, and between chunks once it flows. */
  deadlines?: { firstChunkMs?: number; stallMs?: number };
}

/**
 * Vertex's first audio was measured at 1.2-2.1 s (2026-09-28), so six seconds
 * is a stream that is not coming; a live stream sends chunks well under a
 * second apart, so four seconds of nothing is a stalled one.
 */
const FIRST_CHUNK_MS = 6_000;
const STALL_MS = 4_000;

/** How far ahead of now the first chunk is scheduled; less clicks, more waits. */
const LEAD_SEC = 0.05;

/** Little-endian signed 16-bit PCM to float samples. An odd trailing byte is ignored. */
export function pcmBytesToFloat32(bytes: Uint8Array): Float32Array {
  const n = Math.floor(bytes.byteLength / 2);
  const out = new Float32Array(n);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  for (let i = 0; i < n; i += 1) {
    const s = view.getInt16(i * 2, true);
    out[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
  }
  return out;
}

/** One line on its way: fetched ahead or on demand, played once. */
interface Take {
  text: string;
  abort: AbortController;
  chunks: Float32Array[];
  done: boolean;
  failed: boolean;
  wake: (() => void) | null;
}

export function createPcmStreamTts(opts: PcmStreamTtsOptions): TtsAdapter {
  const doFetch = opts.fetch ?? ((url, init) => fetch(url, init));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const rate = opts.sampleRate ?? 24_000;
  const firstChunkMs = opts.deadlines?.firstChunkMs ?? FIRST_CHUNK_MS;
  const stallMs = opts.deadlines?.stallMs ?? STALL_MS;

  const urlFor = (words: string): string => {
    const query = new URLSearchParams({ text: words, format: 'pcm' });
    const lang = opts.lang?.();
    if (lang) query.set('lang', lang);
    const pass = opts.ticket?.();
    if (pass) query.set('ticket', pass);
    const session = opts.session?.();
    if (session) query.set('session', session);
    return `${opts.endpoint}?${query}`;
  };

  const start = (text: string): Take => {
    const take: Take = { text, abort: new AbortController(), chunks: [], done: false, failed: false, wake: null };
    let deadline: ReturnType<typeof setTimeout> | null = null;
    const arm = (ms: number): void => {
      if (deadline !== null) clearTimeout(deadline);
      deadline = setTimeout(() => take.abort.abort(), ms);
    };
    const settle = (failed: boolean): void => {
      if (deadline !== null) clearTimeout(deadline);
      deadline = null;
      if (take.done) return;
      take.failed = failed;
      take.done = true;
      take.wake?.();
    };
    // Rejects on abort, so a fetch or a reader that ignores its signal still
    // lets go of the line.
    const aborted = new Promise<never>((_, reject) => {
      take.abort.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    aborted.catch(() => undefined);
    arm(firstChunkMs);
    void (async () => {
      try {
        const res = await Promise.race([doFetch(urlFor(text), { signal: take.abort.signal }), aborted]);
        // Only raw PCM is playable here. An older relay answers mp3 to the
        // same URL, and mp3 bytes read as samples are loud static.
        const type = (res.headers?.get?.('content-type') ?? '').toLowerCase();
        if (!res.ok || !res.body || !type.startsWith('audio/l16')) {
          take.abort.abort();
          return settle(true);
        }
        const reader = res.body.getReader();
        take.abort.signal.addEventListener('abort', () => void reader.cancel().catch(() => undefined), { once: true });
        let odd: number | null = null;
        for (;;) {
          const { done, value } = await Promise.race([reader.read(), aborted]);
          if (done) break;
          let bytes = value;
          if (odd !== null) {
            const joined = new Uint8Array(bytes.byteLength + 1);
            joined[0] = odd;
            joined.set(bytes, 1);
            bytes = joined;
            odd = null;
          }
          if (bytes.byteLength % 2 === 1) {
            odd = bytes[bytes.byteLength - 1];
            bytes = bytes.subarray(0, bytes.byteLength - 1);
          }
          if (bytes.byteLength > 0) {
            take.chunks.push(pcmBytesToFloat32(bytes));
            arm(stallMs);
            take.wake?.();
          }
        }
        settle(take.chunks.length === 0);
      } catch {
        settle(take.chunks.length === 0);
      }
    })();
    return take;
  };

  let primed: Take | null = null;
  /** The line being spoken: its take, what it scheduled, and how to end it. */
  let current: {
    take: Take;
    handles: { stop(): void }[];
    cancelled: boolean;
    interrupt: () => void;
    /** The fallback voice has this line: cancelling it must reach that voice (overnight review #9). */
    viaFallback: boolean;
  } | null = null;

  const stopCurrent = (): void => {
    if (!current) return;
    current.cancelled = true;
    current.take.abort.abort();
    if (current.viaFallback) opts.fallback?.cancel();
    for (const h of current.handles) {
      try {
        h.stop();
      } catch {
        // Already ended.
      }
    }
    current.interrupt();
    current = null;
  };

  return {
    async speak(text: string): Promise<void> {
      stopCurrent();
      const words = text.trim();
      if (words === '') return;

      // A primed take that already failed (a stalled prime) is fetched again,
      // not played through the fallback voice.
      const take = primed?.text === words && !(primed.done && primed.failed) ? primed : start(words);
      if (primed === take) primed = null;

      let interrupt: () => void = () => undefined;
      const interrupted = new Promise<void>((r) => (interrupt = r));
      const line = { take, handles: [] as { stop(): void }[], cancelled: false, interrupt, viaFallback: false };
      current = line;
      // The line stays `current` while the fallback says it, so cancel reaches it.
      const viaFallback = async (): Promise<void> => {
        line.viaFallback = true;
        await opts.fallback?.speak(words);
        if (current === line) current = null;
      };

      const out = opts.output();
      if (!out) {
        take.abort.abort();
        await viaFallback();
        return;
      }
      out.resume?.();

      let queuedUntil = 0;
      let next = 0;
      let heard = false;
      for (;;) {
        while (next < take.chunks.length) {
          const chunk = take.chunks[next];
          next += 1;
          const at = Math.max(out.now() + LEAD_SEC, queuedUntil);
          line.handles.push(out.play(chunk, rate, at));
          queuedUntil = at + chunk.length / rate;
          if (!heard) {
            heard = true;
            const delay = Math.max(0, (at - out.now()) * 1000);
            setTimeout(() => {
              if (!line.cancelled) opts.onStart?.(words);
            }, delay);
          }
        }
        if (line.cancelled || take.done) break;
        await Promise.race([new Promise<void>((r) => (take.wake = r)), interrupted]);
        take.wake = null;
      }
      if (line.cancelled) return;

      if (take.failed && !heard) {
        await viaFallback();
        return;
      }

      const remaining = queuedUntil - out.now();
      if (remaining > 0) await Promise.race([sleep(remaining * 1000 + 30), interrupted]);
      if (current === line) current = null;
    },

    prime(text: string): void {
      const words = text.trim();
      if (words === '' || primed?.text === words || current?.take.text === words) return;
      primed?.abort.abort();
      primed = start(words);
    },

    /**
     * Only the line being spoken. The primed one is left fetching, because a
     * pause or a seek still wants it next; `drop` is what abandons it.
     */
    cancel(): void {
      stopCurrent();
    },

    drop(): void {
      primed?.abort.abort();
      primed = null;
    },
  };
}

/**
 * The real speaker: Web Audio, routed through `destination` so the avatar's
 * analyser hears exactly what the student does.
 */
export function createWebAudioOutput(context: AudioContext, destination: AudioNode): PcmOutput {
  return {
    now: () => context.currentTime,
    play(samples, sampleRate, at) {
      const buffer = context.createBuffer(1, samples.length, sampleRate);
      buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
      const src = context.createBufferSource();
      src.buffer = buffer;
      src.connect(destination);
      src.start(at);
      return {
        stop: () => {
          try {
            src.stop();
          } catch {
            // Not started or already ended.
          }
          src.disconnect();
        },
      };
    },
    resume() {
      if (context.state === 'suspended') void context.resume().catch(() => undefined);
    },
  };
}
