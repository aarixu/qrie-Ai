import type { Element } from '@ai-tutor/lesson-format';
import type { Action } from '@openmaic/dsl';
import { WB_SCALE_Y, type PlayerState } from './state';

/** Their y is 0-562, ours is 0-620. One conversion, one place. */
const sy = (y: number): number => y * WB_SCALE_Y;

/**
 * `wb_draw_text.content` is documented as "HTML string or plain text". Our
 * canvas draws real text, not markup, so tags are stripped rather than rendered
 * — a lesson that leaks `<p>` onto the board is worse than one that loses bold.
 */
const plain = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** Author-supplied id, else the action's own id — every element must be nameable. */
const idOf = (action: { id: string; elementId?: string }): string => action.elementId ?? action.id;

/** Append an element and show it. `visible` is a complete set, so this is a push. */
function draw(state: PlayerState, element: Element): PlayerState {
  return {
    ...state,
    elements: [...state.elements, element],
    visible: [...state.visible, element.id],
  };
}

/**
 * What one action does to the board.
 *
 * Returns the SAME object when an action changes nothing visual (speech, and
 * every verb we do not draw). Callers rely on that identity to skip re-renders,
 * and the tests assert it.
 */
export function reduce(state: PlayerState, action: Action): PlayerState {
  switch (action.type) {
    case 'wb_open':
      return { ...state, whiteboardOpen: true };

    case 'wb_close':
      return { ...state, whiteboardOpen: false };

    case 'wb_clear':
      return { ...state, elements: [], visible: [], focus: [] };

    case 'wb_delete': {
      const gone = action.elementId;
      return {
        ...state,
        elements: state.elements.filter((e) => e.id !== gone),
        visible: state.visible.filter((id) => id !== gone),
        focus: state.focus.filter((id) => id !== gone),
      };
    }

    case 'wb_draw_text':
      return draw(state, {
        kind: 'text',
        id: idOf(action),
        x: action.x,
        y: sy(action.y),
        text: plain(action.content),
      });

    case 'wb_draw_shape':
      return draw(state, {
        kind: 'box',
        id: idOf(action),
        x: action.x,
        y: sy(action.y),
        w: action.width,
        h: sy(action.height),
        label: '',
      });

    case 'wb_draw_line':
      return draw(state, {
        kind: 'arrow',
        id: idOf(action),
        from: { x: action.startX, y: sy(action.startY) },
        to: { x: action.endX, y: sy(action.endY) },
        dashed: action.style === 'dashed',
      });

    case 'wb_draw_latex':
      return draw(state, {
        kind: 'formula',
        id: idOf(action),
        x: action.x,
        y: sy(action.y),
        text: action.latex,
      });

    // A laser and a spotlight differ in how they LOOK, not in what they mean:
    // both say "this one, now". Focus dims everything else and hides nothing.
    case 'spotlight':
    case 'laser':
      return { ...state, focus: [action.elementId] };

    default:
      return state;
  }
}
