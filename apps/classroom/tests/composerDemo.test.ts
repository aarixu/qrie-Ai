import { describe, expect, it } from 'vitest';
import { composerDemoLesson } from '../src/lib/composerDemo';

describe('the composer demo', () => {
  const demo = composerDemoLesson();

  it('passes the keep gate, page-full and phone-readable included', () => {
    expect(demo.problems).toEqual([]);
  });

  it('leaves every one of its three pages full', () => {
    expect(demo.pages).toHaveLength(3);
    for (const page of demo.pages) expect(page.coverage, page.beat).toBeGreaterThanOrEqual(0.6);
  });

  it('draws its two pictures and its inset from artwork it carries', () => {
    const drawn = demo.lesson.elements.filter((e) => e.kind === 'image' || e.kind === 'diagram').map((e) => e.id);
    expect(new Set(drawn)).toEqual(new Set(['small_intestine', 'villus', 'microvilli']));
    for (const id of drawn) expect(demo.assets[id]).toBeTruthy();
  });

  it('colours the parts it names', () => {
    expect(demo.lesson.elements.some((e) => 'ink' in e && e.ink)).toBe(true);
  });
});
