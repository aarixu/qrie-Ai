import { describe, expect, it } from 'vitest';
import { createStreamingTts, type SpeechElement } from '../src/streamingTts';

/**
 * Her voice, streamed.
 *
 * The board waits for her to finish a line before it moves on, so the number
 * that matters is not how long the whole sentence takes to synthesise but how
 * long before the first sound. Measured against OpenRouter's speech endpoint:
 * first byte at 0.36s, and 8.4 seconds of speech generated in 2.5 — it arrives
 * more than three times faster than it plays, so an element that streams can
 * start almost at once and never catch up with the generator.
 *
 * Which is why this hands a URL to the browser rather than downloading the
 * audio and playing it afterwards. Waiting for the whole file would have made
 * every line start two and a half seconds late for no reason.
 */

/** A stand-in for the audio element, so a test can hear what it was told. */
function fakeAudio() {
  const made: { src: string; played: number; paused: number }[] = [];
  const element = (src: string): SpeechElement => {
    const self = {
      src,
      played: 0,
      paused: 0,
      onended: null as (() => void) | null,
      onerror: null as (() => void) | null,
      play: () => {
        self.played += 1;
        return Promise.resolve();
      },
      pause: () => {
        self.paused += 1;
      },
    };
    made.push(self);
    return self as unknown as SpeechElement;
  };
  return { element, made };
}

describe('speaking a line', () => {
  it('asks the relay for the words, and plays what comes back', async () => {
    const audio = fakeAudio();
    const tts = createStreamingTts({ endpoint: '/api/speech', audio: audio.element });
    const speaking = tts.speak('The heart has four chambers.');
    expect(audio.made).toHaveLength(1);
    expect(audio.made[0].src).toContain('/api/speech?');
    const asked = new URLSearchParams(audio.made[0].src.split('?')[1]);
    expect(asked.get('text')).toBe('The heart has four chambers.');
    expect(audio.made[0].played).toBe(1);

    (audio.made[0] as unknown as { onended: () => void }).onended();
    await expect(speaking).resolves.toBeUndefined();
  });

  it('resolves when the audio fails, so a broken line never stops the class', async () => {
    // The board advances on this promise. A line that never resolves is a
    // class that stops for good.
    const audio = fakeAudio();
    const tts = createStreamingTts({ endpoint: '/api/speech', audio: audio.element });
    const speaking = tts.speak('Something went wrong.');
    (audio.made[0] as unknown as { onerror: () => void }).onerror();
    await expect(speaking).resolves.toBeUndefined();
  });

  it('says nothing at all for an empty line', async () => {
    const audio = fakeAudio();
    const tts = createStreamingTts({ endpoint: '/api/speech', audio: audio.element });
    await tts.speak('   ');
    expect(audio.made).toHaveLength(0);
  });

  it('stops the moment it is cancelled, and lets the class move on', async () => {
    const audio = fakeAudio();
    const tts = createStreamingTts({ endpoint: '/api/speech', audio: audio.element });
    const speaking = tts.speak('A long line she will not finish.');
    tts.cancel();
    expect(audio.made[0].paused).toBe(1);
    await expect(speaking).resolves.toBeUndefined();
  });

  it('never leaves two lines talking over each other', async () => {
    // A student raising a hand mid-sentence starts the next utterance; the
    // one before it has to stop, not fade into it.
    const audio = fakeAudio();
    const tts = createStreamingTts({ endpoint: '/api/speech', audio: audio.element });
    const first = tts.speak('First line.');
    void tts.speak('Second line.');
    expect(audio.made[0].paused).toBe(1);
    await expect(first).resolves.toBeUndefined();
  });

  it('carries the voice and model it was configured with', () => {
    const audio = fakeAudio();
    const tts = createStreamingTts({
      endpoint: '/api/speech',
      audio: audio.element,
      model: 'fish-audio/s2.1-pro',
    });
    void tts.speak('Hello.');
    expect(audio.made[0].src).toContain('model=fish-audio%2Fs2.1-pro');
  });
});

describe('when the relay cannot speak', () => {
  it('falls back rather than leaving the class silent', async () => {
    // Three layers, and the last one is never chosen — only fallen back to.
    const audio = fakeAudio();
    const spoken: string[] = [];
    const tts = createStreamingTts({
      endpoint: '/api/speech',
      audio: audio.element,
      fallback: {
        speak: async (t: string) => {
          spoken.push(t);
        },
        cancel: () => {},
      },
    });
    const speaking = tts.speak('Say this somehow.');
    (audio.made[0] as unknown as { onerror: () => void }).onerror();
    await speaking;
    expect(spoken).toEqual(['Say this somehow.']);
  });

  it('does not fall back when the line simply finished', async () => {
    const audio = fakeAudio();
    const spoken: string[] = [];
    const tts = createStreamingTts({
      endpoint: '/api/speech',
      audio: audio.element,
      fallback: {
        speak: async (t: string) => {
          spoken.push(t);
        },
        cancel: () => {},
      },
    });
    const speaking = tts.speak('This one worked.');
    (audio.made[0] as unknown as { onended: () => void }).onended();
    await speaking;
    expect(spoken).toEqual([]);
  });
});

describe('the voice is pinned, because an unpinned one wanders', () => {
  /**
   * Fish S2.1 with no reference voice re-rolls its speaker on every call. The
   * same sentence sent three times came back as three different renditions —
   * 49, 53 and 42 kilobytes — and a seed changed nothing. Every line of a class
   * is its own call, so the tutor changed voice between sentences.
   *
   * Deepgram's Aura will not even start without a named voice, which is the
   * guarantee stated as an error message: "An explicit voice is required for
   * this TTS provider."
   */
  it('sends the voice it was given', () => {
    const audio = fakeAudio();
    const tts = createStreamingTts({
      endpoint: '/api/speech',
      audio: audio.element,
      model: 'deepgram/aura-2',
      voice: 'aura-2-thalia-en',
    });
    void tts.speak('One line.');
    const asked = new URLSearchParams(audio.made[0].src.split('?')[1]);
    expect(asked.get('model')).toBe('deepgram/aura-2');
    expect(asked.get('voice')).toBe('aura-2-thalia-en');
  });

  it('asks for the same voice on every line', () => {
    const audio = fakeAudio();
    const tts = createStreamingTts({
      endpoint: '/api/speech',
      audio: audio.element,
      voice: 'aura-2-thalia-en',
    });
    void tts.speak('First.');
    void tts.speak('Second.');
    void tts.speak('Third.');
    const voices = audio.made.map((a) => new URLSearchParams(a.src.split('?')[1]).get('voice'));
    expect(new Set(voices).size).toBe(1);
  });
});

describe('the next line is ready before this one ends', () => {
  /**
   * The gap between sentences, and why it was there.
   *
   * Every line is its own request, and nothing started the next one until the
   * last had finished — so between two sentences you heard the whole
   * time-to-first-byte as silence. Measured, that is about four tenths of a
   * second on a warm relay and several on a cold one, once per sentence, all
   * class long.
   *
   * Speech generates about three times faster than it plays, so the fix costs
   * nothing: begin the next line while the current one is still speaking, and
   * by the time it is needed it is already buffered.
   */
  it('loads the next line while the current one plays', () => {
    const audio = fakeAudio();
    const tts = createStreamingTts({ endpoint: '/api/speech', audio: audio.element });
    void tts.speak('This line is playing.');
    tts.prime!('And this one is already loading.');
    expect(audio.made).toHaveLength(2);
    const primed = new URLSearchParams(audio.made[1].src.split('?')[1]);
    expect(primed.get('text')).toBe('And this one is already loading.');
    // Loading, not talking over the line in flight.
    expect(audio.made[1].played).toBe(0);
  });

  it('plays the primed line instead of fetching it again', async () => {
    const audio = fakeAudio();
    const tts = createStreamingTts({ endpoint: '/api/speech', audio: audio.element });
    const first = tts.speak('First line.');
    tts.prime!('Second line.');
    (audio.made[0] as unknown as { onended: () => void }).onended();
    await first;

    void tts.speak('Second line.');
    // Two elements in total: the one that spoke, and the one that was ready.
    expect(audio.made).toHaveLength(2);
    expect(audio.made[1].played).toBe(1);
  });

  it('throws the primed line away if the class went somewhere else', () => {
    // A seek, or a raised hand: what was queued is no longer what is next.
    const audio = fakeAudio();
    const tts = createStreamingTts({ endpoint: '/api/speech', audio: audio.element });
    void tts.speak('First line.');
    tts.prime!('The line we expected.');
    void tts.speak('A different line entirely.');
    expect(audio.made).toHaveLength(3);
    expect(audio.made[2].played).toBe(1);
    const spoken = new URLSearchParams(audio.made[2].src.split('?')[1]);
    expect(spoken.get('text')).toBe('A different line entirely.');
  });

  it('ignores an empty line, and priming the line already in flight', () => {
    const audio = fakeAudio();
    const tts = createStreamingTts({ endpoint: '/api/speech', audio: audio.element });
    void tts.speak('Playing.');
    tts.prime!('   ');
    tts.prime!('Playing.');
    expect(audio.made).toHaveLength(1);
  });
});
