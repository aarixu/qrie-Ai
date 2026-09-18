/**
 * THE CONTRACT `modelPriceSql.mjs` HAS. See topics.d.mts for why.
 *
 * tools/sql/model_price.sql is applied by no script ON PURPOSE — prices are a
 * fact about somebody else's contract, so a human confirms them. This parses
 * it without applying it, so the pre-warm runner can price its own spend from
 * the same file the database will eventually be given.
 */

/** One priced line, with the psql arithmetic already evaluated to rupees. */
export interface ParsedPriceRow {
  provider: string;
  model: string;
  unit: string;
  inrPerUnit: number;
  note: string | null;
}

export interface ParsedModelPrices {
  /** The `\set rate` the file declares — rupees per USD. Null if absent. */
  rate: number | null;
  /** The "Sources, checked YYYY-MM-DD" date, so a stale price can be seen. */
  checked: string | null;
  rows: ParsedPriceRow[];
}

/**
 * The tiny arithmetic psql itself would do: `0.75 / 1e6 * :rate`. Deliberately
 * not eval() — the file is trusted but a parser that executes its input is a
 * habit worth not forming.
 */
export declare function evalArithmetic(expr: string, vars?: Record<string, number>): number;

/** Throws when it parses zero rows, because a silent empty price table is the failure. */
export declare function parseModelPriceSql(text: string): ParsedModelPrices;
