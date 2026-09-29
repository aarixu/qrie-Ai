import { describe, expect, it } from 'vitest';
import type { DoubtContext } from '../src/context';
import type { AgentAdapter, AgentIO } from '../src/agent';
import { createHandoff } from '../src/handoff';
import { closingLine } from '../src/bridge';

/**
 * ONE REPLY, SEVERAL LINES, AND INK THAT APPEARS WITH EACH (T2.4).
 *
 * The typed tutor now answers in steps — a sentence and the ink written while
 * she says it. Two things the seam has to carry for that:
 *
 *   - `onStart`: called when her voice actually starts the line, so the board
 *     reveals that step's ink then. The handoff passes it to the speaker and
 *     never calls it itself; a halted handoff speaks nothing and so reveals
 *     nothing.
 *   - `more`: another line of the SAME reply follows. The turn cap closes the
 *     doubt after her answer to the last allowed turn — and with several lines
 *     per answer, "the first line she finishes" was only the first sentence of
 *     it. The rest was cut off by the closing line.
 */

const ctx: DoubtContext = {
  lessonId: 'l1',
  beatId: 'b1',
  beatTopic: 'expanding a bracket',
  transcriptSoFar: 'n0',
  visibleElementIds: ['e1'],
  recentBeats: [{ id: 'b1', topic: 'expanding a bracket' }],
  outcomeIds: [],
};

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

function room(opts: { maxStudentTurns?: number; halted?: (text: string) => boolean } = {}) {
  const log: string[] = [];
  let io: AgentIO | null = null;
  const agent: AgentAdapter = {
    start(_ctx, agentIo) {
      io = agentIo;
      return { sendUserText: (t) => void log.push(`user:${t}`), stop: () => void log.push('stop') };
    },
  };
  const handoff = createHandoff({
    agent,
    speak: async (text, onSaid, onStart) => {
      log.push(`speak:${text}`);
      onSaid(text);
      if (opts.halted?.(text)) return { halted: true };
      onStart?.();
      return { halted: false };
    },
    onPause: () => void log.push('pause'),
    onResume: () => void log.push('resume'),
    ...(opts.maxStudentTurns === undefined ? {} : { maxStudentTurns: opts.maxStudentTurns }),
  });
  return { handoff, log, io: () => io! };
}

describe('io.say with a start hook', () => {
  it('hands onStart to the speaker, which calls it when the line starts', async () => {
    const r = room();
    r.handoff.raiseHand(ctx);
    await flush();
    const started: string[] = [];
    await r.io().say('Seven times three.', { onStart: () => started.push('ink') });
    expect(started).toEqual(['ink']);
  });

  it('a halted handoff speaks nothing, so nothing is revealed', async () => {
    const r = room();
    r.handoff.raiseHand(ctx);
    await flush();
    r.handoff.halt();
    const started: string[] = [];
    await r.io().say('After the halt.', { onStart: () => started.push('ink') });
    expect(started).toEqual([]);
    expect(r.log).not.toContain('speak:After the halt.');
  });

  it('a line the speaker reports as halted halts the machine, and the next line is never spoken', async () => {
    const r = room({ halted: (t) => t === 'distress' });
    r.handoff.raiseHand(ctx);
    await flush();
    await r.io().say('distress', { onStart: () => undefined, more: true });
    await r.io().say('the line after', { onStart: () => undefined });
    expect(r.handoff.state).toBe('HALTED');
    expect(r.log).not.toContain('speak:the line after');
  });
});

describe('the turn cap and a reply of several lines', () => {
  it('closes after the LAST line of the capped answer, not after its first', async () => {
    const r = room({ maxStudentTurns: 1 });
    r.handoff.raiseHand(ctx);
    await flush();
    r.handoff.sendUserText('why 21?');
    await r.io().say('Look at the bracket.', { more: true });
    expect(r.handoff.state).toBe('LIVE');
    await r.io().say('Seven times three is twenty-one.', { more: true });
    expect(r.handoff.state).toBe('LIVE');
    await r.io().say('So the bracket gives twenty-one.');
    await flush();
    const spoken = r.log.filter((l) => l.startsWith('speak:'));
    expect(spoken.slice(-4)).toEqual([
      'speak:Look at the bracket.',
      'speak:Seven times three is twenty-one.',
      'speak:So the bracket gives twenty-one.',
      `speak:${closingLine(ctx)}`,
    ]);
  });

  it('an agent that says one line per message is capped exactly as before', async () => {
    const r = room({ maxStudentTurns: 1 });
    r.handoff.raiseHand(ctx);
    await flush();
    r.handoff.sendUserText('why?');
    await r.io().say('Because.');
    await flush();
    expect(r.log.filter((l) => l.startsWith('speak:')).at(-1)).toBe(`speak:${closingLine(ctx)}`);
  });
});
