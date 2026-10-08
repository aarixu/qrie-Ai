import { Suspense, lazy, useEffect, useState } from 'react';
import {
  BrowserRouter,
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { GraphIndex } from '@ai-tutor/knowledge-graph';
import { settingsStore, isOnboarded } from './stores/settings';
import { watchTheme } from './lib/theme';
import { profileStore, saveDiagnostic, hasDiagnostic } from './stores/profile';
import { flagStore, replayUnsent, unsentReports } from './stores/flags';
import { preferencesStore } from './stores/preferences';
import { useStore } from './stores/localStore';
import { loadDiagnosticDataFor } from './lib/diagnosticData';
import { SYLLABI, fetchCatalog, findEntry, type CatalogEntry } from './lib/content';
import { hrefFor } from './lib/destination';
import { currentAccount } from './lib/supabase';
import { reportCrash, track } from './lib/telemetry';
import { isNative } from './lib/platform';
import { isTrialPath, isTrialSession, mayPersist } from './lib/workspace';
import type { QuizOutcome } from './lib/quiz';
import type { PlanChange } from './lib/adaptPlan';
import { Splash, MIN_SPLASH_MS } from './screens/Splash';
import { useAppConfig } from './lib/appConfig';
import { AppConfigGate } from './ui/AppConfigGate';

/**
 * EVERY SCREEN BUT THE OPENING ONES, LOADED WHEN IT IS ASKED FOR.
 *
 * One chunk meant a student on a ₹10,000 Android over 4G waited for the quiz,
 * the placement test, the settings and every library screen before they could
 * see the home page. Home, onboarding, the splash and the classroom stay
 * eager: those are the first seconds of the app, and a spinner there is a
 * worse trade than the bytes.
 */
const Chapter = lazy(() => import('./screens/Chapter').then((m) => ({ default: m.Chapter })));
const LiveClassRoute = lazy(() => import('./screens/LiveClass').then((m) => ({ default: m.LiveClassRoute })));
const LessonComplete = lazy(() => import('./screens/LessonComplete').then((m) => ({ default: m.LessonComplete })));
const Profile = lazy(() => import('./screens/Profile').then((m) => ({ default: m.Profile })));
const Search = lazy(() => import('./screens/Search').then((m) => ({ default: m.Search })));
const Syllabus = lazy(() => import('./screens/Syllabus').then((m) => ({ default: m.Syllabus })));
const Progress = lazy(() => import('./screens/Progress').then((m) => ({ default: m.Progress })));
const Diagnostic = lazy(() => import('./screens/Diagnostic').then((m) => ({ default: m.Diagnostic })));
const StudyPlan = lazy(() => import('./screens/StudyPlan').then((m) => ({ default: m.StudyPlan })));
const PracticeQuiz = lazy(() => import('./screens/PracticeQuiz').then((m) => ({ default: m.PracticeQuiz })));
const QuizResult = lazy(() => import('./screens/QuizResult').then((m) => ({ default: m.QuizResult })));
const Settings = lazy(() => import('./screens/Settings').then((m) => ({ default: m.Settings })));
const Help = lazy(() => import('./screens/Help').then((m) => ({ default: m.Help })));
const DoubtHistory = lazy(() => import('./screens/DoubtHistory').then((m) => ({ default: m.DoubtHistory })));
const StreakDetail = lazy(() => import('./screens/StreakDetail').then((m) => ({ default: m.StreakDetail })));
const Notes = lazy(() => import('./screens/Notes').then((m) => ({ default: m.Notes })));
const Bookmarks = lazy(() => import('./screens/Bookmarks').then((m) => ({ default: m.Bookmarks })));
const Achievements = lazy(() => import('./screens/Achievements').then((m) => ({ default: m.Achievements })));
const SignIn = lazy(() => import('./screens/SignIn').then((m) => ({ default: m.SignIn })));
/**
 * The front door and the door before it. Lazy for the same reason as the
 * rest: a student who is already enrolled never loads either.
 */
const Enrol = lazy(() => import('./screens/contest/Enrol').then((m) => ({ default: m.Enrol })));
const TrialConsent = lazy(() =>
  import('./screens/contest/TrialConsent').then((m) => ({ default: m.TrialConsent })),
);
import { ErrorBoundary } from './ui/ErrorBoundary';
import { Onboarding } from './screens/Onboarding';
import { Home } from './screens/Home';
import { LessonRoute } from './screens/ClassRoom';
import { ActionLab } from './screens/ActionLab';
import { CanvasLab } from './screens/CanvasLab';
import { ModelInspector } from './screens/ModelInspector';
import { AvatarLab } from './screens/AvatarLab';

/**
 * The subjects a student is being placed in.
 *
 * Their own choice from onboarding wins. Only when that is missing — a profile
 * from before onboarding asked the question — do we fall back to whatever the
 * syllabus covers for the class, which is the honest answer rather than a
 * list we would be inventing.
 */
const subjectsForClass = (klass: number, chosen: string[]): string[] =>
  chosen.length > 0
    ? chosen
    : Array.from(new Set(SYLLABI.filter((s) => s.klass === klass).map((s) => s.subject)));

/** /diagnostic — reads the class from settings and hands the engine to the screen. */
function DiagnosticRoute() {
  const navigate = useNavigate();
  const settings = useStore(settingsStore);
  const profile = useStore(profileStore);
  if (settings.klass === null) return <Navigate to="/onboarding" replace />;

  return (
    <Diagnostic
      klass={settings.klass}
      subjects={subjectsForClass(settings.klass, profile.subjects)}
      onComplete={(result) => {
        saveDiagnostic(result);
        navigate('/plan', { replace: true });
      }}
      onSkip={() => navigate('/', { replace: true })}
    />
  );
}

/** /plan — renders the stored result. Nothing to show means nothing was taken. */
function StudyPlanRoute() {
  const navigate = useNavigate();
  const profile = useStore(profileStore);
  const settings = useStore(settingsStore);

  // A step leads to a recorded lesson or to a class prepared on the spot, and
  // only the catalogue knows which. It is fetched here rather than inside the
  // screen so the screen stays a pure function of what it is given.
  const [catalog, setCatalog] = useState<readonly CatalogEntry[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    // An unreachable catalogue is an offline student, not a broken plan: every
    // topic is then cold, which resolves to the live classroom and tells them
    // the truth there. An empty list says exactly that.
    fetchCatalog()
      .catch(() => [] as CatalogEntry[])
      .then((entries) => {
        if (!cancelled) setCatalog(entries);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The stored plan may hold steps from earlier classes (the placement looks
  // back), so the index that renders it must be the same merged one.
  const data =
    settings.klass !== null ? loadDiagnosticDataFor(settings.klass, profile.subjects) : null;
  if (!hasDiagnostic(profile) || !data) return <Navigate to="/" replace />;

  return (
    <StudyPlan
      result={profile.diagnostic!}
      index={data.index as GraphIndex}
      catalog={catalog}
      onOpen={(destination) => {
        const href = hrefFor(destination);
        if (href) navigate(href);
      }}
      onHome={() => navigate('/')}
    />
  );
}

/**
 * /quiz/:lessonRef — the practice quiz, and its result in the same route.
 *
 * The result is held here rather than pushed as its own URL because a result
 * belongs to one attempt: a student who reloads a /result URL, or reaches it
 * with the back button, would be looking at a score for a quiz they are no
 * longer taking. Both screens hand back to the lesson's completion screen,
 * which is the hub that knows what comes next.
 */
function QuizRoute() {
  const { lessonRef } = useParams<{ lessonRef: string }>();
  const navigate = useNavigate();
  const [outcome, setOutcome] = useState<QuizOutcome | null>(null);
  // What the test changed about the plan, held beside the score because they
  // are two halves of one moment: what you did, and what it did.
  const [change, setChange] = useState<PlanChange | null>(null);
  // Retry remounts rather than resets: the quiz keeps per-question timing in
  // refs, and only a fresh mount makes the clock honest on the second attempt.
  const [attempt, setAttempt] = useState(0);

  /**
   * The lesson's topic, which is most of what decides the questions.
   *
   * Resolved BEFORE the quiz is mounted, not inside it. A quiz built without
   * the topic and then rebuilt with it would grow under a student who had
   * already started answering, and the honest alternative — telling them there
   * is no practice and taking it back a beat later — is worse.
   */
  const [entry, setEntry] = useState<CatalogEntry | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    if (!lessonRef) return;
    findEntry(lessonRef)
      .catch(() => null)
      .then((found) => {
        if (!cancelled) setEntry(found);
      });
    return () => {
      cancelled = true;
    };
  }, [lessonRef]);

  if (!lessonRef) return <Navigate to="/" replace />;
  // undefined means the catalogue has not answered yet; null means it has, and
  // this lesson is not in it (a live class), which still gets the lessonRef join.
  if (entry === undefined) return <Splash />;
  const leave = () => navigate(`/complete/${lessonRef}`, { replace: true });

  if (outcome) {
    return (
      <QuizResult
        outcome={outcome}
        adapted={change}
        onContinue={leave}
        onRetry={() => {
          setOutcome(null);
          setChange(null);
          setAttempt((n) => n + 1);
        }}
        onReview={() => navigate(`/lesson/${lessonRef}`)}
        onOpenPlan={() => navigate('/plan')}
      />
    );
  }

  return (
    <PracticeQuiz
      key={attempt}
      lessonRef={lessonRef}
      topicRef={entry?.topicRef}
      onComplete={(result, planChange) => {
        setOutcome(result);
        setChange(planChange);
      }}
      onExit={leave}
    />
  );
}

/**
 * First run goes to onboarding; everything else passes through.
 *
 * The splash is held for MIN_SPLASH_MS even when startup is instant — a splash
 * that appears for eighty milliseconds reads as a rendering glitch, not a brand.
 */
/**
 * Exported for the test that reads the confinement as BEHAVIOUR rather than as
 * the predicate behind it. It is the only guarantee this door states to a
 * child as fact, so a green suite must not survive an edit to the condition.
 */
export function Gate({ children }: { children: React.ReactNode }) {
  const settings = useStore(settingsStore);
  const location = useLocation();
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setBooting(false), MIN_SPLASH_MS);
    return () => clearTimeout(timer);
  }, []);

  // The dev benches are not the product and have no student behind them.
  // Sending them through onboarding just puts a name form in front of a tool
  // whose whole job is to be opened and looked at.
  // Compared against the app's own root, not the origin's: these are the only
  // three places left that read location.pathname directly, and a literal '/'
  // in front of them stops matching the moment the app is mounted at /app/.
  const root = import.meta.env.BASE_URL;
  const isBench =
    import.meta.env.DEV &&
    (location.pathname === `${root}canvas-lab` ||
      location.pathname === `${root}avatar-lab` ||
      location.pathname === `${root}model` ||
      location.pathname.startsWith(`${root}action-lab/`));

  /**
   * THE TWO DOORS, AND THE SESSION ONE OF THEM OPENS.
   *
   * /enrol and /try are reached by people who have not onboarded — that is
   * what they are for — so the onboarding redirect must not swallow them.
   *
   * A TRIAL IS CONFINED, NOT WAVED THROUGH. It must reach the catalogue and
   * an already-prepared class without being sent to a form that asks a child
   * for their name, which is the one thing a pre-consent student must not be
   * asked to type. It must reach NOTHING ELSE.
   *
   * A blanket pass let the trial screen's own allow-list govern only the
   * first hop and nothing after it. Two taps later a chapter with no authored
   * lesson navigated to /class/<topic> (Chapter.tsx:75), which is a live
   * preparation: real vendor spend on a visitor with no parent, no phone and
   * no consent row. About Rs 30 of it — the planning figure every document
   * here uses (docs/prd/6-cost-monetisation-ops.md:573, band Rs 26-40). An
   * earlier revision of this comment named a second, disagreeing figure of
   * Rs 2.25 and declined to choose; that one turned out not to be a rival
   * estimate at all but an OpenRouter-era price for a class with no pictures,
   * superseded by Rs 9.08 measured on Vertex and then by Rs 30 with the
   * pictures a real class carries. There is one number, and this is it.
   * A trial reaching /settings, meanwhile, wrote and synced a
   * preference about a pre-consent minor, which is the other half of the same
   * refusal.
   *
   * isTrialPath is the list, and it lives in lib/workspace.ts so this and the
   * screen cannot drift apart.
   *
   * THE REFUSAL CARRIES THE PATH IT REFUSED. A bare redirect returned a child
   * to the screen they had just read, with no reason given and their place
   * lost — most often after tapping a topic nobody has authored, which is
   * most topics. `?blocked=` is what lets /try say which thing needs an
   * account. The path is our own vocabulary and carries no student data.
   *
   * THE CONFINEMENT APPLIES TO EVERY TRIAL, SETTLED DEVICE OR NOT, and this
   * paragraph used to say the opposite on a premise that was never true.
   *
   * It claimed beginTrial refuses a device that has already onboarded, so a
   * settled device could not be in a trial and needed no confining.
   * `lib/workspace.ts` says in capitals that it does NOT refuse one, and
   * deliberately: a shared kiosk or a family phone is a settled device where
   * the next child has no parent and no consent, and refusing them a trial
   * would hand them the enrolled student's app. So TrialConsent offers exactly
   * that — "Not me — watch a class as a guest" — and the branch this comment
   * said was impossible is the one the whole design exists for. Gated on
   * `!settled` it was also the only branch left unconfined: /class/<topic> is
   * a live preparation and real money, and /settings, /progress and
   * /diagnostic were open, while the screen that child had just read promised
   * "a trial is the class, and nothing else". That is a promise in prose with
   * the opposite behaviour underneath it, which is the aa278cd shape.
   *
   * The cost of confining both is that an enrolled student who taps a /try
   * link is held to trial paths until they leave the trial — and they can:
   * TrialConsent's own way out calls endTrial, and the `?blocked=` redirect
   * lands them on the screen carrying that button. A stopped student who can
   * see the way out beats a child who was promised a confinement that was not
   * applied.
   *
   * isTrialSession is session-scoped, so all of this ends with the tab.
   */
  if (booting && !isBench) return <Splash />;
  const to = gateTo(location.pathname, {
    settled: isOnboarded(settings),
    trial: isTrialSession(),
    bench: isBench,
  });
  return to === null ? <>{children}</> : <Navigate to={to} replace />;
}

/**
 * WHERE THIS SESSION MAY BE, AS A FUNCTION RATHER THAN AS JSX.
 *
 * Null means render what was asked for; a string is where to send them
 * instead. It is out here because it is the only money guarantee this bundle
 * states to a child as a fact, and inside the component the nearest a test
 * could get was the predicate underneath it — which would leave an edit to
 * this condition breaking the guarantee with a green suite.
 *
 * Read in order:
 *
 *   - a bench is a dev tool with no student behind it and is never gated;
 *   - a trial is CONFINED, and the comment above says at length why;
 *   - the doors are reached by people who have not onboarded, which is what
 *     they are for, so the onboarding redirect must not swallow them.
 */
export function gateTo(
  pathname: string,
  { settled, trial, bench }: { settled: boolean; trial: boolean; bench: boolean },
): string | null {
  if (bench) return null;
  const isDoor = pathname === '/enrol' || pathname === '/try';
  // `trial` alone, never `!settled && trial`: the guest trial on a settled
  // device is the case the confinement exists for, not the case it skips.
  if (trial) {
    if (isDoor || isTrialPath(pathname)) return null;
    return `/try?blocked=${encodeURIComponent(pathname)}`;
  }
  if (!isDoor && !settled && pathname !== '/onboarding') return '/onboarding';
  return null;
}

/**
 * The student's appearance switches, applied to the document root.
 *
 * Reduced motion is ONE DIRECTION ONLY: the attribute goes on when they ask
 * for less motion and comes off when they do not. Nothing in the stylesheet
 * turns motion back on, so a device whose OS already asks for less keeps that
 * answer either way — a preference may quieten motion, never restore it.
 *
 * The theme follows the same discipline: the store decides, the document
 * follows — including OS flips while "system" is selected (watchTheme's
 * listener), and index.html applies the same rule before first paint so a
 * dark-theme student never sees a white flash.
 */
function useAppearance(): void {
  const preferences = useStore(preferencesStore);

  useEffect(() => {
    const root = document.documentElement;
    if (preferences.reducedMotion) root.setAttribute('data-reduced-motion', 'true');
    else root.removeAttribute('data-reduced-motion');
  }, [preferences.reducedMotion]);

  useEffect(() => watchTheme(preferences.theme), [preferences.theme]);
}

/**
 * ONE DRAIN AT A TIME.
 *
 * <StrictMode> double-invokes the mount effect in development, and the two
 * listeners below can fire while a drain is already in the air. Without this,
 * both passes read the same snapshot before either marked anything sent, and
 * every kept report was POSTed twice. The relay deduplicates on
 * (user, lessonId, beatId, at) so no operator ever read a report twice — but
 * the comment said "once" and the code did not, which is the thing this repo
 * fails phases for.
 */
let draining: Promise<void> | null = null;

/**
 * A REPORT THAT DID NOT GO, SENT NOW.
 *
 * `fileReport` has always answered an outcome and nothing read 'kept' back, so
 * one 503 or one moment in a lift dropped a child's Safety report for good —
 * while the sheet told them it was saved on their phone, which was true and
 * was not the point. The sheet's "try again" button only ever helped a child
 * who was still looking at it.
 *
 * NOT ON A TIMER. A student who leaves the app open all evening is one person
 * having one evening. It runs on the moments a phone actually has signal, which
 * lib/ledgerSync.ts has drained the event outbox on since before this wave:
 * the app opening, the browser saying the network returned, and the tab or the
 * WebView coming back to the foreground. The last of those is not decoration —
 * inside the Capacitor shell, opening the app from the launcher RESUMES a live
 * WebView, so React never remounts and a mount effect alone would have made
 * "we will try again" a promise the Android build does not keep.
 *
 * THE CHUNK IS NOT LOADED UNLESS THERE IS SOMETHING TO SEND. The check against
 * the local flag log is synchronous and is false on essentially every open, so
 * the report sheet's module stays out of the first seconds of the app — the
 * same trade every lazy() above this makes.
 *
 * WHY THE SENDER IS INJECTED RATHER THAN IMPORTED BY THE STORE: stores/flags.ts
 * must not import a React component, and this is the seam that lets it not.
 *
 * COSTS NOTHING TO RUN. /api/report is metered at zero units and pays no
 * vendor (packages/relay/src/report.ts), so a replay spends no part of a
 * student's Rs 5.
 */
export function replayKeptReports(): Promise<void> {
  draining ??= drainKeptReports().finally(() => {
    draining = null;
  });
  return draining;
}

async function drainKeptReports(): Promise<void> {
  if (unsentReports(flagStore.get()).length === 0) return;
  try {
    const { fileReport } = await import('./ui/ReportSheet');
    /**
     * WHOSE PHONE IS THIS NOW? — resolved before a byte goes out.
     *
     * The POST carries whoever is signed in at this moment, so on a contest
     * kiosk or a family phone a report written by the last child would be
     * filed against this one. lib/ledgerSync.ts claims the event outbox for
     * exactly this reason; `replayUnsent` applies the same rule to reports,
     * and waits rather than guessing when this comes back null.
     *
     * The draft itself is resent WHOLE — it IS the body, `at` and all — because
     * the relay deduplicates on (user, lessonId, beatId, at).
     */
    const account = await currentAccount().catch(() => null);
    const { discarded } = await replayUnsent(fileReport, account?.id ?? null);
    if (discarded > 0) track('report_handover', { discarded });
  } catch {
    // A chunk that will not load is a replay that did not happen. The marker
    // stays, the next open tries again, and nothing is lost.
  }
}

/**
 * Listen on the moments a phone has signal, and hand back the detach.
 *
 * Exported so tests can drive the real events rather than assert about the
 * effect: the confirmation copy promises the child a retry, and a test named
 * for a promise the code does not keep is worse than no test at all.
 */
export function watchForReportReplay(): () => void {
  const flush = (): void => {
    void replayKeptReports();
  };
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') flush();
  };

  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', onVisible);
  flush();

  return () => {
    window.removeEventListener('online', flush);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** The one line that makes the above happen, for as long as the app is open. */
function useReportReplay(): void {
  useEffect(() => watchForReportReplay(), []);
}

/**
 * The boundary sits INSIDE the router so it can be keyed by path: a student
 * who navigates away from a screen that threw is recovered by the navigation
 * itself, with no button to press. Outside the router it would have no way to
 * know they had moved.
 */
function Boundaried({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  /**
   * Every screen the student reaches, by PATH.
   *
   * Nineteen of the twenty-four routes are lazy, so there is no screen
   * component that all of them pass through — the router is the only place
   * this can live. The path is our own vocabulary and carries no student data,
   * except in one case: /class?topic=<what they typed>. The query string is
   * dropped for exactly that reason.
   */
  useEffect(() => {
    /**
     * NOT DURING A TRIAL. track() puts distinct_id: installId() on every
     * event (lib/telemetry.ts:284), which is a stable identifier for a device
     * — and /try tells a child nobody is told they were here. This is the one
     * such writer inside a file this phase owns, so it is guarded here rather
     * than handed off; telemetry's own early return, which would cover the
     * call sites in ClassRoom and elsewhere, is the handoff that remains.
     */
    if (!mayPersist()) return;
    track('screen_viewed', { path: location.pathname.replace(/\/[^/]{40,}/g, '/…') });
  }, [location.pathname]);

  return (
    <ErrorBoundary
      resetKey={location.pathname}
      /**
       * The seam was already here and already tested; this is the one prop
       * that turns a white screen somebody silently uninstalled over into a
       * thing we find out about.
       */
      onError={(error, info) =>
        reportCrash(error, { path: location.pathname, componentStack: info.componentStack ? 1 : 0 })
      }
    >
      {children}
    </ErrorBoundary>
  );
}

/**
 * THE ROUTER, PICKED FOR WHERE IT IS RUNNING.
 *
 * On the web, real paths: /lesson/class10-blood is a URL a student can send to
 * a friend, and Vercel rewrites it back to index.html.
 *
 * Inside the native shell there is nothing to do that rewriting. The WebView
 * serves files off the app itself, so a reload while the student is at
 * /lesson/class10-blood asks the shell for a file that was never written —
 * and a blank screen on a phone is an uninstall, not a bug report. A hash
 * carries the path inside a URL the shell always resolves.
 *
 * One line of platform adaptation, not a second implementation: everything
 * below this is identical.
 */
const Router = isNative() ? HashRouter : BrowserRouter;

/**
 * WHERE THIS APP IS MOUNTED ON ITS ORIGIN.
 *
 * Vite sets BASE_URL from `base`, which is '/' for the standalone build and
 * '/app/' when the app is served under the marketing site so that the two
 * share one origin — and therefore one Supabase session, and therefore one
 * student rather than two. Read here rather than hardcoded so a single build
 * flag moves the whole app and nothing has to be remembered.
 *
 * Only the web Router takes it. Inside the native shell the paths live after
 * a '#' on a file:// URL, where a basename is meaningless at best.
 */
/**
 * WITHOUT A TRAILING SLASH, which is not a detail — it is the whole thing.
 *
 * Vite's BASE_URL always ends in one ('/app/'), and React Router matches a
 * basename as a PREFIX of the pathname. A student arriving at '/app' does not
 * have a pathname starting with '/app/', so the router matched nothing and
 * rendered nothing: assets all 200, Supabase signed in, #root empty, a blank
 * cream screen. Caught in a local build, and it would have been a blank app on
 * the front door in production.
 *
 * The `|| '/'` is for the standalone build, where stripping the slash off '/'
 * leaves an empty string.
 */
const BASENAME = isNative()
  ? undefined
  : import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

export default function App() {
  useAppearance();
  useReportReplay();
  useAppConfig(); // so every screen re-renders when tutor.only_prepared changes (screens read PROTOTYPE_ONLY_PREPARED at render)
  return (
    <Router basename={BASENAME}>
      <Boundaried>
        <Suspense fallback={<Splash />}>
        <AppConfigGate>
        <Gate>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/diagnostic" element={<DiagnosticRoute />} />
            <Route path="/plan" element={<StudyPlanRoute />} />
            <Route path="/syllabus" element={<Syllabus />} />
            <Route path="/chapter/:syllabusId/:chapterId" element={<Chapter />} />
            <Route path="/lesson/:lessonId" element={<LessonRoute />} />
            {/* Teach me this topic — fetched if somebody has had it, made if not. */}
            <Route path="/class/*" element={<LiveClassRoute />} />
            {/* The benches are tools, not product. A store reviewer can reach
              any route that exists, so in a production build these do not.
              import.meta.env.DEV is a literal at build time, so the screens
              are dropped from the bundle rather than merely hidden. */}
            {import.meta.env.DEV && (
              <>
                <Route path="/action-lab/:lessonId" element={<ActionLab />} />
                <Route path="/canvas-lab" element={<CanvasLab />} />
                <Route path="/avatar-lab" element={<AvatarLab />} />
                {/* What the model actually learned. Aarav's tool, not a
                  product surface — he asked to see whether it is learning
                  before anything is shown to a student. */}
                <Route path="/model" element={<ModelInspector />} />
              </>
            )}
            <Route path="/complete/:lessonId" element={<LessonComplete />} />
            <Route path="/quiz/:lessonRef" element={<QuizRoute />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/search" element={<Search />} />
            <Route path="/progress" element={<Progress />} />
            <Route path="/doubts" element={<DoubtHistory />} />
            <Route path="/streak" element={<StreakDetail />} />
            <Route path="/notes" element={<Notes />} />
            <Route path="/bookmarks" element={<Bookmarks />} />
            <Route path="/achievements" element={<Achievements />} />
            <Route path="/signin" element={<SignIn />} />
            {/* The contest door, and the try-before-you-enrol door in front
              of it. /enrol?c=<campaign> carries the contest. */}
            <Route path="/enrol" element={<Enrol />} />
            <Route path="/try" element={<TrialConsent />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/help" element={<Help />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Gate>
        </AppConfigGate>
        </Suspense>
      </Boundaried>
    </Router>
  );
}
