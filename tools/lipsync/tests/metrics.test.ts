import { describe, expect, it } from 'vitest';
import type { MouthCue } from '../lib/format.d.mts';
import { clipMetrics, disagreement, sampleTimeline } from '../lib/metrics.mjs';

/**
 * WHAT THIS HARNESS IS ALLOWED TO REPORT.
 *
 * There is no hand-labelled ground truth for these clips. Nobody has sat with
 * a waveform and written down which mouth shape is correct at t=3.480. So
 * there is no accuracy number available here, and any number presented as one
 * would be invented.
 *
 * What IS observable: how many cues each recogniser emitted, how long they
 * are on average, how much of the clip the mouth spends shut, and how often
 * the two recognisers disagree frame by frame. Those are facts about the
 * output. They tell you whether two pipelines behave alike; they cannot tell
 * you which one is right. The report says exactly that, in those words.
 */
describe('sampleTimeline', () => {
  it('reports the shape in force at each sample instant', () => {
    const cues: MouthCue[] = [
      { t: 0, d: 0.5, v: 'A' },
      { t: 0.5, d: 0.5, v: 'B' },
    ];
    expect(sampleTimeline(cues, { rateHz: 10, duration: 1 })).toEqual([
      'A',
      'A',
      'A',
      'A',
      'A',
      'B',
      'B',
      'B',
      'B',
      'B',
    ]);
  });

  it('reports the idle shape where the timeline says nothing', () => {
    expect(sampleTimeline([], { rateHz: 4, duration: 1 })).toEqual(['X', 'X', 'X', 'X']);
  });
});

describe('disagreement', () => {
  it('is zero when the two timelines are identical', () => {
    const cues: MouthCue[] = [{ t: 0, d: 1, v: 'C' }];
    expect(disagreement(cues, cues, { rateHz: 100, duration: 1 }).frameDisagreement).toBe(0);
  });

  it('is one when they never once agree', () => {
    const a: MouthCue[] = [{ t: 0, d: 1, v: 'C' }];
    const b: MouthCue[] = [{ t: 0, d: 1, v: 'F' }];
    expect(disagreement(a, b, { rateHz: 100, duration: 1 }).frameDisagreement).toBe(1);
  });

  it('separates a shape mismatch from an open/shut mismatch', () => {
    // C and D are both open mouths. Picking the wrong open shape is a
    // different, much smaller mistake than showing a shut mouth while the
    // tutor is mid-vowel — the second is the one a child notices.
    const a: MouthCue[] = [{ t: 0, d: 1, v: 'C' }];
    const b: MouthCue[] = [{ t: 0, d: 1, v: 'D' }];
    const d = disagreement(a, b, { rateHz: 100, duration: 1 });
    expect(d.frameDisagreement).toBe(1);
    expect(d.openShutDisagreement).toBe(0);
  });

  it('counts a shut mouth against an open one', () => {
    const a: MouthCue[] = [{ t: 0, d: 1, v: 'A' }];
    const b: MouthCue[] = [{ t: 0, d: 1, v: 'D' }];
    expect(disagreement(a, b, { rateHz: 100, duration: 1 }).openShutDisagreement).toBe(1);
  });
});

describe('clipMetrics', () => {
  it('counts cues and means their duration', () => {
    const m = clipMetrics(
      [
        { t: 0, d: 0.2, v: 'A' },
        { t: 0.2, d: 0.4, v: 'D' },
      ],
      0.6,
    );
    expect(m.cueCount).toBe(2);
    expect(m.meanDurationMs).toBeCloseTo(300, 6);
  });

  it('measures the fraction of the clip the mouth is shut', () => {
    // A and X are the two shut shapes. Near 1 and the tutor is barely moving;
    // near 0 and the tutor never closes, which on a language full of
    // bilabials is its own kind of wrong.
    const m = clipMetrics(
      [
        { t: 0, d: 0.5, v: 'A' },
        { t: 0.5, d: 0.5, v: 'D' },
      ],
      1,
    );
    expect(m.shutFraction).toBeCloseTo(0.5, 6);
  });

  it('counts time not covered by any cue as shut', () => {
    expect(clipMetrics([{ t: 0, d: 0.5, v: 'D' }], 1).shutFraction).toBeCloseTo(0.5, 6);
  });

  it('reports bytes per minute so the 2 KB claim can be checked rather than quoted', () => {
    expect(clipMetrics([{ t: 0, d: 1, v: 'D' }], 1).bytesPerMinute).toBeGreaterThan(0);
  });
});

describe('the size the student actually downloads', () => {
  it('reports gzipped bytes as well as raw', () => {
    // avatar-3.md:208 estimates "roughly 2 KB per minute" for this format.
    // That is a claim about bytes on a wire, and every byte on this wire is
    // gzipped, so the raw figure alone cannot confirm or refute it. Both are
    // measured; the report quotes both and says which one the estimate missed.
    const nine: MouthCue['v'][] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X'];
    const cues: MouthCue[] = Array.from({ length: 200 }, (_, i) => ({ t: i * 0.1, d: 0.1, v: nine[i % 9] }));
    const m = clipMetrics(cues, 20);
    expect(m.gzipBytes).toBeGreaterThan(0);
    expect(m.gzipBytes).toBeLessThan(m.bytes);
    expect(m.gzipBytesPerMinute).toBeCloseTo((m.gzipBytes / 20) * 60, 6);
  });
});
