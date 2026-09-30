/**
 * DEVANAGARI INTO ROMAN HINGLISH — the ear's backstop.
 *
 * The ear is told to write Hindi in Roman script, and on 2026-09-30 the old
 * instruction still came back in Devanagari for 3 of 5 synthetic Hinglish
 * answers (tools/voice-probe/probe.mjs). Roman script is load-bearing: the
 * distress screen's word lists are Latin-script, so a Devanagari transcript
 * would pass them unseen. The new instruction returned 0 of 8 in Devanagari
 * (tools/voice-probe/ear-variants.mjs); this function is what makes 0 a
 * guarantee rather than a measurement: any Devanagari that still comes back is
 * spelled out the way Indians type Hindi in chats before the transcript
 * leaves the relay.
 *
 * It is a casual romaniser, not a scholarly one: the inherent "a" is dropped
 * at the end of a word and between a vowel and a consonant that carries its
 * own vowel (लगता → lagta, मरना → marna, समझ → samajh), and a word-final long
 * "aa"/"ee" is written short (पता → pata, ही → hi), because that is how
 * students write these words and how the screen's lists spell them.
 */

const CONSONANTS: Record<string, string> = {
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'n',
  च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ञ: 'n',
  ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n',
  त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n',
  प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm',
  य: 'y', र: 'r', ल: 'l', व: 'v', श: 'sh', ष: 'sh', स: 's', ह: 'h',
  // Precomposed nukta letters (single code points U+0958-U+095F).
  'क़': 'q', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'z', 'ड़': 'r', 'ढ़': 'rh', 'फ़': 'f', 'य़': 'y',
};

/** A base letter followed by the combining nukta (U+093C). */
const WITH_NUKTA: Record<string, string> = { क: 'q', ख: 'kh', ग: 'g', ज: 'z', ड: 'r', ढ: 'rh', फ: 'f', य: 'y' };

const VOWELS: Record<string, string> = {
  अ: 'a', आ: 'aa', इ: 'i', ई: 'ee', उ: 'u', ऊ: 'oo', ऋ: 'ri',
  ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au', ऑ: 'o', ऍ: 'e',
};

const MATRAS: Record<string, string> = {
  'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri',
  'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o', 'ॅ': 'e',
};

const NUKTA = '़';
const VIRAMA = '्';
const NASAL = new Set(['ं', 'ँ']);
const VISARGA = 'ः';
const DIGITS = '०१२३४५६७८९';

/** One syllable of a word: a consonant (or none) and the vowel it carries. */
interface Syllable {
  consonant: string;
  /** '' = no vowel (virama); null = the inherent "a", decided after the word is read. */
  vowel: string | null;
  /** Anusvara, chandrabindu or visarga after it. */
  tail: string;
}

function readWord(word: string): Syllable[] {
  const out: Syllable[] = [];
  const chars = [...word];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c in CONSONANTS) {
      let consonant = CONSONANTS[c];
      if (chars[i + 1] === NUKTA && c in WITH_NUKTA) {
        consonant = WITH_NUKTA[c];
        i++;
      }
      const next = chars[i + 1];
      if (next === VIRAMA) {
        out.push({ consonant, vowel: '', tail: '' });
        i++;
      } else if (next !== undefined && next in MATRAS) {
        out.push({ consonant, vowel: MATRAS[next], tail: '' });
        i++;
      } else {
        out.push({ consonant, vowel: null, tail: '' });
      }
    } else if (c in VOWELS) {
      out.push({ consonant: '', vowel: VOWELS[c], tail: '' });
    } else if (NASAL.has(c) || c === VISARGA) {
      const last = out[out.length - 1];
      if (last) last.tail += c === VISARGA ? 'h' : 'n';
    } else if (c === 'ॐ') {
      out.push({ consonant: 'om', vowel: '', tail: '' });
    } else if (/[ऀ-ॿ]/.test(c)) {
      // A stray nukta or virama, or a letter Hindi does not use in chat
      // (Vedic signs, Sanskrit-only vowels): dropped, never passed on as
      // Devanagari.
    } else {
      // Anything else inside the word (a Latin letter, a digit): kept as it is.
      out.push({ consonant: c, vowel: '', tail: '' });
    }
  }
  return out;
}

function spellWord(word: string): string {
  const syllables = readWord(word);
  const spelt = syllables.map((s, i) => {
    let vowel = s.vowel;
    if (vowel === null) {
      const next = syllables[i + 1];
      const prev = syllables[i - 1];
      const last = i === syllables.length - 1;
      // Schwa deletion: none at the end of a word (unless it is the only
      // letter), none between a vowel and a consonant that carries its own.
      const prevHasVowel = prev !== undefined && prev.vowel !== '';
      // The next letter keeps a vowel: a written one, or an inherent "a" that
      // is not the end of the word (where it is dropped).
      const nextCarriesVowel =
        next !== undefined &&
        next.consonant !== '' &&
        (next.vowel ? true : next.vowel === null && i + 1 !== syllables.length - 1);
      if (last) vowel = syllables.length === 1 ? 'a' : '';
      else if (prevHasVowel && nextCarriesVowel && !s.tail) vowel = '';
      else vowel = 'a';
    }
    return s.consonant + vowel + s.tail;
  });
  // The last vowel written short, as students type it: पता → pata, ही → hi.
  // Not a bare vowel, though: आ stays "aa".
  const lastIndex = spelt.length - 1;
  if (lastIndex >= 0 && !syllables[lastIndex].tail && syllables[lastIndex].consonant !== '') {
    spelt[lastIndex] = spelt[lastIndex].replace(/aa$/, 'a').replace(/ee$/, 'i');
  }
  return spelt.join('');
}

const DEVANAGARI_RUN = /[ऀ-ॿ]+/g;

/** True when any Devanagari is in the text. */
export const hasDevanagari = (text: string): boolean => /[ऀ-ॿ]/.test(text);

/** Every run of Devanagari in `text`, spelled in Roman letters; everything else unchanged. */
export function romaniseDevanagari(text: string): string {
  if (!hasDevanagari(text)) return text;
  return text
    .replace(/[।॥]/g, '.')
    .replace(/[०-९]/g, (d) => String(DIGITS.indexOf(d)))
    .replace(DEVANAGARI_RUN, (run) => spellWord(run));
}
