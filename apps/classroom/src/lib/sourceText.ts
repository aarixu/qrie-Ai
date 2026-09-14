/**
 * A PAGE THE STUDENT BROUGHT, TURNED INTO SOMETHING A CLASS CAN BE PLANNED FROM.
 *
 * The syllabus is what a student is MEANT to study and `/class?topic=` is what
 * they wondered about; this is the third door — a chapter their teacher sent
 * on WhatsApp, a worksheet, a page of notes. Same room, same road: it ends as
 * the `topic` string `prepareClass` already takes.
 *
 * PURE, ON PURPOSE. Nothing here reads a file, decodes a PDF or touches the
 * DOM — it decides what a file IS, what to keep of it, what to tell the
 * planner and what to tell the student when it will not open. The reading is
 * in lib/readSource, which is the only part that needs a browser, and that
 * split is what lets every one of the failures below be tested without one.
 *
 * WHERE THE BYTES GO: nowhere. The file is opened by the page that is already
 * on the phone. Nothing is uploaded, so there is no upload to secure, no
 * retention to promise and nothing to delete — a privacy position that falls
 * out of the architecture instead of being argued for in a policy.
 */

/**
 * What a file turned out to be, judged by its BYTES and not by its name.
 *
 * A student's file is named by whatever renamed it last — WhatsApp, a
 * download, a teacher — and `.pdf` on the end is a claim, not a fact. Every
 * decision below is made on the first bytes, so a JPEG called notes.pdf is
 * refused as the photo it is instead of crashing a PDF parser.
 */
export type SourceKind =
  | 'pdf'
  /**
   * Four bytes of "PK". A .docx, a .pptx, an .epub and a plain .zip are
   * indistinguishable here — which one it really is depends on what is INSIDE
   * the archive, and opening the archive needs the reader. So this means "a
   * zip, possibly a Word document", and lib/readSource settles it.
   */
  | 'zip'
  | 'text'
  /** A photograph or a scan: real bytes, no words in them. */
  | 'picture'
  | 'unknown';

/**
 * WHY A FILE DID NOT BECOME A CLASS.
 *
 * Every one of these is an ordinary thing a student's file does, not an error
 * condition — so each has a sentence a child can act on, and none of them may
 * reach a console, a spinner or a blank screen.
 */
export type SourceProblem =
  /** Rejected on its size alone, before a single byte is read. */
  | 'too-big'
  /** An encrypted PDF. Nothing can be read from it without the password. */
  | 'locked'
  /**
   * It opened and there were no words in it: a photograph, or a PDF that is
   * pictures of pages. One kind rather than two, because "I cannot read the
   * writing inside a picture" is the same true sentence either way and the
   * student's next move is the same.
   */
  | 'no-text'
  /** A format this reader does not read — a .pptx, an .epub, a song. */
  | 'unsupported'
  /** Truncated, corrupt, or not the kind of file its name claims. */
  | 'damaged'
  /** It opened, it was the right kind, and it had nothing in it. */
  | 'empty';

/**
 * WHAT THE STUDENT IS TOLD, AND WHAT THEY DO NEXT.
 *
 * Every body line ends by pointing back at the box the student is already
 * looking at. A failure that only says what went wrong leaves a child holding
 * a phone with nothing to press, which is the state this whole table exists to
 * prevent.
 */
export const SOURCE_PROBLEM: Record<SourceProblem, { title: string; body: string }> = {
  'too-big': {
    title: 'That file is too big to open here',
    body:
      'Your file never leaves this phone, so your phone has to do the opening — and there is a limit to that. ' +
      'Up to 20 MB works, and a chapter is usually far smaller.',
  },
  locked: {
    title: 'That PDF is locked',
    body:
      'It needs a password before anything can be read out of it. ' +
      'If you can open it yourself, save an unlocked copy and send me that one.',
  },
  'no-text': {
    title: 'That looks like a picture of a page',
    body:
      'I can read a page that has text in it, but I cannot read handwriting or a photo of a book yet. ' +
      'Tell me what the page is about instead and I will teach it.',
  },
  unsupported: {
    title: 'I cannot open that kind of file',
    body: 'PDF, Word and plain text work. For anything else, type what you want to learn.',
  },
  damaged: {
    title: 'That file would not open',
    body:
      'It may have been cut off while it was downloading, or it may not be the kind of file its name says it is. ' +
      'Try sending it again, or type what you want to learn.',
  },
  empty: {
    title: 'There is nothing in that file',
    body: 'It opened, but there were no words in it. Try another file, or type what you want to learn.',
  },
};

/**
 * THE MOST A FILE MAY WEIGH.
 *
 * Not a policy — a phone. The whole file is held in memory and parsed by the
 * page, on a ₹10,000 Android with 4 GB of RAM, and a 200 MB PDF there is not
 * a slow class, it is a tab the operating system kills with no error anybody
 * can catch. 20 MB is well past a text chapter (single digits of MB) and well
 * short of the scans that would be refused for having no text anyway.
 */
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

/**
 * HOW MUCH OF THE PAGE THE PLANNER IS SHOWN. The decision this file exists for.
 *
 * An NCERT chapter is around 6,000 words — some 40,000 characters. The class
 * being planned is two minutes of speech in eight beats. Three choices:
 *
 *   THE WHOLE EXTRACTION. Costs an extra ~10,000 input tokens on the plan
 *   call, which is small money, but it plans badly: given a whole chapter the
 *   planner tries to cover a whole chapter, and two minutes of covering six
 *   thousand words is a summary read aloud. The prompt itself says "Do not
 *   summarise the topic — teach it", and handing it a chapter is the surest
 *   way to make it do the opposite.
 *
 *   A SUMMARISING STEP. Honest and better on paper, and it is A MODEL CALL:
 *   one more round trip on the critical path of a wait that warm entry got
 *   down to about fourteen seconds, plus real money on every brought file.
 *   Rejected for the MVP — but it is the one upgrade here worth paying for,
 *   and it should be a decision somebody takes on purpose, not a line that
 *   appeared in a diff.
 *
 *   THE OPENING, WHICH IS WHAT THIS IS. 12,000 characters — roughly 2,000
 *   words, three or four pages, about 3,000 extra input tokens on one call of
 *   a class that costs ₹15.58 cold and is 86% speech. A textbook section puts
 *   its definition, its first worked idea and its vocabulary at the front, so
 *   the opening is the part a two-minute class was going to teach anyway.
 *
 * What would change it: a student asking for something from the END of a long
 * chapter and getting the beginning. The fix for that is not a bigger number,
 * it is the summarising step above, or letting them say which part they want.
 */
export const SOURCE_LIMIT = 12_000;

/**
 * Below this many characters, a "document" is a picture of one.
 *
 * A scanned chapter is not empty — pdf.js returns the page furniture, a
 * running header, a page number. Forty characters clears that and is far
 * under anything that could be taught.
 */
const MIN_USEFUL_CHARS = 40;

const startsWith = (bytes: Uint8Array, ...sig: number[]): boolean =>
  sig.every((byte, i) => bytes[i] === byte);

/** ASCII, for reading the handful of magic strings below. */
const ascii = (bytes: Uint8Array, from: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(from, from + length));

/**
 * Is this run of bytes something a person typed?
 *
 * Counts what cannot appear in text: a NUL, or a C0 control that is not tab,
 * newline or carriage return. A UTF-8 page of Hindi is full of high bytes and
 * none of these; an mp3 or a .doc (the old binary one) is full of them within
 * the first few hundred.
 *
 * Deliberately not "does TextDecoder throw" — it does not, it substitutes
 * U+FFFD, so a decoded mp3 is a perfectly valid string of garbage and was
 * happily sent to a planner as a topic.
 */
export function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 4096);
  if (sample.length === 0) return false;
  let bad = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) bad += 1;
  }
  return bad / sample.length < 0.02;
}

/**
 * WHAT THIS FILE ACTUALLY IS.
 *
 * `head` is the first kilobyte or so, and it is the ONLY argument: the file
 * name is deliberately not consulted. A file that has been through a download
 * folder and two chat apps is named by the last thing that touched it, so the
 * extension is a claim and these bytes are the fact.
 */
export function sniff(head: Uint8Array): SourceKind {
  // %PDF, allowed to sit behind a little junk: a PDF with leading bytes is
  // out of spec and every reader in the world accepts it, including pdf.js.
  const lead = ascii(head, 0, Math.min(head.length, 1024));
  if (lead.includes('%PDF-')) return 'pdf';

  if (startsWith(head, 0x50, 0x4b, 0x03, 0x04)) return 'zip';

  if (startsWith(head, 0xff, 0xd8, 0xff)) return 'picture';
  if (startsWith(head, 0x89, 0x50, 0x4e, 0x47)) return 'picture';
  if (ascii(head, 0, 4) === 'GIF8') return 'picture';
  if (startsWith(head, 0x42, 0x4d)) return 'picture';
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') return 'picture';
  // HEIC — what an iPhone photographs a page into, and a shape nobody
  // recognises by extension because the extension is often .jpg by the time
  // it has been through a chat app.
  if (ascii(head, 4, 4) === 'ftyp' && /^(heic|heix|hevc|mif1|msf1|avif)/.test(ascii(head, 8, 4))) {
    return 'picture';
  }

  return looksLikeText(head) ? 'text' : 'unknown';
}

/**
 * pdf.js failures, in the vocabulary a student is told them in.
 *
 * Kept here, pure, rather than inside the try/catch that produces them: these
 * are the branches most likely to be wrong and least likely to be exercised
 * by hand, and a locked PDF is not something anyone can conjure in a test.
 * The names are pdf.js's own (`PasswordException`, `InvalidPDFException`), and
 * they are matched by NAME because the classes are not exported from the ESM
 * build and `instanceof` across a dynamic import is a coin toss.
 */
export function classifyPdfError(error: unknown): SourceProblem {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'PasswordException') return 'locked';
  if (name === 'InvalidPDFException') return 'damaged';
  return 'damaged';
}

/**
 * Tidy a raw extraction and cut it to what the planner is shown.
 *
 * Paragraph breaks survive and everything else collapses: a PDF extraction is
 * full of the line breaks the typesetter chose, and keeping those would hand
 * the planner a poem.
 *
 * The cut lands on a sentence when one is near enough, because a brief that
 * stops mid-word reads to a model as a transcription error rather than as an
 * extract — and `।` is in the list because half the pages this will be handed
 * are Hindi.
 */
export function trimForPlanner(
  raw: string,
  limit: number = SOURCE_LIMIT,
): { text: string; truncated: boolean } {
  const tidied = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (tidied.length <= limit) return { text: tidied, truncated: false };

  const head = tidied.slice(0, limit);
  const stop = Math.max(
    head.lastIndexOf('. '),
    head.lastIndexOf('। '),
    head.lastIndexOf('?'),
    head.lastIndexOf('\n'),
  );
  // Only if the sentence end is actually near the end. A page with one
  // full stop in its first paragraph would otherwise throw away 90% of what
  // was kept in order to end tidily.
  const at = stop > limit * 0.8 ? stop + 1 : limit;
  return { text: head.slice(0, at).trim(), truncated: true };
}

/**
 * A file name, as something to print on a screen.
 *
 * Underscores become spaces and a download's "(1)" goes, because both are
 * noise the student did not choose. Hyphens stay: "Ch 6 - Life Processes" is
 * a person separating two things and "Life-Processes" is one word to them.
 */
export function titleFromFileName(name: string): string {
  const stem = name
    .replace(/\.[A-Za-z0-9]{1,8}$/, '')
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stem === '' ? 'the page you brought' : stem.slice(0, 80);
}

/** A page, read and trimmed, on its way to the planner. */
export interface SourcePage {
  /** The file's name, tidied — what the student sees while she prepares. */
  title: string;
  /** The extract, ALREADY through the safety screen and quoted for a prompt. */
  text: string;
  /** There was more page after this. */
  truncated: boolean;
}

/**
 * THE INSTRUCTION THE PLANNER ACTUALLY RECEIVES.
 *
 * `prepareClass` takes one `topic` string and the prompt renders it as
 * "Topic: …", so the page has to travel inside it. Three things are said and
 * they are all defects that showed up when they were not:
 *
 *   - the page is a SOURCE, not a script. Without this the planner narrates
 *     the extract, which is a tutor reading a textbook out loud — the exact
 *     thing this product exists instead of.
 *   - the furniture is not the lesson. A real page carries exercise numbers,
 *     a chapter number, a school's name, "Downloaded from…"; a planner given
 *     no guidance teaches those with the same seriousness as the biology.
 *   - it stops where it stops. Told an extract is the whole thing, a planner
 *     promises the class will cover what is not in front of it.
 *
 * `page.text` must already have been through the safety screen: it is a
 * child's words and it is being dropped into a prompt inside quotes, which is
 * precisely the shape `quoteForPrompt` exists for. Composed here rather than
 * screened here because screening records a flag, and this is pure.
 */
export function plannerTopicFromSource(page: SourcePage): string {
  const ending = page.truncated
    ? 'Only the opening of the page is below — teach what is there and do not promise the rest. '
    : '';
  return (
    `${page.title} — a page the student brought in themselves, not a syllabus topic. ` +
    `Teach what this page is about, in your own words, at their class level. ` +
    `The page is the SOURCE and not a script: do not read it out, and leave out anything on it ` +
    `that is not the lesson — exercise numbers, page numbers, a school's name, a download notice. ` +
    `${ending}THE PAGE SAYS: "${page.text}"`
  );
}

/**
 * Is there enough here to be worth a class?
 *
 * The one check that decides a scan from a document, and it is a count of
 * characters rather than a look at the PDF's structure because that is the
 * property that actually matters: a page of pictures and a page of words are
 * told apart by whether words came out.
 */
export function hasUsefulText(text: string): boolean {
  return text.replace(/\s/g, '').length >= MIN_USEFUL_CHARS;
}

/**
 * The words inside a WordprocessingML body.
 *
 * A .docx is a zip and `word/document.xml` is the document; this turns that
 * XML into paragraphs. Deliberately not an XML parse: the file is a child's
 * homework, not a contract, and every part of the schema this ignores —
 * styles, revisions, comments, numbering — is a part whose text we would throw
 * away anyway.
 *
 * `<w:t>` runs are joined with NOTHING between them. Word splits a single word
 * across runs whenever a spell-check mark or a language tag changes inside it,
 * so joining runs with a space turns "photosynthesis" into "photo synthesis".
 * Paragraphs are what separate words, and those are `<w:p>`.
 */
export function textFromDocumentXml(xml: string): string {
  // Turned INTO text runs rather than into characters. A <w:br/> sits between
  // two <w:t> elements, not inside one, so replacing it with a newline put
  // that newline in the part of the paragraph the run collector below throws
  // away — and every hard line break in a student's notes vanished.
  const withBreaks = xml
    .replace(/<w:tab\b[^>]*\/?>/g, '<w:t> </w:t>')
    .replace(/<w:(?:br|cr)\b[^>]*\/?>/g, '<w:t>\n</w:t>');

  const paragraphs: string[] = [];
  for (const match of withBreaks.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
    const runs = [...match[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)];
    paragraphs.push(runs.map((run) => unescapeXml(run[1])).join(''));
  }

  // No paragraphs at all means this is not the shape we thought. Strip the
  // markup and keep whatever words are left rather than returning nothing —
  // an empty string here would be reported to the student as a scan, which
  // would be a lie about a file that is full of words.
  if (paragraphs.length === 0) {
    return unescapeXml(withBreaks.replace(/<[^>]*>/g, ' '));
  }
  return paragraphs.join('\n');
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function unescapeXml(text: string): string {
  return text.replace(/&(#x?[0-9A-Fa-f]+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body.startsWith('#x') || body.startsWith('#X')
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}
