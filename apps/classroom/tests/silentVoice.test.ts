import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { estimateSpeechMs } from '@ai-tutor/player';
import { createSilentTts } from '../src/lib/lessonVoice';

/**
 * VOICE OFF STILL TAKES THE TIME A LINE TAKES (integration audit, 2026-10-11).
 *
 * With "Tutor speaks aloud" off, the class used a voice whose speak() resolved
 * at once, so every beat without a question advanced in a microtask: the
 * board and the captions (forced on while the voice is off) jumped straight to
 * the next question or the end. The comment beside it said a timer paced the
 * beats; none did. Silence now waits as long as the line would take to say,
 * the same contract as the player's own timer voice.
 */

const LINE = 'The left ventricle pumps blood out to the whole body through the aorta.';

describe('the silent voice', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('takes as long as the line would take to say', async () => {
    const tts = createSilentTts();
    let done = false;
    void tts.speak(LINE).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(estimateSpeechMs(LINE) - 50);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(true);
  });

  it('settles at once when cancelled, and when the next line starts', async () => {
    const tts = createSilentTts();
    let first = false;
    let second = false;
    void tts.speak(LINE).then(() => (first = true));
    void tts.speak(LINE).then(() => (second = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(first).toBe(true);
    expect(second).toBe(false);
    tts.cancel();
    await vi.advanceTimersByTimeAsync(0);
    expect(second).toBe(true);
  });
});
