import { describe, expect, it } from 'vitest';
import { layoutScene, type PlaceStep } from '../src/scene';

// Scratch reproduction of the reviewer claim: five 40-char-labelled places in
// the standard MAIN band (x=70, w=860) — do graphics land past the canvas edge?
describe('scratch: width-fit with min-size labels', () => {
  it('keeps every graphic inside the band', () => {
    const label = 'reaction force: boat pushes foot forward'; // 40 chars
    const places: PlaceStep[] = ['a', 'b', 'c', 'd', 'e'].map((id) => ({
      do: 'place',
      id,
      noun: 'person',
      label,
    })) as PlaceStep[];

    const band = { x: 70, y: 150, w: 860, h: 330 };
    const { elements } = layoutScene(places, band);

    for (const el of elements) {
      // eslint-disable-next-line no-console
      console.log(el.id, 'x=', (el as any).x.toFixed(1), 'w=', (el as any).w.toFixed(1), 'right=', ((el as any).x + (el as any).w).toFixed(1));
    }

    const rights = elements.map((el: any) => el.x + el.w);
    const maxRight = Math.max(...rights);
    console.log('band right edge =', band.x + band.w, '; canvas w = 1000; max element right =', maxRight.toFixed(1));

    expect(maxRight).toBeLessThanOrEqual(1000);
  });
});
