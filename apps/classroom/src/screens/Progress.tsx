import { useNavigate } from 'react-router-dom';
import { SYLLABI, fetchCatalog, type CatalogEntry, subjectsAvailable } from '../lib/content';
import { useAsync, dataOr } from '../lib/async';
import { InlineError, OfflineNotice, SkeletonList } from '../ui/States';
import { progressStore, isCompleted, computeStreak } from '../stores/progress';
import { doubtLogStore } from '../stores/doubtLog';
import { useStore } from '../stores/localStore';
import { Screen } from '../ui/Screen';
import { profileStore } from '../stores/profile';
import { subjectNeedingAttention, subjectProgress } from '../lib/subjectProgress';
import { Icon } from '../ui/Icon';

/** Doubts grouped by (lesson, beat), most-asked first — the data spine, visible. */
function topDoubtSpots(doubts: { lessonId: string; beatId: string }[]) {
  const counts = new Map<string, number>();
  for (const d of doubts) {
    const key = `${d.lessonId} ${d.beatId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => {
      const [lessonId, beatId] = key.split(' ');
      return { lessonId, beatId, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

export function Progress() {
  const navigate = useNavigate();
  const progress = useStore(progressStore);
  const doubts = useStore(doubtLogStore);
  // Per-subject progress is a percentage OF the catalogue, so an unreachable
  // catalogue would silently report every subject at 0% — a student's year of
  // work erased by a train tunnel. Loading and failed both hold the bars back
  // rather than drawing a wrong number.
  const { state: catalogState, retry } = useAsync(fetchCatalog, []);
  const catalog = dataOr<CatalogEntry[]>(catalogState, []);

  const completed = Object.values(progress.lessons).filter((l) => l.completedAt).length;
  const streak = computeStreak(progress);

  const profile = useStore(profileStore);
  const subjects = subjectProgress({
    catalog: profile.klass === null ? catalog : catalog.filter((e) => e.class === profile.klass),
    progress,
    chosen: profile.subjects,
    offered: profile.klass === null ? [] : subjectsAvailable(profile.klass),
  });
  const dropping = subjectNeedingAttention(subjects);

  /**
   * A tile is a button when there is somewhere to go and a plain div when
   * there is not — rather than a button that looks live and does nothing.
   */
  const stat = (
    icon: string,
    value: string,
    label: string,
    tint: string,
    ink: string,
    to?: string,
  ) => {
    const body = (
      <>
        <Icon name={icon} filled className={`text-3xl ${ink}`} />
        <span className="font-headline-md text-headline-md text-on-surface">{value}</span>
        <span className="font-label-sm text-label-sm text-on-surface-variant text-center">{label}</span>
      </>
    );
    const shape = `${tint} rounded-[20px] p-4 flex-1 min-w-[104px] flex flex-col items-center gap-1`;
    return to === undefined ? (
      <div className={shape}>{body}</div>
    ) : (
      <button onClick={() => navigate(to)} className={`${shape} hover:scale-[1.02] transition-transform`}>
        {body}
      </button>
    );
  };

  return (
    <Screen title="Your progress">
      <OfflineNotice className="mb-stack-md" />

      <div className="flex gap-3 mb-stack-md">
        {stat('check_circle', String(completed), 'lessons done', 'tile-green', 'ink-green')}
        {stat('local_fire_department', String(streak), 'day streak', 'tile-orange', 'ink-orange', '/streak')}
        {stat('back_hand', String(doubts.length), 'doubts asked', 'tile-blue', 'ink-blue', '/doubts')}
      </div>

      {/* WHERE THEY STAND IN EACH SUBJECT.

          The two numbers above are true and neither answers the question a
          student with more than one subject actually has, which is which one
          they are behind in. */}
      {catalogState.status === 'loading' && (
        <SkeletonList rows={3} label="Working out where you stand" className="h-[64px]" />
      )}

      {/* Silence here would be the very thing this screen set out to remove:
          a student whose subjects simply vanished, with nothing to press. */}
      {catalogState.status === 'failed' && (
        <InlineError
          message="We could not work out where you stand in each subject."
          onRetry={retry}
          className="mb-stack-md"
        />
      )}

      {catalogState.status === 'ready' && subjects.length > 0 && (
        <section className="mb-stack-md">
          <h2 className="font-label-sm text-label-sm uppercase tracking-wider text-outline mb-stack-sm">
            By subject
          </h2>
          <ul className="flex flex-col gap-3">
            {subjects.map((row) => (
              <li
                key={row.subject}
                className="bg-surface-container-lowest rounded-[20px] p-4 shadow-soft-indigo"
              >
                <div className="flex items-baseline gap-2">
                  <span className="flex-1 font-headline-md text-[18px] leading-6 text-on-surface">
                    {row.subject}
                  </span>
                  <span className="font-label-md text-label-md text-on-surface-variant">
                    {row.empty ? 'Coming soon' : `${row.done} of ${row.available}`}
                  </span>
                </div>

                {/* A bar at zero would say "you have done none of it" when the
                    truth is "there is none of it yet" — so an empty subject
                    gets a sentence instead of a bar. */}
                {row.empty ? (
                  <p className="font-body-md text-body-md text-on-surface-variant mt-1">
                    Lessons for this subject are still being written.
                  </p>
                ) : (
                  <>
                    <div
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={row.available}
                      aria-valuenow={row.done}
                      aria-valuetext={`${row.done} of ${row.available} lessons finished in ${row.subject}`}
                      className="h-2 rounded-full bg-surface-variant overflow-hidden mt-3"
                    >
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.round((row.share ?? 0) * 100)}%` }}
                      />
                    </div>
                    {row.subject === dropping && (
                      <p className="font-label-md text-label-md text-on-surface-variant mt-2">
                        The one you have not touched in a while.
                      </p>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Per-chapter completion */}
      {SYLLABI.map((syllabus) =>
        syllabus.chapters.map((chapter) => {
          const rows = chapter.topics.map((t) => {
            const ref = `${syllabus.id}/${chapter.id}/${t.id}`;
            return catalog.find((e) => e.topicRef === ref) ?? null;
          });
          const ready = rows.filter(Boolean).length;
          const done = rows.filter((e) => e && isCompleted(progress, e.id)).length;
          const pct = ready === 0 ? 0 : Math.round((done / ready) * 100);

          return (
            <button
              key={`${syllabus.id}/${chapter.id}`}
              onClick={() => navigate(`/chapter/${syllabus.id}/${chapter.id}`)}
              className="w-full text-left bg-surface-container-lowest rounded-[20px] p-4 shadow-sm hover:shadow-md transition-shadow mb-3"
            >
              <div className="flex items-baseline justify-between mb-2">
                <span className="font-headline-md text-[18px] leading-6 text-on-surface">{chapter.title}</span>
                <span className="font-label-md text-label-md text-on-surface-variant">
                  {done}/{ready || chapter.topics.length}
                </span>
              </div>
              <div className="h-[10px] bg-surface-variant rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-[width] duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </button>
          );
        }),
      )}

      {/* Where hands went up — the signal that later tells the factory which beat to redo. */}
      {doubts.length > 0 && (
        <>
          <div className="flex items-baseline justify-between mt-stack-md mb-stack-sm">
            <h2 className="font-headline-md text-[20px] leading-7 text-on-surface">
              Where you asked the most
            </h2>
            <button
              onClick={() => navigate('/doubts')}
              className="font-label-md text-label-md text-primary underline underline-offset-2"
            >
              See all
            </button>
          </div>
          <div className="grid gap-2">
            {topDoubtSpots(doubts).map((spot) => (
              <div
                key={`${spot.lessonId}:${spot.beatId}`}
                className="flex items-center gap-3 bg-surface-container-lowest rounded-[16px] px-4 py-3"
              >
                <Icon name="back_hand" className="text-primary" />
                <span className="flex-1 font-body-md text-body-md text-on-surface capitalize">
                  {spot.lessonId.replace(/^class\d+-/, '').replace(/-/g, ' ')} ·{' '}
                  {spot.beatId.replace(/_/g, ' ')}
                </span>
                <span className="font-label-md text-label-md text-on-surface-variant">×{spot.count}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Screen>
  );
}
