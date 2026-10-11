import type { LearningMetric } from './metric.ts';
import { confirmedMisconceptions } from './misconception.ts';
import type { ConceptState, LearnerModel } from './types.ts';

/**
 * A BASIC UNDERSTANDING OF ONE LEARNER, read off the model.
 *
 * What they hold (mastered on their own), what needs work (answered cold and
 * low), what only help carries, the wrong ideas their answers keep showing,
 * and what is due for review. Pure: no I/O, no model call, and no clock but the
 * `now` passed in, so the same model always reads the same. Nothing here holds
 * a child's own words: wrong ideas carry the question bank's wording.
 *
 * Every surface can call it on the model it already has: the tutor on its
 * merged model, the server on the learner_model snapshot.
 */

export interface ProfileOutcome {
  outcomeId: string;
  title: string | null;
  /** Belief from answers given with no help (0..1). */
  onOwn: number;
  /** How they do when helped (0..1). */
  withHelp: number;
  answers: number;
}

export interface ProfileWrongIdea {
  outcomeId: string;
  title: string | null;
  /** The bank's wording for the wrong idea; null when only the item and option are known. */
  label: string | null;
  /** Wrong answers that showed it. */
  count: number;
  /** Distinct questions it showed on. */
  items: number;
}

export interface LearnerProfile {
  /** Outcomes with at least one answer. */
  outcomesSeen: number;
  answersTotal: number;
  answersOnOwn: number;
  /** Mastered on their own (the model's mastered rule), most recent first. */
  secure: ProfileOutcome[];
  /** Answered cold and still under half on their own, weakest first. */
  needsWork: ProfileOutcome[];
  /** Right when helped, not (yet) shown alone, strongest with help first. */
  withHelpOnly: ProfileOutcome[];
  /** Confirmed wrong ideas (2+ questions or sittings, not since cleared), most shown first. */
  wrongIdeas: ProfileWrongIdea[];
  /** Review time has come, most overdue first. */
  dueForReview: ProfileOutcome[];
  /** The latest time they practised anything (the model's own clock). */
  lastActiveAt: string | null;
  /**
   * The brief's metric, unassisted gain per learning minute, from the
   * brain's figures (`ProfileOptions.metric`); null without them, and null,
   * not 0, when no learning minutes are measured. Not in the summary.
   */
  gainPerMinute: number | null;
  /** Measured time on task, in minutes; null without the brain's figures. */
  learningMinutes: number | null;
  /** One plain English sentence of the lists above (not the metric). */
  summary: string;
}

export interface ProfileOptions {
  /** The clock for "due"; pass the server's time where there is one. */
  now: number;
  /** A readable name for an outcome; the outcome id is used without it. */
  titleOf?: (outcomeId: string) => string | undefined;
  /** At most this many entries per list (default 5). */
  limit?: number;
  /** The brain's figures for the metric (learner_model.metrics, learningMetric). */
  metric?: LearningMetric | null;
}

/** Under this, on their own, an outcome needs work. */
export const NEEDS_WORK_BELOW = 0.5;
/** At or over this with help, while not shown alone, help is what carries it. */
export const WITH_HELP_FROM = 0.7;

const byId = (a: { outcomeId: string }, b: { outcomeId: string }) => (a.outcomeId < b.outcomeId ? -1 : a.outcomeId > b.outcomeId ? 1 : 0);
const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NEGATIVE_INFINITY);

const helpCarries = (s: ConceptState) =>
  !s.masteredAt &&
  s.answerObservations >= 2 &&
  s.assistedPerformance >= WITH_HELP_FROM &&
  (s.unassistedObservations === 0 || s.unassistedMastery < NEEDS_WORK_BELOW);

const needsWork = (s: ConceptState) =>
  !s.masteredAt && s.unassistedObservations >= 1 && s.unassistedMastery < NEEDS_WORK_BELOW && !helpCarries(s);

export function learnerProfile(model: LearnerModel, opts: ProfileOptions): LearnerProfile {
  const limit = opts.limit ?? 5;
  const title = (id: string) => opts.titleOf?.(id) ?? null;
  const states = Object.values(model.states);
  const outcome = (s: ConceptState): ProfileOutcome => ({
    outcomeId: s.outcomeId,
    title: title(s.outcomeId),
    onOwn: s.unassistedMastery,
    withHelp: s.assistedPerformance,
    answers: s.answerObservations,
  });

  const secure = states
    .filter((s) => s.masteredAt)
    .sort((a, b) => time(b.masteredAt) - time(a.masteredAt) || byId(a, b))
    .slice(0, limit)
    .map(outcome);
  const weak = states
    .filter(needsWork)
    .sort((a, b) => a.unassistedMastery - b.unassistedMastery || byId(a, b))
    .slice(0, limit)
    .map(outcome);
  const helped = states
    .filter(helpCarries)
    .sort((a, b) => b.assistedPerformance - a.assistedPerformance || byId(a, b))
    .slice(0, limit)
    .map(outcome);
  const due = states
    .filter((s) => s.nextReviewAt && Date.parse(s.nextReviewAt) <= opts.now)
    .sort((a, b) => time(a.nextReviewAt) - time(b.nextReviewAt) || byId(a, b))
    .slice(0, limit)
    .map(outcome);
  const wrongIdeas = states
    .flatMap((s) =>
      confirmedMisconceptions(s).map((m) => ({
        outcomeId: s.outcomeId,
        title: title(s.outcomeId),
        label: m.label,
        count: m.count,
        items: m.items.length,
        lastAt: m.lastAt,
      })),
    )
    .sort((a, b) => b.count - a.count || time(b.lastAt) - time(a.lastAt) || byId(a, b))
    .slice(0, limit)
    .map(({ lastAt: _lastAt, ...w }) => w);

  const answered = states.filter((s) => s.answerObservations > 0);
  const answersTotal = answered.reduce((n, s) => n + s.answerObservations, 0);
  const answersOnOwn = answered.reduce((n, s) => n + s.unassistedObservations, 0);
  const lastActiveAt = states.reduce<string | null>(
    (latest, s) => (s.lastPracticedAt && time(s.lastPracticedAt) > time(latest) ? s.lastPracticedAt : latest),
    null,
  );

  const profile = {
    outcomesSeen: answered.length,
    answersTotal,
    answersOnOwn,
    secure,
    needsWork: weak,
    withHelpOnly: helped,
    wrongIdeas,
    dueForReview: due,
    lastActiveAt,
  };
  return {
    ...profile,
    gainPerMinute: opts.metric?.gainPerMinute ?? null,
    learningMinutes: opts.metric?.learningMinutes ?? null,
    summary: summarise(profile),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const nameOf = (o: { outcomeId: string; title: string | null }) => o.title ?? o.outcomeId;
const list = (os: { outcomeId: string; title: string | null }[]) => os.map(nameOf).join(', ');

function summarise(p: Omit<LearnerProfile, 'summary' | 'gainPerMinute' | 'learningMinutes'>): string {
  if (p.answersTotal === 0) return 'No answers yet.';
  const parts = [
    `Answered ${plural(p.answersTotal, 'question', 'questions')} (${p.answersOnOwn} on their own) across ${plural(p.outcomesSeen, 'topic', 'topics')}.`,
  ];
  if (p.secure.length) parts.push(`Secure: ${list(p.secure)}.`);
  if (p.needsWork.length) parts.push(`Needs work: ${list(p.needsWork)}.`);
  if (p.withHelpOnly.length) parts.push(`Does it only with help: ${list(p.withHelpOnly)}.`);
  if (p.wrongIdeas.length) {
    const ideas = p.wrongIdeas.map((w) => (w.label ? `"${w.label}" (${nameOf(w)})` : `a repeated wrong idea (${nameOf(w)})`));
    parts.push(`Keeps thinking: ${ideas.join('; ')}.`);
  }
  if (p.dueForReview.length) parts.push(`Due for review: ${list(p.dueForReview)}.`);
  return parts.join(' ');
}
