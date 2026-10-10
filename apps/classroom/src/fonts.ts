/**
 * THE TYPEFACES, SELF-HOSTED AND ABLE TO SPELL HINDI.
 *
 * Two problems fixed at once.
 *
 * DEVANAGARI. The classes are Hinglish — "अब देखो epithelial tissue को" is a
 * normal line here — and Quicksand and Lexend carry no Devanagari at
 * all. Those words were falling through to whatever the operating system
 * happened to have, which changes weight, width and baseline in the middle of
 * a sentence. That does not read as a style choice; it reads as broken.
 *
 * The fix is a second family in each stack rather than a different first one.
 * A browser resolves font-family per GLYPH, so Latin keeps the face that was
 * chosen for it and Devanagari lands on one that was drawn for it:
 *
 *   Quicksand (rounded geometric)  ->  Baloo 2, rounded, Devanagari by Ek Type
 *   Lexend (humanist, legibility)  ->  Mukta, humanist, Devanagari by Ek Type
 *
 * Both Devanagari faces come from the same Indian foundry and were drawn
 * alongside Latin, so the pairing is a match rather than a patch.
 *
 * SELF-HOSTED. They used to come from the Google Fonts CDN, which is a
 * network dependency in a product built for Indian data and for going into an
 * app bundle. Imported here they are part of the build, work offline, and
 * ship inside the APK with everything else.
 */
import '@fontsource-variable/quicksand';
import '@fontsource-variable/lexend';
// Only the weights the type scale actually uses, and only Devanagari: the
// Latin in these families would never be reached, and shipping it would be
// two more font files for nothing.
import '@fontsource/baloo-2/devanagari-400.css';
import '@fontsource/baloo-2/devanagari-600.css';
import '@fontsource/baloo-2/devanagari-700.css';
import '@fontsource/mukta/devanagari-400.css';
import '@fontsource/mukta/devanagari-500.css';
import '@fontsource/mukta/devanagari-600.css';
