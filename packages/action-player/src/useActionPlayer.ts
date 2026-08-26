import { useEffect, useMemo, useRef, useState } from 'react';
import type { Action } from '@openmaic/dsl';
import type { TtsAdapter } from '@ai-tutor/player';
import { ActionController, type PlaybackState } from './controller';
import type { BoardState } from './state';

export interface ActionPlayerHandle {
  state: PlaybackState;
  index: number;
  board: BoardState;
  /** The line being spoken right now. */
  caption: string;
  /** How many actions there are, for progress. */
  total: number;
  play: () => void;
  pause: () => void;
  seek: (index: number) => void;
}

/**
 * React binding for `ActionController`.
 *
 * Thin on purpose: every rule about playback lives in the controller, which has
 * no React in it and tests with fake timers. This only subscribes and re-renders
 * — the same split `@ai-tutor/player`'s `usePlayer` uses.
 */
export function useActionPlayer(actions: Action[], tts: TtsAdapter): ActionPlayerHandle {
  const controller = useMemo(() => new ActionController(actions, { tts }), [actions, tts]);
  const [, bump] = useState(0);
  const ref = useRef(controller);
  ref.current = controller;

  useEffect(() => {
    const rerender = () => bump((n) => n + 1);
    const offChange = controller.on('change', rerender);
    const offState = controller.on('statechange', rerender);
    return () => {
      // Unsubscribe BEFORE pausing: pause() emits a statechange, and a
      // re-render scheduled from an unmounting component is a React warning.
      offChange();
      offState();
      // Leaving the screen must silence the tutor. Without this, navigating
      // away mid-lesson leaves a voice talking over the next screen.
      controller.pause();
    };
  }, [controller]);

  return {
    state: controller.state,
    index: controller.index,
    board: controller.board,
    caption: controller.caption,
    total: actions.length,
    play: () => ref.current.play(),
    pause: () => ref.current.pause(),
    seek: (i: number) => ref.current.seek(i),
  };
}
