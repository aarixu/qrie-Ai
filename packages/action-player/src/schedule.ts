import { FIRE_AND_FORGET_ACTIONS, type Action } from '@openmaic/dsl';

const FIRE_AND_FORGET: ReadonlySet<string> = new Set(FIRE_AND_FORGET_ACTIONS);

/**
 * Must this action complete before the next one starts?
 *
 * Read off their `FIRE_AND_FORGET_ACTIONS` rather than restated, so a verb they
 * add later gets the right answer here without us noticing.
 */
export function isBlocking(action: Action): boolean {
  return !FIRE_AND_FORGET.has(action.type);
}

/**
 * The first index at or after `from` where playback may be interrupted.
 *
 * A raised hand must not land in the middle of a laser sweep: the pointer would
 * freeze on screen with nothing being said. Pausing on the next BLOCKING action
 * means the board is always in a state the student can look at while the doubt
 * agent takes over. Returns `actions.length` when nothing blocking remains.
 */
export function nextBoundary(actions: Action[], from: number): number {
  for (let i = Math.max(0, from); i < actions.length; i += 1) {
    if (isBlocking(actions[i])) return i;
  }
  return actions.length;
}
