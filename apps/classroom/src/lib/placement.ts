import type { DiagnosticSession } from '@ai-tutor/diagnostic';
import { initialMastery, type GraphIndex, type Mastery } from '@ai-tutor/knowledge-graph';
import { SYLLABI } from './content';
import { hasPlacementFor, type DiagnosticData } from './diagnosticData';
import {
  EMPTY_PLACEMENT,
  placementStore,
  type PlacementRecord,
  type PlacementState,
  type SavedSitting,
} from '../stores/placement';
import { profileStore, type StudentProfile } from '../stores/profile';
import { currentKlass } from '../stores/settings';

/**
 * THE MANDATORY PLACEMENT TEST: WHAT IS OWED, AND WHAT IT SHUTS.
 *
 * Aarav, 2026-09-30: the test is not skippable, it is taken per chosen subject,
 * it may be paused and finished later, and no class opens before it is done.
 * The questions are the knowledge-space engine's (packages/diagnostic) — this
 * file decides only WHICH subjects are owed and WHERE that matters.
 *
 * Pure where it can be, so the Gate (App.tsx), Home and the test screen read
 * one answer to "is this student placed?" rather than three.
 */

/**
 * The subjects a student is being placed in: their own choice from onboarding,
 * or — for a profile from before onboarding asked — whatever the syllabus
 * covers for the class, which is the honest answer rather than a list we
 * would be inventing.
 */
export const subjectsForClass = (klass: number, chosen: readonly string[]): string[] =>
  chosen.length > 0
    ? [...chosen]
    : Array.from(new Set(SYLLABI.filter((s) => s.klass === klass).map((s) => s.subject)));

/**
 * THE SUBJECTS THAT HAVE A TEST TO TAKE, in the order the student chose them.
 *
 * A subject with no Learning Outcome Map for this class cannot be placed, so it
 * is not owed: owing it would shut every class behind a test that does not
 * exist. Class 12 has no map today (packages/knowledge-graph/data), so a Class
 * 12 student owes nothing and their classes stay open.
 */
export const placementSubjects = (klass: number, chosen: readonly string[]): string[] =>
  subjectsForClass(klass, chosen).filter((subject) => hasPlacementFor(klass, subject));

/** One record per class and subject: a Class 9 placement is not a Class 10 one. */
export const placementKey = (klass: number, subject: string): string => `${klass}|${subject}`;

/** A row read back from storage or the cloud, made safe to read field by field. */
function normal(state: PlacementState | null | undefined): PlacementState {
  if (!state || typeof state !== 'object') return EMPTY_PLACEMENT;
  return {
    version: 1,
    records:
      state.records && typeof state.records === 'object' && !Array.isArray(state.records)
        ? state.records
        : {},
    retaking: Array.isArray(state.retaking) ? state.retaking.filter((k) => typeof k === 'string') : [],
  };
}

/**
 * A STUDENT WHO TOOK THE OLD ONE-SITTING TEST IS PLACED.
 *
 * Before this, the test was one sitting across every chosen subject and its
 * result went to `profile.diagnostic` with nothing here. Asking that student
 * again would throw their result away in all but name, so a result with no
 * records beside it counts as every current subject placed, at the moment it
 * was taken.
 *
 * Only while there are NO records: the moment anything is written here this
 * stops applying, which is what makes a later change of class or subjects a
 * new placement. `adoptLegacyPlacement` writes this down on the first visit
 * with this build, so it is adopted against the class the device has THEN.
 *
 * A student who skipped has no result, so nothing is adopted and the test is
 * owed — which is the point.
 */
export function withLegacy(
  state: PlacementState,
  profile: StudentProfile,
  klass: number,
): PlacementState {
  const current = normal(state);
  if (Object.keys(current.records).length > 0 || profile.diagnostic === null) return current;
  const at = profile.diagnosedAt ?? new Date(0).toISOString();
  const records: Record<string, PlacementRecord> = {};
  for (const subject of placementSubjects(klass, profile.subjects)) {
    records[placementKey(klass, subject)] = { completedAt: at, open: null, finished: null, legacy: true };
  }
  return { ...current, records };
}

/** Write the adoption above down, once. A no-op for everyone it does not apply to. */
export function adoptLegacyPlacement(): void {
  const klass = currentKlass();
  if (klass === null) return;
  const before = normal(placementStore.get());
  const after = withLegacy(before, profileStore.get(), klass);
  if (after.records !== before.records && Object.keys(after.records).length > 0) {
    placementStore.set(after);
  }
}

export interface PlacementStatus {
  /** Every chosen subject that has a test, in the order chosen. */
  subjects: string[];
  /** Never placed. While this is not empty, no class or lesson opens. */
  owed: string[];
  /** Placed before, being sat again because the student asked to. */
  retaking: string[];
  /** Answers so far in the sitting that is open, per subject. */
  answered: Record<string, number>;
}

export function placementStatus(
  state: PlacementState,
  profile: StudentProfile,
  klass: number | null,
): PlacementStatus {
  if (klass === null) return { subjects: [], owed: [], retaking: [], answered: {} };
  const current = withLegacy(state, profile, klass);
  const subjects = placementSubjects(klass, profile.subjects);
  const owed: string[] = [];
  const retaking: string[] = [];
  const answered: Record<string, number> = {};
  for (const subject of subjects) {
    const key = placementKey(klass, subject);
    const record = current.records[key];
    answered[subject] = record?.open?.answers?.length ?? 0;
    if (!record?.completedAt) owed.push(subject);
    else if (current.retaking.includes(key)) retaking.push(subject);
  }
  return { subjects, owed, retaking, answered };
}

/** The status for whoever is on this device now — for code outside a render. */
export const currentPlacementStatus = (): PlacementStatus =>
  placementStatus(placementStore.get(), profileStore.get(), currentKlass());

// ------------------------------------------------------------------ writers --

function write(klass: number, change: (state: PlacementState) => PlacementState): PlacementState {
  const next = change(withLegacy(placementStore.get(), profileStore.get(), klass));
  placementStore.set(next);
  return next;
}

/** After every answer: where this subject's sitting has got to. */
export function recordProgress(klass: number, subject: string, sitting: SavedSitting): PlacementState {
  const key = placementKey(klass, subject);
  return write(klass, (state) => ({
    ...state,
    records: {
      ...state.records,
      [key]: {
        completedAt: state.records[key]?.completedAt ?? null,
        finished: state.records[key]?.finished ?? null,
        open: sitting,
      },
    },
  }));
}

/** A subject's test finished: placed, its sitting kept, and out of any retake. */
export function recordFinished(klass: number, subject: string, sitting: SavedSitting): PlacementState {
  const key = placementKey(klass, subject);
  return write(klass, (state) => ({
    ...state,
    records: {
      ...state.records,
      [key]: { completedAt: new Date().toISOString(), open: null, finished: sitting },
    },
    retaking: state.retaking.filter((k) => k !== key),
  }));
}

/**
 * The student asked to sit it again. Every subject joins the retake; none of
 * them stops being placed, so no class shuts while they do it. A retake already
 * open is left alone, which also makes this safe to call twice.
 */
export function startRetake(klass: number, subjects: readonly string[]): PlacementState {
  return write(klass, (state) => {
    if (state.retaking.some((key) => subjects.some((s) => placementKey(klass, s) === key))) return state;
    const records = { ...state.records };
    for (const subject of subjects) {
      const key = placementKey(klass, subject);
      if (records[key]) records[key] = { ...records[key], open: null };
    }
    return { ...state, records, retaking: subjects.map((s) => placementKey(klass, s)) };
  });
}

// --------------------------------------------------------- saving a sitting --

/** The starting prior of a map — what a saved sitting is a difference from. */
const priorOf = (index: GraphIndex): Mastery => initialMastery(index, { biasByDifficulty: true });

function sparse(mastery: Mastery, prior: Mastery): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, belief] of Object.entries(mastery)) {
    if (prior[id] !== belief) out[id] = belief;
  }
  return out;
}

export function saveSitting(
  session: DiagnosticSession,
  before: Mastery,
  index: GraphIndex,
  klass: number,
  subjects: readonly string[],
): SavedSitting {
  const prior = priorOf(index);
  return {
    version: 1,
    klass,
    subjects: [...subjects],
    mastery: sparse(session.mastery, prior),
    before: sparse(before, prior),
    answers: session.answers.map((a) => ({ ...a })),
    asked: [...session.askedNodeIds],
    seeded: [...session.seeded],
    config: { ...session.config, subjects: [...session.config.subjects] },
    savedAt: new Date().toISOString(),
  };
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

const isRecord = (value: unknown): value is Record<string, number> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/**
 * A saved sitting, back as the session it was — or null when it cannot be.
 *
 * Null for a sitting of another class or other subjects, and for one whose
 * answers name an outcome or a question this map no longer has (the map was
 * regenerated under it by an app update). Resuming either would be resuming a
 * different test; the screen starts a fresh sitting instead. The abandoned
 * answers are not lost — every one went to the ledger as it was given
 * (lib/diagnosticLedger.ts), which is what the learner model is built from.
 *
 * Null, too, for a row that is not the shape this build writes. It comes back
 * from localStorage and from the cloud, where any build may have written it,
 * and the screen restores it inside a state initializer: a field read off
 * something that is not there would throw on every visit, and a mandatory test
 * that throws on every visit is a student who can never open a class.
 */
export function restoreSitting(
  saved: SavedSitting | null | undefined,
  data: DiagnosticData,
  klass: number,
  subjects: readonly string[],
): { session: DiagnosticSession; before: Mastery } | null {
  if (!saved || typeof saved !== 'object' || saved.version !== 1 || saved.klass !== klass) return null;
  if (!Array.isArray(saved.subjects) || !sameSet(saved.subjects, subjects)) return null;
  if (!Array.isArray(saved.answers) || !isRecord(saved.mastery) || !isRecord(saved.before)) return null;
  if (!saved.config || typeof saved.config !== 'object' || !Array.isArray(saved.config.subjects)) {
    return null;
  }
  if (saved.config.klass !== klass || !Number.isFinite(saved.config.maxQuestions)) return null;
  if (!isStringList(saved.asked) || !isStringList(saved.seeded)) return null;
  const probes = new Set(data.bank.probes.map((p) => p.id));
  for (const answer of saved.answers) {
    if (!answer || typeof answer !== 'object') return null;
    if (!data.index.node(answer.nodeId) || !probes.has(answer.probeId)) return null;
  }
  const prior = priorOf(data.index);
  return {
    session: {
      mastery: { ...prior, ...saved.mastery },
      answers: saved.answers.map((a) => ({ ...a })),
      askedNodeIds: new Set(saved.asked),
      seeded: new Set(saved.seeded),
      config: { ...saved.config, subjects: [...saved.config.subjects] },
    },
    before: { ...prior, ...saved.before },
  };
}

// ---------------------------------------------------------------- the Gate --

/**
 * EVERY ROUTE THAT OPENS A CLASS OR SOMETHING INSIDE ONE.
 *
 * /lesson/<id> is a recorded class, /class/... is a topic taught live (and the
 * typed "teach me this" at /class?topic=), /quiz/<id> is a lesson's practice
 * test, /complete/<id> is a lesson's last screen. The catalogue (/syllabus,
 * /chapter/...) stays open: looking at what is ahead opens nothing, and every
 * tap inside it lands on one of these.
 */
const GATED = /^\/(lesson|class|quiz|complete)(\/|$)/;

export const isPlacementGated = (pathname: string): boolean => GATED.test(pathname);

/**
 * WHERE TO GO AFTER THE TEST, from a `next` the Gate wrote — or null.
 *
 * Only a path inside this app: a `next` is in the address bar, so anyone can
 * write one, and "finish your test and we will send you on" must never send a
 * child to another site.
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  if (raw === '/diagnostic' || raw.startsWith('/diagnostic?') || raw.startsWith('/diagnostic/')) {
    return null;
  }
  return raw;
}
