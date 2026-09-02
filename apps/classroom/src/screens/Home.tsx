import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SYLLABI, fetchCatalog, findEntry, type CatalogEntry } from '../lib/content';
import { useAsync, dataOr } from '../lib/async';
import { OfflineNotice } from '../ui/States';
import { progressStore, isCompleted, computeStreak } from '../stores/progress';
import { profileStore } from '../stores/profile';
import { BRAND } from '../brand';
import { StreakFlame } from '../ui/StreakFlame';
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
  Science: { tile: 'tile-green', ring: 'ring-tint-green', icon: 'science', ink: 'ink-green' },
  Mathematics: { tile: 'tile-blue', ring: 'ring-tint-blue', icon: 'calculate', ink: 'ink-blue' },
  English: { tile: 'tile-purple', ring: 'ring-tint-purple', icon: 'book', ink: 'ink-purple' },
  'Social Science': { tile: 'tile-orange', ring: 'ring-tint-orange', icon: 'public', ink: 'ink-orange' },
  Hindi: { tile: 'tile-purple', ring: 'ring-tint-purple', icon: 'translate', ink: 'ink-purple' },
  Physics: { tile: 'tile-blue', ring: 'ring-tint-blue', icon: 'rocket_launch', ink: 'ink-blue' },
  Chemistry: { tile: 'tile-green', ring: 'ring-tint-green', icon: 'experiment', ink: 'ink-green' },
  Biology: { tile: 'tile-green', ring: 'ring-tint-green', icon: 'genetics', ink: 'ink-green' },
};

const styleFor = (subject: string) => SUBJECT_STYLE[subject] ?? SUBJECT_STYLE.Science;

export function Home() {
  const navigate = useNavigate();
  const progress = useStore(progressStore);
  const profile = useStore(profileStore);
  const { state: catalogState } = useAsync(fetchCatalog, []);
  const catalog = dataOr<CatalogEntry[] | null>(catalogState, null);
  const [resumeEntry, setResumeEntry] = useState<CatalogEntry | null>(null);

  useEffect(() => {
    if (!progress.lastLessonId) return;
    findEntry(progress.lastLessonId).then(setResumeEntry).catch(() => setResumeEntry(null));
  }, [progress.lastLessonId]);

  /**
   * The one button on the home screen must always do something.
   *
   * It used to read `catalog?.[0]` and, if that was undefined — still loading,
   * or the catalogue could not be reached — quietly did nothing at all. A
   * student tapping the biggest button in the app and getting no response has
   * no way to tell that from a broken app. The syllabus is bundled, so there
   * is always a topic to open even with no network: a class prepared on the
   * spot is a better answer than a button that ignores them.
   */
  const firstTopic = useMemo(() => {
    const klass = profile.klass;
    const mine = SYLLABI.filter((s) => klass === null || s.klass === klass);
    for (const syllabus of mine.length > 0 ? mine : SYLLABI) {
      for (const chapter of syllabus.chapters) {
        const topic = chapter.topics[0];
        if (topic) return `/class/${syllabus.id}/${chapter.id}/${topic.id}`;
      }
    }
    return '/syllabus';
  }, [profile.klass]);

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
          {streak > 0 && <StreakFlame days={streak} onClick={() => navigate('/streak')} />}
        </div>
      </header>

      <main className="px-margin-mobile max-w-[1120px] mx-auto grid grid-cols-4 md:grid-cols-12 gap-gutter mt-4 pb-20">
        {/* Said once, here, rather than on every screen a tap might lead to.
            It disappears by itself when the connection comes back. */}
        <OfflineNotice className="col-span-4 md:col-span-12" />

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
                  if (hero) return navigate(`/lesson/${hero.id}`);
                  const first = catalog?.[0];
                  if (first) return navigate(`/lesson/${first.id}`);
                  // Only once we KNOW there is no recorded lesson. Falling
                  // through while the catalogue is still in flight would send
                  // a student off to have a class prepared from scratch —
                  // a minute of waiting and about 140 units of their daily
                  // budget — moments before the recorded one landed.
                  if (catalogState.status === 'loading') return;
                  navigate(firstTopic);
                }}
                aria-busy={catalogState.status === 'loading'}
                className="bg-primary text-on-primary font-label-md text-label-md px-6 py-3 rounded-xl w-full md:w-auto shadow-md border-b-2 border-on-primary-fixed-variant hover:opacity-90 transition-opacity active:scale-95 flex items-center justify-center gap-2"
              >
                <Icon name="play_arrow" filled />
                {hero ? 'Resume Learning' : 'Start Learning'}
              </button>
            </div>
          </div>
        </section>

        {/* Ask her for anything, syllabus or not. */}
        <section className="col-span-4 md:col-span-12">
          <AskBox />
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

/**
 * Ask her to teach anything.
 *
 * The syllabus is what a student is MEANT to study; this is what they actually
 * wondered about at nine at night. It goes to the same room by the same road —
 * only without a topicRef, which is why a class from here is taught and not
 * kept: there is nothing a later student could ask for it by.
 */
function AskBox() {
  const navigate = useNavigate();
  const [topic, setTopic] = useState('');
  const go = () => {
    const asked = topic.trim();
    if (asked) navigate(`/class?topic=${encodeURIComponent(asked)}`);
  };

  return (
    <div className="bg-surface-container-lowest rounded-[20px] p-4 shadow-sm flex items-center gap-3">
      <div className="w-12 h-12 rounded-full grid place-items-center shrink-0 bg-primary text-on-primary">
        <Icon name="auto_awesome" filled />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide">
          Ask Meera
        </div>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
          placeholder="What should she teach you?"
          aria-label="What should she teach you?"
          className="w-full bg-transparent outline-none font-headline-md text-[17px] leading-6 text-on-surface placeholder:text-on-surface-variant"
        />
      </div>
      <button
        onClick={go}
        disabled={topic.trim() === ''}
        aria-label="Start this class"
        className="bg-primary text-on-primary rounded-full w-11 h-11 grid place-items-center shadow-md disabled:opacity-40 active:scale-95 transition-transform"
      >
        <Icon name="arrow_forward" filled />
      </button>
    </div>
  );
}
