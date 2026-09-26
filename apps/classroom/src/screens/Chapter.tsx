import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SYLLABI, topicsOf, type TopicRow } from '../lib/content';
import { useAsync, dataOr } from '../lib/async';
import { progressStore, isCompleted } from '../stores/progress';
import { useStore } from '../stores/localStore';
import { Screen, EmptyState } from '../ui/Screen';
import { AsyncSection, SkeletonList } from '../ui/States';
import { Icon } from '../ui/Icon';
// Imported from a sibling screen, which is not where this belongs: the badge
// and its batched reader want a lib/ and a ui/ file, and this phase owns
// neither. Duplicating them here would give the app two badges that drift.
import { PreparedBadge, usePrepBadges } from './Syllabus';
import { PROTOTYPE_ONLY_PREPARED, usePrototypeNotice } from '../lib/prototype';
import { PrototypeNotice } from '../ui/PrototypeNotice';

/**
 * A chapter's topic list. Every syllabus topic appears; the ones without a
 * lesson yet show as "coming soon" — the list IS the syllabus, and content
 * fills it in over time with zero code changes.
 *
 * THE BADGE, and what it is and is not for. Every cold tile here costs the
 * same tap and wildly different things behind it: a topic somebody already
 * prepared opens at once, one nobody has touched is the ninety-six seconds
 * prep.ts measured ON A DEVELOPMENT MACHINE — longer on the cheap Android this
 * is for — and about Rs 30 of somebody's money, and one being prepared RIGHT
 * NOW is the tap where waiting beats starting a second copy. The mark
 * only ever goes on a tile that has no lesson in the catalogue, because a tile
 * that HAS one already reads as openable and a second mark would be noise.
 *
 * An outage produces no mark, exactly like a topic nobody has prepared. That
 * is the direction it has to fail: a badge that guessed "ready" during an
 * outage would send a child to tap a class that is not there.
 *
 * WHAT "Ready now" DOES NOT PROMISE, said out loud. The relay is what knows a
 * published class exists; the TAP is routed by lib/content's catalogue, which
 * is cached in a module and filtered to the student's own class window. Where
 * the two disagree — a kept-class read that timed out, or a catalogue cached
 * before the class was saved — the tile says ready and LiveClass prepares one
 * anyway. The badge is not wrong about the relay; the routing behind it is
 * stale. Named rather than fixed: LiveClass.tsx is not this phase's to edit.
 */
export function Chapter() {
  const { syllabusId, chapterId } = useParams<{ syllabusId: string; chapterId: string }>();
  const navigate = useNavigate();
  const progress = useStore(progressStore);
  const syllabus = SYLLABI.find((s) => s.id === syllabusId) ?? null;
  const chapter = syllabus?.chapters.find((c) => c.id === chapterId) ?? null;

  // A failure here used to become setRows([]), so a chapter that could not be
  // reached looked exactly like a chapter with no topics — and the student was
  // shown a blank page with nothing to press.
  const { state, retry } = useAsync<TopicRow[]>(
    () => (syllabus && chapterId ? topicsOf(syllabus, chapterId) : Promise.resolve([])),
    [syllabusId, chapterId],
  );

  /**
   * The cold tiles, and only those. One request for the whole chapter: the
   * largest chapter in the app is Class 11 Chemistry's 41 topics, under the
   * route's fifty-ref ceiling, so a chapter is always a single round trip.
   * Empty until the topics land, which means no request is made at all while
   * the list is still loading or if it fails.
   */
  const coldRefs = useMemo(
    () =>
      // NOTHING TO ASK ABOUT WHILE THE GATE IS ON. A cold tile cannot be
      // tapped into a class, so "somebody is preparing this right now" is a
      // fact with no action attached — and asking costs the relay one request
      // per chapter for a badge nobody can act on.
      PROTOTYPE_ONLY_PREPARED
        ? []
        : dataOr<TopicRow[]>(state, [])
            .filter((row) => row.lessons.length === 0)
            .map((row) => row.path),
    [state],
  );
  const badges = usePrepBadges(coldRefs);
  const notice = usePrototypeNotice();

  if (!syllabus || !chapter) {
    return (
      <Screen title="Chapter" onBack={() => navigate('/')}>
        <EmptyState icon="error" title="Chapter not found" body="This chapter doesn't exist any more." />
      </Screen>
    );
  }

  return (
    <Screen
      title={chapter.title}
      subtitle={`Class ${syllabus.klass} · ${syllabus.subject}`}
      onBack={() => navigate('/')}
    >
      <AsyncSection
        state={state}
        onRetry={retry}
        loading={<SkeletonList rows={4} label={`Loading ${chapter.title}`} />}
        errorTitle="We could not load this chapter"
        isEmpty={(rows) => rows.length === 0}
        empty={
          <EmptyState
            icon="menu_book"
            title="No topics here yet"
            body="This chapter has not been written up. Try another one from the syllabus."
          />
        }
      >
        {(rows) => (
      <div className="grid gap-3">
        {rows.map(({ path, topic, lessons }, i) => {
          // A topic is done only when every lesson under it is — half a topic
          // is not a finished topic.
          const available = lessons.length > 0;
          const done = available && lessons.every((l) => isCompleted(progress, l.id));
          // Open the first unfinished lesson, so tapping a part-done topic
          // continues rather than restarting it.
          const next = lessons.find((l) => !isCompleted(progress, l.id)) ?? lessons[0];

          /**
           * THE GATE, and it is one condition.
           *
           * A topic nobody has studied yet was never locked — tapping it
           * prepared the class live, and the student after this one was shown
           * what she made. That is still the design; it is switched off while
           * billing is, because the preparation cannot finish and the student
           * was being handed the vendor's own 403 instead of a class.
           *
           * `available` is the catalogue's answer and already correct here —
           * the row carries the lessons filtered to its own topicRef — so this
           * adds no second notion of readiness, it only changes what happens
           * when the answer is no.
           */
          const frozen = PROTOTYPE_ONLY_PREPARED && !available;

          return (
            <button
              key={path}
              // aria-disabled, NOT disabled. A disabled button fires no click,
              // and the click is the whole point: it is what opens the notice
              // that explains why. `disabled` would leave a dimmed tile that
              // swallows taps, which reads as broken rather than as not-ready.
              aria-disabled={frozen}
              aria-label={frozen ? `${topic.title} — not ready yet` : undefined}
              onClick={() =>
                frozen
                  ? notice.show(topic.title)
                  : navigate(available ? `/lesson/${next.id}` : `/class/${path}`)
              }
              className={`flex items-center gap-4 text-left bg-surface-container-lowest rounded-[20px] p-4 shadow-sm transition-all ${
                frozen
                  ? // The app's own disabled idiom, from Bookmarks and
                    // DoubtHistory: dimmed, no hover lift, no pointer. It still
                    // takes a tap, because the notice is the point — a tile
                    // that swallowed the tap would just look broken.
                    'opacity-70 cursor-default'
                  : 'hover:shadow-md hover:scale-[1.01] cursor-pointer'
              }`}
            >
              <div
                className={`w-12 h-12 rounded-full grid place-items-center shrink-0 ${
                  done
                    ? 'ring-tint-green ink-green'
                    : available
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container text-on-surface-variant'
                }`}
              >
                <Icon name={done ? 'check' : available ? 'play_arrow' : 'auto_awesome'} filled={!done} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide">
                  Topic {i + 1}
                  {topic.estMinutes ? ` · ~${topic.estMinutes} min` : ''}
                </div>
                <div className="font-headline-md text-[17px] leading-6 text-on-surface">{topic.title}</div>
                {!available ? (
                  /* ONE LINE, WHATEVER IT SAYS, and `truncate` is what holds
                     that when the badge lands after the first paint: a wrap
                     here would grow the tile and push every tile below it
                     down, under a finger already reaching for one.

                     A READY TILE KEEPS ITS INVITATION. The badge is the reason
                     to tap and "Start this class" is the thing to do about it,
                     so ready shows both; "being prepared" replaces the words
                     on purpose, because there not tapping is the better move. */
                  <div
                    className={`font-label-md text-label-md truncate ${
                      frozen ? 'text-on-surface-variant' : 'text-primary'
                    }`}
                  >
                    {/* THE INVITATION IS THE FIRST THING TO GO. "Start this
                        class" on a tile that cannot start one is the sentence
                        that sent a child into the 403. */}
                    {frozen ? (
                      'Coming soon'
                    ) : badges[path] === 'ready' ? (
                      <>
                        <PreparedBadge state="ready" /> · Start this class
                      </>
                    ) : badges[path] ? (
                      <PreparedBadge state={badges[path]} />
                    ) : (
                      'Start this class'
                    )}
                  </div>
                ) : (
                  lessons.length > 1 && (
                    <div className="font-label-md text-label-md text-on-surface-variant">
                      {lessons.filter((l) => isCompleted(progress, l.id)).length} of {lessons.length} lessons done
                    </div>
                  )
                )}
              </div>

              {available && <Icon name="chevron_right" className="text-on-surface-variant" />}
            </button>
          );
        })}
      </div>
        )}
      </AsyncSection>
      {notice.tapped && <PrototypeNotice topic={notice.tapped} onClose={notice.dismiss} />}
    </Screen>
  );
}
