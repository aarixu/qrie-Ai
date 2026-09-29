import { useState } from 'react';
import { checkStep, type StepVerdict } from '@ai-tutor/maths-check';

/**
 * THE STUDENT'S WORKING, ONE LINE AT A TIME (T8.1).
 *
 * A tutor does not only hear the final answer; she watches the working and
 * catches the slip where it happens. The student types a step — on their own
 * keyboard, or with the keys here for the symbols a phone hides — and each
 * step is checked against the one before it, exactly and with no model
 * (`checkStep`): right, a calculation gone wrong, or a step that changed the
 * equation. The room decides what she says and writes (ClassRoom).
 *
 * `start` is the one equation in the question's board form, when the room
 * found one it can follow (lib/workAnswer.ts `workStartOf`); without it the
 * first step becomes the line the next is checked against. The list of steps
 * scrolls, so a long working never pushes the panel off a phone.
 */

export interface WorkedStep {
  text: string;
  verdict: StepVerdict;
}

const KEYS = ['x', 'y', '+', '−', '×', '÷', '=', '(', ')', '^'];

/** The keys a phone keyboard hides, as the checker reads them. */
const asTyped = (key: string): string => ({ '−': '-', '×': '*', '÷': '/' })[key] ?? key;

export function WorkPanel({
  start,
  steps,
  onSteps,
  onStep,
  onClose,
}: {
  start: string | null;
  /** Held by the room, so the working outlives the panel (a pause, a hand). */
  steps: WorkedStep[];
  onSteps: (steps: WorkedStep[]) => void;
  onStep: (step: WorkedStep) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    // The last right STEP — a sum on the side is not one (fourth review).
    const last = [...steps].reverse().find((s) => s.verdict.ok === true && s.verdict.aside !== true)?.text ?? start;
    const verdict: StepVerdict = last ? checkStep(last, text) : { ok: true };
    const step = { text, verdict };
    onSteps([...steps, step]);
    setDraft('');
    onStep(step);
  };

  return (
    <div
      role="dialog"
      aria-label="Work it out"
      className="w-full rounded-2xl bg-stage-surface/95 p-3 shadow-lg ring-1 ring-white/15 text-stage-ink"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-label-md text-[13px] font-semibold">✍️ Work it out, one step a line</span>
        <button onClick={onClose} aria-label="Close the working" className="px-2 text-[18px] leading-none">
          ×
        </button>
      </div>
      {start && <p className="font-body-md text-[13px] opacity-70 mb-1">Start: {start}</p>}
      {steps.length > 0 && (
        <ol className="mb-2 max-h-28 overflow-y-auto space-y-0.5 font-body-md text-[14px]">
          {steps.map((s, i) => (
            <li key={i}>
              <span aria-hidden>{s.verdict.ok === true ? '✓' : s.verdict.ok === false ? '✗' : '?'}</span> {s.text}
            </li>
          ))}
        </ol>
      )}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          aria-label="Your next step"
          placeholder="e.g. 3x + 12 = 21"
          inputMode="text"
          className="flex-1 min-w-0 rounded-xl bg-white/90 px-3 py-2 font-body-md text-[15px] text-stage placeholder:text-stage/40"
        />
        <button
          onClick={submit}
          className="min-h-[44px] rounded-xl bg-stage-primary px-4 font-label-md text-[13px] font-semibold text-on-stage-primary"
        >
          Check step
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {KEYS.map((key) => (
          <button
            key={key}
            onClick={() => setDraft((d) => d + asTyped(key))}
            aria-label={`Type ${key}`}
            className="min-w-[40px] min-h-[40px] rounded-lg bg-white/15 font-body-md text-[16px]"
          >
            {key}
          </button>
        ))}
        <button
          onClick={() => setDraft((d) => d.slice(0, -1))}
          aria-label="Delete the last character"
          className="min-w-[48px] min-h-[40px] rounded-lg bg-white/15 font-body-md text-[16px]"
        >
          ⌫
        </button>
      </div>
    </div>
  );
}
