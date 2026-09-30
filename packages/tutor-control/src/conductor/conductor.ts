import type { AssistanceRung } from '@ai-tutor/ledger';
import { decide } from '../decide.ts';
import { leaks } from '../leak.ts';
import type { Action, AskInput, Verdict } from '../types.ts';
import { teachBackId } from './plan.ts';
import { STUDENT_CLASSES } from './types.ts';
import type {
  Ack,
  Conductor,
  ConductorOptions,
  ConductorSnapshot,
  Move,
  MoveKind,
  PlanIdea,
  PlanMisconception,
  PlanQuestion,
  Reading,
  StudentClass,
  TeachingPlan,
} from './types.ts';

/**
 * THE CONDUCTOR: THE NEXT MOVE OF A LIVE CLASS, DECIDED IN CODE AFTER EVERY
 * STUDENT TURN.
 *
 * A class is run from a teaching plan, not played: the opener, then for each
 * idea predict → explain its points → check → teach back, then a recap by
 * retrieval, then a close. After every turn the conductor reads what the turn
 * was (a `Reading`, never raw words) and decides the MOVE and its content; the
 * words layer says it in the student's language.
 *
 * PURE: every call is one transition `step(state, event) → { state, move }`
 * over a copied state. It reads nothing but the plan, the state, the event and
 * the caller's options — its clock (`opts.now`, read once per call),
 * `opts.mastery` and `opts.lang`; no randomness, no I/O, no model call. That
 * is how `preview(reading)` returns exactly the move `hear(reading)` makes from
 * the same state at the same clock reading: both run the same transition, and
 * preview throws the new state away. Called before `start()`, `hear` and
 * `silence` start the class (their reading is not used) and `end` closes it.
 *
 * GRADING. Only a point's quick question, a check and a retest are graded:
 * their answers become evidence, and a wrong one climbs the package's own help
 * ladder through `decide()`, so rungs, help filed, strategies and `because`
 * stay what the rest of the product files. The opener and a prediction are
 * elicitation (acknowledged, never evidence). A teach-back is graded loosely,
 * with no ladder: right or partly counts as correct; wrong or "don't know"
 * counts as not, and gets the idea's core once. The recap is acknowledged,
 * never graded.
 *
 * RETESTS. A graded question answered right only after help (any help filed,
 * a silence's nudge included), answered right cold against a weak unassisted
 * record (`decide()`'s rule), or revealed, queues the idea's next check
 * (`check[1]`, then `check[2]`): one queued retest per idea at a time, asked
 * after the NEXT idea's points and before its check (interleaved), and any
 * left over before the recap.
 *
 * TIME. Once `minutes` have passed, the next time the class would move on
 * from a held question it goes straight to the recap, skipping the ideas and
 * retests not yet reached; a ladder under way is not cut short. From
 * `minutes + HARD_STOP_MINUTES`, every move is the close.
 *
 * MUST NOT REVEAL. While a question is held, its `expect` and `answer` — the
 * opener's, a prediction's and a teach-back's too, since each asks before it
 * tells — until it is answered right, revealed or left behind; nothing in the
 * recap or the close. The one exception is on a single move: a secret that
 * move must itself say (see `build`).
 */

/** A node at or above this unassisted mastery is held cold: its idea skips the prediction, never the check. */
export const COLD_MASTERY = 0.8;

/** Minutes past the class length at which any move becomes the close, recap or not. */
export const HARD_STOP_MINUTES = 3;

/** What she asks on the second silence in a row: an offer, never content. */
const CHECK_IN = {
  held: 'Would a hint help, or shall I explain it another way?',
  elicit: 'Would a hint help, or shall we find out together?',
  recap: 'Want to have another go, or shall we move on to the next one?',
} as const;

type Board = NonNullable<Move['board']>;
type Evidence = NonNullable<Move['evidence']>;
type Steps = NonNullable<Move['content']['steps']>;

/** Where the class is. */
type Pos =
  | { at: 'ready' }
  | { at: 'opener' }
  | { at: 'predict'; idea: number }
  | { at: 'point'; idea: number; point: number }
  /** `of`: the idea retested. `slot`: the idea whose points it follows, or -1 for one left over before the recap. */
  | { at: 'retest'; slot: number; of: number; check: number }
  | { at: 'check'; idea: number }
  | { at: 'teachBack'; idea: number }
  | { at: 'recap'; prompt: number }
  | { at: 'close' };

/** A queued retest: `ideas[of].check[check]`, due in the slot of idea `due` or later. */
interface Retest {
  of: number;
  check: number;
  due: number;
}

interface State {
  pos: Pos;
  seq: number;
  startedAt: number;
  /** The last idea entered; -1 before the first. */
  ideaIndex: number;
  // The held question. Reset whenever a new step is reached.
  /** Which try the next answer is, 1-based. */
  attempt: number;
  /** `decide()`'s rung in force (its `rungSoFar`): climbs only on the ladder. */
  ladder: AssistanceRung;
  /** The highest rung of help filed (`helped`), including help that does not climb. */
  delivered: AssistanceRung;
  /** `partly` answers so far. */
  partly: number;
  /** The misconception whose follow-up was just asked: the next reply is reasoning. */
  followUp: string | null;
  /** Silences in a row since the last spoken turn. */
  silences: number;
  /** Help asked for (or silence answered as such) on an ungraded or teach-back step. */
  requests: number;
  /** Alternates already said, so a second "another way" is a different one. */
  altsUsed: string[];
  // The class.
  retests: Retest[];
  /** Per idea: the next check index a retest would use. */
  nextCheck: number[];
  boardShown: Board | null;
  recapRan: boolean;
  evidence: Evidence[];
  last: Move | null;
}

interface Cfg {
  plan: TeachingPlan;
  opts: ConductorOptions;
  minutes: number;
  capMs: number;
  hardMs: number;
}

type Event =
  | { type: 'start' }
  | { type: 'hear'; reading: Omit<Reading, 'said'> }
  | { type: 'silence'; ms: number }
  | { type: 'end' };

type Grading = 'elicit' | 'graded' | 'teachBack';

interface Held {
  q: PlanQuestion;
  grading: Grading;
  /** The idea it belongs to; null for the opener. */
  idea: number | null;
  /** The move kind it was put with. */
  kind: MoveKind;
}

/** What a move is built from: a move that keeps what is held, or one `finish` has assembled. */
interface Parts {
  kind: MoveKind;
  ack?: Ack;
  say?: string;
  ask?: string;
  steps?: Steps;
  helped: AssistanceRung | null;
  requested: boolean;
  strategy: string;
  because: string;
  evidence?: Evidence;
}

/** The reaction to a turn that moves the class on; the next step's own move follows it. */
interface Reaction {
  ack?: Ack;
  evidence?: Evidence;
  because: string;
  /** A move kind of its own that still hands over with the next step's question: the reveal. */
  lead?: { kind: MoveKind; say: string; helped: AssistanceRung | null; requested: boolean; strategy: string };
}

type Decision = { stay: Parts } | { go: Reaction; to?: Pos };

/** Replies that, after a misconception's follow-up, are the student's reasoning. */
const REASONING: ReadonlySet<StudentClass> = new Set(['right', 'partly', 'wrong', 'dontKnow']);

/**
 * A conductor for one class. The plan must be one `validatePlan` accepts: it
 * is not checked again here, and a plan with, say, an idea of no points is
 * read out of range.
 */
export function createConductor(plan: TeachingPlan, opts: ConductorOptions): Conductor {
  const minutes = opts.minutes ?? plan.minutes;
  const cfg: Cfg = {
    plan,
    opts,
    minutes,
    capMs: minutes * 60_000,
    hardMs: (minutes + HARD_STOP_MINUTES) * 60_000,
  };
  let state = initialState(plan);

  const run = (event: Event): Move => {
    const next = step(cfg, state, event, opts.now());
    state = next.state;
    return next.move;
  };
  const heard = (r: Omit<Reading, 'said'>): Omit<Reading, 'said'> =>
    r.misconceptionId === undefined ? { class: r.class } : { class: r.class, misconceptionId: r.misconceptionId };

  return {
    start: () => run({ type: 'start' }),
    hear: (reading) => run({ type: 'hear', reading: heard(reading) }),
    silence: (ms) => run({ type: 'silence', ms }),
    end: () => run({ type: 'end' }),
    preview: (reading) => step(cfg, state, { type: 'hear', reading: heard(reading) }, opts.now()).move,
    held: () => heldAt(plan, state.pos)?.q ?? null,
    snapshot: () => snapshotOf(plan, state),
  };
}

function initialState(plan: TeachingPlan): State {
  return {
    pos: { at: 'ready' },
    seq: 0,
    startedAt: 0,
    ideaIndex: -1,
    attempt: 0,
    ladder: 0,
    delivered: 0,
    partly: 0,
    followUp: null,
    silences: 0,
    requests: 0,
    altsUsed: [],
    retests: [],
    nextCheck: plan.ideas.map(() => 1),
    boardShown: null,
    recapRan: false,
    evidence: [],
    last: null,
  };
}

/** The state, with every list copied: nothing a transition changes is shared with the state it came from. */
function clone(s: State): State {
  return {
    ...s,
    altsUsed: [...s.altsUsed],
    retests: [...s.retests],
    nextCheck: [...s.nextCheck],
    evidence: [...s.evidence],
  };
}

/**
 * THE TRANSITION. After the close it returns the close move and the same
 * state, for every event; `start()` once started returns the last move.
 */
function step(cfg: Cfg, state: State, event: Event, now: number): { state: State; move: Move } {
  if (state.last && (state.pos.at === 'close' || event.type === 'start')) return { state, move: state.last };
  const s = clone(state);

  if (s.pos.at === 'ready') {
    s.startedAt = now;
    if (event.type === 'end') {
      return { state: s, move: finish(cfg, s, { go: { because: 'ended before it began: close' }, to: { at: 'close' } }, now) };
    }
    const open = arrive(cfg, s, { at: 'opener' });
    const parts: Parts = { kind: open.kind, helped: null, requested: false, strategy: open.strategy, because: open.because };
    if (open.ask) parts.ask = open.ask;
    return { state: s, move: build(cfg, s, parts, open.board) };
  }

  const decision =
    event.type === 'hear'
      ? onHear(cfg, s, event.reading, now)
      : event.type === 'silence'
        ? onSilence(cfg, s, event.ms, now)
        : onEnd(s);
  return { state: s, move: finish(cfg, s, decision, now) };
}

// ─── Turns ────────────────────────────────────────────────────────────────

function onHear(cfg: Cfg, s: State, reading: Omit<Reading, 'said'>, now: number): Decision {
  s.silences = 0;
  // A class outside the contract's list is read as nothing usable heard.
  const cls: StudentClass = STUDENT_CLASSES.includes(reading.class) ? reading.class : 'unclear';
  const where = whereOf(cfg, s);

  if (cls === 'stop') return { go: { ack: { of: 'stop' }, because: `${where}: they want to stop; close` }, to: { at: 'close' } };

  const ask = currentAsk(cfg, s);
  if (cls === 'question') {
    return { stay: talk('answerDoubt', cls, ask, 'doubt', `${where}: a doubt; answer it briefly from the plan's facts, then ask again what was held (attempt unchanged)`) };
  }
  if (cls === 'offTopic') {
    return { stay: talk('redirect', cls, ask, 'redirect', `${where}: off topic; bring them back gently and ask again`) };
  }
  if (cls === 'unclear') {
    return { stay: talk('sayAgain', cls, ask, 'say-again', `${where}: nothing usable heard; ask them to say it again (no evidence, nothing moves)`) };
  }

  if (s.pos.at === 'recap') {
    const n = cfg.plan.recap.prompts.length;
    return { go: { ack: { of: cls }, because: `recap ${s.pos.prompt + 1} of ${n}: ${cls}, acknowledged; the recap is not graded` } };
  }

  const h = heldAt(cfg.plan, s.pos);
  if (!h) return { go: { because: `${where}: nothing is held; move on` } };
  const r = { class: cls, misconceptionId: reading.misconceptionId };
  if (h.grading === 'elicit') return onElicitReply(s, h, r);
  if (h.grading === 'teachBack') return onTeachBackReply(cfg, s, h, r.class);
  return onGradedReply(cfg, s, h, r, now);
}

/** The opener and a prediction: elicitation, never evidence. */
function onElicitReply(s: State, h: Held, r: { class: StudentClass; misconceptionId?: string }): Decision {
  const q = h.q;
  const what = h.kind === 'open' ? 'the opener' : 'a prediction';
  if (r.class === 'hintRequest') return elicitHelp(s, h, 'hintRequest');
  if (r.class === 'explainRequest') {
    return { go: { ack: { of: 'explainRequest' }, because: `${q.id}: they asked to be told, on ${what}; the explanation comes next, so move on` } };
  }
  // right, partly, wrong, dontKnow, chat
  const m = r.class === 'wrong' ? misconceptionOf(q, r.misconceptionId) : undefined;
  const fine = h.kind === 'predict' && r.class !== 'right' ? ' (a prediction that is not right is fine: the explanation follows)' : '';
  return {
    go: {
      ack: ackOf(r.class, m?.id, r.class === 'right' ? q.why : undefined),
      because: `${q.id}: ${r.class} to ${what}; not graded, no evidence: acknowledge it and move on${fine}`,
    },
  };
}

/** Help on the opener or a prediction: its hint once, then move on. Nothing is filed: it is not graded. */
function elicitHelp(s: State, h: Held, asked: StudentClass | null): Decision {
  s.requests += 1;
  const q = h.q;
  const what = h.kind === 'open' ? 'the opener' : 'a prediction';
  const how = asked ? 'a hint asked for' : `silence ${s.silences}`;
  const ack = asked ? { ack: { of: asked } } : {};
  if (s.requests === 1 && q.hint.trim()) {
    return {
      stay: {
        kind: 'hint',
        ...ack,
        say: q.hint.trim(),
        ask: q.question,
        helped: null,
        requested: asked !== null,
        strategy: 'hint',
        because: `${q.id}: ${how} on ${what}: give its hint; not filed as help, since ${what} is not graded`,
      },
    };
  }
  const why = s.requests === 1 ? 'no hint authored' : 'help needed again';
  return { go: { ...ack, because: `${q.id}: ${how} on ${what}, ${why}; it is not graded, so move on` } };
}

/** "Explain it to me": graded loosely, no ladder. */
function onTeachBackReply(cfg: Cfg, s: State, h: Held, cls: StudentClass): Decision {
  const idea = cfg.plan.ideas[h.idea ?? 0];
  const q = h.q;
  const rung = evidenceRung(s);
  switch (cls) {
    case 'right':
    case 'partly':
      return {
        go: {
          ack: { of: cls },
          evidence: evidenceOf(q, true, rung),
          because: `${q.id}: ${cls} teach-back, counted as correct on ${q.nodeIds.join(', ')} at rung ${rung}`,
        },
      };
    case 'wrong':
    case 'dontKnow':
      return {
        go: {
          ack: ackOf(cls, undefined, q.why),
          evidence: evidenceOf(q, false, rung),
          because: `${q.id}: ${cls} teach-back at rung ${rung}: give the idea's core once and move on (no ladder on a teach-back)`,
        },
      };
    case 'hintRequest':
    case 'explainRequest':
      return teachBackHelp(s, h, idea, cls);
    default:
      return { stay: talk('sayAgain', cls, q.question, 'say-again', `${q.id}: a reply that answers nothing; ask them to say it again (no evidence)`) };
  }
}

/**
 * Help on a teach-back: once, the idea another way — the first alternate of
 * its first point's question, filed as L7 — then, if help is needed again,
 * move on with no evidence.
 */
function teachBackHelp(s: State, h: Held, idea: PlanIdea, asked: StudentClass | null): Decision {
  s.requests += 1;
  const q = h.q;
  const alt = idea.points[0]?.ask.alternates.find((a) => a.say.trim());
  const how = asked ? `${asked} on the teach-back` : `silence ${s.silences} on the teach-back`;
  if (s.requests === 1 && alt) {
    s.delivered = maxRung(s.delivered, 7);
    return {
      stay: {
        kind: 'anotherWay',
        ...(asked ? { ack: { of: asked } } : {}),
        say: alt.say.trim(),
        ask: q.question,
        helped: 7,
        requested: asked !== null,
        strategy: alt.mode,
        because: `${q.id}: ${how}: the idea another way (L7, ${alt.mode}, from its first point's question), then ask again`,
      },
    };
  }
  const why = s.requests === 1 ? 'no alternate authored' : 'help needed again';
  return {
    go: {
      ...(asked ? { ack: ackOf(asked, undefined, q.why) } : {}),
      because: `${q.id}: ${how}, ${why}: no ladder on a teach-back, so move on with no evidence`,
    },
  };
}

/** A point's quick question, a check or a retest: graded, with the ladder. */
function onGradedReply(
  cfg: Cfg,
  s: State,
  h: Held,
  r: { class: StudentClass; misconceptionId?: string },
  now: number,
): Decision {
  const q = h.q;

  // After a misconception's follow-up the reply is their reasoning, not a
  // second answer: the reason it is not so, then the question again (C7).
  if (s.followUp !== null && REASONING.has(r.class)) {
    const m = misconceptionOf(q, s.followUp);
    s.followUp = null;
    if (m) {
      return {
        stay: {
          kind: h.kind,
          ack: ackOf(r.class, m.id, m.why),
          say: m.why.trim(),
          ask: q.question,
          helped: null,
          requested: false,
          strategy: 'after-follow-up',
          because: `${q.id}: their reasoning after the follow-up on ${m.id} (${r.class}), not a second answer: say why it is not so, then ask the question again; attempt ${s.attempt} stays`,
        },
      };
    }
  }

  if (r.class === 'chat') {
    return { stay: talk('sayAgain', 'chat', currentAsk(cfg, s), 'say-again', `${q.id}: a reply that answers nothing; ask them to say it again (no evidence, nothing moves)`) };
  }

  const rung = evidenceRung(s);

  if (r.class === 'partly' && s.partly === 0) {
    const attempt = s.attempt;
    s.partly = 1;
    s.attempt += 1;
    s.ladder = maxRung(s.ladder, 1);
    s.delivered = maxRung(s.delivered, 1);
    return {
      stay: {
        kind: 'probeMore',
        ack: { of: 'partly' },
        ask: q.hint.trim(),
        helped: 1,
        requested: false,
        strategy: 'probe-more',
        evidence: evidenceOf(q, false, rung),
        because: `${q.id}: partly on attempt ${attempt} at rung ${rung}: ask for the missing part with the hint's question (L1)`,
      },
    };
  }

  const m = r.class === 'wrong' ? misconceptionOf(q, r.misconceptionId) : undefined;
  const verdict: Verdict =
    r.class === 'right'
      ? 'right'
      : r.class === 'hintRequest'
        ? 'hintRequest'
        : r.class === 'explainRequest'
          ? 'explainRequest'
          : m
            ? 'wrong'
            : 'unmatched'; // a second partly, dontKnow, or a wrong that names no misconception of this question
  const answered = verdict !== 'hintRequest' && verdict !== 'explainRequest';
  const action = decideFor(cfg, s, q, verdict, m, now);
  if (answered) {
    if (r.class === 'partly') s.partly += 1;
    s.attempt += 1;
  } else {
    // Help asked for: the question is put again, so a pending follow-up is dropped.
    s.followUp = null;
  }
  return fromAction(cfg, s, h, action, {
    ack: ackOf(r.class, m?.id),
    ...(answered ? { evidence: evidenceOf(q, verdict === 'right', rung) } : {}),
    ...(m ? { misconception: m } : {}),
    lead: '',
  });
}

function onSilence(cfg: Cfg, s: State, ms: number, now: number): Decision {
  s.silences += 1;
  const n = s.silences;
  const lead = `silence ${n} (${Math.round(ms)} ms)`;

  if (s.pos.at === 'recap') {
    const where = `recap ${s.pos.prompt + 1} of ${cfg.plan.recap.prompts.length}`;
    if (n === 1) return { stay: quiet('nudge', currentAsk(cfg, s), null, `${where}: ${lead}: a content-free nudge, the prompt again`) };
    if (n === 2) return { stay: quiet('checkIn', CHECK_IN.recap, null, `${where}: ${lead}: check in`) };
    return { go: { because: `${where}: ${lead}: move on` } };
  }

  const h = heldAt(cfg.plan, s.pos);
  if (!h) return { go: { because: `${s.pos.at}: ${lead}: nothing is held; move on` } };
  const q = h.q;

  if (n === 1) {
    if (h.grading === 'graded') return fromAction(cfg, s, h, decideFor(cfg, s, q, 'silent', undefined, now), { lead: `${lead}: ` });
    const filed = h.grading === 'teachBack';
    if (filed) s.delivered = maxRung(s.delivered, 1);
    return {
      stay: quiet('nudge', currentAsk(cfg, s), filed ? 1 : null, `${q.id}: ${lead}: a content-free nudge, never the answer; ${filed ? 'filed as L1' : 'not filed, since it is not graded'}`),
    };
  }
  if (n === 2) {
    const offer = h.grading === 'elicit' ? CHECK_IN.elicit : CHECK_IN.held;
    return { stay: quiet('checkIn', offer, null, `${q.id}: ${lead}: check in, and offer a hint or another way`) };
  }
  if (h.grading === 'graded') {
    s.followUp = null;
    return fromAction(cfg, s, h, decideFor(cfg, s, q, 'hintRequest', undefined, now), {
      lead: `${lead}, answered as a hint request they did not make: `,
      requested: false,
    });
  }
  if (h.grading === 'teachBack') return teachBackHelp(s, h, cfg.plan.ideas[h.idea ?? 0], null);
  return elicitHelp(s, h, null);
}

function onEnd(s: State): Decision {
  if (!s.recapRan && s.ideaIndex >= 0) {
    return { go: { because: 'the class is being ended: the recap first, since it has not run' }, to: { at: 'recap', prompt: 0 } };
  }
  const why = s.recapRan ? 'the recap has begun' : 'no idea has begun';
  return { go: { because: `the class is being ended and ${why}: close` }, to: { at: 'close' } };
}

// ─── The ladder, through decide() ─────────────────────────────────────────

function decideFor(
  cfg: Cfg,
  s: State,
  q: PlanQuestion,
  verdict: Verdict,
  m: PlanMisconception | undefined,
  now: number,
): Action {
  const mastery = masteryOf(cfg.opts, q);
  const action = decide({
    verdict,
    attempt: s.attempt,
    rungSoFar: s.ladder,
    ask: askInputOf(q),
    // The why-probe lists the answer first, then the misconceptions in order.
    ...(m ? { matchedOption: 1 + q.misconceptions.indexOf(m) } : {}),
    ...(mastery ? { mastery } : {}),
    lang: cfg.opts.lang,
    now,
    recentLines: s.altsUsed,
  });
  s.ladder = maxRung(s.ladder, action.rung);
  s.delivered = maxRung(s.delivered, action.helped ?? 0);
  return action;
}

/**
 * The plan question as `decide()` reads an ask: an open question whose
 * why-probe holds the answer (correct) and each misconception as the student
 * would say it, with its reason and follow-up.
 */
function askInputOf(q: PlanQuestion): AskInput {
  return {
    question: q.question,
    expect: q.expect,
    hint: q.hint,
    whyProbe: {
      askedAs: 'open',
      options: [
        { text: q.answer, correct: true, why: q.why },
        ...q.misconceptions.map((m) => ({ text: m.soundsLike, why: m.why, followUp: m.followUp })),
      ],
    },
    ...(q.workedExample ? { workedExample: { steps: q.workedExample.steps.map((st) => ({ say: st.say, line: st.line })) } } : {}),
    alternates: q.alternates.map((a) => ({ mode: a.mode, say: a.say })),
  };
}

/** The weakest known unassisted mastery among the question's nodes; absent when none is known. */
function masteryOf(opts: ConductorOptions, q: PlanQuestion): { unassisted: number } | undefined {
  const read = opts.mastery;
  if (!read) return undefined;
  const known = q.nodeIds.map((n) => read(n)).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return known.length > 0 ? { unassisted: Math.min(...known) } : undefined;
}

interface FromAction {
  ack?: Ack;
  evidence?: Evidence;
  misconception?: PlanMisconception;
  /** Put before `decide()`'s own `because`. */
  lead: string;
  /** Overrides `decide()`'s `requested` (a silence answered as a hint request was not asked for). */
  requested?: boolean;
}

/** `decide()`'s action as a move: rung, help filed, strategy and because carried over. */
function fromAction(cfg: Cfg, s: State, h: Held, action: Action, ctx: FromAction): Decision {
  const q = h.q;
  const because = `${q.id}: ${ctx.lead}${action.because}`;
  const help = { helped: action.helped, requested: ctx.requested ?? action.requested, strategy: action.strategy };
  const reacted = {
    ...(ctx.ack ? { ack: ctx.ack } : {}),
    ...(ctx.evidence ? { evidence: ctx.evidence } : {}),
  };

  switch (action.kind) {
    case 'praise': {
      // decide() retests after a climb and after a cold right on a weak
      // record; help filed without a climb (a silence's nudge, another way
      // asked for) is in the evidence rung, and retests here too.
      const assisted = (ctx.evidence?.rung ?? 0) > 0;
      const note = action.scheduleRetest || assisted ? queueRetest(cfg, s, h) : '';
      return { go: { ...reacted, ack: ackOf('right', undefined, q.why), because: `${because}${note}` } };
    }
    case 'rethink': {
      const m = ctx.misconception;
      if (action.followUp && m) {
        s.followUp = m.id;
        return {
          stay: {
            kind: 'probeWhy',
            ...reacted,
            ...help,
            ask: m.followUp.trim(),
            because: `${because}; misconception ${m.id}: ask its follow-up before explaining anything (C7)`,
          },
        };
      }
      return { stay: { kind: 'probeMore', ...reacted, ...help, ask: q.question, because } };
    }
    case 'hint':
      return { stay: { kind: 'hint', ...reacted, ...help, say: q.hint.trim(), ask: q.question, because } };
    case 'workedExample':
      return { stay: { kind: 'workedExample', ...reacted, ...help, steps: stepsOf(q), ask: q.question, because } };
    case 'explainAgain': {
      const alt = alternateSaid(q, action, s.altsUsed);
      if (alt !== undefined) s.altsUsed.push(alt);
      return { stay: { kind: 'anotherWay', ...reacted, ...help, ...(alt ? { say: alt } : {}), ask: q.question, because } };
    }
    case 'nudge': {
      // No reaction on a nudge (the contract's `ack`); what was held is put again.
      const nudge: Parts = { kind: 'nudge', ...help, because };
      const ask = currentAsk(cfg, s);
      if (ask) nudge.ask = ask;
      if (ctx.evidence) nudge.evidence = ctx.evidence;
      return { stay: nudge };
    }
    case 'reveal': {
      const note = queueRetest(cfg, s, h);
      return {
        go: {
          ...reacted,
          because: `${because}${note}`,
          lead: { kind: 'reveal', say: sentences(q.answer, q.why), ...help },
        },
      };
    }
    case 'moveOn': {
      const note = queueRetest(cfg, s, h);
      return { go: { ...reacted, because: `${because}${note}` } };
    }
  }
}

/**
 * The alternate `decide()` chose (it returns the mode and a framed line, not
 * the alternate): the one of its mode inside its line, else the first of that
 * mode not yet said, else the first of that mode.
 */
function alternateSaid(q: PlanQuestion, action: Action, used: readonly string[]): string | undefined {
  const line = action.say ?? '';
  const ofMode = q.alternates.map((a) => ({ mode: a.mode, say: a.say.trim() })).filter((a) => a.say && a.mode === action.strategy);
  const inLine = ofMode.filter((a) => line.includes(a.say)).sort((x, y) => y.say.length - x.say.length)[0];
  return (inLine ?? ofMode.find((a) => !used.includes(a.say)) ?? ofMode[0])?.say;
}

/**
 * Queue the idea's next check as a retest, due after the next idea's points.
 * One queued retest per idea at a time. Returns the note for `because`.
 */
function queueRetest(cfg: Cfg, s: State, h: Held): string {
  if (h.idea === null) return '';
  const idea = cfg.plan.ideas[h.idea];
  if (s.retests.some((r) => r.of === h.idea)) return `; a retest of idea ${idea.id} is already queued`;
  const k = s.nextCheck[h.idea] ?? 1;
  if (k >= idea.check.length) return `; no fresh check left on idea ${idea.id} to retest with`;
  const due = s.ideaIndex + 1;
  s.retests.push({ of: h.idea, check: k, due });
  s.nextCheck[h.idea] = k + 1;
  const when = due < cfg.plan.ideas.length ? `after idea ${cfg.plan.ideas[due].id}'s points` : 'before the recap';
  return `; retest ${idea.check[k].id} queued for ${when}`;
}

// ─── Where the class goes next ────────────────────────────────────────────

/** The step after this one, in plan order; past the class length, the recap instead. */
function nextPos(cfg: Cfg, s: State, now: number): { pos: Pos; note?: string } {
  const plan = cfg.plan;
  const p = s.pos;
  if (p.at === 'close') return { pos: p };
  if (p.at === 'recap') {
    return { pos: p.prompt + 1 < plan.recap.prompts.length ? { at: 'recap', prompt: p.prompt + 1 } : { at: 'close' } };
  }

  const elapsed = now - s.startedAt;
  if (elapsed >= cfg.capMs && p.at !== 'ready') {
    if (s.ideaIndex < 0) return { pos: { at: 'close' }, note: `time is up (${mins(elapsed)} of ${cfg.minutes} min) before any idea began` };
    const left = plan.ideas.length - (s.ideaIndex + 1);
    return {
      pos: { at: 'recap', prompt: 0 },
      note: `time is up (${mins(elapsed)} of ${cfg.minutes} min): straight to the recap, skipping ${left} idea(s) not begun and ${s.retests.length} queued retest(s)`,
    };
  }

  switch (p.at) {
    case 'ready':
      return { pos: { at: 'opener' } };
    case 'opener':
      return { pos: ideaStart(cfg, s, 0) };
    case 'predict':
      return { pos: { at: 'point', idea: p.idea, point: 0 } };
    case 'point':
      return {
        pos: p.point + 1 < plan.ideas[p.idea].points.length ? { at: 'point', idea: p.idea, point: p.point + 1 } : retestOrCheck(s, p.idea),
      };
    case 'retest':
      return { pos: p.slot >= 0 ? retestOrCheck(s, p.slot) : leftoverOrRecap(s) };
    case 'check':
      return { pos: { at: 'teachBack', idea: p.idea } };
    case 'teachBack':
      return { pos: p.idea + 1 < plan.ideas.length ? ideaStart(cfg, s, p.idea + 1) : leftoverOrRecap(s) };
  }
}

/** An idea opens on its prediction, unless it has none or every node of it is held cold. */
function ideaStart(cfg: Cfg, s: State, i: number): Pos {
  const idea = cfg.plan.ideas[i];
  if (!idea) return leftoverOrRecap(s);
  return idea.predict && !heldCold(cfg, idea) ? { at: 'predict', idea: i } : { at: 'point', idea: i, point: 0 };
}

function heldCold(cfg: Cfg, idea: PlanIdea): boolean {
  const read = cfg.opts.mastery;
  if (!read || idea.nodeIds.length === 0) return false;
  return idea.nodeIds.every((n) => {
    const v = read(n);
    return typeof v === 'number' && v >= COLD_MASTERY;
  });
}

/** After idea `i`'s points: the first retest due by now, else the idea's check. */
function retestOrCheck(s: State, i: number): Pos {
  const at = s.retests.findIndex((r) => r.due <= i);
  if (at < 0) return { at: 'check', idea: i };
  const [r] = s.retests.splice(at, 1);
  return { at: 'retest', slot: i, of: r.of, check: r.check };
}

/** After the last idea: any retest still queued, then the recap. */
function leftoverOrRecap(s: State): Pos {
  const r = s.retests.shift();
  return r ? { at: 'retest', slot: -1, of: r.of, check: r.check } : { at: 'recap', prompt: 0 };
}

// ─── Reaching a step, and building the move ───────────────────────────────

interface Arrival {
  kind: MoveKind;
  say?: string;
  ask?: string;
  board: Board | null;
  strategy: string;
  because: string;
}

/** Move to `pos`: a fresh hold, the board if it changes, and the step's own content. */
function arrive(cfg: Cfg, s: State, pos: Pos): Arrival {
  const plan = cfg.plan;
  s.pos = pos;
  s.attempt = heldAt(plan, pos) ? 1 : 0;
  s.ladder = 0;
  s.delivered = 0;
  s.partly = 0;
  s.followUp = null;
  s.silences = 0;
  s.requests = 0;
  s.altsUsed = [];

  switch (pos.at) {
    case 'ready':
    case 'opener':
      return {
        kind: 'open',
        ask: plan.opener.question,
        board: show(s, plan.ideas[0]?.board),
        strategy: 'open',
        because: "opens with a question from the student's life, not an announcement",
      };
    case 'predict': {
      const idea = plan.ideas[pos.idea];
      s.ideaIndex = pos.idea;
      const why = cfg.opts.mastery ? 'not every node of it is held cold' : 'no mastery known';
      return {
        kind: 'predict',
        ask: idea.predict?.question ?? '',
        board: show(s, idea.board),
        strategy: 'predict',
        because: `idea ${idea.id}: ask for a prediction before telling (${why})`,
      };
    }
    case 'point': {
      const idea = plan.ideas[pos.idea];
      const point = idea.points[pos.point];
      s.ideaIndex = pos.idea;
      const cold = pos.point === 0 && idea.predict !== undefined && heldCold(cfg, idea) ? '; no prediction: every node of the idea is held cold' : '';
      return {
        kind: 'explain',
        say: point.say,
        ask: point.ask.question,
        board: show(s, idea.board),
        strategy: 'explain',
        because: `idea ${idea.id}, point ${point.id} (${pos.point + 1} of ${idea.points.length}): one point, then its quick question${cold}`,
      };
    }
    case 'retest': {
      const idea = plan.ideas[pos.of];
      const q = idea.check[pos.check];
      const when = pos.slot >= 0 ? `interleaved after idea ${plan.ideas[pos.slot].id}'s points` : 'left over, before the recap';
      return {
        kind: 'check',
        ask: q.question,
        board: null,
        strategy: 'retest',
        because: `retest of idea ${idea.id} on a fresh question, ${q.id}, queued when an earlier one needed help or met a weak record; ${when}`,
      };
    }
    case 'check': {
      const idea = plan.ideas[pos.idea];
      s.ideaIndex = pos.idea;
      return {
        kind: 'check',
        ask: idea.check[0].question,
        board: show(s, idea.board),
        strategy: 'check',
        because: `idea ${idea.id}: retrieval check ${idea.check[0].id} after its points`,
      };
    }
    case 'teachBack': {
      const idea = plan.ideas[pos.idea];
      s.ideaIndex = pos.idea;
      return {
        kind: 'teachBack',
        ask: idea.teachBack.prompt,
        board: show(s, idea.board),
        strategy: 'teach-back',
        because: `idea ${idea.id}: they explain it back in their own words`,
      };
    }
    case 'recap': {
      s.recapRan = true;
      const n = plan.recap.prompts.length;
      return {
        kind: 'recap',
        ask: plan.recap.prompts[pos.prompt],
        board: null,
        strategy: 'recap',
        because: `recap ${pos.prompt + 1} of ${n}: they recall the class; she does not repeat it`,
      };
    }
    case 'close': {
      const covered = Math.max(0, s.ideaIndex + 1);
      return {
        kind: 'close',
        say: summaryOf(plan, s.ideaIndex),
        board: null,
        strategy: 'close',
        because: `close with a one-line summary of the ${covered} idea(s) begun`,
      };
    }
  }
}

/** Build the move from a decision, after the hard stop has had its say. */
function finish(cfg: Cfg, s: State, decision: Decision, now: number): Move {
  let d = decision;
  const elapsed = now - s.startedAt;
  const closing = 'go' in d && d.to?.at === 'close';
  if (!closing && elapsed >= cfg.hardMs) {
    const r = 'stay' in d ? d.stay : d.go;
    d = {
      go: {
        ...(r.ack ? { ack: r.ack } : {}),
        ...(r.evidence ? { evidence: r.evidence } : {}),
        because: `${r.because}; hard stop: ${mins(elapsed)} min is past ${cfg.minutes} + ${HARD_STOP_MINUTES} min, so close`,
      },
      to: { at: 'close' },
    };
  }

  if ('stay' in d) {
    if (d.stay.evidence) s.evidence.push(d.stay.evidence);
    return build(cfg, s, d.stay, null);
  }

  const r = d.go;
  if (r.evidence) s.evidence.push(r.evidence);
  const next: { pos: Pos; note?: string } = d.to ? { pos: d.to } : nextPos(cfg, s, now);
  const arrival = arrive(cfg, s, next.pos);
  const lead = arrival.kind === 'close' ? undefined : r.lead;
  const kind = lead?.kind ?? arrival.kind;
  const parts: Parts = {
    kind,
    helped: lead ? lead.helped : null,
    requested: lead ? lead.requested : false,
    strategy: lead?.strategy ?? arrival.strategy,
    because: `${r.because}; next: ${next.note ? `${next.note}; ` : ''}${arrival.because}`,
  };
  if (r.ack) parts.ack = r.ack;
  const say = [lead?.say, arrival.say].filter((t): t is string => !!t && t.trim().length > 0).join(' ');
  if (say) parts.say = say;
  if (arrival.ask) parts.ask = arrival.ask;
  if (r.evidence) parts.evidence = r.evidence;
  // A reveal that carries the next point's explanation takes the explain cap.
  return build(cfg, s, parts, arrival.board, Math.max(capOf(kind), capOf(arrival.kind)));
}

function build(cfg: Cfg, s: State, parts: Parts, board: Board | null, maxSentences = capOf(parts.kind)): Move {
  const h = heldAt(cfg.plan, s.pos);
  const content: Move['content'] = {};
  if (parts.say) content.say = parts.say;
  if (parts.ask) content.ask = parts.ask;
  if (parts.steps) content.steps = parts.steps.map((st) => ({ say: st.say, line: st.line }));

  // What the move must say — its content, and the reason in its reaction —
  // is never also what it must not: an authored point may state its own quick
  // question's answer, and a reason given in reaction (a right answer's why, a
  // reveal) may state the next question's. Leaving such a secret out for this
  // one move is what lets the words layer say it; the next move that holds
  // the question protects it again.
  const spoken = [parts.say, parts.ack?.why, ...(parts.steps ?? []).flatMap((st) => [st.say, st.line])].filter(
    (t): t is string => !!t && t.trim().length > 0,
  );
  const mustNotReveal = h ? secretsOf(h.q).filter((secret) => !spoken.some((t) => leaks(t, [secret]))) : [];

  s.seq += 1;
  const move: Move = {
    seq: s.seq,
    kind: parts.kind,
    ideaId: h && h.idea !== null ? cfg.plan.ideas[h.idea].id : null,
    ...(parts.ack ? { ack: { ...parts.ack } } : {}),
    content,
    heldQuestionId: h ? h.q.id : null,
    handsOver: parts.kind !== 'close',
    board: board ? copyBoard(board) : null,
    mustNotReveal,
    maxSentences,
    because: parts.because,
    helped: parts.helped,
    requested: parts.requested,
    strategy: parts.strategy,
    ...(parts.evidence ? { evidence: copyEvidence(parts.evidence) } : {}),
    final: parts.kind === 'close',
  };
  s.last = move;
  return move;
}

// ─── Small pieces ─────────────────────────────────────────────────────────

/** The question held at `pos`, and how its answer is read. The recap and the close hold none. */
function heldAt(plan: TeachingPlan, pos: Pos): Held | null {
  switch (pos.at) {
    case 'opener':
      return { q: plan.opener, grading: 'elicit', idea: null, kind: 'open' };
    case 'predict': {
      const q = plan.ideas[pos.idea].predict;
      return q ? { q, grading: 'elicit', idea: pos.idea, kind: 'predict' } : null;
    }
    case 'point':
      return { q: plan.ideas[pos.idea].points[pos.point].ask, grading: 'graded', idea: pos.idea, kind: 'explain' };
    case 'retest':
      return { q: plan.ideas[pos.of].check[pos.check], grading: 'graded', idea: pos.of, kind: 'check' };
    case 'check':
      return { q: plan.ideas[pos.idea].check[0], grading: 'graded', idea: pos.idea, kind: 'check' };
    case 'teachBack':
      return { q: teachBackQuestion(plan.ideas[pos.idea]), grading: 'teachBack', idea: pos.idea, kind: 'teachBack' };
    default:
      return null;
  }
}

/**
 * The teach-back, held as a question so the reply can be read against its
 * `expect`: held under `teachBackId`, and its `why` is the idea's first point
 * — the core she gives when the teach-back misses.
 */
function teachBackQuestion(idea: PlanIdea): PlanQuestion {
  return {
    id: teachBackId(idea.id),
    question: idea.teachBack.prompt,
    expect: idea.teachBack.expect,
    answer: idea.teachBack.expect,
    why: idea.points[0]?.say ?? '',
    hint: '',
    misconceptions: [],
    alternates: [],
    nodeIds: [...idea.nodeIds],
  };
}

/** What she is waiting on: a pending follow-up, else the held question, else the recap prompt. */
function currentAsk(cfg: Cfg, s: State): string | undefined {
  if (s.pos.at === 'recap') return cfg.plan.recap.prompts[s.pos.prompt];
  const h = heldAt(cfg.plan, s.pos);
  if (!h) return undefined;
  if (s.followUp !== null) {
    const m = misconceptionOf(h.q, s.followUp);
    if (m) return m.followUp.trim();
  }
  return h.q.question;
}

function whereOf(cfg: Cfg, s: State): string {
  const h = heldAt(cfg.plan, s.pos);
  if (h) return h.q.id;
  if (s.pos.at === 'recap') return `recap ${s.pos.prompt + 1} of ${cfg.plan.recap.prompts.length}`;
  return s.pos.at;
}

function misconceptionOf(q: PlanQuestion, id: string | undefined): PlanMisconception | undefined {
  return id === undefined ? undefined : q.misconceptions.find((m) => m.id === id);
}

function ackOf(of: StudentClass, misconceptionId?: string, why?: string): Ack {
  const ack: Ack = { of };
  if (misconceptionId !== undefined) ack.misconceptionId = misconceptionId;
  const reason = why?.trim();
  if (reason) ack.why = reason;
  return ack;
}

function talk(kind: MoveKind, of: StudentClass, ask: string | undefined, strategy: string, because: string): Parts {
  const parts: Parts = { kind, ack: { of }, helped: null, requested: false, strategy, because };
  if (ask) parts.ask = ask;
  return parts;
}

function quiet(kind: 'nudge' | 'checkIn', ask: string | undefined, helped: AssistanceRung | null, because: string): Parts {
  const parts: Parts = { kind, helped, requested: false, strategy: kind === 'checkIn' ? 'check-in' : 'nudge', because };
  if (ask) parts.ask = ask;
  return parts;
}

/** The rung their answer is filed at: the help filed so far, and at least L1 on a later try (B4). */
function evidenceRung(s: State): AssistanceRung {
  return maxRung(s.delivered, s.attempt > 1 ? 1 : 0);
}

function evidenceOf(q: PlanQuestion, correct: boolean, rung: AssistanceRung): Evidence {
  return { questionId: q.id, nodeIds: [...q.nodeIds], correct, rung };
}

function copyEvidence(e: Evidence): Evidence {
  return { questionId: e.questionId, nodeIds: [...e.nodeIds], correct: e.correct, rung: e.rung };
}

function copyBoard(b: Board): Board {
  return b.focus ? { beatId: b.beatId, focus: [...b.focus] } : { beatId: b.beatId };
}

/** The board to send: `board` when it differs from what is showing, else null (leave it). */
function show(s: State, board: Board | undefined): Board | null {
  if (!board) return null;
  const same =
    s.boardShown !== null &&
    s.boardShown.beatId === board.beatId &&
    (s.boardShown.focus ?? []).join('\u0000') === (board.focus ?? []).join('\u0000');
  if (same) return null;
  s.boardShown = board;
  return board;
}

function stepsOf(q: PlanQuestion): Steps {
  return (q.workedExample?.steps ?? []).map((st) => ({ say: st.say, line: st.line }));
}

/** The expected answer and the answer as she gives it, the leak check's secrets for the held question. */
function secretsOf(q: PlanQuestion): string[] {
  const out: string[] = [];
  for (const s of [q.expect, q.answer]) {
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

function summaryOf(plan: TeachingPlan, ideaIndex: number): string {
  const titles = plan.ideas
    .slice(0, Math.max(0, ideaIndex + 1))
    .map((i) => i.title.trim())
    .filter((t) => t.length > 0);
  if (titles.length === 0) return `We stopped before the first idea of ${plan.title.trim()}.`;
  const listed = titles.length === 1 ? titles[0] : `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`;
  return `Today we worked through ${listed}.`;
}

function capOf(kind: MoveKind): number {
  return kind === 'open' || kind === 'explain' || kind === 'close' ? 3 : 2;
}

function maxRung(a: number, b: number): AssistanceRung {
  return Math.min(8, Math.max(0, Math.floor(a), Math.floor(b))) as AssistanceRung;
}

function sentences(...parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => (/[.!?]$/.test(p) ? p : `${p}.`))
    .join(' ');
}

function mins(ms: number): string {
  return (ms / 60_000).toFixed(1);
}

function snapshotOf(plan: TeachingPlan, s: State): ConductorSnapshot {
  const h = heldAt(plan, s.pos);
  return {
    seq: s.seq,
    ideaIndex: s.ideaIndex,
    phase: phaseOf(s.pos),
    heldQuestionId: h ? h.q.id : null,
    attempt: h ? s.attempt : 0,
    rung: h ? s.delivered : 0,
    startedAt: s.startedAt,
    evidence: s.evidence.map(copyEvidence),
    done: s.pos.at === 'close',
  };
}

function phaseOf(pos: Pos): string {
  switch (pos.at) {
    case 'ready':
      return 'ready';
    case 'opener':
      return 'open';
    case 'predict':
      return 'idea:predict';
    case 'point':
      return 'idea:explain';
    case 'retest':
      return pos.slot >= 0 ? 'idea:retest' : 'retest';
    case 'check':
      return 'idea:check';
    case 'teachBack':
      return 'idea:teachBack';
    case 'recap':
      return 'recap';
    case 'close':
      return 'close';
  }
}
