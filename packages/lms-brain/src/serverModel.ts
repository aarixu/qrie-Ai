import { emptyParams, type GraphIndex, type ModelParams } from '@ai-tutor/knowledge-graph';
import {
  MODEL_VERSION,
  emptyConceptState,
  emptyModel,
  foldHistory,
  type ConceptState,
  type FoldSession,
  type LearnerModel,
} from '@ai-tutor/learner-model';
import type { LedgerEvent } from '@ai-tutor/ledger';
import { libraryIndex } from './graph.ts';
import { COLUMNS } from './think.ts';

/**
 * THE PHONE BUILDS ON THE SERVER'S MODEL (lam-one-brain Task 11, review SF4).
 *
 * The brain (think.ts) writes a learner's concept_state from their whole
 * ledger, homework and tutor alike. The tutor reads those rows back
 * (public.my_learner_model, 0109), takes them as its base model and folds on
 * top only its own events the brain had not read: the ones still in its
 * outbox, and the ones the server acknowledged after the brain's cursor
 * (record_evidence answers each event with its received_at, 0107). Folded
 * with the brain's graph (`libraryIndex`) and parameters (`emptyParams`), so
 * the phone's model before it syncs is the one the server makes after, on
 * every field that does not depend on whose clock timed the sitting
 * (tests/server-model.test.ts).
 *
 * Pure: the caller does the reading. The classroom's model store calls it
 * (apps/classroom/src/lib/learnerModel.ts `refreshFromServer`).
 */

/** Where the brain had read the ledger to: my_learner_model's `foldedThrough` (0109). */
export interface ServerCursor {
  /** The last event's received_at, to the millisecond. */
  at: string;
  /** That event's sitting; null once the purge has deleted the event. */
  sessionId: string | null;
  seq: number;
}

/** What public.my_learner_model() answers (0109). */
export interface ServerModel {
  /** The MODEL_VERSION the rows were folded by; null when the brain never wrote this learner. */
  version: number | null;
  foldedThrough: ServerCursor | null;
  /** concept_state rows, by column name. */
  states: readonly Record<string, unknown>[];
}

/** An event the server acknowledged, with the received_at record_evidence answered for it. */
export interface SentEvent {
  event: LedgerEvent;
  receivedAt: string;
}

/** An event's place in think()'s order of receipt. */
export interface ReceiptKey {
  receivedAt: string;
  sessionId: string;
  seq: number;
}

/**
 * An instant's milliseconds, from a timestamp with any number of fraction
 * digits: the digits past the third are cut, as think() cuts received_at with
 * date_trunc, never rounded. Postgres prints microseconds; `Date.parse` is
 * only specified for three digits.
 */
export function receiptMs(at: string): number {
  return Date.parse(at.replace(/(\.\d{3})\d+/, '$1'));
}

/**
 * Whether the brain had read this event when it wrote the rows: at or before
 * its cursor in think()'s order — received_at to the millisecond, then the
 * sitting, then seq. With the cursor's own event purged (no sitting), an event
 * received in the cursor's millisecond reads as read: such events came in one
 * call, and think() reads everything committed when it runs.
 *
 * What it cannot see: a write that began before the cursor's event and
 * committed after think() read the ledger has an earlier received_at and was
 * not read. think() folds it on its next run; until the phone reads the
 * server's model again, the phone does not count it.
 */
export function heldByServer(key: ReceiptKey, cursor: ServerCursor | null): boolean {
  if (!cursor) return false;
  const a = receiptMs(key.receivedAt);
  const b = receiptMs(cursor.at);
  if (a !== b) return a < b;
  if (cursor.sessionId === null) return true;
  if (key.sessionId !== cursor.sessionId) return key.sessionId < cursor.sessionId;
  return key.seq <= cursor.seq;
}

/**
 * concept_state rows as a LearnerModel: every field think() writes (COLUMNS),
 * dates as ISO strings. No cursor and no help in flight — the rows carry
 * neither, and the caller folds its own sittings on top from here. A column
 * a row does not have keeps the empty state's value.
 */
export function modelFromServer(server: ServerModel): LearnerModel {
  const states: Record<string, ConceptState> = {};
  for (const row of server.states) {
    const id = row.outcome_id;
    if (typeof id !== 'string') continue;
    const state: Record<string, unknown> = { ...emptyConceptState(id) };
    for (const [field, column, type] of COLUMNS) {
      const value = row[column];
      if (value === undefined) continue;
      if (type === 'timestamptz') state[field] = value === null ? null : new Date(receiptMs(String(value))).toISOString();
      else if (type === 'jsonb') state[field] = value ?? {};
      else state[field] = value;
    }
    states[id] = state as unknown as ConceptState;
  }
  return { ...emptyModel(), states };
}

export interface OnServerInput {
  server: ServerModel;
  /** Events the server acknowledged, with their receipt. */
  sent: readonly SentEvent[];
  /** Events the server has not acknowledged (the outbox). */
  unsent: readonly LedgerEvent[];
  /** The outbox's open sitting, which times its events when its `session-started` is not among them. */
  openSitting?: { id: string; startedAt: string } | null;
  index?: GraphIndex;
  params?: ModelParams;
}

export interface OnServer {
  model: LearnerModel;
  /** The events folded on top, in the order they were folded. */
  folded: LedgerEvent[];
  /** Ids of the `sent` events the brain had read: the phone need not keep them. */
  held: string[];
}

/**
 * The server's model with the phone's unread events folded on top, or null
 * when the rows were folded by another MODEL_VERSION (the phone does not build
 * on them).
 *
 * Each unread event's sitting is placed and timed by the phone: its
 * `session-started` event's time, else the outbox's open sitting, else its
 * first event's. `helped` events the brain had read are folded again in any
 * sitting folded here: help moves no belief, and an answer the brain had not
 * read that came after it in the same sitting is not an answer given alone.
 */
export function onServerModel(input: OnServerInput): OnServer | null {
  const { server } = input;
  if (server.version !== null && server.version !== MODEL_VERSION) return null;

  const held = new Set<string>();
  const fresh = new Map<string, LedgerEvent>();
  for (const { event, receivedAt } of input.sent) {
    if (heldByServer({ receivedAt, sessionId: event.sessionId, seq: event.seq }, server.foldedThrough)) held.add(event.id);
    else fresh.set(event.id, event);
  }
  for (const event of input.unsent) if (!held.has(event.id)) fresh.set(event.id, event);

  const sessions = new Set([...fresh.values()].map((e) => e.sessionId));
  const help = input.sent
    .map((s) => s.event)
    .filter((e) => e.kind === 'helped' && held.has(e.id) && sessions.has(e.sessionId));

  const known = [...input.sent.map((s) => s.event), ...input.unsent];
  const startOf = (id: string): string => {
    const opened = known.find((e) => e.sessionId === id && e.kind === 'session-started');
    if (opened) return opened.at;
    if (input.openSitting?.id === id) return input.openSitting.startedAt;
    return [...fresh.values()].filter((e) => e.sessionId === id).sort((a, b) => a.seq - b.seq)[0].at;
  };
  const sittings: FoldSession[] = [...sessions].map((id) => ({ id, startedAt: startOf(id) }));

  const { model, folded } = foldHistory(
    sittings,
    [...fresh.values(), ...help],
    input.index ?? libraryIndex(),
    input.params ?? emptyParams(),
    modelFromServer(server),
  );
  return { model, folded, held: [...held] };
}
