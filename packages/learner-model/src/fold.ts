import {
  GraphIndex,
  PRIOR,
  applyDoubt,
  applyEvidence,
  applyTaught,
  clampMastery,
  type Mastery,
  type ModelParams,
} from '@ai-tutor/knowledge-graph';
import type {
  AnsweredPayload,
  AssistanceRung,
  HelpedPayload,
  LedgerEvent,
} from '@ai-tutor/ledger';
import { deriveRung } from './rung.ts';
import {
  MODEL_VERSION,
  emptyConceptState,
  emptyModel,
  type ConceptState,
  type FoldCursor,
  type LearnerModel,
} from './types.ts';

/** The sitting these events belong to. `startedAt` is Postgres's clock. */
export interface FoldSession {
  id: string;
  startedAt: string;
}

/**
 * ONE SESSION'S EVENTS, FOLDED INTO WHAT WE BELIEVE.
 *
 * Takes a SESSION rather than a single event because the assistance rung is a
 * fact about what came BEFORE an answer in `seq` order — see `deriveRung`. It
 * does NOT require the whole session at once: the device calls this per event
 * as the class happens, and the server calls it per batch, so everything that
 * must survive between calls lives in the model rather than in a local.
 *
 * Pure: no clock, no I/O, no randomness. The same events in the same order
 * always rebuild the same model, which is what makes a session replayable and
 * these rows a record rather than a log.
 *
 * `events` must belong to `session` and be ordered by `seq` ascending.
 */
export function foldSession(
  model: LearnerModel,
  session: FoldSession,
  events: readonly LedgerEvent[],
  index: GraphIndex,
  params: ModelParams,
): LearnerModel {
  /**
   * A MODEL FROM A DIFFERENT SHAPE IS NOT FOLDED INTO, IT IS REBUILT.
   *
   * The version exists so a stored model can migrate rather than be guessed at,
   * and silently folding v1 rules into a v0 blob is the guess. Starting again
   * is cheap and correct: the ledger is the record, and this is a cache of it.
   */
  let next: LearnerModel =
    model.version === MODEL_VERSION
      ? { ...model, states: { ...model.states } }
      : emptyModel();

  // Help belongs to one sitting. A new session starts with none.
  let help: Record<string, number> =
    next.helpInFlight && next.helpInFlight.sessionId === session.id
      ? { ...next.helpInFlight.byAsk }
      : {};

  for (const event of events) {
    const cursor: FoldCursor = { at: session.startedAt, sessionId: session.id, seq: event.seq };

    /**
     * A `helped` BEHIND THE CURSOR STILL COUNTS AS HELP.
     *
     * It moves no belief and must not be applied twice — but the answer that
     * follows it needs to know it happened, and on a re-fold (a retried
     * request, a rebuild) the answer may be ahead of the cursor while the help
     * is behind it. Recording it first, then skipping the belief change, is
     * what keeps those two facts from coming apart.
     */
    if (event.kind === 'helped') {
      const payload = event.payload as HelpedPayload;
      const key = askKey(payload.beatId, payload.probeId, event.outcomeIds);
      help[key] = Math.max(help[key] ?? 0, payload.rung);
    }

    if (behindCursor(next.foldedThrough, cursor)) continue;

    switch (event.kind) {
      case 'answered':
        next = foldAnswer(next, event, help, index, params);
        break;
      case 'taught':
        next = foldTaught(next, event);
        break;
      case 'confused':
        next = foldConfused(next, event);
        break;
      default:
        // session-started, session-ended, asked, helped, intervened, reflected.
        //
        // `reflected` becomes evidence in Phase 5, when the judge classifies a
        // justification rather than merely scoring it. Until then it is
        // deliberately inert: a guess at what "they could justify it" is worth
        // would be a number nobody measured, sitting in the middle of the one
        // record every later phase reads as ground truth.
        break;
    }

    next = { ...next, foldedThrough: cursor };
  }

  return { ...next, helpInFlight: { sessionId: session.id, byAsk: help } };
}

/**
 * Already folded. Ordered by the SESSION's start, then the session id, then the
 * sequence — never by a string compare of a device clock.
 *
 * `Date.parse` rather than `<` on the strings: the device renders an instant as
 * `…T10:00:00.000Z` and PostgREST may render the same instant as
 * `…T10:00:00+00:00`, which sorts LATER as text and is EQUAL as time. An offset
 * form like `+05:30` sorts later still while being four and a half hours
 * earlier. One implementation on two runtimes is the whole design; they must
 * agree about which events are new.
 */
function behindCursor(done: FoldCursor | null, now: FoldCursor): boolean {
  if (!done) return false;
  const a = Date.parse(done.at);
  const b = Date.parse(now.at);
  if (b !== a) return b < a;
  if (now.sessionId !== done.sessionId) return now.sessionId < done.sessionId;
  return now.seq <= done.seq;
}

/** One ask, however the surface happens to name it. */
function askKey(
  beatId: string | undefined,
  probeId: string | undefined,
  ids: readonly string[],
): string {
  return beatId ?? probeId ?? ids.join(',');
}

/**
 * A number `applyEvidence` will read as an ANSWER rather than as a skip. Never
 * an option index — no surface has one — and never used for anything but the
 * null test at mastery.ts:157.
 */
const ANSWERED_WITHOUT_OPTIONS = -1;

/**
 * "THEY CHOSE NOTHING" AND "THERE WAS NOTHING TO CHOOSE" ARE DIFFERENT FACTS.
 *
 * `applyEvidence` reads `chosenIndex === null` as a SKIP: it pulls belief
 * toward 0, returns before it ever looks at `correct`, and deliberately does
 * not propagate, because silence says nothing about the rest of the map.
 *
 * An earlier version of this file passed `payload.chosenIndex ?? null` to
 * protect that meaning, and in doing so destroyed it. A SPOKEN answer carries
 * no `chosenIndex` — there are no options to index (`ClassRoom.tsx:671` files
 * one with a verdict and nothing else, while the tap path at `:286` sends
 * `chosenIndex: index`). So every spoken answer folded as a skip, and a
 * correct one said out loud came out at 0.350 where the same answer tapped
 * came out at 0.783, touching one node instead of six. Numerically identical
 * to saying nothing at all.
 *
 * That is the product's primary loop — a tutor who asks out loud and listens —
 * and `unassistedGain`, this phase's whole definition of done, is computed from
 * the number that moved the wrong way. The row contradicted itself too:
 * `lastUnassistedSuccessAt` was stamped from `correct` while the belief it
 * described fell.
 *
 * ONLY A SURFACE THAT OFFERED OPTIONS CAN PRODUCE A SKIP. Voice and text have
 * none, so a missing index there means "they answered, without options", and
 * the judge's verdict in `correct` is the evidence.
 */
function chosenIndexFor(event: LedgerEvent, payload: AnsweredPayload): number | null {
  if (typeof payload.chosenIndex === 'number') return payload.chosenIndex;
  return event.surface === 'tap' ? null : ANSWERED_WITHOUT_OPTIONS;
}

function foldAnswer(
  model: LearnerModel,
  event: LedgerEvent,
  help: Record<string, number>,
  index: GraphIndex,
  params: ModelParams,
): LearnerModel {
  const payload = event.payload as AnsweredPayload;
  // An answer about nothing is not evidence about anything, and it happens: a
  // free topic or a brought file has no map outcomes at all.
  if (event.outcomeIds.length === 0) return model;

  const key = askKey(payload.beatId, payload.probeId, event.outcomeIds);
  const rung = deriveRung([(help[key] ?? 0) as AssistanceRung], payload.assistanceRung);
  const unassisted = rung === 0;

  let states = { ...model.states };

  /**
   * EVERY OUTCOME THE BEAT SAID IT WAS CHECKING, not just the first.
   *
   * `classLedger` files an answer with `beat.checks`, which is a list: across
   * the fifteen authored lessons, 27 of the 126 beats that name any outcome
   * name more than one, and one names seven. Taking `outcomeIds[0]` silently
   * threw the rest away — six outcomes the beat explicitly claimed to be
   * checking got no belief, no observation and no date.
   */
  for (const nodeId of event.outcomeIds) {
    const answer = {
      probeId: payload.probeId ?? `${event.id}:${nodeId}`,
      nodeId,
      correct: payload.correct,
      chosenIndex: chosenIndexFor(event, payload),
      ms: payload.ms,
    };

    // The arithmetic stays where it already lives and is already tested. This
    // function decides WHICH belief each result lands in, not what the numbers
    // are.
    const before: Mastery = {};
    for (const state of Object.values(states)) before[state.outcomeId] = state.mastery;
    const after = applyEvidence(before, index, answer, { params });

    const counted = new Set<string>();
    for (const [id, value] of Object.entries(after)) {
      if (before[id] === value) continue;
      const prev = states[id] ?? emptyConceptState(id);
      states[id] = { ...prev, mastery: value, observations: prev.observations + 1 };
      counted.add(id);
    }

    /**
     * THE ASKED NODE IS COUNTED WHETHER OR NOT ITS BELIEF MOVED.
     *
     * A belief pinned at the floor or the ceiling does not move, and the loop
     * above skips anything unchanged — so ten cold wrong answers on the same
     * outcome used to leave `observations` at 2 while `unassistedObservations`
     * reached 10. A subset counter larger than the set it is a subset of is not
     * a rounding problem, it is the record disagreeing with itself, and
     * `chooseAsk` ranks on exactly this field.
     */
    const prev = states[nodeId] ?? emptyConceptState(nodeId);
    const updated: ConceptState = {
      ...prev,
      observations: counted.has(nodeId) ? prev.observations : prev.observations + 1,
      // Answers only, and always the asked node — this is what opens the
      // evidence gate, and attendance must never reach it.
      answerObservations: prev.answerObservations + 1,
      lastPracticedAt: event.at,
    };

    if (unassisted) {
      const moved = applyEvidence({ [nodeId]: prev.unassistedMastery }, index, answer, { params });
      updated.unassistedMastery = moved[nodeId] ?? prev.unassistedMastery;
      updated.unassistedObservations = prev.unassistedObservations + 1;
      if (payload.correct) updated.lastUnassistedSuccessAt = event.at;
    } else {
      const moved = applyEvidence({ [nodeId]: prev.assistedPerformance }, index, answer, { params });
      updated.assistedPerformance = moved[nodeId] ?? prev.assistedPerformance;
    }

    states[nodeId] = updated;
  }

  return { ...model, states };
}

function foldTaught(model: LearnerModel, event: LedgerEvent): LearnerModel {
  const states = { ...model.states };
  for (const id of event.outcomeIds) {
    const prev = states[id] ?? emptyConceptState(id);
    const times = prev.taughtCount + 1;
    /**
     * ATTENDANCE IS A SATURATING DELTA, AND THAT IS A DELIBERATE DEPARTURE.
     *
     * `applyTaught` pulls from the CURRENT belief with a strength of
     * `TAUGHT_STRENGTH * (1 + ln(times))`. Its documented 0.59 / 0.652 / 0.675
     * is what that produces only when the current belief happens to be the
     * prior, so it is written to be called ONCE with a total count. Calling it
     * again on an already-moved value compounds instead of saturating, and the
     * second viewing then counts for MORE than the first: +0.125 against +0.09.
     *
     * A fold sees the viewings one at a time and cannot call it once. So the
     * Nth viewing is worth what N viewings are worth minus what N-1 were,
     * measured from the prior, added to whatever else the student has earned.
     * That reproduces 0.59 / 0.652 / 0.675 exactly for an outcome with no other
     * evidence, and it SATURATES everywhere, which is the property that matters.
     *
     * What it costs, stated rather than hidden: for a student whose belief is
     * far from the prior the two rules differ. At the floor, this gives +0.09
     * where `applyTaught` would give +0.176 — attendance moves a struggling
     * student less than the original rule would. Attendance is the weakest
     * evidence the product has, so erring small is the right direction, but it
     * is a different rule and not a reimplementation of that one.
     *
     * `taughtCount` is durable across sittings for the same reason, and between
     * them they are the fix for Diagnostic.tsx:102-105, where attendance is
     * applied twice and can carry a node from the prior to nearly settled on
     * zero answered questions.
     */
    const wasWorth = applyTaught({ [id]: PRIOR }, [id], times - 1)[id] ?? PRIOR;
    const nowWorth = applyTaught({ [id]: PRIOR }, [id], times)[id] ?? PRIOR;
    states[id] = {
      ...prev,
      mastery: clampMastery(prev.mastery + (nowWorth - wasWorth)),
      taughtCount: times,
      observations: prev.observations + 1,
      lastPracticedAt: event.at,
    };
  }
  return { ...model, states };
}

function foldConfused(model: LearnerModel, event: LedgerEvent): LearnerModel {
  const states = { ...model.states };
  for (const id of event.outcomeIds) {
    const prev = states[id] ?? emptyConceptState(id);
    const moved = applyDoubt({ [id]: prev.mastery }, [id]);
    states[id] = {
      ...prev,
      mastery: moved[id] ?? prev.mastery,
      /**
       * A HAND COUNTS HERE AND NOT IN `observations`. applyDoubt's own rule
       * (mastery.ts:250-252): "a hand is a nudge rather than a verdict, and a
       * student who asks a lot must never be modelled as a student who knows
       * nothing". `evidenceSet` reads `observations` to decide what may become
       * a gap, so counting a raised hand there would put an otherwise
       * untouched outcome on the remedial plan at confidence 0.61 — on the
       * strength of the student having asked about it.
       */
      doubtCount: prev.doubtCount + 1,
      lastPracticedAt: event.at,
    };
  }
  return { ...model, states };
}
