import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SubjectSyllabus } from '@ai-tutor/syllabus';
import { SYLLABI, fetchCatalog, type CatalogEntry } from '../lib/content';
import { relayFetch } from '../lib/relay';
import { useAsync, dataOr } from '../lib/async';
import { InlineError } from '../ui/States';
import { progressStore, isCompleted } from '../stores/progress';
import { profileStore } from '../stores/profile';
import { klassOf, settingsStore } from '../stores/settings';
import { useStore } from '../stores/localStore';
import { Screen, EmptyState } from '../ui/Screen';
import { Icon } from '../ui/Icon';

/**
 * THE SYLLABUS — the whole course, as the student's own book.
 *
 * Everything on this screen is scoped to the student's class. The app pulled
 * 1,091 topics across thirteen syllabi and had no screen that showed any of
 * them; the one place that listed subjects listed every class's at once, so a
 * Class 9 student was offered Class 11 Biology.
 *
 * A chapter with no lessons yet is still listed, greyed. The syllabus is the
 * promise; content fills it in over time, and hiding the empty parts would
 * hide how much of the course exists.
 */

/**
 * WHICH TOPICS ALREADY HAVE A CLASS — AND THE ONE STATE THAT IS NOT A STATE.
 *
 * A cold topic is prepared live: about ninety-six seconds on a development
 * machine and about Rs 30 of somebody's money. A prepared one opens at once.
 * A topic somebody ELSE is preparing this minute is the worst tap of the
 * three, because a second preparation of the same topic is paid for twice and
 * the prep lock exists to stop exactly that. Until now the catalogue showed
 * all three identically.
 *
 * `prepStateOf` in lib/liveClass.ts answers this for ONE topicRef, and this is
 * deliberately not that function: the relay route takes `topicRefs` plural and
 * caps a request at fifty for the reason its own header gives, and one request
 * per tile on a cheap Android is the shape that makes a catalogue unusable.
 * The two readers should be one, in a lib of their own — see the handoff.
 *
 * NULL IS AN OUTAGE AND IS NOT "ABSENT". liveClass.ts's docblock is explicit
 * about it, and reading null as absent is how a student is sent to pay for a
 * preparation that already exists. Here an outage simply produces no entry,
 * which is the same thing an absent topic produces: NO BADGE. The absence of
 * a mark claims nothing, so it cannot be wrong.
 *
 * WHY THIS LIVES IN A SCREEN FILE. It belongs in lib/ and ui/ next to the
 * reader it mirrors; this phase does not own a file there, and duplicating it
 * into both screens would give the app two badges that drift apart. Chapter
 * imports from here, which is the lesser of the two wrongs and a recorded
 * handoff, not a preference.
 */
export type PrepBadge = 'ready' | 'preparing';

/**
 * Mirror of `MAX_PREP_STATE_REFS` in packages/relay/src/prep.ts. A fifty-first
 * ref does not get dropped — it fails the whole request with a 400, so every
 * badge in that chunk is lost. Chunking is not an optimisation here.
 *
 * Pinned to the relay's own constant by preparedBadge.test.tsx, which reads
 * prep.ts at test time: a copy of somebody else's ceiling that nothing checks
 * drifts, and this one drifts silently — the badges just stop appearing.
 */
const MAX_REFS_PER_CALL = 50;

/**
 * HOW LONG AN ANSWER IS TRUSTED BEFORE IT IS ASKED FOR AGAIN.
 *
 * The answers used to live only in component state, so every mount and every
 * accordion toggle re-issued the whole batch. No rupees — /api/prep/state
 * claims zero units (gate.ts:338) and pays no vendor — but `relay_usage` is
 * keyed on the student alone (0016_relay_control.sql:112) and the DEPLOYED
 * claim_relay tests the rate before it looks at units
 * (0016_relay_control.sql:129) and increments `window_count` even on a
 * zero-unit claim (:169). Cited against the SQL and not against gate.ts:430,
 * which is `createMemoryLedger` — the dev and test twin, whose own docblock
 * at gate.ts:400 says it is NOT usable in production. Same behaviour, wrong
 * evidence: a reader following the old pointer landed on code that does not
 * run for a student. So
 * badge traffic spends the same 120-a-minute window a class start spends, and
 * `admitFree` exempts only 'report', only from halted/capped/budget, never
 * from rate (gate.ts:339-341). A child walking chapters must not be able to
 * rate-limit their own next class, or their own safety report.
 *
 * It is bounded by the syllabus, not by the session: packages/syllabus/data
 * holds 1,099 topicRefs across its thirteen files, so the map cannot grow past
 * that however long a child browses. A minute is chosen because every way this can go stale fails
 * towards NO BADGE or towards waiting, never towards a promise: a preparation that has
 * since finished reads "being prepared" for up to a minute, which costs a
 * wait; one that has since started reads as nothing, which is the screen as
 * it was. An outage is never cached — no answer is not an answer.
 */
const ANSWER_TTL_MS = 60_000;

const answered = new Map<string, { state: PrepBadge | 'absent'; at: number }>();

/** Drop every remembered answer. Used by tests to keep one from deciding the next. */
export function forgetPrepStates(): void {
  answered.clear();
}

const rememberedState = (ref: string, now: number): PrepBadge | 'absent' | undefined => {
  const seen = answered.get(ref);
  if (seen === undefined) return undefined;
  if (now - seen.at >= ANSWER_TTL_MS) {
    answered.delete(ref);
    return undefined;
  }
  return seen.state;
};

/**
 * Mirror of `isTopicRef` in packages/relay/src/prep.ts, and load-bearing for
 * the same reason the character class is load-bearing there: one malformed ref
 * 400s the batch it travels in, so a stray ref would silently cost up to fifty
 * tiles their badge. Filtering here keeps one bad ref from taking the rest.
 */
const TOPIC_SEGMENT = /^[A-Za-z0-9._~-]+$/;
const isTopicRef = (ref: string): boolean => {
  if (ref.length > 200) return false;
  const parts = ref.split('/');
  return parts.length === 3 && parts.every((part) => TOPIC_SEGMENT.test(part));
};

/** One batched read. `null` means the relay could not say — never "absent". */
async function prepStatesOf(
  topicRefs: string[],
  signal: AbortSignal,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await relayFetch(
      `/api/prep/state?topicRefs=${encodeURIComponent(topicRefs.join(','))}`,
      { signal },
    );
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { states?: unknown } | null;
    const states = body?.states;
    return states !== null && typeof states === 'object' ? (states as Record<string, unknown>) : null;
  } catch {
    // A dropped connection, or our own abort. Either way the relay has not
    // said anything, and the catalogue is fully readable without this.
    return null;
  }
}

/**
 * The badges for a list of topics, batched, and never in the way.
 *
 * Nothing here blocks a render: the map starts empty, the screen paints the
 * catalogue immediately, and badges arrive into a slot the tile already
 * reserved. A ref with no entry — absent, an outage, a chunk still in flight,
 * or a request that was never made — is a tile with no mark, which is what the
 * screen looked like before any of this existed.
 *
 * Keyed on the joined refs so that a caller passing a fresh array each render
 * does not start a fresh request each render, and so that a map belonging to a
 * different list can never paint: it is returned only when its key matches.
 *
 * Answers already given are read out of the module cache before anything goes
 * out, so a screen revisited inside a minute shows its badges with no request
 * at all — including the common case where every answer was "absent", which
 * makes the whole lookup free the second time.
 */
const NO_BADGES: Record<string, PrepBadge> = {};

export function usePrepBadges(topicRefs: string[]): Record<string, PrepBadge> {
  const key = topicRefs.join(',');
  const [found, setFound] = useState<{ key: string; map: Record<string, PrepBadge> }>({
    key: '',
    map: NO_BADGES,
  });

  useEffect(() => {
    const refs = key.split(',').filter((ref) => ref !== '' && isTopicRef(ref));
    // Nothing cold to ask about: a request would buy no badge and still cost
    // a round trip on a phone that is paying for it in seconds.
    if (refs.length === 0) return;

    // What we were already told, this minute. Painted before anything goes
    // out, so coming back to a screen shows its badges with no network at all.
    const now = Date.now();
    const already: Record<string, PrepBadge> = {};
    const ask: string[] = [];
    for (const ref of refs) {
      const seen = rememberedState(ref, now);
      if (seen === undefined) ask.push(ref);
      else if (seen !== 'absent') already[ref] = seen;
    }
    setFound({ key, map: Object.keys(already).length > 0 ? already : NO_BADGES });
    if (ask.length === 0) return;

    /**
     * Aborted on cleanup, which stops the REMAINING chunks outright and drops
     * the answer to the one in flight. It is not a refund: a request already
     * on the wire has already been counted by the relay. The cache above is
     * what keeps the count down; this only stops a screen the student has
     * left from going on asking.
     *
     * Under StrictMode the first run is aborted and the second refires, so a
     * DEVELOPMENT mount costs two batches where production costs one — the
     * abort is why it is two and not two-plus-the-rest.
     */
    const abort = new AbortController();
    let cancelled = false;
    void (async () => {
      // Sequential, not Promise.all: the big syllabus is five chunks, and five
      // sockets opened at once on a slow connection delays the page the
      // student is actually reading. Each chunk paints as it lands.
      for (let from = 0; from < ask.length; from += MAX_REFS_PER_CALL) {
        const back = await prepStatesOf(ask.slice(from, from + MAX_REFS_PER_CALL), abort.signal);
        if (cancelled) return;
        // An outage. Nothing is remembered from it, because "we could not say"
        // is not an answer and must not be replayed for a minute as if it were.
        if (back === null) continue;
        const at = Date.now();
        const marks: Record<string, PrepBadge> = {};
        for (const [ref, state] of Object.entries(back)) {
          if (state === 'ready' || state === 'preparing') {
            answered.set(ref, { state, at });
            marks[ref] = state;
          } else if (state === 'absent') {
            // Remembered too: "no class yet" is the answer that saves the most
            // asking, because most of the catalogue is in that state.
            answered.set(ref, { state: 'absent', at });
          }
        }
        if (Object.keys(marks).length === 0) continue;
        setFound((was) => ({
          key,
          map: { ...(was.key === key ? was.map : NO_BADGES), ...marks },
        }));
      }
    })();

    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [key]);

  return found.key === key ? found.map : NO_BADGES;
}

/**
 * The mark itself, on one line so nothing moves when it arrives late.
 *
 * "Ready now" is a promise the relay made: a published prepared class exists
 * for this topic. "Being prepared" is quieter on purpose — it is not an offer,
 * it is a reason to wait rather than start a second preparation nobody needs.
 * Tapping it is usually safe: the class screen takes the same lock, is told it
 * is held, and waits for the winner rather than paying twice — except on the
 * two paths LiveClass.tsx:495 and :499 name for themselves, where the relay
 * says the class is done and the catalogue does not have it, and the waiter
 * prepares one after all.
 *
 * Both glyph names must exist in ui/Icon.tsx's map; an unknown one draws a
 * dot (Icon.tsx:185), which is what this badge shipped as at first.
 */
export function PreparedBadge({ state }: { state: PrepBadge }) {
  const ready = state === 'ready';
  return (
    <span
      className={`inline-flex items-center gap-1 font-label-md text-label-md font-semibold ${
        ready ? 'ink-green' : 'text-on-surface-variant'
      }`}
    >
      <Icon name={ready ? 'check_circle' : 'hourglass_top'} filled={ready} className="text-[16px]" />
      {ready ? 'Ready now' : 'Being prepared'}
    </span>
  );
}

/** Per-subject tint, matching Home so a subject looks the same everywhere. */
const SUBJECT_STYLE: Record<string, { tile: string; ring: string; icon: string; ink: string }> = {
  Science: { tile: 'tile-green', ring: 'ring-tint-green', icon: 'science', ink: 'ink-green' },
  Mathematics: { tile: 'tile-blue', ring: 'ring-tint-blue', icon: 'calculate', ink: 'ink-blue' },
  Physics: { tile: 'tile-blue', ring: 'ring-tint-blue', icon: 'rocket_launch', ink: 'ink-blue' },
  Chemistry: { tile: 'tile-green', ring: 'ring-tint-green', icon: 'experiment', ink: 'ink-green' },
  Biology: { tile: 'tile-green', ring: 'ring-tint-green', icon: 'genetics', ink: 'ink-green' },
  English: { tile: 'tile-purple', ring: 'ring-tint-purple', icon: 'book', ink: 'ink-purple' },
  Hindi: { tile: 'tile-purple', ring: 'ring-tint-purple', icon: 'translate', ink: 'ink-purple' },
  'Social Science': { tile: 'tile-orange', ring: 'ring-tint-orange', icon: 'public', ink: 'ink-orange' },
};
const styleOf = (subject: string) => SUBJECT_STYLE[subject] ?? SUBJECT_STYLE.Science;

interface ChapterRow {
  id: string;
  title: string;
  topics: number;
  /** Lessons that exist for this chapter's topics. */
  lessons: CatalogEntry[];
  done: number;
  /**
   * topicRefs in this chapter that no catalogue lesson covers — the tiles a
   * student cannot currently tell apart. The ones that DO have a lesson are
   * left out on purpose: they already read as openable, and asking about them
   * would spend refs out of a fifty-ref budget to learn nothing.
   */
  cold: string[];
}

export function Syllabus() {
  const navigate = useNavigate();
  const profile = useStore(profileStore);
  const settings = useStore(settingsStore);
  const progress = useStore(progressStore);
  /**
   * The syllabus itself is bundled, so this screen is fully readable with no
   * network — the catalogue only decides how many chapters show a "done"
   * count. A failure therefore degrades rather than blocks, and says so in a
   * line instead of quietly reporting every chapter as untaught.
   */
  const { state: catalogState, retry } = useAsync(fetchCatalog, []);
  const catalog = dataOr<CatalogEntry[] | null>(catalogState, null);

  // Settings holds the class every path has ever written; the profile copy is
  // the newer one and can lag. Same precedence as the Settings screen.
  const klass = klassOf(settings, profile);

  /** This student's syllabi: their class, and only subjects they chose. */
  const mine = useMemo<SubjectSyllabus[]>(() => {
    if (klass === null) return [];
    const chosen = new Set(profile.subjects);
    return SYLLABI.filter(
      (s) => s.klass === klass && (chosen.size === 0 || chosen.has(s.subject)),
    ).sort((a, b) => a.subject.localeCompare(b.subject));
  }, [klass, profile.subjects]);

  // A single collapsed card is a pointless tap, so one subject opens itself.
  // Decided during the first render rather than in an effect: an effect leaves
  // the first paint collapsed and then snaps it open, and never runs at all on
  // the server, so the markup would not match what the student sees.
  const [openSubject, setOpenSubject] = useState<string | null>(() =>
    mine.length === 1 ? mine[0].id : null,
  );

  /** Chapters of one syllabus, joined with the lessons that teach their topics. */
  const chaptersOf = (syllabus: SubjectSyllabus): ChapterRow[] =>
    syllabus.chapters.map((chapter) => {
      const refs = chapter.topics.map((t) => `${syllabus.id}/${chapter.id}/${t.id}`);
      const paths = new Set(refs);
      const lessons = (catalog ?? []).filter((e) => e.topicRef && paths.has(e.topicRef));
      const covered = new Set(lessons.map((l) => l.topicRef));
      return {
        id: chapter.id,
        title: chapter.title,
        topics: chapter.topics.length,
        lessons,
        done: lessons.filter((l) => isCompleted(progress, l.id)).length,
        cold: refs.filter((ref) => !covered.has(ref)),
      };
    });

  /**
   * Every chapter of every subject shown, worked out once.
   *
   * Hoisted out of the render loop because the badge lookup below needs the
   * open subject's cold refs BEFORE the list is drawn, and because a hook
   * cannot sit under the `klass === null` return further down.
   */
  const rowsBySyllabus = useMemo<Record<string, ChapterRow[]>>(() => {
    const out: Record<string, ChapterRow[]> = {};
    for (const syllabus of mine) out[syllabus.id] = chaptersOf(syllabus);
    return out;
    // `chaptersOf` is a closure over exactly these three and nothing else.
  }, [mine, catalog, progress]);

  /**
   * ONLY THE SUBJECT THAT IS OPEN, ONLY ITS COLD TOPICS, AND ONLY ONCE THE
   * CATALOGUE HAS ACTUALLY SAID SOMETHING.
   *
   * A closed card shows no tiles, so a badge for it would be a request nobody
   * can see the answer to. Class 11 Biology is 241 topics — five chunked
   * requests when it is opened, none at all while it is not.
   *
   * The `status === 'ready'` clause is the load-bearing one. `useAsync` starts
   * at 'loading' and `dataOr` hands back null for it (lib/async.ts:51,83), so
   * on the first render NO topic has a lesson and every topic reads cold. Ask
   * then and we ask about topics that are already taught, and when the
   * catalogue lands the ref list changes, the run is cancelled and the whole
   * batch goes out a second time — with a badge that can appear and vanish in
   * between. A FAILED catalogue is the same trap with worse timing: every
   * topic cold is the most requests this screen can make, issued exactly when
   * the network is already proving unreliable. So a catalogue that did not
   * arrive means no badges and the screen as it looks today, which is the deal
   * the rest of this feature makes as well.
   */
  const coldRefs = useMemo(
    () =>
      openSubject === null || catalogState.status !== 'ready'
        ? []
        : (rowsBySyllabus[openSubject] ?? []).flatMap((r) => r.cold),
    [openSubject, rowsBySyllabus, catalogState.status],
  );
  const badges = usePrepBadges(coldRefs);

  if (klass === null) {
    return (
      <Screen title="Syllabus">
        <EmptyState
          icon="school"
          title="Pick your class first"
          body="Your syllabus follows your class. Choose one in Settings and the whole course appears here."
          action={
            <button
              onClick={() => navigate('/settings')}
              className="mt-2 bg-primary text-on-primary font-label-md text-label-md px-6 py-3 rounded-xl border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all"
            >
              Open Settings
            </button>
          }
        />
      </Screen>
    );
  }

  return (
    <Screen title="Syllabus" subtitle={`Class ${klass} · your full course`}>
      {catalogState.status === 'failed' && (
        <InlineError
          message="We could not load which classes are recorded, so the counts below may read low."
          onRetry={retry}
          className="mb-stack-md"
        />
      )}

      {mine.length === 0 ? (
        <EmptyState
          icon="menu_book"
          title={`Class ${klass} is still being written`}
          body="Your syllabus is not in the app yet. Nothing else is blocked — you can look around meanwhile."
        />
      ) : (
        <div className="grid gap-4">
          {mine.map((syllabus) => {
            const style = styleOf(syllabus.subject);
            const rows = rowsBySyllabus[syllabus.id] ?? [];
            const open = openSubject === syllabus.id;
            const taught = rows.filter((r) => r.lessons.length > 0).length;
            const totalTopics = rows.reduce((n, r) => n + r.topics, 0);

            return (
              <section
                key={syllabus.id}
                className="bg-surface-container-lowest rounded-[24px] overflow-hidden shadow-soft-indigo"
              >
                <button
                  onClick={() => setOpenSubject(open ? null : syllabus.id)}
                  aria-expanded={open}
                  className={`w-full flex items-center gap-4 p-4 text-left ${style.tile}`}
                >
                  <span className={`w-12 h-12 rounded-full grid place-items-center shrink-0 ${style.ring}`}>
                    <Icon name={style.icon} filled className={`text-[24px] ${style.ink}`} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-headline-md text-[18px] leading-6 text-on-surface">
                      {syllabus.subject}
                    </span>
                    <span className={`block font-label-md text-label-md font-semibold ${style.ink}`}>
                      {rows.length} chapters · {totalTopics} topics
                      {taught > 0 ? ` · ${taught} started` : ''}
                    </span>
                  </span>
                  <Icon
                    name="expand_more"
                    className={`text-on-surface-variant transition-transform ${open ? 'rotate-180' : ''}`}
                  />
                </button>

                {open && (
                  <ol className="grid gap-2 p-3">
                    {rows.map((row, i) => {
                      const available = row.lessons.length > 0;
                      const complete = available && row.done === row.lessons.length;
                      /**
                       * Counted over this chapter's cold topics only, so the
                       * number answers the question a student actually has:
                       * how many of the ones with no lesson yet would still
                       * open at once. Zero of either shows nothing — an
                       * outage counts as zero and therefore reads as absent.
                       */
                      const ready = row.cold.filter((ref) => badges[ref] === 'ready').length;
                      const preparing = row.cold.filter((ref) => badges[ref] === 'preparing').length;
                      return (
                        <li key={row.id}>
                          <button
                            onClick={() => navigate(`/chapter/${syllabus.id}/${row.id}`)}
                            className="w-full flex items-center gap-3 text-left rounded-2xl p-3 hover:bg-surface-container transition-colors"
                          >
                            <span
                              className={`w-9 h-9 rounded-full grid place-items-center shrink-0 font-label-md text-label-md font-bold ${
                                complete
                                  ? 'ring-tint-green ink-green'
                                  : available
                                    ? 'bg-primary-fixed text-on-primary-fixed'
                                    : 'bg-surface-container text-on-surface-variant'
                              }`}
                            >
                              {complete ? <Icon name="check" className="text-[20px]" /> : i + 1}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block font-body-md text-body-md text-on-surface truncate">
                                {row.title}
                              </span>
                              {/* ONE LINE, AND `truncate` IS WHAT MAKES THAT
                                  TRUE. The counts land after the first paint;
                                  without it a narrow phone wraps the line, and
                                  a wrap here does not just reflow this row, it
                                  pushes every chapter below it down — under a
                                  finger already reaching for one. Clipped is
                                  the cost, and it falls on the tail rather
                                  than on the counts, which lead for that
                                  reason. Both counts show: a chapter with one
                                  ready topic and six being prepared used to
                                  say only "1 ready" and hide the six, which is
                                  the half that says do not start a seventh. */}
                              <span className="block font-label-md text-label-md text-on-surface-variant truncate">
                                {ready > 0 && (
                                  <span className="ink-green font-semibold">{ready} ready · </span>
                                )}
                                {preparing > 0 && <span>{preparing} preparing · </span>}
                                {row.topics} {row.topics === 1 ? 'topic' : 'topics'}
                                {available
                                  ? ` · ${row.done}/${row.lessons.length} ${row.lessons.length === 1 ? 'lesson' : 'lessons'} done`
                                  : ' · coming soon'}
                              </span>
                            </span>
                            <Icon name="chevron_right" className="text-on-surface-variant shrink-0" />
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>
            );
          })}
        </div>
      )}
    </Screen>
  );
}
