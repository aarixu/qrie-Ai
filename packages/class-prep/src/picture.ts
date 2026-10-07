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
  /**
   * The lesson is the movement itself — a heart pumping, a person running —
   * so a short silent loop is looked for before a still (fromWeb.ts). Only
   * honoured with no parts: nothing in a loop holds still to be pointed at.
   */
  motion?: boolean;
}

export interface PictureResult {
  /** A `data:` URL, ready to inline. */
  src: string;
  parts: ImagePart[];
  /** How many times it had to be drawn, so a prep report can say so. */
  attempts: number;
  /**
   * Its width divided by its height, or null if that could not be read.
   *
   * The board needs the shape a picture will be DRAWN at, not the shape of the
   * space it was given. The renderer fits an image inside its box and centres
   * it, so a square picture in a wide box leaves empty board either side — and
   * a part box, being a fraction of the box, lands in that empty strip. The
   * circle then misses the thing it was drawn around.
   */
  aspect: number | null;
  /**
   * What is still wrong with the picture we settled for.
   *
   * Empty on a good picture. A list rather than a flag because there is more
   * than one way an image model ignores its instructions, and the prep report
   * should be able to say which one happened.
   */
  faults: string[];
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

Also include two facts about the picture as a whole:

- "_hasText": true or false — true if the picture has ANY words, letters or
  numbers printed on it, including labels with leader lines. The teacher
  writes every label on the board herself, so printed ones are a fault in the
  picture.
- "_count": how many of the subject the picture contains. It was asked for
  exactly one. Two kidneys, a mirrored pair, a before-and-after, a row of
  cells: that is 2 or more, and it is a fault. One subject shown once is 1,
  however many parts it has inside it.`;

export function partFinderUser(parts: readonly string[]): string {
  return `Find these parts:\n${parts.map((p) => `- ${p}`).join('\n')}`;
}

/**
 * The shape of a picture, read from the bytes it arrived as.
 *
 * PNG only, and deliberately: it is the format these models return, its header
 * is fixed-width and unambiguous, and a format we cannot read honestly returns
 * null rather than a guess. A null shape places the picture exactly the way it
 * was placed before any of this existed.
 */
export function imageAspect(dataUrl: string): number | null {
  const bytes = imageBytes(dataUrl);
  if (bytes === null) return null;
  const size = pngSize(bytes) ?? jpegSize(bytes);
  if (size === null || size.w <= 0 || size.h <= 0) return null;
  return size.w / size.h;
}

/** The whole picture, decoded. A megabyte once per class costs nothing. */
function imageBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(',');
  if (!/^data:image\/[a-z]+;base64,/.test(dataUrl) || comma < 0) return null;
  try {
    const binary = atob(dataUrl.slice(comma + 1));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** 8-byte signature, a length, the letters IHDR, then width and height. */
function pngSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { w: view.getUint32(16), h: view.getUint32(20) };
}

/**
 * Walked segment by segment to the frame header.
 *
 * A JPEG's size is not at a fixed offset: it sits in whichever SOF segment
 * comes after however many application and comment blocks the encoder felt
 * like writing, and a generated picture carries a fat provenance block among
 * them. So the segments are walked rather than guessed at.
 */
function jpegSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 2;
  while (at + 8 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = bytes[at + 1];
    // A start-of-frame carries the dimensions. C4, C8 and CC share the range
    // and are not frames — they describe how the frame is coded.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: view.getUint16(at + 5), w: view.getUint16(at + 7) };
    }
    // Padding and the standalone markers carry no length to skip.
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      at += 2;
      continue;
    }
    at += 2 + view.getUint16(at + 2);
  }
  return null;
}

const stripFence = (s: string): string =>
  s
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

/**
 * How much of a picture one named part may cover, and how much means the model
 * boxed the whole subject instead of a part.
 *
 * The box the eyes return becomes the circle drawn on the board, so its size
 * is a measurement like any other in this engine — and like every other one,
 * it is settled in exactly one place. Asking for a tight box in the prompt was
 * the first attempt and it does not hold: the model agrees and then hands back
 * a box half the picture wide, and the circle swallows the organ it meant to
 * point inside.
 *
 * A part of an organ is usually a fifth to a third of the picture across. 0.45
 * leaves room for the genuinely large part — a leaf blade, a lung — while
 * still cutting the boxes that were never about one part at all.
 */
const MAX_PART = 0.45;
const WHOLE_SUBJECT = 0.75;

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
/**
 * What the eyes noticed wrong with the picture as a whole.
 *
 * Both faults ride on the call that was being made anyway to find the parts,
 * so counting the subject costs nothing. Read as a list because one redraw has
 * to answer for all of them: paying for a second picture per fault would mean
 * three pictures for a labelled mirrored pair, and the third would be as
 * likely to invent a fourth fault as to fix the first.
 *
 * A reply that says nothing about a fault is not evidence of one. Anything
 * unparseable reports nothing, and the picture stands.
 */
export function faults(raw: string): string[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripFence(raw)) as Record<string, unknown>;
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const out: string[] = [];
  if (parsed._hasText === true) out.push('words printed on it');
  if (typeof parsed._count === 'number' && parsed._count >= 2) {
    out.push('more than one of the subject in it');
  }
  return out;
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
    // A box that took in the whole subject is not a part. Dropped rather than
    // shrunk, because where the part actually is cannot be recovered from a
    // box that missed it by that much — and a circle round everything points
    // at nothing. The name is still written; it just has no line to leave.
    if (fw > WHOLE_SUBJECT && fh > WHOLE_SUBJECT) continue;
    // Otherwise pulled in to the size a part may be, around its OWN centre, so
    // the circle stays on the thing the model was looking at.
    const sw = Math.min(fw, MAX_PART);
    const sh = Math.min(fh, MAX_PART);
    // Clamped, so a box that runs a little past an edge still marks the part
    // rather than being thrown away for a rounding error.
    const cx = Math.max(0, Math.min(fx + (fw - sw) / 2, 1));
    const cy = Math.max(0, Math.min(fy + (fh - sh) / 2, 1));
    out.push({
      name,
      x: cx,
      y: cy,
      w: Math.min(sw, 1 - cx),
      h: Math.min(sh, 1 - cy),
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
/**
 * What to say on a second attempt, with every fault named.
 *
 * All of them at once: a redraw per fault would cost a picture each time, and
 * the model that ignored "exactly one" is no more likely to hear it on the
 * third telling than the second.
 */
export function redrawPrompt(brief: PictureBrief, problems: readonly string[]): string {
  return `${picturePrompt(brief)}

CRITICAL: your previous attempt was rejected. What was wrong with it:
${problems.map((p) => `- ${p}`).join('\n')}

This picture goes onto a board where a TEACHER writes every label herself, by
hand, as she speaks — printed labels fight with her handwriting and give away
her next line. And she teaches on ONE subject: a second copy of it beside the
first means every mark she makes lands on one of two things and the student
does not know which.

So: EXACTLY ONE of the subject, alone, and NOTHING written on it — no words, no
letters, no numbers, no leader lines, no key, no legend, no watermark.`;
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

  // Nothing to look for and no faults to catch, so no second call at all.
  if (brief.parts.length === 0)
    return { src, parts: [], attempts: 1, faults: [], aspect: imageAspect(src) };

  const look = async (image: string) => {
    try {
      return await eyes.look(image, PART_FINDER_SYSTEM, partFinderUser(brief.parts));
    } catch {
      return null;
    }
  };

  const reply = await look(src);
  // The picture is still worth showing; it just cannot be marked yet.
  if (reply === null) return { src, parts: [], attempts: 1, faults: [], aspect: imageAspect(src) };

  // One redraw, and only when the eyes actually saw something wrong. Image
  // models ignore "no text" and "exactly one" often enough to matter and not
  // often enough to pay for a second picture every time — so the cost is
  // spent exactly when there is a named fault to fix.
  const wrong = faults(reply);
  if (wrong.length > 0) {
    const second = await draw(redrawPrompt(brief, wrong));
    if (second) {
      const secondReply = await look(second);
      // Keep the redraw only if it came back clean. A second picture with the
      // same fault on it is just a second picture, and swapping one fault for
      // another is not progress either.
      if (secondReply !== null && faults(secondReply).length === 0) {
        return {
          src: second,
          parts: parseParts(secondReply, brief.parts),
          attempts: 2,
          faults: [],
          aspect: imageAspect(second),
        };
      }
    }
  }

  return {
    src,
    parts: parseParts(reply, brief.parts),
    attempts: 1,
    faults: wrong,
    aspect: imageAspect(src),
  };
}
