import { supabaseRest } from '../../lms-import/src/supabaseStore.ts';
import { fingerprint, type LibraryItem } from './library.ts';
import type { LibraryStore } from './sync.ts';

const PAGE = 1000;
const BATCH = 500;

/**
 * The library sync's store against the real project, with the service role.
 * Inserts use ignore-duplicates on library_ref, so even a race with another
 * run can never overwrite an item a teacher may already have approved.
 */
export function supabaseLibraryStore(url: string, serviceKey: string, fetchImpl: typeof fetch = fetch): LibraryStore {
  const call = supabaseRest(url, serviceKey, fetchImpl);
  return {
    async existing() {
      const out = new Map<string, string>();
      for (let offset = 0; ; offset += PAGE) {
        const rows = (await call(
          `/rest/v1/item?library_ref=not.is.null&select=library_ref,stem,options,correct_index` +
            `&order=library_ref&limit=${PAGE}&offset=${offset}`,
          { profile: 'lms' },
        )) as { library_ref: string; stem: string; options: string[]; correct_index: number }[];
        for (const r of rows) {
          out.set(r.library_ref, fingerprint({ stem: r.stem, options: r.options, correctIndex: r.correct_index }));
        }
        if (rows.length < PAGE) return out;
      }
    },
    async insert(items: LibraryItem[]) {
      for (let i = 0; i < items.length; i += BATCH) {
        await call('/rest/v1/item?on_conflict=library_ref', {
          method: 'POST',
          profile: 'lms',
          prefer: 'resolution=ignore-duplicates',
          body: items.slice(i, i + BATCH).map((it) => ({
            library_ref: it.libraryRef,
            outcome_ids: it.outcomeIds,
            grade: it.grade,
            subject: it.subject,
            kind: 'mcq',
            stem: it.stem,
            options: it.options,
            correct_index: it.correctIndex,
            misconceptions: it.misconceptions ?? null,
          })),
        });
      }
    },
  };
}
