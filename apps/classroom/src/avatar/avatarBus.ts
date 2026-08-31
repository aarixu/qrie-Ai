import type { SpeechElement } from '@ai-tutor/voice';

/**
 * THE BUS BETWEEN HER VOICE AND HER FACE.
 *
 * The voice pipeline and the avatar must not know each other, so they meet
 * here: the streaming TTS builds its audio elements through `avatarAudio`,
 * the lesson adapter announces each line through `announceLine`, and the
 * face asks two questions per frame — what line is being said and how far
 * into it are we (`progress`), and how loud is this instant (`level`).
 *
 * Sync rides on the AUDIO ELEMENT'S OWN CLOCK (currentTime), not on ours:
 * a stalled network pauses the clock, and the mouth pauses with it instead
 * of talking over silence. When the line plays through something we cannot
 * tap (the recorded take, the browser voice), progress falls back to wall
 * time and level to null — the face then breathes shape-only, which reads
 * as quiet speech rather than breaking.
 */

let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let samples: Uint8Array<ArrayBuffer> | null = null;

/** The element speaking right now, when it is one of ours. */
let currentEl: HTMLAudioElement | null = null;
let line: { text: string; startedAt: number } = { text: '', startedAt: 0 };

const tap = (el: HTMLAudioElement): void => {
  try {
    if (audioCtx === null) {
      audioCtx = new AudioContext();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      samples = new Uint8Array(analyser.fftSize);
      analyser.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') void audioCtx.resume().catch(() => undefined);
    // One source per element, made once — the element plays through the
    // analyser from here on, so the face hears exactly what the student does.
    audioCtx.createMediaElementSource(el).connect(analyser!);
  } catch {
    // Tapping is a bonus. A browser that refuses still plays the audio
    // normally, because the element was not rerouted.
  }
};

/** Audio factory for createStreamingTts: a real Audio, with the face listening in. */
export function avatarAudio(src: string): SpeechElement {
  const el = new Audio(src);
  tap(el);
  el.addEventListener('play', () => {
    currentEl = el;
    // The context may have been born before the browser trusted us with
    // sound; a play that reaches here rides a user gesture, so ask again.
    if (audioCtx?.state === 'suspended') void audioCtx.resume().catch(() => undefined);
  });
  return el as unknown as SpeechElement;
}

/** The lesson adapter says what is being spoken; empty text is silence. */
export function announceLine(text: string): void {
  line = { text: text.trim(), startedAt: performance.now() };
  if (text.trim() === '') currentEl = null;
}

export interface LineProgress {
  text: string;
  elapsedMs: number;
  /** The audio's real duration when the element told us; null before/without it. */
  durationMs: number | null;
}

export function progress(): LineProgress {
  if (line.text === '') return { text: '', elapsedMs: 0, durationMs: null };
  if (currentEl && !currentEl.paused && Number.isFinite(currentEl.currentTime)) {
    const dur = Number.isFinite(currentEl.duration) ? currentEl.duration * 1000 : null;
    return { text: line.text, elapsedMs: currentEl.currentTime * 1000, durationMs: dur };
  }
  return { text: line.text, elapsedMs: performance.now() - line.startedAt, durationMs: null };
}

/** Loudness right now, 0..1 — or null when nothing of ours is playing. */
export function level(): number | null {
  if (!analyser || !samples || !currentEl || currentEl.paused) return null;
  analyser.getByteTimeDomainData(samples);
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = (samples[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / samples.length);
  // A suspended context reads a dead-flat line. That is "cannot hear", not
  // "she is silent" — null lets the face fall back to shape-only drive
  // instead of clamping the mouth nearly shut for the whole class.
  if (rms < 0.004) return null;
  return Math.min(1, rms * 4);
}
