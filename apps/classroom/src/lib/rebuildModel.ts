import {
  emptyModel,
  foldSession,
  type ConceptState,
  type LearnerModel,
} from '@ai-tutor/learner-model';
import type { LedgerEvent } from '@ai-tutor/ledger';
import { currentIndex, currentParams } from './graphContext';
import { supabase } from './supabase';

/**
 * REBUILD THE MODEL FROM THE LEDGER, AND SAY WHERE IT DISAGREES.
 *
 * This is the check the plan calls replay, run against real rows rather than a
 * fixture: a model that cannot be rebuilt from its own evidence is a cache
 * nobody can audit, and every phase after this one reads it as ground truth.
 *
 * It reads the SERVER's ledger, not the device's outbox. The outbox deletes
 * acknowledged events, so the device cannot replay its own history — which is
 * why `concept_state` is written by the server in the first place. RLS lets a
 * student select their own rows and nobody else's, so this needs no special
 * access and proves the same thing a support tool would.
 *
 * The order is `(learning_session.started_at, seq)`, the same total order
 * `foldSession` documents, so a rebuild here and a rebuild in the Edge Function
 * are the same computation on the same input.
 */

/**
 * One page. Asked for with one extra row so a full page can be told from a
 * truncated one — the check that matters, since a silent truncation here looks
 * exactly like a broken model.
 */
const PAGE = 1000;

export interface FieldDiff {
  outcomeId: string;
  field: string;
  stored: number | string | null;
  rebuilt: number | string | null;
}

export interface Rebuild {
  model: LearnerModel;
  sessions: number;
  events: number;
  /** Where the stored model and the rebuild disagree. Empty is the good case. */
  diffs: FieldDiff[];
  /** Events on the server whose sitting row is missing, so nothing folded them. */
  orphanedEvents: number;
  /** Outcomes the rebuild produced that the stored model never had, and vice versa. */
  onlyStored: string[];
  onlyRebuilt: string[];
  /**
   * The folded events, in the (started_at, seq) order they were folded — what
   * the 3.7 projections (assistance score, hint abuse, wheel-spinning) read.
   * The same rows as the fold, never a second query that could drift from it;
   * orphans are excluded here exactly as they were excluded there.
   */
  ledger: LedgerEvent[];
}

interface SessionRow {
  id: string;
  started_at: string;
}

interface EventRow {
  id: string;
  session_id: string;
  seq: number;
  at: string;
  kind: string;
  source: string;
  surface: string;
  outcome_ids: string[];
  topic_ref: string | null;
  payload: unknown;
}

/** Postgres speaks snake_case; the package speaks the ledger's own shape. */
const toEvent = (row: EventRow): LedgerEvent =>
  ({
    id: row.id,
    sessionId: row.session_id,
    seq: row.seq,
    at: row.at,
    kind: row.kind,
    source: row.source,
    surface: row.surface,
    outcomeIds: row.outcome_ids ?? [],
    ...(row.topic_ref ? { topicRef: row.topic_ref } : {}),
    payload: row.payload,
  }) as LedgerEvent;

/**
 * Every number a ConceptState holds, so a diff cannot quietly skip one. This
 * list broke its own promise once: it shipped without `answerObservations` —
 * the field `evidenceSet` gates the study plan on, and so the ONE divergence
 * this tool most exists to catch (2026-09-16 audit). The review ladder's
 * fields (F1-F3: box, the exposure and retrieval dates, nextReviewAt and the
 * retrieval counts) are driven since MODEL_VERSION 3 and compared like any
 * other, and so is `masteredAt` (a date, compared as text like the ladder's
 * dates); `memoryStrength` is still undriven and costs one comparison of a
 * default against a default. `coldWins` and `misconceptions` (v4) are records
 * and are not compared here.
 */
const FIELDS: readonly (keyof ConceptState)[] = [
  'mastery',
  'unassistedMastery',
  'assistedPerformance',
  'observations',
  'answerObservations',
  'unassistedObservations',
  'taughtCount',
  'doubtCount',
  'lastPracticedAt',
  'lastUnassistedSuccessAt',
  'masteredAt',
  'box',
  'lastExposedAt',
  'lastRetrievedAt',
  'memoryStrength',
  'nextReviewAt',
  'retrievalCount',
  'retrievalAccuracy',
];

/**
 * Both sides are doubles computed locally, so this tolerance is for accumulated
 * float error and nothing else. If `concept_state` is ever read here instead,
 * 1e-9 is roughly ten times too tight for a Postgres `real` and every row would
 * read as a disagreement.
 */
const same = (a: unknown, b: unknown): boolean => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  return (a ?? null) === (b ?? null);
};

export async function rebuildFromLedger(stored: LearnerModel): Promise<Rebuild | string> {
  const db = supabase();
  if (!db) return 'No cloud configured — there is no ledger to rebuild from.';

  const index = currentIndex();
  if (!index) return 'No map loaded for this student, so there is nothing to fold against.';

  /**
   * A CAPPED READ WOULD BE WORSE THAN A SHORT ONE, so it is refused rather than
   * folded.
   *
   * PostgREST caps a response server-side. This query orders by `seq`, which
   * restarts at 0 for every session — so a capped page is the first few events
   * of EVERY sitting, not the first N in time. Folding that would drop every
   * session's tail and then report the difference as the model's fault, which
   * is the one thing this tool must never do: it exists to be believed.
   */
  const { data: sessionRows, error: sErr } = await db
    .from('learning_session')
    .select('id, started_at')
    .order('started_at', { ascending: true })
    .limit(PAGE + 1);
  if (sErr) return `Could not read sessions: ${sErr.message}`;
  if ((sessionRows?.length ?? 0) > PAGE) {
    return `More than ${PAGE} sittings. This tool reads one page and will not fold a partial history.`;
  }

  const { data: eventRows, error: eErr } = await db
    .from('ledger_event')
    .select('id, session_id, seq, at, kind, source, surface, outcome_ids, topic_ref, payload')
    .order('seq', { ascending: true })
    .limit(PAGE + 1);
  if (eErr) return `Could not read events: ${eErr.message}`;
  if ((eventRows?.length ?? 0) > PAGE) {
    return `More than ${PAGE} events. This tool reads one page and will not fold a partial history.`;
  }

  const sessions = (sessionRows ?? []) as SessionRow[];
  const events = (eventRows ?? []) as EventRow[];

  const bySession = new Map<string, LedgerEvent[]>();
  for (const row of events) {
    const list = bySession.get(row.session_id) ?? [];
    list.push(toEvent(row));
    bySession.set(row.session_id, list);
  }

  /**
   * EVENTS WHOSE SITTING IS MISSING ARE COUNTED, NOT DROPPED.
   *
   * `ledger_event.session_id` has no foreign key (0006 says why: rows arrive
   * out of order from an offline outbox and must never be refused for it), and
   * before record_evidence (0067) `ledgerSync` held back only the
   * `session-started` event when a session upsert failed — the answers in that
   * same batch were acknowledged and landed anyway. record_evidence now makes
   * the sitting with the first event that needs it, but rows written the old
   * way are still in the ledger. So real evidence can exist with no sitting to
   * fold it against, and silently skipping it would show up below as the
   * model's fault.
   */
  const known = new Set(sessions.map((row) => row.id));
  const orphanedEvents = events.filter((row) => !known.has(row.session_id)).length;

  const params = currentParams();
  let model = emptyModel();
  const folded: LedgerEvent[] = [];
  for (const session of sessions) {
    const own = bySession.get(session.id);
    if (!own || own.length === 0) continue;
    own.sort((a, b) => a.seq - b.seq);
    model = foldSession(model, { id: session.id, startedAt: session.started_at }, own, index, params);
    folded.push(...own);
  }

  const diffs: FieldDiff[] = [];
  for (const [id, rebuilt] of Object.entries(model.states)) {
    const was = stored.states[id];
    if (!was) continue;
    for (const field of FIELDS) {
      if (!same(was[field], rebuilt[field])) {
        diffs.push({
          outcomeId: id,
          field: String(field),
          stored: (was[field] ?? null) as number | string | null,
          rebuilt: (rebuilt[field] ?? null) as number | string | null,
        });
      }
    }
  }

  const storedIds = new Set(Object.keys(stored.states));
  const rebuiltIds = new Set(Object.keys(model.states));
  return {
    model,
    sessions: sessions.length,
    events: events.length,
    diffs,
    orphanedEvents,
    onlyStored: [...storedIds].filter((id) => !rebuiltIds.has(id)),
    onlyRebuilt: [...rebuiltIds].filter((id) => !storedIds.has(id)),
    ledger: folded,
  };
}

/** The ledger rows that speak about one outcome. What the GIN index is for. */
export async function evidenceFor(outcomeId: string): Promise<LedgerEvent[] | string> {
  const db = supabase();
  if (!db) return 'No cloud configured.';
  const { data, error } = await db
    .from('ledger_event')
    .select('id, session_id, seq, at, kind, source, surface, outcome_ids, topic_ref, payload')
    .contains('outcome_ids', [outcomeId])
    .order('at', { ascending: false })
    .limit(50);
  if (error) return `Could not read evidence: ${error.message}`;
  return ((data ?? []) as EventRow[]).map(toEvent);
}
