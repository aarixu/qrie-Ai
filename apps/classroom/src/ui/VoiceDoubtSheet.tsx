import { useEffect, useRef, useState } from 'react';
import type { HandoffState } from '@ai-tutor/doubt-session';
import { Icon } from './Icon';

export type VoiceState = 'connecting' | 'listening' | 'speaking' | 'error';

export interface TranscriptLine {
  role: 'student' | 'tutor';
  text: string;
  final: boolean;
}

export interface VoiceDoubtSheetProps {
  handoff: HandoffState;
  voice: VoiceState;
  transcript: TranscriptLine[];
  /** 0..1 microphone energy. */
  micLevel: number;
  muted: boolean;
  onToggleMute(): void;
  onEnd(): void;
  /** Typed fallback; omit to make the sheet voice-only. */
  onSendText?(text: string): void;
}

/** Seven bars, centre-weighted, driven by mic energy — a level meter, not a spectrum. */
const BAR_PROFILE = [0.45, 0.7, 0.9, 1, 0.9, 0.7, 0.45];

function LevelMeter({ level, tone }: { level: number; tone: 'mic' | 'tutor' }) {
  // Raw mic energy sits low; the square root lifts it into a range that reads
  // as alive, and the floor keeps the meter from looking broken in silence.
  const amp = Math.max(0.14, Math.sqrt(Math.max(0, Math.min(1, level))));
  return (
    <div className="flex items-end justify-center gap-1.5 h-10" aria-hidden>
      {BAR_PROFILE.map((weight, i) => (
        <span
          key={i}
          className={`w-1.5 rounded-full origin-bottom transition-transform duration-100 ${
            tone === 'tutor' ? 'bg-primary animate-pulse' : 'bg-primary'
          }`}
          style={{ height: 36, transform: `scaleY(${tone === 'tutor' ? weight : amp * weight})` }}
        />
      ))}
    </div>
  );
}

const STATUS: Record<VoiceState, { text: string; dot: string; ink: string }> = {
  connecting: { text: 'Connecting to your tutor…', dot: 'bg-secondary-container', ink: 'text-on-surface-variant' },
  listening: { text: 'LIVE — your tutor is listening', dot: 'bg-[#16a34a]', ink: 'text-[#16a34a]' },
  speaking: { text: 'Your tutor is answering…', dot: 'bg-primary', ink: 'text-primary' },
  error: { text: "Couldn't hear you — you can type instead", dot: 'bg-error', ink: 'text-error' },
};

/**
 * The live doubt sheet. It rises over the lesson rather than replacing it —
 * the student never leaves the class, the class just leans in to listen.
 */
export function VoiceDoubtSheet({
  handoff,
  voice,
  transcript,
  micLevel,
  muted,
  onToggleMute,
  onEnd,
  onSendText,
}: VoiceDoubtSheetProps) {
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Non-final lines grow in place, so the text matters as much as the count.
  const last = transcript[transcript.length - 1];
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [transcript.length, last?.text]);

  const live = handoff === 'LIVE';
  const status = STATUS[voice];

  const send = () => {
    const text = draft.trim();
    if (!text || !onSendText) return;
    onSendText(text);
    setDraft('');
  };

  return (
    <div className="fixed bottom-0 left-0 w-full z-50 bg-surface-container-lowest rounded-t-[24px] shadow-[0_-8px_30px_rgba(99,102,241,0.14)] px-margin-mobile pt-5 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <div className="max-w-[1120px] mx-auto flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${status.dot} ${voice === 'listening' ? 'animate-pulse' : ''}`} />
          <span className={`font-label-md text-label-md font-bold ${status.ink}`}>{status.text}</span>
        </div>

        <LevelMeter level={muted ? 0 : micLevel} tone={voice === 'speaking' ? 'tutor' : 'mic'} />

        <div className="max-h-[26vh] overflow-y-auto flex flex-col gap-2">
          {transcript.map((line, i) => (
            <div
              key={i}
              data-role={line.role}
              className={`max-w-[85%] rounded-[18px] px-4 py-2.5 font-body-md text-body-md ${
                line.role === 'student'
                  ? 'self-end bg-surface-container text-on-surface rounded-br-md'
                  : 'self-start bg-primary-fixed text-on-primary-fixed rounded-bl-md'
              } ${line.final ? '' : 'italic opacity-70'}`}
            >
              {line.text}
            </div>
          ))}
          <div ref={endRef} />
        </div>

        {typing && onSendText && (
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="Type your doubt…"
              aria-label="Type your doubt"
              className="flex-1 min-h-[48px] px-4 rounded-xl border-2 border-surface-variant bg-surface-container-low font-body-md text-body-md text-on-surface outline-none focus:border-primary transition-colors"
            />
            <button
              onClick={send}
              aria-label="Send doubt"
              className="w-12 min-h-[48px] rounded-xl bg-primary text-on-primary grid place-items-center"
            >
              <Icon name="send" filled />
            </button>
          </div>
        )}

        <div className="flex items-center gap-4">
          <button
            onClick={onToggleMute}
            disabled={!live}
            aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
            className={`w-14 h-14 rounded-full grid place-items-center flex-shrink-0 transition-colors ${
              muted
                ? 'bg-surface-container text-on-surface-variant border-2 border-outline-variant'
                : 'bg-primary text-on-primary shadow-md'
            } ${live ? '' : 'opacity-50'}`}
          >
            <Icon name={muted ? 'mic_off' : 'mic'} filled />
          </button>

          {onSendText && !typing && (
            <button
              onClick={() => setTyping(true)}
              className="font-label-md text-label-md text-on-surface-variant underline underline-offset-2"
            >
              Type instead
            </button>
          )}

          <button
            onClick={onEnd}
            className="ml-auto flex items-center gap-2 px-6 py-3 rounded-full border-2 border-outline-variant bg-surface text-on-surface font-label-md text-label-md font-semibold hover:bg-surface-container-high transition-colors"
          >
            <Icon name="check" />
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
