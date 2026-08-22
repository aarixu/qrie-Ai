import { theme } from './theme';

export type AvatarMode = 'idle' | 'teaching' | 'listening';

/**
 * The tutor's visual presence. Deliberately abstract (no face to get wrong):
 * a warm disc that breathes while teaching and shifts color while listening
 * in a live doubt session. A real viseme avatar can replace this later without
 * touching anything else — it only consumes `mode`.
 */
export function Avatar({ mode }: { mode: AvatarMode }) {
  const ring =
    mode === 'listening' ? theme.good : mode === 'teaching' ? theme.accent : theme.textMuted;
  return (
    <div
      aria-label={`tutor ${mode}`}
      style={{
        width: 64,
        height: 64,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        background: theme.surface,
        border: `2px solid ${ring}`,
        boxShadow: mode === 'idle' ? 'none' : `0 0 22px ${ring}55`,
        transition: 'border-color 300ms, box-shadow 300ms',
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          background: ring,
          opacity: 0.9,
          animation: mode === 'idle' ? 'none' : 'tutor-breathe 1.6s ease-in-out infinite',
        }}
      />
      <style>{`@keyframes tutor-breathe { 0%,100% { transform: scale(1); } 50% { transform: scale(0.82); } }`}</style>
    </div>
  );
}
