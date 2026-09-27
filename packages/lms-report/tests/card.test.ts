// @vitest-environment node
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type {
  StudentCard,
  StudentChapter,
  StudentMistake,
  StudentSubject,
  TimelineRow,
} from '@ai-tutor/lms-client';
import type { jsPDF } from 'jspdf';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { brandColour, pdfSafe, readableOn } from '../src/card.ts';
import {
  classFileName,
  reportCardBytes,
  reportCardPdf,
  reportFileName,
  type ReportData,
  type ReportOptions,
} from '../src/index.ts';

/**
 * THE REPORT CARD, READ BACK. Written first.
 *
 * What the card says is read out of the finished PDF with pdf.js — what a
 * parent's phone would show — not from the calls that drew it. Colour, which
 * pdf.js's text does not carry, is read from the page content jsPDF wrote.
 */

const require = createRequire(import.meta.url);
const standardFontDataUrl =
  join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/';

interface Run {
  str: string;
  x: number;
  y: number;
  width: number;
}

/** Each page's text runs, in drawing order, blanks dropped. */
async function readPdf(bytes: Uint8Array): Promise<{ runs: Run[][]; pages: string[][] }> {
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: false, standardFontDataUrl })
    .promise;
  const runs: Run[][] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const onPage: Run[] = [];
    for (const item of content.items) {
      if (!('str' in item) || item.str.trim() === '') continue;
      onPage.push({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width });
    }
    runs.push(onPage);
  }
  await pdf.destroy();
  return { runs, pages: runs.map((p) => p.map((r) => r.str)) };
}

/** The `n` runs drawn straight after the first run equal to `label`. */
function after(texts: string[], label: string, n = 1): string[] {
  const at = texts.indexOf(label);
  expect(at, `"${label}" is on the card`).toBeGreaterThanOrEqual(0);
  return texts.slice(at + 1, at + 1 + n);
}

/**
 * The fill colour in effect at each fill-and-stroke paint ('B') on `page`,
 * from the text `from` on, as the operands jsPDF wrote for it.
 */
function fillsAtPaints(doc: jsPDF, page: number, from: string): string[] {
  const ops = (doc.internal.pages as unknown as string[][])[page].join('\n').split('\n');
  const start = ops.findIndex((op) => op === `(${from}) Tj`);
  expect(start, `"${from}" is on page ${page}`).toBeGreaterThanOrEqual(0);
  let fill = '';
  const fills: string[] = [];
  for (const op of ops.slice(start)) {
    const colour = /^([\d. ]+) (rg|g)$/.exec(op);
    if (colour) fill = colour[1];
    else if (op === 'B') fills.push(fill);
  }
  return fills;
}

// The smallest real PNG: one transparent pixel.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// A real 2x2 JPEG, teal.
const JPEG =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAwX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCUAZHf/9k=';

const GENERATED = new Date('2026-09-27T12:00:00Z');

const riyaCard: StudentCard = {
  userId: 'u-riya',
  displayName: 'Riya Sharma',
  loginId: 'DEMO-8A-1',
  rollNumber: '1',
  sectionId: 's-8a',
  grade: 8,
  className: '8A',
  schoolName: 'Demo Public School',
};

const subjects: StudentSubject[] = [
  {
    subjectId: 'sub-math',
    subjectName: 'Mathematics',
    teacherName: 'Neha Sharma',
    workDue: 4,
    handedIn: 3,
    handinRate: 0.75,
    averageScore: 0.62,
    mastery: 0.55,
    chaptersSeen: 2,
  },
  {
    subjectId: 'sub-sci',
    subjectName: 'Science',
    teacherName: 'Arjun Mehta',
    workDue: 2,
    handedIn: 2,
    handinRate: 1,
    averageScore: 0.9,
    mastery: 0.81,
    chaptersSeen: 1,
  },
];

const chapters: StudentChapter[] = [
  { subject: 'Mathematics', chapter: 'rational-numbers', outcomesSeen: 3, answers: 12, mastery: 0.3 },
  {
    subject: 'Mathematics',
    chapter: 'linear-equations-in-one-variable',
    outcomesSeen: 2,
    answers: 9,
    mastery: 0.75,
  },
  { subject: 'Science', chapter: 'crop-production-and-management', outcomesSeen: 2, answers: 6, mastery: 0.82 },
];

function row(over: Partial<TimelineRow> & Pick<TimelineRow, 'title' | 'dueAt'>): TimelineRow {
  return {
    assignmentId: `a-${over.title}`,
    kind: 'homework',
    subjectName: 'Mathematics',
    handedIn: true,
    late: false,
    absent: false,
    score: null,
    ...over,
  };
}

const timeline: TimelineRow[] = [
  row({ title: 'Fractions worksheet', dueAt: '2026-09-10T12:00:00Z', handedIn: false }),
  row({ title: 'Integers practice', dueAt: '2026-09-12T12:00:00Z', late: true, score: 0.5 }),
  row({ title: 'Unit test 1', kind: 'test', dueAt: '2026-09-15T12:00:00Z', handedIn: false, absent: true }),
  row({ title: 'Mid-term quiz', kind: 'quiz', dueAt: '2026-09-17T12:00:00Z', score: 0.74 }),
  row({
    title: 'Plant cells quiz',
    kind: 'quiz',
    subjectName: 'Science',
    dueAt: '2026-09-18T12:00:00Z',
    score: 0.9,
  }),
  row({ title: 'Chapter 2 test', kind: 'test', dueAt: '2026-09-22T12:00:00Z', score: null }),
  row({
    title: 'Motion project',
    kind: 'assignment',
    subjectName: 'Science',
    dueAt: '2026-09-24T12:00:00Z',
    score: 0.9,
  }),
  row({ title: 'Linear equations homework', dueAt: '2026-10-03T12:00:00Z', handedIn: false }),
];

const mistakes: StudentMistake[] = [
  {
    subject: 'Mathematics',
    chapter: 'rational-numbers',
    label: 'Adds numerators and denominators separately',
    times: 4,
  },
  {
    subject: 'Mathematics',
    chapter: 'linear-equations-in-one-variable',
    label: 'Moves a term across without changing its sign',
    times: 2,
  },
];

const riya: ReportData = { card: riyaCard, subjects, chapters, timeline, mistakes };

const kabir: ReportData = {
  card: {
    ...riyaCard,
    userId: 'u-kabir',
    displayName: 'Kabir Singh',
    loginId: 'DEMO-8A-2',
    rollNumber: '2',
  },
  subjects,
  chapters,
  timeline,
  mistakes: [],
};

const opts: ReportOptions = {
  brand: { schoolName: 'Demo Public School', primary: '#0f766e' },
  generatedAt: GENERATED,
};

const bytesOf = (reports: ReportData[], o: Partial<ReportOptions> = {}) =>
  reportCardBytes(reports, { ...opts, ...o });

describe('reportCardPdf', () => {
  it('is a PDF', () => {
    const bytes = bytesOf([riya]);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(reportCardPdf([riya], opts).getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('heads the card with the school, the title and the day it was made', async () => {
    const { pages } = await readPdf(bytesOf([riya]));
    expect(pages[0]).toContain('Demo Public School');
    expect(pages[0]).toContain('Student progress report');
    expect(pages[0]).toContain('27 Sep 2026');
  });

  it('names the student, the class, the roll number and the login ID', async () => {
    const { pages } = await readPdf(bytesOf([riya]));
    expect(pages[0]).toContain('Riya Sharma');
    expect(pages[0]).toContain('Class 8A · Roll 1 · ID DEMO-8A-1');
  });

  it('writes a dash for a missing class or roll number', async () => {
    const card = { ...riyaCard, className: null, rollNumber: null };
    const { pages } = await readPdf(bytesOf([{ ...riya, card }]));
    expect(pages[0]).toContain('Class — · Roll — · ID DEMO-8A-1');
  });

  it('says whose subjects are shown when the caller says so', async () => {
    const scopeNote = 'Showing the subjects taught by Neha Sharma';
    const { pages } = await readPdf(bytesOf([riya], { scopeNote }));
    expect(pages[0]).toContain(scopeNote);
  });

  it('puts the four headline numbers in their tiles', async () => {
    const { pages } = await readPdf(bytesOf([riya]));
    // 5 of 6 pieces of work; (0.62 + 0.9) / 2; (0.55 + 0.81) / 2; 2 + 1.
    expect(after(pages[0], 'Work handed in', 2)).toEqual(['83%', '5 of 6']);
    expect(after(pages[0], 'Average mark')).toEqual(['76%']);
    expect(after(pages[0], 'Mastery', 2)).toEqual(['68%', 'Getting there']);
    expect(after(pages[0], 'Chapters practised')).toEqual(['3']);
  });

  it('writes a dash, not 0%, when nothing is due, marked or answered', async () => {
    const empty = subjects.map((s) => ({
      ...s,
      workDue: 0,
      handedIn: 0,
      handinRate: null,
      averageScore: null,
      mastery: null,
      chaptersSeen: 0,
    }));
    const { pages } = await readPdf(bytesOf([{ ...riya, subjects: empty, chapters: [], timeline: [] }]));
    expect(after(pages[0], 'Work handed in')).toEqual(['—']);
    expect(after(pages[0], 'Average mark')).toEqual(['—']);
    expect(after(pages[0], 'Mastery', 2)).toEqual(['—', 'No answers yet']);
    expect(after(pages[0], 'Chapters practised')).toEqual(['0']);
    expect(pages.flat()).toContain('Nothing marked yet.');
    expect(pages.flat()).toContain('No answers yet.');
  });

  it('lists every subject with its teacher, hand-ins, mark and mastery', async () => {
    const { pages } = await readPdf(bytesOf([riya]));
    const text = pages.flat();
    expect(after(text, 'Mathematics', 5)).toEqual(['Neha Sharma', '3/4', '62%', '55%', 'Getting there']);
    expect(after(text, 'Science', 5)).toEqual(['Arjun Mehta', '2/2', '90%', '81%', 'Secure']);
  });

  it('draws the marks over time, oldest first, and says when it shows only the last 12', async () => {
    const one = await readPdf(bytesOf([riya]));
    expect(one.pages.flat()).toContain('Marks over time');
    expect(one.pages.flat().some((s) => s.startsWith('Last 12'))).toBe(false);

    const many = Array.from({ length: 14 }, (_, i) =>
      row({ title: `Weekly quiz ${i + 1}`, kind: 'quiz', dueAt: `2026-08-${String(i + 1).padStart(2, '0')}T12:00:00Z`, score: 0.5 }),
    );
    const { pages } = await readPdf(bytesOf([{ ...riya, timeline: many }]));
    expect(pages.flat()).toContain('Last 12 of 14 marked');
    // The two oldest are the two left out.
    expect(pages.flat()).not.toContain('1 Aug');
    expect(pages.flat()).not.toContain('2 Aug');
    expect(pages.flat()).toContain('3 Aug');
    expect(pages.flat()).toContain('14 Aug');
  });

  it('draws every dot of the marks chart in the school’s colour', () => {
    const doc = reportCardPdf([{ ...riya, chapters: [], mistakes: [] }], opts);
    // Riya has four marks; '#0f766e' as jsPDF writes it.
    expect(fillsAtPaints(doc, 1, 'Marks over time')).toEqual(Array(4).fill('0.06 0.46 0.43'));
  });

  it('writes a low point’s mark under its dot, where the line does not run', async () => {
    const vee = [0.9, 0.3, 0.9].map((score, i) =>
      row({ title: `Quiz ${i + 1}`, kind: 'quiz', dueAt: `2026-09-0${i + 1}T12:00:00Z`, score }),
    );
    const { runs } = await readPdf(bytesOf([{ ...riya, timeline: vee, chapters: [], mistakes: [] }]));
    const page = runs[0];
    const title = page.findIndex((r) => r.str === 'Marks over time');
    // The axis, 0% to 100%, then each point's mark and its date.
    const [zero, , , , hundred, first, , low, , last] = page.slice(title + 1);
    expect([zero.str, hundred.str, first.str, low.str, last.str]).toEqual(['0%', '100%', '90%', '30%', '90%']);
    // Where the axis label for `v` would sit; PDF y grows upwards.
    const axisAt = (v: number) => zero.y + v * (hundred.y - zero.y);
    expect(low.y).toBeLessThan(axisAt(0.3));
    expect(first.y).toBeGreaterThan(axisAt(0.9));
    expect(last.y).toBeGreaterThan(axisAt(0.9));
  });

  it('shows each chapter by name with its band', async () => {
    const { pages } = await readPdf(bytesOf([riya]));
    const text = pages.flat();
    expect(text).toContain('Rational numbers');
    expect(text).toContain('Linear equations in one variable');
    expect(text).toContain('Crop production and management');
    expect(text).toContain('Needs help');
  });

  it('never drops chapters silently: it says how many more there are', async () => {
    const thirty = Array.from({ length: 30 }, (_, i) => ({
      subject: 'Mathematics',
      chapter: `chapter-${i + 1}`,
      outcomesSeen: 1,
      answers: 3,
      mastery: (i % 10) / 10,
    }));
    const { pages } = await readPdf(bytesOf([{ ...riya, chapters: thirty }]));
    const text = pages.flat();
    const shown = text.filter((s) => /^Chapter \d+$/.test(s)).length;
    const note = text.find((s) => /^\+\d+ more chapters$/.test(s));
    expect(note, 'a "+N more chapters" note').toBeDefined();
    expect(shown).toBeGreaterThan(0);
    expect(shown + Number(note!.slice(1).split(' ')[0])).toBe(30);
  });

  it('starts the chapter chart on the page it has reached, and carries the rest over', async () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => ({
      subject: 'Mathematics',
      chapter: `chapter-${i + 1}`,
      outcomesSeen: 1,
      answers: 3,
      mastery: i / 20,
    }));
    const { pages } = await readPdf(bytesOf([{ ...riya, chapters: fifteen }]));
    const bars = pages.map((p) => p.filter((s) => /^Chapter \d+$/.test(s)).length);
    const first = pages.findIndex((p) => p.includes('Chapter by chapter'));
    // Not pushed whole to a fresh page, leaving the rest of this one blank.
    expect(pages[first]).toContain('Marks over time');
    expect(bars[first]).toBeGreaterThanOrEqual(3);
    expect(pages[first + 1]).toContain('Chapter by chapter (continued)');
    expect(bars.reduce((a, b) => a + b, 0)).toBe(15);
  });

  it('names the likely misconceptions with how often they showed', async () => {
    const { pages } = await readPdf(bytesOf([riya]));
    const text = pages.flat();
    expect(text).toContain('Likely misconceptions');
    expect(text).toContain('4×');
    expect(text).toContain('Adds numerators and denominators separately');
    expect(text).toContain('Moves a term across without changing its sign');
  });

  it('leaves the misconceptions out when there are none', async () => {
    const { pages } = await readPdf(bytesOf([kabir]));
    expect(pages.flat()).not.toContain('Likely misconceptions');
  });

  it('gives each piece of recent work its status word and mark', async () => {
    const { pages } = await readPdf(bytesOf([riya]));
    const text = pages.flat();
    expect(after(text, 'Fractions worksheet', 3)).toEqual(['Mathematics', 'Missing', '—']);
    expect(after(text, 'Integers practice', 3)).toEqual(['Mathematics', 'Handed in late', '50%']);
    expect(after(text, 'Unit test 1', 3)).toEqual(['Mathematics', 'Absent', '—']);
    // A test not released yet: handed in, and no number.
    expect(after(text, 'Chapter 2 test', 3)).toEqual(['Mathematics', 'Handed in', '—']);
    expect(after(text, 'Motion project', 3)).toEqual(['Science', 'Handed in', '90%']);
    // Due after the card was made.
    expect(after(text, 'Linear equations homework', 3)).toEqual(['Mathematics', 'Open', '—']);
    for (const kind of ['Homework', 'Test', 'Quiz', 'Assignment']) expect(text).toContain(kind);
  });

  it('lists recent work newest first, ten at most, and says so when it cuts', async () => {
    const many = Array.from({ length: 13 }, (_, i) =>
      row({ title: `Worksheet ${i + 1}`, dueAt: `2026-09-${String(i + 1).padStart(2, '0')}T12:00:00Z` }),
    );
    const { pages } = await readPdf(bytesOf([{ ...riya, timeline: many }]));
    const text = pages.flat();
    const titles = text.filter((s) => /^Worksheet \d+$/.test(s));
    expect(titles).toEqual(Array.from({ length: 10 }, (_, i) => `Worksheet ${13 - i}`));
    expect(text).toContain('Latest 10 of 13');
  });

  it('cuts a long title with an ellipsis, and keeps every word on the page', async () => {
    const long = 'A very long homework title that keeps going '.repeat(6).trim();
    const name = 'Riya Sharma Venkataraghavan Subramanian Chattopadhyay Krishnamurthy';
    const school = 'The Very Long Name Public Senior Secondary School and Junior College, New Delhi';
    const report = {
      ...riya,
      card: { ...riyaCard, displayName: name },
      timeline: [row({ title: long, dueAt: '2026-09-20T12:00:00Z', score: 0.8 })],
    };
    const { runs, pages } = await readPdf(bytesOf([report], { brand: { schoolName: school } }));
    expect(pages.flat()).not.toContain(long);
    expect(pages.flat().some((s) => s.startsWith('A very long homework') && s.endsWith('…'))).toBe(true);
    // A4 is 595.28 x 841.89 points.
    for (const r of runs.flat()) {
      expect(r.x, r.str).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width, r.str).toBeLessThanOrEqual(595.28);
      expect(r.y, r.str).toBeGreaterThanOrEqual(0);
      expect(r.y, r.str).toBeLessThanOrEqual(841.89);
    }
  });

  it('gives each student their own pages, each numbered, each with the footnote', async () => {
    const { pages } = await readPdf(bytesOf([riya, kabir]));
    const riyaPage = pages.findIndex((p) => p.includes('Riya Sharma'));
    const kabirPage = pages.findIndex((p) => p.includes('Kabir Singh'));
    expect(riyaPage).toBe(0);
    expect(kabirPage).toBeGreaterThan(riyaPage);
    // Riya's pages carry only her name; Kabir's numbering starts again at 1.
    for (const p of pages.slice(0, kabirPage)) expect(p).not.toContain('Kabir Singh');
    expect(pages[kabirPage].join(' ')).toMatch(/Page 1 of \d+/);
    for (const p of pages) {
      expect(p.join(' ')).toMatch(/Page \d+ of \d+/);
      expect(p).toContain(
        "Mastery is Qrie's learning model's belief from every answer the student gave — not a mark.",
      );
      expect(p).toContain('Generated 27 Sep 2026');
    }
  });

  it('puts the student’s name at the top of every page after the first', async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      ...subjects[0],
      subjectId: `s${i}`,
      subjectName: `Subject ${i + 1}`,
    }));
    const { pages } = await readPdf(bytesOf([{ ...riya, subjects: many }]));
    expect(pages.length).toBeGreaterThan(1);
    // The first words drawn on the page: the small header, not the footer.
    for (const p of pages.slice(1)) expect(p[0]).toBe('Riya Sharma');
  });

  it('embeds a logo, and draws none (without failing) when the logo is not an image', async () => {
    const withLogo = bytesOf([riya], {
      brand: { schoolName: 'Demo Public School', logo: { mime: 'image/png', base64: PNG } },
    });
    expect(new TextDecoder('latin1').decode(withLogo)).toContain('/Subtype /Image');

    let broken: Uint8Array | undefined;
    expect(() => {
      broken = bytesOf([riya], {
        brand: { schoolName: 'Demo Public School', logo: { mime: 'image/png', base64: 'not a png at all' } },
      });
    }).not.toThrow();
    expect(new TextDecoder('latin1').decode(broken!)).not.toContain('/Subtype /Image');
    const { pages } = await readPdf(broken!);
    expect(pages[0]).toContain('Demo Public School');
  });

  it('embeds a JPEG logo as a JPEG', () => {
    const bytes = bytesOf([riya], {
      brand: { schoolName: 'Demo Public School', logo: { mime: 'image/jpeg', base64: JPEG } },
    });
    const raw = new TextDecoder('latin1').decode(bytes);
    expect(raw).toContain('/Subtype /Image');
    expect(raw).toContain('/Filter /DCTDecode');
  });

  it('falls back to the default colour for anything that is not #rrggbb', () => {
    expect(() => bytesOf([riya], { brand: { schoolName: 'X', primary: 'red; x' } })).not.toThrow();
    expect(brandColour('red; x')).toBe('#4f46e5');
    expect(brandColour(null)).toBe('#4f46e5');
    expect(brandColour(undefined)).toBe('#4f46e5');
    expect(brandColour('#0F766E')).toBe('#0f766e');
  });

  it('writes on the header in black or white, whichever reads better', () => {
    expect(readableOn('#4f46e5')).toBe('#ffffff');
    expect(readableOn('#0f766e')).toBe('#ffffff');
    expect(readableOn('#facc15')).toBe('#000000');
    expect(readableOn('#ffffff')).toBe('#000000');
  });

  it('does not fail on a name in Devanagari', async () => {
    const card = { ...riyaCard, displayName: 'रिया शर्मा' };
    let bytes: Uint8Array | undefined;
    expect(() => {
      bytes = bytesOf([{ ...riya, card }]);
    }).not.toThrow();
    const { pages } = await readPdf(bytes!);
    expect(pages[0]).toContain('Class 8A · Roll 1 · ID DEMO-8A-1');
  });

  it('puts nothing on the card that it was not given', async () => {
    const { pages } = await readPdf(bytesOf([riya]));
    const text = pages.flat().join(' ');
    expect(text).not.toMatch(/PIN/i);
    expect(text).not.toContain('u-riya');
    expect(text).not.toContain('s-8a');
  });

  it('makes a one-page PDF that says so when there are no students', async () => {
    const { pages } = await readPdf(bytesOf([]));
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain('No students in this report.');
  });
});

describe('pdfSafe', () => {
  it('keeps what Helvetica can draw', () => {
    const s = 'Zoë — “quoted” ‘x’ … • × · – ½ ß';
    expect(pdfSafe(s)).toBe(s);
    expect(pdfSafe('Rs 5 € ™')).toBe('Rs 5 € ™');
  });

  it('turns anything else into a question mark, one per character', () => {
    expect(pdfSafe('रिया')).toBe('????');
    expect(pdfSafe('Riya 😀')).toBe('Riya ?');
    expect(pdfSafe('₹5')).toBe('?5');
  });

  it('turns tabs and line breaks into spaces, and composes accents first', () => {
    expect(pdfSafe('a\tb\nc\r\nd')).toBe('a b c  d');
    expect(pdfSafe('Zoë')).toBe('Zoë');
  });
});

describe('file names', () => {
  it('names a student’s card from the name and class, in safe characters', () => {
    expect(reportFileName(riyaCard)).toBe('Riya-Sharma-8A-report.pdf');
    expect(reportFileName({ ...riyaCard, displayName: ' Riya / Sharma  ' })).toBe('Riya-Sharma-8A-report.pdf');
    expect(reportFileName({ ...riyaCard, displayName: 'Zoë D’Souza' })).toBe('Zoe-D-Souza-8A-report.pdf');
    expect(reportFileName({ ...riyaCard, className: null })).toBe('Riya-Sharma-report.pdf');
  });

  it('falls back to the login ID when the name has no safe characters', () => {
    expect(reportFileName({ ...riyaCard, displayName: 'रिया' })).toBe('DEMO-8A-1-8A-report.pdf');
  });

  it('names a class’s cards', () => {
    expect(classFileName('8A')).toBe('Class-8A-report-cards.pdf');
    expect(classFileName(' 8 / A ')).toBe('Class-8-A-report-cards.pdf');
  });
});
