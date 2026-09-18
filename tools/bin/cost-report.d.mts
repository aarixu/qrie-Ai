/**
 * THE CONTRACT `cost-report.mjs` HAS, so its .ts tests can read it.
 *
 * Reads the books back: usage_event and usage_cost joined to model_price at
 * READ time, so correcting a price re-prices history. It refuses the anon key
 * outright — a cost report that silently returns an empty result because RLS
 * hid everything is worse than one that will not run.
 */

export declare function runReport(options: {
  url: string;
  key: string;
  days?: number;
  /** Print Rs per student-hour, with the formula shown rather than asserted. */
  studentHour?: boolean;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  /**
   * Where the report goes. Typed as taking a single line because that is what
   * runReport passes and what the tests capture; a variadic console.log
   * satisfies it, a line-collecting stub does too, and neither has to pretend
   * to accept arguments it will never see.
   */
  log?: (line: string) => unknown;
}): Promise<void>;
