import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { findEntry, nextLessonAfter, type CatalogEntry } from '../lib/content';
import { buildQuiz } from '../lib/quiz';
import { progressStore, computeStreak } from '../stores/progress';
import { quizHistoryStore, bestScore } from '../stores/quizHistory';
import { preferencesStore } from '../stores/preferences';
import { useStore } from '../stores/localStore';
import { Icon } from '../ui/Icon';
import { setCommitment } from '../lib/studentMemory';
import { tutorLanguage } from '../lib/workspace';

/** The promises a student can pick at the end of a class — short, doable, theirs. */
const PROMISES_EN = ['3 questions without hints', 'Revise this for 10 minutes', 'Explain it to someone at home'];
const PROMISES_HI = ['3 sawaal bina hint ke', '10 minute revision', 'Ghar pe kisi ko samjhaana'];

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
/**
 * Long enough to read the line and stop it, short enough that it still feels
 * like one class rolling into the next.
 */
const AUTOPLAY_SECONDS = 5;

export function LessonComplete() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();
  const progress = useStore(progressStore);
  const quizHistory = useStore(quizHistoryStore);
  const preferences = useStore(preferencesStore);
  const [secondsLeft, setSecondsLeft] = useState(AUTOPLAY_SECONDS);
  const [stayHere, setStayHere] = useState(false);
  const [promise, setPromise] = useState<string | null>(null);
  const hinglish = tutorLanguage() === 'hi-en';
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [next, setNext] = useState<CatalogEntry | null>(null);

  useEffect(() => {
    if (!lessonId) return;
    findEntry(lessonId).then(setEntry).catch(() => setEntry(null));
    nextLessonAfter(lessonId).then(setNext).catch(() => setNext(null));
  }, [lessonId]);

  const streak = computeStreak(progress);
  // entry?.topicRef arrives with the catalogue, so this can flip from false to
  // true a beat after the screen paints. That is the honest order: a practice
  // button that appears is better than one that promises an empty quiz.
  const hasQuiz = useMemo(
    () => (lessonId ? buildQuiz(lessonId, { topicRef: entry?.topicRef }) !== null : false),
    [lessonId, entry?.topicRef],
  );
  const best = lessonId ? bestScore(quizHistory, lessonId) : null;
  const practiceLeads = hasQuiz && best === null;
  const autoplaying = preferences.autoplayNext && next !== null && !stayHere;

  /**
   * The preference is a promise to keep going, not a promise to hurry. The
   * countdown is on screen and one tap stops it, so a student is never carried
   * into the next lesson without being shown it is about to happen. `next` is
   * null until nextLessonAfter resolves, so the last lesson never autoplays.
   */
  useEffect(() => {
    if (!autoplaying || next === null) return;
    if (secondsLeft <= 0) {
      // replace: a finished lesson's celebration is not somewhere the back
      // button should land them in the middle of the next class.
      navigate(`/lesson/${next.id}`, { replace: true });
      return;
    }
    const timer = setTimeout(() => setSecondsLeft((left) => left - 1), 1000);
    return () => clearTimeout(timer);
  }, [autoplaying, next, secondsLeft, navigate]);

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

        {/* A TINY PROMISE FOR NEXT TIME (G6-local, 2026-09-29). One tap; the
            next class opens by remembering it (lib/studentMemory.ts). Picking
            one stops the countdown, because they are choosing, not leaving. */}
        <div className="w-full rounded-xl bg-surface-container-lowest px-4 py-3 shadow-sm text-left">
          {promise ? (
            <p aria-live="polite" className="font-label-md text-label-md text-on-surface">
              {hinglish ? 'Pakka! Agli class mein Meera yaad dilayegi: ' : "Done! Meera will remind you next class: "}
              <span className="font-semibold">{promise}</span>
            </p>
          ) : (
            <>
              <p className="font-label-md text-label-md text-on-surface mb-2">
                {hinglish ? 'Agli baar ke liye ek chhota sa promise?' : 'A small promise for next time?'}
              </p>
              <div className="flex flex-wrap gap-2">
                {(hinglish ? PROMISES_HI : PROMISES_EN).map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setStayHere(true);
                      setCommitment({ text: p, lessonTitle: entry?.title ?? '' });
                      setPromise(p);
                    }}
                    className="min-h-[44px] rounded-full bg-primary-fixed px-3.5 py-2 font-label-md text-[13px] text-on-surface"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="grid gap-3 w-full mt-2">
          {autoplaying && (
            <div className="flex items-center justify-between gap-3 bg-surface-container-lowest rounded-xl px-4 py-3 shadow-sm">
              <p
                aria-live="polite"
                className="font-label-md text-label-md text-on-surface-variant text-left"
              >
                Next lesson in {secondsLeft}s
              </p>
              <button
                onClick={() => setStayHere(true)}
                className="font-label-md text-label-md text-primary underline underline-offset-2"
              >
                Stay here
              </button>
            </div>
          )}

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
