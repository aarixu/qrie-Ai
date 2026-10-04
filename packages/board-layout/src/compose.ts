import { CANVAS_H, CANVAS_W, type Rect } from '@ai-tutor/lesson-format';

/**
 * THE COMPOSED PAGE (board composer, 2026-10-03).
 *
 * A stacked board keeps everything a lesson is about in one band 330 units tall
 * and turns the page whenever that band runs out, so the pages a class left
 * were about a third written on (16 kept classes, 28 pages: median 31%). A
 * composed page is divided into regions: the main demonstration in one, the
 * notes in another, the key points in a third, the summary in its own place.
 * Writing fills the next region before the page turns.
 *
 * Pure geometry: which arrangement a page gets, where its regions are, and
 * which region each piece of writing goes to. layout.ts draws.
 */
export const PAGE = { left: 40, right: 960, top: 96, bottom: 604, crumbY: 20, crumbSize: 18, titleY: 72 } as const;

/** The gap between two things written one under the other in a region. */
export const FILL_GAP = 14;

export type ArrangementName = 'figure' | 'scene' | 'process' | 'compare' | 'working' | 'notes';

export interface Region extends Rect {
  id: string;
}

export interface Arrangement {
  name: ArrangementName;
  /** Where the main demonstration goes. A notes page has none. */
  main: Region | null;
  /** The regions writing fills. */
  regions: readonly Region[];
  /** Where a list, a note, a card, an equation or working goes, in the order tried. */
  notesOrder: readonly string[];
  /** Where a key point or a caption goes, in the order tried. */
  pointsOrder: readonly string[];
  /** The summary's place. A summary too long for it goes where a key point would. */
  summary: Region;
}

const region = (id: string, x: number, y: number, w: number, h: number): Region => ({ id, x, y, w, h });

export const ARRANGEMENTS: Readonly<Record<ArrangementName, Arrangement>> = {
  // The figure and its names on the left, the notes down the right, the key
  // points under the figure, the summary at the foot of the notes.
  figure: {
    name: 'figure',
    main: region('hero', 40, 96, 590, 344),
    regions: [region('side', 650, 96, 310, 424), region('bottom', 40, 456, 590, 148)],
    notesOrder: ['side', 'bottom'],
    pointsOrder: ['bottom', 'side'],
    summary: region('summary', 650, 532, 310, 72),
  },
  // A scene keeps the full width: it does not shrink beside a column
  // (layout.ts, "a SCENE is not one"). It is no taller than a row or two of
  // pictures needs, so a three-item notes list and three key points fit under
  // it on the same page.
  scene: {
    name: 'scene',
    main: region('main', 40, 96, 920, 224),
    regions: [region('left', 40, 336, 450, 268), region('right', 510, 336, 450, 184)],
    notesOrder: ['left', 'right'],
    pointsOrder: ['right', 'left'],
    summary: region('summary', 510, 532, 450, 72),
  },
  process: {
    name: 'process',
    main: region('main', 40, 96, 920, 150),
    regions: [region('left', 40, 262, 450, 342), region('right', 510, 262, 450, 258)],
    notesOrder: ['left', 'right'],
    pointsOrder: ['right', 'left'],
    summary: region('summary', 510, 532, 450, 72),
  },
  compare: {
    name: 'compare',
    main: region('main', 40, 96, 920, 320),
    regions: [region('left', 40, 432, 450, 172), region('right', 510, 432, 450, 88)],
    notesOrder: ['left', 'right'],
    pointsOrder: ['right', 'left', 'main'],
    summary: region('summary', 510, 532, 450, 72),
  },
  // The working down the left, the rules and the points beside it; what the
  // working leaves of its own column takes writing too.
  working: {
    name: 'working',
    main: region('main', 40, 96, 560, 508),
    regions: [region('side', 620, 96, 340, 424)],
    notesOrder: ['side', 'main'],
    pointsOrder: ['side', 'main'],
    summary: region('summary', 620, 532, 340, 72),
  },
  // No main demonstration: two columns of writing. Also every page a beat
  // turns onto after its first.
  notes: {
    name: 'notes',
    main: null,
    regions: [region('left', 40, 96, 450, 508), region('right', 510, 96, 450, 424)],
    notesOrder: ['left', 'right'],
    pointsOrder: ['left', 'right'],
    summary: region('summary', 510, 532, 450, 72),
  },
};

/** Which arrangement each kind of main demonstration gets. A Map, so "toString" is not a kind. */
const MAIN_OF: ReadonlyMap<string, ArrangementName> = new Map([
  ['picture', 'figure'],
  ['diagram', 'figure'],
  ['chart', 'figure'],
  ['plot', 'figure'],
  ['pieChart', 'figure'],
  ['lineChart', 'figure'],
  ['place', 'scene'],
  ['flow', 'process'],
  ['compare', 'compare'],
  ['derive', 'working'],
  ['equationMove', 'working'],
]);

export function isMainKind(kind: string): boolean {
  return MAIN_OF.has(kind);
}

/**
 * The arrangement for a page whose instructions are `kinds`.
 *
 * A scene is many `place` instructions and one demonstration, so it counts
 * once. Two main demonstrations on one page is two beats the planner did not
 * split, and gets the stack it always had.
 */
export function arrangementOf(kinds: readonly string[]): ArrangementName | 'fallback' {
  const mains = kinds.filter((k, n) => isMainKind(k) && (k !== 'place' || kinds.indexOf(k) === n));
  if (mains.length === 0) return 'notes';
  if (mains.length > 1) return 'fallback';
  return MAIN_OF.get(mains[0])!;
}

/** One piece of writing to put on the page. */
export interface Fillable {
  /** The spoken line it is written under: a line's writing stays on one page. */
  line: number;
  role: 'notes' | 'points' | 'summary' | 'newPage';
  /** Its height when written `w` wide. */
  heightAt: (w: number) => number;
}

/** Where one piece of writing goes: which page, which region, which rectangle. */
export interface Placement {
  /** Its index in the list given. */
  index: number;
  sheet: number;
  region: string;
  /** In the page's own coordinates; the caller slides it by the sheet. */
  rect: Rect;
}

/** How full a page of a composed beat is, and what is on it. */
export interface SheetReport {
  sheet: number;
  /** The share of the 1000 x 620 page that is written on (writtenArea), 0 to 1. */
  coverage: number;
  /** A main demonstration is on it. */
  main: boolean;
  /** A list, a note, a card, a comparison or a label is on it. */
  notes: boolean;
  /** How many key points are written on it. */
  points: number;
  summary: boolean;
}

/**
 * Put every piece of writing in a region.
 *
 * Each goes to the first region in its order with room left. A spoken line's
 * writing stays together: when the line does not fit what is left of this
 * page, the page turns BEFORE it. Pages after the first are `notes` pages.
 * `reserved` is how far down each region of the first page is already used:
 * the main demonstration in a working page's own column, the zoom inset at the
 * top of a figure's notes.
 */
export function fillRegions(
  blocks: readonly Fillable[],
  first: Arrangement,
  reserved: ReadonlyMap<string, number>,
): Placement[] {
  const out: Placement[] = [];
  let sheet = 0;
  let page = first;
  let used = new Map(reserved);
  /** Whether anything is on this page yet: a page is never turned away from empty. */
  let inked = first.main !== null || reserved.size > 0;

  const named = (id: string): Region | null =>
    id === page.summary.id ? page.summary : page.main?.id === id ? page.main : (page.regions.find((r) => r.id === id) ?? null);
  const orderFor = (b: Fillable): readonly string[] =>
    b.role === 'summary' ? [page.summary.id, ...page.pointsOrder] : b.role === 'notes' ? page.notesOrder : page.pointsOrder;

  /** Where a run of writing would go on this page, or null if it does not all fit. */
  const fit = (run: readonly number[]): { placed: Placement[]; used: Map<string, number> } | null => {
    const trial = new Map(used);
    const placed: Placement[] = [];
    for (const index of run) {
      const b = blocks[index];
      let done = false;
      for (const id of orderFor(b)) {
        const r = named(id);
        if (!r) continue;
        const top = trial.get(r.id) ?? 0;
        const h = b.heightAt(r.w);
        if (top + h > r.h) continue;
        placed.push({ index, sheet, region: r.id, rect: { x: r.x, y: r.y + top, w: r.w, h } });
        trial.set(r.id, top + h + FILL_GAP);
        done = true;
        break;
      }
      if (!done) return null;
    }
    return { placed, used: trial };
  };
  const commit = (made: { placed: Placement[]; used: Map<string, number> }): void => {
    out.push(...made.placed);
    used = made.used;
    if (made.placed.length > 0) inked = true;
  };
  const turn = (): void => {
    sheet += 1;
    page = ARRANGEMENTS.notes;
    used = new Map();
    inked = false;
  };

  // The writing in runs, one run per spoken line.
  const runs: number[][] = [];
  blocks.forEach((b, index) => {
    const last = runs[runs.length - 1];
    if (last && blocks[last[0]].line === b.line) last.push(index);
    else runs.push([index]);
  });

  for (const run of runs) {
    if (inked && run.some((index) => blocks[index].role === 'newPage')) turn();
    const writing = run.filter((index) => blocks[index].role !== 'newPage');
    if (writing.length === 0) continue;
    const whole = fit(writing);
    if (whole) {
      commit(whole);
      continue;
    }
    if (inked) turn();
    const fresh = fit(writing);
    if (fresh) {
      commit(fresh);
      continue;
    }
    // A line taller than a page: a piece at a time, turning when one does not fit.
    for (const index of writing) {
      const one = fit([index]);
      if (one) {
        commit(one);
        continue;
      }
      if (inked) turn();
      const alone = fit([index]);
      if (alone) {
        commit(alone);
        continue;
      }
      // Taller than any region of an empty page: written from the top of its
      // first region, and the keep gate's on-board rule names what runs off.
      const r = named(orderFor(blocks[index])[0])!;
      const h = blocks[index].heightAt(r.w);
      out.push({ index, sheet, region: r.id, rect: { x: r.x, y: r.y, w: r.w, h } });
      used.set(r.id, h + FILL_GAP);
      inked = true;
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * WHAT OF A PAGE IS WRITTEN ON: each region from its first writing to its
 * last, inside the region.
 *
 * Measured box by box, a page of notes counted only the ink of each line, so
 * a page whose every region was written down to the bottom read as 40% full:
 * the space between two lines of writing was counted as empty board. It is
 * not — it is how writing looks. A region counts as written over the extent
 * of what is in it; a region with nothing in it counts nothing.
 */
export function writtenArea(groups: readonly { region: Rect; boxes: readonly Rect[] }[]): Rect[] {
  const out: Rect[] = [];
  for (const { region: r, boxes } of groups) {
    if (boxes.length === 0) continue;
    const x0 = Math.max(r.x, Math.min(...boxes.map((b) => b.x)));
    const y0 = Math.max(r.y, Math.min(...boxes.map((b) => b.y)));
    const x1 = Math.min(r.x + r.w, Math.max(...boxes.map((b) => b.x + b.w)));
    const y1 = Math.min(r.y + r.h, Math.max(...boxes.map((b) => b.y + b.h)));
    if (x1 > x0 && y1 > y0) out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  return out;
}

/**
 * The share of the page at `dx` under any of these boxes, 0 to 1.
 *
 * Counted on a 10-unit grid, so two boxes over the same spot count once, and a
 * box on another page counts nothing here.
 */
export function coverage(boxes: readonly Rect[], dx: number): number {
  const cols = CANVAS_W / 10;
  const rows = CANVAS_H / 10;
  const cells = new Uint8Array(cols * rows);
  for (const b of boxes) {
    const x0 = Math.max(0, Math.floor((b.x - dx) / 10));
    const x1 = Math.min(cols, Math.ceil((b.x + b.w - dx) / 10));
    const y0 = Math.max(0, Math.floor(b.y / 10));
    const y1 = Math.min(rows, Math.ceil((b.y + b.h) / 10));
    for (let gx = x0; gx < x1; gx += 1) for (let gy = y0; gy < y1; gy += 1) cells[gy * cols + gx] = 1;
  }
  return cells.reduce((sum, v) => sum + v, 0) / cells.length;
}
