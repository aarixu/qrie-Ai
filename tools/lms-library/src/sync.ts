import { fingerprint, type LibraryItem } from './library.ts';

export interface LibraryStore {
  /** library_ref → fingerprint of every library item already stored. */
  existing(): Promise<Map<string, string>>;
  insert(items: LibraryItem[]): Promise<void>;
}

export interface SyncResult {
  inserted: number;
  unchanged: number;
  /**
   * Refs whose question, options or key differ from what is stored. They are
   * NOT overwritten: a teacher may have approved the stored version, and an
   * approval must not silently transfer to different words. Changing a
   * library question means giving it a new ref.
   */
  changed: string[];
}

export async function syncLibrary(items: LibraryItem[], store: LibraryStore): Promise<SyncResult> {
  const stored = await store.existing();
  const fresh: LibraryItem[] = [];
  const changed: string[] = [];
  let unchanged = 0;
  for (const item of items) {
    const was = stored.get(item.libraryRef);
    if (was === undefined) fresh.push(item);
    else if (was !== fingerprint(item)) changed.push(item.libraryRef);
    else unchanged += 1;
  }
  if (fresh.length) await store.insert(fresh);
  return { inserted: fresh.length, unchanged, changed };
}
