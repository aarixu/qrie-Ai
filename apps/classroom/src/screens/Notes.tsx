import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Lesson } from '@ai-tutor/lesson-format';
import { fetchCatalog, fetchLesson, type CatalogEntry } from '../lib/content';
import { dayLabel, labelBook, timeLabel, type LabelBook } from '../lib/history';
import { editNote, notesStore, removeNote, type Note } from '../stores/notes';
import { useStore } from '../stores/localStore';
import { EmptyState, Screen } from '../ui/Screen';
import { Icon } from '../ui/Icon';

/**
 * Everything the student wrote down, gathered under the class it came from.
 *
 * Like the doubt log, the store keeps ids only, so titles and beat topics are
 * resolved at render time against the catalog and the lesson files. Content
 * moves — a lesson can be renamed or withdrawn — and a note that cannot be
 * resolved falls back to its raw ids rather than vanishing. The student wrote
 * it; it is not ours to drop because we lost the lesson.
 */

interface LessonNotes {
  lessonId: string;
  notes: Note[];
}

/** Newest note first within a lesson, and the lesson written in most recently first. */
function groupByLesson(notes: readonly Note[]): LessonNotes[] {
  const byLesson = new Map<string, Note[]>();
  for (const note of notes) {
    const bucket = byLesson.get(note.lessonId);
    if (bucket) bucket.push(note);
    else byLesson.set(note.lessonId, [note]);
  }

  return [...byLesson.entries()]
    .map(([lessonId, kept]) => ({
      lessonId,
      notes: [...kept].sort((a, b) => b.at.localeCompare(a.at)),
    }))
    .sort((a, b) => b.notes[0].at.localeCompare(a.notes[0].at));
}

export function Notes() {
  const navigate = useNavigate();
  const notes = useStore(notesStore);
  const [book, setBook] = useState<LabelBook>({});
  /** The note being rewritten, held by its stamp, and the text as it stands. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  // The label lookup only has to be rebuilt when a NEW lesson appears in the
  // notes, not on every edit — hence a key over the distinct ids.
  const lessonIds = useMemo(
    () => [...new Set(notes.map((n) => n.lessonId))].sort().join(','),
    [notes],
  );

  useEffect(() => {
    if (lessonIds === '') return;
    let live = true;

    fetchCatalog()
      .then(async (catalog) => {
        const entries = lessonIds
          .split(',')
          .map((id) => catalog.find((entry) => entry.id === id))
          .filter((entry): entry is CatalogEntry => entry !== undefined);
        // Settled per lesson, not Promise.all: one withdrawn lesson file must
        // not cost every other note its beat topic.
        const loaded = await Promise.all(
          entries.map((entry) => fetchLesson(entry).catch(() => null)),
        );
        if (live) {
          setBook(labelBook(catalog, loaded.filter((l): l is Lesson => l !== null)));
        }
      })
      .catch(() => {
        // Offline, or no catalog: every note shows its raw ids, which is honest.
      });

    return () => {
      live = false;
    };
  }, [lessonIds]);

  const groups = useMemo(() => groupByLesson(notes), [notes]);

  if (notes.length === 0) {
    return (
      <Screen title="Your notes" onBack={() => navigate(-1)}>
        <EmptyState
          icon="edit_note"
          title="No notes yet"
          body="Write something down during a class and it lands here. Every note is saved against the exact moment of the lesson you were watching, so it always arrives with the part of the class it belongs to."
          action={
            <button
              onClick={() => navigate('/')}
              className="mt-2 bg-primary text-on-primary font-label-md text-label-md px-6 py-3 rounded-xl border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all"
            >
              Go to a class
            </button>
          }
        />
      </Screen>
    );
  }

  const today = new Date();

  return (
    <Screen
      title="Your notes"
      subtitle={`${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}
      onBack={() => navigate(-1)}
    >
      {groups.map((group) => {
        const labels = book[group.lessonId];
        // Only offer the way back into a lesson that still exists.
        const playable = labels !== undefined;

        return (
          <section key={group.lessonId} className="mb-stack-md">
            <h2 className="font-headline-md text-[20px] leading-7 text-on-surface truncate mb-stack-sm">
              {labels?.title ?? group.lessonId}
            </h2>

            <div className="grid gap-2">
              {group.notes.map((note) => {
                const open = editing === note.at;

                return (
                  <article
                    key={note.at}
                    className="bg-surface-container-lowest rounded-[16px] p-4 shadow-soft-indigo"
                  >
                    {/* The moment this note belongs to — the thing a notebook cannot carry. */}
                    <div className="flex items-center gap-2 mb-2">
                      <Icon name="my_location" className="text-on-surface-variant text-[18px] shrink-0" />
                      <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide truncate">
                        {labels?.beats[note.beatId] ?? note.beatId}
                      </span>
                    </div>

                    {open ? (
                      <div className="rounded-xl border-2 border-surface-variant focus-within:border-primary transition-colors px-3 py-2">
                        <textarea
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          aria-label="Edit note"
                          rows={3}
                          className="w-full bg-transparent outline-none resize-none font-body-md text-body-md text-on-surface"
                        />
                      </div>
                    ) : (
                      <p className="font-body-md text-body-md text-on-surface whitespace-pre-wrap break-words">
                        {note.text}
                      </p>
                    )}

                    <div className="flex items-center gap-1 mt-3">
                      <span className="font-label-sm text-label-sm text-on-surface-variant flex-1 truncate">
                        {dayLabel(note.at.slice(0, 10), today)} · {timeLabel(note.at)}
                      </span>

                      {open ? (
                        <>
                          <button
                            onClick={() => setEditing(null)}
                            className="font-label-md text-label-md text-on-surface-variant px-3 py-2 rounded-xl hover:bg-surface-container transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => {
                              editNote(note.at, draft);
                              setEditing(null);
                            }}
                            disabled={draft.trim() === ''}
                            className="bg-primary text-on-primary font-label-md text-label-md px-4 py-2 rounded-xl border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all disabled:opacity-50"
                          >
                            Save
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => {
                              setDraft(note.text);
                              setEditing(note.at);
                            }}
                            aria-label="Edit note"
                            className="w-10 h-10 grid place-items-center rounded-full text-on-surface-variant hover:bg-surface-container transition-colors"
                          >
                            <Icon name="edit" />
                          </button>
                          <button
                            onClick={() => removeNote(note.at)}
                            aria-label="Delete note"
                            className="w-10 h-10 grid place-items-center rounded-full text-on-surface-variant hover:bg-surface-container transition-colors"
                          >
                            <Icon name="delete" />
                          </button>
                          {playable && (
                            /* The beat rides along in the URL so the classroom can open on
                               the moment the note was taken; a player that does not read it
                               yet simply opens the lesson. */
                            <button
                              onClick={() => navigate(`/lesson/${group.lessonId}?beat=${note.beatId}`)}
                              className="flex items-center gap-1 font-label-md text-label-md text-primary px-3 py-2 rounded-xl hover:bg-surface-container transition-colors"
                            >
                              <Icon name="play_circle" filled />
                              Open the class
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </Screen>
  );
}
