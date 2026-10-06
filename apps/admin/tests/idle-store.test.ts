import { IDLE_LIMIT_MINUTES } from '@ai-tutor/admin-client';
import { describe, expect, it } from 'vitest';
import { isStale, LAST_ACTIVE_KEY, markActive, type KeyValue } from '../src/lib/idle-store.ts';

function memory(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}
const minute = 60_000;

describe('the idle clock that outlives the tab', () => {
  it('is stale when there is no record: a session reopened from storage with no activity behind it', () => {
    expect(isStale(memory(), 1_000_000)).toBe(true);
  });

  it('is fresh right after activity, and stale at the limit, even across a closed and reopened tab', () => {
    const s = memory();
    markActive(s, 0);
    expect(s.data.get(LAST_ACTIVE_KEY)).toBe('0');
    expect(isStale(s, IDLE_LIMIT_MINUTES * minute - 1)).toBe(false);
    expect(isStale(s, IDLE_LIMIT_MINUTES * minute)).toBe(true);
  });

  it('treats a record it cannot read, or storage that throws, as stale', () => {
    const s = memory();
    s.setItem(LAST_ACTIVE_KEY, 'not a number');
    expect(isStale(s, 0)).toBe(true);
    const broken: KeyValue = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
    };
    expect(isStale(broken, 0)).toBe(true);
    expect(() => markActive(broken, 0)).not.toThrow();
  });
});
