/**
 * THE CONTRACT `apply-prices.mjs` HAS, so its .ts tests can read it.
 *
 * tools/sql/model_price.sql is applied by no script on purpose: prices are a
 * fact about somebody else's contract. This diffs the file against the live
 * table and applies ONLY with an explicit --yes, so the numbers still pass
 * through a human while the comparison stops being a manual read.
 */

import type { ParsedPriceRow } from '../prewarm/lib/modelPriceSql.d.mts';

/** A row as PostgREST returns it: numerics arrive as strings. */
export interface LivePriceRow {
  provider: string;
  model: string;
  unit: string;
  inr_per_unit: string | number;
  effective_from: string;
}

/** A file row paired with the live row it was compared against. */
export type ComparedRow = ParsedPriceRow & { live: LivePriceRow };

/**
 * Throws when handed the anon key, and when handed NOTHING — an absent
 * SUPABASE_SERVICE_ROLE_KEY is the ordinary case, because the key writes the
 * price table and so is deliberately not in .env.local. The parameter is
 * optional-by-value rather than optional-by-position for that reason: callers
 * pass `process.env.X` straight in and the guard is what reads it.
 *
 * Refusing the anon key matters for the same reason cost-report.mjs refuses
 * it: RLS would hide the rows and the tool would report success on an empty
 * read.
 */
export declare function assertServiceRoleKey(key: string | undefined, anonKey?: string): void;

/** effective_from is part of the key, so only the newest row for each price counts. */
export declare function latestLive(liveRows: readonly LivePriceRow[]): Map<string, LivePriceRow>;

export declare function diffPrices(
  fileRows: readonly ParsedPriceRow[],
  liveRows: readonly LivePriceRow[],
  tolerance?: number,
): { missing: ParsedPriceRow[]; changed: ComparedRow[]; unchanged: ComparedRow[] };

export declare function fetchLivePrices(options: {
  url: string;
  key: string;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}): Promise<LivePriceRow[]>;

export declare function insertRows(options: {
  url: string;
  key: string;
  rows: readonly ParsedPriceRow[];
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}): Promise<void>;
