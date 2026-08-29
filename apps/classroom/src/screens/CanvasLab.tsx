import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Lesson } from '@ai-tutor/lesson-format';
import { Scene, computeVisible } from '@ai-tutor/stage';
import { usePlayer, createBrowserTts } from '@ai-tutor/player';
import { prepareClass, type PrepProgress, type PrepReport } from '@ai-tutor/class-prep';
import { createBrowserLlm } from '../lib/browserLlm';

/**
 * The canvas test bench.
 *
 * Nothing here is product. It exists so the board can be judged on its own:
 * type a topic, watch a class actually get prepared — planned, drawn, checked —
 * and then watch it play with no classroom furniture around it.
 *
 * The preparation is REAL. Nothing is pre-generated and committed, because a
 * picture drawn in advance by hand proves nothing about a product whose whole
 * promise is drawing one in the minute before a cold class starts.
 */

/**
 * Both jobs run on the same model, and it is not the expensive one.
 *
 * Measured on this exact prompt pair, planning a two-minute lesson and drawing
 * a distance-time graph:
 *
 *   gemini-3.7-flash       plan 13.7s Rs 0.74   draw 25.9s Rs 1.51
 *   gemini-3.5-flash       plan 19.7s Rs 3.25   draw 28.8s Rs 4.96
 *   gemini-3.1-pro-preview plan 55.7s Rs 8.36   draw 56.8s Rs 9.25
 *
 * The flash model was not a compromise: its drawing was the best of the three,
 * with a shaded slope triangle and a right-angle marker neither other model
 * thought to add. Roughly 40 seconds and Rs 2.25 for a whole cold class, which
 * is what makes the one-minute wait real rather than aspirational.
 */
const PLANNER_MODEL = 'google/gemini-3.7-flash';
const ARTIST_MODEL = 'google/gemini-3.7-flash';

export function CanvasLab() {
  const [topic, setTopic] = useState('Speed: distance divided by time');
  const [klass, setKlass] = useState(9);
  const [minutes, setMinutes] = useState(2);

  const [progress, setProgress] = useState<PrepProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<{
    lesson: Lesson;
    assets: Record<string, string>;
    report: PrepReport;
  } | null>(null);

  const run = useCallback(async () => {
    setError(null);
    setPrepared(null);
    setProgress({ phase: 'planning', message: 'Starting…', done: 0 });
    try {
      const result = await prepareClass({
        topic,
        klass,
        minutes,
        planner: createBrowserLlm(PLANNER_MODEL, { json: true }),
        artist: createBrowserLlm(ARTIST_MODEL),
        onProgress: setProgress,
      });
      setPrepared(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    }
  }, [topic, klass, minutes]);

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
        <button onClick={run} disabled={progress !== null && progress.phase !== 'done'} style={S.primary}>
          {progress && progress.phase !== 'done' ? 'Preparing…' : 'Prepare the class'}
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

function Board({ lesson, assets }: { lesson: Lesson; assets: Record<string, string> }) {
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
        <Scene lesson={lesson} visible={canvas.visible} focus={canvas.focus} assets={assets} />
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
