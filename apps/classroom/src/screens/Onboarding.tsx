import { useNavigate } from 'react-router-dom';
import { settingsStore } from '../stores/settings';
import { theme } from '../ui/theme';

const CLASSES = [6, 7, 8, 9, 10, 11, 12];

/**
 * First run: pick your class. One question, seven big targets, straight into
 * the app. The choice personalises Home and later feeds the lesson designer's
 * language level.
 */
export function Onboarding() {
  const navigate = useNavigate();

  const pick = (klass: number) => {
    settingsStore.update((s) => ({ ...s, klass }));
    navigate('/', { replace: true });
  };

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
      <div style={{ width: '100%', maxWidth: 420, textAlign: 'center' }}>
        <h1 style={{ color: theme.text, font: `900 28px ${theme.font}`, margin: '0 0 6px' }}>
          Which class are you in?
        </h1>
        <p style={{ color: theme.textMuted, font: `700 15px ${theme.font}`, margin: '0 0 26px' }}>
          Your classes will match your level. You can change this anytime.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 12 }}>
          {CLASSES.map((k) => (
            <button
              key={k}
              onClick={() => pick(k)}
              style={{
                minHeight: 76,
                borderRadius: 16,
                border: `2px solid ${theme.border}`,
                borderBottomWidth: 4,
                background: theme.bg,
                cursor: 'pointer',
                display: 'grid',
                placeItems: 'center',
                gap: 0,
                transition: 'background 150ms, border-color 150ms',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = theme.green;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = theme.border;
              }}
            >
              <span style={{ color: theme.textFaint, font: `800 11px ${theme.font}`, letterSpacing: 0.8 }}>
                CLASS
              </span>
              <span style={{ color: theme.text, font: `900 26px ${theme.font}` }}>{k}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
