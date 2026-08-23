/**
 * What a run costs, in the only units Google bills in.
 *
 * Both numbers are measured rather than quoted: 25 words came back as 233 audio
 * tokens over 7.3 s of audio, which is ~32 tokens/sec. Google's pricing footnote
 * says 25 tokens/sec; we budget with the larger number because it came from a
 * real billed response and because an estimate that surprises upward is the one
 * that loses trust.
 */

export const AUDIO_TOKENS_PER_SECOND = 32;

/** gemini-3.1-flash-tts-preview, paid tier, output audio. Input text is rounding error. */
export const USD_PER_MILLION_AUDIO_TOKENS = 20;

/** Batch is exactly half, across the board. Not built yet — see the README. */
export const BATCH_DISCOUNT = 0.5;

export function audioTokensForMs(durationMs: number): number {
  return Math.round((durationMs / 1000) * AUDIO_TOKENS_PER_SECOND);
}

export function estimateCostUsd(audioTokens: number): number {
  return (audioTokens / 1_000_000) * USD_PER_MILLION_AUDIO_TOKENS;
}

export function costForDurationMs(durationMs: number): number {
  return estimateCostUsd(audioTokensForMs(durationMs));
}

/** Sub-cent runs are the normal case, so never round a real cost to "$0.00". */
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0.00';
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}
