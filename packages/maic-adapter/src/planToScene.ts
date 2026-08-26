import type { Element, Lesson } from '@ai-tutor/lesson-format';
import { WB_SCALE_Y } from '@ai-tutor/action-player';
import type { Action } from '@openmaic/dsl';
import type { BeatRange } from './beatOfAction';
import type { PlannedScene } from './types';

/**
 * Our canvas is 1000x620; their whiteboard verbs are documented in 1000x562.
 *
 * Elements are authored in OUR space, so every y leaving here is converted into
 * THEIRS - `reduce` scales it straight back on the way in, making the round trip
 * an identity. Emitting our y unconverted would push the whole lesson 10% down
 * the board and drop anything below y=562 off the bottom.
 *
 * Actions are kept in their space rather than ours so the prompt assets shipped
 * in @openmaic/generation keep producing coordinates that land correctly.
 */
const toWb = (y: number): number => y / WB_SCALE_Y;

/** Where an element sits, for the verbs that need a point rather than a box. */
function anchorOf(element: Element): { x: number; y: number } {
  if ('x' in element && 'y' in element) return { x: element.x, y: element.y };
  if (element.kind === 'arrow') return element.from;
  if (element.kind === 'pen') return element.points[0] ?? { x: 0, y: 0 };
  return { x: 0, y: 0 };
}

/** The text an element puts on the board, if any. */
function textOf(element: Element): string {
  switch (element.kind) {
    case 'title':
      return element.sub ? `${element.text} — ${element.sub}` : element.text;
    case 'text':
    case 'note':
      return element.text;
    case 'box':
      return element.label;
    case 'doc':
      return element.label ?? '';
    default:
      return '';
  }
}

/**
 * One element becomes one draw action, or nothing.
 *
 * A formula becomes `wb_draw_latex` rather than text, because that verb runs
 * through KaTeX — writing `C_6H_{12}O_6` as plain text would put the underscores
 * on the board.
 *
 * `image` and `pen` return null: there is no action verb for either yet. That
 * silence is asserted in the round-trip test so it cannot pass for success.
 */
function drawActionFor(element: Element, id: string): Action | null {
  const point = anchorOf(element);
  const x = point.x;
  const y = toWb(point.y);

  if (element.kind === 'formula') {
    return { id, type: 'wb_draw_latex', elementId: element.id, latex: element.text, x, y };
  }

  if (element.kind === 'box') {
    return {
      id,
      type: 'wb_draw_shape',
      elementId: element.id,
      shape: 'rectangle',
      x,
      y,
      width: element.w,
      height: toWb(element.h),
    };
  }

  if (element.kind === 'arrow') {
    return {
      id,
      type: 'wb_draw_line',
      elementId: element.id,
      startX: element.from.x,
      startY: toWb(element.from.y),
      endX: element.to.x,
      endY: toWb(element.to.y),
      style: element.dashed ? 'dashed' : 'solid',
    };
  }

  const text = textOf(element);
  if (text === '') return null;
  return { id, type: 'wb_draw_text', elementId: element.id, content: text, x, y };
}

/**
 * Turn a planned lesson into one action stream plus the map back to its beats.
 *
 * The order inside a beat is deliberate: the tutor SPEAKS first, then draws,
 * then points. That is the order a teacher works in — she says what she is
 * about to show, shows it, and only then directs attention to the part that
 * matters.
 *
 * `beat.show` is a complete set, not a delta, so this diffs it against what is
 * already on the board. Redrawing an element that is already there would make
 * the board flicker on every beat.
 */
export function planToScene(lesson: Pick<Lesson, 'elements' | 'beats'>): PlannedScene {
  const byId = new Map(lesson.elements.map((e) => [e.id, e]));
  const actions: Action[] = [];
  const beatRanges: BeatRange[] = [];
  const onBoard = new Set<string>();

  for (const beat of lesson.beats) {
    const from = actions.length;

    if (beat.narration.trim() !== '') {
      actions.push({ id: `${beat.id}__speech`, type: 'speech', text: beat.narration });
    }

    for (const elementId of beat.show) {
      if (onBoard.has(elementId)) continue;
      const element = byId.get(elementId);
      if (!element) continue; // a show id with no element draws nothing
      const action = drawActionFor(element, `${beat.id}__draw__${elementId}`);
      if (!action) continue;
      actions.push(action);
      onBoard.add(elementId);
    }

    for (const focusId of beat.focus ?? []) {
      actions.push({ id: `${beat.id}__focus__${focusId}`, type: 'spotlight', elementId: focusId });
    }

    beatRanges.push({ beatId: beat.id, from, to: actions.length });
  }

  return { actions, beatRanges };
}
