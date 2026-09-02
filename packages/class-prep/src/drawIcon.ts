import type { LlmAdapter } from './prepare.ts';
import { unsafeMarkup } from './safety.ts';

/**
 * DRAWING THE NOUN NOBODY HAS.
 *
 * A quarter-million bundled icons still have no everyday water tank. The old
 * answer was a pencilled circle with the word inside — honest, but a class
 * full of labelled circles is a class without pictures. The better answer is
 * the one a code-drawing model gives: a small, flat, colourful SVG made to
 * order, the way ChatGPT draws a chart with code instead of rendering pixels.
 *
 * Only for the nouns that MISSED — the library still answers first, instantly
 * and for free. Each miss costs one artist call, drawn in parallel with the
 * rest of the preparation, and a drawing that fails verification falls back
 * to the pencil rather than delaying the class.
 */

export const ICON_ARTIST_SYSTEM = `You draw ONE small colourful icon for a school
lesson board — a single noun, nothing else. Output the SVG only, no fence, no
commentary.

- Root: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">, no
  width or height attributes. Fill roughly 90 of the 100 units, centred.
- Flat and friendly, like a good school textbook illustration: 3 to 6 solid
  colours, bold dark outlines, simple shapes a child recognises instantly.
- The TOPIC decides which meaning of the word to draw. "tank" in a water
  lesson is a cylindrical water tank on legs, never a military vehicle.
- NO text or letters anywhere. No gradients, no filters, no <image>, no
  <script>, no href, no event handlers. Readable at 40 pixels wide.`;

export function iconArtistUser(noun: string, topic: string): string {
  return `Lesson topic: ${topic}

Draw: ${noun}`;
}

/**
 * Is this drawing safe and usable as an inline icon?
 *
 * Same posture as the diagram verifier: rejected, never sanitised. The markup
 * is inlined into the page, so anything executable would execute in our
 * origin — and a picture we do not fully understand is one we should not show.
 */
export function verifyIconSvg(svg: string): string[] {
  const problems: string[] = [];
  const src = svg.trim();

  if (!src.startsWith('<svg')) {
    problems.push('does not start with <svg');
    return problems;
  }
  if (src.length > 20_000) problems.push('too large for an icon');
  problems.push(...unsafeMarkup(src));
  if (/<text[\s>]/i.test(src)) problems.push('contains <text> — the board writes its own labels');

  const viewBox = /viewBox\s*=\s*"([^"]+)"/i.exec(src);
  if (!viewBox) {
    problems.push('has no viewBox');
  } else {
    const n = viewBox[1].trim().split(/[\s,]+/).map(Number);
    if (n.length !== 4 || n.some((v) => !Number.isFinite(v)) || n[2] <= 0 || n[3] <= 0) {
      problems.push('viewBox is malformed');
    }
  }

  if (!/<(path|circle|ellipse|rect|line|polyline|polygon)[\s>]/i.test(src)) {
    problems.push('contains no drawn shapes');
  }

  return problems;
}

const stripFence = (s: string): string =>
  s
    .trim()
    .replace(/^```(?:svg|xml|html)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

/**
 * Draw every missing noun, in parallel, and keep only what verifies.
 *
 * Never throws: a failed drawing simply stays absent from the result, and the
 * caller's pencil fallback covers it. A class must not wait on, or die for,
 * one stubborn icon.
 */
export async function drawMissingIcons(
  topic: string,
  nouns: readonly string[],
  artist: LlmAdapter,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    nouns.map(async (noun) => {
      try {
        const svg = stripFence(await artist.complete(ICON_ARTIST_SYSTEM, iconArtistUser(noun, topic)));
        if (verifyIconSvg(svg).length === 0) out[noun] = svg;
      } catch {
        // The pencil covers it.
      }
    }),
  );
  return out;
}
