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
import { emptyConceptState, type ConceptState, type LearnerModel } from './types.ts';

/**
 * ONE SESSION'S EVENTS, FOLDED INTO WHAT WE BELIEVE.
 *
 * Takes a SESSION rather than a single event because the assistance rung is a
 * fact about what came BEFORE an answer in `seq` order — see `deriveRung`. A
 * one-event signature cannot see the `helped` rows and would have to trust the
 * client's ref, which is the thing that is wrong.
 *
 * Pure: no clock, no I/O, no randomness. The same events always rebuild the
 * same model, which is what makes a session replayable and these rows a record
 * rather than a log.
 *
 * `events` must be one session's, ordered by `seq` ascending. Anything at or
 * behind `model.foldedThrough` is skipped, which is what makes a retried
 * request harmless instead of a double-counted quiz.
 */
export function foldSession(
  model: LearnerModel,
  events: readonly LedgerEvent[],
  index: GraphIndex,
  params: ModelParams,
): LearnerModel {
  let next: LearnerModel = { ...model, states: { ...model.states } };

  /** The most help handed over so far, per thing being asked about. */
  const helpSoFar = new Map<string, AssistanceRung[]>();

  for (const event of events) {
    if (behindCursor(next, event)) continue;

    switch (event.kind) {
      case 'helped': {
        const payload = event.payload as HelpedPayload;
        const key = askKey(payload.beatId, payload.probeId, event.outcomeIds);
        const seen = helpSoFar.get(key) ?? [];
        seen.push(payload.rung);
        helpSoFar.set(key, seen);
        break;
      }
      case 'answered':
        next = foldAnswer(next, event, helpSoFar, index, params);
        break;
      case 'taught':
        next = foldTaught(next, event);
        break;
      case 'confused':
        next = foldConfused(next, event);
        break;
      default:
        // session-started, session-ended, asked, intervened, reflected.
        //
        // `reflected` becomes evidence in Phase 5, when the judge classifies a
        // justification rather than merely scoring it. Until then it is
        // deliberately inert: a guess at what "they could justify it" is worth
        // would be a number nobody measured, sitting in the middle of the one
        // record every later phase reads as ground truth.
        break;
    }

    next = { ...next, foldedThrough: { at: event.at, seq: event.seq } };
  }

  return next;
}

/**
 * Already folded. Compared on `(at, seq)` — the same pair the server orders by,
 * so the device and the Edge Function agree about what "new" means.
 */
function behindCursor(model: LearnerModel, event: LedgerEvent): boolean {
  const cursor = model.foldedThrough;
  if (!cursor) return false;
  if (event.at > cursor.at) return false;
  if (event.at < cursor.at) return true;
  return event.seq <= cursor.seq;
}

/** One ask, however the surface happens to name it. */
function askKey(
  beatId: string | undefined,
  probeId: string | undefined,
  ids: readonly string[],
): string {
  return beatId ?? probeId ?? ids.join(',');
}

function stateOf(model: LearnerModel, id: string): ConceptState {
  return model.states[id] ?? emptyConceptState(id);
}

function foldAnswer(
  model: LearnerModel,
  event: LedgerEvent,
  helpSoFar: Map<string, AssistanceRung[]>,
  index: GraphIndex,
  params: ModelParams,
): LearnerModel {
  const payload = event.payload as AnsweredPayload;
  const nodeId = event.outcomeIds[0];
  // An answer about nothing is not evidence about anything, and it happens: a
  // free topic or a brought file has no map outcomes at all.
  if (nodeId === undefined) return model;

  const key = askKey(payload.beatId, payload.probeId, event.outcomeIds);
  const rung = deriveRung(helpSoFar.get(key) ?? [], payload.assistanceRung);
  const unassisted = rung === 0;

  /**
   * `chosenIndex` STAYS NULL WHEN IT IS NULL. `applyEvidence` reads null as a
   * SKIP — a soft "probably not" that moves the node alone and deliberately
   * does not propagate. Coercing it to 0 would turn every skipped question into
   * "they confidently chose the first option", a much stronger claim, and then
   * spread it across the whole evidence region.
   */
  const answer = {
    probeId: payload.probeId ?? `${event.id}:${nodeId}`,
    nodeId,
    correct: payload.correct,
    chosenIndex: payload.chosenIndex ?? null,
    ms: payload.ms,
  };

  // The arithmetic stays where it already lives and is already tested. This
  // function decides WHICH belief each result lands in, not what the numbers
  // are.
  const before: Mastery = {};
  for (const state of Object.values(model.states)) before[state.outcomeId] = state.mastery;
  const after = applyEvidence(before, index, answer, { params });

  const states = { ...model.states };
  for (const [id, value] of Object.entries(after)) {
    if (before[id] === value) continue;
    const prev = stateOf(model, id);
    states[id] = { ...prev, mastery: value, observations: prev.observations + 1 };
  }

  // The answered node carries the two facts propagation must never claim:
  // somebody actually asked THIS, and this is when.
  const own = states[nodeId] ?? {
    ...stateOf(model, nodeId),
    observations: stateOf(model, nodeId).observations + 1,
  };
  const updated: ConceptState = { ...own, lastPracticedAt: event.at };

  if (unassisted) {
    const moved = applyEvidence({ [nodeId]: own.unassistedMastery }, index, answer, {
      params,
      // Propagation is meaningless here — this map holds one node, and the
      // claim being made is only about that node.
      probed: new Set([nodeId]),
    });
    updated.unassistedMastery = moved[nodeId] ?? own.unassistedMastery;
    updated.unassistedObservations = own.unassistedObservations + 1;
    if (payload.correct) updated.lastUnassistedSuccessAt = event.at;
  } else {
    const moved = applyEvidence({ [nodeId]: own.assistedPerformance }, index, answer, {
      params,
      probed: new Set([nodeId]),
    });
    updated.assistedPerformance = moved[nodeId] ?? own.assistedPerformance;
  }

  states[nodeId] = updated;
  return { ...model, states };
}

function foldTaught(model: LearnerModel, event: LedgerEvent): LearnerModel {
  const states = { ...model.states };
  for (const id of event.outcomeIds) {
    const prev = states[id] ?? emptyConceptState(id);
    const times = prev.taughtCount + 1;
    /**
     * ATTENDANCE IS APPLIED AS A DELTA, NOT BY RE-PULLING THE CURRENT VALUE.
     *
     * `applyTaught` is written to be called ONCE with the total count: its
     * strength is `TAUGHT_STRENGTH * (1 + ln(times))` measured from the PRIOR,
     * which is what makes the documented 1 -> 0.59, 2 -> 0.65, 3 -> 0.675
     * saturate. Calling it again on the already-moved value compounds instead
     * of saturating, and the second viewing then counts for MORE than the
     * first — measured here at +0.125 against +0.09, which is the opposite of
     * what the function is for.
     *
     * So the contribution of the Nth viewing is the difference between what N
     * viewings are worth and what N-1 were, added to whatever else the student
     * has earned. `taughtCount` is durable across sittings for the same
     * reason, and between them they are the fix for Diagnostic.tsx:102-105,
     * where attendance is applied twice and can carry a node from the prior to
     * nearly settled on zero answered questions.
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
      observations: prev.observations + 1,
      lastPracticedAt: event.at,
    };
  }
  return { ...model, states };
}
