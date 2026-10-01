import type { Element, Lesson } from '@ai-tutor/lesson-format';

/**
 * A KEPT CLASS, PLAYED WITHOUT ITS QUESTION INK (Aarav, 2026-10-01).
 *
 * When she asks, no question and no options appear: she asks out loud. A
 * class prepared since then writes none (board-layout lays an ask out as a
 * marker only, and the keep gate's `one-question` rule refuses any). Every
 * class kept before then has its questions on the board, and this takes them
 * off as the class is played, without touching what was kept.
 *
 * What counts as the question, written, is the keep gate's own definition
 * (packages/class-prep/src/gate.ts, `heldProblems`), so a kept class played
 * through this would pass that rule:
 *   - ink anywhere in the asking planner beat whose words are the ask's
 *     question, or its board form (`written`);
 *   - any ink with a "?" that first appears at the moment that asks — except a
 *     title, which is a heading, not a question put to the student;
 *   - a lettered list whose items are the ask's own options.
 *
 * Her other ink stays, and so does a work area: a hint she writes still lands
 * there. A frame left empty keeps the camera where the moment before had it.
 * Returns the lesson it was given when there is nothing to take off.
 */
export function withoutAskInk(lesson: Lesson): Lesson {
  const byId = new Map(lesson.elements.map((el) => [el.id, el]));
  const groups = new Map<string, string[]>();
  for (const el of lesson.elements) groups.set(groupOf(el.id), [...(groups.get(groupOf(el.id)) ?? []), el.id]);
  const groupText = (group: string): string =>
    bare((groups.get(group) ?? []).map((id) => writtenText(byId.get(id))).join(' '));

  const gone = new Set<string>();
  const take = (group: string): void => {
    for (const id of groups.get(group) ?? []) gone.add(id);
  };

  lesson.beats.forEach((beat, n) => {
    const ask = beat.ask;
    if (!ask) return;
    const planner = plannerBeatOf(beat.id);
    const copies = [ask.question, ask.written ?? ''].map(bare).filter((q) => q !== '');
    const isCopy = (ink: string): boolean =>
      copies.some((q) => ink === q || (q.split(' ').length >= 3 && ` ${ink} `.includes(` ${q} `)));
    for (const group of groups.keys()) {
      if (plannerBeatOf(group) === planner && isCopy(groupText(group))) take(group);
    }
    const before = new Set(n > 0 ? lesson.beats[n - 1].show : []);
    for (const id of beat.show) {
      if (before.has(id)) continue;
      const el = byId.get(id);
      if (!el || el.kind === 'title') continue;
      if (writtenText(el).includes('?')) take(groupOf(id));
      if (el.kind === 'list' && isOptionsList(el, ask.options ?? [])) take(groupOf(id));
    }
  });

  if (gone.size === 0) return lesson;
  let lastFrame: string[] | undefined;
  return {
    ...lesson,
    elements: lesson.elements.filter((el) => !gone.has(el.id)),
    beats: lesson.beats.map((beat) => {
      const kept = { ...beat, show: beat.show.filter((id) => !gone.has(id)) };
      if (beat.focus) kept.focus = beat.focus.filter((f) => !gone.has(f.split('#')[0]));
      if (beat.frame) {
        const frame = beat.frame.filter((id) => !gone.has(id));
        if (frame.length > 0) kept.frame = frame;
        else if (lastFrame) kept.frame = lastFrame;
        else delete kept.frame;
      }
      if (kept.frame) lastFrame = kept.frame;
      return kept;
    }),
  };
}

/** The planner beat an id came from: `b3_4` -> `b3`, `b3__pen` -> `b3` (gate.ts). */
const plannerBeatOf = (id: string): string => id.replace(/__.*$/, '').replace(/_\d+.*$/, '');

/** One written element, whatever lines it wrapped onto: `b3_11_l1` -> `b3_11` (gate.ts). */
const groupOf = (id: string): string => id.replace(/_l\d+$/, '');

/** Lowercased, single-spaced, without the punctuation a sentence closes on (gate.ts). */
const bare = (text: string): string =>
  text.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[\s.?!:;,]+$/, '');

/** The text an element writes, when it writes any (gate.ts). */
const writtenText = (el: Element | undefined): string => {
  if (!el) return '';
  if ('text' in el && typeof el.text === 'string') return el.text;
  if (el.kind === 'list') return [el.heading ?? '', ...el.items.map((i) => `${i.term} ${i.meaning ?? ''}`)].join(' ');
  return '';
};

/** A lettered list (A, B, C…) whose items are these options, in order. */
const isOptionsList = (el: Extract<Element, { kind: 'list' }>, options: readonly { text: string }[]): boolean =>
  options.length > 0 &&
  el.items.length === options.length &&
  el.items.every(
    (item, k) => item.term === String.fromCharCode(65 + k) && bare(item.meaning ?? '') === bare(options[k].text),
  );
