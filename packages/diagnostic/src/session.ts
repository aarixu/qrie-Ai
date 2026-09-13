import {
  GraphIndex,
  applyEvidence,
  type ModelParams,
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
  /**
   * How many earlier classes are in scope alongside `klass`. A placement that
   * only asks a Class 9 student Class 9 questions cannot see that the real
   * break happened in Class 7 fractions — the gaps that matter are usually a
   * level or two behind where the student is sitting. 0 keeps the old
   * same-class behaviour.
   */
  lookBack: number;
  /** Hard ceiling. Past roughly this many questions a student disengages. */
  maxQuestions: number;
  /** Never stop before this, however confident the model looks. */
  minQuestions: number;
  /** Share of in-scope nodes that must have settled to finish early. */
  confidenceTarget: number;
}

export const DEFAULT_CONFIG: Omit<DiagnosticConfig, 'klass' | 'subjects'> = {
  lookBack: 0,
  maxQuestions: 20,
  minQuestions: 12,
  confidenceTarget: 0.75,
};

export interface DiagnosticSession {
  mastery: Mastery;
  answers: Answer[];
  /** Nodes with direct evidence — never asked twice, never overwritten by inference. */
  askedNodeIds: Set<string>;
  /**
   * EVIDENCE THIS TEST DID NOT GATHER ITSELF.
   *
   * The classroom knows things about a student before the placement test opens
   * — above all, which outcomes they raised a hand on. The screen folds those
   * into the starting beliefs so the first question is already informed by
   * their term's work, and that seeding is deliberate.
   *
   * Without naming the nodes it touched, that seeding is silently thrown away
   * at the end: `buildPlan` only lets a node become a step if the test spoke
   * about it, and "spoke about it" was derived from the ANSWERS alone. So a
   * student could stop the class four times on the same outcome, have the
   * belief lowered for it, and get a plan that never mentions it. The gate is
   * right — a node nobody examined must not become a weakness by arithmetic
   * — but a raised hand is somebody examining it.
   *
   * Only evidence AGAINST belongs here. Attendance (`applyTaught`) raises
   * belief and so can never create a gap on its own; adding it would let the
   * difficulty prior back in through the side door, which is the defect this
   * whole gate exists to close.
   */
  seeded: Set<string>;
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
    seeded: new Set(),
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
  /**
   * What the model has measured about this item and these edges. Omitted, the
   * priors apply and every edge is trusted — a fresh install's honest state.
   */
  params?: ModelParams,
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
    mastery: applyEvidence(session.mastery, index, answer, {
      probed: session.askedNodeIds,
      params,
    }),
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
