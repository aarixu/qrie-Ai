import { describe, expect, it } from 'vitest';
import { initialPlayerState, WB_HEIGHT, WB_SCALE_Y } from '../src/state';

describe('the player starts from a blank board', () => {
  it('has no elements, nothing visible, nothing focused', () => {
    expect(initialPlayerState).toEqual({
      elements: [],
      visible: [],
      focus: [],
      whiteboardOpen: false,
    });
  });

  it('scales their 562-high whiteboard onto our 620-high canvas', () => {
    // Their wb_draw_* actions document y as 0-562. Ours is 0-620.
    expect(WB_HEIGHT).toBe(562);
    expect(WB_SCALE_Y).toBeCloseTo(620 / 562, 10);
    expect(562 * WB_SCALE_Y).toBeCloseTo(620, 6);
  });
});
