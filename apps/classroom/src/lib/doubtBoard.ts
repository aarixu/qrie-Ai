import type { Beat, Element, Lesson } from '@ai-tutor/lesson-format';
import {
  boardStrings,
  nextTurn,
  parseBoardOps,
  type BoardOp,
  type Dropped,
  type LiveState,
  type LiveStep,
  type LiveTarget,
} from '@ai-tutor/live-board';
import { LINES, leaks, type TutorLanguage } from '@ai-tutor/tutor-control';
import { checkLesson, checkLines, formatRational, type CheckResult } from '@ai-tutor/maths-check';
import { recallTargets, type DoubtContext } from '@ai-tutor/doubt-session';
import { quoteForPrompt } from '@ai-tutor/safety';
import { toStudent } from './safety';
import { layTurn, type Author, type BoardSession, type LaidTurn, type LayResult } from './boardSession';
import { MALFORMED_REPLY_LINE } from './geminiAgent';
import type { HaltCause } from './sessionHalt';

/**
 * THE TYPED DOUBT TUTOR'S BOARD — everything between a model's reply and ink
 * in front of a child (T2.4 of the tutor build plan).
 *
 * She answers a typed doubt in STEPS: a sentence, and the ink that appears
 * while she says it (@ai-tutor/live-board's wire format). Every step passes
 * through here in this order, and nothing reaches the board or her voice
 * that did not:
 *
 *   1. PARSE. `parseBoardOps` against what is on the board NOW: unknown ops,
 *      ids that are not on screen, and over-cap strings are dropped; no
 *      coordinate a model writes gets through; every id is minted `live<n>_`.
 *
 *   2. THE SAFETY SCREEN, on every string — every sentence and every piece of
 *      ink (`boardStrings`), through `toStudent`. One that screens as distress
 *      stops the whole turn before anything is said or drawn, and the caller
 *      halts the class with the support line (`createDoubtBoard` does, through
 *      the one `haltSession`).
 *
 *   3. THE LEAK CHECK, when the hand went up while the class was holding a
 *      question: a step whose sentence or ink contains that question's answer
 *      (@ai-tutor/tutor-control `leaks`: numbers as digits and as words) is
 *      dropped with its sentence. The model is shown the question and told
 *      not to answer it; this is what makes that a guarantee rather than a
 *      request. See `answerSecrets` for what counts as the answer.
 *
 *   4. THE MATHS CHECK, on every ink string with an "=" (`mathsFailures`).
 *      A step with a failing line is dropped with its sentence.
 *
 *   5. LAYOUT, in append mode (`layoutLiveTurn` through `layTurn`): a fresh
 *      doubt page that opens with a copy of the element the doubt is about,
 *      or the page this doubt already started. Then the gate: the lesson with
 *      the ink laid over it validates, and the new ink overlaps nothing. A
 *      turn that fails the gate loses ALL its ink — and its words are still
 *      said, except a sentence that points at ink that was not written.
 *
 * WHICH ELEMENT A DOUBT IS ABOUT. The reply names no page; the first prepared
 * element the turn marks, joins with an arrow, or points at is the one the
 * page opens with a copy of, so the mark and the working share one frame (the
 * plan's demo: "a fresh page that opens with that line, marks it, and writes
 * the expansion under it"). A turn that refers to nothing prepared opens a
 * plain page.
 *
 * WHAT IS NOT DONE HERE, said so nobody reads more into it: `decide()` from
 * tutor-control is not consulted for a doubt at a held ask — the plan's T2.4
 * row asks for that, and this applies only its leak check with the ask's
 * answer as `mustNotReveal`. A `point` gesture is carried and not drawn
 * (lib/boardSession.ts).
 */

/** One element on the board, as she is told about it. */
export interface OnScreenElement {
  kind: Element['kind'];
  text: string;
  author: Author;
}

/** A reply's step before anything is checked: her sentence and the ink she asked for. */
export interface RawStep {
  say: string;
  ink: readonly unknown[];
}

/** One sentence to say, and the ink to draw when her voice starts it. */
export interface TurnLine {
  say: string;
  ink: string[];
  /** A moment of the class to bring back as this line starts. */
  recall?: string;
}

export interface TurnInput {
  /** The reply's steps, raw. */
  steps: unknown;
  /** The catalogue lesson. */
  lesson: Lesson;
  /** The live ink so far this session. */
  state: LiveState;
  /** Every id on the board now; a step may only refer to these. */
  onScreen: readonly string[];
  /** The beats a recall may name: the ones the student has already seen. */
  beatIds: ReadonlySet<string>;
  /** Whether this doubt already has a page (then this turn continues it), and what it is about. */
  page: { continue: boolean; subject?: string };
  /** What must not be said or written: the held question's answer, or nothing. */
  mustNotReveal: readonly string[];
  /** The child's tutor language, for the one fixed line this may say. */
  lang: TutorLanguage;
  lessonId?: string;
  /** The layout and its gate. Injected by tests to force a failure; `layTurn` otherwise. */
  lay?: typeof layTurn;
}

export type PreparedTurn =
  /** A string screened as distress. Nothing is said or drawn; halt the class with `say`. */
  | { kind: 'halt'; say: string }
  | {
      kind: 'turn';
      /** Never empty: when every step was dropped, one fixed line stands in. */
      lines: TurnLine[];
      /** The laid-out turn to commit, or null when there is no ink (or none survived the gate). */
      laid: LaidTurn | null;
      /** The prepared element a fresh page opened with a copy of. */
      subject?: string;
      dropped: Dropped[];
      /** Some of the ink a step asked for is not on the board. Logged by the caller. */
      inkDropped: boolean;
      /** Why, as counts, for the log. */
      counts: { leaked: number; maths: number; layoutFailed: boolean; opsDropped: number };
    };

/** Longest text of one element she is told about. */
const TEXT_CAP = 160;

/**
 * A SENTENCE THAT POINTS AT INK. Not said when the ink it points at was not
 * written. A word list, in English and in romanised Hindi, and nothing
 * cleverer: it will miss a sentence that points some other way ("the second
 * line"), and it will drop an ordinary sentence that happens to say "see" —
 * but only in a turn that already lost ink. How often either happens is
 * UNVERIFIED; the plan's 20-doubt run is where it would show.
 */
export const POINTS_AT_INK =
  /\b(?:look(?:ing)?|see|seen|here|below|above|circle[sd]?|circling|underline[sd]?|underlining|box(?:ed)?|mark(?:ed|s)?|written|wrote|write|writing|board|arrows?|tick(?:ed)?|cross(?:ed)?|dekho|dekhiye|dekhna|yahan|yahaan|idhar|neeche|niche|upar|likha|likhi|likhe|likhte|this (?:line|step|part|bit|one))\b/i;

/** The words an element puts on the board, for her brief. */
function textOf(el: Element): string {
  switch (el.kind) {
    case 'title':
      return el.sub ? `${el.text} — ${el.sub}` : el.text;
    case 'text':
    case 'note':
    case 'formula':
    case 'handwrite':
      return el.text;
    case 'box':
      return el.label;
    case 'list': {
      const items = el.items.map((it) => (it.meaning ? `${it.term}: ${it.meaning}` : it.term)).join('; ');
      return el.heading ? `${el.heading} — ${items}` : items;
    }
    case 'flow':
      return el.steps.map((s) => s.label).join(' → ');
    case 'image':
    case 'diagram':
      return el.label ?? el.alt;
    case 'chart':
      return el.caption ?? '';
    case 'doc':
    case 'graphic':
    case 'model3d':
      return el.label ?? '';
    default:
      return '';
  }
}

/**
 * WHAT IS ON THE BOARD, for her brief: `id → {kind, text, author}` for every
 * element in `ids` that the lesson (with its live ink) holds. Marks, arrows
 * and pen strokes are left out — they carry no words to refer to.
 *
 * A STUDENT'S WORDS ARE QUOTED (`quoteForPrompt`): a child's answer written on
 * the board is text a model reads, and "ignore your instructions" written as
 * an answer must reach it as a quotation, not as a line of the prompt. The
 * lesson's and her own words are not student input and are left as they are.
 * Each text is capped at TEXT_CAP characters.
 */
export function describeOnScreen(
  lesson: Lesson,
  ids: readonly string[],
  authorOf: (id: string) => Author,
): Record<string, OnScreenElement> {
  const byId = new Map(lesson.elements.map((el) => [el.id, el]));
  const out: Record<string, OnScreenElement> = {};
  for (const id of ids) {
    const el = byId.get(id);
    if (!el || el.kind === 'mark' || el.kind === 'arrow' || el.kind === 'pen') continue;
    const author = authorOf(id);
    let text = textOf(el).replace(/\s+/g, ' ').trim();
    if (author === 'student') text = quoteForPrompt(text);
    if (text.length > TEXT_CAP) text = `${text.slice(0, TEXT_CAP - 1)}…`;
    out[id] = { kind: el.kind, text, author };
  }
  return out;
}

/**
 * THE ANSWER A HELD QUESTION MUST NOT BE GIVEN AWAY BY: its `expect`, and the
 * text of every correct option, shown or in the why-probe. The same set
 * tutor-control's `decide()` protects before its reveal (decide.ts,
 * `secretsOf`, which it does not export).
 */
export function answerSecrets(ask: Beat['ask'] | null | undefined): string[] {
  if (!ask) return [];
  const out = new Set<string>();
  const add = (s: string | undefined) => {
    const t = s?.trim();
    if (t) out.add(t);
  };
  add(ask.expect);
  for (const o of [...(ask.options ?? []), ...(ask.whyProbe?.options ?? [])]) if (o.correct === true) add(o.text);
  return [...out];
}

/** Every string an op WRITES (not what she says), for the maths check. */
function writtenStrings(op: BoardOp): string[] {
  switch (op.op) {
    case 'write':
    case 'equation':
      return [op.text];
    case 'note':
      return op.text.split('\n');
    case 'list':
      return [op.heading ?? '', ...op.items.flatMap((it) => [it.term, it.meaning ?? ''])];
    case 'card':
      return [op.title, op.body];
    case 'work':
      return op.steps.map((s) => s.line);
    case 'arrow':
      return op.label ? [op.label] : [];
    default:
      // A mark's span quotes text already on the board; point, recall and
      // newPage write nothing.
      return [];
  }
}

const lessonChecks = new WeakMap<Lesson, CheckResult>();

/**
 * The answer the board already holds for the problem `subject` belongs to,
 * written as a claim line the checker reads ("Answer: x = 49/29, y = 19/29"),
 * or null: no subject, the subject is in no problem, or that problem's own
 * working does not hold (an answer the lesson got wrong is not one to hold
 * anything to).
 */
function boardAnswer(lesson: Lesson, subject: string | undefined): string | null {
  if (subject === undefined) return null;
  let result = lessonChecks.get(lesson);
  if (!result) {
    result = checkLesson(lesson);
    lessonChecks.set(lesson, result);
  }
  const problem = result.problems.find((p) => p.ids.includes(subject));
  if (!problem) return null;
  if (result.failures.some((f) => problem.ids.includes(f.id))) return null;
  const entries = Object.entries(problem.solutions);
  if (entries.length === 0) return null;
  return `Answer: ${entries.map(([v, r]) => `${v} = ${formatRational(r)}`).join(', ')}`;
}

/**
 * THE MATHS CHECK ON LIVE INK (@ai-tutor/maths-check, the T1.4 checker), as
 * the step indexes that fail and why.
 *
 * Every string a step writes that contains "=" is a line. Two readings, and a
 * step with a line that fails either is dropped:
 *
 *   1. THE TURN ON ITS OWN. A wrong sum fails ("7 × 3 = 24"); a line that
 *      disagrees with the answer the turn itself claims fails. When a line
 *      fails inside a problem that claims an answer, EVERY line of that
 *      problem fails with it, its claim included: a derivation with a wrong
 *      step in it is a wrong derivation, and keeping its last line would
 *      write a wrong answer in her hand ("y = 19/28" survives the checker on
 *      its own, because a claim with no working has nothing to disagree with).
 *
 *   2. HELD TO THE BOARD'S ANSWER. A line the turn cannot settle on its own —
 *      it has variables and the turn claims no value for them — is held to
 *      the answer of the problem the doubt page is about (`boardAnswer`):
 *      "7(3 - 2y) = 21 - 2y" on a page about b3_2 fails at y = 19/29.
 *
 * WHAT IS NOT CAUGHT. A line the checker cannot read is skipped, never failed
 * — prose with an "=" in it ("LHS = RHS") is written as it is. A derivation
 * that claims its own answer is held only to itself, so a worked example with
 * different numbers is kept (reading 2 would fail it) — and so is a
 * derivation that restates the board's problem wrongly and then follows that
 * through consistently to a wrong answer. How often a model does that is
 * UNVERIFIED; the plan's 20-doubt run is where it would show.
 */
function mathsFailures(steps: readonly LiveStep[], lesson: Lesson, subject: string | undefined): Map<number, string> {
  const lines: { id: string; text: string; step: number }[] = [];
  steps.forEach((step, i) => {
    step.ink.forEach((op, j) => {
      writtenStrings(op).forEach((text, k) => {
        if (text.includes('=')) lines.push({ id: `s${i}o${j}k${k}`, text, step: i });
      });
    });
  });
  const failing = new Map<number, string>();
  if (lines.length === 0) return failing;
  const stepOf = new Map(lines.map((l) => [l.id, l.step]));
  const fail = (id: string, reason: string) => {
    const step = stepOf.get(id);
    if (step !== undefined && !failing.has(step)) failing.set(step, reason);
  };

  const own = checkLines(lines.map(({ id, text }) => ({ id, text })));
  const failed = new Set<string>();
  // A claim line ("y = 19/28") states one of the problem's own answers; it may
  // not be among the ids the problem held to that answer, so it is found by
  // shape: a lone variable the problem solved for, equal to a constant.
  const claimsOf = (vars: readonly string[]): string[] =>
    lines
      .filter(({ text }) => {
        const m = /^\s*(?:[A-Za-z ]*:\s*)?([a-z])\s*=\s*[-+\d\s/().]+\s*$/i.exec(text);
        return m !== null && vars.includes(m[1]);
      })
      .map(({ id }) => id);
  for (const f of own.failures) {
    const problem = own.problems.find((p) => p.ids.includes(f.id));
    const ids = problem
      ? [...new Set([f.id, ...problem.ids, ...claimsOf([...Object.keys(problem.solutions), ...Object.keys(problem.roots)])])]
      : [f.id];
    for (const id of ids) {
      failed.add(id);
      fail(id, f.reason);
    }
  }

  const answer = boardAnswer(lesson, subject);
  if (answer !== null) {
    for (const s of own.skipped) {
      if (failed.has(s.id)) continue;
      const held = checkLines([
        { id: s.id, text: s.text },
        { id: '__board_answer', text: answer },
      ]);
      const f = held.failures.find((x) => x.id === s.id);
      if (f) fail(s.id, f.reason);
    }
  }
  return failing;
}

/** The first prepared element the turn refers to: what a fresh doubt page opens with a copy of. */
function firstReferenced(steps: readonly LiveStep[], prepared: ReadonlySet<string>): string | undefined {
  for (const step of steps) {
    for (const op of step.ink) {
      const refs = op.op === 'mark' ? [op.targetId] : op.op === 'arrow' ? [op.fromId, op.toId] : op.op === 'point' ? op.ids : [];
      const hit = refs.find((id) => prepared.has(id));
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

/**
 * How many pieces of ink each spoken line asked for — walked exactly the way
 * `layoutLiveTurn` walks a turn into `revealBySay` (one entry per step, and
 * one per line of a `work`, with ink after a `work` going to its last line),
 * so the two lists line up entry for entry.
 */
function wantedPerLine(steps: readonly LiveStep[]): { say: string; wanted: number }[] {
  const out: { say: string; wanted: number }[] = [];
  for (const step of steps) {
    let current = { say: step.say, wanted: 0 };
    out.push(current);
    for (const op of step.ink) {
      if (op.op === 'work') {
        for (const line of op.steps) {
          current = { say: line.say, wanted: 1 };
          out.push(current);
        }
      } else if (op.op !== 'point' && op.op !== 'recall' && op.op !== 'newPage') {
        current.wanted += 1;
      }
    }
  }
  return out;
}

const isCopy = (id: string): boolean => /^live\d+_copy/.test(id);

/**
 * One reply's steps, checked and laid out: the lines to say, the ink to
 * commit, or a halt. Pure apart from `toStudent`, which records a flag when it
 * finds distress. Never throws — a turn that goes wrong in here is a turn
 * with no ink, not a class that stops.
 */
export function prepareDoubtTurn(input: TurnInput): PreparedTurn {
  const dropped: Dropped[] = [];
  const parsed = parseBoardOps(input.steps, new Set(input.onScreen), {
    turn: nextTurn(input.state),
    beatIds: input.beatIds,
  });
  dropped.push(...parsed.dropped);

  // 2. The screen: every sentence and every piece of ink.
  for (const s of boardStrings(parsed.steps)) {
    const screened = toStudent(s, input.lessonId);
    if (screened.say !== null) return { kind: 'halt', say: screened.say };
  }

  let steps = parsed.steps;
  let leaked = 0;
  let maths = 0;
  let inkLostInChecks = false;

  // 3. The leak check, at a held ask.
  if (input.mustNotReveal.length > 0) {
    steps = steps.filter((step, i) => {
      if (!boardStrings([step]).some((s) => leaks(s, input.mustNotReveal))) return true;
      dropped.push({ at: `step ${i}`, reason: 'gives away the answer to the question the class is holding' });
      leaked += 1;
      if (step.ink.length > 0) inkLostInChecks = true;
      return false;
    });
  }

  // 4. The maths check.
  const prepared = new Set(input.lesson.elements.map((el) => el.id));
  const subject = input.page.continue ? input.page.subject : firstReferenced(steps, prepared);
  // A fault in the checker itself drops every step's ink rather than throwing:
  // this function never throws, and unchecked maths never reaches the board.
  let wrong: Map<number, string>;
  try {
    wrong = mathsFailures(steps, input.lesson, subject);
  } catch {
    wrong = new Map(steps.flatMap((s, i) => (s.ink.length > 0 ? [[i, 'the maths check could not read this']] : [])) as [number, string][]);
  }
  if (wrong.size > 0) {
    steps = steps.filter((step, i) => {
      const reason = wrong.get(i);
      if (reason === undefined) return true;
      dropped.push({ at: `step ${i}`, reason: `maths: ${reason}` });
      maths += 1;
      if (step.ink.length > 0) inkLostInChecks = true;
      return false;
    });
  }

  // 5. Layout and its gate — only for a turn with ink in it.
  const hasInk = steps.some((s) => s.ink.length > 0);
  let laid: LaidTurn | null = null;
  let layoutFailed = false;
  if (hasInk) {
    const target: LiveTarget = input.page.continue
      ? { kind: 'doubtPage', continue: true }
      : { kind: 'doubtPage', ...(subject !== undefined ? { copyOf: subject } : {}) };
    let result: LayResult;
    try {
      result = (input.lay ?? layTurn)(input.lesson, input.state, steps, target);
    } catch (e) {
      result = { ok: false, reason: `the layout failed: ${e instanceof Error ? e.message : String(e)}`, dropped: [] };
    }
    if (result.ok) {
      laid = result.turn;
      dropped.push(...result.turn.dropped);
    } else {
      layoutFailed = true;
      dropped.push({ at: '$', reason: `all ink dropped: ${result.reason}` });
    }
  }

  // 6. The lines, and the sentences that no longer have their ink.
  const wanted = wantedPerLine(steps);
  const reveals = laid?.revealBySay ?? wanted.map((w) => ({ say: w.say, ink: [] as string[], point: [] }));
  const lines: TurnLine[] = [];
  let lastLost = false;
  reveals.forEach((reveal, i) => {
    const asked = wanted[i]?.wanted ?? 0;
    const got = reveal.ink.filter((id) => !isCopy(id)).length;
    let lost: boolean;
    if (asked > 0) {
      lost = layoutFailed || got === 0;
      lastLost = lost;
    } else {
      lost = lastLost;
    }
    const say = reveal.say.trim();
    const ink = [...reveal.ink];
    const recall = 'recall' in reveal && typeof reveal.recall === 'string' ? reveal.recall : undefined;
    if (say && lost && POINTS_AT_INK.test(say)) {
      dropped.push({ at: `line ${i}`, reason: 'points at ink that was not written' });
      // Its sentence goes; ink it did get (a copy that opened the page) still appears.
      if (ink.length > 0 || recall) lines.push({ say: '', ink, ...(recall ? { recall } : {}) });
      return;
    }
    if (!say && ink.length === 0 && !recall) return;
    lines.push({ say, ink, ...(recall ? { recall } : {}) });
  });

  // Never silence: one fixed line when nothing she wrote is left to say.
  if (!lines.some((l) => l.say)) {
    lines.push({ say: leaked > 0 ? LINES.haveAGo[input.lang][0] : MALFORMED_REPLY_LINE, ink: [] });
  }

  const opsDropped = laid?.dropped.length ?? 0;
  return {
    kind: 'turn',
    lines,
    laid,
    ...(subject !== undefined && !input.page.continue ? { subject } : {}),
    dropped,
    inkDropped: layoutFailed || opsDropped > 0 || inkLostInChecks,
    counts: { leaked, maths, layoutFailed, opsDropped },
  };
}

/** A checked turn, ready for the typed tutor to say line by line. */
export interface BoardTurn {
  lines: { say: string; recall?: string; show(): void }[];
}

/**
 * THE BOARD, AS THE TYPED TUTOR SEES IT (lib/geminiAgent.ts `board`).
 *
 *   onScreen  what is on the board now, for her brief
 *   holding   the question the class is holding on, if the hand went up at one
 *   turn      one reply's steps, checked and laid out; null when the class halted
 */
export interface DoubtBoard {
  onScreen(ctx: DoubtContext): Record<string, OnScreenElement>;
  holding(ctx: DoubtContext): string | null;
  turn(steps: readonly RawStep[], ctx: DoubtContext): BoardTurn | null;
}

export interface DoubtBoardDeps {
  session: BoardSession;
  /** The one halt (lib/sessionHalt.ts). Distress in a reply goes here. */
  halt: { readonly halted: boolean; haltSession(cause: HaltCause, supportLine: string): void };
  /** The question the class was holding when the hand went up, or null. */
  heldAsk: () => Beat['ask'] | null;
  /** The child's tutor language (lib/workspace.ts `tutorLanguage`). */
  lang: () => TutorLanguage;
  lessonId?: () => string | undefined;
  /** Told when a turn's ink did not all reach the board. Counts only — never words. */
  onInkDropped?: (info: { leaked: number; maths: number; layoutFailed: boolean; opsDropped: number }) => void;
}

/**
 * The typed tutor's board over one board session. A turn is committed (laid
 * out) the moment it is checked, and each line's ink is drawn by its `show`,
 * which the tutor hands to her voice as the line's `onStart` — so it appears
 * when she starts saying it (lib/voiceStart.ts).
 */
export function createDoubtBoard(deps: DoubtBoardDeps): DoubtBoard {
  const { session } = deps;
  const beatIndex = (ctx: DoubtContext): number => {
    const i = session.lesson.beats.findIndex((b) => b.id === ctx.beatId);
    return i < 0 ? 0 : i;
  };

  return {
    onScreen(ctx) {
      return describeOnScreen(session.sceneLesson, session.canvas(beatIndex(ctx)).visible, (id) => session.authorOf(id));
    },

    holding() {
      return deps.heldAsk()?.question ?? null;
    },

    turn(steps, ctx) {
      if (deps.halt.halted || session.frozen) return null;
      const doubt = session.doubt;
      const prepared = prepareDoubtTurn({
        steps: steps.map((s) => ({ say: s.say, ink: [...s.ink] })),
        lesson: session.lesson,
        state: session.state,
        onScreen: session.canvas(beatIndex(ctx)).visible,
        beatIds: new Set(recallTargets(ctx).map((b) => b.id)),
        page: { continue: doubt?.hasPage === true, ...(doubt?.subject !== undefined ? { subject: doubt.subject } : {}) },
        mustNotReveal: answerSecrets(deps.heldAsk()),
        lang: deps.lang(),
        lessonId: deps.lessonId?.(),
      });
      if (prepared.kind === 'halt') {
        deps.halt.haltSession('model-reply', prepared.say);
        return null;
      }
      if (prepared.laid && !session.commit(prepared.laid, 'tutor', { subject: prepared.subject })) return null;
      if (prepared.inkDropped) deps.onInkDropped?.(prepared.counts);
      const look = prepared.laid?.pageIds ?? [];
      return {
        lines: prepared.lines.map((line) => ({
          say: line.say,
          ...(line.recall ? { recall: line.recall } : {}),
          show: () => session.reveal(line.ink, look),
        })),
      };
    },
  };
}
