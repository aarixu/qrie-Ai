import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { settingsStore, isOnboarded } from './stores/settings';
import { useStore } from './stores/localStore';
import { Onboarding } from './screens/Onboarding';
import { Home } from './screens/Home';
import { Chapter } from './screens/Chapter';
import { LessonRoute } from './screens/ClassRoom';
import { LessonComplete } from './screens/LessonComplete';
import { Profile } from './screens/Profile';

/** First run goes to onboarding; everything else passes through untouched. */
function Gate({ children }: { children: React.ReactNode }) {
  const settings = useStore(settingsStore);
  const location = useLocation();
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
          <Route path="/chapter/:syllabusId/:chapterId" element={<Chapter />} />
          <Route path="/lesson/:lessonId" element={<LessonRoute />} />
          <Route path="/complete/:lessonId" element={<LessonComplete />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Gate>
    </BrowserRouter>
  );
}
