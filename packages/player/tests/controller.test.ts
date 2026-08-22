import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { validateLesson } from '@ai-tutor/lesson-format';
import type { Lesson } from '@ai-tutor/lesson-format';
import { PlayerController } from '../src/controller';
import type { TtsAdapter } from '../src/narration';

// Vitest runs from the repo root; the fixture is the committed dev lesson.
const fixturePath = path.resolve(process.cwd(), 'content/class10-heart-mini/lesson.json');

function loadFixture(): Lesson {
  const r = validateLesson(JSON.parse(fs.readFileSync(fixturePath, 'utf8')));
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.lesson;
}

/** Three-beat lesson small enough to reason about in every test. */
function miniLesson(firstBeatMinMs?: number): Lesson {
  return {
    formatVersion: 1,
    id: 'mini',
    title: 'Mini',
    language: 'en',
    canvas: { w: 1000, h: 620 },
    elements: [{ kind: 'title', id: 'e1', x: 0, y: 0, text: 'T' }],
    beats: [
      {
        id: 'b0',
        topic: 'zero',
        narration: 'beat zero',
        show: ['e1'],
        ...(firstBeatMinMs !== undefined ? { minMs: firstBeatMinMs } : {}),
      },
      { id: 'b1', topic: 'one', narration: 'beat one', show: ['e1'] },
      { id: 'b2', topic: 'two', narration: 'beat two', show: ['e1'] },
    ],
  };
}

// The controller advances inside promise callbacks; give those room to run.
// (Fake timers do not fake microtasks, so plain awaits are enough.)
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

/**
 * A TtsAdapter with manually-resolvable speech. By default cancel() resolves
 * the pending speak() — the contract every real adapter must honour. Pass
 * resolveOnCancel:false to simulate a sloppy adapter whose old promise
 * resolves LATE, which is exactly the stale-async case the generation counter
 * exists for.
 */
function makeFakeTts(opts: { resolveOnCancel?: boolean } = {}) {
  const resolveOnCancel = opts.resolveOnCancel ?? true;
  const spoken: string[] = [];
  let queue: Array<() => void> = [];
  const fake = {
    spoken,
    cancels: 0,
    adapter: {
      speak(text: string): Promise<void> {
        spoken.push(text);
        return new Promise<void>((res) => queue.push(res));
      },
      cancel(): void {
        fake.cancels += 1;
        if (resolveOnCancel) {
          const pending = queue;
          queue = [];
          for (const res of pending) res();
        }
      },
    } satisfies TtsAdapter,
    /** Resolve the oldest unresolved speak() and let the controller react. */
    async finishSpeech(): Promise<void> {
      const res = queue.shift();
      res?.();
      await flush();
    },
  };
  return fake;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PlayerController — full run', () => {
  it('plays the fixture lesson end to end, one beatchange per beat', async () => {
    const lesson = loadFixture();
    const tts = makeFakeTts();
    const c = new PlayerController(lesson, { tts: tts.adapter });

    const beatsSeen: number[] = [];
    c.on('beatchange', () => beatsSeen.push(c.beatIndex));
    const statesSeen: string[] = [];
    c.on('statechange', () => statesSeen.push(c.state));

    c.play();
    for (let i = 0; i < lesson.beats.length; i++) {
      expect(c.beatIndex).toBe(i);
      expect(tts.spoken[i]).toBe(lesson.beats[i].narration);
      await tts.finishSpeech();
      const minMs = lesson.beats[i].minMs ?? 0;
      if (minMs > 0) {
        // Speech is done but the minMs floor is not — the beat must hold.
        expect(c.beatIndex).toBe(i);
        vi.advanceTimersByTime(minMs);
        await flush();
      }
    }

    expect(c.state).toBe('ended');
    expect(beatsSeen).toEqual(lesson.beats.map((_, i) => i));
    expect(statesSeen).toEqual(['playing', 'ended']);
  });
});

describe('PlayerController — advancing gates', () => {
  it('holds the beat until minMs elapses even after speech ends', async () => {
    const tts = makeFakeTts();
    const c = new PlayerController(miniLesson(1000), { tts: tts.adapter });

    c.play();
    await tts.finishSpeech();
    expect(c.beatIndex).toBe(0);

    vi.advanceTimersByTime(999);
    await flush();
    expect(c.beatIndex).toBe(0);

    vi.advanceTimersByTime(1);
    await flush();
    expect(c.beatIndex).toBe(1);
  });

  it('holds the beat until speech ends even after minMs elapses', async () => {
    const tts = makeFakeTts();
    const c = new PlayerController(miniLesson(1000), { tts: tts.adapter });

    c.play();
    vi.advanceTimersByTime(5000);
    await flush();
    expect(c.beatIndex).toBe(0);

    await tts.finishSpeech();
    expect(c.beatIndex).toBe(1);
  });

  it('falls back to opts.minBeatMs when the beat has no minMs', async () => {
    const tts = makeFakeTts();
    const c = new PlayerController(miniLesson(), { tts: tts.adapter, minBeatMs: 500 });

    c.play();
    await tts.finishSpeech();
    expect(c.beatIndex).toBe(0);

    vi.advanceTimersByTime(500);
    await flush();
    expect(c.beatIndex).toBe(1);
  });
});

describe('PlayerController — pause and resume', () => {
  it('pause cancels pending speech immediately and holds the beat', async () => {
    const tts = makeFakeTts();
    const c = new PlayerController(miniLesson(), { tts: tts.adapter });

    c.play();
    await tts.finishSpeech(); // now on beat 1, speaking
    c.pause();

    expect(tts.cancels).toBe(1);
    expect(c.state).toBe('paused');
    expect(c.beatIndex).toBe(1);

    // The cancel-resolved speak() must not advance the paused player.
    await flush();
    expect(c.beatIndex).toBe(1);
    expect(c.state).toBe('paused');
  });

  it('play after pause re-speaks the current beat from its start', async () => {
    const tts = makeFakeTts();
    const c = new PlayerController(miniLesson(), { tts: tts.adapter });

    c.play();
    await tts.finishSpeech();
    c.pause();
    c.play();

    expect(c.state).toBe('playing');
    expect(c.beatIndex).toBe(1);
    expect(tts.spoken).toEqual(['beat zero', 'beat one', 'beat one']);
  });

  it('pause when not playing is a no-op', () => {
    const tts = makeFakeTts();
    const c = new PlayerController(miniLesson(), { tts: tts.adapter });
    c.pause();
    expect(c.state).toBe('idle');
    expect(tts.cancels).toBe(0);
  });

  it('play while already playing does not restart the beat', () => {
    const tts = makeFakeTts();
    const c = new PlayerController(miniLesson(), { tts: tts.adapter });
    c.play();
    c.play();
    expect(tts.spoken).toEqual(['beat zero']);
  });
});

describe('PlayerController — seek', () => {
  it('clamps below 0 and above the last beat', () => {
    const tts = makeFakeTts();
    const c = new PlayerController(miniLesson(), { tts: tts.adapter });

    c.seek(-5);
    expect(c.beatIndex).toBe(0);
    c.seek(99);
    expect(c.beatIndex).toBe(2);
    expect(c.state).toBe('idle');
    expect(tts.spoken).toEqual([]); // idle seek moves position only
  });

  it('ignores a non-finite index', () => {
    const tts = makeFakeTts();
    const c = new PlayerController(miniLesson(), { tts: tts.adapter });
    c.seek(Number.NaN);
    expect(c.beatIndex).toBe(0);
  });

  it('while paused, moves the position without speaking', async () => {
    const tts = makeFakeTts();
    const c = new PlayerController(miniLesson(), { tts: tts.adapter });

    c.play();
    c.pause();
    c.seek(2);
    expect(c.beatIndex).toBe(2);
    expect(tts.spoken).toEqual(['beat zero']);

    c.play(); // resuming speaks the sought beat
    expect(tts.spoken).toEqual(['beat zero', 'beat two']);
  });

  it('while playing, cancels current speech and restarts from the target', () => {
    const tts = makeFakeTts();
    const c = new PlayerController(miniLesson(), { tts: tts.adapter });

    c.play();
    c.seek(2);

    expect(tts.cancels).toBe(1);
    expect(c.beatIndex).toBe(2);
    expect(c.state).toBe('playing');
    expect(tts.spoken).toEqual(['beat zero', 'beat two']);
  });

  it('a stale speak() resolving after a seek does not double-advance', async () => {
    // Sloppy adapter: cancel() does NOT resolve the old promise, so it can
    // resolve late on its own — the generation counter must absorb it.
    const tts = makeFakeTts({ resolveOnCancel: false });
    const c = new PlayerController(miniLesson(), { tts: tts.adapter });

    c.play(); // beat 0 speaking
    c.seek(2); // beat 2 speaking; beat 0's promise still pending

    await tts.finishSpeech(); // resolves beat 0's STALE speak
    expect(c.beatIndex).toBe(2); // not bumped by the stale resolution

    await tts.finishSpeech(); // resolves beat 2's speak — the live one
    expect(c.state).toBe('ended');
    expect(c.beatIndex).toBe(2);
  });
});

describe('PlayerController — stop and replay', () => {
  it('stop cancels speech and returns to idle at beat 0', async () => {
    const tts = makeFakeTts();
    const c = new PlayerController(miniLesson(), { tts: tts.adapter });

    c.play();
    await tts.finishSpeech();
    c.stop();

    expect(tts.cancels).toBe(1);
    expect(c.state).toBe('idle');
    expect(c.beatIndex).toBe(0);
  });

  it('play from ended restarts at beat 0', async () => {
    const tts = makeFakeTts();
    const c = new PlayerController(miniLesson(), { tts: tts.adapter });

    c.play();
    await tts.finishSpeech();
    await tts.finishSpeech();
    await tts.finishSpeech();
    expect(c.state).toBe('ended');

    c.play();
    expect(c.state).toBe('playing');
    expect(c.beatIndex).toBe(0);
    expect(tts.spoken.at(-1)).toBe('beat zero');
  });
});

describe('PlayerController — events', () => {
  it('emits after internal state is consistent', () => {
    const tts = makeFakeTts();
    const c = new PlayerController(miniLesson(), { tts: tts.adapter });

    const observed: Array<[string, number]> = [];
    c.on('statechange', () => observed.push([c.state, c.beatIndex]));

    c.play();
    c.pause();
    expect(observed).toEqual([
      ['playing', 0],
      ['paused', 0],
    ]);
  });

  it('unsubscribe stops further notifications', async () => {
    const tts = makeFakeTts();
    const c = new PlayerController(miniLesson(), { tts: tts.adapter });

    const cb = vi.fn();
    const off = c.on('beatchange', cb);
    c.play();
    expect(cb).toHaveBeenCalledTimes(1);

    off();
    await tts.finishSpeech(); // advances to beat 1
    expect(c.beatIndex).toBe(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
