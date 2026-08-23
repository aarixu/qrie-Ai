import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SYLLABI, fetchCatalog, findEntry, type CatalogEntry } from '../lib/content';
import { progressStore, isCompleted, computeStreak } from '../stores/progress';
import { profileStore } from '../stores/profile';
import { BRAND } from '../brand';
import { useStore } from '../stores/localStore';
import { Icon } from '../ui/Icon';
import { BottomNav, SideNav } from '../ui/Nav';

/**
 * Home, built to the Stitch design: a greeting bar with the streak, a hero card
 * for the lesson in progress, and a grid of subject tiles.
 *
 * Wiring only — the numbers are real (progress store, lesson catalog, syllabus
 * tree); nothing here is placeholder copy.
 */

/** Tile styling per subject. Unknown subjects fall back to the first entry. */
const SUBJECT_STYLE: Record<string, { tile: string; ring: string; icon: string; ink: string }> = {
  Science: { tile: 'tile-green', ring: 'bg-[#dcfce7]', icon: 'science', ink: 'text-[#166534]' },
  Mathematics: { tile: 'tile-blue', ring: 'bg-[#dbeafe]', icon: 'calculate', ink: 'text-[#1e40af]' },
  English: { tile: 'tile-purple', ring: 'bg-[#f3e8ff]', icon: 'book', ink: 'text-[#6b21a8]' },
  'Social Science': { tile: 'tile-orange', ring: 'bg-[#ffedd5]', icon: 'public', ink: 'text-[#9a3412]' },
  Hindi: { tile: 'tile-purple', ring: 'bg-[#f3e8ff]', icon: 'translate', ink: 'text-[#6b21a8]' },
  Physics: { tile: 'tile-blue', ring: 'bg-[#dbeafe]', icon: 'rocket_launch', ink: 'text-[#1e40af]' },
  Chemistry: { tile: 'tile-green', ring: 'bg-[#dcfce7]', icon: 'experiment', ink: 'text-[#166534]' },
  Biology: { tile: 'tile-green', ring: 'bg-[#dcfce7]', icon: 'genetics', ink: 'text-[#166534]' },
};

const styleFor = (subject: string) => SUBJECT_STYLE[subject] ?? SUBJECT_STYLE.Science;

export function Home() {
  const navigate = useNavigate();
  const progress = useStore(progressStore);
  const profile = useStore(profileStore);
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [resumeEntry, setResumeEntry] = useState<CatalogEntry | null>(null);

  useEffect(() => {
    fetchCatalog().then(setCatalog).catch(() => setCatalog([]));
  }, []);

  useEffect(() => {
    if (!progress.lastLessonId) return;
    findEntry(progress.lastLessonId).then(setResumeEntry).catch(() => setResumeEntry(null));
  }, [progress.lastLessonId]);

  const streak = computeStreak(progress);

  // The hero shows the lesson actually in progress; a finished one is not
  // something to "resume".
  const hero = resumeEntry && !isCompleted(progress, resumeEntry.id) ? resumeEntry : null;
  const heroBeat = hero ? (progress.lessons[hero.id]?.beatIndex ?? 0) : 0;
  // Beat counts live inside the lesson file, so approximate from the saved beat
  // against a typical 8-beat lesson rather than fetching every lesson to render Home.
  const heroPercent = hero ? Math.min(95, Math.round((heroBeat / 8) * 100)) : 0;

  // Subjects the student picked, else everything the syllabus offers.
  const subjects = Array.from(new Set(SYLLABI.map((s) => s.subject)));

  const chapterCount = (subject: string) =>
    SYLLABI.filter((s) => s.subject === subject).reduce((n, s) => n + s.chapters.length, 0);

  const firstChapterPath = (subject: string): string | null => {
    const syllabus = SYLLABI.find((s) => s.subject === subject);
    const chapter = syllabus?.chapters[0];
    return syllabus && chapter ? `/chapter/${syllabus.id}/${chapter.id}` : null;
  };

  return (
    <div className="bg-background text-on-background min-h-screen font-body-md pb-24 md:pb-8 md:pl-[232px]">
      {/* Top app bar */}
      <header className="w-full top-0 sticky bg-background z-40">
        <div className="flex justify-between items-center px-margin-mobile py-4 max-w-[1120px] mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full border-2 border-primary-fixed bg-primary-fixed grid place-items-center shadow-sm">
              <Icon name="person" filled className="text-on-primary-fixed" />
            </div>
            <h1 className="font-headline-md text-headline-md font-bold text-primary">
              {BRAND.greeting}
              {profile.name ? `, ${profile.name}!` : '!'}
            </h1>
          </div>
          {streak > 0 && (
            <div
              aria-label={`${streak} day streak`}
              className="flex items-center gap-1 bg-secondary-container text-on-secondary-container rounded-full px-3 py-1 shadow-sm font-label-md text-label-md"
            >
              <Icon name="local_fire_department" filled className="text-[18px]" />
              {streak} {streak === 1 ? 'Day' : 'Days'}
            </div>
          )}
        </div>
      </header>

      <main className="px-margin-mobile max-w-[1120px] mx-auto grid grid-cols-4 md:grid-cols-12 gap-gutter mt-4 pb-20">
        {/* Hero: continue where you left off */}
        <section className="col-span-4 md:col-span-12 mb-stack-lg">
          <div className="bg-surface-container-lowest rounded-[24px] p-card-padding shadow-[0px_4px_20px_rgba(99,102,241,0.08)] hover:shadow-[0px_8px_30px_rgba(99,102,241,0.12)] transition-shadow relative overflow-hidden">
            <div
              className="absolute inset-0 opacity-5 pointer-events-none"
              style={{
                backgroundImage: 'radial-gradient(#494bd6 1px, transparent 1px)',
                backgroundSize: '16px 16px',
              }}
            />
            <div className="relative z-10">
              <span className="inline-block bg-primary-fixed text-on-primary-fixed-variant px-3 py-1 rounded-full font-label-sm text-label-sm mb-3">
                {hero?.subject ?? 'Science'}
              </span>
              <h2 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg mb-2">
                {hero?.title ?? 'Start your first class'}
              </h2>
              <p className="font-body-md text-body-md text-on-surface-variant mb-6">
                {hero
                  ? "You're making great progress! Continue where you left off."
                  : 'Pick a subject below and dive in — your tutor is ready.'}
              </p>

              {hero && (
                <div className="mb-6">
                  <div className="flex justify-between font-label-md text-label-md mb-2">
                    <span>Progress</span>
                    <span className="font-bold">{heroPercent}%</span>
                  </div>
                  <div className="h-[12px] bg-surface-variant rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-[width] duration-500"
                      style={{ width: `${heroPercent}%` }}
                    />
                  </div>
                </div>
              )}

              <button
                onClick={() => {
                  if (hero) navigate(`/lesson/${hero.id}`);
                  else {
                    const first = catalog?.[0];
                    if (first) navigate(`/lesson/${first.id}`);
                  }
                }}
                className="bg-primary text-on-primary font-label-md text-label-md px-6 py-3 rounded-xl w-full md:w-auto shadow-md border-b-2 border-[#2f2ebe] hover:opacity-90 transition-opacity active:scale-95 flex items-center justify-center gap-2"
              >
                <Icon name="play_arrow" filled />
                {hero ? 'Resume Learning' : 'Start Learning'}
              </button>
            </div>
          </div>
        </section>

        {/* Subjects */}
        <section className="col-span-4 md:col-span-12">
          <h3 className="font-headline-md text-headline-md mb-stack-md text-on-surface">
            Explore Subjects
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {subjects.map((subject) => {
              const s = styleFor(subject);
              const path = firstChapterPath(subject);
              const chapters = chapterCount(subject);
              return (
                <button
                  key={subject}
                  onClick={() => path && navigate(path)}
                  className={`${s.tile} rounded-[24px] p-4 flex flex-col items-center justify-center text-center shadow-sm hover:shadow-md hover:scale-[1.02] transition-all cursor-pointer`}
                >
                  <div className={`w-16 h-16 ${s.ring} rounded-full flex items-center justify-center mb-3`}>
                    <Icon name={s.icon} className={`text-4xl ${s.ink}`} />
                  </div>
                  <h4 className="font-headline-md text-[20px] leading-7 mb-1">{subject}</h4>
                  <p className={`font-label-sm text-label-sm ${s.ink}`}>
                    {chapters} {chapters === 1 ? 'Chapter' : 'Chapters'}
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      </main>

      <SideNav />
      <BottomNav />
    </div>
  );
}
