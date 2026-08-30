import { boxOf, overlaps, type Element, type Rect } from '@ai-tutor/lesson-format';

/**
 * NOTHING ON THE BOARD SITS ON ANYTHING ELSE.
 *
 * The stacking rules place blocks so they cannot collide, but the things a
 * teacher draws BETWEEN and OVER those blocks — a connector's label, a mark —
 * are positioned relative to what they refer to, and what they refer to moves.
 * So every fix aimed at one case ("this label is too big", "these two arrows
 * are too close") is a fix for one lesson. This is the fix for all of them.
 *
 * After layout, every free-floating label is nudged until it is clear of
 * everything. Deterministic, bounded, and pure: the same board always resolves
 * the same way, and it never runs forever.
 */

/** How much clear space a label wants around it before it stops moving. */
const BREATHING = 6;
/** The extra clearance a jump lands with, so it does not arrive exactly touching. */
const CLEAR = 2;

/**
 * When a label cannot fit anywhere, it is written smaller instead.
 *
 * This is the move a person makes and no amount of shuffling can replace: a
 * forty-character label between two pictures a hundred and fifty units apart
 * does not fit at any position, at any size above this. Shrinking is the only
 * honest answer, and it is bounded so a label never becomes unreadable — below
 * the floor it stays put and slightly crowded, which is still better than gone.
 */
const SHRINK = 0.82;
const MIN_SIZE = 13;
/** Give up after this; a board this crowded has a bigger problem than a label. */
const MAX_ROUNDS = 40;

/**
 * Only these move.
 *
 * Everything else was placed by a stacking rule that already guarantees it does
 * not collide, and moving it would undo that. A label has no such rule — it
 * follows whatever it labels — so it is the thing that gives way.
 */
const MOVABLE: ReadonlySet<Element['kind']> = new Set(['handwrite']);

/**
 * Pairs that are MEANT to overlap.
 *
 * A mark loops around the thing it marks; that is the whole point of it. Left
 * to itself the solver would push the circle off the object it was circling.
 */
export interface Bond {
  a: string;
  b: string;
}

const bondKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * A LEASH: how far a label may travel from the thing it names.
 *
 * Room to hop above a picture or along a line, not to cross the board. The
 * solver once carried "light trapped" a third of a board away from its arrow
 * to clear an overlap — technically tidy, and completely meaningless to a
 * student, because a label that far from its line is a label about nothing.
 *
 * The leash holds the label's CENTRE, not its whole box, which is what a
 * person does: written near the line, allowed to stick out.
 */
export interface Leash {
  /** The element that must stay near. */
  id: string;
  /** Where its centre may be. */
  region: Rect;
}

function centreInside(rect: Rect, region: Rect): boolean {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return cx >= region.x && cx <= region.x + region.w && cy >= region.y && cy <= region.y + region.h;
}

function inside(rect: Rect, board: Rect): boolean {
  return (
    rect.x >= board.x &&
    rect.y >= board.y &&
    rect.x + rect.w <= board.x + board.w &&
    rect.y + rect.h <= board.y + board.h
  );
}

/**
 * Somewhere on the board this label fits, as near as possible to where it wants
 * to be.
 *
 * Stepping away from one obstacle at a time is a local move, and local moves
 * cannot solve a label that is simply too long for the gap it was written in —
 * a forty-character label between two pictures a hundred and fifty units apart
 * has no position between them at any size. The board is eight hundred wide
 * though, so there is room; it is just not HERE.
 *
 * This is the teacher writing it above the drawing instead of squeezing it in,
 * and it searches outward from the original spot so the label ends up as close
 * to what it names as the board allows.
 */
function park(
  el: Element,
  all: readonly Element[],
  board: Rect,
  clashes: (a: Element, b: Element) => boolean,
  self: number,
  /** Where this label's centre may end up, when it is tied to something. */
  leash?: Rect,
): Element | null {
  const box = boxOf(el);
  if (box.w > board.w) return null;

  const anchored = el as Element & { x: number; y: number };

  // How far the search may reach: the leash when there is one, otherwise the
  // whole room. A leashed label has a small area to search and can afford a
  // fine grid; an unleashed one has the board and needs a coarse one.
  const reach = leash
    ? Math.max(leash.w, leash.h)
    : Math.max(board.w, board.h);
  const step = leash ? 6 : 16;

  // Candidate offsets, nearest first. Ordering by true distance is what makes
  // "as close to what it names as the board allows" actually true — the old
  // hand-written list of nine x-offsets left a leashed label only three
  // columns to try, and it failed on one board in ten for want of searching.
  const offsets: { dx: number; dy: number; d: number }[] = [];
  for (let dx = -reach; dx <= reach; dx += step) {
    for (let dy = -reach; dy <= reach; dy += step) {
      offsets.push({ dx, dy, d: Math.hypot(dx, dy) });
    }
  }
  offsets.sort((a, b) => a.d - b.d || a.dy - b.dy || a.dx - b.dx);

  for (const { dx, dy } of offsets) {
    const candidate = { ...anchored, x: anchored.x + dx, y: anchored.y + dy } as Element;
    const shape = padded(boxOf(candidate));
    if (!inside(shape, board)) continue;
    if (leash && !centreInside(boxOf(candidate), leash)) continue;
    if (all.every((other, k) => k === self || !clashes(candidate, other))) return candidate;
  }
  return null;
}

/** Grown by `BREATHING` on every side, which is the clearance a label wants. */
function padded(rect: Rect): Rect {
  return {
    x: rect.x - BREATHING,
    y: rect.y - BREATHING,
    w: rect.w + BREATHING * 2,
    h: rect.h + BREATHING * 2,
  };
}

/**
 * Push the movable elements until nothing overlaps.
 *
 * A label moves along whichever axis needs the smaller correction, which is how
 * a person would move it: a label sitting slightly low over a horizontal arrow
 * rises, and one crowding a neighbour to its right slides left rather than
 * jumping above the whole drawing.
 *
 * Vertical moves are preferred at equal cost, because a label belongs
 * horizontally where the thing it names is — moving it sideways breaks the
 * association it exists to make.
 */

/**
 * Push, shrink and re-place the movable elements until nothing overlaps.
 *
 * Three tools, in the order a person reaches for them:
 *
 * 1. **Move it a little.** Most collisions are a label sitting slightly low
 *    over its arrow; a single jump clear of the obstacle settles them.
 * 2. **Write it smaller.** Some labels are simply too long for the gap they
 *    were written in — no position between two close pictures works at any
 *    readable size.
 * 3. **Write it somewhere else.** When even the smallest text will not fit
 *    HERE, the board still has room elsewhere, and a label above the drawing
 *    beats a label across it.
 *
 * Only labels move. Everything else was placed by a stacking rule that already
 * guarantees it does not collide, and moving it would undo that.
 *
 * Deterministic, bounded and pure: the same board always resolves the same way,
 * and it always terminates.
 */
export function resolveOverlaps(
  elements: readonly Element[],
  bonds: readonly Bond[] = [],
  /**
   * Where a label may go, tightest room first.
   *
   * Nudging keeps to the FIRST room; parking tries each in order. A label
   * belongs in the room its scene lives in — but when that room is genuinely
   * full, the next room beats leaving it printed across a picture. The rooms
   * are the caller's to choose, which is how "never above the title" is said:
   * no room offered up there.
   */
  rooms?: Rect | readonly Rect[],
  /**
   * Labels tied to what they name. A leashed label would rather stay slightly
   * crowded than end up somewhere tidy and meaningless.
   */
  leashes: readonly Leash[] = [],
): Element[] {
  const boards = rooms === undefined ? [] : Array.isArray(rooms) ? rooms : [rooms as Rect];
  const board = boards[0];
  const leashOf = new Map(leashes.map((l) => [l.id, l.region]));
  const out = elements.map((el) => ({ ...el }) as Element);
  const exempt = new Set(bonds.map((b) => bondKey(b.a, b.b)));
  const movable = out.map((el, i) => (MOVABLE.has(el.kind) ? i : -1)).filter((i) => i >= 0);
  if (movable.length === 0) return out;

  const clashes = (a: Element, b: Element): boolean =>
    a.id !== b.id && !exempt.has(bondKey(a.id, b.id)) && overlaps(padded(boxOf(a)), boxOf(b));

  const firstClash = (i: number): Element | null => {
    for (let j = 0; j < out.length; j += 1) {
      if (j !== i && clashes(out[i], out[j])) return out[j];
    }
    return null;
  };

  const fits = (candidate: Element, i: number): boolean =>
    (!board || inside(padded(boxOf(candidate)), board)) &&
    out.every((other, j) => j === i || !clashes(candidate, other));

  // 1. Nudge. Cheapest and enough for almost everything.
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    let moved = false;

    for (const i of movable) {
      const obstacle = firstClash(i);
      if (!obstacle) continue;

      const mine = padded(boxOf(out[i]));
      const theirs = boxOf(obstacle);
      const up = theirs.y - (mine.y + mine.h);
      const down = theirs.y + theirs.h - mine.y;
      const left = theirs.x - (mine.x + mine.w);
      const right = theirs.x + theirs.w - mine.x;
      const away = (d: number) => d + Math.sign(d) * CLEAR;

      // Each escape clears the obstacle outright rather than creeping toward
      // freedom: a label creeping in small steps can bounce between two
      // neighbours forever, arriving nowhere in either direction. Vertical is
      // tried first at equal cost, because a label belongs horizontally where
      // the thing it names is.
      const vertFirst = Math.abs(up) <= Math.abs(left) && Math.abs(up) <= Math.abs(right);
      const escapes: [number, number][] = vertFirst
        ? [[0, away(up)], [0, away(down)], [away(left), 0], [away(right), 0]]
        : [[away(left), 0], [away(right), 0], [0, away(up)], [0, away(down)]];

      const leash = leashOf.get(out[i].id);

      for (const [dx, dy] of escapes) {
        const anchored = out[i] as Element & { x: number; y: number };
        const candidate = { ...anchored, x: anchored.x + dx, y: anchored.y + dy } as Element;
        if (board && !inside(padded(boxOf(candidate)), board)) continue;
        if (leash && !centreInside(boxOf(candidate), leash)) continue;
        // Only accept a move that improves things; a jump into a third element
        // is how a solver ends up chasing its own tail.
        if (clashes(candidate, obstacle)) continue;
        out[i] = candidate;
        moved = true;
        break;
      }
    }

    if (!moved) break;
  }

  // 2 and 3. Whatever is still stuck gets written smaller, then written
  // somewhere else. Once each, at the end: parking is a search over the whole
  // board, and doing it every round costs far more than it can ever save.
  for (const i of movable) {
    if (!firstClash(i)) continue;

    let size = 'size' in out[i] && typeof out[i].size === 'number' ? out[i].size : 26;
    while (size * SHRINK >= MIN_SIZE) {
      size *= SHRINK;
      const smaller = { ...out[i], size } as Element;
      if (fits(smaller, i)) {
        out[i] = smaller;
        break;
      }
      out[i] = smaller;
    }

    if (!firstClash(i)) continue;

    // Rooms in order: a label belongs in the room its scene lives in, and only
    // a genuinely full room justifies the next one.
    const leash = leashOf.get(out[i].id);
    for (const room of boards) {
      const parked = park(out[i], out, room, clashes, i, leash);
      if (parked) {
        out[i] = parked;
        break;
      }
    }
  }

  return out;
}
