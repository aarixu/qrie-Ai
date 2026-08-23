import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SYLLABI, fetchCatalog, type CatalogEntry } from '../lib/content';
import { progressStore, isCompleted, computeStreak } from '../stores/progress';
import { doubtLogStore } from '../stores/doubtLog';
import { useStore } from '../stores/localStore';
import { Screen } from '../ui/Screen';
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
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);

  useEffect(() => {
    fetchCatalog().then(setCatalog).catch(() => setCatalog([]));
  }, []);

  const completed = Object.values(progress.lessons).filter((l) => l.completedAt).length;
  const streak = computeStreak(progress);

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
      <div className="flex gap-3 mb-stack-md">
        {stat('check_circle', String(completed), 'lessons done', 'tile-green', 'text-[#166534]')}
        {stat('local_fire_department', String(streak), 'day streak', 'tile-orange', 'text-[#9a3412]', '/streak')}
        {stat('back_hand', String(doubts.length), 'doubts asked', 'tile-blue', 'text-[#1e40af]', '/doubts')}
      </div>

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
