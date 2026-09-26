import { emptyParams, type GraphIndex, type ModelParams } from '@ai-tutor/knowledge-graph';
import { MODEL_VERSION, emptyModel, foldSession, type ConceptState, type LearnerModel } from '@ai-tutor/learner-model';
import type { LedgerEvent } from '@ai-tutor/ledger';
import { libraryIndex } from './graph.ts';

/**
 * THE SERVER FOLD. Reads a child's ledger — homework from the LMS, and the
 * tutor's classes, quizzes and doubts alike — and folds it into
 * public.concept_state with packages/learner-model's foldSession: the same
 * function, the same parameters and the same graph propagation the tutor has
 * run in the browser, so there is one idea of what a child knows, not two.
 *
 * It rebuilds each child from their whole ledger rather than moving a cursor
 * forward. The fold is deterministic (replay.test.ts), so rebuilding and
 * folding onward agree; rebuilding is simply the version that cannot get the
 * cursor wrong, and at a school's scale it is cheap. learner_model still
 * records how far it read.
 *
 * Writes as the database owner or service role — concept_state has no
 * browser write policy (0013). WHERE THIS RUNS: the demo school's server,
 * after every hand-in. On the hosted project nothing runs it yet; that is
 * open work in the final plan (L6).
 */

export interface Sql {
  query<R>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

interface Row {
  id: string;
  user_id: string;
  org_id: string;
  session_id: string;
  seq: number;
  at: string | Date;
  kind: string;
  source: string;
  surface: string;
  outcome_ids: string[] | null;
  topic_ref: string | null;
  payload: unknown;
  started_at: string | Date;
}

const iso = (v: string | Date): string => (v instanceof Date ? v : new Date(v)).toISOString();

const toEvent = (r: Row): LedgerEvent =>
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
    payload: r.payload,
  }) as LedgerEvent;

/** One child's whole ledger, in the order it happened, folded from nothing. */
export function foldLedger(rows: readonly Row[], index: GraphIndex, params: ModelParams): LearnerModel {
  let model = emptyModel();
  let i = 0;
  while (i < rows.length) {
    const session = rows[i].session_id;
    const events: LedgerEvent[] = [];
    const startedAt = iso(rows[i].started_at);
    while (i < rows.length && rows[i].session_id === session) events.push(toEvent(rows[i++]));
    model = foldSession(model, { id: session, startedAt }, events, index, params);
  }
  return model;
}

const COLUMNS: [keyof ConceptState, string][] = [
  ['mastery', 'mastery'],
  ['unassistedMastery', 'unassisted_mastery'],
  ['assistedPerformance', 'assisted_performance'],
  ['observations', 'observations'],
  ['answerObservations', 'answer_observations'],
  ['unassistedObservations', 'unassisted_observations'],
  ['taughtCount', 'taught_count'],
  ['doubtCount', 'doubt_count'],
  ['lastPracticedAt', 'last_practiced_at'],
  ['lastUnassistedSuccessAt', 'last_unassisted_success_at'],
  ['memoryStrength', 'memory_strength'],
  ['nextReviewAt', 'next_review_at'],
  ['retrievalCount', 'retrieval_count'],
  ['retrievalAccuracy', 'retrieval_accuracy'],
];

export async function think(
  db: Sql,
  userIds: readonly string[],
  opts: { index?: GraphIndex; params?: ModelParams } = {},
): Promise<{ students: number; events: number }> {
  if (userIds.length === 0) return { students: 0, events: 0 };
  const index = opts.index ?? libraryIndex();
  const params = opts.params ?? emptyParams();
  const { rows } = await db.query<Row>(
    `select e.id, e.user_id, e.org_id, e.session_id, e.seq, e.at, e.kind, e.source, e.surface,
            e.outcome_ids, e.topic_ref, e.payload, s.started_at
       from public.ledger_event e
       join public.learning_session s on s.id = e.session_id
      where e.user_id = any($1::uuid[])
      order by e.user_id, s.started_at, e.session_id, e.seq`,
    [userIds],
  );

  let students = 0;
  let i = 0;
  while (i < rows.length) {
    const user = rows[i].user_id;
    const mine: Row[] = [];
    while (i < rows.length && rows[i].user_id === user) mine.push(rows[i++]);
    const model = foldLedger(mine, index, params);
    const last = mine[mine.length - 1];
    const states = Object.entries(model.states).map(([outcome, s]) => {
      const row: Record<string, unknown> = { outcome_id: outcome };
      for (const [field, column] of COLUMNS) row[column] = s[field] ?? null;
      return row;
    });

    await db.query(`delete from public.concept_state where user_id = $1`, [user]);
    if (states.length) {
      await db.query(
        `insert into public.concept_state
           (org_id, user_id, outcome_id, mastery, unassisted_mastery, assisted_performance, observations,
            answer_observations, unassisted_observations, taught_count, doubt_count, last_practiced_at,
            last_unassisted_success_at, memory_strength, next_review_at, retrieval_count, retrieval_accuracy)
         select $1, $2, x.outcome_id, x.mastery, x.unassisted_mastery, x.assisted_performance, x.observations,
                x.answer_observations, x.unassisted_observations, x.taught_count, x.doubt_count, x.last_practiced_at,
                x.last_unassisted_success_at, x.memory_strength, x.next_review_at, x.retrieval_count, x.retrieval_accuracy
           from jsonb_to_recordset($3::jsonb) as x(
             outcome_id text, mastery real, unassisted_mastery real, assisted_performance real, observations int,
             answer_observations int, unassisted_observations int, taught_count int, doubt_count int,
             last_practiced_at timestamptz, last_unassisted_success_at timestamptz, memory_strength real,
             next_review_at timestamptz, retrieval_count int, retrieval_accuracy real)`,
        [last.org_id, user, JSON.stringify(states)],
      );
    }
    await db.query(
      `insert into public.learner_model (user_id, org_id, folded_through_at, folded_through_seq, version, updated_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (user_id) do update set
         org_id = excluded.org_id, folded_through_at = excluded.folded_through_at,
         folded_through_seq = excluded.folded_through_seq, version = excluded.version, updated_at = now()`,
      [user, last.org_id, iso(last.started_at), last.seq, MODEL_VERSION],
    );
    students += 1;
  }
  return { students, events: rows.length };
}
