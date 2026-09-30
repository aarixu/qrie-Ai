import type { AssistanceRung } from '@ai-tutor/ledger';
import type { TutorLanguage, WorkedExample } from '../types.ts';

/**
 * THE CONDUCTOR'S CONTRACT — a live class run from a lesson plan, not a
 * recording with stops (the plan file, "a live tutor — proactive, Socratic,
 * human", 2026-09-30).
 *
 * The split is the package's own: code decides the MOVE, a model only picks
 * the WORDS, code checks them. A move is decided after every student turn
 * from what the plan holds and what the student has shown; the words layer
 * (a text model in the pipeline, the live model in a Live session) says it
 * in the student's language.
 *
 * Everything a plan holds is English. The student's language is applied when
 * the words are written, so one plan serves `en` and `hi-en`.
 */

/** A wrong idea a student is likely to bring to one question. */
export interface PlanMisconception {
  /** Stable within the plan, e.g. `breathing-is-respiration`. */
  id: string;
  /** What a student who believes it actually says. Used to recognise it. */
  soundsLike: string;
  /** Why it is not so — the reason she gives, in her words, once it is out. */
  why: string;
  /**
   * ONE question that finds out why they think so, asked before anything is
   * explained. Never the answer, never a hint that gives it away (C7).
   */
  followUp: string;
}

export type AlternateMode = 'analogy' | 'everyday' | 'visual' | 'steps';

/** One question she can hold the class on, with everything a wrong turn needs. */
export interface PlanQuestion {
  /** Unique within the plan. */
  id: string;
  /** What she asks. */
  question: string;
  /** What a right answer contains. Never spoken; the reader of the reply uses it. */
  expect: string;
  /** The answer as she gives it on a reveal. */
  answer: string;
  /** Why it is right — said after a right answer, or with a reveal. */
  why: string;
  /** A why/how/when question short of the answer. */
  hint: string;
  /** 0–4. */
  misconceptions: PlanMisconception[];
  /** 1–3 other ways of seeing the idea the question rests on. Never its answer. */
  alternates: { mode: AlternateMode; say: string }[];
  /** A similar case worked in steps, never containing this question's answer. */
  workedExample?: WorkedExample;
  /** The knowledge-graph outcomes this question is evidence about. */
  nodeIds: string[];
}

/** One thing she explains, and the quick question that hands the turn back. */
export interface PlanPoint {
  id: string;
  /** The core of it, 1–2 sentences. She says it in her own words, never read out. */
  say: string;
  ask: PlanQuestion;
}

/** One idea of the class: predict → explain → check → teach back. */
export interface PlanIdea {
  id: string;
  title: string;
  nodeIds: string[];
  /** Which prepared board scene shows this idea: a beat of the board lesson. */
  board: { beatId: string; focus?: string[] };
  /** Ask before telling: a prediction, or a question from the student's life. */
  predict?: PlanQuestion;
  /** 1–3. */
  points: PlanPoint[];
  /**
   * 1–3 retrieval checks. The first is asked after the points; the rest are
   * fresh questions for a retest when the first needed help.
   */
  check: PlanQuestion[];
  /** "Explain it to me in your own words." */
  teachBack: { prompt: string; expect: string };
}

export interface TeachingPlan {
  formatVersion: 1;
  /** e.g. `class10-science-life-processes-respiration`. */
  id: string;
  topicRef: string;
  title: string;
  klass: number;
  subject: string;
  /** The catalogue lesson whose elements and beats are the board, e.g. `class10-respiration`. */
  boardLessonId: string;
  /** How long the class should run. Past it she goes to the recap. */
  minutes: number;
  /** Asked straight after the greeting: something from the student's own life. */
  opener: PlanQuestion;
  ideas: PlanIdea[];
  /** 2–3 retrieval prompts for the end: the student produces the class, she does not repeat it. */
  recap: { prompts: string[] };
  /**
   * The facts she may use to answer a doubt, each one sentence, true at this
   * level. A doubt outside them is answered as "that's beyond today's class".
   */
  facts: string[];
  /** Where the facts come from: textbook chapter and section, graph ids. */
  sources: string[];
}

/**
 * WHAT THE STUDENT'S TURN WAS, as the words layer or the live model reads it.
 * The conductor never reads raw words; it reads this.
 */
export type StudentClass =
  /** Answers the held question. */
  | 'right'
  /** Part of it: on the way, something missing. */
  | 'partly'
  /** Not it. `misconceptionId` names the plan's misconception when it is one. */
  | 'wrong'
  /** "Pata nahi", "I don't know", a shrug. */
  | 'dontKnow'
  /** They asked something about the topic (a doubt). */
  | 'question'
  /** They asked for a hint or help. */
  | 'hintRequest'
  /** They asked for it to be explained again or another way. */
  | 'explainRequest'
  /** Nothing to do with the class. */
  | 'offTopic'
  /** Nothing usable was heard. Not evidence either way. */
  | 'unclear'
  /** "Haan", "ok", "hmm" — a reply that answers nothing. */
  | 'chat'
  /** They want to stop the class. */
  | 'stop';

export const STUDENT_CLASSES: readonly StudentClass[] = [
  'right',
  'partly',
  'wrong',
  'dontKnow',
  'question',
  'hintRequest',
  'explainRequest',
  'offTopic',
  'unclear',
  'chat',
  'stop',
];

export interface Reading {
  class: StudentClass;
  /** For `wrong`: the plan misconception it matches on the held question, if any. */
  misconceptionId?: string;
  /** Their words, already through the safety screen. For the words layer only. */
  said: string;
}

export type MoveKind =
  /** Greet and ask the opener. */
  | 'open'
  /** Ask before telling. */
  | 'predict'
  /** One point, then its quick question. */
  | 'explain'
  /** A retrieval check on the idea. */
  | 'check'
  /** A named misconception's follow-up: find out why before explaining. */
  | 'probeWhy'
  /** Partly right: ask for the missing part. */
  | 'probeMore'
  | 'hint'
  | 'workedExample'
  | 'anotherWay'
  /** Give the answer with its reason, after the ladder ran out. */
  | 'reveal'
  /** "Explain it to me in your own words." */
  | 'teachBack'
  /** Answer their doubt briefly, then ask again what was held. */
  | 'answerDoubt'
  /** Off topic: bring them back, gently. */
  | 'redirect'
  /** Nothing usable heard: ask them to say it again. */
  | 'sayAgain'
  /** Silence: a smaller step, never the answer. */
  | 'nudge'
  /** Repeated silence or struggle: ask how it is going, offer another way. */
  | 'checkIn'
  /** The student produces the class: retrieval prompts. */
  | 'recap'
  | 'close';

/** How to react to the turn just taken, before the move itself. */
export interface Ack {
  of: StudentClass;
  misconceptionId?: string;
  /**
   * The reason to give when the reaction needs one: the question's `why` on a
   * right answer, the misconception's `why` once it has been probed.
   */
  why?: string;
}

export interface Move {
  /** 1, 2, … within one class. */
  seq: number;
  kind: MoveKind;
  /** The idea this move belongs to; null for open, recap and close. */
  ideaId: string | null;
  /** React to their last turn first. Absent on the first move and on nudges. */
  ack?: Ack;
  /** What to teach and what to ask, in English. The words layer renders it. */
  content: {
    /** The teaching content: a point, a hint, a reason, an alternate, a reveal. */
    say?: string;
    /** The question that ends the turn and hands it over. */
    ask?: string;
    /** A worked example's steps. */
    steps?: { say: string; line: string }[];
  };
  /** The plan question now held for their answer; null when nothing is held. */
  heldQuestionId: string | null;
  /** True when the move ends by giving the turn to the student. */
  handsOver: boolean;
  /** The board scene to show; null leaves the board as it is. */
  board: { beatId: string; focus?: string[] } | null;
  /** What nothing said or written for this move may contain (the leak check). */
  mustNotReveal: string[];
  /** The talk cap for this turn, in sentences. */
  maxSentences: number;
  /** Why this move, for the ledger and the lab's panel. Never spoken. */
  because: string;
  /** Help to file BEFORE a word is said (the ledger's `helped`), or null. */
  helped: AssistanceRung | null;
  /** Whether the student asked for that help. */
  requested: boolean;
  /** The ledger's strategy tag for this move. */
  strategy: string;
  /** What their last answer counted as, when it was an answer to a held question. */
  evidence?: { questionId: string; nodeIds: string[]; correct: boolean; rung: AssistanceRung };
  /** True on the last move of the class. */
  final: boolean;
}

export interface ConductorOptions {
  lang: TutorLanguage;
  /** The caller's clock, in ms. The conductor never reads one. */
  now: () => number;
  /** Overrides `plan.minutes`. */
  minutes?: number;
  /**
   * What the learner model believes about a node, unassisted, if the caller
   * has it. Absent means unknown. A node held cold lets an idea skip its
   * prediction; it never skips the check.
   */
  mastery?: (nodeId: string) => number | undefined;
}

export interface ConductorSnapshot {
  seq: number;
  ideaIndex: number;
  /** Where in the class it is, for the lab's panel: e.g. `idea:predict`, `recap`. */
  phase: string;
  heldQuestionId: string | null;
  /** Tries at the held question, 1-based; 0 when nothing is held. */
  attempt: number;
  /** The highest rung delivered on the held question. */
  rung: AssistanceRung;
  startedAt: number;
  evidence: { questionId: string; nodeIds: string[]; correct: boolean; rung: AssistanceRung }[];
  done: boolean;
}

export interface Conductor {
  /** The first move: greet, then the opener. */
  start(): Move;
  /** The student took a turn. */
  hear(reading: Reading): Move;
  /** Nothing was said for `ms` after the turn was handed over. */
  silence(ms: number): Move;
  /** Time is up, or the class is being ended: the recap if it has not run, else the close. */
  end(): Move;
  /**
   * The move `hear(reading)` WOULD make now, without changing anything. The
   * one-call words layer reads every class's preview so the model can write
   * the line for whichever class it reads; `hear` must then return exactly
   * that move.
   */
  preview(reading: Omit<Reading, 'said'>): Move;
  /** The question currently held, for reading their reply against. */
  held(): PlanQuestion | null;
  snapshot(): ConductorSnapshot;
}
