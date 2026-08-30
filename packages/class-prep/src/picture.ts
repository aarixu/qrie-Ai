import type { ImagePart } from '@ai-tutor/lesson-format';


/**
 * A PICTURE OF A REAL THING, AND KNOWING WHERE ITS PARTS ARE.
 *
 * The icon library has no half-cut kidney and never will, and no SVG the
 * artist writes by hand is going to look like one. For subjects that have to
 * LOOK right — an organ, a cross-section, a landscape — the honest answer is
 * to generate a picture.
 *
 * It is generated on white so it sits ON the board rather than in a panel.
 * That is what makes the rest possible: once the kidney is up there, the tutor
 * works on it the way a teacher works on a chart she has pinned up. She
 * circles the cortex, arrows to the pelvis, writes beside each — and needs no
 * further image for minutes.
 *
 * Which means something has to know where the cortex IS. That is not a layout
 * decision and it cannot be guessed from the brief: it is a fact about the
 * picture that was actually made, and the only way to learn it is to look. So
 * a second call looks, and returns each named part as a fraction of the
 * picture. Layout still owns every coordinate on the board; this owns only
 * what is true inside one image.
 */

/** What one picture should be, and which parts of it the lesson will point at. */
export interface PictureBrief {
  id: string;
  /** Read to a student who cannot see it. */
  alt: string;
  /** What to draw, in the planner's words. */
  brief: string;
  /** The parts the lesson intends to mark. May be empty. */
  parts: readonly string[];
}

export interface PictureResult {
  /** A `data:` URL, ready to inline. */
  src: string;
  parts: ImagePart[];
  /** How many times it had to be drawn, so a prep report can say so. */
  attempts: number;
  /** Whether words are still printed on the picture we settled for. */
  hasText: boolean;
}

/** Talks to a model that returns images rather than words. */
export interface ImageAdapter {
  draw(prompt: string): Promise<string | null>;
}

/** Looks at a picture and answers questions about it. */
export interface VisionAdapter {
  look(imageUrl: string, system: string, user: string): Promise<string>;
}

export function picturePrompt(brief: PictureBrief): string {
  // The no-text rule goes FIRST, because that is where a model weighs it
  // heaviest, and because it is the rule that matters most here: a teacher
  // writes every label on this board by hand, and printed ones both fight
  // with her writing and give away her next line.
  return `An UNLABELLED educational illustration. No words, letters, numbers,
labels, leader lines, captions, keys or watermarks anywhere in the image — not
one. A teacher will write every label herself.

Subject: ${brief.brief}

Draw it as a clear illustration for a school textbook: flat colours, clean
bold outlines, everything a student needs to recognise it.

EXACTLY ONE of the subject, alone, centred, filling most of the frame. Not a
pair, not a mirrored pair, not a before-and-after, not a grid, not a series.
If the subject is one of an organ the body has two of, draw ONE of them.

Pure white background (#ffffff), edge to edge. No shadow, no vignette, no
border, no frame, no background scene.`;
}

export const PART_FINDER_SYSTEM = `You are looking at one picture and saying where
named parts of it are.

Answer with ONE JSON object mapping each part to a box, as FRACTIONS of the
picture: {"cortex": {"x": 0.12, "y": 0.20, "w": 0.30, "h": 0.25}}

- x and y are the box's top-left corner; 0,0 is the picture's top-left corner
  and 1,1 its bottom-right.
- Box the part TIGHTLY, around that part ONLY. The box becomes a circle drawn
  on the board, so a box that swallows the whole subject circles everything and
  points at nothing. A part of an organ is usually a fifth to a third of the
  picture across — if your box is wider than half the picture, it is wrong.
- If the picture happens to contain more than one of the subject, box the part
  on ONE of them, not a box spanning both.
- If a part is genuinely not visible in this picture, give it null rather than
  a guess. A confident circle around the wrong thing teaches the wrong thing.

Also include "_hasText": true or false — true if the picture has ANY words,
letters or numbers printed on it, including labels with leader lines. The
teacher writes every label on the board herself, so printed ones are a fault
in the picture.`;

export function partFinderUser(parts: readonly string[]): string {
  return `Find these parts:\n${parts.map((p) => `- ${p}`).join('\n')}`;
}

const stripFence = (s: string): string =>
  s
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

const fraction = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= -0.05 && v <= 1.05 ? v : null;

/**
 * Read the part boxes out of whatever the model sent.
 *
 * Anything malformed, out of range, or zero-sized is dropped rather than
 * repaired: a part we cannot place is a part nobody marks, and the beat simply
 * carries on without that circle. Marking the wrong place is far worse than
 * marking nothing.
 */
/** Whether the eyes reported words printed on the picture. */
export function sawText(raw: string): boolean {
  try {
    const parsed = JSON.parse(stripFence(raw)) as Record<string, unknown>;
    return parsed?._hasText === true;
  } catch {
    return false;
  }
}

export function parseParts(raw: string, wanted: readonly string[]): ImagePart[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];

  const out: ImagePart[] = [];
  for (const name of wanted) {
    const box = (parsed as Record<string, unknown>)[name];
    if (typeof box !== 'object' || box === null) continue;
    const { x, y, w, h } = box as Record<string, unknown>;
    const fx = fraction(x);
    const fy = fraction(y);
    const fw = fraction(w);
    const fh = fraction(h);
    if (fx === null || fy === null || fw === null || fh === null) continue;
    if (fw <= 0.01 || fh <= 0.01) continue;
    // Clamped, so a box that runs a little past an edge still marks the part
    // rather than being thrown away for a rounding error.
    const cx = Math.max(0, Math.min(fx, 1));
    const cy = Math.max(0, Math.min(fy, 1));
    out.push({
      name,
      x: cx,
      y: cy,
      w: Math.min(fw, 1 - cx),
      h: Math.min(fh, 1 - cy),
    });
  }
  return out;
}

/**
 * Make one picture and find its parts.
 *
 * Never throws. A picture that fails to generate is simply absent, and the
 * beat that wanted it is dropped the same way a failed diagram's is — a class
 * with one picture instead of two is still a class.
 */
/** What to say on a second attempt, when the first came back with labels on it. */
export function redrawPrompt(brief: PictureBrief): string {
  return `${picturePrompt(brief)}

CRITICAL: your previous attempt had words printed on it. This picture is going
onto a board where a TEACHER writes every label herself, by hand, as she
speaks. Printed labels fight with her handwriting and give away her next line.
Draw the subject and NOTHING else: no words, no letters, no numbers, no leader
lines, no key, no legend, no watermark.`;
}

export async function drawPicture(
  brief: PictureBrief,
  artist: ImageAdapter,
  eyes: VisionAdapter,
): Promise<PictureResult | null> {
  const draw = async (prompt: string): Promise<string | null> => {
    try {
      const got = await artist.draw(prompt);
      return got && got.startsWith('data:image/') ? got : null;
    } catch {
      return null;
    }
  };

  let src = await draw(picturePrompt(brief));
  if (!src) return null;

  // Nothing to look for and no labels to catch, so no second call at all.
  if (brief.parts.length === 0) return { src, parts: [], attempts: 1, hasText: false };

  const look = async (image: string) => {
    try {
      return await eyes.look(image, PART_FINDER_SYSTEM, partFinderUser(brief.parts));
    } catch {
      return null;
    }
  };

  let reply = await look(src);
  // The picture is still worth showing; it just cannot be marked yet.
  if (reply === null) return { src, parts: [], attempts: 1, hasText: false };

  // One redraw, and only when the eyes actually saw printed words. Image
  // models ignore "no text" often enough to matter and not often enough to
  // pay for a second picture every time — so the cost is spent exactly when
  // there is something wrong to fix.
  if (sawText(reply)) {
    const second = await draw(redrawPrompt(brief));
    if (second) {
      const secondReply = await look(second);
      // Keep the redraw only if it actually solved the problem; a second
      // picture that still has labels is just a second picture.
      if (secondReply !== null && !sawText(secondReply)) {
        return {
          src: second,
          parts: parseParts(secondReply, brief.parts),
          attempts: 2,
          hasText: false,
        };
      }
    }
  }

  return {
    src,
    parts: parseParts(reply, brief.parts),
    attempts: 1,
    hasText: sawText(reply),
  };
}
