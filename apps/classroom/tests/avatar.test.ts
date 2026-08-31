import { describe, expect, it } from 'vitest';
import { nominalMs, sampleViseme, visemeTimeline } from '../src/avatar/visemes';
import { createBlinker, swayAt } from '../src/avatar/microMotion';
import { mouthShapeOf, scaledAbout } from '../src/avatar/rig';

describe('text becomes mouth shapes', () => {
  it('rounds an O, presses an M, rests at a space', () => {
    const steps = visemeTimeline('mo o');
    expect(steps[0].v).toBe('press'); // m
    expect(steps[1].v).toBe('round'); // o
    expect(steps[2].v).toBe('rest'); // the space
    expect(steps[3].v).toBe('round'); // o again
  });

  it('merges repeated shapes into one gesture', () => {
    const steps = visemeTimeline('bb');
    expect(steps.filter((s) => s.v === 'press')).toHaveLength(1);
  });

  it('samples by real audio time, stretched to the real duration', () => {
    const steps = visemeTimeline('mo');
    const total = nominalMs(steps);
    // Played twice as slow as nominal: halfway through real time is halfway
    // through the shapes.
    expect(sampleViseme(steps, 0, total * 2)).toBe('press');
    expect(sampleViseme(steps, total * 2 - 1, total * 2)).toBe('rest');
    expect(sampleViseme(steps, total * 4, total * 2)).toBe('rest'); // past the end
  });

  it('an empty line never opens the mouth', () => {
    expect(sampleViseme(visemeTimeline(''), 50)).toBe('rest');
  });
});

describe('the idle loop', () => {
  it('blinks on a human clock: open nearly all the time, shut inside a blink', () => {
    const b = createBlinker(() => 0.5); // every gap is 3700 ms
    expect(b.opennessAt(1000)).toBe(1);
    expect(b.opennessAt(3760)).toBeLessThan(0.1); // 60ms into the blink at 3700
    expect(b.opennessAt(3700 + 150)).toBe(1); // over
  });

  it('is pure with respect to time — asking twice agrees', () => {
    const b = createBlinker(() => 0.2);
    const a = b.opennessAt(9000);
    b.opennessAt(20000);
    expect(b.opennessAt(9000)).toBe(a);
  });

  it('sways under two degrees, always', () => {
    for (let t = 0; t < 30000; t += 97) {
      expect(Math.abs(swayAt(t, 1).rotDeg)).toBeLessThan(2);
    }
  });
});

describe('the mouth warp geometry', () => {
  it('rest leaves the strip untouched and the jaw up', () => {
    const m = mouthShapeOf('rest', 1);
    expect(m.open).toBe(0);
    expect(m.stretchX).toBe(1);
  });

  it('louder opens wider for the same shape', () => {
    expect(mouthShapeOf('open', 1).open).toBeGreaterThan(mouthShapeOf('open', 0.1).open);
  });

  it('press stays nearly shut no matter the loudness', () => {
    expect(mouthShapeOf('press', 1).open).toBeLessThan(0.1);
  });

  it('scales a rect about its own centre', () => {
    const r = scaledAbout({ x: 10, y: 10, w: 20, h: 10 }, 2, 0.5);
    expect(r).toEqual({ x: 0, y: 12.5, w: 40, h: 5 });
  });
});
