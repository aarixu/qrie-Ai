import { theme } from './theme';

export interface ControlsProps {
  visible: boolean;
  playing: boolean;
  beatIndex: number;
  beatCount: number;
  canRaiseHand: boolean;
  onPlayPause(): void;
  onRaiseHand(): void;
}

/**
 * The bottom control bar. Auto-hide is the PARENT's job (it owns the touch
 * events); this component only renders the `visible` it is given.
 *
 * Raise-hand is the product's one important button, so it is the biggest
 * target and stays enabled exactly when the handoff can accept it.
 */
export function Controls({
  visible,
  playing,
  beatIndex,
  beatCount,
  canRaiseHand,
  onPlayPause,
  onRaiseHand,
}: ControlsProps) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '14px 16px calc(14px + env(safe-area-inset-bottom))',
        background: 'linear-gradient(transparent, rgba(9,10,14,0.92))',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        transition: 'opacity 300ms',
      }}
    >
      <button
        onClick={onPlayPause}
        aria-label={playing ? 'pause' : 'play'}
        style={{
          width: 46,
          height: 46,
          borderRadius: '50%',
          border: `1px solid ${theme.surfaceBorder}`,
          background: theme.surface,
          color: theme.text,
          fontSize: 17,
          cursor: 'pointer',
        }}
      >
        {playing ? '⏸' : '▶'}
      </button>

      {/* beat progress dots — a class has beats, not a scrubber timeline */}
      <div style={{ display: 'flex', gap: 5, flex: 1, justifyContent: 'center' }}>
        {Array.from({ length: beatCount }, (_, i) => (
          <div
            key={i}
            style={{
              width: i === beatIndex ? 16 : 6,
              height: 6,
              borderRadius: 3,
              background: i <= beatIndex ? theme.accent : theme.surfaceBorder,
              transition: 'width 250ms, background 250ms',
            }}
          />
        ))}
      </div>

      <button
        onClick={onRaiseHand}
        disabled={!canRaiseHand}
        style={{
          padding: '12px 18px',
          borderRadius: 24,
          border: 'none',
          background: canRaiseHand ? theme.accent : theme.surface,
          color: canRaiseHand ? '#1a1205' : theme.textMuted,
          font: `600 14px ${theme.font}`,
          cursor: canRaiseHand ? 'pointer' : 'default',
          transition: 'background 250ms',
        }}
      >
        ✋ Doubt hai
      </button>
    </div>
  );
}
