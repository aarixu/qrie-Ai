import { describe, expect, it } from 'vitest';
import { validateLesson, type Lesson } from '@ai-tutor/lesson-format';
import { PlayerController } from '../src/controller';

/**
 * HER LINE FOR THIS STUDENT, THEN THE LESSON'S OWN.
 *
 * The narration is a spine — written once, replayed for everyone. What belongs
 * to one student is layered on top at play time, and a class replayed by
 * somebody it was not made for simply has none.
 */

const lesson = (fill?: { beatId: string; say: string }[]): Lesson => {
  const doc = {
    formatVersion: 1 as const,
    id: 'demo',
    title: 'The Human Heart',
    language: 'en' as const,
    canvas: { w: 1000, h: 620 },
    elements: [{ kind: 'title' as const, id: 't', x: 100, y: 80, text: 'The Human Heart' }],
    beats: [
      { id: 'b1', topic: 'open', narration: 'Right — what pushes blood around?', show: ['t'] },
      { id: 'b2', topic: 'next', narration: 'The left side does the long trip.', show: ['t'] },
    ],
    ...(fill ? { fill } : {}),
  };
  const result = validateLesson(doc);
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.lesson;
};

/** Records every line handed to the voice, and never finishes one by itself. */
function listeningTts() {
  const said: string[] = [];
  const primed: string[] = [];
  return {
    said,
    primed,
    speak: async (text: string) => {
      said.push(text);
    },
    prime: (text: string) => {
      primed.push(text);
    },
    cancel: () => {},
  };
}

describe('the live fill', () => {
  it('is spoken in front of its beat, as one line', async () => {
    // One utterance, not two calls: two would put the voice's time-to-first-
    // byte between the greeting and the first sentence, which is a tutor
    // pausing for no reason in the middle of saying hello.
    const tts = listeningTts();
    const player = new PlayerController(lesson([{ beatId: 'b1', say: 'Aarav! Good to see you.' }]), { tts });

    player.play();
    await Promise.resolve();

    expect(tts.said[0]).toBe('Aarav! Good to see you. Right — what pushes blood around?');
  });

  it('opens only the beat it names', async () => {
    const tts = listeningTts();
    const player = new PlayerController(lesson([{ beatId: 'b2', say: 'One more, Aarav.' }]), { tts });

    player.play();
    await Promise.resolve();

    expect(tts.said[0]).toBe('Right — what pushes blood around?');
  });


  it('primes the NEXT line exactly as it will be spoken', async () => {
    // streamingTts matches its prefetched audio element by exact text, so
    // priming the bare narration threw the fetch away on precisely the beats
    // that carry a personal line — an audible gap, and a synthesis paid for
    // twice. It also defeats the recorded-audio manifest lookup.
    const tts = listeningTts();
    const player = new PlayerController(
      lesson([{ beatId: 'b2', say: 'One more, Aarav.' }]),
      { tts },
    );

    player.play();
    await Promise.resolve();

    expect(tts.primed[0]).toBe('One more, Aarav. The left side does the long trip.');
  });

  it('leaves a class with no fill exactly as it was', async () => {
    // A cached class replayed by somebody else. Starting on the narration is
    // the honest shape: a class that has not met you yet, rather than one
    // wearing somebody else's greeting.
    const tts = listeningTts();
    const player = new PlayerController(lesson(), { tts });

    player.play();
    await Promise.resolve();

    expect(tts.said[0]).toBe('Right — what pushes blood around?');
  });

  it('ignores a personal line that is only whitespace', async () => {
    const tts = listeningTts();
    const player = new PlayerController(lesson([{ beatId: 'b1', say: '   ' }]), { tts });

    player.play();
    await Promise.resolve();

    expect(tts.said[0]).toBe('Right — what pushes blood around?');
  });
});
