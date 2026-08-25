import { useEffect, useRef, useState } from 'react';
import type { TranscriptLine } from '../lib/liveAgent';
import { Icon } from './Icon';

export interface DoubtPanelProps {
  /** A doubt is in progress — show the conversation instead of the invitation. */
  active: boolean;
  lines: TranscriptLine[];
  /** One line under the conversation: what the room is doing right now. */
  status: string;
  /** Typed fallback; omit while the session is voice-only and connected. */
  onSend?(text: string): void;
  /** The student is satisfied — end the doubt and resume the class. */
  onDone?(): void;
}

/**
 * The DOUBT panel — the side rail's conversation box, the way Meet's chat
 * panel works. Quiet during the class (an invitation to raise a hand), a
 * two-sided conversation while the live tutor has the room.
 */
export function DoubtPanel({ active, lines, status, onSend, onDone }: DoubtPanelProps) {
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  // Non-final lines grow in place, so the last text matters as much as the count.
  const last = lines[lines.length - 1];
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lines.length, last?.text]);

  const send = () => {
    const text = draft.trim();
    if (!text || !onSend) return;
    onSend(text);
    setDraft('');
  };

  return (
    <div className="flex-1 min-h-0 bg-stage-panel rounded-2xl flex flex-col">
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-white/10 font-label-sm text-label-sm font-bold tracking-wider text-stage-ink-dim">
        <Icon name="forum" className="text-[17px]" />
        DOUBT
      </div>

      {!active ? (
        <div className="flex-1 grid place-items-center text-center px-6 text-stage-ink-dim font-label-md text-[12.5px] leading-relaxed">
          <div>
            <Icon name="front_hand" className="text-[30px] block mb-2 text-stage-surface" filled />
            Raise your hand any time — the class pauses and Meera answers you here.
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-2">
            {lines.map((line, i) => (
              <div
                key={i}
                data-role={line.role}
                className={`max-w-[88%] px-3 py-2 rounded-[14px] font-body-md text-[13px] leading-relaxed ${
                  line.role === 'student'
                    ? 'self-end bg-stage-primary text-on-stage-primary rounded-br-[4px]'
                    : 'self-start bg-stage-surface text-stage-ink rounded-bl-[4px]'
                } ${line.final ? '' : 'italic opacity-70'}`}
              >
                {line.text}
              </div>
            ))}
            <div ref={endRef} />
          </div>

          {onSend && (
            <div className="flex gap-2 px-3 pb-1">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                placeholder="Type your doubt…"
                aria-label="Type your doubt"
                className="flex-1 min-w-0 h-10 px-3 rounded-xl bg-stage-surface text-stage-ink font-body-md text-[13px] placeholder:text-stage-ink-dim outline-none focus:ring-2 focus:ring-stage-blue"
              />
              <button
                onClick={send}
                aria-label="Send doubt"
                className="w-10 h-10 rounded-xl bg-stage-primary text-on-stage-primary grid place-items-center flex-shrink-0"
              >
                <Icon name="send" filled className="text-[18px]" />
              </button>
            </div>
          )}

          <div className="flex items-center gap-2 px-3 py-2.5">
            <span className="flex-1 min-w-0 font-label-sm text-label-sm text-stage-ink-dim truncate">
              {status}
            </span>
            {onDone && (
              <button
                onClick={onDone}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-stage-green-container text-stage-green-ink font-label-sm text-label-sm font-bold flex-shrink-0"
              >
                <Icon name="check" className="text-[16px]" />
                Got it
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
