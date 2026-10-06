import { describe, expect, it } from 'vitest';
import type { Element, Lesson } from '@ai-tutor/lesson-format';
import { gateLesson } from '../src/gate';
import type { ComposerReport, PageReport } from '../src/composerChecks';

const noMaths = () => ({ ok: true, failures: [] });
const lessonOf = (elements: Element[], beats: Lesson['beats']): Lesson => ({
  formatVersion: 1,
  id: 'c',
  title: 'C',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements,
  beats,
});
const page = (over: Partial<PageReport>): PageReport => ({
  sheet: 0,
  arrangement: 'figure',
  empty: [],
  coverage: 0.7,
  main: true,
  notes: true,
  list: true,
  points: 2,
  summary: true,
  beat: 'b2_4',
  plannerBeat: 'b2',
  opening: false,
  ...over,
});
const BASE = lessonOf(
  [{ kind: 'handwrite', id: 'h', x: 300, y: 300, text: 'Villi', size: 22 }],
  [{ id: 'b2_4', topic: 't', narration: 'So villi absorb food.', show: ['h'], frame: ['h'] }],
);
const composerRules = (report: ComposerReport, lesson = BASE) =>
  gateLesson(lesson, { mathsCheck: noMaths, composer: report }).filter(
    (p) => p.rule === 'page-full' || p.rule === 'phone-readable',
  );

describe('page-full', () => {
  it('passes a full page with all its parts', () => {
    expect(composerRules({ pages: [page({})], overview: ['b2_4'] })).toEqual([]);
  });

  it('names a page left too empty, and how full it was', () => {
    const found = composerRules({ pages: [page({ coverage: 0.38 })], overview: ['b2_4'] });
    expect(found).toEqual([expect.objectContaining({ rule: 'page-full', where: 'b2_4' })]);
    expect(found[0].message).toMatch(/Beat "b2": the class leaves this page 38% written on/);
  });

  /**
   * WHAT TO WRITE, AND WHERE (small intestine, 2026-10-06). "Write more" sent
   * to repair three pages at 44-56% and none came back fuller; the planner is
   * now told which place on the page is empty and what goes there.
   */
  it('names the empty column beside a picture, and that a list of its parts goes there', () => {
    const [found] = composerRules({ pages: [page({ coverage: 0.56, empty: ['side'], points: 2 })], overview: ['b2_4'] });
    expect(found.message).toMatch(/The column beside the picture has nothing in it\./);
    expect(found.message).toMatch(/a "list" of each part or idea you name, with what it does and why/);
    expect(found.message).toMatch(/1 more key point \("write"\)/);
  });

  it('asks a labelled picture with no list for one, though its names fill nothing beside it', () => {
    const [found] = composerRules({ pages: [page({ coverage: 0.57, list: false, points: 2 })], overview: ['b2_4'] });
    expect(found.message).toMatch(/a "list" of each part or idea you name/);
  });

  it('tells a first page whose writing ran onto the next to give it less, not to write what it already has', () => {
    const found = composerRules({
      pages: [
        page({ coverage: 0.3, empty: ['side', 'bottom'], list: false, points: 0, summary: false }),
        page({ sheet: 1, coverage: 0.38, arrangement: 'notes', main: false, list: true, points: 2, summary: true, beat: 'b2_6' }),
      ],
      overview: ['b2_4', 'b2_6'],
    });
    const first = found.find((p) => p.where === 'b2_4')!;
    expect(first.message).toMatch(/did not fit/);
    expect(first.message).not.toMatch(/Write a "list"/);
    expect(found.find((p) => p.where === 'b2_6')!.message).not.toMatch(/split it into two beats/);
  });

  it('asks a page of key points alone for its notes, so it is written in two columns', () => {
    const [found] = composerRules({
      pages: [page({ coverage: 0.4, arrangement: 'notes', main: false, notes: false, list: false, empty: ['right'], points: 3 })],
      overview: ['b2_4'],
    });
    expect(found.message).toMatch(/a "list" of each part or idea you name/);
  });

  it('tells a page of writing alone to take a demonstration, or to go with the beat it belongs to', () => {
    const [found] = composerRules({
      pages: [page({ coverage: 0.53, arrangement: 'notes', main: false, empty: ['right'], points: 2 })],
      overview: ['b2_4'],
    });
    expect(found.message).toMatch(/The right column has nothing in it\./);
    expect(found.message).toMatch(/no picture, scene, flow or comparison/);
  });

  it('counts the key points a comparison page still needs', () => {
    const [found] = composerRules({
      pages: [page({ coverage: 0.44, arrangement: 'compare', empty: ['side'], points: 1 })],
      overview: ['b2_4'],
    });
    expect(found.message).toMatch(/The column beside the comparison has nothing in it\./);
    expect(found.message).toMatch(/2 more key points \("write"\)/);
  });

  it('names what a subtopic with a main demonstration is missing', () => {
    const found = composerRules({ pages: [page({ summary: false, points: 0 })], overview: ['b2_4'] });
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/key points \("write"\), a "summary"/);
  });

  it('holds the opening to nothing', () => {
    expect(composerRules({ pages: [page({ coverage: 0.1, summary: false, opening: true })], overview: ['b2_4'] })).toEqual([]);
  });

  it('tells a beat that ran onto a second page to give that page less, not to write more', () => {
    const found = composerRules({ pages: [page({}), page({ sheet: 1, coverage: 0.06, main: false, beat: 'b2_6' })], overview: ['b2_4', 'b2_6'] });
    expect(found).toEqual([expect.objectContaining({ rule: 'page-full', where: 'b2_6' })]);
    expect(found[0].message).toMatch(/Beat "b2" ran onto another page/);
    expect(found[0].message).not.toMatch(/Write each part/);
  });

  it('names a beat of a composed class that could not be laid out as one composed page', () => {
    const found = gateLesson(BASE, { mathsCheck: noMaths, composer: { pages: [], overview: [], stacked: [{ beat: 'b2_4', plannerBeat: 'b2' }] } });
    expect(found).toEqual([expect.objectContaining({ rule: 'one-main', where: 'b2_4' })]);
    expect(found[0].message).toMatch(/Give each main demonstration its own beat/);
  });

  it('is silent on a class that is not composed', () => {
    expect(gateLesson(BASE, { mathsCheck: noMaths }).some((p) => p.rule === 'page-full' || p.rule === 'phone-readable')).toBe(false);
  });
});

describe('phone-readable', () => {
  const WIDE: Element = { kind: 'box', id: 'w', x: 40, y: 100, w: 920, h: 450, label: '' };
  const SMALL: Element = { kind: 'handwrite', id: 's', x: 500, y: 300, text: 'Lacteal', size: 12 };
  const spread = lessonOf([WIDE, SMALL], [{ id: 'b2_2', topic: 't', narration: 'The lacteal takes fats.', show: ['w', 's'], frame: ['w', 's'] }]);

  it('names a line whose writing is too small on a phone', () => {
    const found = composerRules({ pages: [], overview: [] }, spread);
    expect(found).toEqual([expect.objectContaining({ rule: 'phone-readable', where: 'b2_2' })]);
    expect(found[0].message).toMatch(/"Lacteal" is \d+\.\dpx/);
  });

  it('does not hold the pull-out to what was written before it', () => {
    const before = lessonOf(
      [WIDE, SMALL],
      [
        { id: 'b2_1', topic: 't', narration: 'The lacteal takes fats.', show: ['w', 's'], frame: ['s'] },
        { id: 'b2_2', topic: 't', narration: 'Now look at it all.', show: ['w', 's'], frame: ['w', 's'] },
      ],
    );
    expect(composerRules({ pages: [], overview: ['b2_2'] }, before)).toEqual([]);
  });

  it('holds a pull-out to what that line itself writes', () => {
    // The summary is written on the page's last line, which is the pull-out: it has to read there.
    expect(composerRules({ pages: [], overview: ['b2_2'] }, spread)).toEqual([
      expect.objectContaining({ rule: 'phone-readable', where: 'b2_2' }),
    ]);
  });

  it('passes the same writing when the camera comes close', () => {
    const close = lessonOf([SMALL], [{ id: 'b2_2', topic: 't', narration: 'The lacteal takes fats.', show: ['s'], frame: ['s'] }]);
    expect(composerRules({ pages: [], overview: [] }, close)).toEqual([]);
  });
});
