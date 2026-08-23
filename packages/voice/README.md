# @ai-tutor/voice

**How the tutor is heard** — every sound the student gets from her, on both
sides of the seam: the recorded class, the line synthesised on demand, and the
microphone and gapless PCM player the live doubt agent speaks through.

## Why this package exists

The recorded class used to narrate through `window.speechSynthesis` — the
operating system's robot voice — while the live doubt agent had real Gemini
audio and a carefully written 24 kHz player, sitting in `apps/classroom` where
only it could reach them. So a student heard a robot teach the lesson, raised a
hand, and heard a person answer. The seam this product is built to hide was the
most obvious thing in the class.

Everything that makes a sound now lives here, in one layering:

```
createRecordedTts   the take from the first class          ← played if the manifest vouches for it
      ↓ falls through to
createGeminiTts     her voice, synthesised on demand       ← cached, retried
      ↓ falls back to
createBrowserTts    the OS voice, from @ai-tutor/player    ← never silence
```

Each layer is a `TtsAdapter`, so `PlayerController` cannot tell them apart, and
each one **always resolves `speak()`** — the player advances the class on that
promise, so a rejected promise or a hung request would be a class that stops.

## Public API

```ts
// --- speechPrompt.ts : the tutor's voice, as a prompt ---------------------
interface SpeechStyle {
  speakerName?: string        // pass TUTOR.name
  speakerDescription?: string // pass TUTOR.voice
  lessonTitle?: string
  beatTopic?: string
  scene?: string              // replaces the generated scene
  style?: string              // printed as "Style:"
  pacing?: string             // printed as "Pacing:"
  accent?: string             // printed as "Accent:"
}
buildSpeechPrompt(text: string, style?: SpeechStyle): string
const SPEECH_PREAMBLE: string      // "Synthesize speech for the transcript below…"
const TRANSCRIPT_LABEL: string     // "### TRANSCRIPT"
const DEFAULT_SPEAKER_NAME: string
const DEFAULT_SPEAKER_DESCRIPTION: string
const DEFAULT_ACCENT: string

// --- geminiTts.ts : live synthesis ---------------------------------------
interface GeminiSynthesizerOptions {
  apiKey: string
  style?: SpeechStyle
  languageCode?: string | null   // default 'en-IN'; null omits the field
  fetch?: FetchLike
  endpoint?: string
  attempts?: number              // total attempts, default 3
  baseDelayMs?: number           // first backoff step, default 400
  schedule?: Schedule            // injected so tests have no clock
  onRetry?: (info: RetryInfo) => void
}
interface GeminiTtsOptions extends GeminiSynthesizerOptions {
  voice?: string                 // default DEFAULT_TUTOR_VOICE
  model?: string                 // default DEFAULT_TTS_MODEL
  cache?: SpeechStore
  createPlayer?: () => AudioPlayer
  fallback?: TtsAdapter
  onError?: (error: Error) => void
}
createGeminiTts(options: GeminiTtsOptions): SpeakingTts       // TtsAdapter + close()
createGeminiSynthesizer(options: GeminiSynthesizerOptions): SpeechSynthesizer
extractAudio(json: unknown): SynthesizedSpeech
const DEFAULT_TUTOR_VOICE = 'Sulafat'
const DEFAULT_TTS_MODEL = 'gemini-3.1-flash-tts-preview'

// --- cachedTts.ts : synthesise each sentence once -------------------------
createCachedTts(inner: SpeechSynthesizer, store: SpeechStore): SpeechSynthesizer
createMemorySpeechStore(maxEntries?: number): SpeechStore            // default 40, LRU
createIndexedDbSpeechStore(options?: IndexedDbStoreOptions): SpeechStore
speechCacheKey(request: SynthesisRequest): string

// --- recordedTts.ts : THE RECORDING --------------------------------------
interface NarrationEntry   { file: string; durationMs: number; hash: string }
interface NarrationManifest {
  formatVersion: 1
  lessonId: string
  voice: string
  model: string
  beats: Record<string, NarrationEntry>   // hash === hashNarration(beat.narration)
}
interface RecordedTtsOptions {
  manifest: NarrationManifest
  baseUrl: string                  // e.g. "/content/<lesson>/audio"
  fallback: TtsAdapter             // usually createGeminiTts(...)
  filePlayer?: FilePlayer          // injected so tests never touch a media element
  schedule?: Schedule
  onFallthrough?: (info: { text: string; reason: FallthroughReason }) => void
}
type FallthroughReason = 'not-recorded' | 'unsafe-file' | 'playback-failed'
createRecordedTts(options: RecordedTtsOptions): TtsAdapter
createElementFilePlayer(schedule?: Schedule): FilePlayer
parseManifest(json: unknown): NarrationManifest | null   // null for anything we did not write
audioFileName(beatId: string): string
const AUDIO_DIR = 'audio'
const MANIFEST_FILE = 'narration.json'

// --- hash.ts : the contract between recorder and player --------------------
hashNarration(text: string): string        // 16 hex chars, whitespace-insensitive
normaliseNarration(text: string): string

// --- synthesis.ts : the boundary the cache sits on -------------------------
interface SynthesisRequest   { text: string; voice: string; model: string }
interface SynthesizedSpeech  { base64: string; mimeType: string }
interface SpeechSynthesizer  { synthesize(r: SynthesisRequest): Promise<SynthesizedSpeech> }
interface SpeechStore {
  get(key: string): Promise<SynthesizedSpeech | undefined>   // never throws
  set(key: string, value: SynthesizedSpeech): Promise<void>  // best effort
}
parseSampleRate(mimeType: string): number | null
pcmDurationMs(base64: string, sampleRate: number): number

// --- audio.ts : browser plumbing (moved here from apps/classroom) ---------
const MIC_SAMPLE_RATE = 16000    // what the Live API wants from the mic
const TUTOR_SAMPLE_RATE = 24000  // what it sends back as her voice
floatTo16BitPCM(input: Float32Array): Int16Array
pcm16ToFloat32(input: Int16Array): Float32Array<ArrayBuffer>
int16ToBase64(pcm: Int16Array): string
base64ToInt16(b64: string): Int16Array
micLevelOf(pcm: Int16Array): number
downsampleTo16k(input: Float32Array, inputRate: number): Float32Array
createPcmChunker(samplesPerChunk: number, onChunk: (c: Int16Array) => void): PcmChunker
nextStartTime(currentTime: number, queuedUntil: number, leadSec: number): number
createMicCapture(onChunk: (pcm16: Int16Array) => void, chunkMs?: number): MicCapture
createAudioPlayer(): AudioPlayer

// --- utterance.ts : the TtsAdapter contract, once --------------------------
createUtteranceQueue(): UtteranceQueue
type Schedule = (fn: () => void, ms: number) => () => void   // returns cancel
const defaultSchedule: Schedule
```

## Using it

The whole voice of a lesson, wired once:

```ts
import { createBrowserTts } from '@ai-tutor/player';
import {
  createGeminiTts,
  createIndexedDbSpeechStore,
  createRecordedTts,
  parseManifest,
} from '@ai-tutor/voice';

// Live synthesis, cached across sessions, with the OS voice as the last resort.
const live = createGeminiTts({
  apiKey: import.meta.env.VITE_GEMINI_API_KEY,
  style: { lessonTitle: lesson.title },
  cache: createIndexedDbSpeechStore(),
  fallback: createBrowserTts(),
  onError: (error) => console.warn('[voice]', error.message),
});

// The recording in front of it, when this lesson has one.
const manifest = parseManifest(await (await fetch(`${audioUrl}/narration.json`)).json());
const tts = manifest ? createRecordedTts({ manifest, baseUrl: audioUrl, fallback: live }) : live;

const player = new PlayerController(lesson, { tts });
```

Nothing above decides anything: which layer speaks a given line is decided
inside the package, from the manifest and from what the API returns.

## The rules worth knowing

- **A failed voice is never a stopped class.** Every path out of every adapter
  resolves `speak()` — a 500, a dead socket, a blocked prompt, a missing file, a
  cancelled utterance. `PlayerController` waits on that promise, so the one
  unforgivable bug here is a promise that never settles.
- **The hash is what makes a recording safe to trust.** A take is played only
  when `hashNarration(text)` equals the hash written at render time. Edit a
  narration line without re-rendering and the beat quietly falls through to live
  synthesis rather than speaking the old words. That check is why the manifest
  keys on words, not on beat ids.
- **The prompt preamble is a correctness issue, not polish.** Google documents
  that a vague prompt makes the model either reject the request or *read the
  director's notes aloud*, and prescribes exactly two mitigations: an explicit
  preamble and an explicit `### TRANSCRIPT` label. Short narration lines are
  precisely the vague prompts that trip it. Never build the text part by hand —
  call `buildSpeechPrompt`.
- **Random 500s are expected.** The model "occasionally returns text tokens
  instead of audio tokens" and the server fails the request. Those, 429s and
  dead sockets are retried with backoff, three attempts total; anything else
  fails immediately, because a rejected prompt gets the same verdict next time.
- **The same voice on both sides.** `DEFAULT_TUTOR_VOICE` is the voice the live
  doubt agent must also use. If the two ever drift, the handoff becomes audible
  and the product's central claim dies with it.
- **The cache key is text + voice + model.** Nothing else is an input to a take,
  and each of those three makes it a different take.
- **Storage degrades, it does not fail.** The IndexedDB store answers "not
  cached" for a private window, a blocked context or a full quota. A cache that
  can break a class is worse than no cache.
- **Injected clock, injected player, injected fetch.** Every test in this
  package runs without Web Audio, without a network and without a timer.

## For the developer: what to change, and where

| You want to… | Change | Why it lives there |
|---|---|---|
| change how she sounds — warmth, pace, accent | the `DEFAULT_*` constants in `src/speechPrompt.ts` | The whole style surface is prose in the prompt; there is no style parameter on the API |
| use a different voice | `DEFAULT_TUTOR_VOICE` in `src/geminiTts.ts` | One constant, used by the recorder and the player. Change it and re-render, or the recording and the live line disagree |
| move to a newer TTS model | `DEFAULT_TTS_MODEL` in `src/geminiTts.ts` | Model id is part of the cache key and the manifest, so old takes are re-rendered rather than mixed in |
| retry harder or give up sooner | `DEFAULT_ATTEMPTS` / `DEFAULT_BASE_DELAY_MS` in `src/geminiTts.ts` | The whole budget a student waits through before the fallback speaks |
| stop the class advancing over the last syllable | `PLAYBACK_LEAD_MS` in `src/geminiTts.ts` | It mirrors `SCHEDULE_LEAD_SEC` in `src/audio.ts`, which is how far ahead the player schedules a buffer |
| cache more or less audio in a tab | `createMemorySpeechStore(maxEntries)` | Bounded by entries, not bytes: the bound exists to stop unbounded growth, not to be precise |
| change where recorded audio is looked up | `baseUrl` passed to `createRecordedTts` | The adapter joins `baseUrl` and `entry.file`; nothing else builds that URL |
| add a field to the manifest | `NarrationEntry` / `NarrationManifest` + `parseManifest` in `src/recordedTts.ts` | `tools/record-class` imports these types; the compiler then makes the recorder agree |
| change what counts as "the same words" | `normaliseNarration` in `src/hash.ts` | Recorder and player must compute one hash. Changing it re-renders every lesson, by design |
| play recorded audio some other way | pass a `filePlayer` to `createRecordedTts` | `createElementFilePlayer` is one implementation of `FilePlayer`, not a requirement |
| know which beats fell through to live synthesis | `onFallthrough` on `createRecordedTts` | That list is the render to-do for the next `tools/record-class` run |

## Depends on

`@ai-tutor/player`, for the `TtsAdapter` interface alone — this package supplies
that interface's implementations, so the dependency points at the contract, not
at the player.

**It should also depend on `@ai-tutor/persona`** and does not yet:
`DEFAULT_TUTOR_VOICE`, `DEFAULT_SPEAKER_NAME` and `DEFAULT_SPEAKER_DESCRIPTION`
are the tutor described a second time, which is exactly what `@ai-tutor/persona`
exists to prevent. When `TUTOR.speechVoice` lands, delete those three constants
and import her. Until then, callers that already import the persona should pass
`style.speakerName` / `style.speakerDescription` so nothing drifts.

`tools/record-class` writes what `src/recordedTts.ts` reads. It currently
carries its own copies of `NarrationManifest` and `hashNarration`; those should
become re-exports from here, and its `speechPrompt.ts` a re-export of
`buildSpeechPrompt`. Two implementations of a hash function is a bug with a
delay fuse; two prompt builders is two tutors.

## Tests

`npx vitest run packages/voice` — prompt shape, retry and give-up behaviour,
cancellation, cache hits and misses, storage degradation, hash stability, the
manifest gate, and the PCM conversions. No network, no clock, no Web Audio.
