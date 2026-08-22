import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { findEntry, nextLessonAfter, type CatalogEntry } from '../lib/content';
import { progressStore, computeStreak } from '../stores/progress';
import { useStore } from '../stores/localStore';
import { Icon } from '../ui/Icon';

/**
 * The moment of celebration after a lesson — the screen every learning app
 * treats as sacred: a big win mark, the streak, and ONE clear next action.
 * Deliberately full-bleed with no nav: nothing competes with the next step.
 */
export function LessonComplete() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();
  const progress = useStore(progressStore);
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [next, setNext] = useState<CatalogEntry | null>(null);

  useEffect(() => {
    if (!lessonId) return;
    findEntry(lessonId).then(setEntry).catch(() => setEntry(null));
    nextLessonAfter(lessonId).then(setNext).catch(() => setNext(null));
  }, [lessonId]);

  const streak = computeStreak(progress);

  return (
    <div className="bg-background text-on-background min-h-screen font-body-md grid place-items-center px-margin-mobile py-10">
      <div className="w-full max-w-[420px] flex flex-col items-center text-center gap-5">
        <div className="w-28 h-28 rounded-full bg-primary text-on-primary grid place-items-center shadow-[0px_8px_30px_rgba(99,102,241,0.28)]">
          <Icon name="check" filled className="text-[64px]" />
        </div>

        <div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface mb-1">Lesson complete!</h1>
          {entry && (
            <p className="font-body-md text-body-md text-on-surface-variant">{entry.title}</p>
          )}
        </div>

        {streak > 0 && (
          <div className="flex items-center gap-2 bg-secondary-container text-on-secondary-container rounded-full px-4 py-2 font-label-md text-label-md shadow-sm">
            <Icon name="local_fire_department" filled />
            {streak}-day streak
          </div>
        )}

        <div className="grid gap-3 w-full mt-2">
          {next && (
            <button
              onClick={() => navigate(`/lesson/${next.id}`)}
              className="bg-primary text-on-primary font-label-md text-label-md px-6 py-3 rounded-xl shadow-md border-b-2 border-[#2f2ebe] hover:opacity-90 transition-opacity active:scale-95 flex items-center justify-center gap-2"
            >
              Next: {next.title}
              <Icon name="chevron_right" />
            </button>
          )}
          <button
            onClick={() => navigate('/')}
            className="bg-surface-container-lowest text-on-surface-variant font-label-md text-label-md px-6 py-3 rounded-xl border-2 border-surface-variant hover:bg-surface-container transition-colors flex items-center justify-center gap-2"
          >
            <Icon name="home" />
            Back home
          </button>
        </div>
      </div>
    </div>
  );
}
