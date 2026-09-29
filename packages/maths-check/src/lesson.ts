/**
 * A LESSON'S EQUATIONS, in the order the class sees them.
 *
 * `equationLines` pulls every string a lesson writes on the board as a line
 * of maths — `formula`, `handwrite`, `text` and `note` elements — that
 * carries an `=`. Other kinds are not read: titles, boxes, lists, flows,
 * charts and pictures (a `list` item holding an equation is NOT checked).
 * A string with no `=` is not an equation and is left out entirely rather
 * than reported as skipped.
 *
 * ORDER is reading order: by the first beat whose `show` includes the
 * element, then by position in `elements`; elements no beat shows come last.
 * PAGES are title-delimited: each line's `section` is the id of the last
 * `title` element before it in that order. The checker uses pages for one
 * thing only — telling an opening puzzle on its own page apart from the
 * worked problem (check.ts, header).
 *
 * A line that wraps across two `handwrite` elements is two lines here; the
 * second, starting with "=", does not parse and is skipped.
 */

import { latexToPlain, type Element, type Lesson } from '@ai-tutor/lesson-format';
import { checkLines, type CheckResult, type Line } from './check.ts';

const READ_KINDS: ReadonlySet<Element['kind']> = new Set(['formula', 'handwrite', 'text', 'note']);

export function equationLines(lesson: Lesson): Line[] {
  const firstBeat = new Map<string, number>();
  lesson.beats.forEach((beat, b) => {
    for (const id of beat.show) if (!firstBeat.has(id)) firstBeat.set(id, b);
  });
  const ordered = lesson.elements
    .map((el, i) => ({ el, i, beat: firstBeat.get(el.id) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.beat - b.beat || a.i - b.i);

  const out: Line[] = [];
  let section: string | undefined;
  for (const { el } of ordered) {
    if (el.kind === 'title') {
      section = el.id;
      continue;
    }
    if (!READ_KINDS.has(el.kind) || !('text' in el) || !el.text.includes('=')) continue;
    // Maths written in LaTeX (T6) is read as what it MEANS — "$2^{x} = 32$" is
    // "2^(x) = 32" — and a line with LaTeX that cannot be translated faithfully
    // is left as it was, which the parser refuses and so skips, rather than
    // checked as a guess (seventh review).
    const text = latexToPlain(el.text) ?? el.text;
    out.push(section === undefined ? { id: el.id, text } : { id: el.id, text, section });
  }
  return out;
}

/** `checkLines` over a lesson's equation lines. Failures and skips carry element ids. */
export function checkLesson(lesson: Lesson): CheckResult {
  return checkLines(equationLines(lesson));
}
