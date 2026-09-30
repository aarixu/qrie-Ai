// Public surface of @ai-tutor/voice — how the tutor is HEARD.
//
// The layering, and the reason this package exists as one package:
//   recorded audio first  (createRecordedTts)  — the take from the first class
//   live synthesis second (createGeminiTts)    — her voice, made on demand
//   browser speech last   (createBrowserTts, from @ai-tutor/player) — never silence
//
// See README.md for how they compose and for what to change where.

export {
  MIC_SAMPLE_RATE,
  TUTOR_SAMPLE_RATE,
  floatTo16BitPCM,
  pcm16ToFloat32,
  int16ToBase64,
  base64ToInt16,
  micLevelOf,
  downsampleTo16k,
  createPcmChunker,
  nextStartTime,
  createMicCapture,
  createAudioPlayer,
  recordingType,
  RECORDING_TYPES,
  RECORDING_BITS_PER_SECOND,
  type PcmChunker,
  type MicCapture,
  type Recorded,
  type AudioPlayer,
} from './audio';

export { hashNarration, normaliseNarration } from './hash';

export {
  buildSpeechPrompt,
  SPEECH_PREAMBLE,
  TRANSCRIPT_LABEL,
  DEFAULT_SPEAKER_NAME,
  DEFAULT_SPEAKER_DESCRIPTION,
  DEFAULT_ACCENT,
  type SpeechStyle,
} from './speechPrompt';

export {
  parseSampleRate,
  pcmDurationMs,
  type SynthesisRequest,
  type SynthesizedSpeech,
  type SpeechSynthesizer,
  type SpeechStore,
} from './synthesis';

export {
  createGeminiTts,
  createGeminiSynthesizer,
  extractAudio,
  DEFAULT_TUTOR_VOICE,
  DEFAULT_TTS_MODEL,
  type GeminiTtsOptions,
  type GeminiSynthesizerOptions,
  type SpeakingTts,
  type FetchLike,
  type HttpResponse,
  type RetryInfo,
} from './geminiTts';

export {
  createCachedTts,
  createMemorySpeechStore,
  createIndexedDbSpeechStore,
  speechCacheKey,
  type IndexedDbStoreOptions,
} from './cachedTts';

export {
  createRecordedTts,
  createElementFilePlayer,
  parseManifest,
  audioFileName,
  AUDIO_DIR,
  MANIFEST_FILE,
  type NarrationManifest,
  type NarrationEntry,
  type RecordedTtsOptions,
  type FilePlayer,
  type FilePlayback,
  type PlaybackResult,
  type FallthroughReason,
} from './recordedTts';

export {
  createUtteranceQueue,
  defaultSchedule,
  type Utterance,
  type UtteranceQueue,
  type Schedule,
} from './utterance';

export { createStreamingTts, type StreamingTtsOptions, type SpeechElement } from './streamingTts';
export {
  createPcmStreamTts,
  createWebAudioOutput,
  pcmBytesToFloat32,
  type PcmOutput,
  type PcmStreamTtsOptions,
} from './pcmStreamTts';
export { encodeWav, wavUrl } from './wav';
export {
  createOnDeviceTts,
  type OnDeviceTtsOptions,
  type Synthesiser,
} from './onDeviceTts';
export {
  forgetVoiceReport,
  noteSpoken,
  noteTrouble,
  onVoiceReport,
  voiceReport,
  voiceTally,
  type SpokenLine,
  type VoiceSource,
  type VoiceTrouble,
} from './voiceReport';
