import type { RelayStatus, Today } from '@ai-tutor/admin-client';
import { describe, expect, it } from 'vitest';
import { loadToday } from '../src/lib/load-today.ts';

const relay = { halted: false, ceilingUnits: 50000, unitsToday: 0, studentsNow: 3 } as unknown as RelayStatus;
const today = { environment: 'TEST' } as unknown as Today;

describe('loading the home page', () => {
  it('keeps the relay status (and so the stop button) when the home page function fails', async () => {
    const got = await loadToday({
      today: () => Promise.reject(new Error('lms.founder_schools failed')),
      relayStatus: () => Promise.resolve(relay),
    });
    expect(got.relay).toBe(relay);
    expect(got.today).toBeNull();
    expect(got.error).toBe('lms.founder_schools failed');
  });

  it('keeps the home page when only the relay status fails', async () => {
    const got = await loadToday({ today: () => Promise.resolve(today), relayStatus: () => Promise.reject(new Error('timeout')) });
    expect(got).toEqual({ today, relay: null, error: 'timeout' });
  });

  it('has no error when both load', async () => {
    expect(await loadToday({ today: () => Promise.resolve(today), relayStatus: () => Promise.resolve(relay) })).toEqual({
      today,
      relay,
      error: '',
    });
  });
});
