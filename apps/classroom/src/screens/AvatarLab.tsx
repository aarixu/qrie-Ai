import { useEffect, useState } from 'react';
import { createStreamingTts } from '@ai-tutor/voice';
import { CartoonAvatar, type AvatarPose } from '../avatar/CartoonAvatar';
import { HumanAvatar } from '../avatar/HumanAvatar';
import { nominalMs, visemeTimeline } from '../avatar/visemes';
import { announceLine, avatarAudio } from '../avatar/avatarBus';

/**
 * THE AVATAR LAB — /avatar-lab, dev-facing, like /canvas-lab.
 *
 * One big instance of the exact component the classroom tile uses, with
 * pose buttons and a real spoken line through the real streaming voice, so
 * lipsync, blinks and gestures are judged at full size before a class is.
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

type Face = 'penguin' | 'f02';

export function AvatarLab() {
  const [pose, setPose] = useState<AvatarPose>('idle');
  const [face, setFace] = useState<Face>('penguin');
  const [stats, setStats] = useState('');

  // Meera 3D's numbers, read off her lab handle once a second.
  useEffect(() => {
    if (face !== 'f02') return;
    const id = setInterval(() => {
      const s = window.__humanAvatar?.stats;
      setStats(s ? `load ${s.loadMs ?? '…'} ms · ${s.fps} fps · ${s.clip ?? 'T-pose'}` : '');
    }, 1000);
    return () => clearInterval(id);
  }, [face]);

  // The mouth on the line's own timeline, no voice needed.
  const mouthOnly = (): void => {
    announceLine(LINE);
    setTimeout(() => announceLine(''), nominalMs(visemeTimeline(LINE)));
  };

  const speak = async (): Promise<void> => {
    announceLine(LINE);
    await tts.speak(LINE);
    announceLine('');
  };

  return (
    <div className="min-h-screen bg-stage text-stage-ink p-6 flex flex-col items-center gap-4 font-body-md">
      <h1 className="font-headline-md text-[20px] font-semibold">Avatar lab</h1>
      <div className="flex gap-2">
        {(['penguin', 'f02'] as Face[]).map((f) => (
          <button
            key={f}
            onClick={() => setFace(f)}
            className={`rounded-full px-4 py-2 font-label-md text-label-md font-semibold ${
              face === f ? 'bg-stage-blue text-stage' : 'bg-stage-surface text-stage-ink'
            }`}
          >
            {f === 'penguin' ? 'Penguin' : 'Meera 3D (F02)'}
          </button>
        ))}
      </div>
      <div className="w-[380px] h-[460px] rounded-2xl overflow-hidden bg-gradient-to-br from-[#3f41c8] to-[#23246e]">
        {face === 'penguin' ? (
          <CartoonAvatar pose={pose} className="w-full h-full" />
        ) : (
          <HumanAvatar pose={pose} className="w-full h-full" debug />
        )}
      </div>
      {face === 'f02' && <p className="text-stage-ink-dim text-[13px]">{stats}</p>}
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
      <button
        onClick={() => void speak()}
        className="rounded-full bg-stage-primary text-on-stage-primary px-5 py-2.5 font-label-md text-label-md font-semibold"
      >
        Speak a test line
      </button>
      <button
        onClick={mouthOnly}
        className="rounded-full bg-stage-surface text-stage-ink px-5 py-2.5 font-label-md text-label-md font-semibold"
      >
        Move the mouth (no voice)
      </button>
      <p className="text-stage-ink-dim text-[13px] max-w-[420px] text-center">
        The same component the classroom tile renders — drawn in code, no assets. Poses move his
        flippers only; the face never jumps.
      </p>
    </div>
  );
}
