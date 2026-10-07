import { emptyParams, type GraphIndex, type ModelParams } from '@ai-tutor/knowledge-graph';
import {
  MODEL_VERSION,
  emptyModel,
  foldSession,
  isConfirmed,
  normaliseMisconception,
  type ConceptState,
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
 * Every field of the fold's ConceptState is written (0060).
 *
 * It rebuilds each child from their whole ledger rather than moving a cursor
 * forward. The fold is deterministic (replay.test.ts), so rebuilding and
 * folding onward agree; rebuilding is simply the version that cannot get the
 * cursor wrong, and at a school's scale it is cheap. learner_model still
 * records how far it read.
 *
 * THE SERVER'S CLOCK (review MF3). A sitting is ordered and timed by its
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
 * browser write policy (0013). WHERE THIS RUNS: the demo school's server,
 * after every hand-in. On the hosted project nothing runs it yet; that is
 * open work in the final plan (L6).
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
  /** learning_session.received_at, to the millisecond: the sitting's time. */
  session_at: string | Date;
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

/**
 * One learner's ledger, in the order the fold reads it: sittings by when the
 * server received them, then by id, then events by seq. Milliseconds, because
 * the fold's cursor compares sitting times as JavaScript dates; ordering on
 * the microseconds Postgres keeps could put two sittings in an order the fold
 * then reads as going backwards.
 */
export async function readLedger(tx: Tx, user: string): Promise<LedgerRow[]> {
  const { rows } = await tx.query<LedgerRow>(
    `select e.id, e.user_id, e.org_id, e.session_id, e.seq,
            least(greatest(e.at, e.received_at - interval '7 days'), e.received_at + interval '5 minutes') as at,
            e.kind, e.source, e.surface, e.outcome_ids, e.topic_ref, e.payload,
            date_trunc('milliseconds', s.received_at) as session_at,
            (hi.id is not null or ti.id is not null) as matched,
            coalesce(hi.library_ref, ti.library_ref) as item_ref,
            coalesce(hi.misconceptions, ti.misconceptions) as item_misconceptions
       from public.ledger_event e
       join public.learning_session s on s.id = e.session_id
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
      order by date_trunc('milliseconds', s.received_at), e.session_id, e.seq`,
    [user],
  );
  return rows;
}

/** One child's whole ledger, in the order the server received it, folded from nothing. */
export function foldLedger(rows: readonly LedgerRow[], index: GraphIndex, params: ModelParams): LearnerModel {
  let model = emptyModel();
  let i = 0;
  while (i < rows.length) {
    const session = rows[i].session_id;
    const events: LedgerEvent[] = [];
    const startedAt = iso(rows[i].session_at);
    while (i < rows.length && rows[i].session_id === session) events.push(toEvent(rows[i++]));
    model = foldSession(model, { id: session, startedAt }, events, index, params);
  }
  return model;
}

/** The labels of wrong ideas this learner's answers took from the bank: the only text that is written. */
function bankLabels(rows: readonly LedgerRow[]): Set<string> {
  const labels = new Set<string>();
  for (const r of rows) {
    const p = bankPayload(r) as { misconceptionId?: unknown };
    if (r.kind === 'answered' && r.matched && typeof p.misconceptionId === 'string') {
      labels.add(normaliseMisconception(p.misconceptionId));
    }
  }
  return labels;
}

/** concept_state's size line on one outcome's wrong ideas (0060). */
export const MISCONCEPTIONS_MAX_BYTES = 8192;

const utf8 = new TextEncoder();

/**
 * The bytes of `value` as Postgres prints a jsonb — `octet_length(x::text)`,
 * which is what 0060's line measures. jsonb prints a space after every `:`
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
 * One outcome's wrong ideas as they are written: text only where the bank
 * gave it, and inside 0060's size line, dropping first what tells a teacher
 * least — a slip or a cleared idea before a standing confirmed one, then the
 * longest unseen, then the least shown (the order the fold itself evicts in).
 */
export function writableMisconceptions(
  ideas: Record<string, Misconception>,
  bank: ReadonlySet<string>,
  maxBytes: number = MISCONCEPTIONS_MAX_BYTES,
): Record<string, Misconception> {
  const out: Record<string, Misconception> = {};
  for (const [id, m] of Object.entries(ideas ?? {})) {
    out[id] = m.label !== null && bank.has(normaliseMisconception(m.label)) ? m : { ...m, label: null };
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

/**
 * One learner, inside a transaction the caller opened (it never opens its
 * own): lock them, read their ledger, fold it, replace their concept_state
 * and move their learner_model row. Returns the events read; a learner with
 * none is left as they were.
 */
export async function thinkLearner(
  tx: Tx,
  user: string,
  opts: { index?: GraphIndex; params?: ModelParams } = {},
): Promise<number> {
  await tx.query(`select pg_advisory_xact_lock(hashtext($1::text))`, [user]);
  const rows = await readLedger(tx, user);
  if (rows.length === 0) return 0;
  const model = foldLedger(rows, opts.index ?? libraryIndex(), opts.params ?? emptyParams());
  const bank = bankLabels(rows);
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
    `insert into public.learner_model (user_id, org_id, folded_through_at, folded_through_seq, version, updated_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (user_id) do update set
       org_id = excluded.org_id, folded_through_at = excluded.folded_through_at,
       folded_through_seq = excluded.folded_through_seq, version = excluded.version, updated_at = now()`,
    [user, last.org_id, iso(last.session_at), last.seq, MODEL_VERSION],
  );
  return rows.length;
}

/** Each learner in their own transaction, one after another. */
export async function think(
  db: Sql,
  userIds: readonly string[],
  opts: { index?: GraphIndex; params?: ModelParams } = {},
): Promise<{ students: number; events: number }> {
  if (userIds.length === 0) return { students: 0, events: 0 };
  const index = opts.index ?? libraryIndex();
  const params = opts.params ?? emptyParams();
  let students = 0;
  let events = 0;
  for (const user of new Set(userIds)) {
    const read = await db.transaction((tx) => thinkLearner(tx, user, { index, params }));
    if (read > 0) {
      students += 1;
      events += read;
    }
  }
  return { students, events };
}
