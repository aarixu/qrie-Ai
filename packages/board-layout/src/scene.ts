import {
  fitText,
  graphicLabelSize,
  textWidth,
  type Element,
  type Rect,
} from '@ai-tutor/lesson-format';
import type { Instruction } from './types';

export type PlaceStep = Extract<Instruction, { do: 'place' }>;
export type ConnectStep = Extract<Instruction, { do: 'connect' }>;
export type AnnotateStep = Extract<Instruction, { do: 'annotate' }>;

/** How big a placed noun is drawn. A scene reads badly when everything is equal. */
const SIZES = { small: 96, normal: 132, large: 176 } as const;

/** Room left under a graphic for its written label. */
const LABEL_ROOM = 38;
/** Space between two things in the same group, and between groups. */
const IN_GROUP = 22;
const BETWEEN_GROUPS = 96;

export interface Placed {
  /** The author's id, which is what `connect` and `annotate` name. */
  id: string;
  /**
   * The id the element actually carries on the board.
   *
   * Namespaced by beat, because a planner naturally writes `place: person` in
   * two different beats and means two different pictures. Without this the
   * lesson carries a duplicate element id and fails validation — which a real
   * run did, costing a repair round to fix something no author got wrong.
   */
  elementId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Lay a row of nouns across a band.
 *
 * Left to right in the order the tutor said them, because that is the order she
 * will point at them. Things sharing a `group` sit close together and groups
 * stand apart, which is the whole difference between "you and your friend, and
 * over there the school" and three evenly spaced icons that say nothing about
 * what belongs with what.
 *
 * Everything shares one baseline. A scene where the figures float at different
 * heights reads as a diagram of nothing.
 */
export function layoutScene(
  places: readonly PlaceStep[],
  band: { x: number; y: number; w: number; h: number },
  /** Makes an element id from the author's — see `Placed.elementId`. */
  namespaced: (authorId: string) => string = (id) => id,
): { elements: Element[]; boxes: Map<string, Placed> } {
  const boxes = new Map<string, Placed>();
  const elements: Element[] = [];
  if (places.length === 0) return { elements, boxes };

  // Rows stack down the band, each laid out on its own.
  //
  // The engine has no idea what a row MEANS — one lesson uses two rows for a
  // tank above a tank, another for before and after, a third for a grid. That
  // is the point: naming any of those would make this good at one and blind to
  // the others.
  const rows = [...new Set(places.map((p) => p.row ?? 0))].sort((a, b) => a - b);
  if (rows.length > 1) {
    const gapBetweenRows = 18;
    const each = (band.h - gapBetweenRows * (rows.length - 1)) / rows.length;
    for (const [n, row] of rows.entries()) {
      const strip = { ...band, y: band.y + n * (each + gapBetweenRows), h: each };
      const laid = layoutScene(
        places.filter((p) => (p.row ?? 0) === row),
        strip,
        namespaced,
      );
      elements.push(...laid.elements);
      for (const [k, v] of laid.boxes) boxes.set(k, v);
    }
    return { elements, boxes };
  }

  const anyLabel = places.some((p) => p.label);

  // Groups in first-appearance order; ungrouped items are their own group.
  const groups: PlaceStep[][] = [];
  const byName = new Map<string, PlaceStep[]>();
  for (const p of places) {
    if (p.group === undefined) {
      groups.push([p]);
      continue;
    }
    const existing = byName.get(p.group);
    if (existing) existing.push(p);
    else {
      const fresh = [p];
      byName.set(p.group, fresh);
      groups.push(fresh);
    }
  }

  const natural = (p: PlaceStep) => SIZES[p.size ?? 'normal'];

  /**
   * How wide this row really is at a given scale.
   *
   * The one ruler. The scale used to be solved against a cheaper estimate that
   * assumed every part of a place shrinks together — but a LABEL stops
   * shrinking at the readable floor, so the estimate kept promising room the
   * layout could not deliver, and five long-labelled pictures walked a
   * thousand units off the right-hand edge of the board.
   */
  const widthOf = (list: readonly PlaceStep[], k: number, groupCount: number, gapAt: number) => {
    const spanAt = (q: PlaceStep) => {
      const size = natural(q) * k;
      if (!q.label) return size;
      return Math.max(size, textWidth(q.label, graphicLabelSize(size, q.label)));
    };
    return (
      list.reduce((sum, q) => sum + spanAt(q), 0) +
      Math.max(0, list.length - groupCount) * IN_GROUP * k +
      Math.max(0, groupCount - 1) * gapAt * k
    );
  };

  const naturalW = widthOf(places, 1, places.length, 0);

  // Close the gaps first — a crowded scene beats a scene of tiny pictures.
  // Only when the drawings ALONE will not fit does everything shrink together,
  // so their relative sizes survive: a large thing stays larger than a small
  // one however many of them the tutor put on the board.
  const gapRoom = Math.max(0, band.w - naturalW);
  const wantedGaps = (groups.length - 1) * (BETWEEN_GROUPS - IN_GROUP);
  const gapScale = wantedGaps > 0 ? Math.min(1, gapRoom / wantedGaps) : 1;
  const gap = IN_GROUP + (BETWEEN_GROUPS - IN_GROUP) * gapScale;

  /**
   * Fill the band rather than sit in the middle of it.
   *
   * The natural sizes suit a crowded scene; two figures alone in a 330-unit
   * band drawn at 132 leave the board looking mostly empty, which is what a
   * lesson on Newton's third law actually looked like. So the scene scales to
   * whichever of width or height runs out first — capped, because a scene blown
   * up to fill every last unit stops looking like a board and starts looking
   * like a poster.
   */
  const MAX_GROW = 1.9;
  const MIN_SHRINK = 0.2;
  const roomH = band.h - (anyLabel ? LABEL_ROOM : 0);
  const tallestNatural = Math.max(...places.map(natural));
  const fitH = tallestNatural > 0 ? roomH / tallestNatural : 1;
  const ceiling = Math.min(MAX_GROW, Math.max(MIN_SHRINK, fitH));

  const fitsAt = (list: readonly PlaceStep[], k: number, groupCount: number) =>
    widthOf(list, k, groupCount, gap) <= band.w;

  /** The largest scale at which this row fits, or null if none does. */
  const solve = (list: readonly PlaceStep[], groupCount: number): number | null => {
    if (fitsAt(list, ceiling, groupCount)) return ceiling;
    if (!fitsAt(list, MIN_SHRINK, groupCount)) return null;
    let lo = MIN_SHRINK;
    let hi = ceiling;
    // Width is monotone in the scale, so bisection lands on the true answer
    // rather than near it.
    for (let n = 0; n < 24; n += 1) {
      const mid = (lo + hi) / 2;
      if (fitsAt(list, mid, groupCount)) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  const solved = solve(places, groups.length);

  // Nothing fits on one line, so wrap onto more — the move a teacher makes
  // when the board runs out sideways. Only ever from a single authored row:
  // rows the lesson asked for are its own arrangement and are never re-cut.
  if (solved === null) {
    for (let rowCount = 2; rowCount <= Math.min(4, places.length); rowCount += 1) {
      const per = Math.ceil(places.length / rowCount);
      const chunks = Array.from({ length: rowCount }, (_, n) =>
        places.slice(n * per, (n + 1) * per),
      ).filter((c) => c.length > 0);
      if (chunks.every((c) => solve(c, c.length) !== null)) {
        return layoutScene(
          places.map((q, n) => ({ ...q, row: Math.floor(n / per) })),
          band,
          namespaced,
        );
      }
    }
  }

  const shrink = solved ?? MIN_SHRINK;

  const sizeOf = (p: PlaceStep) => natural(p) * shrink;
  const tallest = Math.max(...places.map(sizeOf));

  /**
   * The width a place actually occupies: its icon, or its label, whichever is
   * wider. Spacing by the icon alone let two icons stand politely apart while
   * their labels lay printed across each other.
   */
  const spanOf = (p: PlaceStep): number => {
    const size = sizeOf(p);
    if (!p.label) return size;
    return Math.max(size, textWidth(p.label, graphicLabelSize(size, p.label)));
  };

  const groupW = (g: PlaceStep[]) =>
    g.reduce((sum, p) => sum + spanOf(p), 0) + (g.length - 1) * IN_GROUP * shrink;
  const laidW =
    groups.reduce((sum, g) => sum + groupW(g), 0) + (groups.length - 1) * gap * shrink;

  const baseline = band.y + (band.h - (tallest + (anyLabel ? LABEL_ROOM : 0))) / 2;
  let x = band.x + Math.max(0, (band.w - laidW) / 2);

  for (const [gi, group] of groups.entries()) {
    for (const p of group) {
      const size = sizeOf(p);
      const span = spanOf(p);
      // The icon stands centred in its span, bottom-aligned on the shared
      // baseline so a small thing stands on the same ground as a large one.
      const iconX = x + (span - size) / 2;
      const y = baseline + (tallest - size);
      const box: Placed = { id: p.id, elementId: namespaced(p.id), x: iconX, y, w: size, h: size };
      boxes.set(p.id, box);
      elements.push({
        kind: 'graphic',
        id: box.elementId,
        x: iconX,
        y,
        w: size,
        h: size,
        noun: p.noun,
        ...(p.label ? { label: p.label } : {}),
      });
      x += span + IN_GROUP * shrink;
    }
    x += (gap - IN_GROUP) * shrink;
    if (gi === groups.length - 1) break;
  }

  return { elements, boxes };
}

/**
 * The arrow between two placed things.
 *
 * It starts and ends at the EDGE of each box rather than its centre, so the
 * line does not run underneath the pictures it is joining — the mistake that
 * makes a connector look like a scribble across the drawing.
 */
export function connectElements(
  step: ConnectStep,
  boxes: ReadonlyMap<string, Placed>,
  id: string,
  /**
   * How many connectors already run roughly this way.
   *
   * Two arrows between the same pair of things land on top of each other, and
   * so do their labels — a real lesson drew "you to school" and "friend to
   * school" and the board read "1000 m1000 m". Each one after the first is
   * pushed sideways off the line, the way a person separates two arrows going
   * to the same place.
   */
  nudge = 0,
): Element[] {
  // Connecting a thing to itself says nothing, and draws a zero-length arrow
  // whose label lands dead centre on the picture with nowhere to escape to.
  if (step.from === step.to) return [];

  const a = boxes.get(step.from);
  const b = boxes.get(step.to);
  if (!a || !b) return [];

  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const pad = 14;

  // Perpendicular to the run of the arrow, alternating above and below. Wide
  // enough that two handwritten labels cannot touch: 26 units left "push on
  // wall" sitting on "push on hand".
  const step2 = Math.ceil(nudge / 2) * 46 * (nudge % 2 === 1 ? -1 : 1);
  const nx = -uy * step2;
  const ny = ux * step2;

  /**
   * An arrow always points from its start to its finish.
   *
   * Both ends are set in from the centre so the line begins at the edge of a
   * picture rather than under it — but when two things stand close together,
   * those two insets can add up to more than the distance between them, and
   * the endpoints cross. The arrowhead then lands on the wrong end and the
   * lesson says the opposite of what it meant.
   *
   * So the insets are scaled back together, keeping a short forward run.
   */
  const MIN_RUN = 18;
  const insetA = ux * ux * (a.w / 2 + pad) + uy * uy * (a.h / 2 + pad);
  const insetB = ux * ux * (b.w / 2 + pad) + uy * uy * (b.h / 2 + pad);
  const room = insetA + insetB;
  const keep = room > 0 ? Math.min(1, Math.max(0, (len - MIN_RUN) / room)) : 1;

  const from = {
    x: ac.x + ux * (a.w / 2 + pad) * keep + nx,
    y: ac.y + uy * (a.h / 2 + pad) * keep + ny,
  };
  const to = {
    x: bc.x - ux * (b.w / 2 + pad) * keep + nx,
    y: bc.y - uy * (b.h / 2 + pad) * keep + ny,
  };

  const out: Element[] = [
    {
      kind: 'arrow',
      id,
      from,
      to,
      ...(step.dashed ? { dashed: true } : {}),
      ...(step.tone ? { tone: step.tone } : {}),
    },
  ];

  if (step.label) {
    // Above the line, in the tutor's hand: a connector's label is something she
    // wrote over the arrow, not a caption belonging to either end.
    //
    // Its size is clamped to the run it has to sit over. Two things standing
    // close together leave a short arrow, and a label at full size then spills
    // across both of the pictures it was meant to be between.
    const run = Math.hypot(to.x - from.x, to.y - from.y);
    const size = fitText(step.label, run, 30, 17);
    out.push({
      kind: 'handwrite',
      id: labelIdFor(id),
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2 - size * 0.62,
      text: step.label,
      size,
      ...(step.tone ? { tone: step.tone } : {}),
    });
  }
  return out;
}

/**
 * A connector's label is named after its arrow.
 *
 * The solver uses this to leash one to the other: a label that drifts away
 * from its line stops meaning anything, so the rule cannot live in two places.
 */
export const labelIdFor = (arrowId: string): string => `${arrowId}_label`;

/**
 * Where a connector's label may be written: over the line, or anywhere around
 * the two things the line joins.
 *
 * The label belongs to the CONNECTION, and the connection is both ends plus
 * the run between them. Tied to the line alone, a long label over a short
 * arrow had nowhere to go — every position on that line crosses one of the
 * pictures — while a spot just above the pair, plainly theirs, was forbidden.
 *
 * Takes the ends' DRAWN boxes, labels and all. Measured around the icons
 * alone, the region stopped short of the very strip under a row of pictures
 * that a teacher writes in.
 */
export function connectionRegion(a: Rect, b: Rect): Rect {
  const MARGIN = 34;
  const x = Math.min(a.x, b.x) - MARGIN;
  const y = Math.min(a.y, b.y) - MARGIN;
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) + MARGIN - x,
    h: Math.max(a.y + a.h, b.y + b.h) + MARGIN - y,
  };
}

/** A mark sits over its target, a little larger, the way a real loop overshoots. */
export function annotateElement(
  step: AnnotateStep,
  boxes: ReadonlyMap<string, Placed>,
  id: string,
): Element[] {
  const box = boxes.get(step.target);
  if (!box) return [];
  const grow = step.mark === 'underline' ? 0 : 14;
  return [
    {
      kind: 'mark',
      id,
      x: box.x - grow,
      y: box.y - grow,
      w: box.w + grow * 2,
      h: box.h + grow * 2,
      shape: step.mark,
      ...(step.tone ? { tone: step.tone } : {}),
    },
  ];
}
