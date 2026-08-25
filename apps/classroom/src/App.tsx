import { useEffect, useState } from 'react';
import {
  BrowserRouter,
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
import { SYLLABI } from './lib/content';
import type { QuizOutcome } from './lib/quiz';
import { Splash, MIN_SPLASH_MS } from './screens/Splash';
import { Onboarding } from './screens/Onboarding';
import { Home } from './screens/Home';
import { Chapter } from './screens/Chapter';
import { LessonRoute } from './screens/ClassRoom';
import { LessonComplete } from './screens/LessonComplete';
import { Profile } from './screens/Profile';
import { Search } from './screens/Search';
import { Progress } from './screens/Progress';
import { Diagnostic } from './screens/Diagnostic';
import { StudyPlan } from './screens/StudyPlan';
import { PracticeQuiz } from './screens/PracticeQuiz';
import { QuizResult } from './screens/QuizResult';
import { Settings } from './screens/Settings';
import { Help } from './screens/Help';
import { DoubtHistory } from './screens/DoubtHistory';
import { StreakDetail } from './screens/StreakDetail';
import { Notes } from './screens/Notes';
import { Bookmarks } from './screens/Bookmarks';
import { Achievements } from './screens/Achievements';

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

  // The stored plan may hold steps from earlier classes (the placement looks
  // back), so the index that renders it must be the same merged one.
  const data = settings.klass !== null ? loadDiagnosticDataFor(settings.klass, profile.subjects) : null;
  if (!hasDiagnostic(profile) || !data) return <Navigate to="/" replace />;

  return (
    <StudyPlan
      result={profile.diagnostic!}
      index={data.index as GraphIndex}
      onStartLesson={(lessonRef) => navigate(`/lesson/${lessonRef}`)}
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

  if (!lessonRef) return <Navigate to="/" replace />;
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
    <PracticeQuiz key={attempt} lessonRef={lessonRef} onComplete={setOutcome} onExit={leave} />
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

  if (booting) return <Splash />;
  if (!isOnboarded(settings) && location.pathname !== '/onboarding') {
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

export default function App() {
  useAppearance();
  return (
    <BrowserRouter>
      <Gate>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/diagnostic" element={<DiagnosticRoute />} />
          <Route path="/plan" element={<StudyPlanRoute />} />
          <Route path="/chapter/:syllabusId/:chapterId" element={<Chapter />} />
          <Route path="/lesson/:lessonId" element={<LessonRoute />} />
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
          <Route path="/settings" element={<Settings />} />
          <Route path="/help" element={<Help />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Gate>
    </BrowserRouter>
  );
}
