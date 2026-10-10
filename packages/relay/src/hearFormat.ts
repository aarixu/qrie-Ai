/**
 * WHAT THE EAR MAY BE SENT, AND HOW EACH KIND IS METERED.
 *
 * Raw 16 kHz 16-bit mono WAV was the only body the ear took, because the
 * meter turns bytes into billed seconds (gate.ts `HEARD_BYTES_PER_SECOND`)
 * and that division is only true of raw PCM.
 *
 * COMPRESSED AUDIO IS NOW TAKEN AS WELL (Aarav, 2026-09-30: "relay ka 0.7 sec
 * bhi fix karo"). Measured that day: a 3-4 s answer is 105-136 KB as WAV
 * and 10-13 KB as Opus. Vertex heard Opus (webm, ogg) and AAC (mp4) as well
 * as the WAV, with the same prompt-token count (tools/voice-probe,
 * 2026-09-30). It is NOT free: Vertex took about 0.2 s longer on Opus
 * (median 1.64 s against 1.45 s, 24 calls each), and through the live relay
 * the smaller upload saved about 0.23 s on a good line. So on good Wi-Fi it
 * is a wash; it pays on a weak phone uplink, where 120 KB takes most of a
 * second and 12 KB does not, and it removes the upload spikes (one of 12
 * WAV-sized posts took 3.2 s).
 *
 * The meter cannot read a compressed body's duration from its size, so it is
 * charged in two steps:
 *   1. at the door, as a long answer (`COMPRESSED_HEAR_SECONDS`: ten seconds
 *      of speech, the ear's cap, and two more). The app's recording runs from
 *      the moment the mic opens, so one that waited a while for the first
 *      word is longer than that — which is what step 2 is for;
 *   2. after Vertex answers, its own prompt-token count says how long the
 *      audio really was, and anything past step 1 is claimed as well
 *      (`heardSeconds`). Whatever is claimed after the call has been made
 *      already; it holds the NEXT call, which is what a meter is for.
 */

export type HearFormat = 'pcm' | 'compressed';

const PCM = new Set(['audio/wav', 'audio/wave', 'audio/x-wav']);
const COMPRESSED = new Set(['audio/webm', 'audio/ogg', 'audio/mp4']);

/** The bare media type of a content-type header, lower-cased. */
export const mediaType = (contentType: string | undefined): string =>
  (contentType ?? 'audio/wav').split(';')[0].trim().toLowerCase();

/** 'pcm', 'compressed', or null for a body the ear does not take. */
export function hearFormat(contentType: string | undefined): HearFormat | null {
  const type = mediaType(contentType);
  if (PCM.has(type)) return 'pcm';
  if (COMPRESSED.has(type)) return 'compressed';
  return null;
}

/**
 * The longest compressed body taken: a minute at 48 kbps, far past the
 * longest answer the ear keeps (`EAR_DEFAULTS.maxSpeechMs`, ten seconds).
 */
export const MAX_COMPRESSED_HEAR_BYTES = 400_000;

/** What a compressed answer is charged at the door, in seconds of audio. */
export const COMPRESSED_HEAR_SECONDS = 12;

/**
 * Gemini's audio tokens per second, and the prompt tokens the ear's
 * instruction costs on top. MEASURED 2026-09-30 on three clips of 3.28 s,
 * 3.52 s and 4.24 s: 247, 253 and 271 prompt tokens — 25 a second and 165
 * besides, on all three.
 *
 * 165 became 267 on 2026-10-06 when the instruction gained its "[NO_SPEECH]"
 * rule and examples (vertexHear.ts). Measured again with
 * tools/voice-probe/ear-instruction-tokens.mjs on 2 s, 4 s and 8 s of audio:
 * 317, 367 and 467 prompt tokens, which is 25.0 a second and 267 besides.
 * Change the instruction and this number must be measured again, or every
 * answer is settled a couple of seconds long.
 */
export const AUDIO_TOKENS_PER_SECOND = 25;
export const HEAR_INSTRUCTION_TOKENS = 267;

/** How many seconds of audio Vertex says it heard. */
export function heardSeconds(promptTokens: number): number {
  return Math.max(0, (promptTokens - HEAR_INSTRUCTION_TOKENS) / AUDIO_TOKENS_PER_SECOND);
}
