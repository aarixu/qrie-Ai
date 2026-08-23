import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Lesson } from '@ai-tutor/lesson-format';
import { fetchCatalog, fetchLesson, type CatalogEntry } from '../lib/content';
import {
  dayLabel,
  groupDoubtsByDay,
  labelBook,
  mostAskedBeat,
  timeLabel,
  type LabelBook,
} from '../lib/history';
import { doubtLogStore } from '../stores/doubtLog';
import { useStore } from '../stores/localStore';
import { EmptyState, Screen } from '../ui/Screen';
import { Icon } from '../ui/Icon';

/**
 * Every hand the student has raised, newest first.
 *
 * The log stores ids only, so titles are resolved at render time against the
 * catalog and the lesson files. Content moves — a lesson can be renamed or
 * withdrawn — so a row that cannot be resolved falls back to its raw id. An
 * unresolved question is still a question the student asked; dropping it would
 * quietly rewrite their history.
 */
export function DoubtHistory() {
  const navigate = useNavigate();
  const doubts = useStore(doubtLogStore);
  const [book, setBook] = useState<LabelBook>({});

  // The label lookup only has to be rebuilt when a NEW lesson appears in the
  // log, not on every doubt — hence a key over the distinct ids.
  const lessonIds = useMemo(
    () => [...new Set(doubts.map((d) => d.lessonId))].sort().join(','),
    [doubts],
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
        // not cost every other row its title.
        const loaded = await Promise.all(
          entries.map((entry) => fetchLesson(entry).catch(() => null)),
        );
        if (live) {
          setBook(labelBook(catalog, loaded.filter((l): l is Lesson => l !== null)));
        }
      })
      .catch(() => {
        // Offline, or no catalog: every row shows its raw id, which is honest.
      });

    return () => {
      live = false;
    };
  }, [lessonIds]);

  if (doubts.length === 0) {
    return (
      <Screen title="Your questions" onBack={() => navigate(-1)}>
        <EmptyState
          icon="back_hand"
          title="No questions yet"
          body="When something in a class does not click, raise your hand. The tutor stops right there, explains it, and puts you back where you were — and every question you ask lands on this page."
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
  const days = groupDoubtsByDay(doubts);
  const top = mostAskedBeat(doubts);

  return (
    <Screen title="Your questions" onBack={() => navigate(-1)}>
      {/* The summary: how much you asked, and what you kept asking about. */}
      <div className="flex items-center gap-4 bg-surface-container-lowest rounded-[24px] p-card-padding shadow-sm mb-stack-md">
        <div className="w-14 h-14 rounded-full bg-primary-fixed grid place-items-center shrink-0">
          <Icon name="back_hand" filled className="text-2xl text-on-primary-fixed" />
        </div>
        <div className="min-w-0">
          <div className="font-headline-md text-[20px] leading-7 text-on-surface">
            {doubts.length} {doubts.length === 1 ? 'question' : 'questions'} asked
          </div>
          {top !== null && (
            <div className="font-label-md text-label-md text-on-surface-variant">
              Most about{' '}
              <span className="text-on-surface">
                {book[top.lessonId]?.beats[top.beatId] ?? top.beatId}
              </span>{' '}
              · {top.count} {top.count === 1 ? 'time' : 'times'}
            </div>
          )}
        </div>
      </div>

      {days.map(({ day, doubts: asked }) => (
        <section key={day} className="mb-stack-md">
          <h2 className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide mb-stack-sm">
            {dayLabel(day, today)}
          </h2>

          <div className="grid gap-2">
            {asked.map((doubt, i) => {
              const labels = book[doubt.lessonId];
              // Only offer the way back into a lesson that still exists.
              const playable = labels !== undefined;

              return (
                <button
                  key={`${doubt.at}:${doubt.beatId}:${i}`}
                  onClick={playable ? () => navigate(`/lesson/${doubt.lessonId}`) : undefined}
                  disabled={!playable}
                  className={`flex items-center gap-3 text-left bg-surface-container-lowest rounded-[16px] px-4 py-3 shadow-sm transition-all ${
                    playable ? 'hover:shadow-md hover:scale-[1.01] cursor-pointer' : 'opacity-70 cursor-default'
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-primary-fixed grid place-items-center shrink-0">
                    <Icon name="back_hand" filled className="text-on-primary-fixed" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="font-headline-md text-[17px] leading-6 text-on-surface truncate">
                      {labels?.title ?? doubt.lessonId}
                    </div>
                    <div className="font-label-md text-label-md text-on-surface-variant truncate">
                      {labels?.beats[doubt.beatId] ?? doubt.beatId}
                    </div>
                  </div>

                  <span className="font-label-sm text-label-sm text-on-surface-variant shrink-0">
                    {timeLabel(doubt.at)}
                  </span>
                  {playable && <Icon name="chevron_right" className="text-on-surface-variant" />}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </Screen>
  );
}
