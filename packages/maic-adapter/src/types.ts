import type { Action } from '@openmaic/dsl';
import type { BeatRange } from './beatOfAction';

/**
 * What the adapter emits: one action stream, plus the map back to the beats
 * that produced it.
 *
 * Both halves travel together. An action stream without its ranges plays
 * forward perfectly and cannot answer "what is this student stuck on" — which
 * is the difference between a video and a measurement.
 */
export interface PlannedScene {
  actions: Action[];
  beatRanges: BeatRange[];
}
