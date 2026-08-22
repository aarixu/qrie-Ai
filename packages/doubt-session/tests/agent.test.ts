import { describe, it, expect } from 'vitest';
import type { DoubtContext } from '../src/context';
import type { AgentIO } from '../src/agent';
import { createStubAgent } from '../src/agent';

// The stub sequences its lines through a promise chain; give the microtask
// queue room to drain between steps.
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

const ctxWithHistory = (): DoubtContext => ({
  lessonId: 'l1',
  beatId: 'b1',
  beatTopic: 'chambers of the heart',
  transcriptSoFar: 'n0\nn1',
  visibleElementIds: ['e1'],
  recentBeats: [
    { id: 'b0', topic: 'the heart' },
    { id: 'b1', topic: 'chambers of the heart' },
  ],
});

const ctxFirstBeat = (): DoubtContext => ({
  lessonId: 'l1',
  beatId: 'b0',
  beatTopic: 'the heart',
  transcriptSoFar: 'n0',
  visibleElementIds: ['e1'],
  recentBeats: [{ id: 'b0', topic: 'the heart' }],
});

/** An AgentIO whose say() resolves only when the test says so. */
function makeIo() {
  const log: string[] = [];
  const queue: Array<() => void> = [];
  const io: AgentIO = {
    say(text: string): Promise<void> {
      log.push(`say:${text}`);
      return new Promise<void>((res) => queue.push(res));
    },
    recall(beatId: string): void {
      log.push(`recall:${beatId}`);
    },
    done(): void {
      log.push('done');
    },
  };
  /** Resolve the oldest unresolved say() and let the script react. */
  const finish = async (): Promise<void> => {
    await flush();
    queue.shift()?.();
    await flush();
  };
  return { io, log, finish };
}

describe('createStubAgent', () => {
  it('runs the full script: greet, recall the previous beat, answer, close with done()', async () => {
    const { io, log, finish } = makeIo();
    const session = createStubAgent().start(ctxWithHistory(), io);

    // Greeting references the current topic.
    await flush();
    expect(log.length).toBe(1);
    expect(log[0]).toContain('say:');
    expect(log[0]).toContain('chambers of the heart');

    // Once greeted, it demonstrates recall of the PREVIOUS beat and points at it.
    await finish();
    expect(log[1]).toBe('recall:b0');
    expect(log[2]).toContain('say:');
    expect(log[2]).toContain('the heart');
    await finish(); // pointing line spoken

    // First student message: warm acknowledgement + explanation naming the topic.
    session.sendUserText('valve kya hota hai?');
    await flush();
    expect(log[3]).toContain('say:');
    expect(log[3]).toContain('chambers of the heart');
    await finish();

    // Second student message: closing line, then done().
    session.sendUserText('ok samajh gaya');
    await finish();
    expect(log[log.length - 1]).toBe('done');
    // done arrives strictly after the closing line was fully spoken.
    expect(log[log.length - 2]).toContain('say:');
  });

  it('skips the recall demonstration on the first beat (no previous beat)', async () => {
    const { io, log, finish } = makeIo();
    createStubAgent().start(ctxFirstBeat(), io);
    await finish(); // greeting spoken
    await flush();
    expect(log.length).toBe(1);
    expect(log.some((l) => l.startsWith('recall:'))).toBe(false);
  });

  it('makes no io calls after stop(), even for steps already queued', async () => {
    const { io, log, finish } = makeIo();
    const session = createStubAgent().start(ctxWithHistory(), io);
    await flush(); // greeting initiated, recall step still queued behind it
    session.stop();
    await finish(); // resolve the greeting — the queued recall step must die
    await flush();
    expect(log.length).toBe(1);
  });

  it('ignores messages after stop()', async () => {
    const { io, log, finish } = makeIo();
    const session = createStubAgent().start(ctxWithHistory(), io);
    await finish(); // greeting
    await finish(); // recall + pointing line
    session.stop();
    session.sendUserText('hello?');
    await flush();
    expect(log.filter((l) => l.startsWith('say:')).length).toBe(2);
  });

  it('stays quiet from the third message onwards', async () => {
    const { io, log, finish } = makeIo();
    const session = createStubAgent().start(ctxFirstBeat(), io);
    await finish(); // greeting
    session.sendUserText('one');
    await finish();
    session.sendUserText('two');
    await finish();
    const len = log.length;
    session.sendUserText('three');
    await flush();
    expect(log.length).toBe(len);
  });
});
