import { useNavigate, useParams } from 'react-router-dom';
import { SYLLABI, topicsOf, type TopicRow } from '../lib/content';
import { useAsync } from '../lib/async';
import { progressStore, isCompleted } from '../stores/progress';
import { useStore } from '../stores/localStore';
import { Screen, EmptyState } from '../ui/Screen';
import { AsyncSection, SkeletonList } from '../ui/States';
import { Icon } from '../ui/Icon';

/**
 * A chapter's topic list. Every syllabus topic appears; the ones without a
 * lesson yet show as "coming soon" — the list IS the syllabus, and content
 * fills it in over time with zero code changes.
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

          return (
            <button
              key={path}
              // A topic nobody has studied yet is not locked — it is the one
              // she has not had to teach before. Tapping it prepares the class
              // live, and the student after this one is shown what she made.
              onClick={() => navigate(available ? `/lesson/${next.id}` : `/class/${path}`)}
              className="flex items-center gap-4 text-left bg-surface-container-lowest rounded-[20px] p-4 shadow-sm transition-all hover:shadow-md hover:scale-[1.01] cursor-pointer"
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
                  <div className="font-label-md text-label-md text-primary">Start this class</div>
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
    </Screen>
  );
}
