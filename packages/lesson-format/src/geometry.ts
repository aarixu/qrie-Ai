import type { Element } from './types';
import { CANVAS_W } from './types';

/**
 * HOW BIG IS THIS ELEMENT.
 *
 * A property of the element, so it lives with the element. It used to live only
 * in the renderer's camera, where the layout engine could not see it — which
 * meant layout could place two things on top of each other and nothing in the
 * system was able to notice.
 *
 * Pure, and with no DOM: the same answer on a server, in a test and in a
 * browser. Two different answers would frame a note that is not the size it
 * renders at, or let a solver believe an overlap it cannot see.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Advance-width estimates, in ems. Text has no measurable width without a DOM,
 * so it is estimated — generously. An over-wide estimate spaces things slightly
 * far apart; an under-wide one lets two labels touch, which is much worse.
 */
const EM_SANS = 0.58;
const EM_MONO = 0.62;
/**
 * The lines she writes, in Quicksand at weight 600, in ems a character.
 *
 * Her lines used to be drawn in Caveat, a handwriting face, and Aarav found it
 * odd to read (2026-10-07). They are now drawn in the face the rest of the
 * board uses, and this is that face measured: every printable ASCII glyph's
 * advance at weight 600, the weight her lines are drawn at, read with canvas
 * measureText from the self-hosted 'Quicksand Variable' file.
 *
 * PER GLYPH, NOT PER KIND OF GLYPH. Caveat's letters were nearly one width, so
 * one figure for lowercase did; Quicksand's are not — an i is 0.23 and a g is
 * 0.63 — and a lowercase mean came out under the drawn width on "good dog".
 * Summed glyph by glyph the ruler lands within -0.4% to +1.0% of the shaped
 * line over every handwritten line in content/, and `HAND_MARGIN` is kept on
 * top so it is never under.
 *
 * Anything not in the table — Devanagari, which Baloo 2 draws for her, or a
 * symbol the face lacks — is counted at `HAND_WIDE`: generous, because a line
 * measured short is a line the mask clips.
 */
const HAND_EMS: Readonly<Record<string, number>> = {
  ' ': 0.278, '!': 0.24, '"': 0.414, '#': 0.68, $: 0.585, '%': 0.803, '&': 0.699, "'": 0.206,
  '(': 0.363, ')': 0.363, '*': 0.345, '+': 0.573, ',': 0.248, '-': 0.394, '.': 0.226, '/': 0.553,
  '0': 0.608, '1': 0.383, '2': 0.564, '3': 0.533, '4': 0.568, '5': 0.566, '6': 0.548, '7': 0.537, '8': 0.545, '9': 0.565,
  ':': 0.244, ';': 0.262, '<': 0.524, '=': 0.586, '>': 0.527, '?': 0.513, '@': 0.967,
  A: 0.642, B: 0.654, C: 0.636, D: 0.716, E: 0.571, F: 0.563, G: 0.696, H: 0.719, I: 0.267, J: 0.559,
  K: 0.662, L: 0.552, M: 0.822, N: 0.733, O: 0.761, P: 0.601, Q: 0.762, R: 0.681, S: 0.585, T: 0.619,
  U: 0.708, V: 0.674, W: 0.951, X: 0.639, Y: 0.584, Z: 0.647,
  '[': 0.404, '\\': 0.553, ']': 0.404, '^': 0.585, _: 0.692, '`': 0.248,
  a: 0.621, b: 0.621, c: 0.519, d: 0.621, e: 0.582, f: 0.411, g: 0.633, h: 0.58, i: 0.229, j: 0.273,
  k: 0.558, l: 0.257, m: 0.919, n: 0.59, o: 0.617, p: 0.621, q: 0.621, r: 0.418, s: 0.478, t: 0.386,
  u: 0.581, v: 0.551, w: 0.763, x: 0.486, y: 0.581, z: 0.482,
  '{': 0.41, '|': 0.234, '}': 0.41, '~': 0.514,
  '—': 0.87, '–': 0.514, '→': 0.584, '×': 0.488, '°': 0.373,
  '’': 0.248, '“': 0.42, '”': 0.42, '…': 0.603,
};
/** Kept on top of the summed advances: the most the sum fell short by, and a little more. */
const HAND_MARGIN = 1.03;
/** A character the table does not hold. */
const HAND_WIDE = 0.95;

function handEms(text: string): number {
  let ems = 0;
  for (const ch of text) ems += HAND_EMS[ch] ?? HAND_WIDE;
  return ems * HAND_MARGIN;
}

/**
 * HOW LONG A WRITTEN LINE TAKES TO COME OUT OF HER HAND.
 *
 * A property of the text, like its width, so it lives here beside the width.
 * The renderer times each line this way — a fixed duration made a three-word
 * label crawl and a full sentence blur past, the two things a person writing
 * does not do — while layout, deciding when the NEXT line could start, counted
 * a flat 620ms of its own. A long first line was therefore still being written
 * when its second line began.
 *
 * Clamped at both ends: fast enough that a long point does not outlast what
 * she is saying over it, slow enough that a short one still reads as written
 * rather than printed.
 */
const WRITE_MS_PER_CHAR = 46;
const WRITE_MS_MIN = 480;
const WRITE_MS_MAX = 2600;

export const writeMs = (text: string): number =>
  Math.round(Math.min(WRITE_MS_MAX, Math.max(WRITE_MS_MIN, text.length * WRITE_MS_PER_CHAR)));

/**
 * Mirrors the renderer's note layout: the card wraps at roughly this many
 * characters and every wrapped line is 21 units tall, over a 60-unit allowance
 * for padding.
 */
/**
 * A note is written at 17px on a 1.55 line, indented past its rule.
 *
 * These are the renderer's own numbers, and they live here because three
 * places needed them and each had guessed: the stacker budgeted 45 units for
 * a one-line note, this box claimed 81, and the tutor actually drew 30. A
 * budget smaller than the box let the next block land on the note; a box
 * larger than the drawing made the camera frame empty air.
 */
export const NOTE_FONT = 17;
export const NOTE_LINE_H = NOTE_FONT * 1.55;
/** 2 above and 2 below, from the note's own padding. */
export const NOTE_PAD_Y = 4;
/** The rule and the gap after it, taken out of the writable width. */
export const NOTE_INSET_X = 18;

export function noteBoxHeight(text: string, w: number): number {
  // Slightly narrower than the font really measures, so a wrong guess reserves
  // room rather than running out of it.
  const perLine = Math.max(6, Math.floor((w - NOTE_INSET_X) / 8));
  const lines = text
    .split('\n')
    .reduce((n, para) => n + Math.max(1, Math.ceil(para.length / perLine)), 0);
  return lines * NOTE_LINE_H + NOTE_PAD_Y;
}

/** One step's box in a flow, and the gap to the next. */
export const FLOW_STEP_H = 118;
export const FLOW_GAP = 40;

/** How tall a flow is, from its step count alone. */
export function flowHeight(steps: number, direction: 'row' | 'column' = 'row'): number {
  if (steps <= 0) return 0;
  if (direction === 'row') return FLOW_STEP_H;
  return steps * FLOW_STEP_H + (steps - 1) * FLOW_GAP;
}

/**
 * MATHS ON THE BOARD IS WRITTEN IN LaTeX, BETWEEN `$…$` (T6, 2026-09-29).
 *
 * Aarav: "this question should be written as an equation, why is it in
 * English? Use LaTeX." A board line may carry inline maths — "If $x + y = 7$,
 * write $x$ in terms of $y$" — and the stage typesets it (KaTeX). The layout
 * still measures plain characters, so this is how wide the maths will read:
 * the LaTeX with its markup taken off, "\frac{a}{b}" as "a/b".
 */
export const hasMath = (text: string): boolean => /\$[^$]+\$/.test(text);

export function mathPlain(text: string): string {
  if (!hasMath(text)) return text;
  return text.replace(/\$([^$]+)\$/g, (_, tex: string) =>
    tex
      .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2')
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√$1')
      .replace(/\\(?:left|right|displaystyle|,|;|!|quad|qquad)/g, ' ')
      .replace(/\\(?:times|cdot|div|pm|neq|leq|geq|le|ge|ne|pi|theta|alpha|beta|degree|circ)/g, '×')
      .replace(/\\[a-zA-Z]+/g, '')
      .replace(/[{}^_\\]/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

/**
 * A board line's `$…$` maths as the plain maths it MEANS, for anything that
 * reads the maths rather than measuring it — the maths check, and the spoken
 * fallback for a question with only a board form. `mathPlain` above is for
 * width and is lossy on purpose ("2^{x}" reads as "2x" there); this keeps the
 * meaning: powers as "^(…)", fractions as "(a)/(b)", "\div" as "÷".
 *
 * Null when the maths holds a command this cannot translate faithfully, a
 * mixed number, or a subscript — the
 * caller then treats the line as unreadable rather than checking a guess
 * (seventh review, 2026-09-29: "2^{x} = 32" was read as "2x = 32" and a correct
 * class was refused).
 */
const LATEX_SYMBOLS: Record<string, string> = {
  times: '×', div: '÷', cdot: '·', pm: '±', mp: '∓', neq: '≠', ne: '≠', leq: '≤', le: '≤', geq: '≥', ge: '≥',
  pi: 'π', theta: 'θ', alpha: 'α', beta: 'β', gamma: 'γ', infty: '∞', circ: '°', degree: '°', approx: '≈',
  percent: '%', ldots: '…', cdots: '…',
  // The joins of a line of working, which the maths check reads as "follows".
  Rightarrow: '⇒', implies: '⇒', therefore: '∴', rightarrow: '⇒', Longrightarrow: '⇒', longrightarrow: '⇒',
  to: '⇒',
};

export function latexToPlain(text: string): string | null {
  if (!hasMath(text)) return text;
  let failed = false;
  const out = text.replace(/\$([^$]+)\$/g, (_, tex: string) => {
    // A mixed number ("2\frac{1}{2}") would read as 2 × ½, and a subscript
    // would be dropped, so x_{1} and x_{2} both read as x (eighth review).
    if (/\d\s*\\[dt]?frac/.test(tex) || /_/.test(tex)) failed = true;
    let t = tex;
    for (let i = 0; i < 4; i += 1) {
      t = t
        .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
        .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
        .replace(/\\(?:text|mathrm|operatorname|mathbf|mathit)\s*\{([^{}]*)\}/g, '$1')
        .replace(/\^\s*\{([^{}]*)\}/g, '^($1)');
    }
    t = t
      // Only the sizing commands: "\rightarrow" is an arrow, not "arrow".
      .replace(/\\(?:left|right)(?![A-Za-z])/g, '')
      .replace(/\\[,;:! ]|\\quad|\\qquad/g, ' ')
      .replace(/\\%/g, '%')
      .replace(/\\([A-Za-z]+)/g, (m, name: string) => {
        const sym = LATEX_SYMBOLS[name];
        if (sym === undefined) failed = true;
        return sym ?? m;
      });
    if (/[{}\\]/.test(t)) failed = true;
    return t;
  });
  return failed ? null : out.replace(/\s+/g, ' ').trim();
}

/** How wide one line of text will be drawn at this size — maths measured by what it reads as. */
export function textWidth(text: string, size: number, mono = false): number {
  return mathPlain(text).length * size * (mono ? EM_MONO : EM_SANS);
}

/**
 * How wide one line SHE WRITES will be drawn (a `handwrite`). A line with
 * `$…$` maths in it is typeset by KaTeX rather than drawn in her face, so it
 * keeps the sans measure.
 */
export function handWidth(text: string, size: number): number {
  return hasMath(text) ? textWidth(text, size) : handEms(text) * size;
}

/** `wrapLines`, measured as her handwriting. */
export function wrapHand(text: string, w: number, size: number): string[] {
  return wrapLines(text, w, size, handWidth);
}

/** `fitText`, measured as her handwriting. */
export function fitHand(text: string, maxWidth: number, preferred: number, min = 12): number {
  if (text.length === 0 || maxWidth <= 0) return preferred;
  return Math.max(min, Math.min(preferred, (maxWidth / handWidth(text, preferred)) * preferred));
}

/**
 * Break a line into lines that fit a column, on whole words.
 *
 * On whole words because a teacher does not hyphenate on a board, and a single
 * word longer than the column stays on its own line and overhangs slightly,
 * which is what happens on a real board too.
 *
 * It lives beside `textWidth` because it is that measurement applied — the
 * layout engine had its own copy that guessed half an em per character, packed
 * more onto a line than would fit, and ran text past the very margin it was
 * wrapping for. One ruler.
 */
export function wrapLines(
  text: string,
  w: number,
  size: number,
  measure: (text: string, size: number) => number = textWidth,
): string[] {
  const lines: string[] = [];
  let line = '';
  // A `$…$` group is one word, whatever spaces it holds: maths is never
  // broken across two lines, and a half-open `$` would typeset nothing.
  const words = hasMath(text) ? (text.match(/(?:\$[^$]*\$|[^\s$])+/g) ?? [text]) : text.split(/\s+/);
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next, size) > w) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
}

/**
 * A LIST: a heading over numbered "term — meaning" items.
 *
 * The shape most of a notes page is made of, and the one this board could not
 * draw — a card gives a heading over one paragraph, which turns four named
 * parts into a blob.
 *
 * These are the renderer's own numbers, and they live here because the stacker,
 * the collision solver and the renderer all need the identical answer.
 */
/**
 * How big a board's heading is drawn.
 *
 * Forty-four, unless the words do not fit the board — "Summary: The Journey of
 * Light in the Eye" at forty-four is a thousand and twenty-one units wide on a
 * board a thousand wide, and ran off both edges of its own page. It lives here
 * because the renderer draws it and `boxOf` measures it, and the two agreeing
 * is what stops the camera framing a heading that is not the size it renders.
 */
export const TITLE_SIZE = 44;
export function titleSize(text: string): number {
  return fitText(text, CANVAS_W, TITLE_SIZE, 24);
}

export const LIST_HEADING_SIZE = 21;
export const LIST_ITEM_SIZE = 18;
/** Line spacing inside one item, and the gap between two items. */
export const LIST_LINE_H = 1.42;
export const LIST_ITEM_GAP = 9;
/** The numbers hang in this much room, so wrapped lines line up under the text. */
export const LIST_INDENT = 26;
/** Under the heading, before the first item. */
export const LIST_HEADING_GAP = 12;

/**
 * The text of one item as it is drawn: "Right atrium — receives blood".
 *
 * A term that arrives already numbered — "1. Spaces between them" — loses its
 * number here, because the list draws its own and a real board came out
 * reading "1. 1. Spaces between them". The list owns the numbering; a term is
 * the words.
 */
export function listItemText(item: { term: string; meaning?: string }): string {
  const term = item.term.replace(/^\s*\(?\d+[.)]\s*/, '').trim();
  return item.meaning ? `${term} — ${item.meaning}` : term;
}

export function listBoxHeight(
  items: readonly { term: string; meaning?: string }[],
  heading: string | undefined,
  w: number,
  size: number = LIST_ITEM_SIZE,
): number {
  const lead = size * LIST_LINE_H;
  const body = items.reduce((sum, item, n) => {
    const lines = wrapLines(`${n + 1}. ${listItemText(item)}`, w - LIST_INDENT, size);
    return sum + lines.length * lead + LIST_ITEM_GAP;
  }, 0);
  const head = heading ? LIST_HEADING_SIZE * LIST_LINE_H + LIST_HEADING_GAP : 0;
  return head + Math.max(0, body - LIST_ITEM_GAP);
}

/**
 * Where item `n` of a list is drawn: its row, from its first line to its last,
 * across the text's width — by the same measure listBoxHeight uses, so a mark
 * on an item lands on the item.
 */
export function listItemBox(
  list: { x: number; y: number; w: number; heading?: string; items: readonly { term: string; meaning?: string }[]; size?: number },
  n: number,
): Rect | null {
  if (n < 0 || n >= list.items.length) return null;
  const size = list.size ?? LIST_ITEM_SIZE;
  const lead = size * LIST_LINE_H;
  let y = list.y + (list.heading ? LIST_HEADING_SIZE * LIST_LINE_H + LIST_HEADING_GAP : 0);
  for (let k = 0; k < n; k += 1) {
    y += wrapLines(`${k + 1}. ${listItemText(list.items[k])}`, list.w - LIST_INDENT, size).length * lead + LIST_ITEM_GAP;
  }
  const lines = wrapLines(`${n + 1}. ${listItemText(list.items[n])}`, list.w - LIST_INDENT, size).length;
  return { x: list.x, y, w: list.w, h: lines * lead };
}

/**
 * The largest size at which this text still fits the width it is given.
 *
 * Anything that can be longer than its container must ASK rather than hope. A
 * card's body line spilled into the neighbouring card, and a connector's label
 * was written across both pictures it ran between — the same mistake twice,
 * because two different places each guessed.
 *
 * Never returns less than `min`: past that the text is unreadable, and text
 * nobody can read is not a smaller problem than text that overlaps.
 */
export function fitText(
  text: string,
  maxWidth: number,
  preferred: number,
  min = 12,
  mono = false,
): number {
  if (text.length === 0 || maxWidth <= 0) return preferred;
  const em = mono ? EM_MONO : EM_SANS;
  return Math.max(min, Math.min(preferred, maxWidth / (mathPlain(text).length * em)));
}

/**
 * How big a graphic's label is written, and therefore how wide it is.
 *
 * One function, used by the renderer that draws the label, the camera that
 * frames it and the layout that spaces neighbours around it. Three separate
 * guesses is how two icons ended up standing politely apart while their labels
 * lay printed across each other.
 *
 * Capped at 1.8x the icon's width: past that the label dominates the picture
 * it names, and a long name should shrink rather than shout.
 */
export function graphicLabelSize(
  iconW: number,
  label: string,
  side: 'below' | 'beside' = 'below',
): number {
  // Beneath, a label must not dominate the picture it names. Beside, it has
  // the rest of the row and only needs to be legible.
  return fitText(label, iconW * (side === 'beside' ? 3.5 : 1.8), 26, 14);
}

/**
 * The gap between a picture and a name written beside it.
 *
 * Wide enough that a teacher's loop around the picture — which overshoots it
 * by design — does not run into the first letter of its name.
 */
export const BESIDE_GAP = 22;

/**
 * A rect around a centred single line of text, `em` wide a character — counted
 * by what the text READS as (`mathPlain`), not by its LaTeX source: a label
 * written `$\frac{1}{2}$` is three characters on the board, not twelve.
 */
function centredText(x: number, y: number, text: string, size: number, em: number): Rect {
  return centredWidth(x, y, mathPlain(text).length * size * em, size);
}

function centredWidth(x: number, y: number, w: number, size: number): Rect {
  return { x: x - w / 2, y: y - size, w, h: size * 1.35 };
}

function fromPoints(points: readonly { x: number; y: number }[]): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** Do these two boxes share any area? Touching edges do not count. */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The box an element occupies on the board, in canvas units. */
export function boxOf(el: Element): Rect {
  switch (el.kind) {
    case 'title': {
      const head = centredText(el.x, el.y, el.text, titleSize(el.text), EM_SANS);
      if (!el.sub) return head;
      return union(head, centredText(el.x, el.y + 38, el.sub, 19, EM_SANS));
    }
    case 'text':
      return centredText(el.x, el.y, el.text, el.size ?? 20, EM_SANS);
    case 'formula':
      return centredText(el.x, el.y, el.text, 24, EM_MONO);
    case 'handwrite':
      return centredWidth(el.x, el.y, handWidth(el.text, el.size ?? 26), el.size ?? 26);
    case 'note':
      return { x: el.x, y: el.y, w: el.w, h: noteBoxHeight(el.text, el.w) };
    case 'list':
      return {
        x: el.x,
        y: el.y,
        w: el.w,
        h: listBoxHeight(el.items, el.heading, el.w, el.size ?? LIST_ITEM_SIZE),
      };
    case 'box':
    case 'image':
    case 'diagram':
    case 'chart':
    case 'plot':
    case 'mark':
    case 'model3d':
    case 'tool':
      return { x: el.x, y: el.y, w: el.w, h: el.h };
    // A graphic's label hangs below its box and is part of the element: the
    // camera has to know about it, and so does anything trying not to sit on
    // it. The label is usually WIDER than the icon — "Overhead Tank (Roof)"
    // under a small picture — and a box that ignored that let other labels be
    // pushed onto it by a solver that could not see it was there.
    case 'graphic': {
      if (!el.label) return { x: el.x, y: el.y, w: el.w, h: el.h };
      if (el.labelSide === 'beside') {
        const labelW = textWidth(el.label, graphicLabelSize(el.w, el.label, 'beside'));
        return { x: el.x, y: el.y, w: el.w + BESIDE_GAP + labelW, h: el.h };
      }
      const labelW = textWidth(el.label, graphicLabelSize(el.w, el.label));
      const w = Math.max(el.w, labelW);
      return { x: el.x + el.w / 2 - w / 2, y: el.y, w, h: el.h + 34 };
    }
    case 'doc':
      return { x: el.x, y: el.y, w: el.w, h: el.h + (el.label ? 26 : 0) };
    case 'flow':
      return { x: el.x, y: el.y, w: el.w, h: flowHeight(el.steps.length, el.direction) };
    case 'arrow':
      return fromPoints([el.from, el.to]);
    case 'pen':
      return fromPoints(el.points);
  }
}
