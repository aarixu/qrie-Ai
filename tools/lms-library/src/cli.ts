import { libraryItems, loadBanks, outcomes, withoutOldBooks, type Bank, type SkippedGrade } from './library.ts';
import { supabaseLibraryStore, upsertOutcomes } from './supabaseLibraryStore.ts';
import { syncLibrary } from './sync.ts';

/**
 * Load the Qrie library into lms.item, and its maps' outcomes into
 * lms.outcome: `node tools/lms-library/src/cli.ts [--apply] [--include-old-books-6-9]`
 *
 * Without --apply it is a DRY RUN that reads the banks and counts them.
 * --apply writes with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
 * environment, adds only items not already stored, and reports — without
 * overwriting — any whose question or key has changed since.
 *
 * Classes 6-9 are left out, items and outcomes both, and counted class by
 * class in the output: their banks come from the old NCERT books
 * (OLD_BOOK_GRADES), and so do their outcomes' chapter names.
 * --include-old-books-6-9 loads them too. Leaving them out removes nothing a
 * project already holds.
 *
 * What that costs, on a project that holds no Class 6-9 outcomes: those
 * classes have no chapters, so no practice (lms.practice_chapters lists the
 * chapters of a class's outcomes), no topics to file questions under
 * (lms.library_topics), and no mastery (the brain's beliefs are per outcome),
 * until new-book content is loaded. Their teachers can still set work: their
 * own questions, written tasks, photos and tests on paper need no chapter.
 */

export interface CliDeps {
  log(line: string): void;
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}

export const INCLUDE_OLD_BOOKS = '--include-old-books-6-9';

function choose(all: Bank[], includeOld: boolean, log: (line: string) => void): Bank[] {
  if (includeOld) {
    log(`Including Classes 6-9 from the old NCERT books (${INCLUDE_OLD_BOOKS}).`);
    return all;
  }
  const { kept, skipped } = withoutOldBooks(all);
  if (skipped.length) {
    log('Skipped Classes 6-9: their banks come from the old NCERT books, not the current syllabus.');
    log(
      '  So Classes 6-9 will have no chapters on this project, unless it holds some already: no practice, no topics, no mastery until new-book content is loaded.',
    );
    skipped.forEach((s: SkippedGrade) =>
      log(`  Class ${s.grade}: ${s.items} items and ${s.outcomes} outcomes (${s.banks.join(', ')})`),
    );
    log(`  Run again with ${INCLUDE_OLD_BOOKS} to load them as well.`);
  }
  return kept;
}

export async function run(args: string[], deps: CliDeps): Promise<number> {
  const banks = choose(loadBanks(), args.includes(INCLUDE_OLD_BOOKS), deps.log);
  const items = libraryItems(banks);
  const rows = outcomes(banks);

  if (!args.includes('--apply')) {
    deps.log('DRY RUN — nothing was written.');
    deps.log(`  ${items.length} items from ${banks.length} banks`);
    for (const b of banks) deps.log(`    ${b.name}: ${b.probes.probes.length}`);
    deps.log(`  ${rows.length} outcomes, each with its chapter`);
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
  await upsertOutcomes(url, key, rows, deps.fetchImpl);
  deps.log(`Outcomes: ${rows.length} written.`);
  return 0;
}

// Run only when invoked as the script, never when a test imports it.
if (process.argv[1] && /lms-library[\\/]src[\\/]cli\.ts$/.test(process.argv[1])) {
  run(process.argv.slice(2), { log: (l) => console.log(l), env: process.env }).then((code) => process.exit(code));
}
