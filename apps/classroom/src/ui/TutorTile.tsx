import { TUTOR } from '@ai-tutor/persona';
import { CartoonAvatar, usePoseFor } from '../avatar/CartoonAvatar';
import { VideoAvatar } from '../avatar/VideoAvatar';
import type { ClipManifest } from '@ai-tutor/teacher-clone';

export type TutorMode = 'idle' | 'teaching' | 'listening';

/**
 * The tutor's window — a participant tile, the way Meet draws one, because a
 * teacher in a live class is a person in a call, not an icon on a card.
 *
 * `pip` floats over the board on a phone; `rail` sits at the top of the side
 * panel on wide screens. The ring is the class's state made visible: blue while
 * she teaches, green while the live tutor has the room, grey when idle.
 *
 * Abstract on purpose — a real character or viseme avatar replaces the inside
 * of this tile later without touching anything that uses it.
 */
export function TutorTile({
  mode,
  variant,
  clone,
}: {
  mode: TutorMode;
  variant: 'pip' | 'rail';
  /**
   * A real teacher, lip-dubbed. Absent — every ordinary class — the penguin
   * plays: he is Qrie own tutor, and a client engagement must not quietly
   * replace him. This is a second renderer, not a replacement.
   */
  clone?: {
    manifest: ClipManifest;
    baseUrl: string;
    beatId: string | null;
    /** What the caption calls them. Qrie tutor name under a real
     * teacher face is the kind of detail a client notices first. */
    name: string;
  };
}) {
  const listening = mode === 'listening';
  const active = mode !== 'idle';
  const pip = variant === 'pip';
  const pose = usePoseFor(mode);
  /** Whoever is actually teaching in this tile. */
  const who = clone?.name ?? TUTOR.name;

  return (
    <div
      aria-label={`${who} ${mode}`}
      className={`relative overflow-hidden rounded-[14px] bg-gradient-to-br from-[#3a332a] to-[#1c1915] grid place-items-center transition-colors ${
        pip ? 'w-[104px] h-[138px]' : 'w-full h-[180px] rounded-2xl'
      } border-[2.5px] ${
        listening ? 'border-stage-green' : active ? 'border-stage-blue' : 'border-stage-surface'
      }`}
    >
      <div
        className={`rounded-full grid place-items-center font-headline-md font-bold text-[#5c3a10] bg-[radial-gradient(circle_at_35%_30%,#ffd9a8,#f2a65a)] ${
          pip ? 'w-[60px] h-[60px] text-[28px]' : 'w-[84px] h-[84px] text-[38px]'
        }`}
      >
        {who[0]}
      </div>

      {/* Meera the cartoon — lipsync, blinks, gestures, all drawn in code.
          Aarav's call after seeing the photo-warp in a real class: a cartoon
          can ACT, a photograph can only be nudged. */}
      {clone ? (
        <VideoAvatar
          manifest={clone.manifest}
          baseUrl={clone.baseUrl}
          beatId={clone.beatId}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <CartoonAvatar pose={pose} className="absolute inset-0 w-full h-full" />
      )}

      {/* Sound bars: present while she is in the room, moving while the class is alive. */}
      {active && (
        <div className="absolute top-2 right-2 flex items-end gap-[2.5px] h-[14px]" aria-hidden>
          {[6, 13, 9, 12].map((h, i) => (
            <span
              key={i}
              className={`w-[3px] rounded-sm sound-bar ${listening ? 'bg-stage-green' : 'bg-stage-blue'}`}
              style={{ height: h, animationDelay: `${i * 0.18}s` }}
            />
          ))}
        </div>
      )}

      <span
        className={`absolute left-1.5 bottom-1.5 bg-black/55 text-white rounded-md font-label-sm font-semibold px-2 py-[3px] ${
          pip ? 'text-[10px]' : 'text-label-sm'
        }`}
      >
        {who}
      </span>
    </div>
  );
}
