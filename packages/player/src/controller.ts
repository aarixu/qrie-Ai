import type { Lesson } from '@ai-tutor/lesson-format';
import type { TtsAdapter } from './narration';

export type PlayerState = 'idle' | 'playing' | 'paused' | 'ended';
export type PlayerEvent = 'beatchange' | 'statechange';

/**
 * STUB — replaced by the player builder. Contract in packages/player/README.md.
 * Framework-free; never touches the DOM; advancing a beat requires BOTH the
 * narration to finish AND beat.minMs to elapse.
 */
export class PlayerController {
  readonly state: PlayerState = 'idle';
  readonly beatIndex: number = 0;

  constructor(_lesson: Lesson, _opts: { tts: TtsAdapter; minBeatMs?: number }) {
    throw new Error('@ai-tutor/player PlayerController: not implemented yet');
  }

  play(): void {}
  pause(): void {}
  seek(_beatIndex: number): void {}
  stop(): void {}
  on(_event: PlayerEvent, _cb: () => void): () => void {
    return () => {};
  }
}
