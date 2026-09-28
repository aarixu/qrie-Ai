import { describe, it, expect } from 'vitest';
import type { DoubtContext } from '../src/context';
import type { AgentAdapter, AgentIO } from '../src/agent';
import { createHandoff, DEFAULT_MAX_STUDENT_TURNS } from '../src/handoff';
import { closingLine, exitLine } from '../src/bridge';

/**
 * THE TURN CAP.
 *
 * Every typed turn in a doubt is one `/api/llm` call, and nothing used to
 * bound how many one raised hand could make. The cap ends a doubt after a
 * fixed number of student turns, on a closing line in her voice, and hands
 * back to the class exactly as an ordinary exit does.
 */

const ctxOf = (): DoubtContext => ({
  lessonId: 'l1',
  beatId: 'b1',
  beatTopic: 'chambers of the heart',
  transcriptSoFar: 'n0\nn1',
  visibleElementIds: ['e1'],
  recentBeats: [{ id: 'b1', topic: 'chambers of the heart' }],
  outcomeIds: [],
});

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

/** An agent that answers every message with one line, as the typed tutor does. */
function answeringRoom(maxStudentTurns?: number) {
  const log: string[] = [];
  let io: AgentIO | null = null;
  const agent: AgentAdapter = {
    start(_ctx, agentIo) {
      io = agentIo;
      return {
        sendUserText: (t: string) => {
          log.push(`user:${t}`);
          void io!.say(`answer to ${t}`);
        },
        stop: () => void log.push('stop'),
      };
    },
  };
  const handoff = createHandoff({
    agent,
    speak: (text, onSaid) => {
      log.push(`speak:${text}`);
      onSaid(text);
      return Promise.resolve({ halted: false });
    },
    onPause: () => void log.push('pause'),
    onResume: () => void log.push('resume'),
    ...(maxStudentTurns === undefined ? {} : { maxStudentTurns }),
  });
  return { handoff, log };
}

describe('createHandoff — the turn cap', () => {
  it('is six student turns unless the caller says otherwise', () => {
    expect(DEFAULT_MAX_STUDENT_TURNS).toBe(6);
  });

  it('closes after the answer to the last allowed turn, on the closing line, and hands back', async () => {
    const r = answeringRoom(2);
    const ctx = ctxOf();
    r.handoff.raiseHand(ctx);
    await flush(); // LIVE

    r.handoff.sendUserText('one');
    await flush();
    expect(r.handoff.state).toBe('LIVE');

    r.handoff.sendUserText('two');
    await flush();

    expect(r.log).toContain('speak:answer to two');
    expect(r.log).toContain(`speak:${closingLine(ctx)}`);
    // The closing line IS the way out: the ordinary exit bridge is not said on
    // top of it.
    expect(r.log).not.toContain(`speak:${exitLine(ctx)}`);
    // Answer, then close — never the other way round.
    expect(r.log.indexOf('speak:answer to two')).toBeLessThan(
      r.log.indexOf(`speak:${closingLine(ctx)}`),
    );
    expect(r.log.filter((l) => l === 'stop')).toEqual(['stop']);
    expect(r.log).toContain('resume');
    expect(r.handoff.state).toBe('PLAYING');
  });

  /**
   * A slow agent: it has not answered the last allowed turn when the student
   * types again. The extra message goes nowhere — and the answer already on
   * its way is still said, then the doubt closes. Leaving at once would stop
   * the session, which aborts the typed tutor's call in flight: a sixth
   * question asked, paid for and never answered.
   */
  function slowRoom() {
    let io: AgentIO | null = null;
    const forwarded: string[] = [];
    const log: string[] = [];
    const handoff = createHandoff({
      agent: {
        start(_ctx, agentIo) {
          io = agentIo;
          return {
            sendUserText: (t: string) => void forwarded.push(t),
            stop: () => void log.push('stop'),
          };
        },
      },
      speak: (text, onSaid) => {
        log.push(`speak:${text}`);
        onSaid(text);
        return Promise.resolve({ halted: false });
      },
      onPause() {},
      onResume: () => void log.push('resume'),
      maxStudentTurns: 1,
    });
    return { handoff, forwarded, log, io: () => io };
  }

  it('never forwards a turn past the cap', async () => {
    const r = slowRoom();
    r.handoff.raiseHand(ctxOf());
    await flush();
    expect(r.io()).not.toBeNull();

    r.handoff.sendUserText('first');
    r.handoff.sendUserText('second');
    await flush();

    expect(r.forwarded).toEqual(['first']);
  });

  it('still says the answer to the last allowed turn when the student types past the cap', async () => {
    const r = slowRoom();
    const ctx = ctxOf();
    r.handoff.raiseHand(ctx);
    await flush();

    r.handoff.sendUserText('first');
    r.handoff.sendUserText('second');
    await flush();

    // Nothing was stopped: the answer to 'first' is still coming.
    expect(r.log).not.toContain('stop');
    expect(r.handoff.state).toBe('LIVE');

    await r.io()!.say('answer to first');
    await flush();

    expect(r.log).toContain('speak:answer to first');
    expect(r.log.indexOf('speak:answer to first')).toBeLessThan(
      r.log.indexOf(`speak:${closingLine(ctx)}`),
    );
    expect(r.log.filter((l) => l === 'stop')).toEqual(['stop']);
    expect(r.log).toContain('resume');
    expect(r.handoff.state).toBe('PLAYING');
  });

  it('counts afresh for the next raised hand', async () => {
    const r = answeringRoom(1);
    r.handoff.raiseHand(ctxOf());
    await flush();
    r.handoff.sendUserText('a');
    await flush();
    expect(r.handoff.state).toBe('PLAYING');

    r.handoff.raiseHand(ctxOf());
    await flush();
    r.handoff.sendUserText('b');
    await flush();

    expect(r.log).toContain('user:b');
    expect(r.log).toContain('speak:answer to b');
  });

  it('leaves a doubt under the cap alone', async () => {
    const r = answeringRoom();
    const ctx = ctxOf();
    r.handoff.raiseHand(ctx);
    await flush();
    for (let i = 1; i < DEFAULT_MAX_STUDENT_TURNS; i += 1) {
      r.handoff.sendUserText(`q${i}`);
      await flush();
    }
    expect(r.handoff.state).toBe('LIVE');
    expect(r.log).not.toContain(`speak:${closingLine(ctx)}`);
  });
});
