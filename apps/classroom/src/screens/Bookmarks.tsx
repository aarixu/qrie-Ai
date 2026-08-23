import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchCatalog, type CatalogEntry } from '../lib/content';
import { bookmarksStore, toggleBookmark } from '../stores/bookmarks';
import { isCompleted, progressStore } from '../stores/progress';
import { useStore } from '../stores/localStore';
import { EmptyState, Screen } from '../ui/Screen';
import { Icon } from '../ui/Icon';

/**
 * The lessons the student put aside to come back to, newest save first.
 *
 * The store keeps ids, so the catalog supplies the title and the subject and
 * the progress store answers the one question a saved list is really for: did
 * I ever finish this? Nothing else is claimed — the app measures completion and
 * nothing finer, so a lesson is finished or it is not.
 *
 * A row whose lesson the catalog cannot name does not offer a way in, exactly
 * as an unresolved doubt does not. It stays removable, which is the only thing
 * left that a student can usefully do with a lesson that has gone away.
 */
export function Bookmarks() {
  const navigate = useNavigate();
  const saved = useStore(bookmarksStore);
  const progress = useStore(progressStore);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);

  useEffect(() => {
    let live = true;

    fetchCatalog()
      .then((entries) => {
        if (live) setCatalog(entries);
      })
      .catch(() => {
        // Offline, or no catalog: every row shows its raw id, which is honest.
      });

    return () => {
      live = false;
    };
  }, []);

  const rows = useMemo(
    () => [...saved].sort((a, b) => b.at.localeCompare(a.at)),
    [saved],
  );

  if (rows.length === 0) {
    return (
      <Screen title="Saved lessons" onBack={() => navigate(-1)}>
        <EmptyState
          icon="bookmark"
          title="Nothing saved yet"
          body="Save a class while you are watching it and it waits for you here — the ones you want to watch again before a test, and the ones you meant to finish."
          action={
            <button
              onClick={() => navigate('/')}
              className="mt-2 bg-primary text-on-primary font-label-md text-label-md px-6 py-3 rounded-xl border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all"
            >
              Find a class
            </button>
          }
        />
      </Screen>
    );
  }

  return (
    <Screen
      title="Saved lessons"
      subtitle={`${rows.length} ${rows.length === 1 ? 'lesson' : 'lessons'}`}
      onBack={() => navigate(-1)}
    >
      <div className="grid gap-2">
        {rows.map((mark) => {
          const entry = catalog.find((e) => e.id === mark.lessonId);
          const done = isCompleted(progress, mark.lessonId);

          return (
            <div
              key={mark.lessonId}
              className="flex items-center gap-2 bg-surface-container-lowest rounded-[16px] pr-2 shadow-soft-indigo"
            >
              <button
                onClick={entry ? () => navigate(`/lesson/${entry.id}`) : undefined}
                disabled={entry === undefined}
                className={`flex items-center gap-3 text-left flex-1 min-w-0 px-4 py-3 rounded-[16px] transition-all ${
                  entry ? 'hover:bg-surface-container cursor-pointer' : 'opacity-70 cursor-default'
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-primary-fixed grid place-items-center shrink-0">
                  <Icon name="bookmark" filled className="text-on-primary-fixed" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="font-headline-md text-[17px] leading-6 text-on-surface truncate">
                    {entry?.title ?? mark.lessonId}
                  </div>
                  <div className="font-label-md text-label-md text-on-surface-variant truncate">
                    {entry ? `${entry.subject} · ` : ''}
                    {done ? 'Finished' : 'Not finished yet'}
                  </div>
                </div>

                {done && (
                  <Icon name="check_circle" filled className="text-primary shrink-0" />
                )}
                {entry && <Icon name="chevron_right" className="text-on-surface-variant shrink-0" />}
              </button>

              <button
                onClick={() => toggleBookmark(mark.lessonId)}
                aria-label="Remove from saved"
                className="w-10 h-10 shrink-0 grid place-items-center rounded-full text-on-surface-variant hover:bg-surface-container transition-colors"
              >
                <Icon name="bookmark_remove" />
              </button>
            </div>
          );
        })}
      </div>
    </Screen>
  );
}
