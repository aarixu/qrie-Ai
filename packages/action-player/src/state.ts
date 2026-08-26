import type { Element } from '@ai-tutor/lesson-format';
import { CANVAS_H } from '@ai-tutor/lesson-format';

/**
 * Their whiteboard actions document y in a 0-562 space (see `WbDrawLineAction`
 * in @openmaic/dsl). Our canvas is 0-620. Scaling happens exactly once, here at
 * the boundary, so actions stay authored in their space and the prompt assets
 * shipped in @openmaic/generation keep working unchanged.
 */
export const WB_HEIGHT = 562;
export const WB_SCALE_Y = CANVAS_H / WB_HEIGHT;

/**
 * What the board looks like right now.
 *
 * Deliberately the shape `<Scene>` already takes: a set of elements, which of
 * them are visible, and which are emphasised. The player decides; the renderer
 * reflects. No Three.js, no DOM, no timers — the whole thing is testable in
 * milliseconds, the same split `@ai-tutor/stage`'s `state.ts` already uses.
 */
export interface BoardState {
  /** Every element drawn so far this scene, in draw order. */
  elements: Element[];
  /** Complete set of visible element ids, never a delta. */
  visible: string[];
  /** Emphasised ids; everything else dims, nothing hides. */
  focus: string[];
  /** Whether the whiteboard surface itself is open. */
  whiteboardOpen: boolean;
}

export const initialBoard: BoardState = {
  elements: [],
  visible: [],
  focus: [],
  whiteboardOpen: false,
};
