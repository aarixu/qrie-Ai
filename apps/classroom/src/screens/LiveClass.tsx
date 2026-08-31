import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { saveable, type PrepProgress } from '@ai-tutor/class-prep';
import { prepareLiveClass, type LivePrep } from '../lib/liveClass';
import { fetchCatalog, findTopic, forgetCatalog } from '../lib/content';
import { useLessonVoice } from '../lib/lessonVoice';
import { settingsStore } from '../stores/settings';
import { preferencesStore } from '../stores/preferences';
import { useStore } from '../stores/localStore';
import { profileStore } from '../stores/profile';
import { progressStore } from '../stores/progress';
import { outcomeStore } from '../stores/outcomes';
import { createOutcomeLookup } from '../lib/outcomeLookup';
import { studentLinesForPlanner } from '../lib/student';
import { Icon } from '../ui/Icon';
import { ClassRoom } from './ClassRoom';

/**
 * ONE ROOM, WARM OR COLD.
 *
 * `/class/<topicRef>` is "teach me this topic", and it decides for itself how
 * that happens: if somebody has already had this class it is fetched, and if
 * nobody has it is prepared live, right now, and then kept so that the next
 * student is the first kind. The student is never told which happened, because
 * the recording is a CACHE of the first live class rather than a different
 * product — the moment that distinction reaches the UI it stops being one.
 *
 * `/class?topic=<anything>` is the same room off the syllabus, for teaching
 * something the curriculum has no entry for. It is never kept: with no
 * topicRef there is nothing a later student could ask for it by.
 *
 * The room itself is untouched by all of this. `ClassRoom` takes a lesson, a
 * voice and its artwork, and has no idea whether they were made a minute ago
 * or a month ago.
 */

/** What the class is about, gathered before anything is prepared. */
interface Ask {
  topic: string;
  klass: number;
  minutes: number;
  subject: string;
  subtitle?: string;
  /** Absent for a free-text class, which is why one is never saved. */
  topicRef?: string;
}

/**
 * Keep the class, if it is worth keeping.
 *
 * Never allowed to fail the lesson: the student is in the room being taught.
 * Whether a later student gets this class for free is a bonus on top of that,
 * not a condition of it.
 */
async function keep(made: LivePrep, ask: Ask): Promise<void> {
  const saved = saveable(made, {
    topicRef: ask.topicRef,
    klass: ask.klass,
    subject: ask.subject,
    ...(ask.subtitle ? { subtitle: ask.subtitle } : {}),
  });
  if (!saved) return;
  try {
    const res = await fetch('/api/class', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(saved),
    });
    // The catalogue was read before this class existed, so the copy in memory
    // still says the topic is cold. Without this the very next visit prepares
    // it all over again and the writer refuses it as a duplicate.
    if (res.ok) forgetCatalog();
  } catch {
    // Nothing to do and nothing to say: the class is playing.
  }
}

export function LiveClassRoute() {
  const navigate = useNavigate();
  const params = useParams();
  const { search } = useLocation();
  const settings = useStore(settingsStore);
  const preferences = useStore(preferencesStore);

  const topicRef = params['*'] || undefined;
  const freeText = new URLSearchParams(search).get('topic') ?? undefined;

  const ask = useMemo((): Ask | null => {
    if (topicRef) {
      const found = findTopic(topicRef);
      if (!found) return null;
      return {
        topic: found.topic.title,
        klass: found.syllabus.klass,
        // The syllabus' own estimate, kept inside what a few boards can hold.
        minutes: Math.min(4, Math.max(1, found.topic.estMinutes ?? 2)),
        subject: found.syllabus.subject,
        subtitle: `Class ${found.syllabus.klass} · ${found.chapterTitle}`,
        topicRef,
      };
    }
    if (freeText) {
      return { topic: freeText, klass: settings.klass ?? 9, minutes: 2, subject: 'Science' };
    }
    return null;
  }, [topicRef, freeText, settings.klass]);

  const [prep, setPrep] = useState<LivePrep | null>(null);
  const [progress, setProgress] = useState<PrepProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tts = useLessonVoice(null, prep?.lesson ?? null, { enabled: preferences.voice });

  useEffect(() => {
    if (!ask) {
      setError('There is no such topic.');
      return;
    }
    let cancelled = false;

    (async () => {
      // Warm: somebody has already had this class. Handed to the ordinary
      // lesson route rather than replayed here, so there is exactly one place
      // that mounts a room around a saved lesson.
      if (ask.topicRef) {
        const existing = (await fetchCatalog()).find((e) => e.topicRef === ask.topicRef);
        if (cancelled) return;
        if (existing) {
          navigate(`/lesson/${existing.id}`, { replace: true });
          return;
        }
      }

      /**
       * The map reaches the class. Everything the app really knows about this
       * student — name, streak, what they answered wrong, where the placement
       * found shaky ground — goes to the planner as private notes, so the
       * same topic opens differently for different students. Nothing known,
       * nothing said: the anonymous class is the honest default.
       */
      const lookup = createOutcomeLookup(profileStore.get().diagnostic?.mastery);
      const studentLines = studentLinesForPlanner({
        profile: profileStore.get(),
        progress: progressStore.get(),
        outcomes: outcomeStore.get(),
        statement: (id) => lookup.statement(id),
      });
      const made = await prepareLiveClass({ ...ask, studentLines }, (p) => {
        if (!cancelled) setProgress(p);
      });
      if (cancelled) return;
      setPrep(made);
      void keep(made, ask);
    })().catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });

    return () => {
      cancelled = true;
    };
  }, [ask, navigate]);

  if (error) {
    return (
      <div className="bg-background min-h-screen grid place-items-center px-margin-mobile font-body-md">
        <div className="text-center flex flex-col items-center gap-4">
          <Icon name="error" className="text-4xl text-on-surface-variant" />
          <p className="font-headline-md text-[18px] leading-6 text-on-surface">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="bg-stage-primary text-on-stage-primary rounded-full px-6 py-3 font-label-md text-label-md font-semibold border-b-4 border-stage-primary-edge active:border-b-0 active:translate-y-1 transition-all"
          >
            Back home
          </button>
        </div>
      </div>
    );
  }

  if (!prep || !tts) {
    return <GettingReady topic={ask?.topic ?? ''} progress={progress} />;
  }

  return (
    <ClassRoom lesson={prep.lesson} tts={tts} diagrams={prep.assets} onExit={() => navigate('/')} />
  );
}

/**
 * The wait, spent INSIDE the room.
 *
 * Forty seconds is a long time to look at a spinner and no time at all to
 * watch a teacher set up. So this is the dark stage the class is about to
 * happen on, with the work happening in the open — the prep already reports
 * what it is doing, and a student who can see a picture being drawn for them
 * is waiting FOR something rather than just waiting.
 */
function GettingReady({ topic, progress }: { topic: string; progress: PrepProgress | null }) {
  return (
    <div className="bg-stage min-h-screen grid place-items-center px-6">
      <div className="flex flex-col items-center gap-5 text-center max-w-sm">
        <div className="flex items-end gap-1.5 h-6" aria-hidden>
          {[10, 20, 14, 22, 12].map((h, i) => (
            <span
              key={i}
              className="w-1.5 rounded-full bg-white sound-bar"
              style={{ height: h, animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
        <p className="font-headline-md text-[19px] leading-7 font-semibold text-white">
          Meera is preparing your class on {topic}
        </p>
        <p className="font-body-md text-body-md text-white/70">
          {progress?.message ?? 'Reading the topic…'}
        </p>
        <div className="w-56 h-1.5 rounded-full bg-white/25 overflow-hidden">
          <div
            className="h-full rounded-full bg-white transition-[width] duration-500"
            style={{ width: `${Math.round((progress?.done ?? 0.05) * 100)}%` }}
          />
        </div>
        <p className="font-label-md text-label-md text-white/50">
          Nobody has studied this topic yet, so she is making it now.
        </p>
      </div>
    </div>
  );
}
