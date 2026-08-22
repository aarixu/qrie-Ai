import { theme } from './theme';

export type AvatarMode = 'idle' | 'teaching' | 'listening';

/**
 * The tutor's presence: a clean circular badge that pulses while she speaks
 * and turns green while she listens in a live doubt. Deliberately abstract —
 * a real character/viseme avatar can replace this component later; it only
 * consumes `mode`.
 */
export function Avatar({ mode }: { mode: AvatarMode }) {
  const ring = mode === 'listening' ? theme.green : mode === 'teaching' ? theme.blue : theme.border;
  const core = mode === 'listening' ? theme.green : mode === 'teaching' ? theme.blue : theme.textFaint;
  return (
    <div
      aria-label={`tutor ${mode}`}
      style={{
        width: 62,
        height: 62,
        borderRadius: '50%',
        background: theme.bg,
        border: `3px solid ${ring}`,
        boxShadow: `0 2px 0 ${theme.border}`,
        display: 'grid',
        placeItems: 'center',
        transition: 'border-color 300ms',
      }}
    >
      <svg width={30} height={30} viewBox="0 0 30 30" style={{ display: 'block' }}>
        {/* a friendly "speaking" glyph: face dot + two sound arcs */}
        <circle cx={11} cy={15} r={6.5} fill={core} style={{ transition: 'fill 300ms' }}>
          {mode !== 'idle' && (
            <animate attributeName="r" values="6.5;5.4;6.5" dur="1.4s" repeatCount="indefinite" />
          )}
        </circle>
        <path
          d="M21 10.5a7 7 0 0 1 0 9M24 8a11 11 0 0 1 0 14"
          fill="none"
          stroke={core}
          strokeWidth={2.4}
          strokeLinecap="round"
          opacity={mode === 'idle' ? 0.35 : 0.9}
          style={{ transition: 'opacity 300ms, stroke 300ms' }}
        />
      </svg>
    </div>
  );
}
