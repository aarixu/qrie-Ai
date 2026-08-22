import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { findEntry, nextLessonAfter, type CatalogEntry } from '../lib/content';
import { progressStore, computeStreak } from '../stores/progress';
import { useStore } from '../stores/localStore';
import { theme } from '../ui/theme';
import { Button } from '../ui/Button';
import { CheckIcon, ChevronIcon, FlameIcon, HomeIcon } from '../ui/icons';

/**
 * The moment of celebration after a lesson — the screen every established
 * learning app treats as sacred: a big win mark, the streak, and ONE clear
 * next action.
 */
export function LessonComplete() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();
  const progress = useStore(progressStore);
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [next, setNext] = useState<CatalogEntry | null>(null);

  useEffect(() => {
    if (!lessonId) return;
    findEntry(lessonId).then(setEntry).catch(() => setEntry(null));
    nextLessonAfter(lessonId).then(setNext).catch(() => setNext(null));
  }, [lessonId]);

  const streak = computeStreak(progress);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: theme.bg,
        overflowY: 'auto',
        fontFamily: theme.font,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <div style={{ width: '100%', maxWidth: 420, textAlign: 'center', display: 'grid', gap: 18, justifyItems: 'center' }}>
        <div
          style={{
            width: 108,
            height: 108,
            borderRadius: '50%',
            background: theme.green,
            boxShadow: `0 6px 0 ${theme.greenDark}`,
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
          }}
        >
          <CheckIcon size={54} />
        </div>

        <div>
          <h1 style={{ color: theme.text, font: `900 26px ${theme.font}`, margin: '0 0 4px' }}>
            Lesson complete!
          </h1>
          {entry && (
            <div style={{ color: theme.textMuted, font: `700 15px ${theme.font}` }}>{entry.title}</div>
          )}
        </div>

        {streak > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              borderRadius: 14,
              border: `2px solid ${theme.border}`,
              color: '#ff9600',
              font: `800 15px ${theme.font}`,
            }}
          >
            <FlameIcon size={20} />
            {streak}-day streak
          </div>
        )}

        <div style={{ display: 'grid', gap: 10, width: '100%', marginTop: 6 }}>
          {next && (
            <Button variant="green" onClick={() => navigate(`/lesson/${next.id}`)}>
              Next: {next.title}
              <ChevronIcon size={18} />
            </Button>
          )}
          <Button variant="outline" onClick={() => navigate('/')}>
            <HomeIcon size={18} />
            Back home
          </Button>
        </div>
      </div>
    </div>
  );
}
