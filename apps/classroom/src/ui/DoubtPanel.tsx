import { useState } from 'react';
import type { HandoffState } from '@ai-tutor/doubt-session';
import { theme } from './theme';
import { CheckIcon, SendIcon } from './icons';

export interface DoubtPanelProps {
  state: HandoffState;
  /** Lines the live tutor has spoken (bridges + answers), newest last. */
  lines: string[];
  onSend(text: string): void;
  onEnd(): void;
}

/**
 * The live doubt overlay — a slate panel leaning on the board. The recording
 * stays visible behind it: the student never leaves the class, the class just
 * leans in to listen. Text input for now; voice arrives with the live agent.
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
        borderRadius: 16,
        background: 'linear-gradient(180deg, rgba(18,27,22,0.96), rgba(11,17,13,0.96))',
        border: `1.5px solid ${theme.surfaceBorder}`,
        boxShadow: '0 16px 44px rgba(0,0,0,0.55)',
        padding: 14,
        display: 'grid',
        gap: 10,
        backdropFilter: 'blur(10px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            background: theme.good,
            boxShadow: `0 0 10px ${theme.good}`,
          }}
        />
        <span style={{ color: theme.good, font: `600 12.5px ${theme.font}`, letterSpacing: 0.4 }}>
          {live ? 'LIVE · tutor sun rahi hai' : 'tutor aa rahi hai…'}
        </span>
      </div>

      <div style={{ maxHeight: '30vh', overflowY: 'auto', display: 'grid', gap: 8 }}>
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              color: theme.chalk,
              font: `400 15.5px/1.55 ${theme.fontChalk}`,
              opacity: i === lines.length - 1 ? 1 : 0.6,
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
          placeholder="Apna doubt likho…"
          aria-label="doubt likho"
          disabled={!live}
          style={{
            flex: 1,
            minHeight: 46,
            padding: '10px 14px',
            borderRadius: 12,
            border: `1.5px solid ${theme.surfaceBorder}`,
            background: 'rgba(238,241,234,0.06)',
            color: theme.chalk,
            font: `15px ${theme.font}`,
          }}
        />
        <button
          onClick={send}
          disabled={!live}
          aria-label="doubt bhejo"
          style={{
            width: 46,
            minHeight: 46,
            borderRadius: 12,
            border: 'none',
            display: 'grid',
            placeItems: 'center',
            background: live ? theme.accent : theme.surface,
            color: live ? theme.accentInk : theme.chalkDim,
            cursor: live ? 'pointer' : 'default',
            transition: 'background 200ms',
          }}
        >
          <SendIcon size={19} />
        </button>
        <button
          onClick={onEnd}
          disabled={!live}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            minHeight: 46,
            padding: '0 14px',
            borderRadius: 12,
            border: `1.5px solid ${live ? theme.good : theme.surfaceBorder}`,
            background: 'transparent',
            color: live ? theme.good : theme.chalkDim,
            font: `500 13.5px ${theme.font}`,
            cursor: live ? 'pointer' : 'default',
            transition: 'border-color 200ms, color 200ms',
          }}
        >
          <CheckIcon size={16} />
          Clear ho gaya
        </button>
      </div>
    </div>
  );
}
