/**
 * WHY THIS FILE EXISTS: the pipeline is TypeScript that only vite has ever
 * run. Node 22 strips types natively, so `node` can execute
 * packages/class-prep/src/*.ts directly — but some packages import their own
 * files WITHOUT an extension (`./syllabus` in packages/syllabus/src/index.ts,
 * `./layout` in board-layout), which vite resolves and Node's ESM loader
 * refuses. This hook adds the one behaviour the runner needs: when a relative
 * specifier fails to resolve, try `<specifier>.ts`, then `/index.ts`.
 *
 * Registered SYNCHRONOUSLY (node:module registerHooks, Node >= 22.15) and
 * FIRST: run.mjs's only static import is this file, and everything that
 * touches the pipeline is imported dynamically after it, so the hook is in
 * place before any extensionless import is seen. It changes how modules are
 * FOUND, never what they contain.
 */
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        for (const suffix of ['.ts', '/index.ts']) {
          try {
            return nextResolve(`${specifier}${suffix}`, context);
          } catch {
            // fall through to the original error
          }
        }
      }
      throw error;
    }
  },
});
