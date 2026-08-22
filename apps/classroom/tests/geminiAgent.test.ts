import { describe, expect, it } from 'vitest';
import { buildDoubtSystemPrompt, parseAgentReply } from '../src/lib/geminiAgent';
import type { DoubtContext } from '@ai-tutor/doubt-session';

const ctx: DoubtContext = {
  lessonId: 'l1',
  beatId: 'chambers',
  beatTopic: 'Four chambers',
  transcriptSoFar: 'The heart is a pump.\nIt has four chambers.',
  visibleElementIds: ['b_ra'],
  recentBeats: [
    { id: 'pump', topic: 'The heart is a pump' },
    { id: 'chambers', topic: 'Four chambers' },
  ],
};

describe('buildDoubtSystemPrompt', () => {
  it('carries the moment, the transcript and every recall target', () => {
    const p = buildDoubtSystemPrompt(ctx);
    expect(p).toContain('Four chambers');
    expect(p).toContain('The heart is a pump.');
    expect(p).toContain('id "pump"');
    expect(p).toContain('id "chambers"');
    expect(p).toContain('"recallBeatId"');
  });
});

describe('parseAgentReply', () => {
  const valid = new Set(['pump', 'chambers']);

  it('parses a clean reply', () => {
    const r = parseAgentReply('{"say":"Look here.","recallBeatId":"pump","done":false}', valid);
    expect(r).toEqual({ say: 'Look here.', recallBeatId: 'pump', done: false });
  });

  it('strips markdown fences', () => {
    const r = parseAgentReply('```json\n{"say":"Hi","recallBeatId":null,"done":true}\n```', valid);
    expect(r.say).toBe('Hi');
    expect(r.done).toBe(true);
  });

  it('drops a hallucinated recall id', () => {
    const r = parseAgentReply('{"say":"See this","recallBeatId":"ghost","done":false}', valid);
    expect(r.recallBeatId).toBeNull();
  });

  it('falls back to raw text when the reply is not JSON', () => {
    const r = parseAgentReply('Sorry, plain prose answer.', valid);
    expect(r.say).toContain('plain prose');
    expect(r.done).toBe(false);
    expect(r.recallBeatId).toBeNull();
  });

  it('falls back when say is missing', () => {
    const r = parseAgentReply('{"recallBeatId":"pump","done":true}', valid);
    expect(r.say.length).toBeGreaterThan(0);
    expect(r.done).toBe(false);
  });
});
