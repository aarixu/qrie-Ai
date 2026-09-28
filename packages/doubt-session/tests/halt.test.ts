import { describe, it, expect } from 'vitest';
import type { DoubtContext } from '../src/context';
import type { AgentAdapter, AgentIO } from '../src/agent';
import { createHandoff } from '../src/handoff';
import { entryLine, exitLine } from '../src/bridge';

/**
 * THE HALT — the one state the seam never leaves.
 *
 * A doubt used to carry on after the student said something distressing: the
 * caller's screen swapped the line for a support reply and then reported
 * nothing the machine could act on, so the agent's next line was spoken, the
 * exit bridge said "let's pick the class back up", and the recording resumed
 * over a child who had just been told to talk to somebody.
 *
 * These tests pin the other shape. A speaker that reports `{ halted: true }`,
 * or a caller that calls `halt()`, ends the doubt where it stands: the session
 * is stopped, nothing further is spoken, the exit line is skipped, the
 * recording is never resumed, and no new hand is accepted.
 */

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
  outcomeIds: [],
});

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

const DISTRESSING = 'a line the screen replaced with the support reply';

/**
 * A room whose speaker halts on one marked line — the way the classroom's
 * screened speaker reports a distress verdict — and whose every other line
 * resolves when the test says so.
 */
function room() {
  const log: string[] = [];
  const queue: Array<() => void> = [];
  let io: AgentIO | null = null;

  const agent: AgentAdapter = {
    start(_ctx, agentIo) {
      io = agentIo;
      log.push('start');
      return {
        sendUserText: (t: string) => void log.push(`user:${t}`),
        stop: () => void log.push('stop'),
      };
    },
  };

  const handoff = createHandoff({
    agent,
    speak(text, onSaid) {
      log.push(`speak:${text}`);
      onSaid(text);
      if (text === DISTRESSING) return Promise.resolve({ halted: true });
      return new Promise((res) => queue.push(() => res({ halted: false })));
    },
    onPause: () => void log.push('pause'),
    onResume: () => void log.push('resume'),
    onRecall: (id) => void log.push(`recall:${id}`),
  });

  const states: string[] = [];
  handoff.on('statechange', (s) => states.push(s ?? ''));

  const finish = async (): Promise<void> => {
    await flush();
    queue.shift()?.();
    await flush();
  };
  const speaks = (): string[] => log.filter((l) => l.startsWith('speak:'));

  return { handoff, log, states, finish, speaks, io: () => io! };
}

describe('createHandoff — a speaker that reports a halt', () => {
  it('ends the doubt where it stands: session stopped, no exit line, no resume', async () => {
    const r = room();
    const ctx = ctxOf();
    r.handoff.raiseHand(ctx);
    await r.finish(); // entry line → LIVE

    void r.io().say(DISTRESSING);
    await flush();

    expect(r.handoff.state).toBe('HALTED');
    expect(r.log).toContain('stop');
    expect(r.log).not.toContain('resume');
    expect(r.speaks()).not.toContain(`speak:${exitLine(ctx)}`);
    expect(r.states[r.states.length - 1]).toBe('HALTED');
  });

  it('says nothing further, whatever the agent still tries', async () => {
    const r = room();
    r.handoff.raiseHand(ctxOf());
    await r.finish();
    void r.io().say(DISTRESSING);
    await flush();
    const before = r.speaks().length;

    // A late line, a late done() and a late recall from an agent that had not
    // yet noticed it was stopped.
    void r.io().say('Anyway, back to the valves.');
    r.io().done();
    r.io().recall('b0');
    await flush();

    expect(r.speaks().length).toBe(before);
    expect(r.log).not.toContain('recall:b0');
    expect(r.log).not.toContain('resume');
  });

  it('forwards no more student text and accepts no new hand', async () => {
    const r = room();
    r.handoff.raiseHand(ctxOf());
    await r.finish();
    void r.io().say(DISTRESSING);
    await flush();

    r.handoff.sendUserText('are you there?');
    r.handoff.raiseHand(ctxOf());
    r.handoff.endDoubt();
    await flush();

    expect(r.log.filter((l) => l.startsWith('user:'))).toEqual([]);
    expect(r.log.filter((l) => l === 'pause')).toEqual(['pause']);
    expect(r.log.filter((l) => l === 'start')).toEqual(['start']);
    expect(r.handoff.state).toBe('HALTED');
  });
});

describe('createHandoff — halt() from outside', () => {
  it('stops a LIVE doubt with no exit line and no resume', async () => {
    const r = room();
    const ctx = ctxOf();
    r.handoff.raiseHand(ctx);
    await r.finish(); // LIVE

    r.handoff.halt();
    await r.finish();
    await r.finish();

    expect(r.handoff.state).toBe('HALTED');
    expect(r.log.filter((l) => l === 'stop')).toEqual(['stop']);
    expect(r.speaks()).toEqual([`speak:${entryLine(ctx)}`]);
    expect(r.log).not.toContain('resume');
  });

  it('while the entry line is still being spoken, the agent never starts', async () => {
    const r = room();
    r.handoff.raiseHand(ctxOf());
    expect(r.handoff.state).toBe('AGENT_ENTERING');

    r.handoff.halt();
    await r.finish(); // the abandoned entry line resolves

    expect(r.log).not.toContain('start');
    expect(r.handoff.state).toBe('HALTED');
    expect(r.log).not.toContain('resume');
  });

  it('while the exit line is playing, the recording is still never resumed', async () => {
    const r = room();
    r.handoff.raiseHand(ctxOf());
    await r.finish(); // LIVE
    r.io().done(); // AGENT_LEAVING, exit line pending

    r.handoff.halt();
    await r.finish(); // the exit line resolves

    expect(r.handoff.state).toBe('HALTED');
    expect(r.log).not.toContain('resume');
    expect(r.states).not.toContain('RESUMING');
  });

  it('from PLAYING, so a halt on the answer path also closes the doubt door', async () => {
    const r = room();
    r.handoff.halt();
    r.handoff.raiseHand(ctxOf());
    await flush();

    expect(r.handoff.state).toBe('HALTED');
    expect(r.log).toEqual([]);
  });

  it('is idempotent: a second halt announces nothing and stops nothing twice', async () => {
    const r = room();
    r.handoff.raiseHand(ctxOf());
    await r.finish();
    r.handoff.halt();
    r.handoff.halt();

    expect(r.states.filter((s) => s === 'HALTED')).toEqual(['HALTED']);
    expect(r.log.filter((l) => l === 'stop')).toEqual(['stop']);
  });
});

describe('createHandoff — a speaker that returns nothing', () => {
  it('still works: void is "not halted", so older callers keep their seam', async () => {
    let io: AgentIO | null = null;
    const handoff = createHandoff({
      agent: {
        start(_ctx, agentIo) {
          io = agentIo;
          return { sendUserText() {}, stop() {} };
        },
      },
      speak: (text, onSaid) => {
        onSaid(text);
        return Promise.resolve();
      },
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
