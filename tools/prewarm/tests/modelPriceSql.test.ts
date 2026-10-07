import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseModelPriceSql } from '../lib/modelPriceSql.mjs';

// path.resolve, not `new URL(rel, import.meta.url)` — vite rewrites that
// pattern as an asset reference and hands back a non-file URL.
const REAL = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../sql/model_price.sql'),
  'utf8',
);

/**
 * The parser reads the REAL operator file, because that file is the contract:
 * apply-prices diffs it against the live table, and the pre-warm runner prices
 * its own spend from it. A fixture would drift from Aarav's numbers silently.
 */
describe('parsing tools/sql/model_price.sql', () => {
  it('reads the rate, the checked date, and every row', () => {
    const parsed = parseModelPriceSql(REAL);
    expect(parsed.rate).toBe(95.6);
    expect(parsed.checked).toBe('2026-09-13');
    // 4 Gemini models x 3 units, plus the deliberate zero image row, plus the
    // four Vertex TTS rows (3.8 Flash-Lite, her voice, and 3.1 underneath it),
    // plus the two OpenRouter speech rows. Counting exactly is the point: a row
    // the parser drops is a price apply-prices would silently never apply.
    expect(parsed.rows).toHaveLength(18);
  });

  it('prices the Vertex speech fallback per audio token', () => {
    const tts = parseModelPriceSql(REAL).rows.find(
      (r) => r.provider === 'vertex' && r.model === 'gemini-3.1-flash-tts-preview' && r.unit === 'output_token',
    );
    expect(tts?.inrPerUnit).toBeCloseTo((20 / 1e6) * 95.6, 12);
  });

  it('prices her voice, Gemini 3.8 Flash-Lite, per text token and per audio token', () => {
    const rows = parseModelPriceSql(REAL).rows.filter((r) => r.provider === 'vertex' && r.model === 'gemini-3.8-flash-lite-tts');
    const unit = (u: string) => rows.find((r) => r.unit === u);
    expect(unit('prompt_token')?.inrPerUnit).toBeCloseTo((0.5 / 1e6) * 95.6, 12);
    expect(unit('output_token')?.inrPerUnit).toBeCloseTo((6 / 1e6) * 95.6, 12);
    // The price doubles on 1 Jan 2027; the row says so, so nobody trusts it past then.
    expect(unit('output_token')?.note).toMatch(/2027-01-01/);
  });

  it('evaluates the psql arithmetic to rupees per unit', () => {
    const parsed = parseModelPriceSql(REAL);
    const aura = parsed.rows.find(
      (r) => r.provider === 'openrouter' && r.model === 'deepgram/aura-2',
    );
    expect(aura?.unit).toBe('character');
    expect(aura?.inrPerUnit).toBeCloseTo((30 / 1e6) * 95.6, 12);

    const flashIn = parsed.rows.find(
      (r) =>
        r.provider === 'vertex' &&
        r.model === 'gemini-3.7-flash' &&
        r.unit === 'prompt_token',
    );
    expect(flashIn?.inrPerUnit).toBeCloseTo((0.75 / 1e6) * 95.6, 12);
  });

  it('keeps the deliberate zero on the image row, with its note', () => {
    const parsed = parseModelPriceSql(REAL);
    const image = parsed.rows.find(
      (r) => r.model === 'gemini-3.1-flash-image' && r.unit === 'image',
    );
    expect(image?.inrPerUnit).toBe(0);
    expect(image?.note).toMatch(/ZERO on purpose/);
  });

  it('a null note stays null', () => {
    const parsed = parseModelPriceSql(REAL);
    const lite = parsed.rows.find(
      (r) => r.model === 'gemini-3.1-flash-lite' && r.unit === 'prompt_token',
    );
    expect(lite?.note).toBeNull();
  });

  it('refuses an expression that is not arithmetic', () => {
    const evil = REAL.replace('0.75 / 1e6 * :rate', 'require("fs") * :rate');
    expect(() => parseModelPriceSql(evil)).toThrow(/arithmetic/);
  });
});
