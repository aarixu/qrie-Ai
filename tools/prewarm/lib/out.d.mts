/** The contract `out.mjs` has for the tests that import it. */
export declare function writeClassTo(
  dir: string,
  saved: {
    id: string;
    entry: { id: string; path: string; [key: string]: unknown };
    files: { path: string; body: string; encoding: 'utf8' | 'base64' }[];
  },
  as?: string,
): string;
