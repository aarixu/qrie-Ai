import { theme } from './theme';

export interface WaveformProps {
  /** 0..1 microphone energy. Ignored when `source` is 'tutor' — her level is not measured here. */
  level: number;
  /**
   * Whose voice the bars stand for. The two states must never be confusable:
   * green bars that follow the mic mean "we can hear you", blue bars that move
   * on their own mean "she is talking, listen".
   */
  source: 'mic' | 'tutor';
}

/**
 * A seven-bar voice meter. Deliberately not a canvas: seven spans with a
 * scaleY transform cost nothing to run on a cheap phone, and the whole thing
 * survives a re-render at 30fps without touching layout.
 */

// A fixed profile, not random heights — random reads as noise, a centre-weighted
// shape reads as a voice. Also keeps SSR output deterministic.
const PROFILE = [0.45, 0.72, 0.92, 1, 0.92, 0.72, 0.45];

/** Never fully collapse: a flat line looks broken, a low idle line looks alive. */
const FLOOR = 0.14;

const WAVEFORM_CSS = `
@keyframes waveform-talk {
  from { transform: scaleY(0.28); }
  to   { transform: scaleY(1); }
}
.waveform-bar {
  transform-origin: center;
  transition: transform 90ms linear;
}
.waveform-bar--tutor {
  animation: waveform-talk 620ms ease-in-out infinite alternate;
}
@media (prefers-reduced-motion: reduce) {
  .waveform-bar { transition: none; }
  .waveform-bar--tutor { animation: none; transform: scaleY(0.6); }
}
`;

export function Waveform({ level, source }: WaveformProps) {
  const tutor = source === 'tutor';
  // Mic energy spends most of its time near the bottom of the range, so a
  // linear map leaves the bars looking dead while the student is speaking.
  const energy = Math.sqrt(Math.min(1, Math.max(0, level)));

  return (
    <div
      aria-hidden
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, height: 26 }}
    >
      <style>{WAVEFORM_CSS}</style>
      {PROFILE.map((weight, i) => (
        <span
          key={i}
          className={tutor ? 'waveform-bar waveform-bar--tutor' : 'waveform-bar'}
          style={{
            flex: 'none', // never let a narrow sheet shave the bars to slivers
            width: 4,
            height: '100%',
            borderRadius: 3,
            background: tutor ? theme.blue : theme.green,
            // The tutor's bars are driven by the keyframes; setting an inline
            // transform here would out-rank the animation and freeze them.
            ...(tutor
              ? { animationDelay: `${i * 90}ms` }
              : { transform: `scaleY(${(FLOOR + energy * weight * (1 - FLOOR)).toFixed(3)})` }),
          }}
        />
      ))}
    </div>
  );
}
