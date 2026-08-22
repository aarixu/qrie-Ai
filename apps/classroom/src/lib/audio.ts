/**
 * Browser audio plumbing for the live doubt tutor.
 *
 * The Live API speaks raw PCM in both directions and the two directions do not
 * agree on a rate: the student's mic must arrive as 16 kHz signed 16-bit mono,
 * the tutor's voice comes back at 24 kHz. Everything here exists to bridge that
 * gap, and it is split deliberately:
 *
 *   - the conversions (float <-> int16 <-> base64, resampling, chunking) are
 *     pure functions, so they are unit-tested rather than hand-verified;
 *   - the two stateful pieces (createMicCapture, createAudioPlayer) are thin
 *     shells over Web Audio that hold no logic worth testing without a device.
 *
 * Nothing here knows about Gemini, doubts or lessons — liveAgent.ts owns that.
 */

/** What the Live API wants from the mic. */
export const MIC_SAMPLE_RATE = 16000;
/** What the Live API sends back as the tutor's voice. */
export const TUTOR_SAMPLE_RATE = 24000;

/**
 * How far ahead of `currentTime` a freshly queued buffer is scheduled. Zero
 * would mean "start in the past" for anything that arrives a hair late, which
 * Web Audio renders as a click.
 */
const SCHEDULE_LEAD_SEC = 0.06;

/** How much mic audio to gather before sending a frame. ~100 ms keeps the
 * socket calm (a raw render quantum is 8 ms) without adding audible latency. */
const DEFAULT_CHUNK_MS = 100;

// ---------------------------------------------------------------------------
// Pure conversions
// ---------------------------------------------------------------------------

/**
 * Float samples (-1..1) to signed 16-bit PCM.
 *
 * Clamping comes first because an out-of-range sample does not merely distort:
 * it wraps to the opposite sign and lands as a loud click in the student's ear.
 * The scale is asymmetric (int16 has one more step below zero than above) so
 * that encode -> decode round-trips exactly at both extremes.
 */
export function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
  }
  return out;
}

/**
 * Signed 16-bit PCM back to float samples (-1..1). Inverse of floatTo16BitPCM.
 *
 * The buffer type is pinned to ArrayBuffer (not the default ArrayBufferLike)
 * because the result is handed straight to AudioBuffer.copyToChannel, which
 * will not take a possibly-shared buffer.
 */
/**
 * Perceptual loudness of a PCM chunk, 0..1, for the waveform.
 *
 * Plain RMS of speech sits around 0.02–0.15, which would leave the bars looking
 * dead, so the value is scaled and clamped. This is a display signal only —
 * nothing about the conversation depends on it.
 */
export function micLevelOf(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const s = pcm[i] / 32768;
    sum += s * s;
  }
  const rms = Math.sqrt(sum / pcm.length);
  return Math.min(1, rms * 6);
}

export function pcm16ToFloat32(input: Int16Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const v = input[i];
    out[i] = v < 0 ? v / 0x8000 : v / 0x7fff;
  }
  return out;
}

/**
 * PCM to base64, little-endian.
 *
 * The endianness is written explicitly through a DataView rather than handing
 * over the Int16Array's own bytes: the wire format is fixed little-endian, and
 * borrowing the platform's byte order would be a silent bug on the day this
 * runs somewhere big-endian.
 */
export function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < pcm.length; i += 1) view.setInt16(i * 2, pcm[i], true);

  // btoa takes a binary string; fromCharCode is applied in slices because
  // spreading a whole utterance would blow the argument limit.
  let binary = '';
  const STRIDE = 0x8000;
  for (let i = 0; i < bytes.length; i += STRIDE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + STRIDE));
  }
  return btoa(binary);
}

/** base64 (little-endian PCM) back to samples. A trailing odd byte is dropped. */
export function base64ToInt16(b64: string): Int16Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  const view = new DataView(bytes.buffer);
  const samples = Math.floor(bytes.length / 2);
  const out = new Int16Array(samples);
  for (let i = 0; i < samples; i += 1) out[i] = view.getInt16(i * 2, true);
  return out;
}

/**
 * Resample down to 16 kHz by averaging each source window.
 *
 * Averaging rather than picking the nearest sample: dropping 2 of every 3
 * samples at 48 kHz aliases high frequencies down into the voice band, which
 * the model hears as a hiss over the student's words. A box filter is crude but
 * it is a filter, and it costs one add per sample.
 *
 * Rates at or below the target are returned untouched — upsampling would invent
 * detail, and the API resamples anything it is given anyway.
 */
export function downsampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (!Number.isFinite(inputRate) || inputRate <= MIC_SAMPLE_RATE) return input;

  const ratio = inputRate / MIC_SAMPLE_RATE;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);

  for (let i = 0; i < outLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let n = 0;
    for (let j = start; j < end; j += 1) {
      sum += input[j];
      n += 1;
    }
    out[i] = n > 0 ? sum / n : 0;
  }
  return out;
}

export interface PcmChunker {
  /** Feed arbitrary-length PCM; full chunks are handed to the callback. */
  push(samples: Int16Array): void;
  /** Drop the partial tail (used when a session ends mid-chunk). */
  reset(): void;
}

/**
 * Regroups the audio graph's small, irregular blocks into fixed-size chunks.
 *
 * Each emitted chunk is a fresh array that the consumer owns outright — reusing
 * one buffer would mean a chunk still sitting in the socket's send queue gets
 * overwritten by the next 100 ms of speech.
 */
export function createPcmChunker(
  samplesPerChunk: number,
  onChunk: (chunk: Int16Array) => void,
): PcmChunker {
  const size = Math.max(1, Math.floor(samplesPerChunk));
  let buf = new Int16Array(size);
  let filled = 0;

  return {
    push(samples: Int16Array): void {
      let i = 0;
      while (i < samples.length) {
        const take = Math.min(size - filled, samples.length - i);
        buf.set(samples.subarray(i, i + take), filled);
        filled += take;
        i += take;
        if (filled === size) {
          onChunk(buf);
          buf = new Int16Array(size);
          filled = 0;
        }
      }
    },
    reset(): void {
      filled = 0;
    },
  };
}

/**
 * When to start the next buffer so playback is gapless: butted against what is
 * already queued, but never behind the clock.
 */
export function nextStartTime(currentTime: number, queuedUntil: number, leadSec: number): number {
  return Math.max(currentTime + leadSec, queuedUntil);
}

// ---------------------------------------------------------------------------
// Microphone capture
// ---------------------------------------------------------------------------

/**
 * Kept as a string and loaded from a Blob URL so the worklet needs no entry in
 * the Vite build — one file, one deploy, no separate asset to lose.
 */
const WORKLET_SOURCE = `
class PcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    // The render quantum buffer is recycled every block, so post a copy.
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('pcm-tap', PcmTap);
`;

export interface MicCapture {
  /** Opens the mic and starts emitting chunks. Rejects if permission is refused. */
  start(): Promise<void>;
  /** Releases the mic and stops emitting. Safe to call twice. */
  stop(): void;
}

/**
 * Streams the mic as 16 kHz PCM chunks for as long as it is running.
 *
 * It streams *continuously*, including silence, and that is not an oversight:
 * the API's voice-activity detection decides the student has finished speaking
 * by hearing the silence after their question. Gating on input level would
 * leave every doubt hanging with no reply.
 */
export function createMicCapture(
  onChunk: (pcm16: Int16Array) => void,
  chunkMs: number = DEFAULT_CHUNK_MS,
): MicCapture {
  let running = false;
  let ctx: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let tap: AudioNode | null = null;
  let sink: GainNode | null = null;
  let detachTap: (() => void) | null = null;
  let workletUrl: string | null = null;

  const chunker = createPcmChunker(Math.round((MIC_SAMPLE_RATE * chunkMs) / 1000), onChunk);

  const release = (): void => {
    detachTap?.();
    detachTap = null;
    tap?.disconnect();
    tap = null;
    source?.disconnect();
    source = null;
    sink?.disconnect();
    sink = null;
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    if (workletUrl !== null) {
      URL.revokeObjectURL(workletUrl);
      workletUrl = null;
    }
    void ctx?.close().catch(() => undefined);
    ctx = null;
    chunker.reset();
  };

  const stop = (): void => {
    running = false;
    release();
  };

  const feed = (frame: Float32Array, rate: number): void => {
    if (!running) return;
    chunker.push(floatTo16BitPCM(downsampleTo16k(frame, rate)));
  };

  const start = async (): Promise<void> => {
    if (running) return;
    running = true;

    // Echo cancellation is load-bearing, not polish: on a phone the tutor's
    // voice leaves the same speaker this mic is listening to, and without it
    // she hears herself and treats it as the student interrupting.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    // stop() can land while the permission prompt is open.
    if (!running) {
      release();
      return;
    }

    // Ask for the rate the API wants; browsers that refuse are handled by
    // reading the rate back and resampling, which is why it is captured here.
    ctx = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
    const rate = ctx.sampleRate;
    source = ctx.createMediaStreamSource(stream);

    try {
      workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(workletUrl);
      if (!running) {
        release();
        return;
      }
      const worklet = new AudioWorkletNode(ctx, 'pcm-tap');
      worklet.port.onmessage = (e: MessageEvent<Float32Array>): void => feed(e.data, rate);
      detachTap = () => {
        worklet.port.onmessage = null;
      };
      tap = worklet;
    } catch {
      // A real share of the phones this ships to run WebViews with no
      // AudioWorklet. ScriptProcessor is deprecated everywhere and still the
      // only way to see samples there.
      const sp = ctx.createScriptProcessor(4096, 1, 1);
      sp.onaudioprocess = (e: AudioProcessingEvent): void =>
        feed(new Float32Array(e.inputBuffer.getChannelData(0)), rate);
      detachTap = () => {
        sp.onaudioprocess = null;
      };
      tap = sp;
    }

    source.connect(tap);
    // A ScriptProcessor only runs while it reaches the destination, so the tap
    // is routed there through a muted gain — the student must never hear their
    // own mic played back.
    sink = ctx.createGain();
    sink.gain.value = 0;
    tap.connect(sink);
    sink.connect(ctx.destination);
  };

  return { start, stop };
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

export interface AudioPlayer {
  /** Queue one base64 PCM chunk of the tutor's voice. */
  enqueue(base64: string): void;
  /** Drop everything queued and silence immediately (barge-in). */
  stop(): void;
  /** True while the tutor still has voice left to play. */
  isPlaying(): boolean;
  /** Release the audio context. */
  close(): void;
}

/**
 * Plays the tutor's voice gaplessly.
 *
 * Chunks arrive faster than real time and in pieces far shorter than a word, so
 * they are not played on arrival — each is scheduled to begin exactly where the
 * previous one ends. Playing on arrival would put an audible seam between every
 * syllable.
 */
export function createAudioPlayer(): AudioPlayer {
  let ctx: AudioContext | null = null;
  let queuedUntil = 0;
  const sources = new Set<AudioBufferSourceNode>();

  const context = (): AudioContext => {
    if (ctx === null) ctx = new AudioContext();
    // Autoplay policy suspends contexts made outside a gesture; the raise-hand
    // tap is always the gesture behind this one.
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    return ctx;
  };

  const stop = (): void => {
    for (const src of sources) {
      src.onended = null;
      try {
        src.stop();
      } catch {
        // Already finished — stopping twice is not an error worth surfacing.
      }
      src.disconnect();
    }
    sources.clear();
    queuedUntil = 0;
  };

  return {
    enqueue(base64: string): void {
      const pcm = base64ToInt16(base64);
      if (pcm.length === 0) return;

      const c = context();
      const buffer = c.createBuffer(1, pcm.length, TUTOR_SAMPLE_RATE);
      buffer.copyToChannel(pcm16ToFloat32(pcm), 0);

      const src = c.createBufferSource();
      src.buffer = buffer;
      src.connect(c.destination);

      const startAt = nextStartTime(c.currentTime, queuedUntil, SCHEDULE_LEAD_SEC);
      src.start(startAt);
      queuedUntil = startAt + buffer.duration;

      sources.add(src);
      src.onended = (): void => {
        sources.delete(src);
      };
    },
    stop,
    isPlaying(): boolean {
      return ctx !== null && sources.size > 0 && ctx.currentTime < queuedUntil;
    },
    close(): void {
      stop();
      void ctx?.close().catch(() => undefined);
      ctx = null;
    },
  };
}
