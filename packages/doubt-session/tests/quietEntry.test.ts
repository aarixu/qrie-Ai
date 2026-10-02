import { describe, it, expect } from 'vitest';
import type { DoubtContext } from '../src/context';
import type { AgentAdapter } from '../src/agent';
import { createHandoff } from '../src/handoff';
import { entryLine } from '../src/bridge';

/**
 * A DOUBT THE STUDENT STARTED BY TALKING (Aarav, 2026-10-02: "tutor interrupt
 * nahi ho rahi").
 *
 * A raised hand gets her entry line — "what didn't make sense?" — because the
 * student has not said anything yet. A student who interrupted her by speaking
 * is already in the middle of saying it: the line would be spoken over them.
 * So that doubt opens quietly: the class pauses and the tutor is ready at once.
 */

const ctxOf = (): DoubtContext => ({
  lessonId: 'l1',
  beatId: 'b1',
  beatTopic: 'lactic acid',
  transcriptSoFar: 'n0',
  visibleElementIds: [],
  recentBeats: [{ id: 'b1', topic: 'lactic acid' }],
  outcomeIds: [],
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

function room() {
  const log: string[] = [];
  const agent: AgentAdapter = {
    start: () => ({ sendUserText: (t: string) => void log.push(`user:${t}`), stop: () => void log.push('stop') }),
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
  });
  return { handoff, log };
}

describe('a doubt opened by the student talking', () => {
  it('pauses the class and is ready for them without saying her entry line', async () => {
    const r = room();
    r.handoff.raiseHand(ctxOf(), { quiet: true });
    expect(r.log).toEqual(['pause']);
    await flush();
    expect(r.handoff.state).toBe('LIVE');
    r.handoff.sendUserText('why does it hurt?');
    expect(r.log).toEqual(['pause', 'user:why does it hurt?']);
  });

  it('still says the entry line for a raised hand', async () => {
    const r = room();
    r.handoff.raiseHand(ctxOf());
    await flush();
    expect(r.log).toContain(`speak:${entryLine(ctxOf())}`);
  });
});
