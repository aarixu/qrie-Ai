import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Lesson } from '@ai-tutor/lesson-format';
import { Scene } from '@ai-tutor/stage';
import { useActionPlayer } from '@ai-tutor/action-player';
import { planToScene, beatOfAction } from '@ai-tutor/maic-adapter';
import { findEntry, fetchLesson, type CatalogEntry } from '../lib/content';
import { useLessonVoice } from '../lib/lessonVoice';
import { preferencesStore } from '../stores/preferences';
import { useStore } from '../stores/localStore';

/**
 * A scratch screen, not a product screen.
 *
 * It plays a real lesson through the OpenMAIC action path — `planToScene` turns
 * its beats into an `Action[]`, `ActionController` walks them, `<Scene>` draws
 * the result — so the pipeline can be watched end to end before any of it goes
 * near `ClassRoom.tsx`, which is 700 lines of working product.
 *
 * The readout below the board is the point: it shows the action being run, the
 * verb, and the beat the index resolves back to. That last column is the join
 * that turns a lesson from a video into a measurement, and here you can see it
 * hold on every single frame.
 *
 * Delete this screen once the action path lands in the real classroom.
 */
export function ActionLab() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preferences = useStore(preferencesStore);

  // Resolved here rather than deeper, for the same reason ClassRoom does it: the
  // player rebuilds its controller when the adapter identity changes, and a
  // voice arriving a moment late would restart the lesson from the top.
  const tts = useLessonVoice(entry, lesson, { enabled: preferences.voice });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found = lessonId ? await findEntry(lessonId) : null;
      if (!found) throw new Error(`No lesson called "${lessonId}".`);
      const loaded = await fetchLesson(found);
      if (!cancelled) {
        setEntry(found);
        setLesson(loaded);
      }
    })().catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
    };
  }, [lessonId]);

  if (error) return <Shell><p style={{ color: 'crimson' }}>{error}</p></Shell>;
  if (!lesson || !tts) return <Shell><p>Loading…</p></Shell>;
  return <Lab lesson={lesson} tts={tts} />;
}

function Lab({ lesson, tts }: { lesson: Lesson; tts: NonNullable<ReturnType<typeof useLessonVoice>> }) {
  // Memoised on the lesson: the hook rebuilds its controller whenever the
  // actions array identity changes, and a fresh array every render would
  // restart the lesson forever.
  const { actions, beatRanges } = useMemo(() => planToScene(lesson), [lesson]);
  const player = useActionPlayer(actions, tts);

  const action = actions[player.index];
  const beatId = beatOfAction(beatRanges, player.index);
  const beat = lesson.beats.find((b) => b.id === beatId);

  return (
    <Shell>
      <header style={{ marginBottom: 12 }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>{lesson.title}</h1>
        <p style={{ margin: '4px 0 0', opacity: 0.7, fontSize: 13 }}>
          Action lab — {actions.length} actions from {lesson.beats.length} beats
        </p>
      </header>

      <div style={{ background: '#0f1116', borderRadius: 12, overflow: 'hidden' }}>
        <Scene lesson={lesson} visible={player.board.visible} focus={player.board.focus} />
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0' }}>
        <button onClick={player.state === 'playing' ? player.pause : player.play}>
          {player.state === 'playing' ? 'Pause' : player.state === 'ended' ? 'Replay' : 'Play'}
        </button>
        <button onClick={() => player.seek(player.index - 1)}>◀ Step</button>
        <button onClick={() => player.seek(player.index + 1)}>Step ▶</button>
        <input
          type="range"
          min={0}
          max={Math.max(0, actions.length - 1)}
          value={player.index}
          onChange={(e) => player.seek(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <code style={{ fontSize: 12 }}>
          {player.index + 1}/{actions.length}
        </code>
      </div>

      <p style={{ minHeight: 40, fontSize: 15 }}>{player.caption}</p>

      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <tbody>
          <Row label="state" value={player.state} />
          <Row label="action" value={action ? `${action.type} · ${action.id}` : '—'} />
          <Row label="beat" value={beatId ?? '— (no beat owns this index)'} />
          <Row label="beat topic" value={beat?.topic ?? '—'} />
          <Row
            label="teaches"
            value={beat?.teaches?.length ? beat.teaches.join(', ') : '— (this beat teaches nothing new)'}
          />
          <Row label="on board" value={`${player.board.visible.length} elements`} />
        </tbody>
      </table>
    </Shell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ opacity: 0.6, padding: '3px 12px 3px 0', whiteSpace: 'nowrap' }}>{label}</td>
      <td style={{ fontFamily: 'ui-monospace, monospace' }}>{value}</td>
    </tr>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>{children}</main>;
}
