import { createWebAudioOutput, type PcmOutput, type SpeechElement } from '@ai-tutor/voice';

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

/** Her voice's one context, made once: by the first tap (`unlockAudio`) or her first line. */
function voiceContext(): AudioContext {
  if (audioCtx === null) {
    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    samples = new Uint8Array(analyser.fftSize);
    analyser.connect(audioCtx.destination);
  }
  return audioCtx;
}

let unlocked = false;

/**
 * HER VOICE ON A PHONE (Aarav, 2026-10-02: "ise mobile use ke liye ready
 * karo"). The context her voice plays through used to be made when she first
 * spoke — after the student's tap had passed — and iPhone Safari keeps a
 * context made outside a tap suspended, which plays nothing: a silent tutor.
 * Called on the first tap anywhere in the app (main.tsx), this makes the
 * context INSIDE the tap, wakes it, and plays one silent sample, which is what
 * unlocks audio on iOS. Later taps cost nothing. Where there is no Web Audio
 * it does nothing; her voice falls back to the browser's own there.
 */
export function unlockAudio(): void {
  if (unlocked) return;
  try {
    const ctx = voiceContext();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    const silence = ctx.createBufferSource();
    silence.buffer = ctx.createBuffer(1, 1, 22_050);
    silence.connect(ctx.destination);
    silence.start(0);
    unlocked = true;
  } catch {
    // No Web Audio in this browser.
  }
}

/**
 * HER VOICE AS WEB AUDIO (2026-09-28): the Gemini PCM stream is scheduled as
 * buffers, not played by an element, so the face listens to the same
 * analyser through this output instead. `pcmStartedAt` is the line's first
 * sample on the audio clock — the mouth's clock for that line.
 */
let pcmStartedAt: number | null = null;

export function avatarPcmOutput(): PcmOutput | null {
  try {
    const ctx = voiceContext();
    const out = createWebAudioOutput(ctx, analyser!);
    return {
      ...out,
      play(s, rate, at) {
        if (pcmStartedAt === null) pcmStartedAt = at;
        return out.play(s, rate, at);
      },
      resume() {
        if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      },
    };
  } catch {
    // No Web Audio (an old WebView): the line falls back to the browser voice.
    return null;
  }
}

/** The lesson adapter says what is being spoken; empty text is silence. */
export function announceLine(text: string): void {
  line = { text: text.trim(), startedAt: performance.now() };
  pcmStartedAt = null;
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
  if (pcmStartedAt !== null && audioCtx) {
    return { text: line.text, elapsedMs: Math.max(0, (audioCtx.currentTime - pcmStartedAt) * 1000), durationMs: null };
  }
  if (currentEl && !currentEl.paused && Number.isFinite(currentEl.currentTime)) {
    const dur = Number.isFinite(currentEl.duration) ? currentEl.duration * 1000 : null;
    return { text: line.text, elapsedMs: currentEl.currentTime * 1000, durationMs: dur };
  }
  return { text: line.text, elapsedMs: performance.now() - line.startedAt, durationMs: null };
}

/** Loudness right now, 0..1 — or null when nothing of ours is playing. */
export function level(): number | null {
  const pcmSpeaking = pcmStartedAt !== null && audioCtx !== null && audioCtx.currentTime >= pcmStartedAt;
  if (!analyser || !samples || (!pcmSpeaking && (!currentEl || currentEl.paused))) return null;
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
