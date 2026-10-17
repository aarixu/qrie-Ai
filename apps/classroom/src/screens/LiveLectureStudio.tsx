import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Lesson } from '@ai-tutor/lesson-format';
import { Scene, computeVisible } from '@ai-tutor/stage';
import { usePlayer } from '@ai-tutor/player';
import { CartoonAvatar, type AvatarPose } from '../avatar/CartoonAvatar';
import { createLectureTts } from '../lib/lectureTts';
import { CURATED_LESSONS, fetchCatalogLesson } from '../lib/lectureCatalog';
import { askLiveDoubt } from '../lib/lectureDoubt';
import { generateLiveLecture, type GenerationProgress } from '../lib/lectureGenerator';

export function LiveLectureStudio() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Navigation states: 'SELECT' | 'PREP' | 'CLASS'
  const [view, setView] = useState<'SELECT' | 'PREP' | 'CLASS'>('SELECT');
  const [activeLesson, setActiveLesson] = useState<Lesson | null>(null);
  const [activeAssets, setActiveAssets] = useState<Record<string, string>>({});

  // Subject Selection state
  const [selectedSubject, setSelectedSubject] = useState<'Mathematics' | 'Science'>('Mathematics');
  const [selectedGrade, setSelectedGrade] = useState<number>(10);
  const [customTopic, setCustomTopic] = useState('');

  // Generation state
  const [prepProgress, setPrepProgress] = useState<GenerationProgress>({
    phase: 'planning',
    message: 'Starting…',
    progressPercent: 0,
  });

  // Check URL query on mount for direct load: ?lessonId=...
  useEffect(() => {
    const lessonId = searchParams.get('lesson');
    if (lessonId) {
      void handleSelectCurated(lessonId);
    }
  }, [searchParams]);

  const handleSelectCurated = async (lessonId: string) => {
    try {
      const { lesson, assets } = await fetchCatalogLesson(lessonId);
      setActiveLesson(lesson);
      setActiveAssets(assets);
      setView('CLASS');
    } catch (err) {
      console.error('Failed to load curated lesson:', err);
      alert(`Could not load lesson: ${(err as Error).message}`);
    }
  };

  const handleGenerateCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customTopic.trim()) return;

    const topic = customTopic.trim();
    setView('PREP');
    try {
      const { lesson, assets } = await generateLiveLecture(
        topic,
        selectedSubject,
        selectedGrade,
        (p) => setPrepProgress(p)
      );
      setActiveLesson(lesson);
      setActiveAssets(assets);
      setView('CLASS');
    } catch (err) {
      console.error('Failed to generate live class:', err);
      alert(`Could not generate class: ${(err as Error).message}`);
      setView('SELECT');
    }
  };

  // ----------------------------------------------------
  // SUB-COMPONENT: Live Classroom Screen
  // ----------------------------------------------------
  function ClassroomView({
    lesson,
    assets,
    onBack,
  }: {
    lesson: Lesson;
    assets: Record<string, string>;
    onBack: () => void;
  }) {
    const tts = useMemo(() => createLectureTts(), []);
    const player = usePlayer(lesson, tts);

    const [inDoubt, setInDoubt] = useState(false);
    const [doubtText, setDoubtText] = useState('');
    const [doubtAnswer, setDoubtAnswer] = useState<string | null>(null);
    const [isAsking, setIsAsking] = useState(false);
    const [avatarPose, setAvatarPose] = useState<AvatarPose>('explain');

    const { visible, focus, frame } = useMemo(
      () => computeVisible(lesson, player.beatIndex),
      [lesson, player.beatIndex]
    );

    useEffect(() => {
      if (inDoubt) {
        setAvatarPose(doubtAnswer ? 'explain' : 'listen');
        return;
      }
      if (player.state === 'playing') {
        const poses: AvatarPose[] = ['explain', 'point', 'greet', 'think'];
        setAvatarPose(poses[player.beatIndex % poses.length]);
      } else {
        setAvatarPose('idle');
      }
    }, [player.state, player.beatIndex, inDoubt, doubtAnswer]);

    useEffect(() => {
      const timer = setTimeout(() => {
        player.play();
      }, 500);
      return () => {
        clearTimeout(timer);
        tts.cancel();
      };
    }, []);

    const handleRaiseHand = () => {
      player.pause();
      tts.cancel();
      setInDoubt(true);
      setDoubtAnswer(null);
    };

    const handleSendDoubt = async (queryText?: string) => {
      const question = (queryText || doubtText).trim();
      if (!question) return;

      setIsAsking(true);
      setAvatarPose('think');
      try {
        const answer = await askLiveDoubt(question, lesson, player.beat);
        setDoubtAnswer(answer);
        setAvatarPose('explain');
        void tts.speak(answer);
      } catch {
        setDoubtAnswer("Notice how the formula connects to the highlighted diagram on the board. Let's resume the class!");
      } finally {
        setIsAsking(false);
      }
    };

    const handleResume = () => {
      tts.cancel();
      setInDoubt(false);
      setDoubtAnswer(null);
      setDoubtText('');
      player.play();
    };

    const totalBeats = lesson.beats.length;
    const currentBeatNumber = player.beatIndex + 1;
    const progressRatio = totalBeats > 0 ? (currentBeatNumber / totalBeats) * 100 : 0;

    return (
      <div className="min-h-screen bg-[#1c1a17] text-[#ede6da] flex flex-col justify-between font-sans select-none">
        {/* Top Header */}
        <header className="h-16 px-4 sm:px-6 bg-[#25221d] border-b border-[#38332b] flex items-center justify-between shrink-0 z-20">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                tts.cancel();
                onBack();
              }}
              className="text-xs font-bold bg-[#38332b] hover:bg-[#474036] text-[#c7beaf] hover:text-white px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
            >
              <span>←</span>
              <span>All Classes</span>
            </button>
            <div className="h-4 w-[1px] bg-[#3e382f]" />
            <div>
              <h1 className="text-sm sm:text-base font-bold text-[#faf8f5] leading-none">
                {lesson.title}
              </h1>
              <p className="text-xs text-[#a39786] mt-0.5">{lesson.subtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 bg-[#2f2b24] px-2.5 py-1 rounded-full text-xs text-[#34d872] font-semibold border border-[#34d872]/20">
              <span className="w-2 h-2 rounded-full bg-[#34d872] animate-pulse" />
              <span>Live Interactive</span>
            </div>
            <span className="text-xs text-[#a69b8b] font-mono">
              Beat {currentBeatNumber} of {totalBeats}
            </span>
          </div>
        </header>

        {/* Main Stage & Avatar */}
        <main className="flex-1 relative flex flex-col items-center justify-center p-2 sm:p-6 overflow-hidden">
          <div className="w-full max-w-5xl aspect-[1000/620] bg-[#141311] rounded-2xl shadow-2xl border border-[#322c25] overflow-hidden relative">
            <Scene
              lesson={lesson}
              visible={visible}
              focus={focus}
              frame={frame}
              assets={assets}
            />

            {/* Mascot Avatar Tile */}
            <div className="absolute bottom-4 right-4 w-28 h-28 sm:w-36 sm:h-36 bg-[#25211c]/90 backdrop-blur-sm rounded-2xl border border-[#433b31] p-1.5 shadow-xl flex flex-col items-center justify-center transition-all">
              <CartoonAvatar pose={avatarPose} className="w-full h-full" />
              <div className="absolute top-1.5 left-2 text-[10px] uppercase font-bold text-[#f3b84d] tracking-wider bg-[#1c1813]/80 px-1.5 rounded">
                Curie Tutor
              </div>
            </div>

            {/* Subtitle Caption */}
            {player.caption && (
              <div className="absolute bottom-4 left-4 right-36 sm:right-44 bg-[#1e1a15]/85 backdrop-blur-md px-4 py-2.5 rounded-xl border border-[#383127] text-xs sm:text-sm text-[#e6ded1] font-medium leading-relaxed max-w-xl">
                {player.caption}
              </div>
            )}
          </div>
        </main>

        {/* Bottom Bar */}
        <footer className="h-20 bg-[#25221d] border-t border-[#38332b] px-4 sm:px-8 flex items-center justify-between shrink-0 z-20">
          <div className="w-48 hidden md:block">
            <div className="text-xs font-semibold text-[#f3b84d] truncate">
              {player.beat?.topic || 'Interactive Classroom'}
            </div>
            <div className="w-full bg-[#38332b] h-1.5 rounded-full mt-1.5 overflow-hidden">
              <div
                className="bg-[#f3b84d] h-full transition-all duration-300"
                style={{ width: `${progressRatio}%` }}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 mx-auto">
            <button
              onClick={() => {
                if (player.beatIndex > 0) player.seek(player.beatIndex - 1);
              }}
              disabled={player.beatIndex === 0}
              className="w-10 h-10 rounded-full bg-[#38332b] hover:bg-[#474036] text-[#ede6da] flex items-center justify-center text-sm disabled:opacity-40 transition-transform active:scale-95"
              title="Previous beat"
            >
              ⏮
            </button>

            <button
              onClick={() => {
                if (player.state === 'playing') {
                  player.pause();
                  tts.cancel();
                } else {
                  player.play();
                }
              }}
              className="w-14 h-14 rounded-full bg-[#f3b84d] hover:bg-[#e2a83e] text-[#241701] flex items-center justify-center text-xl font-bold shadow-lg transition-transform active:scale-95"
              title={player.state === 'playing' ? 'Pause' : 'Play'}
            >
              {player.state === 'playing' ? '⏸' : '▶'}
            </button>

            <button
              onClick={() => {
                if (player.beatIndex < totalBeats - 1) player.seek(player.beatIndex + 1);
              }}
              disabled={player.beatIndex >= totalBeats - 1}
              className="w-10 h-10 rounded-full bg-[#38332b] hover:bg-[#474036] text-[#ede6da] flex items-center justify-center text-sm disabled:opacity-40 transition-transform active:scale-95"
              title="Next beat"
            >
              ⏭
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRaiseHand}
              className={`px-4 sm:px-5 py-2.5 rounded-full font-bold text-xs sm:text-sm flex items-center gap-2 transition-all active:scale-95 shadow-md ${
                inDoubt
                  ? 'bg-[#ea4335] text-white ring-2 ring-[#ea4335]/50'
                  : 'bg-[#f3b84d]/20 hover:bg-[#f3b84d]/30 text-[#f3b84d] border border-[#f3b84d]/40'
              }`}
            >
              <span className="text-base">✋</span>
              <span>{inDoubt ? 'Doubt Session Active' : 'Raise Hand'}</span>
            </button>
          </div>
        </footer>

        {/* Doubt Modal */}
        {inDoubt && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-[#24201a] border border-[#433b30] rounded-3xl max-w-lg w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between pb-3 border-b border-[#3a3328]">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">✋</span>
                  <div>
                    <h3 className="text-base font-bold text-[#f8f5f0]">Ask Your Doubt Live</h3>
                    <p className="text-xs text-[#a39786]">
                      Paused at: <span className="text-[#f3b84d]">{player.beat?.topic}</span>
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleResume}
                  className="text-[#968977] hover:text-white text-lg font-bold p-1"
                >
                  ✕
                </button>
              </div>

              <div className="my-4">
                <span className="text-xs font-semibold text-[#8a7e6f] block mb-2 uppercase tracking-wider">
                  Quick questions:
                </span>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleSendDoubt('Can you explain this step again in simpler terms?')}
                    className="text-xs bg-[#302b23] hover:bg-[#3d362c] text-[#ded5c7] px-3 py-1.5 rounded-full border border-[#433b30] transition-colors"
                  >
                    "Explain this again simply"
                  </button>
                  <button
                    onClick={() => handleSendDoubt('What is the most common exam mistake in this step?')}
                    className="text-xs bg-[#302b23] hover:bg-[#3d362c] text-[#ded5c7] px-3 py-1.5 rounded-full border border-[#433b30] transition-colors"
                  >
                    "Common exam mistakes?"
                  </button>
                  <button
                    onClick={() => handleSendDoubt('Why is this formula or rule applied here?')}
                    className="text-xs bg-[#302b23] hover:bg-[#3d362c] text-[#ded5c7] px-3 py-1.5 rounded-full border border-[#433b30] transition-colors"
                  >
                    "Why this formula?"
                  </button>
                </div>
              </div>

              {doubtAnswer && (
                <div className="bg-[#191714] border border-[#3e372c] rounded-2xl p-4 mb-4 text-sm text-[#ede4d8] leading-relaxed">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#f3b84d] mb-1">
                    <span>✨ Curie's Answer:</span>
                  </div>
                  <p>{doubtAnswer}</p>
                </div>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  value={doubtText}
                  onChange={(e) => setDoubtText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSendDoubt();
                  }}
                  placeholder="Type your question..."
                  disabled={isAsking}
                  className="flex-1 bg-[#1a1714] border border-[#3e362b] text-[#ede5da] px-3.5 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#f3b84d]"
                />
                <button
                  onClick={() => handleSendDoubt()}
                  disabled={isAsking || !doubtText.trim()}
                  className="bg-[#f3b84d] hover:bg-[#e0a53b] text-[#241701] font-bold px-4 py-2.5 rounded-xl text-sm transition-all disabled:opacity-40"
                >
                  {isAsking ? 'Thinking…' : 'Ask'}
                </button>
              </div>

              <div className="mt-5 pt-3 border-t border-[#383126] flex justify-end">
                <button
                  onClick={handleResume}
                  className="bg-[#38d46e] hover:bg-[#2bbd60] text-[#0d3b1e] font-bold px-5 py-2.5 rounded-xl text-sm transition-transform active:scale-95 shadow-md flex items-center gap-1.5"
                >
                  <span>Resume Lecture</span>
                  <span>▶</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ----------------------------------------------------
  // SUB-COMPONENT: Preparation View
  // ----------------------------------------------------
  if (view === 'PREP') {
    return (
      <div className="min-h-screen bg-[#181614] text-[#ede6da] flex flex-col items-center justify-center p-6 select-none font-sans">
        <div className="max-w-md w-full bg-[#24201a] border border-[#3e362c] rounded-3xl p-8 shadow-2xl text-center">
          <div className="w-20 h-20 mx-auto mb-6 relative flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border-4 border-[#3e362c] border-t-[#f3b84d] animate-spin" />
            <span className="text-3xl">✨</span>
          </div>

          <span className="text-xs font-bold uppercase tracking-widest text-[#f3b84d] bg-[#3a2d18] px-3 py-1 rounded-full mb-3 inline-block">
            Live Lecture Preparation
          </span>

          <h2 className="text-xl font-bold text-[#faf8f5] mt-2 mb-1">{customTopic}</h2>
          <p className="text-xs text-[#a39786] mb-6">
            Class {selectedGrade} · {selectedSubject}
          </p>

          <div className="w-full bg-[#342e26] h-2.5 rounded-full overflow-hidden mb-3">
            <div
              className="bg-gradient-to-r from-[#d99f33] to-[#f3b84d] h-full transition-all duration-300"
              style={{ width: `${prepProgress.progressPercent}%` }}
            />
          </div>

          <p className="text-xs text-[#c4b9aa] font-medium animate-pulse">
            {prepProgress.message}
          </p>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // SUB-COMPONENT: Classroom Active
  // ----------------------------------------------------
  if (view === 'CLASS' && activeLesson) {
    return (
      <ClassroomView
        lesson={activeLesson}
        assets={activeAssets}
        onBack={() => {
          setActiveLesson(null);
          setActiveAssets({});
          setView('SELECT');
        }}
      />
    );
  }

  // ----------------------------------------------------
  // SUB-COMPONENT: Subject Selection Entry Point
  // ----------------------------------------------------
  const filteredLessons = CURATED_LESSONS.filter(
    (l) => l.subject === selectedSubject && (selectedGrade === null || l.class === selectedGrade)
  );

  return (
    <div className="min-h-screen bg-[#faf7f2] dark:bg-[#181614] text-[#2c2724] dark:text-[#f4efe8] p-4 sm:p-8 transition-colors">
      <div className="max-w-5xl mx-auto">
        {/* Navigation Bar */}
        <div className="flex items-center justify-between pb-4 border-b border-[#e8dfd5] dark:border-[#302b26] mb-6">
          <button
            onClick={() => navigate('/')}
            className="text-xs font-bold bg-[#eae1d5] dark:bg-[#2c2620] hover:bg-[#dfd4c5] text-[#5c5144] dark:text-[#c4b8aa] px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <span>←</span>
            <span>Back to Dashboard</span>
          </button>
          <span className="text-xs font-semibold text-[#8a7f72] dark:text-[#a09485]">
            Curie Live Lecture Studio
          </span>
        </div>

        {/* Header Banner */}
        <header className="text-center py-6 border-b border-[#e8dfd5] dark:border-[#302b26] mb-8">
          <div className="inline-flex items-center gap-2 bg-[#f4e6d0] dark:bg-[#342918] text-[#7a4805] dark:text-[#f3b84d] text-xs font-semibold px-3 py-1 rounded-full mb-3 tracking-wide uppercase">
            <span>✨ Real-Time Vector Classroom</span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight font-headline-xl text-[#1e1b18] dark:text-[#fbf9f5]">
            Choose Subject for Live Class
          </h1>
          <p className="mt-3 text-base text-[#6b6257] dark:text-[#b4aaa0] max-w-2xl mx-auto">
            Experience real-time interactive teaching in Mathematics and Science with procedural whiteboard drawing, speech narration, animated avatar, and live doubt resolution.
          </p>
        </header>

        {/* 1. Subject Selector Cards */}
        <section className="mb-10">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#8a7f72] dark:text-[#a09485] mb-4">
            1. Select Subject
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              onClick={() => setSelectedSubject('Mathematics')}
              className={`p-6 rounded-2xl text-left border-2 transition-all relative overflow-hidden flex items-start gap-4 ${
                selectedSubject === 'Mathematics'
                  ? 'border-[#f3b84d] bg-[#fbf5eb] dark:bg-[#282116] shadow-lg ring-2 ring-[#f3b84d]/40'
                  : 'border-[#e8dfd5] dark:border-[#2f2b26] bg-white dark:bg-[#211d19] hover:border-[#d9cbba] dark:hover:border-[#423c34]'
              }`}
            >
              <div className="w-14 h-14 rounded-xl bg-[#f5dfb8] dark:bg-[#483719] text-[#7a4907] dark:text-[#f5c260] flex items-center justify-center text-2xl font-bold shrink-0">
                ∑
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold text-[#1f1b17] dark:text-[#fdfbfa]">
                    Mathematics
                  </h3>
                  {selectedSubject === 'Mathematics' && (
                    <span className="text-xs bg-[#f3b84d] text-[#2c1d02] font-bold px-2.5 py-0.5 rounded-full">
                      Selected
                    </span>
                  )}
                </div>
                <p className="text-sm text-[#73685c] dark:text-[#a89d91] mt-1">
                  Quadratic equations, algebra, geometry, trigonometry, coordinate geometry & probability.
                </p>
              </div>
            </button>

            <button
              onClick={() => setSelectedSubject('Science')}
              className={`p-6 rounded-2xl text-left border-2 transition-all relative overflow-hidden flex items-start gap-4 ${
                selectedSubject === 'Science'
                  ? 'border-[#34d872] bg-[#f0faf4] dark:bg-[#14261b] shadow-lg ring-2 ring-[#34d872]/40'
                  : 'border-[#e8dfd5] dark:border-[#2f2b26] bg-white dark:bg-[#211d19] hover:border-[#d9cbba] dark:hover:border-[#423c34]'
              }`}
            >
              <div className="w-14 h-14 rounded-xl bg-[#c5f2d6] dark:bg-[#1d4d2e] text-[#136832] dark:text-[#7ce7a2] flex items-center justify-center text-2xl font-bold shrink-0">
                🔬
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold text-[#1f1b17] dark:text-[#fdfbfa]">
                    Science
                  </h3>
                  {selectedSubject === 'Science' && (
                    <span className="text-xs bg-[#34d872] text-[#0f3d20] font-bold px-2.5 py-0.5 rounded-full">
                      Selected
                    </span>
                  )}
                </div>
                <p className="text-sm text-[#73685c] dark:text-[#a89d91] mt-1">
                  Biology, chemistry, physics, life processes, cellular mechanics, and atomic structures.
                </p>
              </div>
            </button>
          </div>
        </section>

        {/* 2. Grade Filter */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-[#8a7f72] dark:text-[#a09485]">
              2. Select Class / Grade Level
            </h2>
            <span className="text-xs text-[#8a7f72] dark:text-[#a09485]">NCERT Aligned</span>
          </div>
          <div className="flex gap-2">
            {[8, 9, 10].map((grade) => (
              <button
                key={grade}
                onClick={() => setSelectedGrade(grade)}
                className={`px-5 py-2.5 rounded-full text-sm font-semibold transition-all ${
                  selectedGrade === grade
                    ? 'bg-[#2c2621] text-white dark:bg-[#ede5da] dark:text-[#1c1815] shadow'
                    : 'bg-[#ece4d9] dark:bg-[#29241f] text-[#6b6156] dark:text-[#a59b90] hover:bg-[#e2d8cb]'
                }`}
              >
                Class {grade}
              </button>
            ))}
          </div>
        </section>

        {/* 3. Available Curated Lecture Classes */}
        <section className="mb-12">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#8a7f72] dark:text-[#a09485] mb-4">
            3. Curated Live Classes for {selectedSubject} (Class {selectedGrade})
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredLessons.map((lesson) => (
              <div
                key={lesson.id}
                className="bg-white dark:bg-[#211d19] border border-[#e8dfd5] dark:border-[#312b25] p-5 rounded-2xl flex flex-col justify-between hover:shadow-md transition-shadow group"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-[#f5eee4] dark:bg-[#2d2721] text-[#706456] dark:text-[#b0a597]">
                      {lesson.subtitle}
                    </span>
                    <span className="text-xs text-[#8c8175] flex items-center gap-1 font-medium">
                      ⏱ {lesson.durationMinutes} mins
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-[#1f1b17] dark:text-[#f8f6f3] group-hover:text-[#c48417] dark:group-hover:text-[#f3b84d] transition-colors">
                    {lesson.title}
                  </h3>
                  <p className="text-sm text-[#73685c] dark:text-[#a89d91] mt-2 line-clamp-2">
                    {lesson.description}
                  </p>
                </div>

                <div className="mt-5 pt-4 border-t border-[#f0e8de] dark:border-[#2d2823] flex items-center justify-between">
                  <span className="text-xs text-[#8a7f72] dark:text-[#a09485] font-medium">
                    Canvas + Voice + Avatar
                  </span>
                  <button
                    onClick={() => handleSelectCurated(lesson.id)}
                    className="inline-flex items-center gap-2 bg-[#2c2621] hover:bg-[#433c35] text-white dark:bg-[#f3b84d] dark:hover:bg-[#e0a438] dark:text-[#211502] text-sm font-bold px-4 py-2 rounded-xl transition-transform active:scale-95 shadow-sm"
                  >
                    <span>Start Class</span>
                    <span>→</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {filteredLessons.length === 0 && (
            <div className="bg-white dark:bg-[#211d19] p-8 rounded-2xl text-center border border-dashed border-[#dcd2c4] dark:border-[#383129]">
              <p className="text-[#756a5e] dark:text-[#aaa095]">
                No pre-cached lessons in this grade. Use the custom topic generator below to generate any topic live!
              </p>
            </div>
          )}
        </section>

        {/* 4. Custom Lecture Generation Box */}
        <section className="bg-gradient-to-br from-[#f8f1e6] to-[#f4e8d6] dark:from-[#251f18] dark:to-[#1c1813] border border-[#e2d5c2] dark:border-[#3c3328] p-6 sm:p-8 rounded-3xl shadow-sm mb-12">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">⚡</span>
            <h2 className="text-xl font-bold text-[#1e1b17] dark:text-[#faf7f3]">
              Generate Any Custom Topic Live
            </h2>
          </div>
          <p className="text-sm text-[#706456] dark:text-[#b4aaa0] mb-5">
            Type any specific topic in {selectedSubject} (Class {selectedGrade}). The AI tutor will plan beats, structure the SVG canvas, prime voice narration, and open the classroom in ~14 seconds.
          </p>

          <form onSubmit={handleGenerateCustom} className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              placeholder={
                selectedSubject === 'Mathematics'
                  ? 'e.g. Laws of Exponents, Trigonometric Identities, Linear Equations'
                  : 'e.g. Newton’s Laws of Motion, Chemical Reactions, Photosynthesis'
              }
              className="flex-1 bg-white dark:bg-[#181512] border border-[#d8ccbb] dark:border-[#42392e] text-[#1c1815] dark:text-[#f8f6f3] px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#f3b84d] text-sm"
            />
            <button
              type="submit"
              disabled={!customTopic.trim()}
              className="bg-[#d99726] hover:bg-[#be821a] text-white font-bold px-6 py-3 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2 shadow-sm"
            >
              <span>🚀 Generate Live Class</span>
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
