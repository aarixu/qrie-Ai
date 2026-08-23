import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { GraphIndex } from '@ai-tutor/knowledge-graph';
import { settingsStore, isOnboarded } from './stores/settings';
import { profileStore, saveDiagnostic, hasDiagnostic } from './stores/profile';
import { useStore } from './stores/localStore';
import { loadDiagnosticData } from './lib/diagnosticData';
import { SYLLABI } from './lib/content';
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

/**
 * The subjects a student is being placed in. The settings store only holds a
 * class today, so the honest answer is "whatever the syllabus actually covers"
 * rather than a list we would be inventing.
 */
const subjectsForClass = (klass: number): string[] =>
  Array.from(new Set(SYLLABI.filter((s) => s.klass === klass).map((s) => s.subject)));

/** /diagnostic — reads the class from settings and hands the engine to the screen. */
function DiagnosticRoute() {
  const navigate = useNavigate();
  const settings = useStore(settingsStore);
  if (settings.klass === null) return <Navigate to="/onboarding" replace />;

  return (
    <Diagnostic
      klass={settings.klass}
      subjects={subjectsForClass(settings.klass)}
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

  const data = settings.klass !== null ? loadDiagnosticData(settings.klass) : null;
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

export default function App() {
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
          <Route path="/profile" element={<Profile />} />
          <Route path="/search" element={<Search />} />
          <Route path="/progress" element={<Progress />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Gate>
    </BrowserRouter>
  );
}
