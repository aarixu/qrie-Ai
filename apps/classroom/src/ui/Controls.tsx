import { theme } from './theme';
import { HandIcon, PauseIcon, PlayIcon } from './icons';

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
 * The chalk tray. A real blackboard's wooden ledge is where the chalk and the
 * duster live — here it holds the class controls. Auto-hide is the PARENT's
 * job (it owns the touch events); this component only renders the `visible`
 * it is given.
 *
 * Raise-hand is the product's one important button: biggest target, yellow
 * chalk, always the same place.
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
        padding: '10px 14px calc(10px + env(safe-area-inset-bottom))',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        background: theme.woodGrad,
        borderTop: `1px solid rgba(255,220,180,0.22)`,
        boxShadow: '0 -8px 24px rgba(0,0,0,0.45)',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(105%)',
        pointerEvents: visible ? 'auto' : 'none',
        transition: 'opacity 250ms, transform 250ms',
      }}
    >
      <button
        onClick={onPlayPause}
        aria-label={playing ? 'pause class' : 'play class'}
        style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          border: `2px solid rgba(238,241,234,0.35)`,
          background: 'rgba(13,20,17,0.55)',
          color: theme.chalk,
          display: 'grid',
          placeItems: 'center',
          cursor: 'pointer',
          transition: 'background 200ms, border-color 200ms',
        }}
      >
        {playing ? <PauseIcon /> : <PlayIcon style={{ marginLeft: 2 }} />}
      </button>

      {/* Progress: pieces of chalk lined up on the tray, one per beat. */}
      <div
        aria-label={`beat ${beatIndex + 1} of ${beatCount}`}
        style={{ display: 'flex', gap: 6, flex: 1, justifyContent: 'center', alignItems: 'center' }}
      >
        {Array.from({ length: beatCount }, (_, i) => (
          <div
            key={i}
            style={{
              width: i === beatIndex ? 22 : 10,
              height: 5,
              borderRadius: 2.5,
              background: i <= beatIndex ? theme.accent : 'rgba(238,241,234,0.28)',
              boxShadow: i === beatIndex ? `0 0 8px ${theme.accent}66` : 'none',
              transition: 'width 250ms, background 250ms',
            }}
          />
        ))}
      </div>

      <button
        onClick={onRaiseHand}
        disabled={!canRaiseHand}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minHeight: 48,
          padding: '10px 20px',
          borderRadius: 26,
          border: 'none',
          background: canRaiseHand ? theme.accent : 'rgba(238,241,234,0.14)',
          color: canRaiseHand ? theme.accentInk : theme.chalkDim,
          font: `600 15px ${theme.font}`,
          cursor: canRaiseHand ? 'pointer' : 'default',
          boxShadow: canRaiseHand ? `0 3px 0 #b98f22, 0 6px 18px ${theme.accent}33` : 'none',
          transition: 'background 200ms, box-shadow 200ms',
        }}
      >
        <HandIcon size={19} />
        Doubt hai
      </button>
    </div>
  );
}
