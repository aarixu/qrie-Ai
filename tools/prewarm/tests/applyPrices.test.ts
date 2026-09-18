import { describe, expect, it } from 'vitest';
import { assertServiceRoleKey, diffPrices, latestLive } from '../../bin/apply-prices.mjs';

/**
 * apply-prices never decides a number — the numbers are Aarav's, in
 * tools/sql/model_price.sql. What it decides is WHETHER each number is
 * already live, and these tests pin that decision: missing, changed,
 * unchanged, with history (effective_from) read as "latest wins".
 */

const fileRows = [
  { provider: 'vertex', model: 'gemini-3.7-flash', unit: 'prompt_token', inrPerUnit: (0.75 / 1e6) * 95.6, note: 'intro rate' },
  { provider: 'vertex', model: 'gemini-3.7-flash', unit: 'output_token', inrPerUnit: (3.75 / 1e6) * 95.6, note: null },
  { provider: 'openrouter', model: 'deepgram/aura-2', unit: 'character', inrPerUnit: (30 / 1e6) * 95.6, note: null },
];

describe('diffing the file against the live table', () => {
  it('an empty live table means every row is missing', () => {
    const d = diffPrices(fileRows, []);
    expect(d.missing).toHaveLength(3);
    expect(d.changed).toHaveLength(0);
    expect(d.unchanged).toHaveLength(0);
  });

  it('a live row at the same price is unchanged, tolerant of numeric-as-string', () => {
    const live = [
      {
        provider: 'vertex',
        model: 'gemini-3.7-flash',
        unit: 'prompt_token',
        // PostgREST serialises numeric as a string, rounded to what was stored.
        inr_per_unit: '0.0000717',
        effective_from: '2026-09-14T00:00:00+00:00',
        note: 'intro rate',
      },
    ];
    const d = diffPrices(fileRows, live);
    expect(d.unchanged.map((r) => r.unit)).toEqual(['prompt_token']);
    expect(d.missing).toHaveLength(2);
  });

  it('only the LATEST effective_from counts; an old price under a new one is unchanged', () => {
    const live = [
      { provider: 'vertex', model: 'gemini-3.7-flash', unit: 'prompt_token', inr_per_unit: '0.000009', effective_from: '2025-01-01T00:00:00+00:00', note: null },
      { provider: 'vertex', model: 'gemini-3.7-flash', unit: 'prompt_token', inr_per_unit: '0.0000717', effective_from: '2026-09-14T00:00:00+00:00', note: null },
    ];
    const latest = latestLive(live);
    expect(latest.get('vertex/gemini-3.7-flash/prompt_token')?.effective_from).toBe(
      '2026-09-14T00:00:00+00:00',
    );
    const d = diffPrices(fileRows, live);
    expect(d.changed).toHaveLength(0);
    expect(d.unchanged).toHaveLength(1);
  });

  it('a genuinely different live price marks the row changed', () => {
    const live = [
      { provider: 'vertex', model: 'gemini-3.7-flash', unit: 'prompt_token', inr_per_unit: '0.000143', effective_from: '2026-09-14T00:00:00+00:00', note: null },
    ];
    const d = diffPrices(fileRows, live);
    expect(d.changed.map((r) => r.unit)).toEqual(['prompt_token']);
  });
});

describe('the key guard, read from cost-report', () => {
  it('refuses to run without a service role key', () => {
    expect(() => assertServiceRoleKey(undefined, 'anon-key')).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('refuses the anon key by value, not just by absence', () => {
    expect(() => assertServiceRoleKey('anon-key', 'anon-key')).toThrow(/anon/i);
  });

  it('accepts a key that is neither missing nor the anon key', () => {
    expect(() => assertServiceRoleKey('sr-key', 'anon-key')).not.toThrow();
  });
});
