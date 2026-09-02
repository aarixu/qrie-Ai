/**
 * WHICH VOICE ACTUALLY SPOKE.
 *
 * On-device speech is built to fail quietly: the model is 263 MB, it can run
 * out of memory on a four-gigabyte phone, and when it does the cloud voice
 * takes the line so the class carries on. That is right for a student and
 * useless for the person testing it — a class that sounds fine proves nothing
 * about which layer made the sound, and "it worked" is the same sentence
 * whether the phone did the work or a server did.
 *
 * So each layer says what it did, once per line, and the app can show it. No
 * network, no storage: a ring of the last few lines, read by whoever asks.
 */

export type VoiceSource = 'on-device' | 'cloud' | 'recorded' | 'browser' | 'silent';

export interface SpokenLine {
  source: VoiceSource;
  /** Enough of the line to recognise it. Not the whole thing — this is a log. */
  text: string;
  /** How long the making took, when the layer knows. Null for a recording. */
  madeInMs: number | null;
  at: number;
}

/** Why a layer handed the line on, when it did. */
export interface VoiceTrouble {
  source: VoiceSource;
  reason: string;
  at: number;
}

const KEEP = 40;

const spoken: SpokenLine[] = [];
const trouble: VoiceTrouble[] = [];
const listeners = new Set<() => void>();

const announce = () => {
  for (const listener of listeners) listener();
};

export function noteSpoken(source: VoiceSource, text: string, madeInMs: number | null): void {
  spoken.push({ source, text: text.slice(0, 60), madeInMs, at: Date.now() });
  if (spoken.length > KEEP) spoken.shift();
  announce();
}

export function noteTrouble(source: VoiceSource, reason: string): void {
  // Deduplicated on the reason: a model that failed to load fails for every
  // line of the class, and forty copies of one sentence hides everything else.
  if (trouble.some((t) => t.source === source && t.reason === reason)) return;
  trouble.push({ source, reason, at: Date.now() });
  announce();
}

export const voiceReport = (): { spoken: readonly SpokenLine[]; trouble: readonly VoiceTrouble[] } => ({
  spoken: [...spoken],
  trouble: [...trouble],
});

export function onVoiceReport(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function forgetVoiceReport(): void {
  spoken.length = 0;
  trouble.length = 0;
  announce();
}

/**
 * How many lines each layer said.
 *
 * The one number that answers "did the phone do it": if `on-device` is zero
 * after a whole class, the model never worked and the fallback hid it.
 */
export function voiceTally(): Record<VoiceSource, number> {
  const tally = { 'on-device': 0, cloud: 0, recorded: 0, browser: 0, silent: 0 };
  for (const line of spoken) tally[line.source] += 1;
  return tally;
}
