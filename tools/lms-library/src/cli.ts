import { libraryItems, loadBanks } from './library.ts';
import { supabaseLibraryStore } from './supabaseLibraryStore.ts';
import { syncLibrary } from './sync.ts';

/**
 * Load the Qrie library into lms.item: `node tools/lms-library/src/cli.ts [--apply]`
 *
 * Without --apply it is a DRY RUN that reads the banks and counts them.
 * --apply writes with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
 * environment, adds only items not already stored, and reports — without
 * overwriting — any whose question or key has changed since.
 */

export interface CliDeps {
  log(line: string): void;
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}

export async function run(args: string[], deps: CliDeps): Promise<number> {
  const banks = loadBanks();
  const items = libraryItems(banks);

  if (!args.includes('--apply')) {
    deps.log('DRY RUN — nothing was written.');
    deps.log(`  ${items.length} items from ${banks.length} banks`);
    for (const b of banks) deps.log(`    ${b.name}: ${b.probes.probes.length}`);
    deps.log('Run again with --apply to load them.');
    return 0;
  }

  const url = deps.env.SUPABASE_URL;
  const key = deps.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    deps.log('--apply needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.');
    return 1;
  }

  const result = await syncLibrary(items, supabaseLibraryStore(url, key, deps.fetchImpl));
  deps.log(`Library: ${result.inserted} added, ${result.unchanged} already there, ${result.changed.length} changed.`);
  for (const ref of result.changed) {
    deps.log(`  CHANGED, NOT OVERWRITTEN: ${ref} — give the new version a new ref.`);
  }
  return 0;
}

// Run only when invoked as the script, never when a test imports it.
if (process.argv[1] && /lms-library[\\/]src[\\/]cli\.ts$/.test(process.argv[1])) {
  run(process.argv.slice(2), { log: (l) => console.log(l), env: process.env }).then((code) => process.exit(code));
}
