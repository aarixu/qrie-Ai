import { useEffect, useState } from 'react';
import { validateLesson, type Lesson } from '@ai-tutor/lesson-format';
import { theme } from '../ui/theme';

interface IndexEntry {
  id: string;
  title: string;
  subtitle?: string;
  class: number;
  subject: string;
  path: string;
  status?: string;
}

/**
 * Lesson picker — a wall of small blackboards, one per class. Reads
 * content/index.json (served as static data by Vite). A lesson that fails
 * validation shows as unavailable rather than crashing the app — broken
 * content must never take the classroom down.
 */
export function Library({ onOpen }: { onOpen(lesson: Lesson): void }) {
  const [entries, setEntries] = useState<IndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch('/index.json')
      .then((r) => r.json())
      .then((doc: { lessons: IndexEntry[] }) => setEntries(doc.lessons))
      .catch((e) => setError(`Lessons load nahi hui: ${e}`));
  }, []);

  const open = async (entry: IndexEntry) => {
    setBusy(entry.id);
    setError(null);
    try {
      const raw = await (await fetch(`/${entry.path}`)).json();
      const result = validateLesson(raw);
      if (!result.ok) {
        setError(`"${entry.title}" abhi available nahi hai (invalid lesson file).`);
        console.error('[library] lesson failed validation:', result.errors);
        return;
      }
      onOpen(result.lesson);
    } catch (e) {
      setError(`"${entry.title}" load nahi hui: ${e}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: `radial-gradient(140% 110% at 50% -10%, #131c16 0%, ${theme.bg} 55%, ${theme.bgDeep} 100%)`,
        overflowY: 'auto',
        fontFamily: theme.font,
        padding: 'calc(26px + env(safe-area-inset-top)) 18px 30px',
      }}
    >
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        {/* Chalk-written masthead */}
        <h1
          style={{
            color: theme.chalk,
            font: `700 34px ${theme.fontChalk}`,
            margin: 0,
            textShadow: `0 0 24px rgba(238,241,234,0.18)`,
          }}
        >
          AI Tutor
        </h1>
        <div
          style={{
            width: 132,
            height: 3,
            borderRadius: 2,
            background: theme.accent,
            opacity: 0.85,
            margin: '6px 0 8px',
          }}
        />
        <p style={{ color: theme.chalkDim, font: `15px ${theme.font}`, margin: '0 0 22px' }}>
          Class chuno — doubt aaye to bas haath uthana.
        </p>

        {error && (
          <div style={{ color: theme.danger, font: `14px ${theme.font}`, marginBottom: 14 }}>
            {error}
          </div>
        )}
        {!entries && !error && (
          <div style={{ color: theme.chalkDim, font: `14px ${theme.font}` }}>Board saaf ho raha hai…</div>
        )}

        <div style={{ display: 'grid', gap: 16 }}>
          {entries?.map((entry) => (
            <button
              key={entry.id}
              onClick={() => open(entry)}
              disabled={busy !== null}
              style={{
                textAlign: 'left',
                padding: 6,
                borderRadius: 13,
                border: 'none',
                background: theme.woodGrad,
                boxShadow: 'inset 0 1px 0 rgba(255,220,180,0.22), 0 8px 22px rgba(0,0,0,0.45)',
                cursor: 'pointer',
                transition: 'transform 200ms, box-shadow 200ms',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = `inset 0 1px 0 rgba(255,220,180,0.22), 0 10px 26px rgba(0,0,0,0.55), 0 0 0 2px ${theme.accent}55`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow =
                  'inset 0 1px 0 rgba(255,220,180,0.22), 0 8px 22px rgba(0,0,0,0.45)';
              }}
            >
              {/* A small blackboard inside a wooden frame */}
              <div
                style={{
                  borderRadius: 9,
                  background: theme.board,
                  boxShadow: 'inset 0 0 34px rgba(0,0,0,0.5)',
                  padding: '16px 18px 14px',
                  display: 'grid',
                  gap: 4,
                }}
              >
                <div
                  style={{
                    color: theme.accent,
                    font: `600 11.5px ${theme.font}`,
                    letterSpacing: 1,
                    textTransform: 'uppercase',
                  }}
                >
                  Class {entry.class} · {entry.subject}
                </div>
                <div style={{ color: theme.chalk, font: `700 22px ${theme.fontChalk}` }}>
                  {busy === entry.id ? 'Board taiyaar ho raha hai…' : entry.title}
                </div>
                {entry.subtitle && (
                  <div style={{ color: theme.chalkDim, font: `13px ${theme.font}` }}>
                    {entry.subtitle}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
