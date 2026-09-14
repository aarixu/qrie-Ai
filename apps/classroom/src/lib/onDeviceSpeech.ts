import type { Synthesiser } from '@ai-tutor/voice';

/**
 * THE MODELS, IN THE BROWSER THE APP ALREADY IS.
 *
 * transformers.js rather than a Capacitor plugin, and that was a measurement
 * rather than a preference: the int8 Supertonic that would have been half the
 * size is packaged for sherpa-onnx, whose npm package is a Node native addon
 * and cannot enter a WebView at all. Through transformers.js the same models
 * run in the page — which means they also run at localhost:5173, so this is
 * debuggable on a laptop instead of only on a phone over adb.
 *
 * WHAT IT COSTS, measured on a laptop before any of this was written:
 *
 *   Supertonic (TTS)     263 MB   2.7x realtime
 *   whisper-tiny.en q8    43 MB   1.0s per 5s of audio
 *
 * The 263 MB is not a choice: onnx-community/Supertonic-TTS-2-ONNX publishes
 * exactly one variant per graph and no quantized build at all.
 *
 * LOADED ONCE, LAZILY, AND NEVER ON THE CRITICAL PATH. The import is dynamic
 * so three hundred megabytes of runtime is not in the entry bundle, and a
 * failure to load is not an error the student sees — the cloud voice is still
 * behind it.
 */

/** Her voice. F1 is the one the tutor uses; the repo ships several. */
const VOICE = '/models/onnx-community/Supertonic-TTS-2-ONNX/voices/F1.bin';

const TTS_MODEL = 'onnx-community/Supertonic-TTS-2-ONNX';
const STT_MODEL = 'onnx-community/whisper-tiny.en';

/** What the mic records at, and what Whisper expects. */
export const STT_SAMPLE_RATE = 16000;

type Pipeline = (input: unknown, options?: Record<string, unknown>) => Promise<unknown>;

/**
 * THE MODELS SHIP WITH THE APP, and are never fetched from Hugging Face.
 *
 * Two reasons, and the second is the one that matters. A student on a phone
 * would wait through three hundred megabytes before the tutor said a word —
 * and a student with no network would never get a voice at all, which is the
 * entire point of putting the models on the device.
 *
 * `content/` is this app's publicDir, so content/models is served from the
 * app's own origin in dev and copied into the APK's assets by `cap sync`.
 * `allowRemoteModels` is FALSE deliberately: with it on, a file missing from
 * the build silently becomes a quarter-gigabyte download over a student's
 * mobile data, and nobody would find out until a bill did.
 */
let configured = false;
async function transformers() {
  const mod = await import('@huggingface/transformers');
  if (!configured) {
    configured = true;
    mod.env.allowLocalModels = true;
    mod.env.allowRemoteModels = false;
    mod.env.localModelPath = '/models/';
    // The WASM backend's own files come from the bundle too, for the same
    // reason: a CDN fetch here is a class that does not start on a train.
    if (mod.env.backends?.onnx?.wasm) mod.env.backends.onnx.wasm.wasmPaths = '/wasm/';
  }
  return mod;
}

/**
 * One load per model per session, shared by every caller.
 *
 * A class asks for the voice from two places at once — the lesson adapter and
 * the doubt agent — and two loads would mean two copies of 263 MB in memory on
 * a phone that has four gigabytes in total.
 */
let ttsLoad: Promise<Pipeline | null> | null = null;
let sttLoad: Promise<Pipeline | null> | null = null;

async function load(task: string, model: string, options: Record<string, unknown> = {}) {
  const { pipeline } = await transformers();
  return (await pipeline(task as never, model, options as never)) as unknown as Pipeline;
}

/**
 * The voice, if the device can have one.
 *
 * Null rather than a throw when it cannot: on-device speech is an improvement
 * on the cloud voice, not a requirement for a class, and a phone that runs out
 * of memory loading it should still get taught.
 */
export function loadOnDeviceVoice(): Promise<Pipeline | null> {
  ttsLoad ??= load('text-to-speech', TTS_MODEL).catch((e) => {
    console.warn('on-device voice unavailable:', (e as Error).message);
    return null;
  });
  return ttsLoad;
}

export function loadOnDeviceEar(): Promise<Pipeline | null> {
  // q8 is real here — encoder 10 MB, merged decoder 31 MB — unlike the TTS.
  sttLoad ??= load('automatic-speech-recognition', STT_MODEL, { dtype: 'q8' }).catch((e) => {
    console.warn('on-device ear unavailable:', (e as Error).message);
    return null;
  });
  return sttLoad;
}

/**
 * The Synthesiser createOnDeviceTts takes.
 *
 * The language tag is not decoration: Supertonic 2 is multilingual and the
 * text is wrapped in one so the model knows which set of sounds to reach for.
 * Everything the tutor says is English, including the Hindi words in it — a
 * student hears "namaste" said by an English speaker, which is what a Delhi
 * classroom sounds like anyway.
 */
export function onDeviceSynth(): Synthesiser {
  return {
    async speak(text: string) {
      const tts = await loadOnDeviceVoice();
      if (!tts) return null;
      const spoken = (await tts(`<en>${text}</en>`, { speaker_embeddings: VOICE })) as {
        audio?: Float32Array;
        sampling_rate?: number;
      };
      if (!spoken?.audio?.length) return null;
      return { samples: spoken.audio, sampleRate: spoken.sampling_rate ?? 24000 };
    },
  };
}

/**
 * Transcribe what the student said, on the phone.
 *
 * NO CALLER, DELIBERATELY, SINCE 2026-09-14. `ear.ts` ran this ahead of the
 * relay and took any non-empty string as the student's answer. The model above
 * is `whisper-tiny.en` — English only — and these students answer in Hinglish.
 * An English-only model given Hindi does not go quiet, it invents fluent
 * English: "Har cell apne aap zinda hai isliye oxygen chahiye" came back as
 * "her celibnate arps in the high-islii oxygen-chehi-ai", and those words went
 * to the judge as the child's answer and to the ledger as the child's own
 * words. A correct answer could be marked wrong for free, offline, with
 * nothing behind it to catch the mistake.
 *
 * Kept rather than deleted because an on-device ear is still the right
 * destination — the student's voice never leaving the phone is worth more than
 * the latency. What it needs before it is wired back in: a MULTILINGUAL model,
 * and a confidence this can return so the caller can refuse rather than guess.
 * `tools/speech` measured the same family at 0.30x realtime and hopeless on
 * Hinglish, so the model is the open question, not the plumbing.
 *
 * Null when the model is not there, which is how the caller told the relay to
 * take over.
 */
export async function hearOnDevice(samples: Float32Array): Promise<string | null> {
  const stt = await loadOnDeviceEar();
  if (!stt) return null;
  const heard = (await stt(samples)) as { text?: string };
  const text = heard?.text?.trim() ?? '';
  return text || null;
}
