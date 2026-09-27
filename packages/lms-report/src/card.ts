import { jsPDF } from 'jspdf';
import { readableOn } from '@ai-tutor/lms-client';
import type {
  AssignmentKind,
  StudentCard,
  StudentChapter,
  StudentMistake,
  StudentSubject,
  TimelineRow,
} from '@ai-tutor/lms-client';

/**
 * THE STUDENT PROGRESS REPORT CARD, AS A PDF.
 *
 * One or more A4 pages per student, drawn as vectors with jsPDF's own
 * primitives — no screenshot of a screen, no DOM — so the same code runs in
 * the teacher's browser and in a test. The school's logo is the one picture.
 * Every name, number and date on a card comes from the `ReportData` and
 * `ReportOptions` it is given; nothing else is looked up.
 */

export interface ReportBrand {
  schoolName: string;
  /** '#rrggbb'; anything else is ignored and the default is used. */
  primary?: string | null;
  logo?: { mime: 'image/png' | 'image/jpeg'; base64: string } | null;
}

export interface ReportData {
  card: StudentCard;
  subjects: StudentSubject[];
  chapters: StudentChapter[];
  timeline: TimelineRow[];
  mistakes: StudentMistake[];
}

export interface ReportOptions {
  brand: ReportBrand;
  generatedAt: Date;
  /** e.g. 'Showing the subjects taught by Neha Sharma'. */
  scopeNote?: string;
}

const DEFAULT_PRIMARY = '#4f46e5';
const HEX = /^#[0-9a-f]{6}$/i;

// A4 portrait, in millimetres.
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 12;
const CONTENT_W = PAGE_W - 2 * MARGIN;
/** Nothing but the footer is drawn below this line. */
const BODY_BOTTOM = PAGE_H - 18;

const INK = '#111827';
const MUTED = '#6b7280';
const FAINT = '#9ca3af';
const RULE = '#e5e7eb';
const TRACK = '#f3f4f6';
const TILE = '#f9fafb';
const RED = '#dc2626';
const AMBER = '#d97706';
const GREEN = '#16a34a';

const MAX_MARKS = 12;
/** The chapter chart's longest; the rest are counted in a note, not drawn. */
const MAX_CHAPTER_BARS = 15;
const MAX_MISTAKES = 5;
const MAX_RECENT = 10;

const FOOTNOTE =
  "Mastery is Qrie's learning model's belief from every answer the student gave — not a mark.";

// --- Text -------------------------------------------------------------------

/** Windows-1252's 0x80-0x9F block: the characters above Latin-1 that Helvetica here can draw. */
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/**
 * `text` in characters jsPDF's standard fonts can draw: ASCII, Latin-1 and
 * the Windows-1252 extras (dashes, curly quotes, ellipsis, bullet). Tabs and
 * line breaks become spaces; any other character becomes one '?'.
 */
export function pdfSafe(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0)!;
    if (ch === '\t' || ch === '\n' || ch === '\r') out += ' ';
    else if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(ch)) {
      out += ch;
    } else out += '?';
  }
  return out;
}

/** `text` cut to `max` mm in the current font, ending in '…' when cut. */
function fit(doc: jsPDF, text: string, max: number): string {
  if (doc.getTextWidth(text) <= max) return text;
  const cut = (n: number) => text.slice(0, n).trimEnd() + '…';
  let lo = 0;
  let hi = text.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.getTextWidth(cut(mid)) <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? cut(lo) : '';
}

interface TextStyle {
  size: number;
  bold?: boolean;
  italic?: boolean;
  colour?: string;
  align?: 'left' | 'center' | 'right';
  baseline?: 'alphabetic' | 'middle';
  /** Cut with '…' past this many mm. */
  maxWidth?: number;
}

function font(doc: jsPDF, style: TextStyle): void {
  doc.setFont('helvetica', style.bold ? 'bold' : style.italic ? 'italic' : 'normal');
  doc.setFontSize(style.size);
}

/** Draws `value`, made safe and cut to fit; returns the width drawn, in mm. */
function put(doc: jsPDF, value: string, x: number, y: number, style: TextStyle): number {
  font(doc, style);
  doc.setTextColor(style.colour ?? INK);
  const safe = pdfSafe(value);
  const shown = style.maxWidth === undefined ? safe : fit(doc, safe, style.maxWidth);
  if (shown.trim() === '') return 0;
  doc.text(shown, x, y, { align: style.align ?? 'left', baseline: style.baseline ?? 'alphabetic' });
  return doc.getTextWidth(shown);
}

function widthOf(doc: jsPDF, value: string, style: TextStyle): number {
  font(doc, style);
  return doc.getTextWidth(pdfSafe(value));
}

// --- Words and numbers ------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '27 Sep', in the time zone of the device making the card. */
function dayMonth(d: Date): string {
  return Number.isNaN(d.getTime()) ? '—' : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** '27 Sep 2026'. */
function dayMonthYear(d: Date): string {
  return Number.isNaN(d.getTime()) ? '—' : `${dayMonth(d)} ${d.getFullYear()}`;
}

const pct = (x: number | null): string => (x === null ? '—' : `${Math.round(x * 100)}%`);
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;
const orDash = (s: string | null): string => (s && s.trim() ? s : '—');

function mean(xs: (number | null)[]): number | null {
  const known = xs.filter((x): x is number => x !== null);
  return known.length ? sum(known) / known.length : null;
}

/** 'rational-numbers' => 'Rational numbers'. */
function chapterWords(slug: string): string {
  const words = slug.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface Word {
  word: string;
  colour: string;
}

function masteryBand(m: number | null): Word {
  if (m === null) return { word: 'No answers yet', colour: MUTED };
  if (m < 0.4) return { word: 'Needs help', colour: RED };
  if (m < 0.7) return { word: 'Getting there', colour: AMBER };
  return { word: 'Secure', colour: GREEN };
}

const KIND_WORD: Record<AssignmentKind, string> = {
  homework: 'Homework',
  test: 'Test',
  assignment: 'Assignment',
  quiz: 'Quiz',
};

function statusOf(row: TimelineRow, now: Date): Word {
  if (row.absent) return { word: 'Absent', colour: MUTED };
  if (row.handedIn && row.late) return { word: 'Handed in late', colour: AMBER };
  if (row.handedIn) return { word: 'Handed in', colour: GREEN };
  if (Date.parse(row.dueAt) > now.getTime()) return { word: 'Open', colour: MUTED };
  return { word: 'Missing', colour: RED };
}

const oldestFirst = (a: TimelineRow, b: TimelineRow): number => Date.parse(a.dueAt) - Date.parse(b.dueAt);

// --- Colour -----------------------------------------------------------------

/** The school's colour when it is a '#rrggbb', else the default; lower case. */
export function brandColour(primary: string | null | undefined): string {
  return typeof primary === 'string' && HEX.test(primary) ? primary.toLowerCase() : DEFAULT_PRIMARY;
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

// Black or white on the school's colour: the apps' own rule (lms-client).
export { readableOn };

/** `a` moved `t` of the way to `b`. */
function mix(a: string, b: string, t: number): string {
  const [x, y] = [channels(a), channels(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

interface Palette {
  primary: string;
  onPrimary: string;
  /** Lines, bars and rings on white paper. */
  accent: string;
  tint: string;
}

function paletteOf(primary: string | null | undefined): Palette {
  const base = brandColour(primary);
  const onPrimary = readableOn(base);
  // A colour light enough to take black text is too faint to draw with on white.
  const accent = onPrimary === '#000000' ? mix(base, '#000000', 0.45) : base;
  return { primary: base, onPrimary, accent, tint: mix(accent, '#ffffff', 0.88) };
}

// --- Shapes -----------------------------------------------------------------

function polyline(doc: jsPDF, points: [number, number][]): void {
  const [x0, y0] = points[0];
  const steps = points.slice(1).map(([x, y], i) => [x - points[i][0], y - points[i][1]]);
  doc.lines(steps, x0, y0, [1, 1], 'S', false);
}

/** A donut gauge: a grey track, and `fraction` of it in `colour` clockwise from the top. */
function ring(doc: jsPDF, cx: number, cy: number, r: number, fraction: number | null, colour: string): void {
  doc.setLineWidth(2.2);
  doc.setDrawColor(TRACK);
  doc.circle(cx, cy, r, 'S');
  if (fraction === null || fraction <= 0) return;
  const f = clamp01(fraction);
  const n = Math.max(2, Math.ceil(f * 90));
  const points: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * f * 2 * Math.PI;
    points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  doc.setDrawColor(colour);
  doc.setLineCap('round');
  doc.setLineJoin('round');
  polyline(doc, points);
  doc.setLineCap('butt');
  doc.setLineJoin('miter');
}

/** A rounded bar `fraction` of `w` long on a grey track. */
function bar(doc: jsPDF, x: number, y: number, w: number, h: number, fraction: number | null, colour: string): void {
  doc.setFillColor(TRACK);
  doc.roundedRect(x, y, w, h, h / 2, h / 2, 'F');
  if (fraction === null || fraction <= 0) return;
  const len = Math.max(h, clamp01(fraction) * w);
  doc.setFillColor(colour);
  doc.roundedRect(x, y, len, h, h / 2, h / 2, 'F');
}

function rule(doc: jsPDF, x1: number, y: number, x2: number): void {
  doc.setDrawColor(RULE);
  doc.setLineWidth(0.2);
  doc.line(x1, y, x2, y);
}

// --- Page flow --------------------------------------------------------------

/** One student's pages as they are drawn: `y` is where the next thing goes. */
interface Sheet {
  doc: jsPDF;
  palette: Palette;
  opts: ReportOptions;
  card: StudentCard;
  y: number;
}

/** A further page for this student, under the small header. */
function newPage(s: Sheet): void {
  s.doc.addPage('a4', 'portrait');
  smallHeader(s);
}

/** Starts a new page for this student when `height` mm will not fit on this one. */
function room(s: Sheet, height: number): void {
  if (s.y + height > BODY_BOTTOM) newPage(s);
}

/** A section title, kept on the same page as the first `need` mm under it. */
function heading(s: Sheet, title: string, note: string | undefined, need: number): void {
  room(s, 9 + need);
  put(s.doc, title, MARGIN, s.y + 4, { size: 11, bold: true });
  if (note) put(s.doc, note, PAGE_W - MARGIN, s.y + 4, { size: 7.5, colour: MUTED, align: 'right' });
  s.y += 9;
}

function quiet(s: Sheet, line: string): void {
  put(s.doc, line, MARGIN, s.y + 3, { size: 9, colour: MUTED });
  s.y += 10;
}

// --- Sections ---------------------------------------------------------------

/** Draws the logo in a `size` mm square; false, and nothing drawn, when it is not an image. */
function logo(doc: jsPDF, image: ReportBrand['logo'], x: number, y: number, size: number): boolean {
  if (!image) return false;
  try {
    const data = `data:${image.mime};base64,${image.base64}`;
    const { width, height } = doc.getImageProperties(data);
    if (!(width > 0 && height > 0)) return false;
    const scale = Math.min(size / width, size / height);
    const [w, h] = [width * scale, height * scale];
    doc.setFillColor('#ffffff');
    doc.roundedRect(x - 1, y - 1, size + 2, size + 2, 2, 2, 'F');
    doc.addImage(data, image.mime === 'image/png' ? 'PNG' : 'JPEG', x + (size - w) / 2, y + (size - h) / 2, w, h);
    return true;
  } catch {
    return false;
  }
}

/** The band across the top of a student's first page. Returns the y below it. */
function header(doc: jsPDF, palette: Palette, opts: ReportOptions): number {
  const height = 30;
  doc.setFillColor(palette.primary);
  doc.rect(0, 0, PAGE_W, height, 'F');
  const x = logo(doc, opts.brand.logo, MARGIN, 6, 18) ? MARGIN + 23 : MARGIN;
  const on = palette.onPrimary;
  const dateW = put(doc, dayMonthYear(opts.generatedAt), PAGE_W - MARGIN, 13, {
    size: 9,
    colour: on,
    align: 'right',
  });
  put(doc, opts.brand.schoolName, x, 13.5, {
    size: 15,
    bold: true,
    colour: on,
    maxWidth: PAGE_W - MARGIN - x - dateW - 6,
  });
  put(doc, 'Student progress report', x, 21, { size: 10, colour: on, maxWidth: PAGE_W - MARGIN - x });
  return height + 8;
}

/** The top of every page after a student's first. */
function smallHeader(s: Sheet): void {
  const { doc, palette } = s;
  doc.setFillColor(palette.primary);
  doc.rect(0, 0, PAGE_W, 14, 'F');
  put(doc, s.card.displayName, MARGIN, 9, {
    size: 10,
    bold: true,
    colour: palette.onPrimary,
    maxWidth: CONTENT_W * 0.55,
  });
  put(doc, s.opts.brand.schoolName, PAGE_W - MARGIN, 9, {
    size: 8,
    colour: palette.onPrimary,
    align: 'right',
    maxWidth: CONTENT_W * 0.4,
  });
  s.y = 22;
}

function studentBlock(s: Sheet): void {
  const { doc, card } = s;
  put(doc, card.displayName, MARGIN, s.y + 5, { size: 18, bold: true, maxWidth: CONTENT_W });
  const who = `Class ${orDash(card.className)} · Roll ${orDash(card.rollNumber)} · ID ${card.loginId}`;
  put(doc, who, MARGIN, s.y + 11, { size: 9.5, colour: MUTED, maxWidth: CONTENT_W });
  s.y += 11;
  if (s.opts.scopeNote) {
    put(doc, s.opts.scopeNote, MARGIN, s.y + 5, { size: 8.5, italic: true, colour: MUTED, maxWidth: CONTENT_W });
    s.y += 5;
  }
  s.y += 6;
}

interface Kpi {
  label: string;
  value: string;
  /** The ring's fill; undefined draws a plain disc instead of a ring. */
  fraction?: number | null;
  colour: string;
  detail: string;
  detailColour: string;
}

function kpiTile(s: Sheet, x: number, w: number, h: number, k: Kpi): void {
  const { doc, palette } = s;
  const y = s.y;
  doc.setFillColor(TILE);
  doc.setDrawColor(RULE);
  doc.setLineWidth(0.2);
  doc.roundedRect(x, y, w, h, 2.5, 2.5, 'FD');
  const [cx, cy, r] = [x + w / 2, y + 13, 8.5];
  const inner = { maxWidth: w - 6, align: 'center' as const };
  put(doc, k.label, cx, y + 28, { size: 7.5, bold: true, colour: MUTED, ...inner });
  if (k.fraction === undefined) {
    doc.setFillColor(palette.tint);
    doc.circle(cx, cy, r + 1.1, 'F');
    put(doc, k.value, cx, cy, { size: 13, bold: true, colour: k.colour, baseline: 'middle', ...inner });
  } else {
    ring(doc, cx, cy, r, k.fraction, k.colour);
    put(doc, k.value, cx, cy, { size: 9.5, bold: true, baseline: 'middle', ...inner });
  }
  put(doc, k.detail, cx, y + 32.5, { size: 7.5, colour: k.detailColour, ...inner });
}

function kpis(s: Sheet, subjects: StudentSubject[]): void {
  const due = sum(subjects.map((x) => x.workDue));
  const handed = sum(subjects.map((x) => x.handedIn));
  const handin = due > 0 ? handed / due : null;
  const marked = subjects.filter((x) => x.averageScore !== null).length;
  const average = mean(subjects.map((x) => x.averageScore));
  const mastery = mean(subjects.map((x) => x.mastery));
  const band = masteryBand(mastery);
  const chapters = sum(subjects.map((x) => x.chaptersSeen));
  const practised = subjects.filter((x) => x.chaptersSeen > 0).length;
  const accent = s.palette.accent;

  const tiles: Kpi[] = [
    {
      label: 'Work handed in',
      value: pct(handin),
      fraction: handin,
      colour: accent,
      detail: due > 0 ? `${handed} of ${due}` : 'Nothing due yet',
      detailColour: MUTED,
    },
    {
      label: 'Average mark',
      value: pct(average),
      fraction: average,
      colour: accent,
      detail: average === null ? 'Nothing marked yet' : `across ${plural(marked, 'subject')}`,
      detailColour: MUTED,
    },
    {
      label: 'Mastery',
      value: pct(mastery),
      fraction: mastery,
      colour: band.colour,
      detail: band.word,
      detailColour: band.colour,
    },
    {
      label: 'Chapters practised',
      value: String(chapters),
      colour: accent,
      detail: chapters > 0 ? `across ${plural(practised, 'subject')}` : 'None yet',
      detailColour: MUTED,
    },
  ];
  const [gap, h] = [4, 36];
  const w = (CONTENT_W - 3 * gap) / 4;
  room(s, h);
  tiles.forEach((k, i) => kpiTile(s, MARGIN + i * (w + gap), w, h, k));
  s.y += h + 8;
}

interface Column {
  title: string;
  x: number;
  w: number;
  align?: 'left' | 'right';
}

function tableHead(s: Sheet, columns: Column[]): void {
  const { doc } = s;
  doc.setFillColor(TILE);
  doc.rect(MARGIN, s.y, CONTENT_W, 7, 'F');
  for (const c of columns) {
    const x = c.align === 'right' ? c.x + c.w : c.x;
    put(doc, c.title, x, s.y + 4.7, { size: 7, bold: true, colour: MUTED, align: c.align, maxWidth: c.w });
  }
  s.y += 7;
}

/** Rows that run past the page continue on the next, under the column titles again. */
function tableRows<T>(s: Sheet, columns: Column[], rows: T[], rowH: number, draw: (row: T, y: number) => void): void {
  tableHead(s, columns);
  for (const row of rows) {
    if (s.y + rowH > BODY_BOTTOM) {
      newPage(s);
      tableHead(s, columns);
    }
    draw(row, s.y);
    rule(s.doc, MARGIN, s.y + rowH, MARGIN + CONTENT_W);
    s.y += rowH;
  }
  s.y += 7;
}

function subjectsTable(s: Sheet, subjects: StudentSubject[]): void {
  const rowH = 7.5;
  heading(s, 'Subjects', undefined, 7 + Math.min(3, subjects.length) * rowH);
  if (!subjects.length) return quiet(s, 'No subjects yet.');
  const x0 = MARGIN + 2;
  const cols: Column[] = [
    { title: 'Subject', x: x0, w: 42 },
    { title: 'Teacher', x: x0 + 44, w: 38 },
    { title: 'Handed in', x: x0 + 84, w: 38 },
    { title: 'Average mark', x: x0 + 124, w: 20 },
    { title: 'Mastery', x: x0 + 146, w: CONTENT_W - 150 },
  ];
  const { doc, palette } = s;
  tableRows(s, cols, subjects, rowH, (sub, y) => {
    const base = y + 5;
    put(doc, sub.subjectName, cols[0].x, base, { size: 8.5, bold: true, maxWidth: cols[0].w });
    put(doc, orDash(sub.teacherName), cols[1].x, base, { size: 8.5, colour: MUTED, maxWidth: cols[1].w });
    if (sub.workDue > 0) {
      put(doc, `${sub.handedIn}/${sub.workDue}`, cols[2].x, base, { size: 8.5, maxWidth: 12 });
      bar(doc, cols[2].x + 13, y + 2.7, 22, 2.2, sub.handedIn / sub.workDue, palette.accent);
    } else put(doc, '—', cols[2].x, base, { size: 8.5, colour: MUTED });
    put(doc, pct(sub.averageScore), cols[3].x, base, { size: 8.5, maxWidth: cols[3].w });
    const band = masteryBand(sub.mastery);
    const w = put(doc, pct(sub.mastery), cols[4].x, base, { size: 8.5, bold: true, colour: band.colour });
    put(doc, band.word, cols[4].x + w + 2, base, { size: 7.5, colour: band.colour, maxWidth: cols[4].w - w - 2 });
  });
}

function marksChart(s: Sheet, timeline: TimelineRow[]): void {
  const marked = timeline.filter((r) => r.score !== null).sort(oldestFirst);
  const shown = marked.slice(-MAX_MARKS);
  const note = marked.length > MAX_MARKS ? `Last ${MAX_MARKS} of ${marked.length} marked` : undefined;
  const plotH = 36;
  heading(s, 'Marks over time', note, shown.length ? plotH + 13 : 10);
  if (!shown.length) return quiet(s, 'Nothing marked yet.');

  const { doc, palette } = s;
  const [left, right] = [MARGIN + 10, MARGIN + CONTENT_W - 2];
  const top = s.y + 4;
  const bottom = top + plotH;
  const yOf = (v: number) => bottom - clamp01(v) * plotH;
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    rule(doc, left, yOf(v), right);
    put(doc, pct(v), left - 2, yOf(v) + 1, { size: 6.5, colour: FAINT, align: 'right' });
  }
  const pad = 6;
  const step = shown.length > 1 ? (right - left - 2 * pad) / (shown.length - 1) : 0;
  const scores = shown.map((r) => r.score!);
  const points = scores.map((v, i): [number, number] => [
    shown.length > 1 ? left + pad + i * step : (left + right) / 2,
    yOf(v),
  ]);
  if (points.length > 1) {
    doc.setDrawColor(palette.accent);
    doc.setLineWidth(0.7);
    doc.setLineJoin('round');
    polyline(doc, points);
    doc.setLineJoin('miter');
  }
  // All the dots, then their labels: jsPDF writes a text colour as the PDF's
  // fill colour, so a dot drawn after a label would be filled in its colour.
  doc.setFillColor(palette.accent);
  doc.setDrawColor('#ffffff');
  doc.setLineWidth(0.4);
  for (const [x, y] of points) doc.circle(x, y, 1.2, 'FD');
  shown.forEach((r, i) => {
    const [x, y] = points[i];
    const labelY = markBelow(scores, i) ? y + 3.6 : y - 2.4;
    put(doc, pct(r.score), x, labelY, { size: 6.5, colour: INK, align: 'center' });
    put(doc, dayMonth(new Date(r.dueAt)), x, bottom + 4.5, { size: 6.5, colour: MUTED, align: 'center' });
  });
  s.y = bottom + 10;
}

/**
 * Whether point `i`'s mark goes under its dot: when every neighbour is higher,
 * the line leaves the dot upwards and would run through a mark above it. Not
 * near 0%, where the dates are.
 */
function markBelow(scores: number[], i: number): boolean {
  const v = scores[i];
  const neighbours = [scores[i - 1], scores[i + 1]].filter((n) => n !== undefined);
  return v >= 0.15 && neighbours.length > 0 && neighbours.every((n) => n > v);
}

/** Bars that run past the page continue on the next, under the title again. */
function chaptersChart(s: Sheet, chapters: StudentChapter[]): void {
  const shown = [...chapters].sort((a, b) => a.mastery - b.mastery).slice(0, MAX_CHAPTER_BARS);
  const more = chapters.length - shown.length;
  const [rowH, noteH] = [6.5, 6];
  const title = 'Chapter by chapter';
  heading(s, title, shown.length ? 'Weakest first' : undefined, shown.length ? Math.min(3, shown.length) * rowH : 10);
  if (!shown.length) return quiet(s, 'No answers yet.');

  const { doc } = s;
  const labelEnd = MARGIN + 74;
  const trackX = MARGIN + 77;
  const valueEnd = MARGIN + CONTENT_W - 20;
  const trackW = valueEnd - 10 - trackX;
  shown.forEach((c, i) => {
    // The last bar takes the '+N more' note onto its page with it.
    const need = rowH + (i === shown.length - 1 && more > 0 ? noteH : 0);
    if (s.y + need > BODY_BOTTOM) {
      newPage(s);
      heading(s, `${title} (continued)`, undefined, need);
    }
    const base = s.y + 4.3;
    const band = masteryBand(c.mastery);
    const subjectW = Math.min(30, widthOf(doc, c.subject, { size: 6.5 }));
    put(doc, chapterWords(c.chapter), MARGIN, base, { size: 8, maxWidth: 74 - subjectW - 3 });
    put(doc, c.subject, labelEnd, base, { size: 6.5, colour: FAINT, align: 'right', maxWidth: 30 });
    bar(doc, trackX, s.y + 1.7, trackW, 3.2, c.mastery, band.colour);
    put(doc, pct(c.mastery), valueEnd, base, { size: 8, bold: true, colour: band.colour, align: 'right' });
    put(doc, band.word, valueEnd + 1.5, base, { size: 7, colour: band.colour, maxWidth: 18.5 });
    s.y += rowH;
  });
  if (more > 0) {
    put(doc, `+${more} more chapters`, MARGIN, s.y + 4, { size: 7.5, italic: true, colour: MUTED });
    s.y += noteH;
  }
  s.y += 7;
}

function misconceptions(s: Sheet, mistakes: StudentMistake[]): void {
  if (!mistakes.length) return;
  const shown = [...mistakes].sort((a, b) => b.times - a.times).slice(0, MAX_MISTAKES);
  const note = mistakes.length > MAX_MISTAKES ? `Top ${MAX_MISTAKES} of ${mistakes.length}` : undefined;
  const rowH = 6.5;
  heading(s, 'Likely misconceptions', note, shown.length * rowH);
  const { doc, palette } = s;
  for (const m of shown) {
    const base = s.y + 4.3;
    doc.setFillColor(palette.tint);
    doc.roundedRect(MARGIN, s.y + 0.8, 10, 4.6, 2.3, 2.3, 'F');
    put(doc, `${m.times}×`, MARGIN + 5, base, { size: 7.5, bold: true, colour: palette.accent, align: 'center' });
    const where = m.chapter ? chapterWords(m.chapter) : m.subject;
    const whereW = put(doc, where, PAGE_W - MARGIN, base, {
      size: 7,
      colour: FAINT,
      align: 'right',
      maxWidth: 60,
    });
    put(doc, m.label, MARGIN + 13, base, { size: 8.5, maxWidth: CONTENT_W - 13 - whereW - 4 });
    s.y += rowH;
  }
  s.y += 7;
}

function recentWork(s: Sheet, timeline: TimelineRow[]): void {
  const rows = [...timeline].sort((a, b) => oldestFirst(b, a)).slice(0, MAX_RECENT);
  const note = timeline.length > MAX_RECENT ? `Latest ${MAX_RECENT} of ${timeline.length}` : undefined;
  const rowH = 7;
  heading(s, 'Recent work', note, 7 + Math.min(3, rows.length) * rowH);
  if (!rows.length) return quiet(s, 'No work set yet.');
  const x0 = MARGIN + 2;
  const cols: Column[] = [
    { title: 'Due', x: x0, w: 14 },
    { title: 'Kind', x: x0 + 16, w: 20 },
    { title: 'Title', x: x0 + 38, w: 66 },
    { title: 'Subject', x: x0 + 106, w: 28 },
    { title: 'Status', x: x0 + 136, w: 24 },
    { title: 'Mark', x: x0 + 162, w: CONTENT_W - 166, align: 'right' },
  ];
  const { doc } = s;
  tableRows(s, cols, rows, rowH, (r, y) => {
    const base = y + 4.7;
    const status = statusOf(r, s.opts.generatedAt);
    put(doc, dayMonth(new Date(r.dueAt)), cols[0].x, base, { size: 8, colour: MUTED, maxWidth: cols[0].w });
    put(doc, KIND_WORD[r.kind] ?? r.kind, cols[1].x, base, { size: 8, colour: MUTED, maxWidth: cols[1].w });
    put(doc, r.title, cols[2].x, base, { size: 8.5, maxWidth: cols[2].w });
    put(doc, r.subjectName, cols[3].x, base, { size: 8, colour: MUTED, maxWidth: cols[3].w });
    put(doc, status.word, cols[4].x, base, { size: 8, bold: true, colour: status.colour, maxWidth: cols[4].w });
    put(doc, pct(r.score), cols[5].x + cols[5].w, base, { size: 8.5, bold: true, align: 'right' });
  });
}

function footer(doc: jsPDF, page: number, n: number, of: number, name: string, generatedAt: Date): void {
  doc.setPage(page);
  rule(doc, MARGIN, PAGE_H - 14, PAGE_W - MARGIN);
  put(doc, FOOTNOTE, MARGIN, PAGE_H - 9.5, { size: 7, colour: MUTED, maxWidth: CONTENT_W });
  put(doc, `Generated ${dayMonthYear(generatedAt)}`, MARGIN, PAGE_H - 5.5, { size: 7, colour: FAINT });
  const pageW = put(doc, `Page ${n} of ${of}`, PAGE_W - MARGIN, PAGE_H - 5.5, {
    size: 7,
    colour: FAINT,
    align: 'right',
  });
  put(doc, name, PAGE_W - MARGIN - pageW - 3, PAGE_H - 5.5, {
    size: 7,
    colour: FAINT,
    align: 'right',
    maxWidth: 80,
  });
}

// --- The document -----------------------------------------------------------

/** One student's card, from the top of a fresh page. */
function drawStudent(doc: jsPDF, palette: Palette, opts: ReportOptions, r: ReportData): void {
  const s: Sheet = { doc, palette, opts, card: r.card, y: header(doc, palette, opts) };
  studentBlock(s);
  kpis(s, r.subjects);
  subjectsTable(s, r.subjects);
  marksChart(s, r.timeline);
  chaptersChart(s, r.chapters);
  misconceptions(s, r.mistakes);
  recentWork(s, r.timeline);
}

/** The cards of `reports`, in order; each student starts on a new page. */
export function reportCardPdf(reports: ReportData[], opts: ReportOptions): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const palette = paletteOf(opts.brand.primary);
  const title =
    reports.length === 1
      ? `Student progress report: ${reports[0].card.displayName}`
      : `Student progress reports: ${opts.brand.schoolName}`;
  doc.setProperties({ title: pdfSafe(title), creator: 'Qrie' });

  if (!reports.length) {
    const y = header(doc, palette, opts);
    put(doc, 'No students in this report.', MARGIN, y + 6, { size: 11, colour: MUTED });
    footer(doc, 1, 1, 1, '', opts.generatedAt);
    return doc;
  }

  const spans: { name: string; first: number; last: number }[] = [];
  reports.forEach((r, i) => {
    if (i > 0) doc.addPage('a4', 'portrait');
    const first = doc.getNumberOfPages();
    drawStudent(doc, palette, opts, r);
    spans.push({ name: r.card.displayName, first, last: doc.getNumberOfPages() });
  });
  for (const { name, first, last } of spans) {
    for (let page = first; page <= last; page++) {
      footer(doc, page, page - first + 1, last - first + 1, name, opts.generatedAt);
    }
  }
  return doc;
}

export function reportCardBytes(reports: ReportData[], opts: ReportOptions): Uint8Array {
  return new Uint8Array(reportCardPdf(reports, opts).output('arraybuffer'));
}

/** ASCII letters and digits, runs of anything else as one '-', accents dropped; 60 characters at most. */
function fileSafe(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

/** e.g. 'Riya-Sharma-8A-report.pdf'. */
export function reportFileName(card: StudentCard): string {
  const who = fileSafe(card.displayName) || fileSafe(card.loginId) || 'student';
  const cls = card.className ? fileSafe(card.className) : '';
  return `${who}${cls ? `-${cls}` : ''}-report.pdf`;
}

/** e.g. 'Class-8A-report-cards.pdf'. */
export function classFileName(className: string): string {
  const cls = fileSafe(className);
  return `Class${cls ? `-${cls}` : ''}-report-cards.pdf`;
}
