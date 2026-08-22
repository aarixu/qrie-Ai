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

/** Per-subject tile colors, cycled — the established card-list look. */
const SUBJECT_COLORS = [theme.green, theme.blue, theme.purple, theme.yellow, theme.red];

/**
 * Lesson picker — a clean card list. Reads content/index.json (served as
 * static data by Vite). A lesson that fails validation shows as unavailable
 * rather than crashing the app — broken content must never take the
 * classroom down.
 */
export function Library({ onOpen }: { onOpen(lesson: Lesson): void }) {
  const [entries, setEntries] = useState<IndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch('/index.json')
      .then((r) => r.json())
      .then((doc: { lessons: IndexEntry[] }) => setEntries(doc.lessons))
      .catch((e) => setError(`Couldn't load lessons: ${e}`));
  }, []);

  const open = async (entry: IndexEntry) => {
    setBusy(entry.id);
    setError(null);
    try {
      const raw = await (await fetch(`/${entry.path}`)).json();
      const result = validateLesson(raw);
      if (!result.ok) {
        setError(`"${entry.title}" isn't available right now (invalid lesson file).`);
        console.error('[library] lesson failed validation:', result.errors);
        return;
      }
      onOpen(result.lesson);
    } catch (e) {
      setError(`Couldn't open "${entry.title}": ${e}`);
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
        padding: 'calc(28px + env(safe-area-inset-top)) 18px 30px',
      }}
    >
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <h1 style={{ color: theme.text, font: `900 30px ${theme.font}`, margin: 0 }}>AI Tutor</h1>
        <p style={{ color: theme.textMuted, font: `700 15px ${theme.font}`, margin: '4px 0 22px' }}>
          Pick a class — and whenever you're stuck, just raise your hand.
        </p>

        {error && (
          <div style={{ color: theme.red, font: `700 14px ${theme.font}`, marginBottom: 14 }}>
            {error}
          </div>
        )}
        {!entries && !error && (
          <div style={{ color: theme.textFaint, font: `700 14px ${theme.font}` }}>Loading…</div>
        )}

        <div style={{ display: 'grid', gap: 14 }}>
          {entries?.map((entry, i) => {
            const tile = SUBJECT_COLORS[i % SUBJECT_COLORS.length];
            return (
              <button
                key={entry.id}
                onClick={() => open(entry)}
                disabled={busy !== null}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  textAlign: 'left',
                  padding: 14,
                  borderRadius: 16,
                  border: `2px solid ${theme.border}`,
                  borderBottomWidth: 4,
                  background: theme.bg,
                  cursor: 'pointer',
                  transition: 'background 150ms, border-color 150ms',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = theme.bgSoft;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = theme.bg;
                }}
              >
                {/* Subject tile */}
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 14,
                    background: tile,
                    boxShadow: `inset 0 -4px 0 rgba(0,0,0,0.14)`,
                    display: 'grid',
                    placeItems: 'center',
                    color: '#ffffff',
                    font: `900 22px ${theme.font}`,
                    flexShrink: 0,
                  }}
                >
                  {entry.subject.charAt(0)}
                </div>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      color: theme.textFaint,
                      font: `800 11px ${theme.font}`,
                      letterSpacing: 0.8,
                      textTransform: 'uppercase',
                    }}
                  >
                    Class {entry.class} · {entry.subject}
                  </div>
                  <div style={{ color: theme.text, font: `800 18px ${theme.font}` }}>
                    {busy === entry.id ? 'Opening…' : entry.title}
                  </div>
                  {entry.subtitle && (
                    <div style={{ color: theme.textMuted, font: `700 13px ${theme.font}` }}>
                      {entry.subtitle}
                    </div>
                  )}
                </div>

                {/* Chevron */}
                <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.textFaint} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
