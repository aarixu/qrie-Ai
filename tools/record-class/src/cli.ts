import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * ENTRY POINT — and the one piece of machinery that lets this tool SHARE the
 * narration contract with `@ai-tutor/voice` instead of keeping a second copy.
 *
 * The manifest shape, the narration hash, the manifest reader and the tutor's
 * speech prompt all belong to that package, because the player is the side
 * that has to trust them. Tools are not workspaces, so a tool reaches a package
 * by relative path — but the package's own modules import each other without
 * file extensions (`./hash`), which is what Vite and Vitest resolve and what
 * Node's ESM resolver refuses. Under plain `node` the only other way to run
 * this CLI would be to redeclare the contract here, and two copies of a
 * contract is how a recorded class silently stops being played.
 *
 * So the resolver is taught the two things the bundlers already know: a
 * relative specifier may be missing its `.ts`, and `@ai-tutor/x` is
 * `packages/x/src`. The CLI itself is then loaded with a dynamic import,
 * because a static import here would be resolved before the hook exists.
 */

const REPO_ROOT = new URL('../../../', import.meta.url);

const WORKSPACE_SCOPE = '@ai-tutor/';

/** Specifiers Node can already resolve on its own are left entirely alone. */
const HAS_EXTENSION = /\.(ts|tsx|js|mjs|cjs|json|node)$/;

const exists = (url: URL): boolean => fs.existsSync(fileURLToPath(url));

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(WORKSPACE_SCOPE)) {
      const index = new URL(`packages/${specifier.slice(WORKSPACE_SCOPE.length)}/src/index.ts`, REPO_ROOT);
      if (exists(index)) return { url: index.href, shortCircuit: true };
    } else if (specifier.startsWith('.') && context.parentURL && !HAS_EXTENSION.test(specifier)) {
      const withExtension = new URL(`${specifier}.ts`, context.parentURL);
      if (exists(withExtension)) return { url: withExtension.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { run } = await import('./main.ts');

try {
  await run(process.argv.slice(2));
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
