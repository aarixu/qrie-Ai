import { useState } from 'react';
import type { HandoffState } from '@ai-tutor/doubt-session';
import { theme } from './theme';

export interface DoubtPanelProps {
  state: HandoffState;
  /** Lines the live tutor has spoken (bridges + answers), newest last. */
  lines: string[];
  onSend(text: string): void;
  onEnd(): void;
}

/**
 * The live doubt overlay. Visible whenever the handoff has left PLAYING.
 * Text input for now — the student types the doubt; voice arrives with the
 * live agent. The recording stays visible behind it: the student never leaves
 * the class, the class just leans in to listen.
 */
export function DoubtPanel({ state, lines, onSend, onEnd }: DoubtPanelProps) {
  const [draft, setDraft] = useState('');
  const live = state === 'LIVE';

  const send = () => {
    const text = draft.trim();
    if (!text || !live) return;
    onSend(text);
    setDraft('');
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 'calc(12px + env(safe-area-inset-bottom))',
        borderRadius: 14,
        background: 'rgba(13,15,20,0.94)',
        border: `1px solid ${theme.surfaceBorder}`,
        padding: 14,
        display: 'grid',
        gap: 10,
        backdropFilter: 'blur(10px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: theme.good }} />
        <span style={{ color: theme.good, font: `600 12px ${theme.font}` }}>
          {live ? 'LIVE — tutor sun rahi hai' : 'tutor aa rahi hai…'}
        </span>
      </div>

      <div style={{ maxHeight: '30vh', overflowY: 'auto', display: 'grid', gap: 8 }}>
        {lines.map((line, i) => (
          <div key={i} style={{ color: theme.text, font: `14px/1.5 ${theme.font}` }}>
            {line}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Apna doubt likho…"
          disabled={!live}
          style={{
            flex: 1,
            padding: '11px 14px',
            borderRadius: 10,
            border: `1px solid ${theme.surfaceBorder}`,
            background: theme.surface,
            color: theme.text,
            font: `14px ${theme.font}`,
            outline: 'none',
          }}
        />
        <button
          onClick={send}
          disabled={!live}
          style={{
            padding: '0 16px',
            borderRadius: 10,
            border: 'none',
            background: live ? theme.accent : theme.surface,
            color: live ? '#1a1205' : theme.textMuted,
            font: `600 14px ${theme.font}`,
            cursor: live ? 'pointer' : 'default',
          }}
        >
          →
        </button>
        <button
          onClick={onEnd}
          disabled={!live}
          style={{
            padding: '0 14px',
            borderRadius: 10,
            border: `1px solid ${theme.surfaceBorder}`,
            background: 'transparent',
            color: live ? theme.text : theme.textMuted,
            font: `13px ${theme.font}`,
            cursor: live ? 'pointer' : 'default',
          }}
        >
          Clear ho gaya ✓
        </button>
      </div>
    </div>
  );
}
