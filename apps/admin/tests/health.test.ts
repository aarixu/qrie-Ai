import type { Level, SignalKey } from '@ai-tutor/admin-client';
import { describe, expect, it } from 'vitest';
import { bySeverity, LEVEL_RANK, LEVEL_TONE, SIGNAL_TITLE } from '../src/lib/health.ts';

/** How a school's health reads on screen. Written first. */

const LEVELS: Level[] = ['green', 'amber', 'red', 'grey'];

describe('health on screen', () => {
  it('each level has a tone and grey is never the healthy tone', () => {
    expect(LEVEL_TONE).toEqual({ green: 'ok', amber: 'warn', red: 'bad', grey: 'grey' });
    expect(LEVEL_TONE.grey).not.toBe(LEVEL_TONE.green);
  });

  it('bySeverity puts red first, then amber, grey, green, and then by name', () => {
    const rows = [
      { name: 'Zeta', healthLevel: 'green' as Level },
      { name: 'Beta', healthLevel: 'grey' as Level },
      { name: 'Alpha', healthLevel: 'green' as Level },
      { name: 'Gamma', healthLevel: 'red' as Level },
      { name: 'Delta', healthLevel: 'amber' as Level },
      { name: 'Alpha2', healthLevel: 'red' as Level },
    ];
    expect([...rows].sort(bySeverity).map((r) => r.name)).toEqual(['Alpha2', 'Gamma', 'Delta', 'Beta', 'Alpha', 'Zeta']);
  });

  it('every signal key has a title', () => {
    const keys: SignalKey[] = ['licence', 'payment', 'seats', 'activation', 'teaching', 'learning', 'attendance', 'safety', 'lastActive'];
    expect(Object.keys(SIGNAL_TITLE).sort()).toEqual([...keys].sort());
    expect(SIGNAL_TITLE.lastActive).toBe('Last active');
    for (const k of keys) expect(SIGNAL_TITLE[k]).toMatch(/^[A-Z][a-z ]+$/);
  });

  it('LEVEL_RANK orders the four levels', () => {
    expect([...LEVELS].sort((a, b) => LEVEL_RANK[b] - LEVEL_RANK[a])).toEqual(['red', 'amber', 'grey', 'green']);
  });
});
