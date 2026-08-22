import { describe, it, expect } from 'vitest';
import type { DoubtContext } from '../src/context';
import type { AgentAdapter, AgentIO } from '../src/agent';
import { createHandoff } from '../src/handoff';
import { createStubAgent } from '../src/agent';
import { entryLine, exitLine } from '../src/bridge';

const ctxOf = (): DoubtContext => ({
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

// The machine advances inside promise callbacks; give microtasks room to run.
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

/**
 * One harness for every test: a manually-resolvable speak(), a manual agent
 * whose io the test can drive directly, and a single ordered `log` shared by
 * every callback so cross-callback ordering (pause before speak, stop before
 * exit line, ...) is assertable as plain array equality.
 */
function setup(agentOverride?: AgentAdapter) {
  const log: string[] = [];
  const queue: Array<() => void> = [];

  let capturedIo: AgentIO | null = null;
  const manualAgent: AgentAdapter = {
    start(_ctx, io) {
      capturedIo = io;
      log.push('start');
      return {
        sendUserText(t: string): void {
          log.push(`user:${t}`);
        },
        stop(): void {
          log.push('stop');
        },
      };
    },
  };

  const handoff = createHandoff({
    agent: agentOverride ?? manualAgent,
    speak(text: string): Promise<void> {
      log.push(`speak:${text}`);
      return new Promise<void>((res) => queue.push(res));
    },
    onPause(): void {
      log.push('pause');
    },
    onResume(): void {
      log.push('resume');
    },
    onRecall(beatId: string): void {
      log.push(`recall:${beatId}`);
    },
  });

  const states: string[] = [];
  handoff.on('statechange', (s) => states.push(s ?? ''));
  const said: string[] = [];
  handoff.on('agent-say', (t) => said.push(t ?? ''));

  /** Resolve the oldest unresolved speak() and let the machine react. */
  const finish = async (): Promise<void> => {
    await flush();
    queue.shift()?.();
    await flush();
  };

  return { handoff, log, states, said, finish, io: () => capturedIo! };
}

describe('createHandoff — the state machine', () => {
  it('walks the exact state order across a full cycle', async () => {
    const s = setup();
    const ctx = ctxOf();

    s.handoff.raiseHand(ctx);
    // PAUSING and AGENT_ENTERING are set synchronously; LIVE waits on the entry line.
    expect(s.states).toEqual(['PAUSING', 'AGENT_ENTERING']);
    expect(s.handoff.state).toBe('AGENT_ENTERING');

    await s.finish(); // entry line spoken
    expect(s.handoff.state).toBe('LIVE');

    s.io().done();
    expect(s.handoff.state).toBe('AGENT_LEAVING');

    await s.finish(); // exit line spoken
    expect(s.states).toEqual([
      'PAUSING',
      'AGENT_ENTERING',
      'LIVE',
      'AGENT_LEAVING',
      'RESUMING',
      'PLAYING',
    ]);
    expect(s.handoff.state).toBe('PLAYING');
  });

  it('calls onPause before any speak', () => {
    const s = setup();
    s.handoff.raiseHand(ctxOf());
    expect(s.log[0]).toBe('pause');
    expect(s.log[1]).toMatch(/^speak:/);
  });

  it('speaks the entry line fully before starting the agent', async () => {
    const s = setup();
    const ctx = ctxOf();
    s.handoff.raiseHand(ctx);
    expect(s.log).toEqual(['pause', `speak:${entryLine(ctx)}`]);
    await s.finish();
    expect(s.log[2]).toBe('start');
  });

  it('emits agent-say for bridge lines and agent lines alike', async () => {
    const s = setup();
    const ctx = ctxOf();
    s.handoff.raiseHand(ctx);
    expect(s.said).toEqual([entryLine(ctx)]);

    await s.finish(); // LIVE
    void s.io().say('Suno, dhyan se dekho.');
    expect(s.said).toEqual([entryLine(ctx), 'Suno, dhyan se dekho.']);
    expect(s.log).toContain('speak:Suno, dhyan se dekho.');
    await s.finish();

    s.handoff.endDoubt();
    expect(s.said[s.said.length - 1]).toBe(exitLine(ctx));
  });

  it('routes io.recall to onRecall while LIVE', async () => {
    const s = setup();
    s.handoff.raiseHand(ctxOf());
    await s.finish(); // LIVE
    s.io().recall('b0');
    expect(s.log).toContain('recall:b0');
  });

  it('tolerates a missing onRecall', async () => {
    let io: AgentIO | null = null;
    const handoff = createHandoff({
      agent: {
        start(_ctx, agentIo) {
          io = agentIo;
          return { sendUserText() {}, stop() {} };
        },
      },
      speak: () => Promise.resolve(),
      onPause() {},
      onResume() {},
    });
    handoff.raiseHand(ctxOf());
    await flush();
    expect(handoff.state).toBe('LIVE');
    expect(() => io!.recall('b0')).not.toThrow();
  });

  it('io.done() runs stop → exit line → resume → PLAYING, in that order', async () => {
    const s = setup();
    const ctx = ctxOf();
    s.handoff.raiseHand(ctx);
    await s.finish(); // LIVE

    s.io().done();
    await s.finish(); // exit line spoken
    expect(s.log.slice(-3)).toEqual(['stop', `speak:${exitLine(ctx)}`, 'resume']);
    expect(s.handoff.state).toBe('PLAYING');
  });

  it('ignores a double raiseHand', async () => {
    const s = setup();
    s.handoff.raiseHand(ctxOf());
    s.handoff.raiseHand(ctxOf()); // double-tap while entering
    expect(s.log.filter((l) => l === 'pause').length).toBe(1);
    expect(s.states).toEqual(['PAUSING', 'AGENT_ENTERING']);

    await s.finish(); // LIVE
    s.handoff.raiseHand(ctxOf()); // and while LIVE
    expect(s.log.filter((l) => l === 'pause').length).toBe(1);
  });

  it('ignores raiseHand during the leaving sequence, then accepts it again from PLAYING', async () => {
    const s = setup();
    s.handoff.raiseHand(ctxOf());
    await s.finish(); // LIVE
    s.io().done(); // AGENT_LEAVING, exit line pending

    s.handoff.raiseHand(ctxOf());
    expect(s.handoff.state).toBe('AGENT_LEAVING');
    expect(s.log.filter((l) => l === 'pause').length).toBe(1);

    await s.finish(); // back to PLAYING
    s.handoff.raiseHand(ctxOf());
    expect(s.log.filter((l) => l === 'pause').length).toBe(2);
    expect(s.handoff.state).toBe('AGENT_ENTERING');
  });

  it('endDoubt is a no-op outside LIVE and AGENT_ENTERING', async () => {
    const s = setup();
    s.handoff.endDoubt(); // PLAYING
    expect(s.handoff.state).toBe('PLAYING');
    expect(s.log).toEqual([]);
    expect(s.states).toEqual([]);

    s.handoff.raiseHand(ctxOf());
    await s.finish(); // LIVE
    s.io().done(); // AGENT_LEAVING
    const speaks = s.log.filter((l) => l.startsWith('speak:')).length;
    s.handoff.endDoubt(); // second end mid-leaving: no-op
    expect(s.log.filter((l) => l.startsWith('speak:')).length).toBe(speaks);
    expect(s.log.filter((l) => l === 'stop').length).toBe(1);
  });

  it('endDoubt during AGENT_ENTERING cancels: agent never starts, seam still closes', async () => {
    const s = setup();
    s.handoff.raiseHand(ctxOf());
    expect(s.handoff.state).toBe('AGENT_ENTERING');

    s.handoff.endDoubt();
    expect(s.handoff.state).toBe('AGENT_LEAVING');

    await s.finish(); // the abandoned entry line resolves — must NOT start the agent
    await s.finish(); // exit line resolves
    expect(s.log).not.toContain('start');
    expect(s.log).not.toContain('stop'); // no session ever existed to stop
    expect(s.states).toEqual([
      'PAUSING',
      'AGENT_ENTERING',
      'AGENT_LEAVING',
      'RESUMING',
      'PLAYING',
    ]);
  });

  it('forwards sendUserText only while LIVE', async () => {
    const s = setup();
    s.handoff.sendUserText('too early');
    s.handoff.raiseHand(ctxOf());
    s.handoff.sendUserText('still entering');
    await s.finish(); // LIVE
    s.handoff.sendUserText('hello');
    s.io().done();
    s.handoff.sendUserText('too late');
    expect(s.log.filter((l) => l.startsWith('user:'))).toEqual(['user:hello']);
  });

  it('a rejected speak() never wedges the seam', async () => {
    let io: AgentIO | null = null;
    const handoff = createHandoff({
      agent: {
        start(_ctx, agentIo) {
          io = agentIo;
          return { sendUserText() {}, stop() {} };
        },
      },
      speak: () => Promise.reject(new Error('tts down')),
      onPause() {},
      onResume() {},
    });
    handoff.raiseHand(ctxOf());
    await flush();
    expect(handoff.state).toBe('LIVE');
    io!.done();
    await flush();
    expect(handoff.state).toBe('PLAYING');
  });
});

describe('createHandoff — full seam with the stub agent', () => {
  it('plays out an entire doubt: bridges, recall demo, two answers, hand-back', async () => {
    const s = setup(createStubAgent());
    const ctx = ctxOf();

    s.handoff.raiseHand(ctx);
    await s.finish(); // entry line → LIVE, stub queues its greeting
    await s.finish(); // greeting spoken → stub recalls b0 and points at it
    expect(s.log).toContain('recall:b0');
    await s.finish(); // pointing line spoken

    s.handoff.sendUserText('valve kya hota hai?');
    await s.finish(); // acknowledgement + explanation spoken

    s.handoff.sendUserText('ok samajh gaya');
    await s.finish(); // closing line spoken → stub calls done() → exit line queued
    await s.finish(); // exit line spoken → resumed

    expect(s.handoff.state).toBe('PLAYING');
    expect(s.states).toEqual([
      'PAUSING',
      'AGENT_ENTERING',
      'LIVE',
      'AGENT_LEAVING',
      'RESUMING',
      'PLAYING',
    ]);

    // The room heard: entry bridge, greeting, recall pointer, answer, closing, exit bridge.
    expect(s.said.length).toBe(6);
    expect(s.said[0]).toBe(entryLine(ctx));
    expect(s.said[1]).toContain('chambers of the heart');
    expect(s.said[2]).toContain('the heart');
    expect(s.said[5]).toBe(exitLine(ctx));

    // The recording was paused exactly once and resumed exactly once.
    expect(s.log.filter((l) => l === 'pause')).toEqual(['pause']);
    expect(s.log.filter((l) => l === 'resume')).toEqual(['resume']);
  });
});
