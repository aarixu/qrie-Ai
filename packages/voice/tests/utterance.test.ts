import { describe, expect, it } from 'vitest';
import { createUtteranceQueue, defaultSchedule, type Utterance } from '../src/utterance';

describe('createUtteranceQueue', () => {
  it('resolves speak() when the utterance says it is done', async () => {
    const queue = createUtteranceQueue();
    const handles: Utterance[] = [];

    const speaking = queue.speak((utterance) => {
      handles.push(utterance);
    });
    handles[0].done();

    await expect(speaking).resolves.toBeUndefined();
  });

  it('settles an earlier utterance when a new one starts', async () => {
    const queue = createUtteranceQueue();
    const handles: Utterance[] = [];

    const speaking = queue.speak((utterance) => {
      handles.push(utterance);
    });
    void queue.speak(() => undefined);

    await expect(speaking).resolves.toBeUndefined();
    expect(handles[0].current).toBe(false); // and it knows it was superseded
  });

  it('resolves a pending speak() on cancel', async () => {
    const queue = createUtteranceQueue();
    const handles: Utterance[] = [];

    const speaking = queue.speak((utterance) => {
      handles.push(utterance);
    });
    queue.cancel();

    await expect(speaking).resolves.toBeUndefined();
    expect(handles[0].current).toBe(false);
  });

  it('ignores a late completion from a cancelled utterance', async () => {
    const queue = createUtteranceQueue();
    const handles: Utterance[] = [];

    const first = queue.speak((utterance) => {
      handles.push(utterance);
    });
    queue.cancel();
    await first;

    let secondDone = false;
    await queue
      .speak((utterance) => {
        // The cancelled utterance's network reply lands here, after the class
        // has moved on. It must not settle the beat now being spoken.
        handles[0].done();
        expect(utterance.current).toBe(true);
        utterance.done();
      })
      .then(() => {
        secondDone = true;
      });

    expect(secondDone).toBe(true);
  });

  it('resolves even when starting the utterance throws', async () => {
    const queue = createUtteranceQueue();
    await expect(
      queue.speak(() => {
        throw new Error('no audio device');
      }),
    ).resolves.toBeUndefined();
  });

  it('is safe to cancel when nothing is speaking', () => {
    const queue = createUtteranceQueue();
    expect(() => queue.cancel()).not.toThrow();
  });
});

describe('defaultSchedule', () => {
  it('hands back a cancel that stops the callback', async () => {
    let fired = false;
    const cancel = defaultSchedule(() => {
      fired = true;
    }, 0);
    cancel();

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(fired).toBe(false);
  });
});
