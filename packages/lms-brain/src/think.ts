import { emptyParams, type GraphIndex, type ModelParams } from '@ai-tutor/knowledge-graph';
import {
  MISCONCEPTION_LIMITS,
  MODEL_VERSION,
  emptyModel,
  foldSession,
  isConfirmed,
  normaliseMisconception,
  type ConceptState,
  type FoldCursor,
  type LearnerModel,
  type Misconception,
} from '@ai-tutor/learner-model';
import type { LedgerEvent } from '@ai-tutor/ledger';
import { libraryIndex } from './graph.ts';

/**
 * THE SERVER FOLD. Reads a child's ledger — homework from the LMS, and the
 * tutor's classes, quizzes and doubts alike — and folds it into
 * public.concept_state with packages/learner-model's foldSession: the same
 * function, the same parameters and the same graph propagation the tutor has
 * run in the browser, so there is one idea of what a child knows, not two.
 * Every field of the fold's ConceptState is written (0100).
 *
 * IT FOLDS FORWARD FROM A SNAPSHOT (Task 2b, 0101). learner_model.snapshot
 * holds the model built from everything the server received up to an hour
 * before the last run (SNAPSHOT_LAG_SECONDS); each run reads only the events
 * received after it, folds them on top and writes the result. Events are read
 * in the server's ORDER OF RECEIPT — received_at to the millisecond, then the
 * sitting, then seq — so evidence that arrives late is never behind the
 * cursor, and folding forward lands where a rebuild over the same events
 * lands. The snapshot stays an hour behind because a write that began
 * earlier (so has an earlier received_at) can commit after a later one has
 * been folded; that hour is folded again on every run. The snapshot keeps
 * what the fold learned, so the nightly purge (0102) can delete an answer
 * older than 90 days without the model forgetting it ONCE THE SNAPSHOT HOLDS
 * IT, which takes a run over an hour after the answer arrived. A run straight
 * after a hand-in is too soon for that hand-in, so `settleDue` thinks every
 * learner whose snapshot is behind their settled evidence; it has to run
 * between that hour and the purge's cutoff. The brain function
 * (supabase/functions/brain; run.ts) runs it, through the queue, on every
 * call, but it is not deployed or scheduled yet, so nothing on the hosted
 * project runs think() or the settle pass, and an answer the snapshot does
 * not hold when the purge deletes it is lost to the model. The snapshot is the fold's own model, so it keeps a wrong idea's
 * wording as the phone sent it (only what is written to concept_state is
 * replaced by the bank's); the learner reads their own row (0013), and the
 * lms functions read only learner_model's cursor and updated_at, never
 * learner_model.snapshot.
 *
 * It REBUILDS from the whole ledger when there is no snapshot, when the
 * snapshot is of another MODEL_VERSION, or when asked (`rebuild`). A change
 * to the outcome graph or to the bank's labels reaches evidence already in
 * the snapshot only through such a rebuild, and a rebuild knows only what the
 * ledger still holds.
 *
 * THE SERVER'S CLOCK (review MF3). A sitting is timed by its
 * learning_session.received_at, never by the phone's started_at, and an
 * event's own `at` is pulled into [received_at - 7 days, received_at + 5
 * minutes]. The fold times the mastery rule's day apart and the review ladder
 * on the sitting's time, so a phone clock can neither backdate a sitting into
 * "mastered" nor schedule a review in 2099.
 *
 * THE SCHOOL'S BANK (review MF5). An answer to a question lms.item holds —
 * homework, a test or practice by the item's id, the tutor by the library id
 * it asked (`probeId` = lms.item.library_ref) — is counted as that library
 * question wherever it was asked, and a wrong option's idea is the bank's
 * label for it, not the phone's. A wrong idea named only by the phone is kept
 * by its id, with no text, in what is written.
 *
 * ONE LEARNER, ONE TRANSACTION (review MF9): `think` gives each learner their
 * own, and `thinkLearner` runs inside one it is handed, under a lock on that
 * learner, so two runs over one child take turns and a reader sees the last
 * model or the next one, never half of one.
 *
 * Writes as the database owner or service role — concept_state has no
 * browser write policy (0013). WHERE THIS RUNS: drain.ts, for every learner
 * an answer put on public.brain_queue (0108): the demo school's server drains
 * the queue after every lms call, and supabase/functions/brain is to drain it on
 * the hosted project once it is deployed and scheduled (Aarav's step).
 */

/** Something that runs a query: a database, or a transaction on one. */
export interface Tx {
  query<R>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

/** A database that can also open a transaction (PGlite has both). */
export interface Sql extends Tx {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

/** One ledger event as the fold reads it, with its sitting's server time and its bank item. */
export interface LedgerRow {
  id: string;
  user_id: string;
  org_id: string;
  session_id: string;
  seq: number;
  /** The phone's clock, pulled to within a week before and five minutes after receipt. */
  at: string | Date;
  kind: string;
  source: string;
  surface: string;
  outcome_ids: string[] | null;
  topic_ref: string | null;
  payload: unknown;
  /** When the server received this event (ledger_event.received_at). */
  received_at: string | Date;
  /** received_at to the millisecond: this event's place in the order of receipt. */
  order_at: string | Date;
  /** learning_session.received_at to the millisecond, the sitting's time; order_at if the sitting has no row. */
  session_at: string | Date;
  /** Received over SNAPSHOT_LAG_SECONDS ago, so the snapshot may cover it. */
  settled: boolean;
  /** The lms.item this answer was to, if the bank holds it. */
  matched: boolean;
  item_ref: string | null;
  item_misconceptions: unknown;
}

const iso = (v: string | Date): string => (v instanceof Date ? v : new Date(v)).toISOString();

/** The bank's label for a chosen option, when the item's labels are a list and it has one there. */
function bankLabel(misconceptions: unknown, chosenIndex: unknown): string | null {
  if (!Array.isArray(misconceptions) || typeof chosenIndex !== 'number' || !Number.isInteger(chosenIndex)) return null;
  const label = misconceptions[chosenIndex];
  return typeof label === 'string' && label.trim() !== '' ? label.trim() : null;
}

/**
 * An answer to a bank question, as the bank knows it: the library id as the
 * item (so one question is one item on homework and in the tutor), and on a
 * wrong answer the bank's label for the option chosen, or none.
 */
function bankPayload(r: LedgerRow): unknown {
  if (r.kind !== 'answered' || !r.matched) return r.payload;
  const p = { ...(r.payload as Record<string, unknown>) };
  if (r.item_ref) p.probeId = r.item_ref;
  delete p.misconceptionId;
  if (!p.correct) {
    const label = bankLabel(r.item_misconceptions, p.chosenIndex);
    if (label) p.misconceptionId = label;
  }
  return p;
}

const toEvent = (r: LedgerRow): LedgerEvent =>
  ({
    id: r.id,
    sessionId: r.session_id,
    seq: r.seq,
    at: iso(r.at),
    kind: r.kind,
    source: r.source,
    surface: r.surface,
    outcomeIds: r.outcome_ids ?? [],
    ...(r.topic_ref ? { topicRef: r.topic_ref } : {}),
    payload: bankPayload(r),
  }) as LedgerEvent;

/** How far behind the newest evidence the snapshot stays (see the top of this file). */
export const SNAPSHOT_LAG_SECONDS = 3600;

/**
 * One learner's ledger after `after` (all of it when null), in the order the
 * fold reads it: by when the server received each event, to the millisecond,
 * then by sitting, then by seq. Milliseconds, because the fold's cursor
 * compares times as JavaScript dates; ordering on the microseconds Postgres
 * keeps could put two batches in an order the fold then reads as going
 * backwards. `after` is a cursor in that same order (a snapshot's
 * foldedThrough).
 */
export async function readLedger(tx: Tx, user: string, after: FoldCursor | null = null): Promise<LedgerRow[]> {
  const { rows } = await tx.query<LedgerRow>(
    `select e.id, e.user_id, e.org_id, e.session_id, e.seq,
            least(greatest(e.at, e.received_at - interval '7 days'), e.received_at + interval '5 minutes') as at,
            e.kind, e.source, e.surface, e.outcome_ids, e.topic_ref, e.payload,
            e.received_at,
            date_trunc('milliseconds', e.received_at) as order_at,
            date_trunc('milliseconds', coalesce(s.received_at, e.received_at)) as session_at,
            date_trunc('milliseconds', e.received_at)
              < date_trunc('milliseconds', now() - make_interval(secs => $5)) as settled,
            (hi.id is not null or ti.id is not null) as matched,
            coalesce(hi.library_ref, ti.library_ref) as item_ref,
            coalesce(hi.misconceptions, ti.misconceptions) as item_misconceptions
       from public.ledger_event e
       -- The sitting gives the time. An event whose sitting has no row is
       -- folded at its own receipt rather than skipped and then left behind
       -- the snapshot's cursor for good.
       left join public.learning_session s on s.id = e.session_id
       -- The school's own work names its item by id; the guard keeps a
       -- malformed id from failing the cast and the whole learner with it.
       left join lms.item hi on hi.id = case
              when e.source in ('homework', 'test', 'practice')
               and e.payload ->> 'itemId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (e.payload ->> 'itemId')::uuid end
       -- The tutor names a library question by its library id.
       left join lms.item ti on ti.library_ref = case
              when e.source in ('class', 'quiz', 'diagnostic') then e.payload ->> 'probeId' end
      where e.user_id = $1
        and ($2::timestamptz is null
             or (date_trunc('milliseconds', e.received_at), e.session_id, e.seq)
                > ($2::timestamptz, $3::uuid, $4::int))
      order by date_trunc('milliseconds', e.received_at), e.session_id, e.seq`,
    [user, after?.at ?? null, after?.sessionId ?? null, after?.seq ?? null, SNAPSHOT_LAG_SECONDS],
  );
  return rows;
}

/**
 * Ledger rows in readLedger's order, folded onto `start` (from nothing by
 * default): one fold call per batch, a batch being the events of one sitting
 * the server received in the same millisecond. Each batch is placed in the
 * cursor by its receipt and timed by its sitting.
 */
export function foldLedger(
  rows: readonly LedgerRow[],
  index: GraphIndex,
  params: ModelParams,
  start: LearnerModel = emptyModel(),
): LearnerModel {
  let model = start;
  let i = 0;
  while (i < rows.length) {
    const session = rows[i].session_id;
    const orderAt = iso(rows[i].order_at);
    const startedAt = iso(rows[i].session_at);
    const events: LedgerEvent[] = [];
    while (i < rows.length && rows[i].session_id === session && iso(rows[i].order_at) === orderAt) {
      events.push(toEvent(rows[i++]));
    }
    model = foldSession(model, { id: session, startedAt, orderAt }, events, index, params);
  }
  return model;
}

/**
 * The labels of wrong ideas these answers took from the bank, added to
 * `labels`: each idea's id (normaliseMisconception) to the bank's wording, cut
 * as the fold cuts a label. The only text that is written.
 */
function bankLabels(rows: readonly LedgerRow[], labels: Map<string, string> = new Map()): Map<string, string> {
  for (const r of rows) {
    const p = bankPayload(r) as { misconceptionId?: unknown };
    if (r.kind === 'answered' && r.matched && typeof p.misconceptionId === 'string') {
      const id = normaliseMisconception(p.misconceptionId);
      if (id !== '' && !labels.has(id)) labels.set(id, p.misconceptionId.slice(0, MISCONCEPTION_LIMITS.label));
    }
  }
  return labels;
}

/** concept_state's size line on one outcome's wrong ideas (0100). */
export const MISCONCEPTIONS_MAX_BYTES = 8192;

const utf8 = new TextEncoder();

/**
 * The bytes of `value` as Postgres prints a jsonb — `octet_length(x::text)`,
 * which is what 0100's line measures. jsonb prints a space after every `:`
 * and `,`, which JSON.stringify does not; strings escape the same way.
 */
export function jsonbTextBytes(value: unknown): number {
  if (value === null || value === undefined) return 4;
  if (typeof value === 'string') return utf8.encode(JSON.stringify(value)).length;
  if (typeof value !== 'object') return utf8.encode(JSON.stringify(value)).length;
  if (Array.isArray(value)) {
    if (value.length === 0) return 2;
    return 2 + value.reduce((n: number, v) => n + jsonbTextBytes(v), 0) + 2 * (value.length - 1);
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return 2;
  return (
    2 +
    entries.reduce((n, [k, v]) => n + jsonbTextBytes(k) + 2 + jsonbTextBytes(v), 0) +
    2 * (entries.length - 1)
  );
}

/**
 * One outcome's wrong ideas as they are written: the bank's own wording where
 * the idea's label is one the bank gave (`bank`: id to wording), never the
 * label as the fold first saw it, which may be the phone's; no text
 * otherwise; and inside 0100's size line, dropping first what tells a teacher
 * least — a slip or a cleared idea before a standing confirmed one, then the
 * longest unseen, then the least shown (the order the fold itself evicts in).
 */
export function writableMisconceptions(
  ideas: Record<string, Misconception>,
  bank: ReadonlyMap<string, string>,
  maxBytes: number = MISCONCEPTIONS_MAX_BYTES,
): Record<string, Misconception> {
  const out: Record<string, Misconception> = {};
  for (const [id, m] of Object.entries(ideas ?? {})) {
    const wording = m.label === null ? undefined : bank.get(normaliseMisconception(m.label));
    out[id] = { ...m, label: wording ?? null };
  }
  if (jsonbTextBytes(out) <= maxBytes) return out;
  const order = Object.entries(out).sort(
    ([a, x], [b, y]) =>
      Number(isConfirmed(x)) - Number(isConfirmed(y)) ||
      Date.parse(x.lastAt) - Date.parse(y.lastAt) ||
      x.count - y.count ||
      (a < b ? -1 : 1),
  );
  for (const [id] of order) {
    delete out[id];
    if (jsonbTextBytes(out) <= maxBytes) break;
  }
  return out;
}

/** Every ConceptState field but its id, and the column and type it is written as. */
const COLUMNS: [Exclude<keyof ConceptState, 'outcomeId'>, string, string][] = [
  ['mastery', 'mastery', 'real'],
  ['unassistedMastery', 'unassisted_mastery', 'real'],
  ['assistedPerformance', 'assisted_performance', 'real'],
  ['observations', 'observations', 'int'],
  ['answerObservations', 'answer_observations', 'int'],
  ['unassistedObservations', 'unassisted_observations', 'int'],
  ['taughtCount', 'taught_count', 'int'],
  ['doubtCount', 'doubt_count', 'int'],
  ['lastPracticedAt', 'last_practiced_at', 'timestamptz'],
  ['lastUnassistedSuccessAt', 'last_unassisted_success_at', 'timestamptz'],
  ['masteredAt', 'mastered_at', 'timestamptz'],
  ['coldWins', 'cold_wins', 'jsonb'],
  ['box', 'box', 'smallint'],
  ['lastExposedAt', 'last_exposed_at', 'timestamptz'],
  ['lastRetrievedAt', 'last_retrieved_at', 'timestamptz'],
  ['memoryStrength', 'memory_strength', 'real'],
  ['nextReviewAt', 'next_review_at', 'timestamptz'],
  ['retrievalCount', 'retrieval_count', 'int'],
  ['retrievalAccuracy', 'retrieval_accuracy', 'real'],
  ['misconceptions', 'misconceptions', 'jsonb'],
];

const INSERT_STATES = `insert into public.concept_state (org_id, user_id, outcome_id, ${COLUMNS.map(([, c]) => c).join(', ')})
  select $1, $2, x.outcome_id, ${COLUMNS.map(([, c]) => `x.${c}`).join(', ')}
    from jsonb_to_recordset($3::jsonb) as x(outcome_id text, ${COLUMNS.map(([, c, t]) => `${c} ${t}`).join(', ')})`;

/** What learner_model.snapshot holds (0101). */
interface Snapshot {
  model: LearnerModel;
  /** Each wrong-idea label the bank gave this learner's answers: its id to the bank's wording (bankLabels). */
  bank: Record<string, string>;
}

/** A snapshot this fold can build on: present, and of this model version. */
function usableSnapshot(stored: unknown): Snapshot | null {
  const s = stored as Partial<Snapshot> | null | undefined;
  if (!s || typeof s !== 'object' || !s.model || s.model.version !== MODEL_VERSION || !s.bank || typeof s.bank !== 'object' || Array.isArray(s.bank)) {
    return null;
  }
  return s as Snapshot;
}

export interface ThinkOptions {
  index?: GraphIndex;
  params?: ModelParams;
  /** Set the snapshot aside and fold the whole ledger again. */
  rebuild?: boolean;
}

/**
 * One learner, inside a transaction the caller opened (it never opens its
 * own): lock them, read what the server received after their snapshot (the
 * whole ledger when there is none, it is of another version, or `rebuild`),
 * fold it on top, replace their concept_state and move their learner_model
 * row, snapshot included. Returns the events read; a learner with nothing new
 * is left as they were.
 */
export async function thinkLearner(tx: Tx, user: string, opts: ThinkOptions = {}): Promise<number> {
  await tx.query(`select pg_advisory_xact_lock(hashtext($1::text))`, [user]);
  const { rows: held } = await tx.query<{ snapshot: unknown }>(
    `select snapshot from public.learner_model where user_id = $1`,
    [user],
  );
  const snapshot = opts.rebuild ? null : usableSnapshot(held[0]?.snapshot);
  const rows = await readLedger(tx, user, snapshot?.model.foldedThrough ?? null);
  if (rows.length === 0) return 0;

  const index = opts.index ?? libraryIndex();
  const params = opts.params ?? emptyParams();
  // The settled rows come first: `settled` is decided on the same millisecond
  // readLedger orders by.
  const settled = rows.filter((r) => r.settled);
  const kept = foldLedger(settled, index, params, snapshot?.model ?? emptyModel());
  const keptBank = bankLabels(settled, new Map(Object.entries(snapshot?.bank ?? {})));
  const next: Snapshot | null =
    settled.length > 0 ? { model: kept, bank: Object.fromEntries([...keptBank].sort(([a], [b]) => (a < b ? -1 : 1))) } : snapshot;
  const recent = rows.slice(settled.length);
  const model = foldLedger(recent, index, params, kept);
  const bank = bankLabels(recent, new Map(keptBank));
  const last = rows[rows.length - 1];
  const states = Object.entries(model.states).map(([outcome, s]) => {
    const row: Record<string, unknown> = { outcome_id: outcome };
    for (const [field, column, type] of COLUMNS) row[column] = s[field] ?? (type === 'jsonb' ? {} : null);
    row.misconceptions = writableMisconceptions(s.misconceptions, bank);
    return row;
  });

  await tx.query(`delete from public.concept_state where user_id = $1`, [user]);
  if (states.length) await tx.query(INSERT_STATES, [last.org_id, user, JSON.stringify(states)]);
  await tx.query(
    `insert into public.learner_model (user_id, org_id, folded_through_at, folded_through_seq, version, snapshot,
                                       folded_through_received_at, folded_through_id, updated_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, now())
     on conflict (user_id) do update set
       org_id = excluded.org_id, folded_through_at = excluded.folded_through_at,
       folded_through_seq = excluded.folded_through_seq, version = excluded.version,
       snapshot = excluded.snapshot, folded_through_received_at = excluded.folded_through_received_at,
       folded_through_id = excluded.folded_through_id, updated_at = now()`,
    [
      user, last.org_id, iso(last.order_at), last.seq, MODEL_VERSION, next ? JSON.stringify(next) : null,
      last.received_at, last.id,
    ],
  );
  return rows.length;
}

/**
 * THE SETTLE PASS. think() runs straight after a hand-in, when the hand-in is
 * still inside the hour the snapshot stays behind, so concept_state holds it
 * and the snapshot does not; nothing thinks that learner again until they
 * answer again. Once the purge deletes such an answer the snapshot never
 * holds it, and the model forgets it. This thinks every learner with an
 * answer received over SNAPSHOT_LAG_SECONDS ago that their snapshot does not
 * hold (none, one of another version, or one whose cursor is behind it),
 * learners the brain never read included, so their snapshots take it.
 * It must run between an answer's first hour and the purge's cutoff.
 */
export async function settleDue(db: Sql, opts: ThinkOptions = {}): Promise<{ students: number; events: number }> {
  const { rows } = await db.query<{ user_id: string }>(SETTLE_DUE.sql, SETTLE_DUE.params());
  return think(db, rows.map((r) => r.user_id), opts);
}

/**
 * The learners the settle pass is for, as one query: `select user_id`, one
 * row each, in user order. drain.ts queueSettleDue queues the same learners.
 */
export const SETTLE_DUE = {
  sql: `select distinct e.user_id
       from public.ledger_event e
       left join public.learner_model lm on lm.user_id = e.user_id
      where date_trunc('milliseconds', e.received_at)
              < date_trunc('milliseconds', now() - make_interval(secs => $1))
        and (jsonb_typeof(lm.snapshot #> '{model,foldedThrough}') is distinct from 'object'
             or lm.snapshot #>> '{model,version}' is distinct from $2::text
             or (date_trunc('milliseconds', e.received_at), e.session_id, e.seq)
                > ((lm.snapshot #>> '{model,foldedThrough,at}')::timestamptz,
                   (lm.snapshot #>> '{model,foldedThrough,sessionId}')::uuid,
                   (lm.snapshot #>> '{model,foldedThrough,seq}')::int))
      order by e.user_id`,
  params: (): unknown[] => [SNAPSHOT_LAG_SECONDS, String(MODEL_VERSION)],
};

/** Each learner in their own transaction, one after another. */
export async function think(
  db: Sql,
  userIds: readonly string[],
  opts: ThinkOptions = {},
): Promise<{ students: number; events: number }> {
  if (userIds.length === 0) return { students: 0, events: 0 };
  const index = opts.index ?? libraryIndex();
  const params = opts.params ?? emptyParams();
  let students = 0;
  let events = 0;
  for (const user of new Set(userIds)) {
    const read = await db.transaction((tx) =>
      thinkLearner(tx, user, { index, params, rebuild: opts.rebuild }),
    );
    if (read > 0) {
      students += 1;
      events += read;
    }
  }
  return { students, events };
}
