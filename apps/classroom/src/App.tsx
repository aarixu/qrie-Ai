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
import { preferencesStore } from './stores/preferences';
import { useStore } from './stores/localStore';
import { loadDiagnosticDataFor } from './lib/diagnosticData';
import { SYLLABI, fetchCatalog, findEntry, type CatalogEntry } from './lib/content';
import { hrefFor } from './lib/destination';
import { reportCrash, track } from './lib/telemetry';
import { isNative } from './lib/platform';
import type { QuizOutcome } from './lib/quiz';
import { Splash, MIN_SPLASH_MS } from './screens/Splash';

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
import { ErrorBoundary } from './ui/ErrorBoundary';
import { Onboarding } from './screens/Onboarding';
import { Home } from './screens/Home';
import { LessonRoute } from './screens/ClassRoom';
import { ActionLab } from './screens/ActionLab';
import { CanvasLab } from './screens/CanvasLab';
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
        onContinue={leave}
        onRetry={() => {
          setOutcome(null);
          setAttempt((n) => n + 1);
        }}
        onReview={() => navigate(`/lesson/${lessonRef}`)}
      />
    );
  }

  return (
    <PracticeQuiz
      key={attempt}
      lessonRef={lessonRef}
      topicRef={entry?.topicRef}
      onComplete={setOutcome}
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
function Gate({ children }: { children: React.ReactNode }) {
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
  const isBench =
    import.meta.env.DEV &&
    (location.pathname === '/canvas-lab' ||
      location.pathname === '/avatar-lab' ||
      location.pathname.startsWith('/action-lab/'));

  if (booting && !isBench) return <Splash />;
  if (!isBench && !isOnboarded(settings) && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }
  return <>{children}</>;
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

export default function App() {
  useAppearance();
  return (
    <Router>
      <Boundaried>
        <Suspense fallback={<Splash />}>
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
            <Route path="/settings" element={<Settings />} />
            <Route path="/help" element={<Help />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Gate>
        </Suspense>
      </Boundaried>
    </Router>
  );
}
