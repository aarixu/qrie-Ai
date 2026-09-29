import { GAP_THRESHOLD } from '@ai-tutor/knowledge-graph';
import type { AssistanceRung } from '@ai-tutor/ledger';
import type { AskOption } from '@ai-tutor/lesson-format';
import { leaks } from './leak.ts';
import { FRAMES, LINES } from './lines.ts';
import type { Action, ActionKind, AskInput, DecideInput, ErrorClass } from './types.ts';

/**
 * A wrong answer faster than this counts as "fast" — for the response-time
 * rule only, which is OFF (TD14). The number is a placeholder: nothing has
 * measured how fast a Class 6-10 student reads and answers a held question
 * (UNVERIFIED).
 */
export const FAST_WRONG_MS = 3000;

/**
 * THE NEXT THING THE TUTOR DOES, DECIDED BEFORE ANY MODEL IS CALLED (E1a).
 *
 * Pure: no model call, no clock (`now` is passed in), no randomness, no I/O.
 * The same input always gives the same action, so a session can be replayed
 * on the server and every choice audited. It decides; it does not speak,
 * write or record — the caller does all three, in the order `recordsFor`
 * gives, and speaks `say` only through the app's safety screen
 * (`screenedSpeech` / `toStudent`) with a halted result going to
 * `haltSession()`. Wired into the classroom's taps, hint chip, spoken answers
 * and silence nudges (apps/classroom/src/screens/ClassRoom.tsx).
 *
 * THE LADDER (TD1), on a wrong or unmatched answer, one delivered step per
 * wrong answer:
 *
 *   L0 alone → L1 a rethink line → L3 the authored hint (the chosen wrong
 *   option's `hint`, else the ask's) → L5 a worked example, ONLY where one is
 *   authored → L8 the answer and why → after that, move on and retest later.
 *
 * A rung with nothing usable authored for it is skipped, never filled with
 * invented words — and "usable" means it passes the leak check: an authored
 * hint that contains the answer is refused, which is how the proof lesson's
 * 4-of-4 leaked asks would have been caught.
 *
 * THE REST:
 *   - right, at any rung → brief, specific praise with the authored why; after
 *     any help, or cold against a weak unassisted record, a retest on a
 *     different item is scheduled;
 *   - silent → a content-free nudge, filed as L1, never a climb;
 *   - unclear → "say that again", which is not help and moves nothing;
 *   - hintRequest → up to L3 and no further: a request can never pull out the
 *     worked example or the answer;
 *   - a verdict its own match contradicts (a "right" that matched a wrong
 *     option) → "say that again", never praise.
 *
 * Attempt 2 or later counts as at least L1 (B4): they have been told the
 * first answer was not it.
 */
export function decide(input: DecideInput): Action {
  const floor = floorRung(input.rungSoFar, input.attempt);
  const options = optionsOf(input.ask);
  const matched = optionAt(options, input.matchedOption);
  // Once the answer is out — revealed, or said by the student — nothing is left
  // to protect.
  const secrets = floor >= 8 ? [] : secretsOf(input.ask);
  const ctx: Ctx = { input, floor, options, matched, secrets, head: headOf(input, floor) };

  const disagrees =
    matched !== undefined &&
    ((input.verdict === 'right' && matched.correct !== true) ||
      (input.verdict === 'wrong' && matched.correct === true));
  if (disagrees) {
    return act(ctx, {
      kind: 'nudge',
      rung: floor,
      helped: null,
      lines: LINES.sayAgain[input.lang],
      because: `${ctx.head}: the verdict and the matched option disagree, so ask again rather than judge`,
    });
  }

  switch (input.verdict) {
    case 'right':
      return onRight(ctx);
    case 'wrong':
    case 'unmatched':
      return onWrong(ctx);
    case 'silent':
      // Filed as L1 help, so the next answer is not read as cold — but not a
      // step on the ladder: nothing about the answer was said, so the first
      // wrong answer after a silence still gets the rethink.
      return act(ctx, {
        kind: 'nudge',
        rung: floor,
        helped: 1,
        lines: LINES.nudge[input.lang],
        because: `${ctx.head}: content-free nudge, filed as L1; silence never climbs the ladder`,
      });
    case 'unclear':
      return act(ctx, {
        kind: 'nudge',
        rung: floor,
        helped: null,
        errorClass: 'none',
        lines: LINES.sayAgain[input.lang],
        because: `${ctx.head}: nothing usable was heard; ask again, no help given, no evidence`,
      });
    case 'hintRequest':
      return onHintRequest(ctx);
  }
}

interface Ctx {
  input: DecideInput;
  /** The rung in force before this action: `rungSoFar`, or 1 on a later attempt. */
  floor: AssistanceRung;
  /** The options the judge matched against. */
  options: readonly AskOption[];
  matched: AskOption | undefined;
  secrets: string[];
  /** The start of every `because`: what happened, where, and what we believe. */
  head: string;
}

function onRight(ctx: Ctx): Action {
  const { input, floor } = ctx;
  const helpedBefore = floor >= 1;
  const unassisted = input.mastery?.unassisted;
  const weakRecord = !helpedBefore && unassisted !== undefined && unassisted < GAP_THRESHOLD;
  const why = (ctx.matched?.correct ? ctx.matched.why : undefined) ?? correctWhy(input.ask);
  // After the reveal it was read back, not worked out, and the praise says so.
  const openers =
    floor >= 8
      ? LINES.praiseAfterReveal[input.lang]
      : helpedBefore
        ? LINES.praiseAfterHelp[input.lang]
        : LINES.praise[input.lang];

  return act(ctx, {
    kind: 'praise',
    rung: floor,
    helped: null,
    errorClass: 'none',
    secrets: [],
    lines: openers.map((opener) => sentences(opener, why)),
    scheduleRetest: helpedBefore || weakRecord,
    because: helpedBefore
      ? `${ctx.head}: right after help; praise, and retest on a different item`
      : weakRecord
        ? `${ctx.head}: right cold against a weak unassisted record; praise, and retest on a different item`
        : `${ctx.head}: right cold; praise`,
  });
}

function onWrong(ctx: Ctx): Action {
  const { input, floor } = ctx;

  if (floor >= 8) {
    return act(ctx, {
      kind: 'moveOn',
      rung: floor,
      helped: null,
      lines: LINES.moveOn[input.lang],
      scheduleRetest: true,
      because: `${ctx.head}: the answer is already out; move on and retest on a different item`,
    });
  }

  const elapsed = input.timing ? input.now - input.timing.askedAt : undefined;
  if (input.timing?.rules === true && elapsed !== undefined && elapsed >= 0 && elapsed < FAST_WRONG_MS) {
    return act(ctx, {
      kind: 'rethink',
      rung: Math.max(floor, 1) as AssistanceRung,
      helped: 1,
      lines: LINES.reread[input.lang],
      because: `${ctx.head}: fast wrong (${elapsed} ms < ${FAST_WRONG_MS} ms); re-read, no climb (TD14 rule on)`,
    });
  }

  if (floor < 1) {
    // A named misconception gets its own diagnostic question first (C7): the
    // tutor finds out WHY before she corrects anything. Never one that leaks.
    const followUp = ctx.matched?.correct !== true ? followUpFor(input.ask, ctx.matched) : undefined;
    if (followUp && !leaks(followUp, ctx.secrets)) {
      return act(ctx, {
        kind: 'rethink',
        rung: 1,
        helped: 1,
        lines: [followUp],
        because: `${ctx.head}: first miss on a named misconception; its diagnostic follow-up (L1)`,
      });
    }
    return act(ctx, {
      kind: 'rethink',
      rung: 1,
      helped: 1,
      lines: LINES.rethink[input.lang],
      because: `${ctx.head}: first miss; rethink line (L1)`,
    });
  }

  const skipped: string[] = [];
  if (floor < 3) {
    const hint = usableHint(ctx);
    if ('text' in hint) return hintAction(ctx, hint.text, `${ctx.head}: hint (L3) from ${hint.source}`);
    skipped.push(`no usable hint: ${hint.reason}`);
  }

  if (floor < 5) {
    const worked = usableWorkedExample(ctx);
    if ('say' in worked) {
      return act(ctx, {
        kind: 'workedExample',
        rung: 5,
        helped: 5,
        lines: FRAMES.workedExample[input.lang].map((frame) => frame(worked.say)),
        boardIntent: { kind: 'writeInWorkArea', text: worked.lines },
        because: withSkips(`${ctx.head}: worked example (L5)`, skipped),
      });
    }
    skipped.push(`no usable worked example: ${worked.reason}`);
  }

  return revealOrMoveOn(ctx, skipped);
}

function revealOrMoveOn(ctx: Ctx, skipped: string[]): Action {
  const { input, floor } = ctx;
  const answer = correctText(input.ask);
  if (answer === undefined) {
    return act(ctx, {
      kind: 'moveOn',
      rung: floor,
      helped: null,
      lines: LINES.moveOn[input.lang],
      scheduleRetest: true,
      because: withSkips(`${ctx.head}: no authored answer to reveal; move on and retest`, skipped),
    });
  }
  const content = sentences(answer, correctWhy(input.ask));
  return act(ctx, {
    kind: 'reveal',
    rung: 8,
    helped: 8,
    secrets: [],
    lines: FRAMES.reveal[input.lang].map((frame) => frame(content)),
    boardIntent: { kind: 'writeInWorkArea', text: answer },
    scheduleRetest: true,
    because: withSkips(`${ctx.head}: answer and why (L8); retest on a different item`, skipped),
  });
}

function onHintRequest(ctx: Ctx): Action {
  const { input, floor } = ctx;
  const hint = usableHint(ctx);

  if (floor < 3 && 'text' in hint) {
    return hintAction(ctx, hint.text, `${ctx.head}: hint asked for; hint (L3) from ${hint.source}`, true);
  }
  if (floor >= 3 && 'text' in hint) {
    return act(ctx, {
      kind: 'hint',
      rung: floor,
      helped: 3,
      requested: true,
      lines: FRAMES.hintAgain[input.lang].map((frame) => frame(hint.text)),
      boardIntent: { kind: 'writeInWorkArea', text: hint.text },
      because: `${ctx.head}: hint asked for again; restated, since a request never climbs past L3`,
    });
  }
  const reason = 'reason' in hint ? hint.reason : '';
  // Never the rethink line here, even before any answer: "not quite" tells a
  // child who has not answered yet that they missed (overnight review #23).
  return act(ctx, {
    kind: 'nudge',
    rung: floor,
    helped: 1,
    requested: true,
    lines: LINES.haveAGo[input.lang],
    because: `${ctx.head}: hint asked for, no usable hint (${reason}); ask for a first step, no climb`,
  });
}

function hintAction(ctx: Ctx, text: string, because: string, requested = false): Action {
  return act(ctx, {
    kind: 'hint',
    rung: 3,
    helped: 3,
    requested,
    lines: FRAMES.hint[ctx.input.lang].map((frame) => frame(text)),
    boardIntent: { kind: 'writeInWorkArea', text },
    because,
  });
}

/** The chosen wrong option's hint, else the ask's — whichever does not leak. */
function usableHint(ctx: Ctx): { text: string; source: string } | { reason: string } {
  const candidates: Array<[string | undefined, string]> = [
    [ctx.matched && ctx.matched.correct !== true ? ctx.matched.hint : undefined, "the chosen option's hint"],
    [ctx.input.ask.hint, "the ask's hint"],
  ];
  let leaked = false;
  for (const [raw, source] of candidates) {
    const text = raw?.trim();
    if (!text) continue;
    if (leaks(text, ctx.secrets)) {
      leaked = true;
      continue;
    }
    return { text, source };
  }
  return { reason: leaked ? 'the authored hint leaks the answer' : 'none authored' };
}

function usableWorkedExample(ctx: Ctx): { say: string; lines: string } | { reason: string } {
  const steps = ctx.input.ask.workedExample?.steps ?? [];
  if (steps.length === 0) return { reason: 'none authored' };
  if (steps.some((s) => !s.say?.trim() || !s.line?.trim())) return { reason: 'a step is blank' };
  if (steps.some((s) => leaks(s.say, ctx.secrets) || leaks(s.line, ctx.secrets))) {
    return { reason: 'it leaks the answer' };
  }
  return {
    say: sentences(...steps.map((s) => s.say)),
    lines: steps.map((s) => s.line.trim()).join('\n'),
  };
}

interface Draft {
  kind: ActionKind;
  rung: AssistanceRung;
  helped: AssistanceRung | null;
  lines: readonly string[];
  because: string;
  requested?: boolean;
  errorClass?: ErrorClass;
  secrets?: string[];
  boardIntent?: Action['boardIntent'];
  scheduleRetest?: boolean;
}

/**
 * The action, with its line chosen: rotated by a hash of the ask so different
 * asks open on different variants, never the newest line already spoken,
 * avoiding any recent line where another variant exists, and never a line
 * that leaks. If every variant would repeat or leak, `say` is left out and
 * `because` says so — silence is safer than either.
 */
function act(ctx: Ctx, d: Draft): Action {
  const { input } = ctx;
  const secrets = d.secrets ?? ctx.secrets;
  const recent = input.recentLines ?? [];
  const newest = recent[recent.length - 1];
  const start = seedOf(`${input.ask.question}|${d.kind}|${input.attempt}|${ctx.floor}`) % Math.max(1, d.lines.length);
  const rotated = d.lines.map((_, i) => d.lines[(start + i) % d.lines.length]);
  const clean = rotated.filter((line) => line !== newest && !leaks(line, secrets));
  const say = clean.find((line) => !recent.includes(line)) ?? clean[0];

  const action: Action = {
    kind: d.kind,
    rung: d.rung,
    helped: d.helped,
    requested: d.requested ?? false,
    mustNotReveal: secrets,
    scheduleRetest: d.scheduleRetest ?? false,
    errorClass: d.errorClass ?? (d.kind === 'praise' ? 'none' : 'unclassified'),
    because: say === undefined ? `${d.because}; every line would repeat or leak, so nothing is said` : d.because,
  };
  if (say !== undefined) action.say = say;
  if (d.boardIntent) action.boardIntent = d.boardIntent;
  return action;
}

/** The rung already in force: what was delivered, or at least L1 on a later try (B4). */
function floorRung(rungSoFar: number, attempt: number): AssistanceRung {
  const r = Number.isFinite(rungSoFar) ? Math.min(8, Math.max(0, Math.floor(rungSoFar))) : 0;
  return (attempt > 1 && r < 1 ? 1 : r) as AssistanceRung;
}

function headOf(input: DecideInput, floor: AssistanceRung): string {
  const u = input.mastery?.unassisted;
  const belief = u === undefined ? 'unassisted unknown' : `unassisted ${u.toFixed(2)}`;
  const matched = input.matchedOption === undefined ? '' : `, matched option ${input.matchedOption}`;
  return `${input.verdict} on attempt ${input.attempt} at rung ${floor}${matched} (${belief})`;
}

/**
 * The diagnostic follow-up for a wrong option: its own, else the why-probe
 * option with the same words. Class-prep writes follow-ups on the probe's
 * distractors, and a child taps the ask's own chips — without this no
 * prepared class ever asked one (second review, 2026-09-29).
 */
function followUpFor(ask: AskInput, matched: AskOption | undefined): string | undefined {
  if (!matched) return undefined;
  const own = matched.followUp?.trim();
  if (own) return own;
  const key = matched.text.trim().toLowerCase();
  const twin = ask.whyProbe?.options.find((o) => o.correct !== true && o.text.trim().toLowerCase() === key);
  return twin?.followUp?.trim() || undefined;
}

/** The options the judge matched against: shown ones, else the why-probe's. */
function optionsOf(ask: AskInput): readonly AskOption[] {
  if (ask.options && ask.options.length > 0) return ask.options;
  return ask.whyProbe?.options ?? [];
}

function optionAt(options: readonly AskOption[], index: number | undefined): AskOption | undefined {
  if (index === undefined || !Number.isInteger(index) || index < 0) return undefined;
  return options[index];
}

/** The answer as the ask states it: the correct option's text, else `expect`. */
function correctText(ask: AskInput): string | undefined {
  const option = [...(ask.options ?? []), ...(ask.whyProbe?.options ?? [])].find((o) => o.correct === true);
  const text = option?.text?.trim() || ask.expect?.trim();
  return text ? text : undefined;
}

/** Why the answer is right, from the options shown, else the why-probe. */
function correctWhy(ask: AskInput): string | undefined {
  for (const list of [ask.options ?? [], ask.whyProbe?.options ?? []]) {
    const why = list.find((o) => o.correct === true)?.why?.trim();
    if (why) return why;
  }
  return undefined;
}

/** Everything that must not be said before the reveal. */
function secretsOf(ask: AskInput): string[] {
  const out = new Set<string>();
  const add = (s: string | undefined) => {
    const t = s?.trim();
    if (t) out.add(t);
  };
  add(ask.expect);
  for (const o of [...(ask.options ?? []), ...(ask.whyProbe?.options ?? [])]) {
    if (o.correct === true) add(o.text);
  }
  return [...out];
}

/** Sentences joined, each ending in punctuation, blanks dropped. */
function sentences(...parts: Array<string | undefined>): string {
  return parts
    .map((p) => p?.trim() ?? '')
    .filter((p) => p.length > 0)
    .map((p) => (/[.!?]$/.test(p) ? p : `${p}.`))
    .join(' ');
}

function withSkips(because: string, skipped: readonly string[]): string {
  return skipped.length === 0 ? because : `${because} (${skipped.join('; ')})`;
}

/** FNV-1a: a stable, dependency-free string hash for choosing a variant. */
function seedOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
