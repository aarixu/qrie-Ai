import { Icon } from './Icon';

export type TutorMode = 'idle' | 'teaching' | 'listening';

/**
 * The tutor's presence on the lesson canvas: a circular badge that sends a
 * ring pulsing outward while she speaks, and turns green while she is
 * listening in a live doubt. Abstract on purpose — a real character or viseme
 * avatar can replace the inside of this badge later without touching anything
 * that uses it.
 */
export function TutorBadge({ mode }: { mode: TutorMode }) {
  const listening = mode === 'listening';
  const active = mode !== 'idle';

  return (
    <div className="relative flex items-center justify-center" aria-label={`Tutor ${mode}`}>
      {active && (
        <div
          className={`absolute inset-0 rounded-full speaking-indicator ${
            listening ? 'bg-[#16a34a]/25' : 'bg-primary/25'
          }`}
        />
      )}
      <div
        className={`relative w-16 h-16 rounded-full border-4 border-surface-container-lowest shadow-md grid place-items-center z-10 transition-colors ${
          listening ? 'bg-[#16a34a]' : active ? 'bg-primary' : 'bg-surface-variant'
        }`}
      >
        <Icon
          name={listening ? 'hearing' : 'record_voice_over'}
          filled
          className={`text-[26px] ${active ? 'text-white' : 'text-on-surface-variant'}`}
        />
      </div>
    </div>
  );
}
