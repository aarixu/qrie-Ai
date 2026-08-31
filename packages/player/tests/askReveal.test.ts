import { describe, expect, it } from 'vitest';
import type { Lesson } from '@ai-tutor/lesson-format';
import { PlayerController } from '../src/controller';

/**
 * A held question surfaces when she FINISHES the line, not when the beat
 * begins. Once every beat carried an ask, revealing at beat start meant the
 * next question's options appeared the instant the previous one resolved -
 * chips hanging over a line still being spoken, which the student read as
 * "the options never vanish".
 */

const lesson = {
  formatVersion: 1,
  id: 'l',
  title: 't',
  beats: [
    { id: 'b1', topic: 'x', narration: 'one', show: [], ask: { question: 'Q1?', expect: 'E1' } },
    { id: 'b2', topic: 'x', narration: 'two', show: [], ask: { question: 'Q2?' } },
  ],
  elements: [],
} as unknown as Lesson;

/** A tts whose lines finish only when the test says so. */
function manualTts() {
  const pending: (() => void)[] = [];
  return {
    adapter: {
      speak: () => new Promise<void>((r) => pending.push(r)),
      cancel: () => undefined,
    },
    finish: () => pending.shift()?.(),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('when the question surfaces', () => {
  it('stays hidden while she is speaking, appears when the line ends', async () => {
    const t = manualTts();
    const p = new PlayerController(lesson, { tts: t.adapter });
    p.play();
    expect(p.pendingAsk).toBeNull(); // she is mid-sentence
    t.finish();
    await tick();
    expect(p.pendingAsk?.question).toBe('Q1?');
  });

  it('vanishes on the answer, and the NEXT ask waits for the next line to end', async () => {
    const t = manualTts();
    const p = new PlayerController(lesson, { tts: t.adapter });
    p.play();
    t.finish();
    await tick();
    p.answer(0);
    expect(p.pendingAsk).toBeNull(); // resolved, gone at once
    await tick();
    expect(p.beatIndex).toBe(1); // the class moved on
    expect(p.pendingAsk).toBeNull(); // b2 is still being spoken
    t.finish();
    await tick();
    expect(p.pendingAsk?.question).toBe('Q2?');
  });
});
