import {
  GraphIndex,
  applyEvidence,
  confidenceCoverage,
  initialMastery,
  type Answer,
  type Mastery,
  type Probe,
  type ProbeBank,
} from '@ai-tutor/knowledge-graph';

/**
 * The diagnostic session: pure state, advanced one answer at a time.
 *
 * Nothing here is random and nothing here is async, so a session is entirely
 * reproducible — replay the same answers and you get the same questions and the
 * same plan. A diagnostic that varied run to run could not be debugged, and
 * could not be trusted by the student it labels.
 */

export interface DiagnosticConfig {
  klass: number;
  /** Subjects the student picked during onboarding. */
  subjects: string[];
  /** Hard ceiling. Past roughly this many questions a student disengages. */
  maxQuestions: number;
  /** Never stop before this, however confident the model looks. */
  minQuestions: number;
  /** Share of in-scope nodes that must have settled to finish early. */
  confidenceTarget: number;
}

export const DEFAULT_CONFIG: Omit<DiagnosticConfig, 'klass' | 'subjects'> = {
  maxQuestions: 20,
  minQuestions: 12,
  confidenceTarget: 0.75,
};

export interface DiagnosticSession {
  mastery: Mastery;
  answers: Answer[];
  /** Nodes with direct evidence — never asked twice, never overwritten by inference. */
  askedNodeIds: Set<string>;
  config: DiagnosticConfig;
}

export function startSession(
  index: GraphIndex,
  _bank: ProbeBank,
  config: Partial<DiagnosticConfig> & Pick<DiagnosticConfig, 'klass' | 'subjects'>,
): DiagnosticSession {
  return {
    mastery: initialMastery(index, { biasByDifficulty: true }),
    answers: [],
    askedNodeIds: new Set(),
    config: { ...DEFAULT_CONFIG, ...config },
  };
}

/**
 * Record an answer and fold it into the beliefs.
 *
 * `chosenIndex` is null for a skip. Returns a NEW session — the caller keeps the
 * old one if it wants to replay or undo.
 */
export function answerProbe(
  session: DiagnosticSession,
  index: GraphIndex,
  probe: Probe,
  chosenIndex: number | null,
  ms?: number,
): DiagnosticSession {
  const answer: Answer = {
    probeId: probe.id,
    nodeId: probe.nodeId,
    chosenIndex,
    correct: chosenIndex === probe.correctIndex,
    ms,
  };

  // The probed node joins the direct-evidence set BEFORE propagation, so this
  // answer's own inference cannot talk over the answer itself.
  const askedNodeIds = new Set(session.askedNodeIds);
  askedNodeIds.add(probe.nodeId);

  return {
    ...session,
    askedNodeIds,
    answers: [...session.answers, answer],
    mastery: applyEvidence(session.mastery, index, answer, { probed: session.askedNodeIds }),
  };
}

/**
 * Stop at the ceiling, or once the picture has settled and we have asked
 * enough to trust it. Both halves matter: stopping purely on confidence would
 * end after three lucky answers, and stopping purely on a count would keep
 * asking a student we already understand.
 */
export function isComplete(session: DiagnosticSession, index: GraphIndex): boolean {
  const asked = session.answers.length;
  if (asked >= session.config.maxQuestions) return true;
  if (asked < session.config.minQuestions) return false;

  const coverage = confidenceCoverage(session.mastery, index, {
    subjects: session.config.subjects,
    klass: session.config.klass,
  });
  return coverage >= session.config.confidenceTarget;
}

export interface Progress {
  asked: number;
  target: number;
  fraction: number;
}

/** Progress against the ceiling — the honest denominator for a progress bar. */
export function progressOf(session: DiagnosticSession): Progress {
  const asked = session.answers.length;
  const target = session.config.maxQuestions;
  return { asked, target, fraction: Math.min(1, asked / target) };
}
