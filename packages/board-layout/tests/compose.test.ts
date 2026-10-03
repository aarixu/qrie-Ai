import { describe, expect, it } from 'vitest';
import { TOOL_NAMES } from '@ai-tutor/lesson-format';
import { ARRANGEMENTS, arrangementOf, coverage, fillRegions, PAGE, type Fillable } from '../src/compose';

const block = (line: number, role: Fillable['role'], h: number): Fillable => ({ line, role, heightAt: () => h });
const where = (placed: ReturnType<typeof fillRegions>) => placed.map((p) => `${p.sheet}/${p.region}`);

describe('which arrangement a page gets', () => {
  it('follows its one main demonstration', () => {
    expect(arrangementOf(['picture', 'label', 'list', 'write'])).toBe('figure');
    expect(arrangementOf(['place', 'place', 'connect', 'write'])).toBe('scene');
    expect(arrangementOf(['flow', 'list'])).toBe('process');
    expect(arrangementOf(['compare', 'summary'])).toBe('compare');
    expect(arrangementOf(['derive', 'write'])).toBe('working');
    expect(arrangementOf(['equationMove'])).toBe('working');
    expect(arrangementOf(['pieChart', 'write'])).toBe('figure');
    expect(arrangementOf(['write', 'list', 'equation'])).toBe('notes');
  });

  it('is the old stack when a page has two main demonstrations', () => {
    expect(arrangementOf(['picture', 'flow'])).toBe('fallback');
    expect(arrangementOf(['picture', 'picture'])).toBe('fallback');
  });

  it('knows every toolkit tool, and nothing on the object prototype', () => {
    for (const tool of TOOL_NAMES) expect(arrangementOf([tool])).not.toBe('notes');
    expect(arrangementOf(['toString', 'constructor'])).toBe('notes');
  });
});

describe('the regions', () => {
  it('stay on the page, under the header, and apart', () => {
    for (const a of Object.values(ARRANGEMENTS)) {
      const all = [...(a.main ? [a.main] : []), ...a.regions, a.summary];
      for (const r of all) {
        expect(r.x, `${a.name}/${r.id}`).toBeGreaterThanOrEqual(PAGE.left);
        expect(r.x + r.w, `${a.name}/${r.id}`).toBeLessThanOrEqual(PAGE.right);
        expect(r.y, `${a.name}/${r.id}`).toBeGreaterThanOrEqual(PAGE.top);
        expect(r.y + r.h, `${a.name}/${r.id}`).toBeLessThanOrEqual(PAGE.bottom);
      }
      for (const p of all) {
        for (const q of all) {
          if (p === q) continue;
          const apart = p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y;
          expect(apart, `${a.name}: ${p.id} and ${q.id}`).toBe(true);
        }
      }
    }
  });

  it('name only regions the arrangement has', () => {
    for (const a of Object.values(ARRANGEMENTS)) {
      const ids = new Set([...(a.main ? [a.main.id] : []), ...a.regions.map((r) => r.id), a.summary.id]);
      for (const id of [...a.notesOrder, ...a.pointsOrder]) expect(ids.has(id), `${a.name}: ${id}`).toBe(true);
    }
  });
});

describe('filling a page', () => {
  it('writes notes beside the figure and key points under it', () => {
    expect(where(fillRegions([block(1, 'notes', 120), block(2, 'points', 40)], ARRANGEMENTS.figure, new Map()))).toEqual([
      '0/side',
      '0/bottom',
    ]);
  });

  it('fills the next region before it turns the page', () => {
    // The band under the figure is 148 tall: three points of 40, with 14 between, fit; the fourth goes beside.
    const points = [1, 2, 3, 4].map((line) => block(line, 'points', 40));
    expect(where(fillRegions(points, ARRANGEMENTS.figure, new Map()))).toEqual(['0/bottom', '0/bottom', '0/bottom', '0/side']);
  });

  it('turns the page only when no region can take the line, and moves the whole line', () => {
    const placed = fillRegions(
      [block(1, 'notes', 300), block(2, 'notes', 300), block(2, 'points', 30)],
      ARRANGEMENTS.figure,
      new Map(),
    );
    expect(where(placed)).toEqual(['0/side', '1/left', '1/left']);
  });

  it('puts the summary in its own place, or with the key points when it is too long for it', () => {
    expect(fillRegions([block(1, 'summary', 46)], ARRANGEMENTS.figure, new Map())[0].region).toBe('summary');
    expect(fillRegions([block(1, 'summary', 94)], ARRANGEMENTS.figure, new Map())[0].region).toBe('bottom');
  });

  it('starts a region below what is already in it', () => {
    const placed = fillRegions([block(1, 'notes', 50)], ARRANGEMENTS.figure, new Map([['side', 200]]));
    expect(placed[0].rect.y).toBe(ARRANGEMENTS.figure.regions.find((r) => r.id === 'side')!.y + 200);
  });

  it('turns the page at a newPage, but never away from an empty page', () => {
    const placed = fillRegions(
      [block(1, 'newPage', 0), block(1, 'points', 40), block(2, 'newPage', 0), block(2, 'points', 40)],
      ARRANGEMENTS.notes,
      new Map(),
    );
    expect(placed.map((p) => [p.index, p.sheet])).toEqual([
      [1, 0],
      [3, 1],
    ]);
  });

  it('places a line taller than a page on a page of its own, from the top', () => {
    const placed = fillRegions([block(1, 'points', 20), block(2, 'notes', 900)], ARRANGEMENTS.notes, new Map());
    expect(placed[1]).toMatchObject({ sheet: 1, region: 'left' });
    expect(placed[1].rect.y).toBe(PAGE.top);
  });
});

describe('coverage', () => {
  it('is the share of the page under any box, counted once, on that page only', () => {
    expect(coverage([], 0)).toBe(0);
    expect(coverage([{ x: 0, y: 0, w: 1000, h: 310 }], 0)).toBe(0.5);
    const twice = { x: 0, y: 0, w: 500, h: 620 };
    expect(coverage([twice, twice, { x: 1260, y: 0, w: 500, h: 620 }], 0)).toBe(0.5);
    expect(coverage([{ x: 1260, y: 0, w: 500, h: 620 }], 1260)).toBe(0.5);
  });
});
