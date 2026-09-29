import { useMemo, useSyncExternalStore } from 'react';
import { findBeat, validateLesson, type Lesson } from '@ai-tutor/lesson-format';
import { computeVisible } from '@ai-tutor/stage';
import { findOverlaps } from '@ai-tutor/board-layout';
import {
  augmentLesson,
  emptyLiveState,
  layoutLiveTurn,
  nextTurn,
  parseBoardOps,
  type Dropped,
  type LiveState,
  type LiveStep,
  type LiveTarget,
  type Reveal,
} from '@ai-tutor/live-board';

/**
 * THE BOARD SESSION — the live ink of one class, kept beside the lesson and
 * never inside it (T2.3 of the tutor build plan).
 *
 * The prepared class is a catalogue lesson played by the player. The live
 * tutor writes on the board as well: the working of a doubt on a page of its
 * own, a student's answer and a hint in a held question's work area
 * (@ai-tutor/live-board places it). This holds that ink for the length of the
 * session and decides what Scene is handed. Three rules, each the fix for a
 * way the class could break:
 *
 *   1. THE PLAYER NEVER SEES IT. `usePlayer` rebuilds its controller when the
 *      lesson's identity changes (packages/player/src/usePlayer.ts), which
 *      restarts the class from the top. So the lesson with live ink laid over
 *      it (`sceneLesson`) is for Scene only; `lesson` is the catalogue lesson,
 *      the same object for the whole session, and the room hands that one to
 *      the player.
 *
 *   2. NOTHING ALREADY ON THE BOARD DRAWS IN AGAIN. Scene animates any id that
 *      was not in the previous visible set (packages/stage/src/Scene.tsx,
 *      `isNew`). A recall used to REPLACE the visible set with the recalled
 *      beat's, so the ink the class had written since then vanished — and
 *      drew itself in again when the doubt ended. Here `visible` is always the
 *      class beat's own show set, plus what a doubt recalled, plus every live
 *      id revealed so far. Nothing the beat shows ever leaves it, so ending a
 *      doubt re-animates nothing prepared.
 *
 *   3. THE CAMERA MOVES, THE BOARD STAYS. What is looked at is Scene's `frame`
 *      prop, not what exists: during a doubt it is the live doubt page once
 *      the doubt has written on it (or the recalled beat, whichever came
 *      last); at a held question with ink in its work area, that page; and
 *      otherwise the beat's own frame — or its show set, so a beat with no
 *      frame is never framed on live ink it did not ask for.
 *
 * TD13: live pages stay for the session, recallable, and are NEVER saved into
 * the shared lesson — one child's doubt must not appear in every later
 * child's class. Nothing here writes to the catalogue lesson or to any store;
 * when the room unmounts, the ink is gone.
 *
 * Ink is COMMITTED (laid out, so the next turn is placed around it) before it
 * is REVEALED (drawn), because a step's ink appears as her voice starts its
 * sentence (lib/voiceStart.ts). Committed ink that is never revealed — a doubt
 * ended in the middle of a turn — takes up its room and is never drawn.
 *
 * A HALT FREEZES IT (`freeze`, called by lib/sessionHalt.ts): nothing is
 * committed, revealed or recalled after that, and nobody is told of a change.
 *
 * NOT RENDERED: a `point` gesture. live-board carries it (`Reveal.point`) and
 * Scene has no transient gesture to show it with; this session ignores it.
 */

/** Who put a piece of ink on the board — the brief quotes a student's words as theirs. */
export type Author = 'lesson' | 'tutor' | 'student';

/** One laid-out turn, gated, ready to commit. */
export interface LaidTurn {
  /** Every element the turn placed, in drawing order. */
  placed: string[];
  /** What the camera frames once the turn is drawn (live-board `pageIds`). */
  pageIds: string[];
  /** One entry per spoken line, with the ink that appears while it is said. */
  revealBySay: Reveal[];
  /** The live state after the turn. */
  state: LiveState;
  /** Ops the layout refused. */
  dropped: Dropped[];
}

export type LayResult =
  | { ok: true; turn: LaidTurn }
  | { ok: false; reason: string; dropped: Dropped[] };

/** What Scene is handed for one moment of the class. */
export interface BoardCanvas {
  visible: string[];
  focus: string[];
  frame?: string[];
}

/** The catalogue lesson's own validation errors, so only NEW ones fail a turn. */
const catalogueErrors = new WeakMap<Lesson, ReadonlySet<string>>();
function errorsOf(lesson: Lesson): ReadonlySet<string> {
  let known = catalogueErrors.get(lesson);
  if (!known) {
    const result = validateLesson(lesson);
    known = new Set(result.ok ? [] : result.errors);
    catalogueErrors.set(lesson, known);
  }
  return known;
}

/**
 * Lay a turn out and hold it to the canvas protocol's last invariant: the
 * lesson with this ink laid over it passes `validateLesson`, and none of this
 * turn's ink overlaps anything it is not bonded to (board-layout's overlap
 * gate, the one class-prep runs before a keep). Never throws.
 *
 * A turn that fails is refused WHOLE — not trimmed to the ops that would pass.
 * `layoutLiveTurn` already drops what it cannot place; a board that still
 * fails after that is a layout that went wrong, and none of its placements can
 * be trusted. The caller then drops all of the turn's ink (T2.4).
 *
 * Overlaps the prepared lesson already has among its own elements (the proof
 * lesson's b3_7 and b3_12, for one) are not this turn's, and are not held
 * against it.
 */
export function layTurn(
  lesson: Lesson,
  state: LiveState,
  steps: readonly LiveStep[],
  target: LiveTarget,
): LayResult {
  let out: ReturnType<typeof layoutLiveTurn>;
  try {
    out = layoutLiveTurn(lesson, state, steps, target);
  } catch (e) {
    return { ok: false, reason: `the layout failed: ${e instanceof Error ? e.message : String(e)}`, dropped: [] };
  }
  const placed = out.elements.map((el) => el.id);
  if (placed.length > 0) {
    const result = validateLesson(out.lesson);
    const known = errorsOf(lesson);
    const fresh = result.ok ? [] : result.errors.filter((e) => !known.has(e));
    if (fresh.length > 0) {
      return { ok: false, reason: `the board would not validate: ${fresh[0]}`, dropped: out.dropped };
    }
    const mine = new Set(placed);
    const overlaps = findOverlaps(out.lesson.elements, { bonds: out.state.bonds }).filter(
      (o) => mine.has(o.a) || mine.has(o.b),
    );
    if (overlaps.length > 0) {
      return {
        ok: false,
        reason: `live ink would overlap: ${overlaps.map((o) => `${o.a} over ${o.b}`).join(', ')}`,
        dropped: out.dropped,
      };
    }
  }
  return {
    ok: true,
    turn: { placed, pageIds: out.pageIds, revealBySay: out.revealBySay, state: out.state, dropped: out.dropped },
  };
}

interface DoubtState {
  /** Whether this doubt has written on a page yet; its next turn continues that page. */
  hasPage: boolean;
  /** The prepared element the doubt page opened with a copy of. */
  subject?: string;
  /** Ids a recall in this doubt brought onto the board. Kept until the doubt ends. */
  recalled: string[];
  /** What the camera is on, newest wins: the doubt's page, or a recalled beat. */
  view: { kind: 'live'; ids: string[] } | { kind: 'recall'; beatId: string } | null;
}

export class BoardSession {
  /** The catalogue lesson. The player's, and never changed. */
  readonly lesson: Lesson;

  private live: LiveState = emptyLiveState();
  /** Live ids revealed so far, in the order they were drawn. */
  private shown: string[] = [];
  private shownSet = new Set<string>();
  private authors = new Map<string, Author>();
  private doubtState: DoubtState | null = null;
  /** The held question whose work area was last written in, and its page. */
  private held: { beatId: string; ids: string[] } | null = null;
  private isFrozen = false;
  private ver = 0;
  private scene: { state: LiveState; lesson: Lesson } | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(lesson: Lesson) {
    this.lesson = lesson;
  }

  /** Bumped on every change; what a React binding snapshots. */
  get version(): number {
    return this.ver;
  }

  get state(): LiveState {
    return this.live;
  }

  get frozen(): boolean {
    return this.isFrozen;
  }

  /**
   * The lesson for Scene, and ONLY for Scene: the catalogue lesson with this
   * session's live ink laid over it and the canvas widened to its last page.
   * The same object until the ink changes. With no live ink it is the
   * catalogue lesson itself.
   */
  get sceneLesson(): Lesson {
    if (this.live.elements.length === 0 && this.live.pages.length === 0) return this.lesson;
    if (this.scene === null || this.scene.state !== this.live) {
      this.scene = { state: this.live, lesson: augmentLesson(this.lesson, this.live) };
    }
    return this.scene.lesson;
  }

  /** Who wrote this element. Anything not written live is the lesson's. */
  authorOf(id: string): Author {
    return this.authors.get(id) ?? 'lesson';
  }

  /** Be told of every change. Stable, so it can be handed to `useSyncExternalStore`. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The doubt in progress: whether it has a page yet, and what the page is about. Null outside a doubt. */
  get doubt(): { hasPage: boolean; subject?: string } | null {
    const d = this.doubtState;
    if (d === null) return null;
    return d.subject === undefined ? { hasPage: d.hasPage } : { hasPage: d.hasPage, subject: d.subject };
  }

  /** A hand went up. */
  beginDoubt(): void {
    if (this.isFrozen) return;
    this.doubtState = { hasPage: false, recalled: [], view: null };
    this.changed();
  }

  /**
   * The doubt is over and the class resumes. The camera goes back to the
   * beat; the doubt's ink stays on the board, off to the side (TD13).
   */
  endDoubt(): void {
    if (this.isFrozen || this.doubtState === null) return;
    this.doubtState = null;
    this.changed();
  }

  /**
   * Bring an earlier moment back into view during a doubt. Its show set is
   * ADDED to the board rather than put in place of it, and it stays until the
   * doubt ends; the camera goes to its frame.
   */
  recall(beatId: string): void {
    const d = this.doubtState;
    if (this.isFrozen || d === null) return;
    const beat = findBeat(this.lesson, beatId);
    if (!beat) return;
    for (const id of beat.show) if (!d.recalled.includes(id)) d.recalled.push(id);
    d.view = { kind: 'recall', beatId };
    this.changed();
  }

  /**
   * Take a laid-out turn onto the board — placed, not yet drawn.
   *
   * `page` says the turn wrote on THIS doubt's page, and what that page is
   * about; the doubt's next turn then continues it. False when the board is
   * frozen, and nothing is taken.
   */
  commit(turn: LaidTurn, author: Author, page?: { subject?: string }): boolean {
    if (this.isFrozen) return false;
    this.live = turn.state;
    for (const id of turn.placed) this.authors.set(id, author);
    const d = this.doubtState;
    if (page && d && turn.placed.length > 0) {
      if (!d.hasPage && page.subject !== undefined) d.subject = page.subject;
      d.hasPage = true;
    }
    this.changed();
    return true;
  }

  /**
   * Draw committed ink now — as her voice starts the sentence it belongs to.
   * `look` is what the camera should frame once something is drawn: the
   * doubt's page during a doubt, or, with `heldBeatId`, the page of that held
   * question's work area. A line with no ink moves nothing.
   */
  reveal(ids: readonly string[], look: readonly string[], heldBeatId?: string): void {
    if (this.isFrozen) return;
    const placed = new Set(this.live.elements.map((el) => el.id));
    let drawn = 0;
    for (const id of ids) {
      if (!placed.has(id) || this.shownSet.has(id)) continue;
      this.shown.push(id);
      this.shownSet.add(id);
      drawn += 1;
    }
    if (drawn === 0) return;
    if (look.length > 0) {
      if (heldBeatId !== undefined) this.held = { beatId: heldBeatId, ids: [...look] };
      else if (this.doubtState) this.doubtState.view = { kind: 'live', ids: [...look] };
    }
    this.changed();
  }

  /**
   * Write into a held question's work area and draw it at once (T2.5). Each
   * block is its own turn, with its own author — a student's answer is
   * theirs, the mark and the hint are the lesson's. Parsed like any model
   * turn (`parseBoardOps`), so the same caps and the same "no coordinate"
   * rule apply to ink the app writes itself. Returns the ids drawn; empty when
   * frozen, or when nothing could be placed.
   *
   * The caller files the help (`ledger.helped`) BEFORE calling this: the ink
   * is on the board the moment this returns.
   *
   * A beat with no prepared work area (every class prepared before T1.5)
   * gets nothing written. The layout would put the ink on a fresh page and
   * the camera would follow it there, off the question the student is still
   * answering (overnight review #13). What she says carries the help instead.
   */
  writeHeld(beatId: string, blocks: readonly { author: Author; steps: unknown }[]): string[] {
    if (this.isFrozen) return [];
    const at = this.lesson.beats.findIndex((b) => b.id === beatId);
    if (at < 0 || !this.lesson.beats[at].workArea) return [];
    const written: string[] = [];
    for (const block of blocks) {
      const onScreen = new Set(this.canvas(at).visible);
      const parsed = parseBoardOps(block.steps, onScreen, { turn: nextTurn(this.live) });
      if (parsed.steps.length === 0) continue;
      const laid = layTurn(this.lesson, this.live, parsed.steps, { kind: 'workArea', beatId });
      if (!laid.ok || laid.turn.placed.length === 0) continue;
      if (!this.commit(laid.turn, block.author)) break;
      this.reveal(laid.turn.placed, laid.turn.pageIds, beatId);
      written.push(...laid.turn.placed);
    }
    return written;
  }

  /** The class has halted. Nothing is written, drawn or recalled again. */
  freeze(): void {
    this.isFrozen = true;
  }

  /** What Scene is handed while the class is on `beatIndex`. */
  canvas(beatIndex: number): BoardCanvas {
    const base = computeVisible(this.lesson, beatIndex);
    const beat = this.lesson.beats[beatIndex];
    // The beat's own frame, or its own show set — never the live ink the
    // visible set now carries.
    let frame: string[] | undefined = base.frame ?? (base.visible.length > 0 ? [...base.visible] : undefined);
    let focus = base.focus;
    if (this.held && beat && this.held.beatId === beat.id) {
      frame = [...this.held.ids];
      focus = [];
    }
    const visible = [...base.visible];
    const d = this.doubtState;
    if (d) {
      visible.push(...d.recalled);
      if (d.view?.kind === 'live') {
        frame = [...d.view.ids];
        focus = [];
      } else if (d.view?.kind === 'recall') {
        const recalled = findBeat(this.lesson, d.view.beatId);
        if (recalled) {
          frame = recalled.frame && recalled.frame.length > 0 ? [...recalled.frame] : [...recalled.show];
          focus = [...(recalled.focus ?? [])];
        }
      }
    }
    visible.push(...this.shown);
    const unique = [...new Set(visible)];
    return frame && frame.length > 0 ? { visible: unique, focus, frame } : { visible: unique, focus };
  }

  private changed(): void {
    this.ver += 1;
    for (const listener of [...this.listeners]) listener();
  }
}

/**
 * One board session per lesson, and a re-render whenever it changes. Keyed on
 * the lesson, exactly as the player is, so the two live and die together.
 */
export function useBoardSession(lesson: Lesson): BoardSession {
  const session = useMemo(() => new BoardSession(lesson), [lesson]);
  useSyncExternalStore(
    session.subscribe,
    () => session.version,
    () => session.version,
  );
  return session;
}
