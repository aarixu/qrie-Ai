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
  /** Outcomes the rebuild produced that the stored model never had, and vice versa. */
  onlyStored: string[];
  onlyRebuilt: string[];
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

/** Every number a ConceptState holds, so a diff cannot quietly skip one. */
const FIELDS: readonly (keyof ConceptState)[] = [
  'mastery',
  'unassistedMastery',
  'assistedPerformance',
  'observations',
  'unassistedObservations',
  'taughtCount',
  'doubtCount',
  'lastPracticedAt',
  'lastUnassistedSuccessAt',
];

/** Floats do not survive a round trip through Postgres `real` exactly. */
const same = (a: unknown, b: unknown): boolean => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  return (a ?? null) === (b ?? null);
};

export async function rebuildFromLedger(stored: LearnerModel): Promise<Rebuild | string> {
  const db = supabase();
  if (!db) return 'No cloud configured — there is no ledger to rebuild from.';

  const index = currentIndex();
  if (!index) return 'No map loaded for this student, so there is nothing to fold against.';

  const { data: sessionRows, error: sErr } = await db
    .from('learning_session')
    .select('id, started_at')
    .order('started_at', { ascending: true });
  if (sErr) return `Could not read sessions: ${sErr.message}`;

  const { data: eventRows, error: eErr } = await db
    .from('ledger_event')
    .select('id, session_id, seq, at, kind, source, surface, outcome_ids, topic_ref, payload')
    .order('seq', { ascending: true });
  if (eErr) return `Could not read events: ${eErr.message}`;

  const sessions = (sessionRows ?? []) as SessionRow[];
  const events = (eventRows ?? []) as EventRow[];

  const bySession = new Map<string, LedgerEvent[]>();
  for (const row of events) {
    const list = bySession.get(row.session_id) ?? [];
    list.push(toEvent(row));
    bySession.set(row.session_id, list);
  }

  const params = currentParams();
  let model = emptyModel();
  for (const session of sessions) {
    const own = bySession.get(session.id);
    if (!own || own.length === 0) continue;
    own.sort((a, b) => a.seq - b.seq);
    model = foldSession(model, { id: session.id, startedAt: session.started_at }, own, index, params);
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
    onlyStored: [...storedIds].filter((id) => !rebuiltIds.has(id)),
    onlyRebuilt: [...rebuiltIds].filter((id) => !storedIds.has(id)),
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
