import { unzipSync, strFromU8 } from 'fflate';
import {
  MAX_SOURCE_BYTES,
  SOURCE_LIMIT,
  classifyPdfError,
  hasUsefulText,
  sniff,
  textFromDocumentXml,
  titleFromFileName,
  trimForPlanner,
  type SourceKind,
  type SourceProblem,
} from './sourceText';

/**
 * OPENING A FILE A STUDENT HANDED OVER, ON THE STUDENT'S OWN PHONE.
 *
 * The adapter half of lib/sourceText: this is the part that needs a browser —
 * a Blob, a TextDecoder, pdf.js, an inflate. Every DECISION it makes is
 * imported from there, so the rules about what a file is, how much of it is
 * kept and what a child is told when it will not open are testable without any
 * of this.
 *
 * NOTHING IS UPLOADED. Not as a policy: there is no endpoint. The bytes are
 * read by the page that is already open, the extract goes into that tab's own
 * memory, and the file object is dropped when the input is cleared. A student
 * handing over a page of their own notes is handing it to their phone.
 *
 * IT NEVER THROWS. Every ending is a value, because the four things a
 * student's file actually does — be a scan, be locked, be enormous, be a JPEG
 * wearing a .pdf — all used to arrive as an exception somewhere above a
 * screen, and an exception above a screen is a white page on a phone.
 */

/** A page, read. `text` is raw student words: NOT yet through the safety screen. */
export interface ReadPage {
  title: string;
  text: string;
  truncated: boolean;
  /** What the bytes turned out to be, for the line the student is shown. */
  kind: SourceKind;
}

export type ReadResult = { ok: true; page: ReadPage } | { ok: false; problem: SourceProblem };

const fail = (problem: SourceProblem): ReadResult => ({ ok: false, problem });

/**
 * How many pages of a PDF are opened.
 *
 * SOURCE_LIMIT is reached in three or four pages of a textbook, so this only
 * ever bites on a file whose front matter is nearly empty — a cover, a title
 * page, a blank. Thirty is far enough past that to be sure, and short enough
 * that a 400-page book does not lock a phone up rendering text nobody will
 * read.
 */
const MAX_PDF_PAGES = 30;

/**
 * The largest `word/document.xml` that will be inflated.
 *
 * A .docx is a zip, and a zip states how big each entry becomes BEFORE it is
 * expanded. Without this check a 2 MB file may honestly declare a 4 GB entry
 * and `unzipSync` will try to allocate it — the one way a file under the size
 * limit can still take the tab down.
 */
const MAX_DOCX_XML_BYTES = 64 * 1024 * 1024;

/**
 * The file, opened.
 *
 * `pdf` is here for the tests that need a failure nobody can conjure — an
 * encrypted PDF cannot be hand-written into a fixture. The real reader is the
 * default and is what every caller in the app uses; the tests that CAN use a
 * real file (a real PDF, a real docx, a truncated one, a JPEG called .pdf) do.
 */
export async function readSource(
  file: File,
  options: { pdf?: PdfLoader } = {},
): Promise<ReadResult> {
  // Before a byte is read. A 200 MB file that is refused after being loaded
  // into memory has already done the damage the refusal was for.
  if (file.size > MAX_SOURCE_BYTES) return fail('too-big');
  if (file.size === 0) return fail('empty');

  let bytes: Uint8Array;
  try {
    bytes = await bytesOf(file);
  } catch {
    // A file picked from cloud storage that has since gone away, or a phone
    // that ran out of room to hold it. The student did nothing wrong and the
    // fix is the same as for a corrupt file: pick it again.
    return fail('damaged');
  }

  const title = titleFromFileName(file.name);
  const kind = sniff(bytes);

  switch (kind) {
    case 'picture':
      // Refused on four bytes, without decoding an image: this is the common
      // case — a student photographs the page — and it deserves the fastest,
      // plainest "no" in the app rather than a wait that ends in one.
      return fail('no-text');
    case 'unknown':
      return fail('unsupported');
    case 'pdf':
      return finish(title, kind, await fromPdf(bytes, options.pdf ?? loadPdfjs));
    case 'zip':
      return finish(title, kind, fromDocx(bytes));
    case 'text':
      return finish(title, kind, { text: new TextDecoder().decode(bytes) });
  }
}

/**
 * The whole file, as bytes.
 *
 * `Blob.arrayBuffer` is the one line of this, and it is not everywhere:
 * it landed in Chrome 76, and a ₹10,000 Android whose System WebView has never
 * been updated does not have it — nor, as it happens, does jsdom, which is how
 * this was found rather than by a student. Without the fallback every single
 * file on such a phone came back "That file would not open", which is a lie
 * the student cannot do anything about. FileReader has been there since
 * forever and reads exactly the same bytes.
 */
async function bytesOf(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('unreadable'));
    reader.readAsArrayBuffer(file);
  });
}

/** Trim, and decide whether what came out is a document or a picture of one. */
function finish(
  title: string,
  kind: SourceKind,
  extracted: { text: string } | { problem: SourceProblem },
): ReadResult {
  if ('problem' in extracted) return fail(extracted.problem);
  /**
   * A PDF that produced almost nothing is a scan — the same answer as a
   * photograph, because it IS a photograph, one per page.
   *
   * Only a PDF. A four-word .txt is not a picture of anything, and telling a
   * student it was is a sentence they can do nothing with; it is a very short
   * file, which is an ordinary thing and gets taught like a typed topic. The
   * threshold clears page furniture — a running header, a page number — and
   * nothing else needs one.
   */
  if (kind === 'pdf' && !hasUsefulText(extracted.text)) return fail('no-text');
  if (extracted.text.trim() === '') return fail('empty');
  const { text, truncated } = trimForPlanner(extracted.text, SOURCE_LIMIT);
  return { ok: true, page: { title, text, truncated, kind } };
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/** Just enough of pdf.js to read words out of a document. */
export interface PdfLoader {
  (data: Uint8Array): Promise<{
    numPages: number;
    page(n: number): Promise<{ items: { str: string; hasEOL?: boolean }[] }>;
    close(): Promise<void>;
  }>;
}

/**
 * pdf.js, fetched only when a student actually brings a PDF.
 *
 * A dynamic import because the library and its worker are the largest thing
 * this app would ship, and the overwhelming majority of classes never touch a
 * file at all. Pulling it in at the top of a module that Home imports would
 * put it in the entry chunk, on the phone of every student who only ever taps
 * a subject tile.
 */
const loadPdfjs: PdfLoader = async (data) => {
  /**
   * THE LEGACY BUILD, DELIBERATELY.
   *
   * The modern build touches DOMMatrix at module scope — a canvas API that
   * nothing in text extraction uses — so it cannot even be IMPORTED anywhere
   * that has no canvas. That is not a theoretical environment: it is the test
   * run, which means the alternative is a PDF reader whose only proof is a
   * mock of itself, on a path where the real failures (a scan, a locked file,
   * a truncated download) are precisely what a mock cannot have.
   *
   * It costs 497 kB against 435 kB, plus 1.29 MB against 1.23 MB of worker —
   * about 120 kB, and every byte of it lazily loaded below, so a student who
   * never brings a file never fetches any of it.
   */
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  /**
   * A worker, only where there is one to have.
   *
   * Vite rewrites this literal into the hashed asset it emitted, so in the app
   * this is a real file and the parsing happens off the main thread, which is
   * what keeps a phone's UI alive while a chapter is opened.
   *
   * The guard is `Worker` and not the bundler, because it is the same question
   * asked honestly: a WebView with workers switched off by policy, and the
   * test run, both answer no — and pdf.js has a perfectly good fallback that
   * parses on this thread. Pointing workerSrc at a path that does not resolve
   * is the one thing that is worse than both: pdf.js tries to load it, fails
   * to set up even the fallback, and a valid PDF comes back as a scan.
   */
  if (typeof Worker === 'function' && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
      import.meta.url,
    ).href;
  }
  const doc = await pdfjs.getDocument({
    data,
    // A student's file is untrusted input being parsed inside our origin.
    // Pulling words out of it needs no font installed in the document and no
    // fetch of its own, and each of those is a way a crafted PDF reaches
    // further than the page it was dropped on. (pdf.js 5 removed its own eval
    // path, so there is no longer an isEvalSupported to turn off.)
    disableFontFace: true,
    useWorkerFetch: false,
  }).promise;
  return {
    numPages: doc.numPages,
    page: async (n) => {
      const content = await (await doc.getPage(n)).getTextContent();
      return {
        items: content.items.map((item) =>
          'str' in item ? { str: item.str, hasEOL: item.hasEOL } : { str: '' },
        ),
      };
    },
    close: () => doc.destroy(),
  };
};

async function fromPdf(
  bytes: Uint8Array,
  load: PdfLoader,
): Promise<{ text: string } | { problem: SourceProblem }> {
  let doc: Awaited<ReturnType<PdfLoader>>;
  try {
    doc = await load(bytes);
  } catch (error) {
    // Locked, truncated, or a file whose first bytes said %PDF and whose rest
    // did not. classifyPdfError is where those are told apart.
    return { problem: classifyPdfError(error) };
  }

  try {
    const pages: string[] = [];
    let kept = 0;
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PDF_PAGES) && kept < SOURCE_LIMIT; n += 1) {
      const { items } = await doc.page(n);
      // hasEOL is pdf.js telling us the typesetter ended a line here. It is
      // the only line-break information a PDF carries, and without it a
      // two-column page comes out as one run-on sentence per column pair.
      const text = items.map((item) => (item.hasEOL ? `${item.str}\n` : item.str)).join('');
      pages.push(text);
      kept += text.length;
    }
    // A blank line between pages, so a heading at the top of page two does not
    // fuse onto the last word of page one.
    return { text: pages.join('\n\n') };
  } catch (error) {
    return { problem: classifyPdfError(error) };
  } finally {
    // The worker holds the whole document. Left open, a student who tries four
    // files in a row is holding four of them.
    await doc.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

/**
 * A .docx, which is a zip with one XML file in it that matters.
 *
 * The same four bytes begin a .pptx, an .epub, an .odt and a holiday photo
 * album, so "is this a Word document?" is answered by whether the archive
 * contains `word/document.xml` — not by the name, which is how a .pptx renamed
 * to .docx gets the honest "I cannot open that kind of file" instead of a
 * parser error.
 */
function fromDocx(bytes: Uint8Array): { text: string } | { problem: SourceProblem } {
  let entry: Uint8Array | undefined;
  try {
    const found = unzipSync(bytes, {
      filter: (f) => f.name === 'word/document.xml' && f.originalSize <= MAX_DOCX_XML_BYTES,
    });
    entry = found['word/document.xml'];
  } catch {
    return { problem: 'damaged' };
  }
  // Nothing matched: either this zip is not a Word document, or its document
  // claims to inflate to something a phone cannot hold. Both are "not a file I
  // can open", and neither is worth two different sentences to a student.
  if (!entry) return { problem: 'unsupported' };
  return { text: textFromDocumentXml(strFromU8(entry)) };
}
