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
import type { DiagnosticResult } from '@ai-tutor/knowledge-graph';
import { loadDiagnosticData } from '../lib/diagnosticData';
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
  const data = useMemo(() => loadDiagnosticData(klass), [klass]);

  // The session is the entire state of the test, created once: the engine is
  // pure, so rebuilding it mid-test would silently restart the student. The
  // caller mounts this screen per placement test, so a different class is a new
  // mount and gets its own session.
  const [session, setSession] = useState<DiagnosticSession | null>(() =>
    data ? startSession(data.index, data.bank, { klass, subjects }) : null,
  );

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
    onComplete(buildPlan(session, data.index));
  }, [data, session, probe, onComplete]);

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
    setSession(answerProbe(session, data.index, probe, chosenIndex, Date.now() - shownAt.current));
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
