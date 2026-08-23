import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { findEntry, nextLessonAfter, type CatalogEntry } from '../lib/content';
import { buildQuiz } from '../lib/quiz';
import { progressStore, computeStreak } from '../stores/progress';
import { quizHistoryStore, bestScore } from '../stores/quizHistory';
import { useStore } from '../stores/localStore';
import { Icon } from '../ui/Icon';

/**
 * The moment of celebration after a lesson — the screen every learning app
 * treats as sacred: a big win mark, the streak, and ONE clear next action.
 * Deliberately full-bleed with no nav: nothing competes with the next step.
 *
 * Which action leads depends on what the student has not done yet. Before the
 * quiz, practice leads, because a lesson watched and never tested is a video;
 * once it has been taken, the next lesson leads and practice steps back to a
 * secondary line carrying the best score. A lesson with no questions behind it
 * shows no practice button at all rather than one that opens an empty quiz.
 */
export function LessonComplete() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();
  const progress = useStore(progressStore);
  const quizHistory = useStore(quizHistoryStore);
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [next, setNext] = useState<CatalogEntry | null>(null);

  useEffect(() => {
    if (!lessonId) return;
    findEntry(lessonId).then(setEntry).catch(() => setEntry(null));
    nextLessonAfter(lessonId).then(setNext).catch(() => setNext(null));
  }, [lessonId]);

  const streak = computeStreak(progress);
  const hasQuiz = useMemo(() => (lessonId ? buildQuiz(lessonId) !== null : false), [lessonId]);
  const best = lessonId ? bestScore(quizHistory, lessonId) : null;
  const practiceLeads = hasQuiz && best === null;

  const primary =
    'bg-primary text-on-primary font-label-md text-label-md px-6 py-3 rounded-xl shadow-md border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all flex items-center justify-center gap-2';
  const secondary =
    'bg-surface-container-lowest text-on-surface-variant font-label-md text-label-md px-6 py-3 rounded-xl border-2 border-surface-variant hover:bg-surface-container transition-colors flex items-center justify-center gap-2';

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
          {hasQuiz && (
            <button
              onClick={() => navigate(`/quiz/${lessonId}`)}
              className={practiceLeads ? primary : secondary}
            >
              <Icon name="quiz" filled={practiceLeads} />
              {best === null
                ? 'Practice what you learned'
                : `Practice again · best ${best.score}/${best.total}`}
            </button>
          )}

          {next && (
            <button
              onClick={() => navigate(`/lesson/${next.id}`)}
              className={practiceLeads ? secondary : primary}
            >
              Next: {next.title}
              <Icon name="chevron_right" />
            </button>
          )}

          <button onClick={() => navigate('/')} className={secondary}>
            <Icon name="home" />
            Back home
          </button>
        </div>
      </div>
    </div>
  );
}
