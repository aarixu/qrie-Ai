import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../../ui/Icon';
import { Bloub } from '../../bloub/Bloub';
import { isOnboarded, settingsStore } from '../../stores/settings';
import {
  beginTrial,
  endTrial,
  isTrialPath,
  isTrialSession,
  TRIAL_HOME,
} from '../../lib/workspace';

/**
 * WHAT HAPPENS TO A CHILD WHO HAS NOT BEEN ENROLLED, SAID BEFORE IT HAPPENS.
 *
 * The contest form is the DPDP verifiable-parental-consent artifact, and it
 * covers exactly the students who arrive through the contest. Everybody else
 * comes through this door — try-before-you-enrol, the top of the funnel —
 * where until now a minor was modelled, ledgered and analytics-tracked with
 * no consent and no parent anywhere near it.
 *
 * This screen is the other half of closing that. It is written to be read by
 * a parent AND understood by a twelve-year-old, in English, with no clause
 * that needs a second reading:
 *
 *   - what they may do: watch a class that already exists, and answer inside
 *     the page;
 *   - what is not kept: progress, scores, a belief about what they know, a
 *     line in the ledger, an analytics event with a name or an id on it;
 *   - what will not be made: a NEW class, because a preparation is about
 *     Rs 30 of real spend against a person we have no way to contact.
 *
 * WHAT THIS SCREEN MAY SAY, AND WHY IT IS NARROWER THAN THE LIST ABOVE.
 * Only one of those refusals is kept by code today. The Gate confines a trial
 * to the catalogue and one already-prepared lesson (App.tsx, isTrialPath), so
 * /class/<topic> — a live preparation, about Rs 30 of real spend — cannot be
 * reached at all: that promise is enforced and is stated as fact. The others
 * need guards inside the progress store, the ledger, the model store,
 * telemetry, and the report sheet's send path (NOT VERIFIED: ReportSheet is
 * mid-edit by another phase this wave), all files this phase does not own; they are listed as
 * handoffs in its report, and until they land this screen says they are NOT
 * FINISHED rather than saying they are done. A child-safety promise in prose
 * with the opposite behaviour underneath it is the exact failure this repo
 * shipped once already (aa278cd); an unfinished thing, said out loud, is not.
 */

/**
 * Where a trial goes, sanitised.
 *
 * A destination taken from a query string is a destination a stranger can
 * choose, so only the two shapes a trial may occupy are accepted and anything
 * else falls back to the catalogue. The predicate itself lives in
 * lib/workspace.ts because the Gate has to agree with it — when only this
 * screen knew the list, it governed the first hop and nothing after it.
 *
 * A bare /try no longer dead-ends: TRIAL_HOME is a lesson rather than the
 * catalogue, for the reason written beside it in lib/workspace.ts. The
 * catalogue is still reachable from inside a trial, and still shows "pick your
 * class first" when it is reached, because it is scoped to a class
 * (Syllabus.tsx:98) that a trial student does not have. HANDOFF: Syllabus.tsx
 * taking a session-scoped class would close that.
 */
function trialDestination(asked: string | null): string {
  if (asked === null || asked === '/try' || asked === '/enrol') return TRIAL_HOME;
  return isTrialPath(asked) ? asked : TRIAL_HOME;
}

export function TrialConsent() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const PRIMARY =
    'w-full bg-primary text-on-primary font-label-md text-label-md px-6 py-4 rounded-xl border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all';

  const asked = params.get('next');

  /**
   * WHAT THE GATE JUST REFUSED, if this is a bounce rather than a first
   * arrival. Without it the confinement was a silent teleport: a child tapped
   * a topic, reappeared on the screen they had already read, and nothing said
   * why or offered the one thing that would fix it.
   *
   * Two cases are worth different words. /class/<topic> is a class nobody has
   * made yet — most topics, against fifteen authored lessons — and is refused
   * because making one is real money. Everything else is a part of the app
   * that writes about the person using it. /complete/<id> falls in the second
   * group and is the saddest one: it is the end of the very class this screen
   * sent them to, refused because LessonComplete writes the progress card.
   */
  const blocked = params.get('blocked');
  const blockedWords =
    blocked === null
      ? null
      : blocked.startsWith('/class/')
        ? 'That class has not been made yet. While you are trying, you can only watch classes that already exist — making a new one is the part that costs us money.'
        : blocked.startsWith('/complete/')
          ? 'You got to the end — well done. We cannot show you your marks or keep them, because nobody has enrolled you yet. Enrolling is how you keep what you do.'
          : 'That part of the app keeps things about you, so it needs a parent to enrol you first.';

  /**
   * A DEVICE THAT ALREADY HAS A STUDENT, AND THE TWO PEOPLE THAT COULD BE.
   *
   * Opening a trial here unconditionally has a real cost: an enrolled student
   * who taps this link from a bookmark or an advert stops persisting for the
   * whole tab and never finds out. Refusing to open one has a worse cost, and
   * it is the one this repo has shipped before — a shared contest kiosk or a
   * family phone is a settled device where the next child has no parent and no
   * consent, and refusing them would hand them somebody else's app.
   *
   * Nothing on the device can tell those two apart. The person holding it can,
   * so it asks them, and the default is their own app rather than a guest
   * trial: the enrolled student is the likelier visitor, and the second child
   * is the one who must still be able to say no. See beginTrial's docblock.
   */
  const settled = isOnboarded(settingsStore.get());
  const inTrial = isTrialSession();

  /**
   * Whether this link named a class. A link pointing AT the default class
   * named one — the earlier reading compared against TRIAL_HOME and so
   * apologised for a link that was perfectly specific.
   */
  const named = asked !== null && asked !== '/try' && asked !== '/enrol' && isTrialPath(asked);

  const start = () => {
    beginTrial();
    navigate(trialDestination(asked), { replace: true });
  };

  /**
   * THE WAY OUT, which did not exist. endTrial had one caller and it was
   * consent, so a trial lasted until the tab closed — including for somebody
   * who only meant to look. Leaving it drops the session mark; the Gate then
   * treats them as any un-onboarded visitor and offers onboarding, which is
   * the consented path.
   */
  const leave = () => {
    endTrial();
    navigate('/', { replace: true });
  };

  return (
    <div className="bg-background text-on-background min-h-screen font-body-md flex flex-col">
      <main className="flex-1 grid place-items-center px-margin-mobile py-10">
        <div className="w-full max-w-[520px]">
          {/* Her shape, not the avatar: it is switched off (src/avatar/README.md). */}
          <div className="grid place-items-center mb-5" aria-hidden>
            <Bloub mode="idle" size={104} />
          </div>

          {blockedWords !== null && (
            <div className="rounded-2xl bg-primary-fixed border-2 border-on-primary-fixed-variant p-4 mb-stack-md">
              <p className="font-body-md text-body-md text-on-primary-fixed">{blockedWords}</p>
            </div>
          )}

          <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2 text-center">
            Try a class first.
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant mb-stack-md text-center">
            You can watch a class straight away, with no parent and no account. Here is exactly
            what that does and does not do — please read it with a grown-up if you can.
          </p>

          <div className="rounded-2xl bg-surface-container-lowest border-2 border-surface-variant p-5 mb-stack-md">
            <h2 className="font-label-md text-label-md text-on-surface mb-3">
              What you can do right now
            </h2>
            <ul className="flex flex-col gap-2 font-body-md text-body-md text-on-surface-variant">
              <li className="flex gap-2">
                <Icon name="check" className="text-[18px] text-primary shrink-0 mt-0.5" />
                Watch a class that has already been made.
              </li>
              <li className="flex gap-2">
                <Icon name="check" className="text-[18px] text-primary shrink-0 mt-0.5" />
                Answer the questions in it, out loud or typed.
              </li>
            </ul>
          </div>

          <div className="rounded-2xl bg-surface-container-lowest border-2 border-surface-variant p-5 mb-stack-md">
            <h2 className="font-label-md text-label-md text-on-surface mb-3">
              What will not happen
            </h2>
            {/* EVERY LINE HERE IS KEPT BY CODE IN THIS BUNDLE, and each is
                narrower than the sentence it would be tempting to write.

                ONE: the Gate's allow-list refuses /class/<topic>, which is
                the preparation. It does NOT make a trial free — a class plays
                through lib/lessonVoice.ts:146-152, which prefers a recording,
                then the on-device voice, then the PAID relay voice, and a
                trial is the coldest install there is. TRIAL_HOME is therefore
                the one lesson in content/ that ships with a recording. The
                copy says "a new class", never "this costs nothing".

                TWO: we are told no phone and no school, so there is nobody to
                tell — but two things do leave the page, and the copy names
                both. It used to name only the report, and said it was "the
                one thing", which was false on the first spoken answer.

                The child's words: a trial plays the same ClassRoom, so
                lib/ear.ts posts each spoken answer to /api/hear, and a typed
                or spoken doubt goes to /api/llm. Wherever the relay has a
                Google service account, packages/relay/src/handler.ts sends
                both to Vertex. Neither request carries a name or a phone
                number, and a trial asks for neither — hence "it is not told
                who you are".

                The report: ui/ReportSheet.tsx POSTs a report's note to
                /api/report under a verified user id, and report.ts keeps it
                verbatim and permanently. ReportSheet is mounted inside the
                lesson a trial may reach. HANDOFF: fileReport should skip the
                POST while !mayPersist() and keep the local copy, returning
                'kept'.

                THREE: sessionStorage, which the tab takes with it.

                Anything that needs a guard in a file this phase does not own
                is in the next box instead, as unfinished — not here, as
                done. */}
            <ul className="flex flex-col gap-2 font-body-md text-body-md text-on-surface-variant">
              <li className="flex gap-2">
                <Icon name="close" className="text-[18px] text-on-surface-variant shrink-0 mt-0.5" />
                We will not make a NEW class for you. Making one costs us real money, and we
                will not spend it on somebody we have no way to reach. Watching one that
                already exists is not free for us either — we just think that is a fair thing
                to give you before you decide.
              </li>
              <li className="flex gap-2">
                <Icon name="close" className="text-[18px] text-on-surface-variant shrink-0 mt-0.5" />
                Nobody is told who you are. We have no phone number for you and no school of
                yours, so there is nobody to tell. Two things do leave this page. What you say
                out loud, and any question you type to the tutor, goes to Google's AI
                service, which turns your voice into text and helps her reply — it is not told
                who you are. And a report: if you tell us something in the class is wrong, we
                keep what you typed so a person can read it and fix it.
              </li>
              <li className="flex gap-2">
                <Icon name="close" className="text-[18px] text-on-surface-variant shrink-0 mt-0.5" />
                You are not asked for your name, and you cannot open the rest of the app — a
                trial is the class, and nothing else.
              </li>
            </ul>
            <p className="font-label-md text-label-md text-on-surface-variant mt-4">
              When you close this tab, we forget you were trying.
            </p>
          </div>

          <div className="rounded-2xl bg-surface-container-lowest border-2 border-surface-variant p-5 mb-stack-md">
            <h2 className="font-label-md text-label-md text-on-surface mb-3">
              What we have not finished yet
            </h2>
            <p className="font-body-md text-body-md text-on-surface-variant">
              {/* The plain-English version of the handoffs in this phase's
                  report: progress.saveBeat, the ledger, the model store,
                  telemetry's stable id, lessonVoice's choice of a paid voice
                  and fileReport's POST do not consult mayPersist() yet. A box
                  that named three of those and stopped implied the rest was
                  settled, which is a worse lie than the list being long. */}
              While you are only trying, this app should not save your marks, work out what you
              seem to know, or count your visit. That part is still being built and is{' '}
              <strong className="text-on-surface">not finished</strong>, so some of it may still
              be written down on this device. A report you send is kept either way. We would
              rather tell you than let you assume.
            </p>
          </div>

          {settled || inTrial ? (
            <>
              <button onClick={leave} className={PRIMARY}>
                {settled ? 'Back to my classes' : 'Leave the trial'}
              </button>
              <p className="font-label-md text-label-md text-on-surface-variant mt-2 text-center">
                {settled
                  ? 'Somebody has already signed up on this device. If that is you, none of the above applies — this takes you back to your own classes.'
                  : 'You are trying right now. Leaving stops the trial for this tab.'}
              </p>
              <button
                onClick={start}
                className="block text-center w-full mt-3 py-3 font-label-md text-label-md text-on-surface-variant underline underline-offset-2"
              >
                {settled ? 'Not me — watch a class as a guest' : 'Carry on watching'}
              </button>
            </>
          ) : (
            <button onClick={start} className={PRIMARY}>
              Watch a class
            </button>
          )}
          {!settled && !inTrial && !named && (
            <p className="font-label-md text-label-md text-on-surface-variant mt-2 text-center">
              This link did not name a class, so it opens one we have recorded.
            </p>
          )}

          <Link
            to="/enrol"
            className="block text-center w-full mt-3 py-3 font-label-md text-label-md text-on-surface-variant underline underline-offset-2"
          >
            Enrol with a parent, and keep my progress
          </Link>
          <p className="font-label-md text-label-md text-on-surface-variant mt-2 text-center">
            Enrolling takes a parent's name and phone number, and a code we send to that phone.
          </p>
        </div>
      </main>
    </div>
  );
}
