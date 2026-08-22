import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBrowserTts, estimateSpeechMs } from '../src/narration';

// Promise settlements happen in microtasks, which fake timers do not fake.
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

describe('estimateSpeechMs', () => {
  it('floors at 600ms for tiny or empty text', () => {
    expect(estimateSpeechMs('hi')).toBe(600);
    expect(estimateSpeechMs('')).toBe(600);
    expect(estimateSpeechMs('   ')).toBe(600);
  });

  it('scales with word count at the default 140wpm', () => {
    const words = Array.from({ length: 140 }, (_, i) => `w${i}`).join(' ');
    expect(estimateSpeechMs(words)).toBe(60_000);
  });

  it('honours a wpm override', () => {
    const words = Array.from({ length: 70 }, (_, i) => `w${i}`).join(' ');
    expect(estimateSpeechMs(words, 70)).toBe(60_000);
  });
});

describe('createBrowserTts — timer fallback (no speechSynthesis)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs without speechSynthesis (the jsdom test environment)', () => {
    // Precondition for this whole describe block.
    expect(window.speechSynthesis).toBeUndefined();
  });

  it('resolves after estimateSpeechMs(text)', async () => {
    const tts = createBrowserTts();
    const text = 'one two three four five';
    const resolved = vi.fn();
    void tts.speak(text).then(resolved);

    vi.advanceTimersByTime(estimateSpeechMs(text) - 1);
    await flush();
    expect(resolved).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await flush();
    expect(resolved).toHaveBeenCalledTimes(1);
  });

  it('cancel clears the timer and resolves the pending speak', async () => {
    const tts = createBrowserTts();
    const resolved = vi.fn();
    void tts.speak('some words to say').then(resolved);
    expect(vi.getTimerCount()).toBe(1);

    tts.cancel();
    await flush();
    expect(resolved).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    // The dead timer firing anyway must not double-settle anything.
    vi.advanceTimersByTime(60_000);
    await flush();
    expect(resolved).toHaveBeenCalledTimes(1);
  });

  it('cancel with nothing pending is a no-op', () => {
    const tts = createBrowserTts();
    expect(() => tts.cancel()).not.toThrow();
  });
});

describe('createBrowserTts — speechSynthesis path', () => {
  /** Stand-in for the DOM class jsdom does not provide. */
  class FakeUtterance {
    text: string;
    lang = '';
    rate = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }

  let uttered: FakeUtterance[];
  let synthCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    uttered = [];
    synthCancel = vi.fn();
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    vi.stubGlobal('speechSynthesis', {
      speak: (u: unknown) => uttered.push(u as FakeUtterance),
      cancel: synthCancel,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('speaks with the Indian-English default lang and rate 1', () => {
    const tts = createBrowserTts();
    void tts.speak('namaste');
    expect(uttered).toHaveLength(1);
    expect(uttered[0].text).toBe('namaste');
    expect(uttered[0].lang).toBe('en-IN');
    expect(uttered[0].rate).toBe(1);
  });

  it('passes lang and rate options through to the utterance', () => {
    const tts = createBrowserTts({ lang: 'hi-IN', rate: 1.2 });
    void tts.speak('dhanyavaad');
    expect(uttered[0].lang).toBe('hi-IN');
    expect(uttered[0].rate).toBe(1.2);
  });

  it('resolves when the utterance ends', async () => {
    const tts = createBrowserTts();
    const resolved = vi.fn();
    void tts.speak('hello').then(resolved);
    await flush();
    expect(resolved).not.toHaveBeenCalled();

    uttered[0].onend?.();
    await flush();
    expect(resolved).toHaveBeenCalledTimes(1);
  });

  it('resolves on utterance error too — a bad voice must not stall the class', async () => {
    const tts = createBrowserTts();
    const resolved = vi.fn();
    void tts.speak('hello').then(resolved);

    uttered[0].onerror?.();
    await flush();
    expect(resolved).toHaveBeenCalledTimes(1);
  });

  it('cancel calls synthesis.cancel and resolves the pending speak', async () => {
    const tts = createBrowserTts();
    const resolved = vi.fn();
    void tts.speak('hello').then(resolved);

    tts.cancel();
    expect(synthCancel).toHaveBeenCalledTimes(1);
    await flush();
    expect(resolved).toHaveBeenCalledTimes(1);
  });

  it('a late end event from a cancelled utterance cannot settle a newer speak', async () => {
    const tts = createBrowserTts();
    const first = vi.fn();
    const second = vi.fn();

    void tts.speak('first').then(first);
    tts.cancel();
    void tts.speak('second').then(second);
    await flush();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    // Some engines fire end for the cancelled utterance much later.
    uttered[0].onend?.();
    await flush();
    expect(second).not.toHaveBeenCalled();

    uttered[1].onend?.();
    await flush();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1); // never double-settled
  });
});
