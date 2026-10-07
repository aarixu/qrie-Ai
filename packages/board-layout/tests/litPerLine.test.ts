import { describe, expect, it } from 'vitest';
import { layoutBeat } from '../src/layout';
import type { Instruction } from '../src/types';

/**
 * A PART IS LIT ON THE LINE THAT NAMES IT (human heart, 2026-10-07).
 *
 * Every `point` of a beat was collected and lit together on its last line, so
 * the double-circulation diagram had five parts lit at once at the end and none
 * while each was being explained. On a composed board each line lights what it
 * points at; a stacked board keeps the old behaviour.
 */

const BOARD: Instruction[] = [
  { do: 'say', text: 'This is the heart.' },
  { do: 'diagram', ref: 'heart' },
  { do: 'say', text: 'The left ventricle pumps blood to the body.' },
  { do: 'point', ref: 'heart', part: 'left_ventricle' },
  { do: 'say', text: 'The right ventricle pumps it to the lungs.' },
  { do: 'point', ref: 'heart', part: 'right_ventricle' },
  { do: 'say', text: 'So the heart is two pumps side by side.' },
];
const lay = (composed: boolean) =>
  layoutBeat({ id: 'b1', topic: 't', narration: '', board: BOARD }, new Map(), new Map(), { composed });

describe('a part lit while it is talked about', () => {
  it('lights each part on its own line on a composed board', () => {
    const steps = lay(true).steps;
    expect(steps.map((s) => s.focus)).toEqual([[], ['heart#left_ventricle'], ['heart#right_ventricle'], []]);
  });

  it('lights them all on the last line on a stacked board, as before', () => {
    const steps = lay(false).steps;
    expect(steps[steps.length - 1].focus).toEqual(['heart#left_ventricle', 'heart#right_ventricle']);
  });
});
