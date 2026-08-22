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
 * Lesson picker. Reads content/index.json (served as static data by Vite).
 * A lesson that fails validation is shown as unavailable rather than crashing
 * the app — broken content must never take the classroom down.
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
        background: theme.bg,
        overflowY: 'auto',
        fontFamily: theme.font,
        padding: 'calc(24px + env(safe-area-inset-top)) 18px 24px',
      }}
    >
      <h1 style={{ color: theme.text, fontSize: 22, margin: '0 0 4px' }}>AI Tutor</h1>
      <p style={{ color: theme.textMuted, fontSize: 13, margin: '0 0 20px' }}>
        Class chuno — doubt aaye to bas haath uthao ✋
      </p>

      {error && (
        <div style={{ color: theme.danger, fontSize: 13, marginBottom: 14 }}>{error}</div>
      )}
      {!entries && !error && (
        <div style={{ color: theme.textMuted, fontSize: 14 }}>Loading…</div>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {entries?.map((entry) => (
          <button
            key={entry.id}
            onClick={() => open(entry)}
            disabled={busy !== null}
            style={{
              textAlign: 'left',
              padding: 16,
              borderRadius: 14,
              border: `1px solid ${theme.surfaceBorder}`,
              background: theme.surface,
              cursor: 'pointer',
              display: 'grid',
              gap: 4,
            }}
          >
            <div style={{ color: theme.textMuted, fontSize: 11 }}>
              Class {entry.class} · {entry.subject}
            </div>
            <div style={{ color: theme.text, font: `600 16px ${theme.font}` }}>
              {busy === entry.id ? 'Khul rahi hai…' : entry.title}
            </div>
            {entry.subtitle && (
              <div style={{ color: theme.textMuted, fontSize: 12 }}>{entry.subtitle}</div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
