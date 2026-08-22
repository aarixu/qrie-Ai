import { useNavigate } from 'react-router-dom';
import { progressStore, computeStreak } from '../stores/progress';
import { settingsStore } from '../stores/settings';
import { doubtLogStore } from '../stores/doubtLog';
import { useStore } from '../stores/localStore';
import { theme } from '../ui/theme';
import { Button } from '../ui/Button';
import { BackIcon, CheckIcon, FlameIcon, HandIcon } from '../ui/icons';

const CLASSES = [6, 7, 8, 9, 10, 11, 12];

/** Profile: your class, your numbers, and the one dangerous button (reset). */
export function Profile() {
  const navigate = useNavigate();
  const progress = useStore(progressStore);
  const settings = useStore(settingsStore);
  const doubts = useStore(doubtLogStore);

  const completed = Object.values(progress.lessons).filter((l) => l.completedAt).length;
  const streak = computeStreak(progress);

  const stat = (icon: React.ReactNode, value: string, label: string, color: string) => (
    <div
      style={{
        flex: 1,
        minWidth: 120,
        padding: 14,
        borderRadius: 16,
        border: `2px solid ${theme.border}`,
        borderBottomWidth: 4,
        display: 'grid',
        gap: 2,
        justifyItems: 'center',
      }}
    >
      <span style={{ color }}>{icon}</span>
      <span style={{ color: theme.text, font: `900 22px ${theme.font}` }}>{value}</span>
      <span style={{ color: theme.textMuted, font: `700 12px ${theme.font}` }}>{label}</span>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: theme.bg, overflowY: 'auto', fontFamily: theme.font }}>
      <div style={{ maxWidth: 600, margin: '0 auto', padding: 'calc(16px + env(safe-area-inset-top)) 18px 40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <button
            onClick={() => navigate('/')}
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
          <h1 style={{ color: theme.text, font: `900 22px ${theme.font}`, margin: 0 }}>Profile</h1>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 26 }}>
          {stat(<CheckIcon size={22} />, String(completed), 'lessons done', theme.green)}
          {stat(<FlameIcon size={22} />, String(streak), 'day streak', '#ff9600')}
          {stat(<HandIcon size={22} />, String(doubts.length), 'doubts asked', theme.blue)}
        </div>

        {/* Class picker */}
        <div
          style={{
            color: theme.textFaint,
            font: `800 12px ${theme.font}`,
            letterSpacing: 1,
            textTransform: 'uppercase',
            marginBottom: 10,
          }}
        >
          My class
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 30 }}>
          {CLASSES.map((k) => {
            const active = settings.klass === k;
            return (
              <button
                key={k}
                onClick={() => settingsStore.update((s) => ({ ...s, klass: k }))}
                style={{
                  minWidth: 52,
                  minHeight: 44,
                  borderRadius: 12,
                  border: `2px solid ${active ? theme.green : theme.border}`,
                  borderBottomWidth: 4,
                  background: active ? '#eaffdd' : theme.bg,
                  color: active ? theme.greenDark : theme.textMuted,
                  font: `800 15px ${theme.font}`,
                  cursor: 'pointer',
                  transition: 'border-color 150ms, background 150ms',
                }}
              >
                {k}
              </button>
            );
          })}
        </div>

        <Button
          variant="outline"
          onClick={() => {
            if (confirm('Reset all progress? This cannot be undone.')) {
              progressStore.set({ lessons: {}, lastLessonId: null });
              doubtLogStore.set([]);
            }
          }}
          style={{ color: theme.red, borderColor: '#ffd6d6' }}
        >
          Reset progress
        </Button>
      </div>
    </div>
  );
}
