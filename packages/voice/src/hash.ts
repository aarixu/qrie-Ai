/**
 * THE HASH THAT KEEPS A RECORDING HONEST.
 *
 * A pre-rendered class is a folder of audio files and a manifest that claims
 * each file says a particular line. Nothing stops someone editing a narration
 * line in lesson.json and committing it without re-rendering, so the manifest
 * carries a hash of the exact words each take was rendered from. The player
 * hashes the line it is about to speak and only plays the file if the two
 * agree; otherwise the words the student hears would not be the words the
 * lesson says.
 *
 * The renderer (tools/record-class) and this player must therefore compute the
 * SAME hash. That is why it lives on this side: the runtime is read by more
 * people than the CLI, and one function with two implementations is a bug with
 * a delay fuse.
 *
 * Deliberately not node:crypto and deliberately not async: this runs in a
 * browser, on every beat, before a sound is made.
 */

/**
 * Whitespace-insensitive, so re-wrapping a long narration line in lesson.json
 * does not invalidate a take that says exactly the same words.
 */
export function normaliseNarration(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const FNV_PRIME = 0x01000193;

function fnv1a(text: string, basis: number): number {
  let h = basis >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h = Math.imul(h ^ (code & 0xff), FNV_PRIME) >>> 0;
    // Em dashes and curly quotes are common in narration; folding the high byte
    // in keeps them from hashing the same as their ASCII neighbours.
    if (code > 0xff) h = Math.imul(h ^ (code >>> 8), FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

const hex8 = (n: number): string => n.toString(16).padStart(8, '0');

/** FNV-1a run twice from different bases — 64 bits of hex. */
export function hashNarration(text: string): string {
  const t = normaliseNarration(text);
  return hex8(fnv1a(t, 0x811c9dc5)) + hex8(fnv1a(t, FNV_PRIME));
}
