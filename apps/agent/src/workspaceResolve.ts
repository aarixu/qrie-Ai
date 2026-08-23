import { registerHooks } from 'node:module';

/**
 * MAKING @ai-tutor/* IMPORTABLE FROM PLAIN NODE.
 *
 * The monorepo ships TypeScript source and no build step: `packages/*` are
 * imported straight from `src/index.ts`. Inside those packages the relative
 * imports are extensionless (`./traits`), which is what Vite and Vitest expect
 * — and Node's ESM resolver flatly refuses. It wants `./traits.ts`.
 *
 * apps/agent is the first consumer of these packages that is neither Vite nor
 * Vitest: it runs on bare `node src/worker.ts`. So the mismatch is handled
 * here, once, rather than by asking every package to write imports for a
 * runtime it does not use.
 *
 * The hook is a fallback, not a rewrite: normal resolution is tried first and
 * only a specifier Node could not resolve at all is retried with an extension.
 * Nothing that resolves today resolves differently because of this file.
 *
 * DELETE THIS the day every package writes explicit `.ts` extensions in its
 * relative imports — then Node needs no help and this file is dead weight.
 */
export function enableWorkspaceResolution(): void {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        for (const suffix of ['.ts', '/index.ts']) {
          try {
            return nextResolve(specifier + suffix, context);
          } catch {
            // Not this one. Keep the ORIGINAL failure to throw below: a
            // "cannot find ./traits.ts" would send the next reader looking for
            // a file whose name they never wrote.
          }
        }
        throw error;
      }
    },
  });
}
