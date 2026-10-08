import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Lesson } from '@ai-tutor/lesson-format';
import { CreditsList, Scene, computeVisible } from '@ai-tutor/stage';
import { usePlayer, createBrowserTts } from '@ai-tutor/player';
import type { PrepProgress, PrepReport } from '@ai-tutor/class-prep';
import { prepareLiveClass } from '../lib/liveClass';
import { toolkitDemoLesson } from '../lib/toolkitDemo';
import { composerDemoLesson } from '../lib/composerDemo';

export function CanvasLab() {
  const [topic, setTopic] = useState('Speed: distance divided by time');
  const [klass, setKlass] = useState(9);
  const [minutes, setMinutes] = useState(2);
  /** Prepare for the composed board (board composer): on here, where real composed classes are measured. */
  const [composed, setComposed] = useState(true);

  const [progress, setProgress] = useState<PrepProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<{
    lesson: Lesson;
    assets: Record<string, string>;
    report: PrepReport;
  } | null>(null);
  /** The toolkit on one board, assembled here with no model call. */
  const [demo, setDemo] = useState<ReturnType<typeof toolkitDemoLesson> | null>(null);
  /** The composed board on three pages, assembled here with no model call. */
  const [composedDemo, setComposedDemo] = useState<ReturnType<typeof composerDemoLesson> | null>(null);

  const run = useCallback(async () => {
    setError(null);
    setPrepared(null);
    setDemo(null);
    setComposedDemo(null);
    setProgress({ phase: 'planning', message: 'Starting…', done: 0 });
    try {
      setPrepared(await prepareLiveClass({ topic, klass, minutes, composed }, setProgress));
    } catch (e) {
      // The whole error, stack included: this is the lab, and a message alone
      // ("cannot read trim") names no file.
      console.error('[canvas-lab] preparation failed', e);
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    }
  }, [topic, klass, minutes, composed]);

  return (
    <main style={S.page}>
      <header style={S.head}>
        <strong style={{ fontSize: 15 }}>Canvas lab</strong>
        <span style={S.muted}>the board on its own — prepared live, nothing pre-made</span>
      </header>

      <div style={S.controls}>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Any topic"
          style={{ ...S.input, flex: 1 }}
        />
        <label style={S.muted}>
          Class{' '}
          <input
            type="number"
            min={6}
            max={12}
            value={klass}
            onChange={(e) => setKlass(Number(e.target.value))}
            style={{ ...S.input, width: 56 }}
          />
        </label>
        <label style={S.muted}>
          Minutes{' '}
          <input
            type="number"
            min={1}
            max={6}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            style={{ ...S.input, width: 56 }}
          />
        </label>
        <label style={S.muted}>
          <input type="checkbox" checked={composed} onChange={(e) => setComposed(e.target.checked)} /> Composed board
        </label>
        <button onClick={run} disabled={progress !== null && progress.phase !== 'done'} style={S.primary}>
          {progress && progress.phase !== 'done' ? 'Preparing…' : 'Prepare the class'}
        </button>
        <button
          onClick={() => {
            setPrepared(null);
            setComposedDemo(null);
            setDemo(toolkitDemoLesson());
          }}
          style={S.button}
        >
          Toolkit demo (₹0)
        </button>
        <button
          onClick={() => {
            setPrepared(null);
            setDemo(null);
            setComposedDemo(composerDemoLesson());
          }}
          style={S.button}
        >
          Composer demo (₹0)
        </button>
      </div>

      {progress && progress.phase !== 'done' && <Preparing progress={progress} />}
      {error && <p style={S.error}>{error}</p>}

      {prepared && (
        <>
          <Board lesson={prepared.lesson} assets={prepared.assets} />
          <Report report={prepared.report} lesson={prepared.lesson} />
        </>
      )}
      {demo && (
        <>
          <Board lesson={demo.lesson} assets={{}} />
          <p style={S.muted}>
            Gate: {demo.problems.length === 0 ? 'no problems' : demo.problems.map((p) => `${p.rule}@${p.where}`).join(', ')}
          </p>
        </>
      )}
      {composedDemo && (
        <>
          <Board lesson={composedDemo.lesson} assets={composedDemo.assets} />
          <p style={S.muted}>
            Pages: {composedDemo.pages.map((p) => `${p.plannerBeat} ${Math.round(p.coverage * 100)}%`).join(' · ')} · Gate:{' '}
            {composedDemo.problems.length === 0
              ? 'no problems'
              : composedDemo.problems.map((p) => `${p.rule}@${p.where}`).join(', ')}
          </p>
        </>
      )}
    </main>
  );
}

function Preparing({ progress }: { progress: PrepProgress }) {
  return (
    <div style={S.prep}>
      <div style={S.track}>
        <div style={{ ...S.fill, width: `${Math.round(progress.done * 100)}%` }} />
      </div>
      <span style={S.muted}>{progress.message}</span>
    </div>
  );
}

/** The board and its controls, for a class already prepared — the lab's, or one played from a file (viewer). */
export function Board({ lesson, assets }: { lesson: Lesson; assets: Record<string, string> }) {
  // Browser speech: the voice does not matter here, only that the board waits
  // for it the way it will wait for a real one.
  const tts = useMemo(() => createBrowserTts({ lang: 'en-IN' }), []);
  const player = usePlayer(lesson, tts);
  const canvas = computeVisible(lesson, player.beatIndex);
  const beat = lesson.beats[player.beatIndex];

  // Leaving the lab must silence the tutor.
  const pauseRef = useRef(player.pause);
  pauseRef.current = player.pause;
  useEffect(() => () => pauseRef.current(), []);

  return (
    <>
      <div style={S.board}>
        <Scene lesson={lesson} visible={canvas.visible} focus={canvas.focus} frame={canvas.frame} assets={assets} />
      </div>

      <div style={S.controls}>
        <button onClick={player.state === 'playing' ? player.pause : player.play} style={S.primary}>
          {player.state === 'playing' ? 'Pause' : player.state === 'ended' ? 'Replay' : 'Play'}
        </button>
        <button onClick={() => player.seek(player.beatIndex - 1)} style={S.button}>
          ◀
        </button>
        <button onClick={() => player.seek(player.beatIndex + 1)} style={S.button}>
          ▶
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, lesson.beats.length - 1)}
          value={player.beatIndex}
          onChange={(e) => player.seek(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <code style={S.muted}>
          {player.beatIndex + 1}/{lesson.beats.length}
        </code>
      </div>

      <CreditsList lesson={lesson} style={{ margin: '6px 0' }} />

      <p style={S.caption}>{player.caption}</p>
      <p style={S.muted}>
        <strong>{beat?.topic}</strong> · showing{' '}
        {canvas.visible
          .map((id) => {
            const el = lesson.elements.find((e) => e.id === id);
            return el ? `${el.kind}:${id}` : id;
          })
          .join(', ') || '—'}
        {canvas.focus.length > 0 && <> · pointing at {canvas.focus.join(', ')}</>}
      </p>
    </>
  );
}

function Report({ report, lesson }: { report: PrepReport; lesson: Lesson }) {
  const kinds = [...new Set(lesson.elements.map((e) => e.kind))].sort();
  const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  return (
    <details style={S.report}>
      <summary style={{ cursor: 'pointer' }}>
        Prepared in {s(report.totalMs)} — plan {s(report.planMs)}, drawing {s(report.visualsMs)}
        {report.issues.length > 0 && ` · ${report.issues.length} issue(s)`}
      </summary>
      <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
        <li>
          {lesson.beats.length} beats · element kinds used: <code>{kinds.join(', ')}</code>
        </li>
        {report.visuals.map((v) => (
          <li key={v.id}>
            <code>{v.id}</code> — {v.ok ? 'drawn' : 'FAILED'} in {v.attempts} attempt(s), {s(v.ms)}
            {v.problems.length > 0 && (
              <ul style={{ paddingLeft: 18 }}>
                {v.problems.map((p, i) => (
                  <li key={i} style={{ color: '#b45309' }}>
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
        {report.issues.map((issue, i) => (
          <li key={i} style={{ color: '#b45309' }}>
            {issue}
          </li>
        ))}
      </ul>
    </details>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 1180,
    margin: '0 auto',
    padding: 16,
    fontFamily: 'Quicksand, system-ui, sans-serif',
    // Its own surface: the app's dark theme would otherwise leave this tool's
    // default-dark text on a default-dark ground.
    background: '#fff',
    color: '#1b1f24',
    minHeight: '100vh',
  },
  head: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 },
  muted: { color: '#5b6672', fontSize: 13 },
  controls: { display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0' },
  input: { padding: '7px 10px', borderRadius: 8, border: '1px solid #cdd5dd', font: 'inherit', background: '#fff', color: '#1b1f24' },
  button: { padding: '7px 12px', borderRadius: 8, border: '1px solid #cdd5dd', font: 'inherit', cursor: 'pointer', background: '#fff', color: '#1b1f24' },
  primary: {
    padding: '7px 14px',
    borderRadius: 8,
    border: 0,
    background: '#1cb0f6',
    color: '#fff',
    font: 'inherit',
    fontWeight: 700,
    cursor: 'pointer',
  },
  prep: { display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0' },
  track: { flex: 1, height: 6, borderRadius: 3, background: '#e3e9ef', overflow: 'hidden' },
  fill: { height: '100%', background: '#1cb0f6', transition: 'width 400ms ease' },
  error: { color: '#b91c1c', whiteSpace: 'pre-wrap', fontSize: 13 },
  // 1000x620 is the board's own aspect, so nothing is letterboxed away here.
  board: { aspectRatio: '1000 / 620', background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #e3e9ef' },
  caption: { minHeight: 38, fontSize: 15, margin: '4px 0' },
  report: { fontSize: 13, marginTop: 10, opacity: 0.85 },
};
