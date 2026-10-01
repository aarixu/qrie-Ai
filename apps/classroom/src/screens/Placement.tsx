import { useState, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { BRAND } from '../brand';
import { useStore } from '../stores/localStore';
import { placementStore } from '../stores/placement';
import { hasDiagnostic, profileStore, saveDiagnostic } from '../stores/profile';
import { klassOf, settingsStore } from '../stores/settings';
import {
  placementKey,
  placementStatus,
  recordFinished,
  recordProgress,
  safeNext,
  startRetake,
} from '../lib/placement';
import { buildPlacementResult } from '../lib/placementPlan';
import { EmptyState } from '../ui/Screen';
import { Icon } from '../ui/Icon';
import { Diagnostic } from './Diagnostic';

/**
 * /diagnostic — THE PLACEMENT TEST, A SUBJECT AT A TIME, UNTIL EVERY ONE IS DONE.
 *
 * Aarav, 2026-09-30: the test is mandatory and per chosen subject, it may be
 * paused, and no class opens before it is finished (App.tsx gateTo shuts the
 * class routes; lib/placement.ts says which subjects are owed). This screen
 * walks the owed subjects in the order they were chosen, mounting one sitting
 * of the engine per subject, and lets the student stop between any two
 * questions or any two subjects.
 *
 * Arrivals, and what each one sees:
 *
 *   - from onboarding, the Home card or Profile: straight into the next
 *     question, resumed where it was left;
 *   - from the Gate, with `?next=<where they were going>`: first a short,
 *     kind explanation of why the class did not open — a test that appears
 *     where a class was expected, with no word said, reads as a bug;
 *   - from Profile's "Retake" (`?retake=1`) with nothing owed: a question
 *     first, because a retake is a choice and starting one by arriving here
 *     would be a choice made for them.
 *
 * When the last subject finishes, the sittings are folded into the one plan
 * the rest of the app reads (lib/placementPlan.ts) and the student goes where
 * they were going, or to the plan.
 */

/** Shown when the Gate turned a class into this. Exported for the test. */
export const PLACEMENT_BLOCKED_TITLE = 'One step before your class';

export const PLACEMENT_BLOCKED_BODY =
  'Your classes start from what you already know, so I need to find that out first. ' +
  'It is a few quick questions for each subject below, with no marks and nothing to ' +
  'revise. You can stop whenever you like and carry on later from the same question.';

const PRIMARY =
  'w-full bg-primary text-on-primary font-label-md text-label-md px-6 py-4 rounded-xl border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all';

const QUIET =
  'w-full mt-3 py-3 font-label-md text-label-md text-on-surface-variant underline underline-offset-2';

function Card({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <div className="bg-background text-on-background min-h-screen font-body-md grid place-items-center px-margin-mobile py-10">
      <div className="w-full max-w-[440px] text-center">
        <div className="w-20 h-20 rounded-full bg-primary-fixed grid place-items-center mx-auto mb-5">
          <Icon name={icon} filled className="text-[38px] text-on-primary-fixed" />
        </div>
        <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function PlacementRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const settings = useStore(settingsStore);
  const profile = useStore(profileStore);
  const placement = useStore(placementStore);
  const klass = klassOf(settings, profile);
  const next = safeNext(params.get('next'));
  const retakeAsked = params.get('retake') === '1';

  /** Sent here by the Gate: explain before the first question. */
  const [briefed, setBriefed] = useState(next === null);
  /** The subject that just finished, while the next one waits for a tap. */
  const [justDone, setJustDone] = useState<string | null>(null);
  /** Where to go once the last subject is done — rendered, not pushed, so it happens once. */
  const [leaving, setLeaving] = useState<string | null>(null);

  if (leaving) return <Navigate to={leaving} replace />;
  if (klass === null) return <Navigate to="/onboarding" replace />;

  const status = placementStatus(placement, profile, klass);
  const queue = [...status.owed, ...status.retaking];
  const home = () => navigate('/', { replace: true });

  if (status.subjects.length === 0) {
    // No chosen subject has a map, so nothing is owed and no class is shut
    // (lib/placement.ts placementSubjects) — which is what makes the last
    // sentence here true.
    return (
      <div className="bg-background text-on-background min-h-screen font-body-md">
        <div className="w-full max-w-md mx-auto px-margin-mobile py-8">
          <EmptyState
            icon="explore_off"
            title="Placement test not ready"
            body={`${BRAND.name} has not mapped your subjects for Class ${klass} yet, so there is nothing to place you against. Start learning — nothing is blocked.`}
            action={
              <button onClick={home} className={`mt-2 ${PRIMARY}`}>
                Continue
              </button>
            }
          />
        </div>
      </div>
    );
  }

  if (queue.length === 0) {
    if (retakeAsked) {
      return (
        <Card icon="explore" title="Take the placement test again?">
          <p className="font-body-md text-body-md text-on-surface-variant mb-stack-md">
            Every subject again, from the first question. Your study plan stays as it is until
            you finish them all, and your classes stay open while you do it.
          </p>
          <button onClick={() => startRetake(klass, status.subjects)} className={PRIMARY}>
            Start again
          </button>
          {/* Back where they came from — or, for a link opened cold (the
              router's first entry, key "default"), to Profile, where the
              retake is offered: navigate(-1) from the first entry leaves the app. */}
          <button
            onClick={() =>
              location.key === 'default' ? navigate('/profile', { replace: true }) : navigate(-1)
            }
            className={QUIET}
          >
            Not now
          </button>
        </Card>
      );
    }
    // Placed, and nothing open: there is no test to show.
    return <Navigate to={next ?? (hasDiagnostic(profile) ? '/plan' : '/')} replace />;
  }

  const subject = queue[0];

  if (!briefed) {
    const started = Object.values(status.answered).some((n) => n > 0);
    return (
      <Card icon="explore" title={PLACEMENT_BLOCKED_TITLE}>
        <p className="font-body-md text-body-md text-on-surface-variant mb-stack-md">
          {PLACEMENT_BLOCKED_BODY}
        </p>
        <ul className="text-left flex flex-col gap-2 mb-stack-md">
          {status.subjects.map((s) => {
            const done = !status.owed.includes(s) && !status.retaking.includes(s);
            const answered = status.answered[s] ?? 0;
            return (
              <li
                key={s}
                className="flex items-center gap-3 bg-surface-container-lowest rounded-[16px] px-4 py-3"
              >
                <Icon
                  name={done ? 'check_circle' : 'schedule'}
                  className={done ? 'text-primary' : 'text-on-surface-variant'}
                />
                <span className="flex-1 font-label-md text-label-md text-on-surface">{s}</span>
                <span className="font-label-md text-label-md text-on-surface-variant">
                  {done ? 'Done' : answered > 0 ? `${answered} answered so far` : 'Not started'}
                </span>
              </li>
            );
          })}
        </ul>
        <button onClick={() => setBriefed(true)} className={PRIMARY}>
          {started ? 'Carry on with the placement test' : 'Start the placement test'}
        </button>
        <button onClick={home} className={QUIET}>
          Not now
        </button>
      </Card>
    );
  }

  if (justDone) {
    return (
      <Card icon="celebration" title={`${justDone} is done`}>
        <p className="font-body-md text-body-md text-on-surface-variant mb-stack-md">
          Next is {subject}. It works the same way, and you can stop whenever you like — your
          answers are kept.
        </p>
        <button onClick={() => setJustDone(null)} className={PRIMARY}>
          Carry on with {subject}
        </button>
        <button onClick={home} className={QUIET}>
          Finish later
        </button>
      </Card>
    );
  }

  const key = placementKey(klass, subject);
  return (
    <Diagnostic
      // One mount per subject: the engine's session, its ledger sitting and
      // its completion latch all belong to one subject's test.
      key={key}
      klass={klass}
      subjects={[subject]}
      resume={placement.records[key]?.open ?? null}
      onProgress={(sitting) => recordProgress(klass, subject, sitting)}
      onComplete={(_result, sitting) => {
        const after = recordFinished(klass, subject, sitting);
        const left = placementStatus(after, profileStore.get(), klass);
        if (left.owed.length + left.retaking.length > 0) {
          setJustDone(subject);
          return;
        }
        // The last one: one plan from every subject's sitting.
        const result = buildPlacementResult(klass, profileStore.get(), after);
        if (result) saveDiagnostic(result);
        setLeaving(next ?? (result ? '/plan' : '/'));
      }}
      onFinishLater={home}
    />
  );
}
