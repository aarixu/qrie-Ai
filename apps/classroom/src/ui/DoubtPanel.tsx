import { useState } from 'react';
import type { HandoffState } from '@ai-tutor/doubt-session';
import { theme, chunky } from './theme';
import { CheckIcon, SendIcon } from './icons';

export interface DoubtPanelProps {
  state: HandoffState;
  /** Lines the live tutor has spoken (bridges + answers), newest last. */
  lines: string[];
  onSend(text: string): void;
  onEnd(): void;
}

/**
 * The live doubt bottom sheet. The lesson stays visible above it — the
 * student never leaves the class, the class just leans in to listen.
 * Text input for now; voice arrives with the live agent.
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
        background: theme.bg,
        borderTop: `2px solid ${theme.border}`,
        borderRadius: '20px 20px 0 0',
        boxShadow: '0 -8px 30px rgba(0,0,0,0.08)',
        padding: '14px 16px calc(14px + env(safe-area-inset-bottom))',
        display: 'grid',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: 5,
            background: theme.green,
            boxShadow: `0 0 0 3px ${theme.green}33`,
          }}
        />
        <span style={{ color: theme.green, font: `800 13px ${theme.font}`, letterSpacing: 0.5 }}>
          {live ? 'LIVE · your tutor is listening' : 'your tutor is joining…'}
        </span>
      </div>

      <div style={{ maxHeight: '28vh', overflowY: 'auto', display: 'grid', gap: 8 }}>
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              color: theme.text,
              font: `700 15px/1.5 ${theme.font}`,
              opacity: i === lines.length - 1 ? 1 : 0.55,
            }}
          >
            {line}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Type your doubt…"
          aria-label="type your doubt"
          disabled={!live}
          style={{
            flex: 1,
            minHeight: 48,
            padding: '10px 16px',
            borderRadius: 14,
            border: `2px solid ${theme.border}`,
            background: theme.bgSoft,
            color: theme.text,
            font: `700 15px ${theme.font}`,
          }}
        />
        <button
          onClick={send}
          disabled={!live}
          aria-label="send doubt"
          style={{
            ...(live
              ? chunky(theme.blue, theme.blueDark)
              : { ...chunky('#e5e5e5', '#d0d0d0'), cursor: 'default' }),
            width: 52,
            minHeight: 48,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <SendIcon size={19} />
        </button>
        <button
          onClick={onEnd}
          disabled={!live}
          style={{
            ...(live
              ? chunky(theme.green, theme.greenDark)
              : { ...chunky('#e5e5e5', '#d0d0d0'), cursor: 'default' }),
            minHeight: 48,
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
          }}
        >
          <CheckIcon size={16} />
          Got it
        </button>
      </div>
    </div>
  );
}
