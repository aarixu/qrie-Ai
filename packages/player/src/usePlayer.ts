import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Beat, Lesson } from '@ai-tutor/lesson-format';
import type { TtsAdapter } from './narration';
import { PlayerController, type PlayerState } from './controller';

export interface UsePlayerResult {
  state: PlayerState;
  beatIndex: number;
  beat: Beat | null;
  /** Current narration text, for captions. */
  caption: string;
  play(): void;
  pause(): void;
  seek(beatIndex: number): void;
  /** The question the class is holding on, and the hand that answers it. */
  pendingAsk: PlayerController['pendingAsk'];
  answer(index: number): ReturnType<PlayerController['answer']>;
}

/**
 * Thin React binding over PlayerController. All playback logic stays in the
 * controller; this hook only creates it once per lesson and mirrors its state
 * into React.
 */
export function usePlayer(lesson: Lesson, tts: TtsAdapter): UsePlayerResult {
  const controller = useMemo(() => new PlayerController(lesson, { tts }), [lesson, tts]);

  // A replaced (lesson switch) or unmounted controller must fall silent
  // immediately — stop() cancels its TTS and pending timer.
  useEffect(() => () => controller.stop(), [controller]);

  const subscribe = useMemo(
    () => (onChange: () => void) => {
      const offBeat = controller.on('beatchange', onChange);
      const offState = controller.on('statechange', onChange);
      return () => {
        offBeat();
        offState();
      };
    },
    [controller],
  );

  // Primitive snapshots — a fresh object per read would loop useSyncExternalStore.
  // The third argument serves renderToString, where nothing plays yet.
  const state = useSyncExternalStore(
    subscribe,
    () => controller.state,
    () => controller.state,
  );
  const beatIndex = useSyncExternalStore(
    subscribe,
    () => controller.beatIndex,
    () => controller.beatIndex,
  );
  const pendingAsk = useSyncExternalStore(
    subscribe,
    () => controller.pendingAsk,
    () => controller.pendingAsk,
  );

  const beat: Beat | null = lesson.beats[beatIndex] ?? null;

  return {
    state,
    beatIndex,
    beat,
    // The caption shows what she is actually saying, fill included: a student
    // reading along must not see the sentence after the one they can hear.
    caption: beat
      ? [lesson.fill?.find((line) => line.beatId === beat.id)?.say, beat.narration]
          .filter(Boolean)
          .join(' ')
      : '',
    pendingAsk,
    answer: (i: number) => controller.answer(i),
    play: () => controller.play(),
    pause: () => controller.pause(),
    seek: (i: number) => controller.seek(i),
  };
}
