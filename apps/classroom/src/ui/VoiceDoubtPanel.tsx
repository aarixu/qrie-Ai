import { useEffect, useRef, useState } from 'react';
import { theme, chunky, outlined } from './theme';
import { MicIcon, MicOffIcon, SendIcon, StopIcon } from './icons';
import { Waveform } from './Waveform';

/** The live voice session's state, as the live agent reports it. */
export type VoiceDoubtState = 'connecting' | 'listening' | 'speaking' | 'error';

export interface VoiceTranscriptLine {
  role: 'student' | 'tutor';
  text: string;
  /** False while the words are still being spoken — shown as a draft, not a record. */
  final: boolean;
}

export interface VoiceDoubtPanelProps {
  state: VoiceDoubtState;
  /** The conversation so far, oldest first. */
  transcript: VoiceTranscriptLine[];
  /** 0..1 microphone energy — drives the waveform. */
  micLevel: number;
  muted: boolean;
  onToggleMute(): void;
  /** "Got it" — the student is satisfied; hand the room back to the recording. */
  onEnd(): void;
  /** Keyboard fallback. Omit it and the panel is voice-only. */
  onSendText?(text: string): void;
}

const STATUS: Record<VoiceDoubtState, { text: string; color: string }> = {
  connecting: { text: 'Connecting…', color: theme.yellow },
  listening: { text: 'Listening — just speak your doubt', color: theme.green },
  speaking: { text: 'Tutor is answering…', color: theme.blue },
  // No retry button: a dropped session is not the student's problem to fix, and
  // the class is one tap away. "Got it" is the whole exit.
  error: {
    text: 'Sorry, that connection dropped. Tap Got it to head back to the class.',
    color: theme.red,
  },
};

/** The app's one "not now" slab, same literals as Controls and Button. */
const OFF = { ...chunky('#e5e5e5', '#d0d0d0'), color: theme.textFaint, cursor: 'default' } as const;

// <details> gives the typing fallback its collapsed/expanded behaviour, its
// keyboard handling and its ARIA for free; all it needs from us is losing the
// browser's disclosure triangle.
const TYPE_CSS = `
.voice-type > summary { list-style: none; }
.voice-type > summary::-webkit-details-marker { display: none; }
`;

/**
 * The live doubt sheet, voice-first. The lesson stays visible above it — the
 * student never leaves the class, the class just leans in to listen.
 *
 * Everything here is display: the panel owns no session, no socket and no
 * timers. It renders what the live agent reports and reports back four taps.
 */
export function VoiceDoubtPanel({
  state,
  transcript,
  micLevel,
  muted,
  onToggleMute,
  onEnd,
  onSendText,
}: VoiceDoubtPanelProps) {
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement>(null);

  const last = transcript.at(-1);
  // Follow the conversation: a student mid-sentence must never have to scroll
  // to see what she just said. Non-final lines grow in place, so the last
  // line's text is part of the trigger, not just the count.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript.length, last?.text]);

  const failed = state === 'error';
  const status = STATUS[state];

  const send = () => {
    const text = draft.trim();
    if (!text || !onSendText) return;
    onSendText(text);
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
      <style>{TYPE_CSS}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            flex: 'none',
            width: 9,
            height: 9,
            borderRadius: 5,
            background: status.color,
            boxShadow: `0 0 0 3px ${status.color}33`,
          }}
        />
        <span
          role="status"
          style={{ color: status.color, font: `800 13px/1.4 ${theme.font}`, letterSpacing: 0.4 }}
        >
          {status.text}
        </span>
      </div>

      {transcript.length > 0 && (
        <div ref={scroller} style={{ maxHeight: '26vh', overflowY: 'auto', display: 'grid', gap: 8 }}>
          {transcript.map((line, i) => {
            const student = line.role === 'student';
            return (
              <div
                key={i}
                data-role={line.role}
                style={{
                  justifySelf: student ? 'end' : 'start',
                  maxWidth: '88%',
                  padding: '8px 13px',
                  borderRadius: student ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                  border: `2px solid ${student ? theme.border : `${theme.blue}44`}`,
                  background: student ? theme.bgSoft : `${theme.blue}14`,
                  color: theme.text,
                  font: `700 15px/1.45 ${theme.font}`,
                  // Still being spoken: shown, but clearly not yet the record.
                  fontStyle: line.final ? 'normal' : 'italic',
                  opacity: line.final ? 1 : 0.55,
                }}
              >
                {line.text}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={onToggleMute}
          disabled={failed}
          aria-label={muted ? 'unmute microphone' : 'mute microphone'}
          aria-pressed={muted}
          style={{
            ...(muted || failed ? OFF : chunky(theme.green, theme.greenDark)),
            borderRadius: '50%',
            width: 56,
            height: 56,
            flex: 'none',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {muted ? <MicOffIcon size={23} /> : <MicIcon size={23} />}
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <Waveform
            level={muted || failed ? 0 : micLevel}
            source={state === 'speaking' ? 'tutor' : 'mic'}
          />
        </div>

        {/* Normally the mic is the star and leaving is quiet; when the session
            breaks, leaving is the only thing left, so it turns primary. */}
        <button
          onClick={onEnd}
          style={{
            ...(failed ? chunky(theme.green, theme.greenDark) : outlined()),
            minHeight: 48,
            flex: 'none',
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <StopIcon size={14} />
          Got it
        </button>
      </div>

      {onSendText && (
        <details className="voice-type">
          <summary
            style={{
              color: theme.textMuted,
              font: `800 13px ${theme.font}`,
              letterSpacing: 0.4,
              textAlign: 'center',
              padding: '15px 8px',
              cursor: 'pointer',
            }}
          >
            Type instead
          </summary>
          <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="Type your doubt…"
              aria-label="type your doubt"
              style={{
                flex: 1,
                minWidth: 0,
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
              aria-label="send doubt"
              style={{
                ...chunky(theme.blue, theme.blueDark),
                width: 52,
                minHeight: 48,
                flex: 'none',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <SendIcon size={19} />
            </button>
          </div>
        </details>
      )}
    </div>
  );
}
