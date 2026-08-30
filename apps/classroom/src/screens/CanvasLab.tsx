import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Lesson } from '@ai-tutor/lesson-format';
import { Scene, computeVisible } from '@ai-tutor/stage';
import { usePlayer, createBrowserTts } from '@ai-tutor/player';
import {
  drawMissingIcons,
  pickIcons,
  prepareClass,
  type LlmAdapter,
  type PrepProgress,
  type PrepReport,
} from '@ai-tutor/class-prep';
import { createBrowserLlm } from '../lib/browserLlm';

/**
 * Both jobs run on gemini-3.7-flash — measured as fastest AND best on this
 * exact prompt pair (plan 13.7s Rs 0.74, draw 25.9s Rs 1.51; the pro model was
 * four times slower, eight times dearer, and drew a worse diagram).
 */
const PLANNER_MODEL = 'google/gemini-3.7-flash';
const ARTIST_MODEL = 'google/gemini-3.7-flash';
/** Picks which meaning of a word to draw. One small call, so the fastest model. */
const PICKER_MODEL = 'google/gemini-3.1-flash-lite';

/**
 * The pictures for the nouns a lesson places.
 *
 * Fetched from our own origin because the icon sets are a 443 MB package that
 * must never reach a browser: the dev server holds them and answers for the
 * handful one class needs. A noun no set has comes back as a pencilled circle
 * with the word in it, so the board is never blank and never wrong.
 */
/**
 * The pictures for the nouns a lesson places.
 *
 * Two steps, because the first one cannot be trusted on its own. The dev server
 * searches the bundled icon sets by name and returns every plausible candidate;
 * a model then picks which one the LESSON means. String matching put an
 * armoured vehicle on a board about water tanks, and no better matching fixes
 * that — "tank" is two things and only the topic says which.
 *
 * The choice never blocks the class: if the model fails, each noun keeps the
 * best name match, which is exactly what it had before.
 */
async function fetchGraphics(
  lesson: Lesson,
  topic: string,
  llm: LlmAdapter,
  /** Draws the nouns nothing depicts. A stronger model than the picker. */
  drawIcon: LlmAdapter,
): Promise<Record<string, string>> {
  const nouns = [
    ...new Set(lesson.elements.filter((el) => el.kind === 'graphic').map((el) => el.noun)),
  ];
  if (nouns.length === 0) return {};

  // One parameter per noun. Joined with commas, a noun containing one was
  // torn in half and quietly lost both its lookup and its fallback.
  const query = new URLSearchParams();
  for (const noun of nouns) query.append('noun', noun);
  const res = await fetch(`/api/icons?${query}`);
  if (!res.ok) return {};

  type Glyph = { body: string; width: number; height: number };
  type Found = {
    candidates: { glyph: Glyph; source: { set: string; icon: string }; category?: string }[];
    pencil: Glyph;
  };
  const found = (await res.json()) as Record<string, Found>;

  const options = Object.fromEntries(
    Object.entries(found).map(([noun, f]) => [
      noun,
      f.candidates.map((c) => ({
        icon: c.source.icon,
        set: c.source.set,
        ...(c.category ? { category: c.category } : {}),
      })),
    ]),
  );
  const chosen = await pickIcons(topic, options, llm);

  /**
   * The picked glyph, or null when this noun has no picture worth using —
   * the model refused every option, or nothing was found at all.
   *
   * The order matters: a deliberate null falling through to candidates[0]
   * once put the very icon the model refused — a military tank — back on a
   * board about water.
   */
  const glyphFor = (noun: string): Glyph | null => {
    const f = found[noun];
    if (!f) return null;
    const pick = chosen[noun];
    if (pick?.deliberate) {
      const named =
        pick.icon && pick.set
          ? f.candidates.find((c) => c.source.icon === pick.icon && c.source.set === pick.set)
          : undefined;
      return named?.glyph ?? null;
    }
    return f.candidates[0]?.glyph ?? null;
  };

  // The nouns nothing depicts get DRAWN — a small flat SVG made to order, the
  // way a code-drawing model makes a chart with code instead of pixels. Only
  // the misses cost anything; the library answered the rest for free. What
  // fails to draw falls back to the pencilled circle, never delays the class.
  const missing = nouns.filter((n) => glyphFor(n) === null);
  const drawn =
    missing.length > 0 ? await drawMissingIcons(topic, missing, drawIcon) : {};

  const assets: Record<string, string> = {};
  for (const el of lesson.elements) {
    if (el.kind !== 'graphic') continue;
    const custom = drawn[el.noun];
    if (custom) {
      // Keyed by ELEMENT id, not by noun: the same noun placed twice is two
      // pictures, and the renderer looks each one up by its own id.
      assets[el.id] = custom;
      continue;
    }
    const glyph = glyphFor(el.noun) ?? found[el.noun]?.pencil;
    if (!glyph) continue;
    assets[el.id] =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${glyph.width} ${glyph.height}">` +
      `${glyph.body}</svg>`;
  }
  return assets;
}

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
      // The drawings arrive with the plan; the noun pictures are a second,
      // much cheaper fetch, so the board is complete before it is shown.
      // Pictures never take the class down with them. The icon relay went
      // down once mid-session and a fully prepared lesson was thrown away
      // with it, which is the opposite of what this path promises.
      let graphics: Record<string, string> = {};
      try {
        graphics = await fetchGraphics(
          result.lesson,
          topic,
          createBrowserLlm(PICKER_MODEL, { json: true }),
          createBrowserLlm(ARTIST_MODEL),
        );
      } catch {
        // The board shows what it has; a noun with no picture is a gap, not
        // a failure.
      }
      setPrepared({ ...result, assets: { ...result.assets, ...graphics } });
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
