import { useEffect, useMemo, useRef, useState } from 'react';
import {
  answerProbe,
  buildPlan,
  isComplete,
  progressOf,
  selectNextProbe,
  startSession,
  type DiagnosticSession,
} from '@ai-tutor/diagnostic';
import { applyDoubt, applyTaught, type DiagnosticResult } from '@ai-tutor/knowledge-graph';
import { loadDiagnosticDataFor } from '../lib/diagnosticData';
import { evidenceSet } from '@ai-tutor/learner-model';
import { loadModel } from '../lib/learnerModel';
import { modelStore, trainOnSession } from '../stores/model';
import { useDiagnosticLedger } from '../lib/diagnosticLedger';
import { outcomeStore } from '../stores/outcomes';
import { BRAND } from '../brand';
import { EmptyState } from '../ui/Screen';
import { Icon } from '../ui/Icon';

/**
 * The adaptive placement test, built to the Stitch design: a close button, a
 * progress bar, one question, four option cards, and a quiet way out.
 *
 * The engine (@ai-tutor/diagnostic) decides everything that matters — which
 * question comes next, when to stop, and what the plan is. This screen only
 * shows the current probe and hands answers back, so the two stay separable:
 * the engine is pure and tested on its own, and this file holds no opinion
 * about pedagogy.
 *
 * NO RIGHT/WRONG FEEDBACK, deliberately. This is a diagnostic, not a quiz: a
 * student told the answer to question 7 carries it into question 8, and the
 * engine then measures the test instead of the student. That is worse than no
 * placement, because it mis-teaches quietly for weeks. The four option cards
 * are visually identical for the same reason — nothing here may ever hint at
 * correctness. Feedback belongs in lessons and practice, where learning the
 * answer is the whole point.
 */

/**
 * ATTENDANCE IS APPLIED ONCE, WITH ITS REAL COUNT.
 *
 * This used to apply it twice — once for every taught id at `times = 1`,
 * and then again per id with the true count — so a node taught three times
 * landed at 0.733 instead of the 0.675 a single call gives, and attendance
 * alone could carry an outcome from the prior to nearly settled on zero
 * answered questions. `applyTaught` saturates on the count precisely so
 * that cannot happen; calling it twice defeats the saturation it exists for.
 *
 * Exported, and pure, so the regression test can pin the arithmetic without
 * mounting the screen — the fix lived unguarded inside a useState initializer
 * until the 2026-09-16 audit found it had no test.
 */
export function seedFromClassroom(
  fresh: DiagnosticSession,
  signals: { taught: Record<string, number>; confused: Record<string, number> },
): DiagnosticSession {
  let mastery = fresh.mastery;
  for (const [id, times] of Object.entries(signals.taught)) {
    mastery = applyTaught(mastery, [id], times);
  }
  const confused = Object.keys(signals.confused);
  mastery = applyDoubt(mastery, confused);
  // Named, not just folded in. A belief lowered by a raised hand that the
  // plan is not allowed to look at is a signal thrown away.
  return { ...fresh, mastery, seeded: new Set(confused) };
}

const LETTERS = ['A', 'B', 'C', 'D'];

/**
 * Every option card carries exactly this class string — one constant, so no
 * later edit can style the correct answer differently by accident.
 */
const OPTION_CARD =
  'group w-full bg-surface-container-lowest border-2 border-transparent rounded-[24px] ' +
  'p-card-padding flex items-center gap-4 text-left shadow-soft-indigo ' +
  'hover:shadow-soft-indigo-lg hover:scale-[1.02] hover:border-surface-tint/20 ' +
  'transition-all duration-200 active:scale-[0.98]';

/**
 * Chapter ids in the Learning Outcome Map are the map's own vocabulary and do
 * not always match a syllabus chapter id ("chemical-reactions" in the map vs
 * "chemical-reactions-and-equations" in the syllabus). Title-casing the id
 * always reads correctly, where a lookup would silently render nothing.
 */
const chapterLabel = (chapterId: string): string =>
  chapterId
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

export function Diagnostic({
  klass,
  subjects,
  onComplete,
  onSkip,
}: {
  klass: number;
  /** Subjects the student picked at onboarding; empty means every subject. */
  subjects: string[];
  /** Called once, with the study plan, when the test finishes. */
  onComplete: (result: DiagnosticResult) => void;
  /** Called when the student closes the test, or when no map exists for them. */
  onSkip: () => void;
}) {
  // The merged map: the student's class plus the levels behind it, scoped to
  // their subjects with lineage (Class 11 Biology looks back into Class 10
  // Science). The data layer decides how far back; the session just follows.
  const data = useMemo(
    () => loadDiagnosticDataFor(klass, subjects),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- array identity
    [klass, subjects.join('|')],
  );

  // The session is the entire state of the test, created once: the engine is
  // pure, so rebuilding it mid-test would silently restart the student. The
  // caller mounts this screen per placement test, so a different class is a new
  // mount and gets its own session.
  const [session, setSession] = useState<DiagnosticSession | null>(() => {
    if (!data) return null;
    const fresh = startSession(data.index, data.bank, {
      klass,
      subjects: data.subjects,
      lookBack: data.lookBack,
    });
    // The classroom has already said something about this student: which
    // outcomes they have been taught, and which ones they stopped the class
    // on. Starting the test from those beliefs rather than from the prior
    // means their first question is already informed by their term's work.
    return seedFromClassroom(fresh, outcomeStore.get());
  });

  // What this install has learned about its own questions and edges so far.
  // Read once per test: parameters that shifted mid-test would mean two
  // answers to the same question counted differently, which is not a
  // measurement any more.
  const params = useRef(modelStore.get()).current;

  // Above the early returns at line 153: a hook that only runs when the map
  // loaded would be a hook that runs conditionally.
  const ledger = useDiagnosticLedger();

  // The beliefs the test STARTED from, kept for calibration. An item judged
  // against beliefs that already include its own answer always looks perfect.
  const beliefsBefore = useRef(session?.mastery ?? {}).current;

  // Having no probe left to ask IS the finish line, whether that is because the
  // engine has seen enough or because the bank ran dry, so both cases collapse
  // into this one null and the single effect below.
  const probe = useMemo(() => {
    if (!data || !session || isComplete(session, data.index)) return null;
    return selectNextProbe(session, data.index, data.bank);
  }, [data, session]);

  // The engine weights a laboured correct answer lower than an instant one, so
  // the clock restarts with each question rather than running for the whole test.
  const shownAt = useRef(Date.now());
  useEffect(() => {
    shownAt.current = Date.now();
  }, [probe?.id]);

  // A latch, because callers naturally pass an inline onComplete: without it a
  // parent re-render after the last answer would deliver a second plan.
  const delivered = useRef(false);
  useEffect(() => {
    if (delivered.current || !data || !session || probe) return;
    delivered.current = true;
    // SELF-TRAINING. The test just produced the only thing the map has never
    // had: real answers. Fold them in before handing back the plan, so the
    // next student meets a slightly better calibrated version of it.
    trainOnSession({
      index: data.index,
      answers: session.answers,
      beliefsBefore,
      beliefsAfter: session.mastery,
    });
    ledger.finish();
    onComplete(
      buildPlan(session, data.index, {
        // Everything the model has seen of this student before today, so the
        // plan can name a break the classroom found last week and this test
        // never asked about.
        knownEvidence: evidenceSet(loadModel()),
      }),
    );
  }, [data, session, probe, onComplete, beliefsBefore, ledger]);

  if (!data || !session) {
    return (
      <div className="bg-background text-on-background min-h-screen font-body-md">
        <div className="w-full max-w-md mx-auto px-margin-mobile py-8">
          <EmptyState
            icon="explore_off"
            title="Placement test not ready"
            body={`${BRAND.name} has not mapped Class ${klass} yet, so there is nothing to place you against. Start learning — nothing is blocked.`}
            action={
              <button
                onClick={onSkip}
                className="mt-2 bg-primary text-on-primary font-label-md text-label-md px-6 py-3 rounded-xl shadow-md border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all"
              >
                Continue
              </button>
            }
          />
        </div>
      </div>
    );
  }

  if (!probe) {
    // The effect above is already building the plan; this is the single frame
    // between the last answer and the caller taking over, and it should read as
    // progress rather than as an empty question.
    return (
      <div className="bg-background text-on-background min-h-screen font-body-md">
        <div className="w-full max-w-md mx-auto px-margin-mobile py-8">
          <EmptyState
            icon="hourglass_top"
            title="Building your study plan"
            body="One moment — we are turning your answers into what to learn next."
          />
        </div>
      </div>
    );
  }

  const { asked, target } = progressOf(session);
  // The count names the question on screen, not the ones behind it, so it and
  // the bar both move as a question appears rather than after it is answered.
  const current = Math.min(asked + 1, target);
  const percent = Math.round((current / target) * 100);

  const answer = (chosenIndex: number | null) => {
    const ms = Date.now() - shownAt.current;
    // The ledger keeps what the belief update cannot: which distractor they
    // chose, and therefore the named misconception behind it.
    ledger.answered(probe, chosenIndex, ms);
    setSession(answerProbe(session, data.index, probe, chosenIndex, ms, params));
  };

  const node = data.index.node(probe.nodeId);

  return (
    <div className="bg-background text-on-background min-h-screen font-body-md flex flex-col">
      <div className="w-full max-w-md mx-auto flex flex-col flex-grow">
        <header className="flex items-center px-margin-mobile py-4 sticky top-0 bg-background z-10">
          <button
            onClick={onSkip}
            aria-label="Close placement test"
            className="w-10 h-10 -ml-2 grid place-items-center rounded-full flex-shrink-0 text-on-surface-variant hover:bg-surface-container-high transition-colors active:scale-95"
          >
            <Icon name="close" />
          </button>

          <div
            role="progressbar"
            aria-label="Questions answered"
            aria-valuemin={0}
            aria-valuemax={target}
            aria-valuenow={asked}
            className="flex-grow mx-4 h-3 bg-surface-container-high rounded-full overflow-hidden"
          >
            <div
              className="h-full bg-primary rounded-full transition-[width] duration-500 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>

          <span className="font-label-md text-label-md text-on-surface-variant flex-shrink-0">
            {`${current} / ${target}`}
          </span>
        </header>

        <main className="flex-grow flex flex-col px-margin-mobile pt-stack-md pb-stack-lg">
          <div className="mb-stack-lg">
            <div className="inline-flex items-center px-3 py-1 rounded-full bg-primary-fixed text-on-primary-fixed-variant font-label-sm text-label-sm uppercase tracking-wider">
              {node ? `${node.subject} · ${chapterLabel(node.chapter)}` : 'Placement test'}
            </div>
            <h1 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface mt-2 mb-stack-md">
              {probe.question}
            </h1>
          </div>

          <div className="flex flex-col gap-stack-sm w-full">
            {probe.options.map((option, i) => (
              <button key={`${probe.id}-${i}`} onClick={() => answer(i)} className={OPTION_CARD}>
                <span className="w-10 h-10 rounded-full bg-surface-container grid place-items-center flex-shrink-0 text-on-surface-variant font-headline-md text-headline-md group-hover:bg-primary-fixed group-hover:text-on-primary-fixed transition-colors">
                  {LETTERS[i]}
                </span>
                <span className="font-body-lg text-body-lg text-on-surface flex-grow">{option}</span>
              </button>
            ))}
          </div>
        </main>

        <footer className="p-margin-mobile flex justify-center mt-auto">
          <button
            onClick={() => answer(null)}
            className="flex items-center gap-2 px-4 py-3 rounded-full text-outline font-label-md text-label-md hover:bg-surface-container-high transition-colors active:scale-95"
          >
            <Icon name="help" className="text-lg" />
            I&apos;m not sure
          </button>
        </footer>
      </div>
    </div>
  );
}
