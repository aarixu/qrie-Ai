import type { DiagnosticResult, GraphIndex, PlanStep } from '@ai-tutor/knowledge-graph';
import { destinationFor, type Destination } from '../lib/destination';
import { SYLLABI, type CatalogEntry } from '../lib/content';
import { Icon } from '../ui/Icon';
import { PROTOTYPE_ONLY_PREPARED } from '../lib/prototype';

/**
 * The payoff after the placement test: the twenty questions turned into a short,
 * ordered list of what to fix and why.
 *
 * Presented chrome-free, like the diagnostic that leads into it and the lesson
 * completion that follows the same pattern — this is a moment, not a tab, and
 * the one way out is the button at the end. Navigation arrives as callbacks so
 * the screen stays a pure function of the result and is testable without a router.
 *
 * The plan carries node ids, not titles, so every title is a lookup that can
 * miss: a result saved before the map was regenerated names nodes that no
 * longer exist. That must degrade to a readable row, never to "undefined".
 *
 * EVERY STEP LEADS SOMEWHERE. This screen used to show "Start" only where the
 * map named a lesson and "Coming soon" everywhere else — and the names it
 * carried were invented, so most of those Start buttons landed on "This lesson
 * does not exist." A step now resolves through lib/destination: the topic's
 * recording if a student has already had that class, the topic taught live if
 * nobody has, its chapter if the map never got filed, and only then nothing.
 */

/**
 * Fallback label for a node the map no longer has. Title-casing the id is what
 * the diagnostic already does for chapter ids — it always reads as words, where
 * a generic placeholder would render several stale steps identically.
 */
const humanise = (nodeId: string): string =>
  nodeId
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const HOME_BUTTON =
  'w-full bg-surface-container-highest text-on-surface font-label-md text-label-md py-4 ' +
  'rounded-xl border-b-4 border-outline-variant active:border-b-0 active:translate-y-1 ' +
  'hover:bg-surface-dim transition-all flex items-center justify-center gap-2';

export function StudyPlan({
  result,
  index,
  catalog,
  onOpen,
  onHome,
}: {
  result: DiagnosticResult;
  index: GraphIndex;
  /** Every recorded lesson, or null while the catalogue is still arriving. */
  catalog: readonly CatalogEntry[] | null;
  /** Called with where the step leads. Never called for a step that leads nowhere. */
  onOpen: (destination: Destination) => void;
  onHome: () => void;
}) {
  const steps = result.plan;

  /**
   * Where a step leads.
   *
   * The NODE wins over the stored step: a plan is saved in the profile and
   * outlives the map it was built from, so its copy of the refs is a snapshot
   * and the map's is current. The step's copy is the fallback for exactly the
   * case the map cannot answer — the node has since been removed.
   */
  const destinationOf = (step: PlanStep): Destination | null => {
    if (!catalog) return null;
    const node = index.node(step.nodeId);
    return destinationFor(
      {
        topicRef: node?.topicRef ?? step.topicRef,
        lessonRef: node?.lessonRef ?? step.lessonRef,
        klass: node?.klass,
        subject: node?.subject,
        chapter: node?.chapter,
      },
      catalog,
      SYLLABI,
    );
  };

  return (
    <div className="bg-background text-on-background min-h-screen font-body-md relative overflow-hidden">
      {/* The ambient dot field from the Stitch design; Home carries the same one. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-[0.03] text-primary"
        style={{
          // currentColor rather than a literal, so the dots follow the token above.
          backgroundImage: 'radial-gradient(circle at 2px 2px, currentColor 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      />

      <main className="relative z-10 w-full max-w-[720px] mx-auto px-margin-mobile py-stack-md flex flex-col gap-stack-lg">
        {steps.length === 0 ? <AllClear /> : <PlanHeader count={steps.length} />}

        {steps.length > 0 && (
          <ol className="flex flex-col gap-gutter">
            {steps.map((step, i) => (
              <StepCard
                key={step.nodeId}
                step={step}
                number={i + 1}
                title={index.node(step.nodeId)?.title ?? humanise(step.nodeId)}
                destination={destinationOf(step)}
                onOpen={onOpen}
              />
            ))}
          </ol>
        )}

        <div className="pb-stack-lg">
          <button onClick={onHome} className={HOME_BUTTON}>
            <Icon name="home" />
            Go to home
          </button>
        </div>
      </main>
    </div>
  );
}

function PlanHeader({ count }: { count: number }) {
  // Built as one string rather than interpolated into the JSX: React would
  // otherwise split the sentence into separate text nodes, which reads as
  // fragments to a screen reader and breaks on copy.
  const found = `We found ${count} ${count === 1 ? 'thing' : 'things'} worth fixing first — start at the top.`;

  return (
    <header className="flex flex-col gap-stack-sm text-center pt-4">
      <h1 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface">
        Here is your plan
      </h1>
      <p className="font-body-md text-body-md text-on-surface-variant max-w-sm mx-auto">{found}</p>
    </header>
  );
}

/**
 * An empty plan means the diagnostic found nothing shaky, which is a win and has
 * to read like one. "We found 0 things worth fixing" would read as a failure to
 * measure — the opposite of what happened.
 */
function AllClear() {
  return (
    <header className="flex flex-col items-center gap-stack-sm text-center pt-stack-lg">
      <div className="w-24 h-24 rounded-full bg-primary text-on-primary grid place-items-center shadow-soft-indigo-lg">
        <Icon name="check" filled className="text-[56px]" />
      </div>
      <h1 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface">
        Nothing to fix — you are ahead
      </h1>
      <p className="font-body-md text-body-md text-on-surface-variant max-w-sm mx-auto">
        We went looking for weak spots and could not find one worth fixing. Carry straight on with
        your classes — they will stretch you from here.
      </p>
    </header>
  );
}

/**
 * What the action on a step says.
 *
 * A recorded class and one prepared on the spot are both "Start" on purpose:
 * the recording is a CACHE of the first live class, not a lesser product, and
 * the moment the difference reaches a button it stops being one.
 */
const ACTION: Record<Destination['kind'], string | null> = {
  lesson: 'Start',
  /**
   * A LIVE STEP IS A CLASS THAT WOULD HAVE TO BE MADE, and while the prototype
   * gate is on it cannot be. Null is what turns the row's Start button into
   * the inert "Coming soon" chip the screen already has for steps that lead
   * nowhere — so this needs no new state and no new component, just the
   * honest answer to "is there an action here".
   *
   * The comment above still holds for the day the gate comes off: a recording
   * is a CACHE of the first live class, not a lesser product, and both say
   * "Start" again the moment both can happen.
   */
  live: PROTOTYPE_ONLY_PREPARED ? null : 'Start',
  // The map knows the chapter but was never filed under a topic. Saying so is
  // better than a Start that opens a list the student then has to search.
  chapter: 'Open chapter',
  none: null,
};

function StepCard({
  step,
  number,
  title,
  destination,
  onOpen,
}: {
  step: PlanStep;
  number: number;
  title: string;
  /** Null while the catalogue is still arriving. */
  destination: Destination | null;
  onOpen: (destination: Destination) => void;
}) {
  const action = destination ? ACTION[destination.kind] : null;

  return (
    <li className="bg-surface-container-lowest rounded-[24px] p-card-padding shadow-soft-indigo border border-surface-variant/50 flex items-start gap-gutter">
      {/* Step one carries the solid badge: the plan is ordered, and the eye should
          land on the step to take today rather than on the whole stack at once. */}
      <div
        className={`shrink-0 w-12 h-12 rounded-full grid place-items-center font-headline-md text-headline-md shadow-sm ${
          number === 1
            ? 'bg-primary-container text-on-primary-container'
            : 'bg-primary-fixed text-on-primary-fixed-variant'
        }`}
      >
        {number}
      </div>

      <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center justify-between gap-gutter">
        <div className="min-w-0">
          <h2 className="font-headline-md text-[20px] leading-7 text-on-surface">{title}</h2>
          <p className="font-body-md text-label-md text-on-surface-variant">{step.reason}</p>
        </div>

        {destination && action ? (
          <button
            onClick={() => onOpen(destination)}
            aria-label={`${action} ${title}`}
            className="shrink-0 self-start sm:self-auto bg-primary text-on-primary font-label-md text-label-md px-6 py-3 rounded-xl shadow-md border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all"
          >
            {action}
          </button>
        ) : destination ? (
          // Nowhere to send them. The gap is real all the same, so the step
          // keeps its place — hiding it would leave a hole in the numbering.
          <span className="shrink-0 self-start sm:self-auto bg-surface-container-high text-on-surface-variant font-label-sm text-label-sm px-4 py-2 rounded-full border border-outline-variant">
            Coming soon
          </span>
        ) : (
          // The catalogue has not arrived, so we do not yet know. An inert
          // placeholder holds the space rather than flashing the wrong answer.
          <span
            aria-hidden
            className="shrink-0 self-start sm:self-auto w-[104px] h-[46px] rounded-xl bg-surface-container-high animate-pulse"
          />
        )}
      </div>
    </li>
  );
}
