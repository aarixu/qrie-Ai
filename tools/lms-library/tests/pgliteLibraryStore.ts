import type { PGlite } from '@electric-sql/pglite';
import type { LibraryItem } from '../src/library.ts';
import { fingerprint } from '../src/library.ts';
import type { LibraryStore } from '../src/sync.ts';

/** The library sync's store on the migration harness's Postgres. Test-only. */
export function pgliteLibraryStore(db: PGlite): LibraryStore {
  return {
    async existing() {
      const { rows } = await db.query<{ library_ref: string; stem: string; options: string[]; correct_index: number }>(
        `select library_ref, stem, options, correct_index from lms.item where library_ref is not null`,
      );
      return new Map(
        rows.map((r) => [r.library_ref, fingerprint({ stem: r.stem, options: r.options, correctIndex: r.correct_index })]),
      );
    },
    async insert(items: LibraryItem[]) {
      for (const i of items) {
        await db.query(
          `insert into lms.item (library_ref, outcome_ids, grade, subject, kind, stem, options, correct_index, misconceptions)
           values ($1, $2, $3, $4, 'mcq', $5, $6::jsonb, $7, $8::jsonb)
           on conflict (library_ref) do nothing`,
          [
            i.libraryRef,
            i.outcomeIds,
            i.grade,
            i.subject,
            i.stem,
            JSON.stringify(i.options),
            i.correctIndex,
            JSON.stringify(i.misconceptions ?? null),
          ],
        );
      }
    },
  };
}
