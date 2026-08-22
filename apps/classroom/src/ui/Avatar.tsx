import { theme } from './theme';

export type AvatarMode = 'idle' | 'teaching' | 'listening';

/**
 * The tutor's presence: a chalk portrait sketched on the board's corner —
 * a hand-drawn circle with a warm core that breathes while she teaches and
 * turns mint while she listens in a live doubt. Deliberately abstract (no
 * face to get wrong); a real viseme avatar can replace this component later —
 * it only consumes `mode`.
 */
export function Avatar({ mode }: { mode: AvatarMode }) {
  const ink = mode === 'listening' ? theme.good : mode === 'teaching' ? theme.accent : theme.chalkDim;
  return (
    <div aria-label={`tutor ${mode}`} style={{ position: 'relative', width: 66, height: 66 }}>
      <svg width={66} height={66} viewBox="0 0 66 66" style={{ display: 'block' }}>
        {/* chalk circle, drawn slightly rough */}
        <circle
          cx={33}
          cy={33}
          r={29}
          fill="rgba(238,241,234,0.04)"
          stroke={ink}
          strokeWidth={2.2}
          strokeDasharray="46 5 34 4 52 6"
          strokeLinecap="round"
          style={{ transition: 'stroke 300ms' }}
        />
        <circle cx={33} cy={33} r={13} fill={ink} opacity={0.9} style={{ transition: 'fill 300ms' }}>
          {mode !== 'idle' && (
            <animate attributeName="r" values="13;10.5;13" dur="1.6s" repeatCount="indefinite" />
          )}
        </circle>
      </svg>
      {mode !== 'idle' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            boxShadow: `0 0 26px ${ink}44`,
            pointerEvents: 'none',
            transition: 'box-shadow 300ms',
          }}
        />
      )}
    </div>
  );
}
