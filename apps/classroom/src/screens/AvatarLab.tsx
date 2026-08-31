import { useState } from 'react';
import { createStreamingTts } from '@ai-tutor/voice';
import { PhotoAvatar, type AvatarPose } from '../avatar/PhotoAvatar';
import { announceLine, avatarAudio } from '../avatar/avatarBus';

/**
 * THE AVATAR LAB — /avatar-lab, dev-facing, like /canvas-lab.
 *
 * One big instance of the exact component the classroom tile uses, with the
 * rig boxes drawn on top, pose buttons, and a real spoken line through the
 * real streaming voice. Calibrating the rig is: look, nudge rig.ts, look.
 */

const POSES: AvatarPose[] = ['idle', 'point', 'explain', 'greet', 'think', 'listen', 'cheer'];

const LINE =
  'Hello! Watch my lips move while I speak this whole sentence, and my eyes blink on their own.';

const tts = createStreamingTts({
  endpoint: '/api/speech',
  model: 'deepgram/aura-2',
  voice: 'aura-2-thalia-en',
  audio: avatarAudio,
});

export function AvatarLab() {
  const [pose, setPose] = useState<AvatarPose>('idle');
  const [rig, setRig] = useState(true);

  const speak = async (): Promise<void> => {
    announceLine(LINE);
    await tts.speak(LINE);
    announceLine('');
  };

  return (
    <div className="min-h-screen bg-stage text-stage-ink p-6 flex flex-col items-center gap-4 font-body-md">
      <h1 className="font-headline-md text-[20px] font-semibold">Avatar lab</h1>
      <div className="w-[380px] h-[500px] rounded-2xl overflow-hidden bg-[#23246e] relative">
        <PhotoAvatar pose={pose} debugRig={rig} className="w-full h-full" />
      </div>
      <div className="flex flex-wrap gap-2 justify-center max-w-[420px]">
        {POSES.map((p) => (
          <button
            key={p}
            onClick={() => setPose(p)}
            className={`rounded-full px-4 py-2 font-label-md text-label-md font-semibold ${
              pose === p ? 'bg-stage-blue text-stage' : 'bg-stage-surface text-stage-ink'
            }`}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => void speak()}
          className="rounded-full bg-stage-primary text-on-stage-primary px-5 py-2.5 font-label-md text-label-md font-semibold"
        >
          Speak a test line
        </button>
        <button
          onClick={() => setRig((r) => !r)}
          className="rounded-full bg-stage-surface px-5 py-2.5 font-label-md text-label-md font-semibold"
        >
          {rig ? 'Hide rig' : 'Show rig'}
        </button>
      </div>
      <p className="text-stage-ink-dim text-[13px] max-w-[420px] text-center">
        Photos live in content/avatar/ — meera.png first, poses optional. The green boxes are the
        warp rig from avatar/rig.ts; they should sit on her mouth, jaw and eyes.
      </p>
    </div>
  );
}
