import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SubjectSyllabus } from '@ai-tutor/syllabus';
import { SYLLABI, fetchCatalog, type CatalogEntry } from '../lib/content';
import { progressStore, isCompleted } from '../stores/progress';
import { profileStore } from '../stores/profile';
import { settingsStore } from '../stores/settings';
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
}

export function Syllabus() {
  const navigate = useNavigate();
  const profile = useStore(profileStore);
  const settings = useStore(settingsStore);
  const progress = useStore(progressStore);
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);

  useEffect(() => {
    fetchCatalog()
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, []);

  // Settings holds the class every path has ever written; the profile copy is
  // the newer one and can lag. Same precedence as the Settings screen.
  const klass = settings.klass ?? profile.klass;

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
      const paths = new Set(chapter.topics.map((t) => `${syllabus.id}/${chapter.id}/${t.id}`));
      const lessons = (catalog ?? []).filter((e) => e.topicRef && paths.has(e.topicRef));
      return {
        id: chapter.id,
        title: chapter.title,
        topics: chapter.topics.length,
        lessons,
        done: lessons.filter((l) => isCompleted(progress, l.id)).length,
      };
    });

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
            const rows = chaptersOf(syllabus);
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
                              <span className="block font-label-md text-label-md text-on-surface-variant">
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
