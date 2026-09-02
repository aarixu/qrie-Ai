import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { saveable, type PrepProgress } from '@ai-tutor/class-prep';
import type { Lesson } from '@ai-tutor/lesson-format';
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
import { useOnline } from '../lib/online';
import { relayFetch } from '../lib/relay';
import { quoteForPrompt, screen } from '@ai-tutor/safety';
import { recordFlag } from '../stores/flags';
import { track } from '../lib/telemetry';
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

/** Not a class at all — what she says instead. */
interface Refused {
  refused: string;
  /** Recorded once, in an effect, rather than while deciding. */
  flag: 'redirect' | 'support';
}

const isRefused = (ask: Ask | Refused | null): ask is Refused =>
  ask !== null && 'refused' in ask;

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
async function keep(made: LivePrep, ask: Ask, names: readonly string[]): Promise<void> {
  const saved = saveable(made, {
    topicRef: ask.topicRef,
    klass: ask.klass,
    subject: ask.subject,
    ...(ask.subtitle ? { subtitle: ask.subtitle } : {}),
    // What the planner was told, so a class that used it is not kept for
    // somebody else. The name is the one that actually leaks; the rest of the
    // notes are outcomes and scores, which the planner is forbidden to recite.
    studentNames: names,
  });
  if (!saved) return;
  try {
    const res = await relayFetch('/api/class', {
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

  const asked = useMemo((): Ask | Refused | null => {
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
      // A child types this and it becomes the instruction a planner writes a
      // whole class from — the widest unguarded input in the app. Screened
      // like any other thing a student says.
      //
      // `screen` rather than `fromStudent`: this runs inside a useMemo, and
      // useMemo runs twice under StrictMode. fromStudent WRITES — it records
      // a flag — so it would log every refusal twice, and a doubled entry can
      // push a real distress flag out of a log that keeps fifty. The pure
      // decision belongs here; the recording happens once, in the effect.
      const verdict = screen(freeText, 'from-student');
      if (verdict.kind === 'redirect' || verdict.kind === 'support') {
        return { refused: verdict.say, flag: verdict.kind };
      }
      return {
        topic: quoteForPrompt(verdict.text),
        klass: settings.klass ?? 9,
        minutes: 2,
        subject: 'Science',
      };
    }
    return null;
  }, [topicRef, freeText, settings.klass]);

  /**
   * She declined, and that is a complete answer rather than a failure.
   *
   * Kept apart from `ask` so every path below it still sees an ordinary Ask
   * or nothing at all — and apart from `error`, because a refusal is not
   * something to offer a Try again for.
   */
  const refusal = isRefused(asked) ? asked : null;
  const refused = refusal?.refused ?? null;
  const ask: Ask | null = refusal === null ? (asked as Ask | null) : null;

  // Once, and only when it actually happened. A flag is a fact about a
  // student's session, not a fact about how many times React rendered.
  useEffect(() => {
    if (!refusal) return;
    recordFlag({
      kind: refusal.flag === 'support' ? 'distress' : 'redirect',
      at: new Date().toISOString(),
    });
  }, [refusal]);

  /**
   * WHAT THE ROOM IS BUILT ON, THE MOMENT THERE IS ONE.
   *
   * Not the finished prep — the DRAFT, handed over about fourteen seconds in,
   * as soon as the teaching holds and before a single picture has been drawn.
   * The student is in the class while the artwork arrives behind them, which
   * is the whole of warm entry: the wait becomes the lesson.
   *
   * The finished prep still lands later, and is used for one thing only —
   * deciding what gets KEPT. Rendering it would swap the lesson under a class
   * that has already started and restart it from the top.
   */
  const [draft, setDraft] = useState<{ lesson: Lesson; assets: Record<string, string> } | null>(
    null,
  );
  /**
   * Bumped when a picture lands.
   *
   * The assets object is filled IN PLACE by the prep — the room is holding
   * that same object — so React has nothing to compare and would never draw
   * again. This is the "something changed" signal, and it is a number rather
   * than a copy because copying the record on every picture would rebuild the
   * whole board mid-sentence.
   */
  const [artLanded, setArtLanded] = useState(0);
  const [progress, setProgress] = useState<PrepProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by Try again. Preparing a class is the single likeliest thing in
  // this app to fail — it is several model calls over whatever connection a
  // student has — and "Back home" as the only way out of that made a bad
  // minute into a lost lesson.
  const [attempt, setAttempt] = useState(0);
  const online = useOnline();

  const tts = useLessonVoice(null, draft?.lesson ?? null, { enabled: preferences.voice });

  /**
   * The board's copy of the artwork.
   *
   * The prep fills its assets record IN PLACE, so React sees the same object
   * every render and would never draw again. `artLanded` counts the pictures
   * that have arrived, and this rebuilds on exactly those — not on every
   * keystroke of an unrelated render, which would rebuild the whole board
   * mid-sentence.
   */
  const artwork = useMemo(
    () => ({ ...(draft?.assets ?? {}) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, artLanded],
  );

  useEffect(() => {
    if (refused !== null) return;
    if (!ask) {
      setError('There is no such topic.');
      return;
    }
    setError(null);
    const startedAt = performance.now();
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
      const made = await prepareLiveClass(
        { ...ask, studentLines },
        (p) => {
          if (!cancelled) setProgress(p);
        },
        {
          onDraft: (d) => {
            if (cancelled) return;
            // The number warm entry exists to move: how long a student waits
            // before the room opens, measured on their own phone rather than
            // on mine.
            track('class_room_opened', {
              waitedMs: Math.round(performance.now() - startedAt),
              beats: d.lesson.beats.length,
            });
            setDraft(d);
          },
          onArt: () => {
            if (!cancelled) setArtLanded((n) => n + 1);
          },
        },
      );
      if (cancelled) return;
      // The one thing in the notes that can leak into a kept class. Read from
      // the profile rather than parsed back out of the lines, because a name
      // is a fact the app holds and the lines are prose. namesInSpine splits
      // it into parts, because "Aarav Sharma" is what a profile holds and
      // "Aarav" is what a tutor says.
      const named = profileStore.get().name;
      void keep(made, ask, named ? [named] : []);
    })().catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });

    return () => {
      cancelled = true;
    };
  }, [ask, refused, navigate, attempt]);

  if (refused !== null) {
    return (
      <div className="bg-background min-h-screen grid place-items-center px-margin-mobile font-body-md">
        <div className="text-center flex flex-col items-center gap-4 max-w-[46ch]">
          {/* Her face, not an error icon: this is the tutor answering, and
              dressing it as a fault would tell a student they broke something. */}
          <div className="w-16 h-16 rounded-full bg-primary-container grid place-items-center">
            <Icon name="school" className="text-3xl text-on-primary-container" />
          </div>
          <p className="font-body-md text-body-md text-on-surface leading-7">{refused}</p>
          <button
            onClick={() => navigate('/')}
            className="bg-primary text-on-primary font-label-md text-label-md px-6 py-3 rounded-xl shadow-md border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all"
          >
            Pick a subject
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    // "There is no such topic" is the one failure another go cannot fix.
    const canRetry = ask !== null;

    return (
      <div className="bg-background min-h-screen grid place-items-center px-margin-mobile font-body-md">
        <div className="text-center flex flex-col items-center gap-4">
          <Icon name={online ? 'error' : 'wifi_off'} className="text-4xl text-on-surface-variant" />
          <p className="font-headline-md text-[18px] leading-6 text-on-surface">
            {online ? error : 'You are offline'}
          </p>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-[42ch]">
            {online
              ? 'Preparing a class takes a few steps and one of them did not finish.'
              : 'This class has to be made for you, and that needs a connection. Classes you have already opened still play.'}
          </p>
          <div className="flex items-center gap-3">
            {canRetry && (
              <button
                onClick={() => setAttempt((n) => n + 1)}
                className="bg-stage-primary text-on-stage-primary rounded-full px-6 py-3 font-label-md text-label-md font-semibold border-b-4 border-stage-primary-edge active:border-b-0 active:translate-y-1 transition-all"
              >
                Try again
              </button>
            )}
            <button
              onClick={() => navigate('/')}
              className="text-on-surface-variant font-label-md text-label-md px-5 py-3 rounded-full hover:bg-surface-container-high transition-colors"
            >
              Back home
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!draft || !tts) {
    return <GettingReady topic={ask?.topic ?? ''} progress={progress} />;
  }

  return (
    <ClassRoom
      lesson={draft.lesson}
      tts={tts}
      diagrams={artwork}
      // The student has already watched her set up. One wait, not two.
      warm
      onExit={() => navigate('/')}
    />
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
          She is setting up the board.
        </p>
      </div>
    </div>
  );
}
