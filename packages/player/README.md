# @ai-tutor/player

Playback. Walks a lesson's beats: speak the narration (TTS), hold for `minMs`,
advance. Pure timing logic in a framework-free controller; React gets a thin hook.

## Public API

```ts
// TTS is an ADAPTER — browser speechSynthesis today, cloud TTS later.
interface TtsAdapter {
  speak(text: string): Promise<void>;  // resolves when speech ends
  cancel(): void;                      // must make the pending speak() resolve
}
createBrowserTts(opts?: { lang?: string; rate?: number }): TtsAdapter
// (falls back to a word-count timer when speechSynthesis is unavailable)

estimateSpeechMs(text: string, wpm?: number): number

class PlayerController {
  constructor(lesson: Lesson, opts: { tts: TtsAdapter; minBeatMs?: number })
  readonly state: 'idle' | 'playing' | 'paused' | 'ended'
  readonly beatIndex: number
  play(): void            // from idle: beat 0; from paused: re-speaks current beat
  pause(): void           // cancels speech, holds position
  seek(beatIndex: number): void   // clamps; if playing, restarts from that beat
  stop(): void
  on(event: 'beatchange' | 'statechange', cb: () => void): () => void  // returns unsubscribe
}

usePlayer(lesson: Lesson, tts: TtsAdapter): {
  state; beatIndex; beat; caption;   // caption = current narration text
  play(); pause(); seek(i);
}
```

## Design rules

- The controller never touches the DOM — fully testable with a fake TtsAdapter.
- Advancing = `max(speech end, minMs)`. No hand-authored timings anywhere.
- `pause()` must cancel TTS immediately (a stuck voice is a broken product).

## Depends on

`@ai-tutor/lesson-format`. Peer: `react` (hook only).
