import { hashNarration } from '@ai-tutor/voice';
import { CLIP_DIR, type ClipManifest } from '@ai-tutor/teacher-clone';

/**
 * WHICH TAKE PLAYS, IF ANY.
 *
 * Null is the ordinary answer, not an error: a beat nobody rendered, or a
 * beat whose words changed since it was rendered. Both mean the idle loop —
 * the teacher listening — which is honest. A take whose lips say last week's
 * sentence, under a real person's face, is not.
 *
 * The hash is the recording's own (`hashNarration`), so a narration line
 * re-wrapped in lesson.json still matches the clip rendered from it.
 */
export function clipFor(
  manifest: ClipManifest,
  /** Where this lesson's folder lives, e.g. "/class9-tissues". */
  baseUrl: string,
  beatId: string,
  narration: string,
): string | null {
  const entry = manifest.beats[beatId];
  if (!entry) return null;
  if (entry.hash !== hashNarration(narration)) return null;
  return `${baseUrl}/${CLIP_DIR}/${entry.file}`;
}
