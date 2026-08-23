/**
 * Parsing NCERT's own textbook index.
 *
 * ncert.nic.in/textbook.php drives its three dropdowns (class, subject, book)
 * from a long chain of inline JavaScript. That chain is, in effect, the official
 * machine-readable catalogue of every NCERT textbook — class, subject, title,
 * book code and chapter count — so we read it rather than guess at the
 * curriculum.
 *
 * The shape we are reading looks like:
 *
 *   else if((document.test.tclass.value==10) &&
 *           (document.test.tsubject.options[sind].text=="Science")) {
 *     document.test.tbook.options[1].text="Science";
 *     document.test.tbook.options[1].value="textbook.php?jesc1=0-13"
 *
 * Pure string work: no network, no DOM, fully testable against a fixture.
 *
 * There is deliberately NO chapter-title parser here. A book's own page is
 * rendered by the same inline JavaScript and returns this identical index HTML
 * to a plain fetch, so chapter titles are simply not present in anything that
 * can be downloaded. Titles come from an LLM instead, anchored to the chapter
 * COUNT this file extracts — see src/prompt.ts.
 */

export interface NcertBook {
  klass: number;
  subject: string;
  /** Book title as NCERT lists it, e.g. "Science", "Ganita Prakash (Dogri)". */
  title: string;
  /** NCERT's book code, e.g. "jesc1" — also the chapter PDF prefix. */
  code: string;
  /** Chapter count from the "0-N" range in the link. AUTHORITATIVE. */
  chapters: number;
}

/**
 * Languages NCERT publishes translated editions in, tagged in the book title.
 *
 * This is the list actually present in the cached index, including NCERT's own
 * misspellings ("Gujrati", "Oriya", "Maithli") — those are separate entries
 * because a near-miss silently lets a translation through into the syllabus.
 * Bhoti, Mizo, Khasi and Garo are carried too: NCERT publishes in them and a
 * --refresh can introduce them at any time, and an unused alternative is free.
 */
const TRANSLATION_LANGUAGES = [
  'Assamese', 'Bengali', 'Bhoti', 'Bodo', 'Dogri', 'Garo', 'Gujarati', 'Gujrati',
  'Hindi', 'Kannada', 'Kashmiri', 'Khasi', 'Konkani', 'Maithili', 'Maithli',
  'Malayalam', 'Manipuri', 'Marathi', 'Mizo', 'Nepali', 'Odia', 'Oriya',
  'Punjabi', 'Sanskrit', 'Santhali', 'Sindhi', 'Tamil', 'Telugu', 'Urdu',
];

/**
 * A language name only marks a translation when NCERT has appended it as a tag:
 * bracketed — "Kriti-I (Sanskrit)" — or trailing after a SPACED dash, which is
 * how "Computer Science - Urdu" is written.
 *
 * The space before the dash is load-bearing. Urdu's own textbooks are titled
 * "Gulzar-e-Urdu" and "Nawa-e-Urdu": those end in the language name with a
 * hyphen in front of it, and they are the real book for the Urdu subject, not a
 * translation of something else. Same for Sanskrit's "Shemushi".
 */
const LANG = TRANSLATION_LANGUAGES.join('|');
const TRANSLATED = new RegExp(
  String.raw`\(\s*(?:${LANG})\s*\)|\s+[-–]\s+(?:${LANG})\s*$`,
  'i',
);

/**
 * Editions that share a subject with the textbook but are not the syllabus a
 * student is taught. Each pattern has to tolerate NCERT's spelling: "Examplar
 * Prolems", "Pratical Work in Geography" and "Supp." / "Suppl." / "(Supl)" are
 * all real titles in the cached index. Teacher, handbook and kit editions are
 * absent from the current cache but are named here so that a --refresh cannot
 * quietly introduce them.
 */
const NON_TEXTBOOK = [
  /ex[ae]mplar/i,
  /lab\s*manual/i,
  /prac?tical/i,
  /\b(?:supp|suppl|supl|supplementary)\b/i,
  /\bteachers?\b/i,
  /\bhand\s?books?\b/i,
  /\bkits?\b/i,
];

export function parseNcertCatalogue(html: string): NcertBook[] {
  const books: NcertBook[] = [];

  // Split on the class/subject guards; each fragment then holds that pair's books.
  const guard =
    /document\.test\.tclass\.value\s*==\s*(\d+)\s*\)\s*&&\s*\(document\.test\.tsubject\.options\[sind\]\.text\s*==\s*"([^"]+)"/g;

  const guards: { klass: number; subject: string; at: number }[] = [];
  for (const m of html.matchAll(guard)) {
    guards.push({ klass: Number(m[1]), subject: m[2].trim(), at: m.index ?? 0 });
  }

  guards.forEach((g, i) => {
    const fragment = html.slice(g.at, guards[i + 1]?.at ?? html.length);

    // Titles and values are assigned separately but share an option index, so
    // pair them by that index rather than by document order.
    const titles = new Map<number, string>();
    for (const m of fragment.matchAll(/tbook\.options\[(\d+)\]\.text\s*=\s*"([^"]*)"/g)) {
      titles.set(Number(m[1]), m[2].trim());
    }

    for (const m of fragment.matchAll(
      /tbook\.options\[(\d+)\]\.value\s*=\s*"textbook\.php\?([a-z0-9]+)=0-(\d+)"/gi,
    )) {
      const idx = Number(m[1]);
      const title = titles.get(idx);
      // Index 0 is the "..Select Book.." placeholder and carries no link.
      if (!title || title.startsWith('..')) continue;
      books.push({
        klass: g.klass,
        subject: g.subject,
        title,
        code: m[2],
        chapters: Number(m[3]),
      });
    }
  });

  // The same book is emitted more than once where NCERT repeats a block.
  const seen = new Set<string>();
  return books.filter((b) => {
    const key = `${b.klass}|${b.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface FilterOptions {
  minClass?: number;
  maxClass?: number;
  /** Keep only these subjects (matched case-insensitively against NCERT's spelling). */
  subjects?: string[];
  /** Drop editions whose title tags them as a translation. */
  englishOnly?: boolean;
  /** Drop exemplar / lab manual / practical / supplementary editions. */
  textbooksOnly?: boolean;
}

export function filterBooks(books: NcertBook[], opts: FilterOptions = {}): NcertBook[] {
  const {
    minClass = 6,
    maxClass = 12,
    subjects,
    englishOnly = true,
    textbooksOnly = true,
  } = opts;
  const wanted = subjects ? new Set(subjects.map((s) => s.toLowerCase())) : null;

  return books.filter((b) => {
    if (b.klass < minClass || b.klass > maxClass) return false;
    if (englishOnly && TRANSLATED.test(b.title)) return false;
    if (textbooksOnly && NON_TEXTBOOK.some((re) => re.test(b.title))) return false;
    if (wanted && !wanted.has(b.subject.toLowerCase())) return false;
    return true;
  });
}

/**
 * NCERT's book code carries the edition's LANGUAGE in its second character:
 * "jesc1" is class 10 (j) English (e) Science, "jhsc1" the Hindi edition of the
 * same book and "jusc1" the Urdu one.
 *
 * That letter is needed because the title test above cannot catch a Hindi or
 * Urdu edition that is not tagged as one: "Vigyan", "Ganit", "Riyazi",
 * "Bhautiki" and "Keemiya" are transliterated titles carrying no language
 * marker at all. The code letter is the only machine-readable language signal
 * NCERT gives.
 */
const ENGLISH_EDITION = /^[a-m]e/;

/**
 * The English textbook(s) for ONE class+subject, in a stable order.
 *
 * Plural on purpose: a class+subject legitimately has several English books —
 * Class 12 Mathematics is Part-I and Part-II, Class 10 Social Science is four
 * separate books — and every one of them is taught, so returning a single
 * "primary" book would drop most of the syllabus.
 *
 * Language subjects (Hindi, Sanskrit, Urdu) have no English edition by
 * definition, so when nothing carries the English marker everything that
 * survived filtering is returned instead of an empty list — otherwise those
 * subjects would silently vanish from the catalogue.
 */
export function pickPrimaryBook(books: NcertBook[]): NcertBook[] {
  const ordered = [...books].sort(
    (a, b) =>
      a.klass - b.klass ||
      a.subject.localeCompare(b.subject) ||
      a.code.localeCompare(b.code),
  );
  const english = ordered.filter((b) => ENGLISH_EDITION.test(b.code));
  return english.length > 0 ? english : ordered;
}

/** URL-safe id from a human title. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
}
