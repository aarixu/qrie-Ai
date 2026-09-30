import type { Lesson } from '@ai-tutor/lesson-format';
import type { Move, TeachingPlan } from '@ai-tutor/tutor-control';
import type { TutorLanguage } from '../../lib/workspace';

/**
 * THE LIVE-TUTOR LAB'S CONTRACT (Aarav, 2026-09-30: "ek topic par dono bana
 * ke dikhao").
 *
 * Two drivers run the same conducted class on one topic, so the difference he
 * sees is the delivery, not the teaching:
 *   - 'a': the whole class inside one Gemini Live session (speech to speech);
 *     the conductor is a tool the model calls after every student turn.
 *   - 'b': a pipeline — the ear (/api/hear) → the conductor → a text model
 *     writes the line (/api/llm) → Gemini TTS (/api/speech).
 * The screen owns the board, the captions and the numbers; a driver owns the
 * voice and the turn-taking, and reports through these hooks.
 */

export type LabMode = 'a' | 'b';

export type LabState = 'connecting' | 'tutorSpeaking' | 'listening' | 'thinking' | 'ended' | 'error';

/**
 * ONE TUTOR TURN'S TIMES, all on `performance.now()`. A field a driver cannot
 * observe is left out, never guessed.
 */
export interface TurnTiming {
  seq: number;
  mode: LabMode;
  /** The move this turn delivered. */
  moveKind: Move['kind'];
  /** When the student's speech ended (the endpointer's, or the last transcript fragment's). */
  studentEndedAt?: number;
  /** B: when the transcript came back from the ear. */
  heardAt?: number;
  /** When the conductor chose the move. */
  decidedAt?: number;
  /** B: when the line came back from the text model. */
  wroteAt?: number;
  /** When her voice reached the speaker. */
  firstAudioAt?: number;
  /** When she stopped (finished, or was cut off). */
  endedAt?: number;
  /** How long she spoke on this turn. */
  tutorSpeechMs?: number;
  /** How long the student spoke on the turn before it. */
  studentSpeechMs?: number;
  /** What she said, as heard back or as written. */
  tutorText?: string;
  /** What the student said before it, after the safety screen. */
  studentText?: string;
  /** True when the student cut her off. */
  interrupted?: boolean;
}

/** One billed call, priced from the published per-token rates. */
export interface CostLine {
  /** e.g. `live session`, `write line`, `ear`, `voice`. */
  what: string;
  model: string;
  tokens: { textIn?: number; audioIn?: number; textOut?: number; audioOut?: number; cached?: number };
  inr: number;
  /** True when the token counts came from the provider; false when estimated (e.g. from audio bytes). */
  measured: boolean;
}

export interface LabHooks {
  onState(state: LabState): void;
  /** Her words as they arrive. `text` is the whole line so far; `final` closes it. */
  onTutorLine(text: string, final: boolean): void;
  onStudentLine(text: string, final: boolean): void;
  /** Every move the conductor makes, as it is made. The screen moves the board from it. */
  onMove(move: Move): void;
  /** Once per tutor turn, when it ends. */
  onTurn(turn: TurnTiming): void;
  onCost(cost: CostLine): void;
  onMicLevel?(level: number): void;
  /** Something the panel should show: a fallback taken, a rule the model broke, a retry. */
  onNote(note: string): void;
}

/** Who is in front of her. No name ever goes into a prompt (lib/student.ts). */
export interface LabStudent {
  /** For the greeting line the driver writes itself, never for a prompt. */
  firstName?: string;
  klass: number;
  /** Private notes (lib/studentMemory.ts `memoryNotes`), already in the student's language. */
  notes: string[];
}

export interface LabDriverDeps {
  plan: TeachingPlan;
  /** The board lesson (`plan.boardLessonId`), for element ids the move may focus. */
  lesson: Lesson;
  lang: TutorLanguage;
  student: LabStudent;
  hooks: LabHooks;
}

export interface LabDriver {
  /** Starts the class. Call it from a tap: it unlocks audio and asks for the mic. */
  start(): Promise<void>;
  /** The student typed instead of speaking. */
  typed(text: string): void;
  /** Cut her off mid-line and listen. */
  interrupt(): void;
  /** End now: the recap if there is time for it is skipped. Idempotent; no hook fires after it. */
  stop(): void;
}
