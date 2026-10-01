/**
 * THE CONTRACT `main.mjs` HAS for the tests that import it. See topics.d.mts
 * for why these exist at all.
 */

export interface PrewarmArgs {
  syllabi: string[];
  chapter?: string;
  topic?: string;
  dryRun: boolean;
  spend: boolean;
  review: boolean;
  acceptUnreviewed: boolean;
  force: boolean;
  /** Lay out again and keep the classes refused at the end (state/refused/). */
  rekeep: boolean;
  relay?: string;
  token?: string;
  stateDir: string;
}

export declare function parseArgs(argv: readonly string[]): PrewarmArgs;
export declare function main(argv: readonly string[]): Promise<void>;
