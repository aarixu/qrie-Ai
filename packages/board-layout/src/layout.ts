import { CANVAS_H, CANVAS_W, fitText, type Element } from '@ai-tutor/lesson-format';
import type { Instruction, LaidOutBeat, ScriptBeat } from './types';
import { annotateElement, connectElements, layoutScene } from './scene';
import { resolveOverlaps, type Bond } from './collide';

/**
 * The board's three bands. Nothing is ever placed outside them, and nothing
 * from one band can reach into another.
 *
 * TOP holds the heading. BOTTOM holds the one-line caption. Everything the
 * lesson is actually about lives in MAIN, stacked. Fixing the bands is what
 * makes "a title and a caption never collide with the teaching" true by
 * construction rather than by care.
 */
const TOP = { y: 56, h: 76 };
const MAIN = { y: 150, h: 330 };
const BOTTOM = { y: 548, h: 40 };

/** Side margins, and the gap between two stacked blocks. */
const SIDE = 70;
const GUTTER = 26;
const WIDTH = CANVAS_W - SIDE * 2;

/** A card row never gets thinner than this before it wraps to fewer per row. */
const MIN_CARD_W = 240;

/** Heights the renderer needs to agree with; see the notes on each. */
const EQUATION_H = 52;
const WRITE_H = 62;
const CARD_H = 128;
/** Rough wrapped height of a note at the renderer's 17px/1.55 in board units. */
const NOTE_LINE_H = 27;
const NOTE_PAD = 18;

/** One thing to place, and how much vertical room it insists on. */
interface Block {
  /** Fixed height, or null to share whatever is left over. */
  height: number | null;
  /** Turn an allotted rectangle into elements. */
  place: (rect: { x: number; y: number; w: number; h: number }) => Element[];
}

const idFor = (beatId: string, index: number, suffix = ''): string =>
  `${beatId}_${index}${suffix}`;

/**
 * How tall a note will be once wrapped.
 *
 * Approximated from character count rather than measured, because the layout
 * runs with no DOM. It only has to be close: the note is drawn in a
 * foreignObject that wraps on its own, so being a line out shifts the stack
 * slightly rather than clipping anything.
 */
function noteHeight(text: string, w: number): number {
  const perLine = Math.max(10, Math.floor(w / 8.4));
  const lines = text
    .split('\n')
    .reduce((n, para) => n + Math.max(1, Math.ceil(para.length / perLine)), 0);
  return lines * NOTE_LINE_H + NOTE_PAD;
}

/**
 * Turn one beat's instructions into positioned elements.
 *
 * Consecutive `card` instructions become one row, because that is what a person
 * means by two cards — side by side, equal width, aligned — and asking a model
 * to work that out is asking for the bug this package exists to remove.
 */
export interface RevealStep {
  /** What the tutor says while this step's elements arrive. */
  narration: string;
  /** Every element visible by the END of this step — a complete set, not a delta. */
  show: string[];
  focus: string[];
}

/**
 * A beat, laid out once and revealed in pieces.
 *
 * Layout runs over the WHOLE beat before anything is revealed, so the school
 * occupies the same spot whether it has appeared yet or not. Revealing it later
 * then costs nothing: the board does not reflow when a word lands, it fills in.
 * Reflowing on every noun is what would make a scene jump about while the tutor
 * is talking over it.
 */
export function layoutBeat(beat: ScriptBeat): {
  elements: Element[];
  laid: LaidOutBeat;
  steps: RevealStep[];
  /**
   * Pairs that are MEANT to overlap — a mark and what it marks, a card's frame
   * and the words inside it.
   *
   * Returned rather than kept private so a caller checking the board for
   * collisions sees the same truth the solver did. A checker that re-derived
   * this would eventually disagree with it, and then either flag a correct
   * board or pass a broken one.
   */
  bonds: Bond[];
} {
  const elements: Element[] = [];
  const show: string[] = [];
  const focus: string[] = [];
  const blocks: Block[] = [];

  /** Which element ids each instruction produced, so reveal can follow the words. */
  const byInstruction = new Map<number, string[]>();
  let current = -1;
  const emit = (el: Element, focused = false): void => {
    elements.push(el);
    show.push(el.id);
    if (focused) focus.push(el.id);
    const list = byInstruction.get(current);
    if (list) list.push(el.id);
    else byInstruction.set(current, [el.id]);
  };

  const items = beat.board;

  // The scene is laid out as ONE block, because a connector cannot be drawn
  // until both of its ends have somewhere to be. Collecting the places first is
  // what lets an arrow start at the edge of a box rather than guess.
  const places = items.filter((it) => it.do === 'place') as Extract<Instruction, { do: 'place' }>[];
  /** Pairs that are meant to overlap, so the solver leaves them alone. */
  const bonds: Bond[] = [];
  let sceneEmitted = false;
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    const index = i;
    current = i;

    switch (item.do) {
      case 'title': {
        emit({
          kind: 'title',
          id: idFor(beat.id, index),
          x: CANVAS_W / 2,
          y: TOP.y + 30,
          text: item.text,
          ...(item.sub ? { sub: item.sub } : {}),
        });
        i += 1;
        break;
      }

      case 'caption': {
        emit({
          kind: 'text',
          id: idFor(beat.id, index),
          x: CANVAS_W / 2,
          y: BOTTOM.y + 14,
          text: item.text,
        });
        i += 1;
        break;
      }

      case 'diagram': {
        const ref = item.ref;
        // A picture takes whatever room the rest of the beat leaves it.
        blocks.push({
          height: null,
          place: (r) => {
            const el: Element = {
              kind: 'diagram',
              id: ref,
              x: r.x,
              y: r.y,
              w: r.w,
              h: r.h,
              src: `generated/${ref}.svg`,
              alt: ref.replace(/_/g, ' '),
              parts: [],
            };
            return [el];
          },
        });
        i += 1;
        break;
      }

      case 'chart': {
        blocks.push({
          height: null,
          place: (r) => [
            {
              kind: 'chart',
              id: idFor(beat.id, index),
              x: r.x,
              y: r.y,
              w: r.w,
              h: r.h,
              chartType: 'bar',
              ...(item.caption ? { caption: item.caption } : {}),
              ...(item.unit ? { unit: item.unit } : {}),
              data: item.data,
              ...(item.tone ? { tone: item.tone } : {}),
            },
          ],
        });
        i += 1;
        break;
      }

      case 'flow': {
        blocks.push({
          height: 120,
          place: (r) => [
            {
              kind: 'flow',
              id: idFor(beat.id, index),
              x: r.x,
              y: r.y,
              w: r.w,
              steps: item.steps,
              ...(item.tone ? { tone: item.tone } : {}),
            },
          ],
        });
        i += 1;
        break;
      }

      case 'equation': {
        blocks.push({
          height: EQUATION_H,
          place: (r) => [
            {
              kind: 'formula',
              id: idFor(beat.id, index),
              x: CANVAS_W / 2,
              y: r.y + EQUATION_H * 0.66,
              text: item.text,
            },
          ],
        });
        i += 1;
        break;
      }

      case 'write': {
        blocks.push({
          height: WRITE_H,
          place: (r) => [
            {
              kind: 'handwrite',
              id: idFor(beat.id, index),
              x: CANVAS_W / 2,
              y: r.y + WRITE_H * 0.7,
              text: item.text,
              size: 36,
              ...(item.tone ? { tone: item.tone } : {}),
            },
          ],
        });
        i += 1;
        break;
      }

      case 'note': {
        const text = item.text;
        const tone = item.tone;
        blocks.push({
          height: noteHeight(text, WIDTH * 0.68),
          place: (r) => {
            const w = Math.min(r.w, WIDTH * 0.68);
            return [
              {
                kind: 'note',
                id: idFor(beat.id, index),
                x: CANVAS_W / 2 - w / 2,
                y: r.y,
                w,
                text,
                ...(tone ? { tone } : {}),
              },
            ];
          },
        });
        i += 1;
        break;
      }

      case 'card': {
        // Gather the run of cards; they are one row, not three blocks.
        const run: Extract<Instruction, { do: 'card' }>[] = [];
        while (i < items.length && items[i].do === 'card') {
          run.push(items[i] as Extract<Instruction, { do: 'card' }>);
          i += 1;
        }
        const perRow = Math.max(1, Math.min(run.length, Math.floor(WIDTH / MIN_CARD_W)));
        const rows = Math.ceil(run.length / perRow);
        blocks.push({
          height: rows * CARD_H + (rows - 1) * GUTTER,
          place: (r) => {
            const out: Element[] = [];
            const cardW = (r.w - (perRow - 1) * GUTTER) / perRow;
            run.forEach((card, n) => {
              const row = Math.floor(n / perRow);
              const col = n % perRow;
              const x = r.x + col * (cardW + GUTTER);
              const y = r.y + row * (CARD_H + GUTTER);
              // A card is a box plus its body line, and the box's own label is
              // left empty: the heading is drawn as text so the two never fight
              // for the box's centre — which is exactly how they collided when
              // a model was placing them.
              out.push({
                kind: 'box',
                id: idFor(beat.id, index, `_c${n}`),
                x,
                y,
                w: cardW,
                h: CARD_H,
                label: '',
                ...(card.tone ? { tone: card.tone } : {}),
                ...(card.as ? { as: card.as } : {}),
              });
              // The box is this card's own frame; its heading and body are
              // meant to sit inside it.
              bonds.push({ a: idFor(beat.id, index, `_c${n}`), b: idFor(beat.id, index, `_h${n}`) });
              bonds.push({ a: idFor(beat.id, index, `_c${n}`), b: idFor(beat.id, index, `_b${n}`) });
              out.push({
                kind: 'text',
                id: idFor(beat.id, index, `_h${n}`),
                x: x + cardW / 2,
                y: y + 38,
                text: card.heading,
                // Sized to its own card: a heading wider than the box it sits
                // in runs into the card beside it.
                size: fitText(card.heading, cardW - 24, 19),
              });
              out.push({
                kind: 'text',
                id: idFor(beat.id, index, `_b${n}`),
                x: x + cardW / 2,
                y: y + 78,
                text: card.body,
                size: fitText(card.body, cardW - 24, 16),
              });
            });
            return out;
          },
        });
        break;
      }

      case 'say': {
        // Says no element of its own; it marks where the board pauses for words.
        i += 1;
        break;
      }

      case 'place':
      case 'connect':
      case 'annotate': {
        if (sceneEmitted) {
          i += 1;
          break;
        }
        sceneEmitted = true;
        const sceneSteps = items;
        blocks.push({
          height: null,
          place: (r) => {
            const { elements: figures, boxes } = layoutScene(places, r, (authorId) => `${beat.id}__${authorId}`);
            const out: Element[] = [...figures];
            // Attribute each figure back to the instruction that placed it, so
            // it can appear on the word that named it rather than all at once.
            for (const box of boxes.values()) {
              const n = sceneSteps.findIndex((it) => it.do === 'place' && it.id === box.id);
              if (n >= 0) byInstruction.set(n, [...(byInstruction.get(n) ?? []), box.elementId]);
            }
            let connectors = 0;
            sceneSteps.forEach((it, n) => {
              if (it.do === 'connect') {
                const made = connectElements(it, boxes, idFor(beat.id, n), connectors);
                connectors += 1;
                out.push(...made);
                byInstruction.set(n, [...(byInstruction.get(n) ?? []), ...made.map((m) => m.id)]);
              } else if (it.do === 'annotate') {
                const made = annotateElement(it, boxes, idFor(beat.id, n));
                // A mark is MEANT to sit on what it marks; the solver must not
                // push the circle off the thing it is circling.
                const target = boxes.get(it.target);
                if (target) for (const m of made) bonds.push({ a: m.id, b: target.elementId });
                out.push(...made);
                byInstruction.set(n, [...(byInstruction.get(n) ?? []), ...made.map((m) => m.id)]);
              }
            });
            return out;
          },
        });
        i += 1;
        break;
      }

      case 'point': {
        // Not a block: it moves no geometry, it only decides what is bright.
        focus.push(`${item.ref}#${item.part}`);
        i += 1;
        break;
      }
    }
  }

  // --- stack the blocks down MAIN ---
  const fixed = blocks.reduce((sum, b) => sum + (b.height ?? 0), 0);
  const flexible = blocks.filter((b) => b.height === null).length;
  const gutters = Math.max(0, blocks.length - 1) * GUTTER;
  const spare = Math.max(0, MAIN.h - fixed - gutters);
  const flexH = flexible > 0 ? spare / flexible : 0;

  // With no flexible block the stack is shorter than MAIN, so centre it rather
  // than leaving all the empty space at the bottom.
  const stackH = fixed + gutters + flexible * flexH;
  let y = MAIN.y + (flexible === 0 ? Math.max(0, (MAIN.h - stackH) / 2) : 0);

  for (const block of blocks) {
    const h = block.height ?? flexH;
    for (const el of block.place({ x: SIDE, y, w: WIDTH, h })) emit(el);
    y += h + GUTTER;
  }

  // Nothing on the board sits on anything else.
  //
  // The stacking rules already keep blocks apart; this catches the things drawn
  // BETWEEN and OVER them — a connector's label, a mark — which follow whatever
  // they refer to and so can land anywhere. Fixing those case by case fixes one
  // lesson at a time; this fixes every lesson.
  const settled = resolveOverlaps(elements, bonds, { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H });

  // A part can only be pointed at if its picture is on the board this beat.
  const shown = new Set(show);
  const keptFocus = focus.filter((f) => shown.has(f.split('#')[0]));

  return {
    elements: settled,
    laid: { show, focus: keptFocus },
    steps: revealSteps(beat, byInstruction, keptFocus),
    bonds,
  };
}

/**
 * Split a beat into the moments its words divide it into.
 *
 * Everything written after a `say` arrives while that line is spoken, so the
 * board fills in with the sentence instead of appearing finished before the
 * tutor has opened her mouth. A beat with no `say` is one moment, and its whole
 * board arrives together — which is right for a beat that is one breath.
 *
 * `show` is cumulative because it is a complete set, not a delta: the board at
 * any moment is everything said so far, which is also what makes any moment
 * recallable on its own.
 */
function revealSteps(
  beat: ScriptBeat,
  byInstruction: ReadonlyMap<number, string[]>,
  focus: readonly string[],
): RevealStep[] {
  const says = beat.board.filter((it) => it.do === 'say');
  if (says.length === 0) {
    return [
      {
        narration: beat.narration,
        show: [...new Set([...byInstruction.values()].flat())],
        focus: [...focus],
      },
    ];
  }

  const steps: RevealStep[] = [];
  const cumulative: string[] = [];
  let narration: string | null = null;

  const flush = (): void => {
    if (narration === null) return;
    steps.push({ narration, show: [...cumulative], focus: [] });
  };

  beat.board.forEach((item, n) => {
    if (item.do === 'say') {
      flush();
      narration = item.text;
      return;
    }
    for (const id of byInstruction.get(n) ?? []) {
      if (!cumulative.includes(id)) cumulative.push(id);
    }
  });
  flush();

  // Anything drawn before the first word still belongs on the board from the
  // start — a title written above the scene should not wait for a sentence.
  if (steps.length > 0) {
    const early = beat.board
      .slice(0, beat.board.findIndex((it) => it.do === 'say'))
      .flatMap((_, n) => byInstruction.get(n) ?? []);
    for (const step of steps) {
      for (const id of early) if (!step.show.includes(id)) step.show.unshift(id);
    }
    // The beat's emphasis belongs to its last moment, where the point is made.
    steps[steps.length - 1].focus = [...focus];
  }
  return steps;
}

/** The board is this tall and no taller; exported so callers can assert it. */
export const BOARD = { w: CANVAS_W, h: CANVAS_H, TOP, MAIN, BOTTOM, SIDE, GUTTER };
