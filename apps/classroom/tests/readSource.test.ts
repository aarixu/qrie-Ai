import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readSource, type PdfLoader } from '../src/lib/readSource';
import { SOURCE_LIMIT } from '../src/lib/sourceText';

/**
 * OPENING REAL FILES.
 *
 * Every fixture here is a FILE — a valid PDF with a real xref, a real zip
 * inflated by the real inflate, a JPEG's actual first bytes — and it is opened
 * by the same `readSource` the Ask box calls, with the real pdf.js behind it.
 * A mocked reader would have passed every one of these and proved nothing: the
 * property under test is that a student's file, in the shapes students' files
 * actually arrive in, becomes either words or a sentence they can act on.
 *
 * The one thing that is stood in for is an encrypted PDF, because a correct
 * one cannot be hand-written into a fixture. What it stands in for is narrow —
 * the shape of the exception pdf.js throws — and the classification it feeds
 * is pure and tested on its own in sourceText.test.ts.
 */

/**
 * A File, from bytes.
 *
 * `.slice()` and not `.buffer`: a Uint8Array can be a VIEW onto a longer
 * buffer, and handing that buffer to File is how a 60-byte fixture becomes the
 * whole 700-byte document it was cut from. slice copies exactly these bytes.
 */
const file = (bytes: Uint8Array | string, name: string): File =>
  new File([(typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes).slice().buffer], name);

/**
 * A real PDF: five objects, a real cross-reference table with real byte
 * offsets, and lines of Helvetica. pdf.js parses this the way it parses a
 * chapter off a board's website.
 *
 * Every line is positioned absolutely rather than by T*, because T* asks the
 * standard-14 font METRICS where the next line starts and those are a download
 * this reader deliberately does not do (see lib/readSource). Written with T*,
 * this fixture yielded its first line and silently dropped every line after
 * it — which is a fact about the fixture, not about a real chapter, whose
 * fonts are embedded in it.
 */
function pdfSaying(...lines: string[]): Uint8Array {
  const stream = lines
    .map((line, i) => `BT\n/F1 12 Tf\n72 ${720 - (i % 50) * 14} Td\n(${line}) Tj\nET`)
    .join('\n');
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`,
  ];

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const startxref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${startxref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/** A real .docx: a zip with the one entry that matters inside it. */
function docxSaying(...paragraphs: string[]): Uint8Array {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('');
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'word/document.xml': strToU8(
      `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`,
    ),
  });
}

describe('a PDF, read on the phone it was picked on', () => {
  it('becomes the words that were in it', async () => {
    const result = await readSource(file(pdfSaying('Photosynthesis is how a green plant makes food.'), 'ch6.pdf'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.page.text).toContain('Photosynthesis is how a green plant makes food.');
    expect(result.page.title).toBe('ch6');
    expect(result.page.truncated).toBe(false);
  });

  it('keeps the lines the typesetter ended', async () => {
    const result = await readSource(
      file(pdfSaying('Nutrition is how a plant feeds.', 'Respiration is how it breathes.'), 'notes.pdf'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.page.text).toContain('Nutrition is how a plant feeds.');
    expect(result.page.text).toContain('Respiration is how it breathes.');
  });

  it('is a scan when no words come out of it', async () => {
    // A PDF of photographs is not empty — it has pages, a producer, a page
    // tree. It has no words, and that is the only property that decides this.
    const result = await readSource(file(pdfSaying(''), 'scan.pdf'));
    expect(result).toEqual({ ok: false, problem: 'no-text' });
  });

  it('is damaged when it stops halfway', async () => {
    const half = pdfSaying('Half a chapter.').slice(0, 60);
    const result = await readSource(file(half, 'cut-off.pdf'));
    expect(result).toEqual({ ok: false, problem: 'damaged' });
  });

  it('is locked when it wants a password', async () => {
    const locked: PdfLoader = () => Promise.reject(Object.assign(new Error('No password'), { name: 'PasswordException' }));
    const result = await readSource(file(pdfSaying('secret'), 'exam.pdf'), { pdf: locked });
    expect(result).toEqual({ ok: false, problem: 'locked' });
  });

  it('stops at the opening of a long one and says so', async () => {
    // Comfortably more than SOURCE_LIMIT, in lines of the length a typesetter
    // actually sets — pdf.js hands back one item per Tj, and a single
    // four-hundred-character Tj is not what a chapter looks like.
    const chapter = pdfSaying(
      ...Array.from(
        { length: 200 },
        (_, i) => `Line ${i}. Chlorophyll absorbs the light and the leaf makes its own food from it.`,
      ),
    );
    const result = await readSource(file(chapter, 'long.pdf'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.page.truncated).toBe(true);
    expect(result.page.text.length).toBeLessThanOrEqual(SOURCE_LIMIT);
  });
});

describe('a Word document', () => {
  it('becomes its paragraphs', async () => {
    const result = await readSource(file(docxSaying('Nutrition in plants.', 'Autotrophic and heterotrophic.'), 'notes.docx'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.page.text).toBe('Nutrition in plants.\nAutotrophic and heterotrophic.');
    expect(result.page.kind).toBe('zip');
  });

  it('is not opened just because the name says docx', async () => {
    // A .pptx renamed is the commonest way this arrives, and four bytes of PK
    // is all the two have in common.
    const deck = zipSync({ 'ppt/presentation.xml': strToU8('<p/>') });
    expect(await readSource(file(deck, 'chapter.docx'))).toEqual({ ok: false, problem: 'unsupported' });
  });

  it('is damaged when the zip is', async () => {
    const broken = docxSaying('Nutrition.').slice(0, 40);
    expect(await readSource(file(broken, 'notes.docx'))).toEqual({ ok: false, problem: 'damaged' });
  });
});

describe('plain text', () => {
  it('is read as it stands', async () => {
    const result = await readSource(file('Ohm ka law: V = I R. Resistance kya hoti hai?', 'doubt.txt'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.page.text).toBe('Ohm ka law: V = I R. Resistance kya hoti hai?');
  });

  it('reads Hindi without mangling it', async () => {
    const result = await readSource(file('प्रकाश संश्लेषण हरे पौधों में होता है और भोजन बनता है।', 'hindi.txt'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.page.text).toContain('प्रकाश संश्लेषण');
  });
});

describe('the files that are not what they say they are', () => {
  it('sees a photograph wearing a .pdf', async () => {
    const jpeg = new Uint8Array(500);
    jpeg.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    expect(await readSource(file(jpeg, 'chapter 6.pdf'))).toEqual({ ok: false, problem: 'no-text' });
  });

  it('sees a binary wearing a .txt', async () => {
    const song = new Uint8Array(2000);
    song.set([0x49, 0x44, 0x33, 0x04]);
    for (let i = 4; i < song.length; i += 1) song[i] = i % 5 === 0 ? 0x00 : 0xa7;
    expect(await readSource(file(song, 'notes.txt'))).toEqual({ ok: false, problem: 'unsupported' });
  });
});

describe('the sizes', () => {
  it('refuses a 200 MB file without reading a byte of it', async () => {
    // The invariant, not the symptom: a file this size is refused because it
    // was never loaded. Reading it first and refusing afterwards has already
    // done the thing the refusal is for — on a 4 GB phone that is a tab the
    // operating system kills, with no error anyone can catch.
    let opened = false;
    const enormous = {
      name: 'scanned book.pdf',
      size: 200 * 1024 * 1024,
      arrayBuffer: () => {
        opened = true;
        return Promise.resolve(new ArrayBuffer(0));
      },
    } as unknown as File;
    expect(await readSource(enormous)).toEqual({ ok: false, problem: 'too-big' });
    expect(opened).toBe(false);
  });

  it('says an empty file is empty', async () => {
    expect(await readSource(file(new Uint8Array(0), 'nothing.pdf'))).toEqual({ ok: false, problem: 'empty' });
  });

  it('says so when the file goes away while it is being read', async () => {
    // A file picked out of Drive that is no longer there, or a phone with no
    // room to hold it. The student did nothing wrong and the fix is the same
    // as for a corrupt file: pick it again.
    const vanished = {
      name: 'ch6.pdf',
      size: 1024,
      arrayBuffer: () => Promise.reject(new DOMException('NotReadableError')),
    } as unknown as File;
    expect(await readSource(vanished)).toEqual({ ok: false, problem: 'damaged' });
  });
});

describe('nothing a file does reaches the caller as an exception', () => {
  it.each([
    ['a photograph', new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 'photo.jpg'],
    ['a truncated PDF', new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<</Type/Cat'), 'bad.pdf'],
    ['an empty zip', zipSync({}), 'empty.docx'],
    ['four random bytes', new Uint8Array([0x01, 0x02, 0x03, 0x04]), 'what.pdf'],
  ])('%s comes back as a value', async (_what, bytes, name) => {
    // The one property the whole screen depends on. Every failure below was
    // once an exception somewhere above a screen, and an exception above a
    // screen is a white page on a phone.
    const result = await readSource(file(bytes, name));
    expect(result.ok).toBe(false);
  });
});
