import { describe, expect, it } from 'vitest';
import type { DoubtContext } from '../src/context';
import { createStubAgent } from '../src/agent';
import { createHandoff } from '../src/handoff';

/**
 * THE APP'S OPENER IS NOT A STUDENT TURN (fifth review, 2026-09-29).
 *
 * The "I'm not sure" chip says its words FOR the child. The scripted
 * stand-in answers a child's first message and closes on the second, so the
 * opener used to spend its one answer: the child's first real question then
 * got "sounds like that's clear now" and the doubt closed.
 */
const ctx: DoubtContext = {
  lessonId: 'l1',
  beatId: 'b1',
  beatTopic: 'chambers of the heart',
  transcriptSoFar: 'n0',
  visibleElementIds: [],
  recentBeats: [{ id: 'b1', topic: 'chambers of the heart' }],
  outcomeIds: [],
};

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function room(maxStudentTurns?: number) {
  const said: string[] = [];
  const handoff = createHandoff({
    agent: createStubAgent({ opening: false }),
    speak: (text, onSaid) => {
      said.push(text);
      onSaid(text);
      return Promise.resolve({ halted: false });
    },
    onPause: () => undefined,
    onResume: () => undefined,
    ...(maxStudentTurns === undefined ? {} : { maxStudentTurns }),
  });
  return { handoff, said };
}

describe('an opener the app sends for the child', () => {
  it('does not use up the stand-in’s answer to their first real question', async () => {
    const r = room();
    r.handoff.raiseHand(ctx);
    await flush();
    r.handoff.sendUserText("I'm not sure how to answer this question.", { opener: true });
    await flush();
    r.handoff.sendUserText('why four chambers?');
    await flush();
    // The stand-in's answer to a first question (it no longer opens on "Good
    // question": persona v3 bans praise that fits any question).
    expect(r.said.some((l) => l.startsWith("It's completely natural to feel confused here."))).toBe(true);
    expect(r.handoff.state).toBe('LIVE');
  });

  it('does not count toward the turn cap', async () => {
    const r = room(1);
    r.handoff.raiseHand(ctx);
    await flush();
    r.handoff.sendUserText('opener', { opener: true });
    await flush();
    expect(r.handoff.state).toBe('LIVE');
  });
});
