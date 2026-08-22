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

  const beat: Beat | null = lesson.beats[beatIndex] ?? null;

  return {
    state,
    beatIndex,
    beat,
    caption: beat?.narration ?? '',
    play: () => controller.play(),
    pause: () => controller.pause(),
    seek: (i: number) => controller.seek(i),
  };
}
