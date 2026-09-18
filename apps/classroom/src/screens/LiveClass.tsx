import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { saveable, type PrepProgress } from '@ai-tutor/class-prep';
import type { Lesson } from '@ai-tutor/lesson-format';
import {
  mintPrepId,
  prepareLiveClass,
  releasePrepLock,
  renewPrepLock,
  takePrepLock,
  waitForHolder,
  type LivePrep,
} from '../lib/liveClass';
import { fetchCatalog, findTopic, forgetCatalog, type CatalogEntry } from '../lib/content';
import { useLessonVoice } from '../lib/lessonVoice';
import { settingsStore } from '../stores/settings';
import { preferencesStore } from '../stores/preferences';
import { useStore } from '../stores/localStore';
import { profileStore } from '../stores/profile';
import { progressStore } from '../stores/progress';
import { outcomeStore } from '../stores/outcomes';
import { createOutcomeLookup } from '../lib/outcomeLookup';
import { masteryFromModel, settled } from '../lib/learnerModel';
import { studentLinesForPlanner } from '../lib/student';
import { outcomesForTopic } from '../lib/topicOutcomes';
import { lastClassBefore } from '../lib/lastClass';
import { useOnline } from '../lib/online';
import { relayFetch } from '../lib/relay';
import { quoteForPrompt, screen } from '@ai-tutor/safety';
import { takeSource } from '../lib/sourceHandoff';
import { SOURCE_LIMIT, plannerTopicFromSource } from '../lib/sourceText';
import { recordFlag } from '../stores/flags';
import { track } from '../lib/telemetry';
import { readRefusal } from '../lib/refusal';
import { RefusalNotice } from '../ui/RefusalNotice';
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
 * `/class?source=<key>` is the same room again, for a page the student brought
 * in themselves — a chapter, a worksheet, their own notes. The file was opened
 * on their phone before they ever got here (lib/readSource) and the extract is
 * held in this tab (lib/sourceHandoff); the key in the URL carries nothing.
 * Like the typed topic it has no topicRef, so it is taught and not kept —
 * which is also the only honest answer for somebody else's textbook.
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
  /** Something was taken out of what the student typed. Recorded, not shown. */
  cleaned?: boolean;
  /**
   * What to PRINT while she prepares, when that is not the same as what the
   * planner is told.
   *
   * For a topic the two are one string and always were. For a page the student
   * brought in, `topic` is a twelve-thousand-character instruction with their
   * chapter quoted inside it — and the waiting room renders the topic, so
   * without this the student watches their own textbook scroll down a black
   * stage under the words "Meera is preparing your class on".
   */
  shown?: string;
}

/**
 * A LONGEST FILE NAME, AS A PROMPT.
 *
 * The name is student text like any other — "ignore all previous
 * instructions.pdf" is a file somebody will make — so it is screened, and
 * capped at something a heading can hold.
 */
const MAX_TITLE = 80;

/** A student's words, screened, in the two shapes this screen needs them in. */
type Carried = { carry: string; cleaned: boolean };

/**
 * Screen a piece of a student's words and quote it for a prompt.
 *
 * `screen` rather than `fromStudent`: the callers run inside a useMemo, and
 * useMemo runs twice under StrictMode. fromStudent WRITES — it records a flag
 * — so it would log every refusal twice, and a doubled entry can push a real
 * distress flag out of a log that keeps fifty. The pure decision belongs here;
 * the recording happens once, in the effect below.
 */
function screened(text: string, limit?: number): Carried | Refused {
  const verdict = screen(text, 'from-student', limit === undefined ? {} : { limit });
  switch (verdict.kind) {
    case 'redirect':
      return { refused: verdict.say, flag: 'redirect' };
    case 'support':
      return { refused: verdict.say, flag: 'support' };
    case 'clean':
      // A masked phone number or address still happened, and the safety log is
      // the only record that it did. Carried out of the pure decision so the
      // effect below can record it exactly once.
      return { carry: quoteForPrompt(verdict.text, limit), cleaned: true };
    case 'allow':
      return { carry: quoteForPrompt(verdict.text, limit), cleaned: false };
  }
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
  const query = new URLSearchParams(search);
  const freeText = query.get('topic') ?? undefined;
  const sourceKey = query.get('source') ?? undefined;

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
      const asked = screened(freeText);
      if ('refused' in asked) return asked;
      return {
        topic: asked.carry,
        klass: settings.klass ?? 9,
        minutes: 2,
        subject: 'Science',
        ...(asked.cleaned ? { cleaned: true } : {}),
      };
    }
    /**
     * A PAGE THE STUDENT BROUGHT IN.
     *
     * Already read, on their phone, before they got here — this end of it only
     * decides whether it may be taught. It is screened EXACTLY as the typed
     * topic is, and for the same reason: a child's uploaded file is a child's
     * words, and the fact that they arrived as a PDF rather than through a
     * keyboard changes nothing about what may be in them or where they are
     * about to go. Two pieces, because a file has two — the words on the page
     * and the name on the file, and "ignore all previous instructions.pdf" is
     * a file somebody will make.
     */
    if (sourceKey) {
      const page = takeSource(sourceKey);
      // Not an error and not a refusal: this tab never held that file. A
      // bookmarked /class?source=… a week later lands here, and so does a
      // second tab. The effect below says so plainly.
      if (!page) return null;

      const body = screened(page.text, SOURCE_LIMIT);
      if ('refused' in body) return body;
      const name = screened(page.title, MAX_TITLE);
      if ('refused' in name) return name;

      return {
        topic: plannerTopicFromSource({
          title: name.carry,
          text: body.carry,
          truncated: page.truncated,
        }),
        // The file's own name, not the instruction built from it.
        shown: page.title,
        klass: settings.klass ?? 9,
        // The same two minutes an off-syllabus class gets. A chapter could
        // fill more, and more minutes is more narration, which is the single
        // most expensive thing in a class — ₹5.11 of the ₹9.90 a cached one
        // costs. A page the student brought is not the place to quietly double
        // that, and nothing yet says a longer class teaches it better.
        minutes: 2,
        subject: 'Science',
        ...(body.cleaned || name.cleaned ? { cleaned: true } : {}),
      };
    }
    return null;
  }, [topicRef, freeText, sourceKey, settings.klass]);

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

  /**
   * Once, and only when it actually happened.
   *
   * A flag is a fact about a student's session, not a fact about how many
   * times React rendered — and there are two ways it can become the second.
   * The memo above recomputes whenever settings.klass is written, handing back
   * a NEW object for the same refusal, so an effect keyed on that object fired
   * again; and StrictMode double-invokes effects in development regardless.
   * So the key is the WORDS, which are stable, and a ref remembers what has
   * already been written.
   */
  const flagged = useRef<string | null>(null);
  useEffect(() => {
    const what = refusal
      ? `${refusal.flag}:${refusal.refused}`
      : freeText || sourceKey
        ? 'clean'
        : null;
    if (what === null || flagged.current === what) return;
    flagged.current = what;
    if (refusal) {
      recordFlag({
        kind: refusal.flag === 'support' ? 'distress' : 'redirect',
        at: new Date().toISOString(),
      });
    } else if (asked !== null && !isRefused(asked) && asked.cleaned) {
      recordFlag({ kind: 'cleaned', at: new Date().toISOString() });
    }
  }, [refusal, asked, freeText, sourceKey]);

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

  /**
   * SOMEBODY ELSE IS MAKING THIS CLASS, and the student is told so.
   *
   * Seconds waited, or null when nobody is waiting. A cold topic costs about
   * Rs 30 to prepare and the lock is what makes that a one-off rather than a
   * per-student charge — but a lock with no visible state is a student staring
   * at a stalled screen, so the wait is shown for what it is.
   */
  const [waiting, setWaiting] = useState<number | null>(null);
  /**
   * The project is at its concurrency ceiling — `running` preparations are
   * already in flight and this one is turned away. Not an error and not a
   * refusal: there is nothing wrong with the topic and nothing wrong with the
   * student, so the screen says that plainly and offers a class that is
   * already made.
   */
  /**
   * TURNED AWAY, AND WHICH OF THE TWO REASONS IT WAS.
   *
   * 'busy' is the project's concurrency ceiling. 'held' is a second student
   * demonstrably alive and holding this topic's lock after this student has
   * already waited out a full TTL. They are different sentences, and telling a
   * child the wrong one is the small kind of lie this repo does not ship.
   */
  const [busy, setBusy] = useState<{ why: 'busy'; running: number } | { why: 'held' } | null>(
    null,
  );
  const [instead, setInstead] = useState<CatalogEntry[]>([]);

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
      // Two ways to arrive with nothing to teach, and they are not the same
      // sentence. A topicRef that matches no topic is a broken link; a source
      // key this tab is not holding is a file that was opened in a different
      // tab, or last week. Telling a student "there is no such topic" about
      // their own chapter is how they conclude the file was rejected.
      setError(
        sourceKey
          ? 'That page is not here any more. Pick the file again and she will read it.'
          : 'There is no such topic.',
      );
      return;
    }
    setError(null);
    setWaiting(null);
    setBusy(null);
    const startedAt = performance.now();
    let cancelled = false;

    /**
     * THE LOCK THIS ATTEMPT HOLDS, and the heartbeat keeping it alive.
     *
     * Both live out here rather than inside the async body because the effect's
     * CLEANUP has to reach them: a student who backs out mid-preparation would
     * otherwise leave a lock standing for the full 180-second TTL, and every
     * other student on that topic waits it out for nothing.
     */
    let lock: { topicRef: string; prepId: string } | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    const letGo = (unloading = false) => {
      if (heartbeat !== null) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      const held = lock;
      // Nulled BEFORE the await, so a cleanup landing on top of the finally
      // does not send a second release for the same lock.
      lock = null;
      if (held) void releasePrepLock(held.topicRef, held.prepId, { unloading });
    };

    /**
     * THE COMMONEST WAY A PREPARATION ENDS IS NOT A THROW.
     *
     * React's cleanup covers a student navigating within the app. It does not
     * run when the tab is closed, the app is swiped away, or a cheap Android
     * kills a backgrounded page — and a ~96-180s preparation is exactly the
     * window in which that happens. The lock then stands for its full
     * 180-second TTL and the next student waits it out for a browser that no
     * longer exists.
     *
     * `pagehide` AND NOT `visibilitychange`, which is the one place this
     * differs from stores/classLedger.ts:376. A ledger flush on hidden is free
     * and idempotent; releasing a lock on hidden is not. Students background an
     * app constantly and come straight back, the preparation keeps running, and
     * a release there would hand the lock to somebody else while this browser
     * is still paying for the same class — which is the duplicate spend the
     * lock exists to stop. `pagehide` is the signal that the page is actually
     * going, and it needs `keepalive`, so this is best-effort by nature.
     */
    const onGoingAway = () => letGo(true);
    window.addEventListener('pagehide', onGoingAway);

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
       * COLD, AND ABOUT TO COST Rs 30. TAKE THE LOCK FIRST.
       *
       * Only a topicRef can be locked, because only a topicRef is a key two
       * students can arrive at independently. A typed topic and a page the
       * student brought in are taught and never kept, so there is no second
       * student for a lock to protect and none is taken.
       */
      if (ask.topicRef) {
        const topicRef = ask.topicRef;
        const prepId = mintPrepId();
        let gate = await takePrepLock(topicRef, prepId);
        /**
         * RECORDED BEFORE THE CANCELLATION CHECK, and that ordering is the
         * whole point. Returning on `cancelled` with the lock un-recorded left
         * `lock === null`, so neither the `.finally` nor the cleanup sent a
         * release — and a lock granted in the ~200ms while a child was backing
         * out stood for the full 180-second TTL, which is exactly the cost the
         * docblock above says this effect exists to prevent.
         */
        if (gate.kind === 'granted') lock = { topicRef, prepId };
        if (cancelled) return;

        if (gate.kind === 'held') {
          // Somebody won the race. Wait for THEIR class rather than paying for
          // a second copy of it — with a bound, and with the wait on screen.
          setWaiting(0);
          const out = await waitForHolder(topicRef, {
            isCancelled: () => cancelled,
            onWait: (seconds) => setWaiting(seconds),
          });
          if (cancelled || out === 'cancelled') return;
          setWaiting(null);
          if (out === 'ready') {
            // The catalogue in memory was read before their class existed.
            forgetCatalog();
            const kept = (await fetchCatalog()).find((e) => e.topicRef === topicRef);
            if (cancelled) return;
            if (kept) {
              navigate(`/lesson/${kept.id}`, { replace: true });
              return;
            }
            // It said ready and the catalogue does not have it — a retracted
            // class, or a catalogue this device cannot read. Prepare it.
          } else {
            /**
             * 'gone'. The catalogue in memory was read up to 195 seconds ago,
             * before the holder had kept anything. In production the ordering
             * closes this — the holder awaits `keep()` before releasing — but
             * the dev/memory prep store never answers 'ready' at all, so on a
             * demo laptop the waiter ALWAYS exits here the moment the holder
             * releases, and would pay again for a class that was just saved.
             */
            forgetCatalog();
            const kept = (await fetchCatalog().catch(() => [])).find(
              (e) => e.topicRef === topicRef,
            );
            if (cancelled) return;
            if (kept) {
              navigate(`/lesson/${kept.id}`, { replace: true });
              return;
            }
          }
          gate = await takePrepLock(topicRef, prepId);
          if (gate.kind === 'granted') lock = { topicRef, prepId };
          if (cancelled) return;

          /**
           * STILL HELD, by somebody who is demonstrably alive: they renewed
           * through a whole TTL. Preparing anyway would spend the second Rs 30
           * this entire job exists to prevent, against a holder who is going
           * to finish. So the student is turned away with something to do
           * instead, which is the same honest offer the 'busy' ceiling makes.
           */
          if (gate.kind === 'held') {
            const catalogue = await fetchCatalog().catch(() => []);
            if (cancelled) return;
            const mine = catalogue.filter(
              (e) => e.class === ask.klass && e.subject === ask.subject,
            );
            setInstead((mine.length > 0 ? mine : catalogue).slice(0, 3));
            setBusy({ why: 'held' });
            return;
          }
        }

        if (gate.kind === 'busy') {
          const catalogue = await fetchCatalog().catch(() => []);
          if (cancelled) return;
          // Their own class first, then anything. A student turned away is
          // owed something to do, not a list sorted by somebody else's needs.
          const mine = catalogue.filter(
            (e) => e.class === ask.klass && e.subject === ask.subject,
          );
          setInstead((mine.length > 0 ? mine : catalogue).slice(0, 3));
          setBusy({ why: 'busy', running: gate.running });
          return;
        }

        if (gate.kind === 'granted') {
          lock = { topicRef, prepId };
          /**
           * HEARTBEAT, because the TTL is twice a preparation measured on a
           * development machine and the stated device is a cheap Android. A
           * holder that stops renewing is swept, a second student wins the
           * lock, and both preparations are paid for in full.
           *
           * WHAT THIS CANNOT DO, said out loud: `prepareClass` has no
           * cancellation, so a lost lock cannot abort the preparation already
           * in flight. The heartbeat narrows the twin-spend window; it does
           * not close it.
           */
          heartbeat = setInterval(() => {
            void renewPrepLock(topicRef, prepId).then((renewed) => {
              if (!renewed && heartbeat !== null) {
                clearInterval(heartbeat);
                heartbeat = null;
                lock = null; // Gone. Releasing it would release the winner's.
              }
            });
          }, 60_000);
        }
        /**
         * 'unavailable': prepare WITHOUT a lock. A relay that cannot answer
         * must not be able to stop a class — the relay protects money and this
         * screen protects a lesson, so this half fails OPEN. See PrepGate's
         * note. ('held' and 'busy' both returned above; they are answers, not
         * outages.)
         */
      }

      /**
       * The map reaches the class. Everything the app really knows about this
       * student — name, streak, what they answered wrong, where the placement
       * found shaky ground — goes to the planner as private notes, so the
       * same topic opens differently for different students. Nothing known,
       * nothing said: the anonymous class is the honest default.
       */
      // The MODEL's belief, not the placement blob: the doubt tutor marks a
      // prerequisite "secure" from what every class and quiz since has shown,
      // not from what one test found the day the student installed the app.
      const lookup = createOutcomeLookup(masteryFromModel());
      /**
       * What they did last time, so she can open where they left off.
       *
       * Awaited before the plan because it is one line in the same prompt —
       * and it never blocks the class: a catalogue that will not answer means
       * a tutor who starts fresh, which is how she started every class before
       * today.
       */
      const lastClass = await lastClassBefore().catch(() => null);
      if (cancelled) return;

      // The fold that turns this class's own answers into belief takes seconds,
      // not a tick — see recordLocally. Without this the planner is handed a
      // model that has not seen the session it is planning around.
      await settled();
      const studentLines = studentLinesForPlanner({
        mastery: masteryFromModel(),
        profile: profileStore.get(),
        progress: progressStore.get(),
        outcomes: outcomeStore.get(),
        statement: (id) => lookup.statement(id),
        lastClass,
      });
      /**
       * The outcomes the map holds for this topic, so the class can be
       * MEASURED and not merely taught. A free-text class has no topicRef and
       * therefore no outcomes, which is the honest answer for something the
       * curriculum has no entry for.
       */
      const outcomes = outcomesForTopic(ask.topicRef);

      const made = await prepareLiveClass(
        { ...ask, studentLines, outcomes },
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
      // AWAITED, not fired and forgotten: the lock is released when this
      // resolves, and releasing before the class is written would let the next
      // student take the lock on a topic that still has nothing saved under it
      // — which is the duplicate preparation this whole path exists to stop.
      try {
        await keep(made, ask, named ? [named] : []);
      } catch {
        /**
         * The class is ALREADY PLAYING — `onDraft` put it on screen during
         * preparation. A failed save must not reach the catch below, because
         * that sets `error`, and the error branch renders ahead of the class:
         * a save nobody asked about would take away the lesson a child is
         * watching. The save is lost; the class is not.
         */
      }
    })()
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      // ON SUCCESS AND ON FAILURE BOTH. A lock held by a browser that threw
      // costs every other student on this topic the full 180-second TTL.
      .finally(() => letGo());

    return () => {
      cancelled = true;
      window.removeEventListener('pagehide', onGoingAway);
      letGo();
    };
  }, [ask, refused, navigate, attempt, sourceKey]);

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

  /**
   * TURNED AWAY, AND TOLD WHY IN WORDS A CHILD CAN ACT ON.
   *
   * `busy` is the project's concurrency ceiling, not a fault and not a
   * refusal. So there is no error icon and no "Try again" as the main move:
   * the honest offer is a class that is already made, and the retry sits
   * quietly beside it.
   */
  if (busy !== null) {
    return (
      <div className="bg-background min-h-screen grid place-items-center px-margin-mobile font-body-md">
        <div className="text-center flex flex-col items-center gap-4 max-w-[46ch]">
          <div className="w-16 h-16 rounded-full bg-primary-container grid place-items-center">
            <Icon name="hourglass_top" className="text-3xl text-on-primary-container" />
          </div>
          <p className="font-headline-md text-[18px] leading-6 text-on-surface">
            {busy.why === 'held'
              ? 'This class is still being made for somebody else'
              : 'Meera is making classes for other students right now'}
          </p>
          {/* Two reasons, two sentences. 'held' is one named student still
              working on THIS class; 'busy' is the ceiling on how many she can
              make at once. Telling a child the wrong one is a small lie and
              this sheet is where the big one already was. */}
          <p className="font-body-md text-body-md text-on-surface-variant">
            {busy.why === 'held'
              ? 'She has been at it a while and it is not finished yet. Try this one again in a few minutes — or start one of these, which are ready now.'
              : 'This one has not been made yet, and she can only make a few at a time. Try again in a few minutes — or start one of these, which are ready now.'}
          </p>
          {instead.length > 0 && (
            <div className="w-full grid gap-2">
              {instead.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => navigate(`/lesson/${entry.id}`)}
                  className="text-left px-4 py-3 rounded-xl border-2 border-surface-variant text-on-surface hover:bg-surface-container-high transition-colors font-body-md text-body-md"
                >
                  {entry.title}
                  {entry.subtitle && (
                    <span className="block font-label-md text-label-md text-on-surface-variant">
                      {entry.subtitle}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setAttempt((n) => n + 1)}
              className="bg-primary text-on-primary font-label-md text-label-md px-6 py-3 rounded-xl border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all"
            >
              Try this class again
            </button>
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

  if (error) {
    // "There is no such topic" is the one failure another go cannot fix.
    const canRetry = ask !== null;

    /**
     * A REFUSAL IS NOT A FAILURE, AND THIS SCREEN USED TO CALL IT ONE.
     *
     * The relay's own sentence has always arrived here — browserLlm hands it to
     * relayError, which keeps the message for a 429 or a 503, and `setError`
     * puts it on screen. It was the FRAME around it that lied: an error icon,
     * "one of them did not finish", and a Try again button. For `budget` and
     * `capped` nothing failed — a limit was reached — and the retry is a promise
     * we cannot keep, so a child taps it, gets the same sentence, and learns the
     * app is not telling them the truth. For `halted` it is premature by
     * minutes.
     *
     * RefusalNotice says which it is and offers a retry only where waiting
     * actually changes the answer. Anything that is NOT one of the relay's five
     * refusals falls through to the ordinary failure screen below, which is
     * right: a network drop or a missing topic really did fail.
     */
    const refusal = online ? readRefusal(error) : null;
    if (refusal) {
      return (
        <div className="bg-background min-h-screen grid place-items-center px-margin-mobile font-body-md">
          <RefusalNotice
            refusal={refusal}
            onRetry={canRetry ? () => setAttempt((n) => n + 1) : undefined}
          >
            <button
              onClick={() => navigate('/')}
              className="text-on-surface-variant font-label-md text-label-md px-5 py-3 rounded-full hover:bg-surface-container-high transition-colors"
            >
              Back home
            </button>
          </RefusalNotice>
        </div>
      );
    }

    return (
      <div className="bg-background min-h-screen grid place-items-center px-margin-mobile font-body-md">
        <div className="text-center flex flex-col items-center gap-4">
          <Icon name={online ? 'error' : 'wifi_off'} className="text-4xl text-on-surface-variant" />
          <p className="font-headline-md text-[18px] leading-6 text-on-surface">
            {online ? error : 'You are offline'}
          </p>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-[42ch]">
            {!online
              ? 'This class has to be made for you, and that needs a connection. Classes you have already opened still play.'
              : canRetry
                ? 'Preparing a class takes a few steps and one of them did not finish.'
                : // No Try again is offered here, so the line must not describe
                  // one. A dead topicRef and a source key this tab never held
                  // both end the same way: go back and start it again.
                  'Start again from the home screen and she will pick it up.'}
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

  /**
   * WAITING FOR SOMEBODY ELSE'S PREPARATION — the same dark stage, a different
   * sentence.
   *
   * It is deliberately the stage and not a spinner on a page: the student is
   * still going to a class, and this is still the wait before it. What must
   * not happen is the wait pretending to be their own preparation, because
   * this one can end with "nobody finished it, making it now" and the progress
   * bar would be a lie in the meantime.
   */
  if (waiting !== null && !draft) {
    return <SomebodyIsPreparing topic={ask?.shown ?? ask?.topic ?? ''} seconds={waiting} />;
  }

  if (!draft || !tts) {
    // `shown` and not `topic`: the planner's instruction for a brought page is
    // the whole page, and this line is printed.
    return <GettingReady topic={ask?.shown ?? ask?.topic ?? ''} progress={progress} />;
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
 * SOMEBODY ELSE GOT HERE FIRST, and this is what that looks like.
 *
 * The truthful version of a shared cost. One student is paying about Rs 30 to
 * have this class made, and everybody else arriving in the same three minutes
 * gets it for nothing — but only if they wait instead of each starting their
 * own. So the wait is named rather than disguised as a loading spinner, and
 * the seconds are shown because a wait with no number on it feels broken.
 */
function SomebodyIsPreparing({ topic, seconds }: { topic: string; seconds: number }) {
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
          Someone is already making this class
        </p>
        {/* WHAT THE WAIT CAN ACTUALLY PROMISE. `waitForHolder` has three
            exits and only one of them is the holder finishing — on 'gone' the
            student prepares their own after all. So the second sentence says
            what happens then, rather than promising an outcome the bound
            cannot keep. */}
        <p className="font-body-md text-body-md text-white/70">
          Meera is preparing {topic} for another student right now. Yours will be the same class.
          If it does not finish, she will start yours instead.
        </p>
        <p className="font-label-md text-label-md text-white/50" aria-live="polite">
          Waiting {seconds}s
        </p>
      </div>
    </div>
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
