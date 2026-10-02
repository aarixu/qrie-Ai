import { useState } from 'react';
import { TUTOR } from '@ai-tutor/persona';
import { CartoonAvatar, usePoseFor } from '../avatar/CartoonAvatar';
import { HumanAvatar, canDrawHuman } from '../avatar/HumanAvatar';
import { VideoAvatar } from '../avatar/VideoAvatar';
import type { ClipManifest } from '@ai-tutor/teacher-clone';

export type TutorMode = 'idle' | 'teaching' | 'listening';

/**
 * The tutor's window — a participant tile, the way Meet draws one, because a
 * teacher in a live class is a person in a call, not an icon on a card.
 *
 * `pip` floats over the board on a phone held sideways; `rail` sits at the top
 * of the side panel on wide screens; `fill` takes the box it is given — the
 * room under the board on a phone held upright (canvas C2). The ring is the
 * class's state made visible: blue while she teaches, green while the live
 * tutor has the room, grey when idle.
 *
 * Meera in 3D sits in a room — a warm, out-of-focus study (Aarav, 2026-10-02:
 * "a normal background like a drawing room", not tied to the topic), the way a
 * tutor on a video call is in one. Her renderer draws with a transparent clear
 * (HumanAvatar), so the room is simply the tile's own background.
 *
 * A RENDERED room, not a photograph (Aarav, the same evening: "avatar 3d meta
 * human style hai, to bg bhi aisa hi hona chahiye"): a 3D character in front
 * of a photo looks pasted on. Made by tools/avatar/background.mjs.
 */
const ROOM = `${import.meta.env.BASE_URL}avatars/backgrounds/room3d.webp`;

export function TutorTile({
  mode,
  variant,
  clone,
}: {
  mode: TutorMode;
  variant: 'pip' | 'rail' | 'fill';
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
  /** Meera in 3D has arrived; until then the letter disc holds her place. */
  const [humanReady, setHumanReady] = useState(false);
  /** She is drawn in 3D here, so she stands in her room. */
  const human = !clone && canDrawHuman();

  return (
    <div
      aria-label={`${who} ${mode}`}
      data-room={human ? 'study' : undefined}
      style={human ? { backgroundImage: `url(${ROOM})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
      className={`relative overflow-hidden rounded-[14px] bg-gradient-to-br from-[#3a332a] to-[#1c1915] grid place-items-center transition-colors ${
        pip ? 'w-[104px] h-[138px]' : variant === 'fill' ? 'w-full h-full rounded-2xl' : 'w-full h-[180px] rounded-2xl'
      } border-[2.5px] ${
        listening ? 'border-stage-green' : active ? 'border-stage-blue' : 'border-stage-surface'
      }`}
    >
      {!humanReady && (
        <div
          className={`rounded-full grid place-items-center font-headline-md font-bold text-[#5c3a10] bg-[radial-gradient(circle_at_35%_30%,#ffd9a8,#f2a65a)] ${
            pip ? 'w-[60px] h-[60px] text-[28px]' : 'w-[84px] h-[84px] text-[38px]'
          }`}
        >
          {who[0]}
        </div>
      )}

      {/* Meera in 3D (Aarav's pick, 2026-10-01): a rigged human who lip-syncs
          and gestures with mocap, drawn on the student's device. She can ACT,
          which is why the photo-warp lost. The letter disc above holds her
          place until her model arrives; a browser with no WebGL keeps the
          penguin. */}
      {clone ? (
        <VideoAvatar
          manifest={clone.manifest}
          baseUrl={clone.baseUrl}
          beatId={clone.beatId}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : human ? (
        <HumanAvatar pose={pose} className="absolute inset-0 w-full h-full" onReady={() => setHumanReady(true)} />
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
