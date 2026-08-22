import type { Beat, Lesson } from '@ai-tutor/lesson-format';
import type { TtsAdapter } from './narration';
import type { PlayerState } from './controller';

export interface UsePlayerResult {
  state: PlayerState;
  beatIndex: number;
  beat: Beat | null;
  /** Current narration text, for captions. */
  caption: string;
  play(): void;
  pause(): void;
  seek(beatIndex: number): void;
}

/**
 * STUB — replaced by the player builder. Thin React binding over
 * PlayerController; all logic stays in the controller.
 */
export function usePlayer(_lesson: Lesson, _tts: TtsAdapter): UsePlayerResult {
  throw new Error('@ai-tutor/player usePlayer: not implemented yet');
}
