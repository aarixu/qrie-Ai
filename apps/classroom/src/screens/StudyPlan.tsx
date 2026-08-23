import type { DiagnosticResult, GraphIndex, PlanStep } from '@ai-tutor/knowledge-graph';
import { Icon } from '../ui/Icon';

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
  onStartLesson,
  onHome,
}: {
  result: DiagnosticResult;
  index: GraphIndex;
  /** Called with the step's lessonRef — only steps that have one offer "Start". */
  onStartLesson: (lessonRef: string) => void;
  onHome: () => void;
}) {
  const steps = result.plan;

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
                onStartLesson={onStartLesson}
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

function StepCard({
  step,
  number,
  title,
  onStartLesson,
}: {
  step: PlanStep;
  number: number;
  title: string;
  onStartLesson: (lessonRef: string) => void;
}) {
  const lessonRef = step.lessonRef;

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

        {lessonRef !== undefined ? (
          <button
            onClick={() => onStartLesson(lessonRef)}
            aria-label={`Start ${title}`}
            className="shrink-0 self-start sm:self-auto bg-primary text-on-primary font-label-md text-label-md px-6 py-3 rounded-xl shadow-md border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all"
          >
            Start
          </button>
        ) : (
          // A step with no lesson yet still belongs in the plan — it is a real
          // gap, and hiding it would leave a hole in the numbering.
          <span className="shrink-0 self-start sm:self-auto bg-surface-container-high text-on-surface-variant font-label-sm text-label-sm px-4 py-2 rounded-full border border-outline-variant">
            Coming soon
          </span>
        )}
      </div>
    </li>
  );
}
