import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SYLLABI, fetchCatalog, findEntry, type CatalogEntry } from '../lib/content';
import { progressStore, isCompleted, computeStreak } from '../stores/progress';
import { settingsStore } from '../stores/settings';
import { useStore } from '../stores/localStore';
import { theme } from '../ui/theme';
import { ChevronIcon, FlameIcon, PlayIcon, UserIcon, CheckIcon } from '../ui/icons';

/**
 * Home: continue where you left off, then browse chapters. Chapters come from
 * the syllabus tree; how many of a chapter's topics have lessons (and how many
 * are done) is the per-chapter progress.
 */
export function Home() {
  const navigate = useNavigate();
  const progress = useStore(progressStore);
  const settings = useStore(settingsStore);
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [continueEntry, setContinueEntry] = useState<CatalogEntry | null>(null);

  useEffect(() => {
    fetchCatalog().then(setCatalog).catch(() => setCatalog([]));
  }, []);

  useEffect(() => {
    if (!progress.lastLessonId) return;
    findEntry(progress.lastLessonId).then(setContinueEntry).catch(() => setContinueEntry(null));
  }, [progress.lastLessonId]);

  const streak = computeStreak(progress);
  const completedCount = Object.values(progress.lessons).filter((l) => l.completedAt).length;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: theme.bg,
        overflowY: 'auto',
        fontFamily: theme.font,
      }}
    >
      <div style={{ maxWidth: 600, margin: '0 auto', padding: 'calc(22px + env(safe-area-inset-top)) 18px 40px' }}>
        {/* Top row: brand + streak + profile */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <h1 style={{ color: theme.text, font: `900 26px ${theme.font}`, margin: 0, flex: 1 }}>
            AI Tutor
          </h1>
          {streak > 0 && (
            <span
              aria-label={`${streak} day streak`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                color: '#ff9600',
                font: `800 15px ${theme.font}`,
              }}
            >
              <FlameIcon size={19} />
              {streak}
            </span>
          )}
          <Link
            to="/profile"
            aria-label="profile"
            style={{
              width: 42,
              height: 42,
              borderRadius: '50%',
              border: `2px solid ${theme.border}`,
              display: 'grid',
              placeItems: 'center',
              color: theme.textMuted,
              background: theme.bg,
            }}
          >
            <UserIcon size={20} />
          </Link>
        </div>

        {/* Continue card */}
        {continueEntry && !isCompleted(progress, continueEntry.id) && (
          <button
            onClick={() => navigate(`/lesson/${continueEntry.id}`)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              textAlign: 'left',
              padding: 16,
              marginBottom: 22,
              borderRadius: 16,
              border: 'none',
              background: theme.green,
              boxShadow: `0 4px 0 ${theme.greenDark}`,
              cursor: 'pointer',
            }}
          >
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.25)',
                display: 'grid',
                placeItems: 'center',
                color: '#fff',
                flexShrink: 0,
              }}
            >
              <PlayIcon size={20} style={{ marginLeft: 2 }} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ color: 'rgba(255,255,255,0.85)', font: `800 11px ${theme.font}`, letterSpacing: 0.8 }}>
                CONTINUE LEARNING
              </div>
              <div style={{ color: '#fff', font: `800 17px ${theme.font}` }}>{continueEntry.title}</div>
            </div>
            <ChevronIcon size={20} style={{ color: 'rgba(255,255,255,0.9)' }} />
          </button>
        )}

        {/* Chapters, per syllabus */}
        {SYLLABI.map((syllabus) => (
          <section key={syllabus.id} style={{ marginBottom: 26 }}>
            <div
              style={{
                color: theme.textFaint,
                font: `800 12px ${theme.font}`,
                letterSpacing: 1,
                textTransform: 'uppercase',
                margin: '0 0 10px',
              }}
            >
              Class {syllabus.klass} · {syllabus.subject}
              {settings.klass !== null && settings.klass !== syllabus.klass && ' (preview)'}
            </div>

            <div style={{ display: 'grid', gap: 12 }}>
              {syllabus.chapters.map((chapter) => {
                const total = chapter.topics.length;
                const withLesson = chapter.topics.filter((t) =>
                  catalog?.some((e) => e.topicRef === `${syllabus.id}/${chapter.id}/${t.id}`),
                );
                const done = withLesson.filter((t) => {
                  const entry = catalog?.find(
                    (e) => e.topicRef === `${syllabus.id}/${chapter.id}/${t.id}`,
                  );
                  return entry ? isCompleted(progress, entry.id) : false;
                }).length;

                return (
                  <button
                    key={chapter.id}
                    onClick={() => navigate(`/chapter/${syllabus.id}/${chapter.id}`)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      textAlign: 'left',
                      padding: 14,
                      borderRadius: 16,
                      border: `2px solid ${theme.border}`,
                      borderBottomWidth: 4,
                      background: theme.bg,
                      cursor: 'pointer',
                      transition: 'background 150ms',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = theme.bgSoft)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = theme.bg)}
                  >
                    <div
                      style={{
                        width: 54,
                        height: 54,
                        borderRadius: 14,
                        background: theme.blue,
                        boxShadow: 'inset 0 -4px 0 rgba(0,0,0,0.14)',
                        display: 'grid',
                        placeItems: 'center',
                        color: '#fff',
                        font: `900 20px ${theme.font}`,
                        flexShrink: 0,
                      }}
                    >
                      {chapter.title.charAt(0)}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ color: theme.text, font: `800 17px ${theme.font}` }}>
                        {chapter.title}
                      </div>
                      <div style={{ color: theme.textMuted, font: `700 13px ${theme.font}` }}>
                        {done > 0 && (
                          <span style={{ color: theme.green, marginRight: 6 }}>
                            <CheckIcon size={12} style={{ verticalAlign: '-1px' }} /> {done} done ·
                          </span>
                        )}
                        {withLesson.length} of {total} topics ready
                      </div>
                    </div>
                    <ChevronIcon size={20} style={{ color: theme.textFaint }} />
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        <div style={{ color: theme.textFaint, font: `700 13px ${theme.font}`, textAlign: 'center' }}>
          {completedCount > 0
            ? `${completedCount} lesson${completedCount === 1 ? '' : 's'} completed. Keep going!`
            : 'Finish your first lesson to start a streak.'}
        </div>
      </div>
    </div>
  );
}
