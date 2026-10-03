/**
 * SAMPLES TO A FILE AN <audio> ELEMENT WILL PLAY.
 *
 * On-device synthesis hands back a Float32Array. Everything downstream of the
 * voice — the streaming adapter, the recorded take, and the avatar's lipsync
 * (switched off in the app for now) — speaks in terms of a URL handed to an
 * audio element, because sync rides on that element's own clock rather than on
 * ours. So the samples become a WAV, the WAV becomes a blob URL, and anything
 * synced to it keeps the same clock the student hears.
 *
 * WAV rather than anything smaller, because there is nothing to encode with: a
 * browser can DECODE mp3 and opus but ships no encoder, and pulling one in as
 * WASM would cost more download than the uncompressed audio it saves. These
 * clips live for one sentence and are revoked.
 */

/** 16-bit PCM, mono. Nothing here needs stereo and a class is speech. */
const BITS = 16;
const CHANNELS = 1;

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);

  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(at + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM header length
  view.setUint16(20, 1, true); // PCM, uncompressed
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, (sampleRate * CHANNELS * BITS) / 8, true); // byte rate
  view.setUint16(32, (CHANNELS * BITS) / 8, true); // block align
  view.setUint16(34, BITS, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i += 1) {
    /**
     * Clamped BEFORE scaling, and scaled by different numbers each way.
     *
     * A float sample runs -1..1 and 16-bit PCM runs -32768..32767, which is
     * not symmetric: multiplying a +1.0 by 32768 overflows to -32768, and one
     * sample of full-scale inversion is an audible click at the loudest moment
     * of the line. Synthesis output does reach 1.0.
     */
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/** The same bytes as something an audio element can be pointed at. */
export function wavUrl(samples: Float32Array, sampleRate: number): string {
  const bytes = encodeWav(samples, sampleRate);
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/wav' }));
}
