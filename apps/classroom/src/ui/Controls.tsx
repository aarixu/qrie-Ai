import { theme, chunky, outlined } from './theme';
import { HandIcon, PauseIcon, PlayIcon } from './icons';

export interface ControlsProps {
  playing: boolean;
  canRaiseHand: boolean;
  onPlayPause(): void;
  onRaiseHand(): void;
}

/**
 * The footer action bar — always visible, like every established learning
 * app's lesson footer. Two actions only: play/pause (secondary) and the
 * product's one important button, RAISE HAND (primary green, biggest target).
 */
export function Controls({ playing, canRaiseHand, onPlayPause, onRaiseHand }: ControlsProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px calc(12px + env(safe-area-inset-bottom))',
        background: theme.bg,
        borderTop: `2px solid ${theme.border}`,
      }}
    >
      <button
        onClick={onPlayPause}
        aria-label={playing ? 'pause class' : 'play class'}
        style={{
          ...outlined(),
          width: 54,
          height: 50,
          display: 'grid',
          placeItems: 'center',
          color: theme.textMuted,
        }}
      >
        {playing ? <PauseIcon /> : <PlayIcon style={{ marginLeft: 2 }} />}
      </button>

      <button
        onClick={onRaiseHand}
        disabled={!canRaiseHand}
        style={{
          ...(canRaiseHand
            ? chunky(theme.green, theme.greenDark)
            : { ...chunky('#e5e5e5', '#d0d0d0'), color: theme.textFaint, cursor: 'default' }),
          flex: 1,
          minHeight: 50,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 9,
        }}
      >
        <HandIcon size={19} />
        Raise hand
      </button>
    </div>
  );
}
