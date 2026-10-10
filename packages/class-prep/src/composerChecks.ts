import { ARRANGEMENTS, type ArrangementName, type SheetReport } from '@ai-tutor/board-layout';
import { LIST_ITEM_SIZE, NOTE_FONT, STAGE_ASPECT, type Element, type Lesson } from '@ai-tutor/lesson-format';
import { computeFrame, MAX_UNIT_PX } from '../../stage/src/frame.ts';
import type { GateProblem } from './gate.ts';
import { same, stemsOf } from './sayLines.ts';

/**
 * What assemble reports about one page of a composed class (board composer):
 * board-layout's report, and where in the lesson the class leaves the page.
 */
export interface PageReport extends SheetReport {
  /** The lesson beat on which the class leaves this page. */
  beat: string;
  /** The planner beat, one subtopic, the page belongs to. */
  plannerBeat: string;
  /** The opening beat teaches nothing by the prompt's contract, and is not held to a full page. */
  opening: boolean;
}

export interface ComposerReport {
  pages: PageReport[];
  /** The lesson beats on which the camera pulls back to the whole page. */
  overview: string[];
  /**
   * Beats of a composed class that were laid out as a stack: two main
   * demonstrations on one board, or names on something that is not a
   * picture. Each is the last lesson beat of its planner beat.
   */
  stacked?: { beat: string; plannerBeat: string }[];
}

/** The least of a page a class may leave written on. */
export const PAGE_FULL = 0.6;
/** The smallest writing a phone may be shown, in CSS pixels. */
export const PHONE_MIN_PX = 12;
/** An 812 x 375 phone held sideways shows the 16:9 stage 667 wide (375 x 16 / 9). */
export const PHONE_STAGE_W = 667;

/** "b2_3" belongs to planner beat "b2", as gate.ts reads it. */
const plannerOf = (id: string): string => id.replace(/_\d+$/, '');

/** What a beat that ran onto a second page is told: less, so it fits its own. */
const LESS =
  'Give this beat less — a shorter list (fewer items, shorter meanings) and fewer key points — so all of it ' +
  'fits on its own page.';

/** Each place on a page, as the planner is told about it. */
const PLACES: Readonly<Record<ArrangementName, Readonly<Record<string, string>>>> = {
  figure: { side: 'the column beside the picture', bottom: 'the space under the picture' },
  scene: { left: 'the left of the space under the scene', right: 'the right of the space under the scene' },
  process: { left: 'the left of the space under the flow', right: 'the right of the space under the flow' },
  compare: { side: 'the column beside the comparison' },
  working: { side: 'the column beside the working' },
  notes: { left: 'the left column', right: 'the right column' },
};

/**
 * WHAT A PAGE LEFT TOO EMPTY NEEDS, AND WHERE IT GOES (small intestine,
 * 2026-10-06). That class left three pages 44–57% written on, and all the gate
 * could say was "write more"; so the planner is told which of the page's places
 * has nothing in it, and what the page is short of.
 */
function whatItNeeds(page: PageReport): string {
  const places = page.empty.map((id) => PLACES[page.arrangement][id]).filter((p): p is string => p !== undefined);
  const said: string[] = [];
  if (places.length > 0) {
    const named = places.length === 1 ? places[0] : `${places.slice(0, -1).join(', ')} and ${places[places.length - 1]}`;
    said.push(`${named[0].toUpperCase()}${named.slice(1)} ${places.length === 1 ? 'has nothing in it' : 'have nothing in them'}.`);
  }
  if (!page.main) {
    said.push(
      'This page has no picture, scene, flow or comparison: give it the one that shows what it explains, or ' +
        'write this on the page of the beat it belongs to.',
    );
  }
  const needs: string[] = [];
  // Names on a picture are not its notes: what each part does is a list. And a
  // page of writing is two columns only when it has notes for the first.
  if (
    (page.main && !page.list) ||
    (page.arrangement === 'notes' && !page.list) ||
    page.empty.includes(ARRANGEMENTS[page.arrangement].notesOrder[0])
  ) {
    needs.push('a "list" of each part or idea you name, with what it does and why');
  }
  const short = 3 - page.points;
  if (short === 3) needs.push('three to five key points ("write") as you say them');
  else if (short > 0) needs.push(`${short} more key point${short === 1 ? '' : 's'} ("write") as you say them`);
  if (!page.summary) needs.push('a "summary" last');
  said.push(
    needs.length > 0
      ? `Write ${needs.join(', ')}.`
      : 'Write more on it: what each thing on it does and why, and up to five key points.',
  );
  return said.join(' ');
}

/**
 * How large an element's writing is, and a few of its words to name it by.
 *
 * A text with no letter or digit in it — a key point's "•" — is a mark, not
 * writing to be read: at 11.5px it failed three lines of the heart class whose
 * words were all large enough (2026-10-08).
 */
function writingOf(el: Element): { size: number; words: string } | null {
  switch (el.kind) {
    case 'handwrite':
      return { size: el.size ?? 26, words: el.text };
    case 'text':
      if (!/[\p{L}\p{N}]/u.test(el.text)) return null;
      return { size: el.size ?? 20, words: el.text };
    case 'formula':
      return { size: 24, words: el.text };
    case 'note':
      return { size: NOTE_FONT, words: el.text };
    case 'list':
      return { size: el.size ?? LIST_ITEM_SIZE, words: el.heading ?? el.items[0]?.term ?? '' };
    default:
      return null;
  }
}

/**
 * ASK BEFORE YOU SHOW (small intestine, 2026-10-07).
 *
 * The opening asked "Which organ receives this food next?" with "Small
 * intestine" already written under its picture; a later ask about which vessel
 * takes in fats was held beside the label "Lacteal". The answer — the correct
 * option of the ask's probe, or what it expects — less every word of the
 * question itself, is looked for in the writing on the ask's own page at the
 * moment it is held (names on pictures included). One to four words of it, all
 * there, is the answer on the board.
 */
function answerShown(lesson: Lesson): GateProblem[] {
  const byId = new Map(lesson.elements.map((el) => [el.id, el]));
  const inkOf = (el: Element): string => {
    const parts: string[] = [];
    if ('text' in el && typeof el.text === 'string') parts.push(el.text);
    if ('label' in el && typeof el.label === 'string') parts.push(el.label);
    if (el.kind === 'list') parts.push(el.heading ?? '', ...el.items.map((i) => `${i.term} ${i.meaning ?? ''}`));
    return parts.join(' ');
  };
  const problems: GateProblem[] = [];
  for (const beat of lesson.beats) {
    if (!beat.ask) continue;
    const where = plannerOf(beat.id);
    const answer = beat.ask.whyProbe?.options.find((o) => o.correct)?.text ?? beat.ask.expect ?? '';
    const asked = stemsOf(beat.ask.question);
    const key = stemsOf(answer).filter((w) => !asked.some((q) => same(q, w)));
    if (key.length === 0 || key.length > 4) continue;
    const onPage = beat.show
      .filter((id) => id === where || id.startsWith(`${where}_`))
      .map((id) => byId.get(id))
      .filter((el): el is Element => el !== undefined);
    const shown = onPage.find((el) => {
      const ink = stemsOf(inkOf(el));
      return key.every((k) => ink.some((w) => same(w, k)));
    });
    if (!shown) continue;
    problems.push({
      rule: 'answer-shown',
      where: beat.id,
      message:
        `Beat "${where}": the class asks "${beat.ask.question}" while its answer is already on the board ` +
        `("${inkOf(shown).slice(0, 40)}"). Ask before you show: put the place, label, write or list that names ` +
        `it after a say that FOLLOWS the ask, or ask about something the board does not name yet.`,
    });
  }
  return problems;
}

/**
 * The four rules a composed class is held to (board composer).
 *
 * page-full       the class leaves no page under PAGE_FULL written on, and a
 *                 subtopic with a main demonstration has its notes, its key
 *                 points and its summary. The opening is held to neither.
 * phone-readable  at every line's frame, on an 812 x 375 phone, the smallest
 *                 writing in that frame is at least PHONE_MIN_PX. On a
 *                 pull-out only what that line writes is held to it: the rest
 *                 of the page was read close before.
 * one-main        every beat is one composed page: none was laid out as a
 *                 stack because it held two main demonstrations, or names on
 *                 something that is not a picture.
 * answer-shown    no ask is held while its answer is written on its page
 *                 (answerShown, above).
 *
 * A class that is not composed has no report, and no rule runs.
 */
export function composerChecks(lesson: Lesson, report: ComposerReport | undefined): GateProblem[] {
  if (!report) return [];
  const problems: GateProblem[] = [];

  /** Planner beats whose writing ran onto a second page. */
  const ranOver = new Set(report.pages.filter((p) => p.sheet > 0).map((p) => p.plannerBeat));
  for (const page of report.pages) {
    if (page.opening || page.coverage >= PAGE_FULL) continue;
    const pct = Math.round(page.coverage * 100);
    problems.push({
      rule: 'page-full',
      where: page.beat,
      // A beat's second page is what did not fit its first, and its first page
      // is emptier for what moved: the fix for both is less on this beat,
      // never more writing — what a first page lacks is on the next one.
      message:
        page.sheet > 0
          ? `Beat "${page.plannerBeat}" ran onto another page, which the class leaves ${pct}% written on. ${LESS}`
          : ranOver.has(page.plannerBeat)
            ? `Beat "${page.plannerBeat}": what it writes did not fit on its page and ran onto another, leaving this ` +
              `one ${pct}% written on. ${LESS}`
            : `Beat "${page.plannerBeat}": the class leaves this page ${pct}% written on, and a page must be at least ` +
              `${PAGE_FULL * 100}%. ${whatItNeeds(page)}`,
    });
  }

  for (const stacked of report.stacked ?? []) {
    problems.push({
      rule: 'one-main',
      where: stacked.beat,
      message:
        `Beat "${stacked.plannerBeat}" is not one composed page: it has two main demonstrations (a picture, a scene, ` +
        `a flow, a chart or working), or names written on something that is not a picture. Give each main ` +
        `demonstration its own beat, and name only a picture's parts.`,
    });
  }

  const bySubtopic = new Map<string, PageReport[]>();
  for (const page of report.pages) bySubtopic.set(page.plannerBeat, [...(bySubtopic.get(page.plannerBeat) ?? []), page]);
  for (const [plannerBeat, pages] of bySubtopic) {
    if (pages.some((p) => p.opening) || !pages.some((p) => p.main)) continue;
    const missing = [
      ...(pages.some((p) => p.notes) ? [] : ['notes (a "list" of each part and what it does)']),
      ...(pages.some((p) => p.points > 0) ? [] : ['key points ("write")']),
      ...(pages.some((p) => p.summary) ? [] : ['a "summary"']),
    ];
    if (missing.length === 0) continue;
    problems.push({
      rule: 'page-full',
      where: pages[pages.length - 1].beat,
      message:
        `Beat "${plannerBeat}": a board with a main demonstration on it (a picture, a scene, a flow, a chart, ` +
        `working or a comparison) also needs ${missing.join(', ')}.`,
    });
  }

  problems.push(...answerShown(lesson));

  const overview = new Set(report.overview);
  const byId = new Map(lesson.elements.map((el) => [el.id, el]));
  lesson.beats.forEach((beat, n) => {
    if (!beat.frame || beat.frame.length === 0) return;
    // On a pull-out, only what this line writes: it is read nowhere else.
    const before = new Set(overview.has(beat.id) && n > 0 ? lesson.beats[n - 1].show : []);
    const held = overview.has(beat.id) ? beat.frame.filter((id) => beat.show.includes(id) && !before.has(id)) : beat.frame;
    if (held.length === 0) return;
    const frame = computeFrame(lesson, beat.frame, beat.focus ?? [], STAGE_ASPECT, PHONE_STAGE_W / MAX_UNIT_PX, beat.show);
    const scale = PHONE_STAGE_W / frame.w;
    let smallest: { px: number; words: string } | null = null;
    for (const id of held) {
      const el = byId.get(id);
      const writing = el ? writingOf(el) : null;
      if (!writing) continue;
      const px = writing.size * scale;
      if (!smallest || px < smallest.px) smallest = { px, words: writing.words };
    }
    if (smallest && smallest.px < PHONE_MIN_PX) {
      problems.push({
        rule: 'phone-readable',
        where: beat.id,
        message:
          `Beat "${plannerOf(beat.id)}": on a phone, "${smallest.words.slice(0, 40)}" is ${smallest.px.toFixed(1)}px ` +
          `while she says "${beat.narration.slice(0, 50)}", under ${PHONE_MIN_PX}px. That line writes in places too ` +
          `far apart for the camera to come close: split what it writes between two lines.`,
      });
    }
  });
  return problems;
}
