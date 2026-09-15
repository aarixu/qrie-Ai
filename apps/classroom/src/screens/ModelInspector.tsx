import { useCallback, useMemo, useState } from 'react';
import type { ConceptState } from '@ai-tutor/learner-model';
import type { LedgerEvent } from '@ai-tutor/ledger';
import { loadModel, unfoldedCount } from '../lib/learnerModel';
import { evidenceFor, rebuildFromLedger, type Rebuild } from '../lib/rebuildModel';

/**
 * WHAT THE MODEL ACTUALLY LEARNED — Aarav's tool, not a product surface.
 *
 * His decision, 2026-09-14: he wants to see whether the model is learning
 * before anything is shown to a student. So this shows the numbers plainly,
 * including the ones that are unflattering, and it never tries to explain them
 * away.
 *
 * Routed only under `import.meta.env.DEV`, beside the other benches, so it is
 * dropped from a production bundle rather than merely hidden — a store reviewer
 * can reach any route that exists.
 *
 * The rebuild is the part that matters. Anything else here is a table; that
 * button is the claim the whole phase rests on, checked against real rows.
 */

const pct = (n: number): string => `${(n * 100).toFixed(0)}%`;
const when = (iso: string | null): string => (iso ? iso.slice(0, 16).replace('T', ' ') : '—');

export function ModelInspector() {
  const [model, setModel] = useState(() => loadModel());
  const [open, setOpen] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<LedgerEvent[] | string | null>(null);
  const [rebuild, setRebuild] = useState<Rebuild | string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Weakest UNASSISTED first, and only outcomes something has actually
   * examined. An outcome at the prior with nothing behind it is not a finding,
   * and listing it first would be the 0.46 defect as a screen.
   */
  const rows = useMemo(
    () =>
      Object.values(model.states)
        .filter((s) => s.observations > 0)
        .sort((a, b) => a.unassistedMastery - b.unassistedMastery),
    [model],
  );

  const examine = useCallback(async (id: string) => {
    if (open === id) {
      setOpen(null);
      return;
    }
    setOpen(id);
    setEvidence(null);
    setEvidence(await evidenceFor(id));
  }, [open]);

  const check = useCallback(async () => {
    setBusy(true);
    setRebuild(await rebuildFromLedger(loadModel()));
    setBusy(false);
  }, []);

  return (
    <main style={S.page}>
      <header style={S.head}>
        <strong style={{ fontSize: 15 }}>The learner model</strong>
        <span style={S.muted}>
          {rows.length} outcomes with evidence · folded through{' '}
          {model.foldedThrough
            ? `${when(model.foldedThrough.at)} seq ${model.foldedThrough.seq}`
            : 'nothing yet'}{' '}
          · v{model.version}
        </span>
      </header>

      <div style={S.controls}>
        <button style={S.button} onClick={check} disabled={busy}>
          {busy ? 'Rebuilding…' : 'Rebuild from the ledger'}
        </button>
        <button style={S.button} onClick={() => setModel(loadModel())}>
          Reload
        </button>
        <span style={S.muted}>
          The rebuild folds every event on the server from zero and diffs it against what is
          stored here. Disagreement means the model is not reproducible from its own evidence.
        </span>
      </div>

      {/*
        SAID BEFORE THE REBUILD, NOT AFTER IT. Events this device recorded and
        never folded are the commonest reason a rebuild disagrees, and without
        this line the report below blames the ledger for it — "belief exists
        here that no surviving event accounts for" — about a model that is
        simply behind.
      */}
      {unfoldedCount() > 0 && (
        <p style={S.bad}>
          This device recorded {unfoldedCount()} event(s) it never folded — no class was set, or
          the map would not load. They are on their way to the server, so the belief is not lost;
          this copy is behind, and the rebuild below will say so. That is the model&apos;s fault,
          not the ledger&apos;s.
        </p>
      )}

      {rebuild !== null && <RebuildReport rebuild={rebuild} />}

      {rows.length === 0 ? (
        <p style={S.muted}>
          Nothing has been examined yet. Take a class, a quiz or the placement test and come
          back — belief only moves on evidence, which is the point.
        </p>
      ) : (
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>outcome</th>
              <th style={S.thn} title="Rung 0 only — the number that means they can do it alone">
                unassisted
              </th>
              <th style={S.thn} title="All evidence, assisted or not">
                mastery
              </th>
              <th style={S.thn} title="How they do WITH help">
                assisted
              </th>
              <th style={S.thn}>obs</th>
              <th style={S.thn} title="Rung-0 answers only">
                cold
              </th>
              <th style={S.thn} title="Times taught">
                taught
              </th>
              <th style={S.thn} title="Hands raised — moves belief, never makes it a gap">
                hands
              </th>
              <th style={S.th}>last practised</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <Row
                key={s.outcomeId}
                state={s}
                open={open === s.outcomeId}
                evidence={open === s.outcomeId ? evidence : null}
                onClick={() => void examine(s.outcomeId)}
              />
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

function Row({
  state,
  open,
  evidence,
  onClick,
}: {
  state: ConceptState;
  open: boolean;
  evidence: LedgerEvent[] | string | null;
  onClick: () => void;
}) {
  return (
    <>
      <tr onClick={onClick} style={{ cursor: 'pointer', background: open ? '#f3f4f6' : undefined }}>
        <td style={S.td}>{state.outcomeId}</td>
        {/*
          Shown as "—" rather than a percentage when nothing cold has ever been
          asked. The number is the prior in that case, and printing it would
          invite the reader to treat a prior as a measurement — which is exactly
          the mistake the model exists to stop making.
        */}
        <td style={S.tdn}>
          {state.unassistedObservations === 0 ? (
            <span style={S.muted} title="never asked cold">
              —
            </span>
          ) : (
            pct(state.unassistedMastery)
          )}
        </td>
        <td style={S.tdn}>{pct(state.mastery)}</td>
        <td style={S.tdn}>
          {state.unassistedObservations === state.observations ? (
            <span style={S.muted}>—</span>
          ) : (
            pct(state.assistedPerformance)
          )}
        </td>
        <td style={S.tdn}>{state.observations}</td>
        <td style={S.tdn}>{state.unassistedObservations}</td>
        <td style={S.tdn}>{state.taughtCount}</td>
        <td style={S.tdn}>{state.doubtCount}</td>
        <td style={S.td}>{when(state.lastPracticedAt)}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={9} style={S.evidence}>
            {evidence === null && <span style={S.muted}>reading the ledger…</span>}
            {typeof evidence === 'string' && <span style={S.bad}>{evidence}</span>}
            {Array.isArray(evidence) &&
              (evidence.length === 0 ? (
                <span style={S.muted}>
                  No rows on the server speak about this outcome. Either the drain has not run,
                  or this belief came entirely from propagation — which is not evidence about
                  this outcome, only about its neighbours.
                </span>
              ) : (
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  {evidence.map((e) => (
                    <li key={e.id} style={{ marginBottom: 2 }}>
                      <code>{e.kind}</code> · {e.source} · seq {e.seq} · {when(e.at)} ·{' '}
                      <code style={S.payload}>{JSON.stringify(e.payload)}</code>
                    </li>
                  ))}
                </ol>
              ))}
          </td>
        </tr>
      )}
    </>
  );
}

function RebuildReport({ rebuild }: { rebuild: Rebuild | string }) {
  if (typeof rebuild === 'string') return <p style={S.bad}>{rebuild}</p>;

  const clean =
    rebuild.diffs.length === 0 && rebuild.onlyStored.length === 0 && rebuild.onlyRebuilt.length === 0;

  return (
    <div style={{ ...S.report, borderColor: clean ? '#16a34a' : '#dc2626' }}>
      <strong>
        {clean ? 'Reproducible.' : `${rebuild.diffs.length} disagreements.`}{' '}
      </strong>
      <span style={S.muted}>
        {rebuild.events} events across {rebuild.sessions} sittings, folded from zero.
      </span>
      {rebuild.orphanedEvents > 0 && (
        <p style={S.bad}>
          {rebuild.orphanedEvents} event(s) on the server have no sitting row to be folded
          against, so nothing could read them. That is a gap in the LEDGER, not in the model —
          a session upsert failed while its answers landed anyway.
        </p>
      )}
      {!clean && (
        <>
          {rebuild.onlyStored.length > 0 && (
            <p style={S.bad}>
              {rebuild.onlyStored.length} outcomes are in the stored model and NOT in the
              rebuild. That means belief exists here that no surviving event accounts for —
              either the ledger was purged at 90 days, or something wrote belief that should
              not have: {rebuild.onlyStored.slice(0, 5).join(', ')}
            </p>
          )}
          {rebuild.onlyRebuilt.length > 0 && (
            <p style={S.bad}>
              {rebuild.onlyRebuilt.length} outcomes are in the rebuild and NOT stored here —
              evidence this device never folded: {rebuild.onlyRebuilt.slice(0, 5).join(', ')}
            </p>
          )}
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>outcome</th>
                <th style={S.th}>field</th>
                <th style={S.thn}>stored</th>
                <th style={S.thn}>rebuilt</th>
              </tr>
            </thead>
            <tbody>
              {rebuild.diffs.slice(0, 40).map((d, i) => (
                <tr key={`${d.outcomeId}:${d.field}:${i}`}>
                  <td style={S.td}>{d.outcomeId}</td>
                  <td style={S.td}>{d.field}</td>
                  <td style={S.tdn}>{String(d.stored)}</td>
                  <td style={S.tdn}>{String(d.rebuilt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { padding: 16, fontFamily: 'system-ui, sans-serif', fontSize: 13, color: '#111' },
  head: { display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 12 },
  muted: { color: '#6b7280', fontSize: 12 },
  bad: { color: '#b91c1c', fontSize: 12, display: 'block', marginTop: 6 },
  controls: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 },
  button: {
    padding: '6px 12px',
    borderRadius: 6,
    border: '1px solid #d1d5db',
    background: '#fff',
    cursor: 'pointer',
    fontSize: 13,
  },
  report: { border: '1px solid', borderRadius: 8, padding: 10, marginBottom: 14 },
  table: { borderCollapse: 'collapse', width: '100%', marginTop: 8 },
  th: { textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #e5e7eb', fontWeight: 600 },
  thn: { textAlign: 'right', padding: '4px 8px', borderBottom: '1px solid #e5e7eb', fontWeight: 600 },
  td: { padding: '3px 8px', borderBottom: '1px solid #f3f4f6' },
  tdn: { padding: '3px 8px', borderBottom: '1px solid #f3f4f6', textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  evidence: { padding: '6px 8px 10px 20px', background: '#f9fafb', fontSize: 12 },
  payload: { color: '#6b7280', fontSize: 11 },
};
