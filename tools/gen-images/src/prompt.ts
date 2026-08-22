import type { Element, Lesson } from '../../../packages/lesson-format/src/types.ts';

/**
 * Turning a lesson's image element into a generation prompt.
 *
 * Two constraints matter more than anything about style:
 *  - NO text inside the image. The canvas draws its own labels, and generated
 *    lettering is both unreliable and impossible to translate later.
 *  - The app's palette, on white. Generated art that fights the surrounding
 *    SVG reads as pasted-in clip art.
 */

const PALETTE =
  'a limited palette of bright grass green, bright sky blue, warm red and dark charcoal ink';

/** Reduce w:h to a clean ratio the model can act on ("4:3" beats "480:360"). */
export function aspectRatio(w: number, h: number): string {
  const round = (n: number) => Math.max(1, Math.round(n));
  const a = round(w);
  const b = round(h);
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
  const d = gcd(a, b);
  return `${a / d}:${b / d}`;
}

type ImageElement = Extract<Element, { kind: 'image' }>;

export function buildImagePrompt(el: ImageElement, lesson: Lesson): string {
  // Context: what the tutor is saying when this picture is on screen. It keeps
  // the artwork about the same idea as the narration.
  const firstBeat = lesson.beats.find((b) => b.show.includes(el.id));

  return [
    `Flat educational illustration for a school science lesson: ${el.alt}.`,
    `Lesson context: "${lesson.title}".`,
    firstBeat ? `It appears while the teacher says: "${firstBeat.narration}"` : '',
    '',
    'STYLE REQUIREMENTS:',
    '- Clean flat vector illustration, bold simple shapes, confident outlines.',
    '- Pure white background.',
    `- Use ${PALETTE}.`,
    '- ABSOLUTELY NO text, letters, numbers, labels or captions anywhere in the image. The app draws its own labels on top.',
    '- Single centred subject with generous margins around it.',
    `- Composition aspect ratio ${aspectRatio(el.w, el.h)}.`,
    '- Clear enough to read on a small phone screen.',
  ]
    .filter(Boolean)
    .join('\n');
}
