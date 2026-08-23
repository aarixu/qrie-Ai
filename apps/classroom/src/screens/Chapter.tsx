import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SYLLABI, topicsOf, type TopicRow } from '../lib/content';
import { progressStore, isCompleted } from '../stores/progress';
import { useStore } from '../stores/localStore';
import { Screen, EmptyState } from '../ui/Screen';
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
  const [rows, setRows] = useState<TopicRow[] | null>(null);

  const syllabus = SYLLABI.find((s) => s.id === syllabusId) ?? null;
  const chapter = syllabus?.chapters.find((c) => c.id === chapterId) ?? null;

  useEffect(() => {
    if (!syllabus || !chapterId) return;
    topicsOf(syllabus, chapterId).then(setRows).catch(() => setRows([]));
  }, [syllabusId, chapterId]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <div className="grid gap-3">
        {(rows ?? []).map(({ path, topic, lessons }, i) => {
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
              onClick={() => next && navigate(`/lesson/${next.id}`)}
              disabled={!available}
              className={`flex items-center gap-4 text-left bg-surface-container-lowest rounded-[20px] p-4 shadow-sm transition-all ${
                available ? 'hover:shadow-md hover:scale-[1.01] cursor-pointer' : 'opacity-70 cursor-default'
              }`}
            >
              <div
                className={`w-12 h-12 rounded-full grid place-items-center shrink-0 ${
                  done
                    ? 'bg-[#dcfce7] text-[#166534]'
                    : available
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container text-on-surface-variant'
                }`}
              >
                <Icon name={done ? 'check' : available ? 'play_arrow' : 'lock'} filled={available && !done} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide">
                  Topic {i + 1}
                  {topic.estMinutes ? ` · ~${topic.estMinutes} min` : ''}
                </div>
                <div className="font-headline-md text-[17px] leading-6 text-on-surface">{topic.title}</div>
                {!available ? (
                  <div className="font-label-md text-label-md text-on-surface-variant">Coming soon</div>
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
    </Screen>
  );
}
