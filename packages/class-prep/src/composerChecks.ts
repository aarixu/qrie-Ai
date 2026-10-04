import type { SheetReport } from '@ai-tutor/board-layout';
import { LIST_ITEM_SIZE, NOTE_FONT, STAGE_ASPECT, type Element, type Lesson } from '@ai-tutor/lesson-format';
import { computeFrame, MAX_UNIT_PX } from '../../stage/src/frame.ts';
import type { GateProblem } from './gate.ts';

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

/** How large an element's writing is, and a few of its words to name it by. */
function writingOf(el: Element): { size: number; words: string } | null {
  switch (el.kind) {
    case 'handwrite':
      return { size: el.size ?? 26, words: el.text };
    case 'text':
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
 * The three rules a composed class is held to (board composer).
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
 *
 * A class that is not composed has no report, and no rule runs.
 */
export function composerChecks(lesson: Lesson, report: ComposerReport | undefined): GateProblem[] {
  if (!report) return [];
  const problems: GateProblem[] = [];

  for (const page of report.pages) {
    if (page.opening || page.coverage >= PAGE_FULL) continue;
    const pct = Math.round(page.coverage * 100);
    problems.push({
      rule: 'page-full',
      where: page.beat,
      // A beat's second page is what did not fit its first: the fix is less
      // on this beat, never more writing.
      message:
        page.sheet > 0
          ? `Beat "${page.plannerBeat}" ran onto another page, which the class leaves ${pct}% written on. Give this ` +
            `beat less, or split it into two beats, each with its own page.`
          : `Beat "${page.plannerBeat}": the class leaves this page ${pct}% written on, and a page must be at least ` +
            `${PAGE_FULL * 100}%. Write each part's meaning in the notes, the key points as you say them, and a ` +
            `summary — or give this page less and the next one more.`,
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

  const overview = new Set(report.overview);
  const byId = new Map(lesson.elements.map((el) => [el.id, el]));
  lesson.beats.forEach((beat, n) => {
    if (!beat.frame || beat.frame.length === 0) return;
    // On a pull-out, only what this line writes: it is read nowhere else.
    const before = new Set(overview.has(beat.id) && n > 0 ? lesson.beats[n - 1].show : []);
    const held = overview.has(beat.id) ? beat.frame.filter((id) => beat.show.includes(id) && !before.has(id)) : beat.frame;
    if (held.length === 0) return;
    const frame = computeFrame(lesson, beat.frame, beat.focus ?? [], STAGE_ASPECT, PHONE_STAGE_W / MAX_UNIT_PX);
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
