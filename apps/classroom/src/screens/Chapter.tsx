import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SYLLABI, topicsOf, type TopicRow } from '../lib/content';
import { progressStore, isCompleted } from '../stores/progress';
import { useStore } from '../stores/localStore';
import { theme } from '../ui/theme';
import { BackIcon, CheckIcon, ChevronIcon, LockIcon, PlayIcon } from '../ui/icons';

/**
 * A chapter's topic list. Every topic from the syllabus appears; the ones
 * without a lesson yet show as "coming soon" — the list IS the syllabus, and
 * content fills it in over time with zero code changes.
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
      <Shell onBack={() => navigate('/')} title="Chapter not found">
        <div style={{ color: theme.textMuted, font: `700 15px ${theme.font}` }}>
          This chapter doesn't exist. Head back home.
        </div>
      </Shell>
    );
  }

  return (
    <Shell onBack={() => navigate('/')} title={chapter.title} subtitle={`Class ${syllabus.klass} · ${syllabus.subject}`}>
      <div style={{ display: 'grid', gap: 12 }}>
        {(rows ?? []).map(({ path, topic, lesson }, i) => {
          const done = lesson ? isCompleted(progress, lesson.id) : false;
          const available = lesson !== null;
          const tile = done ? theme.green : available ? theme.blue : theme.border;

          return (
            <button
              key={path}
              onClick={() => lesson && navigate(`/lesson/${lesson.id}`)}
              disabled={!available}
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
                cursor: available ? 'pointer' : 'default',
                opacity: available ? 1 : 0.75,
                transition: 'background 150ms',
              }}
              onMouseEnter={(e) => {
                if (available) e.currentTarget.style.background = theme.bgSoft;
              }}
              onMouseLeave={(e) => (e.currentTarget.style.background = theme.bg)}
            >
              <div
                style={{
                  width: 50,
                  height: 50,
                  borderRadius: '50%',
                  background: tile,
                  boxShadow: available ? 'inset 0 -4px 0 rgba(0,0,0,0.14)' : 'none',
                  display: 'grid',
                  placeItems: 'center',
                  color: available ? '#fff' : theme.textFaint,
                  flexShrink: 0,
                }}
              >
                {done ? (
                  <CheckIcon size={20} />
                ) : available ? (
                  <PlayIcon size={18} style={{ marginLeft: 2 }} />
                ) : (
                  <LockIcon size={18} />
                )}
              </div>

              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    color: theme.textFaint,
                    font: `800 10.5px ${theme.font}`,
                    letterSpacing: 0.8,
                  }}
                >
                  TOPIC {i + 1}
                  {topic.estMinutes ? ` · ~${topic.estMinutes} MIN` : ''}
                </div>
                <div style={{ color: theme.text, font: `800 16.5px ${theme.font}` }}>
                  {topic.title}
                </div>
                {!available && (
                  <div style={{ color: theme.textFaint, font: `700 12.5px ${theme.font}` }}>
                    Coming soon
                  </div>
                )}
              </div>

              {available && <ChevronIcon size={20} style={{ color: theme.textFaint }} />}
            </button>
          );
        })}
      </div>
    </Shell>
  );
}

function Shell({
  title,
  subtitle,
  onBack,
  children,
}: {
  title: string;
  subtitle?: string;
  onBack(): void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: theme.bg, overflowY: 'auto', fontFamily: theme.font }}>
      <div style={{ maxWidth: 600, margin: '0 auto', padding: 'calc(16px + env(safe-area-inset-top)) 18px 40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          <button
            onClick={onBack}
            aria-label="back"
            style={{
              width: 42,
              height: 42,
              display: 'grid',
              placeItems: 'center',
              border: 'none',
              background: 'none',
              color: theme.textFaint,
              cursor: 'pointer',
            }}
          >
            <BackIcon />
          </button>
          <div>
            <div style={{ color: theme.text, font: `900 22px ${theme.font}` }}>{title}</div>
            {subtitle && (
              <div style={{ color: theme.textMuted, font: `700 13px ${theme.font}` }}>{subtitle}</div>
            )}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
