import { useEffect, useRef } from 'react';
import { CLIP_DIR, type ClipManifest } from '@ai-tutor/teacher-clone';
import { progress } from './avatarBus';
import { clipFor } from './clips';

/**
 * A REAL TEACHER, LIP-DUBBED.
 *
 * The second renderer behind the seam the penguin already uses: it asks the
 * bus what line is being spoken and shows the take rendered for exactly
 * those words. Between lines — and whenever there is no honest take — it
 * holds the idle loop, which reads as the teacher listening rather than as
 * a freeze.
 *
 * TWO DELIBERATE OMISSIONS.
 *
 * The clip is muted. Its own audio track says the same words the voice
 * pipeline is already speaking, a fraction of a second apart, and two of the
 * same voice is worse than one.
 *
 * The clip is never seeked to chase the audio. Both were made from the same
 * synthesised line and start together; seeking a video element every frame
 * costs more than the drift it would fix, on exactly the low-end hardware
 * this has to run on.
 */
export function VideoAvatar({
  manifest,
  baseUrl,
  beatId,
  className,
}: {
  manifest: ClipManifest;
  /** Where this lesson's folder lives, e.g. "/class9-tissues". */
  baseUrl: string;
  /** The beat the class is on, from the player. */
  beatId: string | null;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const idleUrl = `${baseUrl}/${CLIP_DIR}/${manifest.idle}`;
  /** What the element is already playing, so a src is set once per change. */
  const showing = useRef('');

  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const el = videoRef.current;
      if (!el) return;

      const p = progress();
      const speaking =
        p.text !== '' && beatId !== null ? clipFor(manifest, baseUrl, beatId, p.text) : null;
      const want = speaking ?? idleUrl;
      if (want === showing.current) return;

      showing.current = want;
      el.src = want;
      // The idle loop runs until the next line; a spoken take plays once and
      // holds its last frame, which the next tick replaces.
      el.loop = want === idleUrl;
      void el.play().catch(() => undefined);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [manifest, baseUrl, beatId, idleUrl]);

  return (
    <video ref={videoRef} className={className} muted playsInline autoPlay aria-hidden />
  );
}
