import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '@openmaic/dsl';
import type { TtsAdapter } from '@ai-tutor/player';
import { ActionController } from '../src/controller';

/**
 * A TTS adapter we drive by hand: `speak()` never resolves until the test says
 * so. That is what lets a test assert "the board has not advanced while the
 * tutor is still talking" without leaning on wall-clock timing.
 */
function fakeTts() {
  let resolve: (() => void) | null = null;
  const spoken: string[] = [];
  let cancels = 0;
  const adapter: TtsAdapter = {
    speak(text: string) {
      spoken.push(text);
      return new Promise<void>((r) => {
        resolve = r;
      });
    },
    cancel() {
      cancels += 1;
      resolve?.();
      resolve = null;
    },
  };
  return {
    adapter,
    spoken,
    get cancels() {
      return cancels;
    },
    finishSpeech() {
      const r = resolve;
      resolve = null;
      r?.();
    },
  };
}

const script: Action[] = [
  { id: 'a0', type: 'speech', text: 'Every cell has a power plant.' },
  { id: 'a1', type: 'wb_draw_text', elementId: 'e1', content: 'Mitochondrion', x: 100, y: 100 },
  { id: 'a2', type: 'spotlight', elementId: 'e1' },
  { id: 'a3', type: 'speech', text: 'This is where ATP is made.' },
];

let tts: ReturnType<typeof fakeTts>;
const make = (actions = script, drawMs = 300) =>
  new ActionController(actions, { tts: tts.adapter, drawMs });

/**
 * Let everything armed at the current instant actually run.
 *
 * One millisecond, not zero: a fire-and-forget action arms a `setTimeout(…, 0)`,
 * and `advanceTimersByTimeAsync(0)` does not fire a timer that is due at the
 * current instant. Awaiting also flushes the promise microtasks from a resolved
 * `speak()`, so the timer the next action arms exists before we step over it.
 */
const settle = () => vi.advanceTimersByTimeAsync(1);

beforeEach(() => {
  vi.useFakeTimers();
  tts = fakeTts();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the controller walks the stream', () => {
  it('starts idle on a blank board', () => {
    const c = make();
    expect(c.state).toBe('idle');
    expect(c.index).toBe(0);
    expect(c.board.elements).toEqual([]);
  });

  it('speaks the first action on play, and waits for it', async () => {
    const c = make();
    c.play();
    expect(c.state).toBe('playing');
    expect(tts.spoken).toEqual(['Every cell has a power plant.']);

    // Still on action 0 — speech has not finished, so nothing has been drawn.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(c.index).toBe(0);
    expect(c.board.elements).toEqual([]);
  });

  it('draws once the speech ends, and holds the ink for drawMs', async () => {
    const c = make();
    c.play();
    tts.finishSpeech();
    await vi.advanceTimersByTimeAsync(0);

    expect(c.index).toBe(1);
    expect(c.board.elements.map((e) => e.id)).toEqual(['e1']);

    // The draw is blocking: the next action must not start before drawMs.
    await vi.advanceTimersByTimeAsync(299);
    expect(c.index).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(c.index).toBeGreaterThan(1);
  });

  it('does not wait on a spotlight — pointing happens while the lesson moves on', async () => {
    const c = make();
    c.play();
    tts.finishSpeech();
    await settle();
    await vi.advanceTimersByTimeAsync(300); // through the draw and the spotlight
    await settle();

    // Action 2 is the spotlight. It is fire-and-forget, so we are already
    // speaking action 3 with the focus applied.
    expect(c.board.focus).toEqual(['e1']);
    expect(tts.spoken).toEqual(['Every cell has a power plant.', 'This is where ATP is made.']);
  });

  it('ends after the last action', async () => {
    const c = make();
    c.play();
    tts.finishSpeech();
    await settle();
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    tts.finishSpeech(); // the second speech
    await settle();
    expect(c.state).toBe('ended');
  });

  it('ends immediately on an empty stream rather than hanging', () => {
    const c = make([]);
    c.play();
    expect(c.state).toBe('ended');
  });
});

describe('the caption follows the voice', () => {
  it('reports the text currently being spoken', async () => {
    const c = make();
    expect(c.caption).toBe('');
    c.play();
    expect(c.caption).toBe('Every cell has a power plant.');

    tts.finishSpeech();
    await settle();
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(c.caption).toBe('This is where ATP is made.');
  });
});

describe('pause cancels the voice immediately', () => {
  it('stops speaking and holds position', () => {
    const c = make();
    c.play();
    c.pause();
    expect(c.state).toBe('paused');
    expect(tts.cancels).toBe(1);
  });

  it('does not advance after a pause, even when the cancelled speech resolves', async () => {
    const c = make();
    c.play();
    c.pause();
    await vi.advanceTimersByTimeAsync(10_000);
    // cancel() resolves the pending speak(); the generation guard must swallow it.
    expect(c.index).toBe(0);
    expect(c.board.elements).toEqual([]);
  });

  it('re-speaks the current action on resume', () => {
    const c = make();
    c.play();
    c.pause();
    c.play();
    expect(tts.spoken).toEqual([
      'Every cell has a power plant.',
      'Every cell has a power plant.',
    ]);
  });
});

describe('seek replays the board from the start', () => {
  it('rebuilds the board so a sought position is never half-drawn', () => {
    const c = make();
    c.seek(2);
    expect(c.index).toBe(2);
    // Replayed 0..2, so the text is on the board even though we never played it.
    expect(c.board.elements.map((e) => e.id)).toEqual(['e1']);
  });

  it('clamps out-of-range and ignores garbage', () => {
    const c = make();
    c.seek(99);
    expect(c.index).toBe(script.length - 1);
    c.seek(-4);
    expect(c.index).toBe(0);
    c.seek(Number.NaN);
    expect(c.index).toBe(0);
  });
});

describe('listeners', () => {
  it('notifies on change and can be unsubscribed', () => {
    const c = make();
    let changes = 0;
    const off = c.on('change', () => {
      changes += 1;
    });
    c.seek(1);
    expect(changes).toBe(1);
    off();
    c.seek(2);
    expect(changes).toBe(1);
  });
});
