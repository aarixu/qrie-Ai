import type { ConceptState } from './types.ts';

/**
 * A WRONG IDEA, AS THE MODEL HOLDS IT FOR ONE OUTCOME (learner-model v4).
 *
 * Kept per outcome in `ConceptState.misconceptions`, keyed by an id that is
 * either the normalised label (`normaliseMisconception`) or, for a wrong option
 * that names no idea, `option:<item key>#<option index>`. A normalised label
 * holds only letters, digits and single spaces, so the two kinds never collide.
 *
 * Labels are free text today (the spec counts 14,017 distinct among 14,091),
 * so two wordings of one idea are matched by their content words
 * (`similarMisconceptions`) and folded into the entry seen first; a taxonomy
 * across items is content work for later.
 */
export interface Misconception {
  /** The wording first seen, capped; null when only an item and an option are known. */
  label: string | null;
  /** Wrong answers folded into it. */
  count: number;
  /** Distinct item keys it was shown on, first seen first, at most `items`. */
  items: string[];
  /** Distinct sittings (session ids) it was shown in, first seen first, at most `items`. */
  sittings: string[];
  /** Session clock of the first and the latest wrong answer that showed it. */
  firstAt: string;
  lastAt: string;
  /** When two later cold right answers the server graded, on distinct items, cleared it; null while it stands. */
  clearedAt: string | null;
  /** Distinct items answered right cold, and graded by the server, since `lastAt`, toward clearing it. */
  clearing: string[];
}

/** The bounds that keep one learner's record small (review SF12). */
export const MISCONCEPTION_LIMITS = {
  /** Ideas kept per outcome. */
  perOutcome: 20,
  /** Characters of a label, before it is normalised into an id. */
  label: 120,
  /** Items, and sittings, remembered per idea. */
  items: 8,
} as const;

/** Two labels whose content words overlap at least this much name one idea. */
export const SIMILAR_LABELS = 0.5;

/** Cold right answers the server graded, on distinct items, after the last wrong one, that clear an idea. */
export const CLEARING_RIGHTS = 2;

/**
 * Words that frame a label rather than say what the idea is: "thinks",
 * "confuses", "the". Left in, every "confuses X with Y" would look like every
 * other one.
 */
const FRAME_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'assume', 'assumes', 'at', 'be', 'been', 'being', 'believe', 'believes', 'by',
  'can', 'confuse', 'confuses', 'do', 'does', 'for', 'from', 'has', 'have', 'idea', 'in', 'into', 'is', 'it',
  'its', 'like', 'must', 'not', 'of', 'on', 'only', 'or', 'student', 'students', 'than', 'that', 'the', 'their',
  'them', 'they', 'think', 'thinks', 'this', 'to', 'when', 'which', 'with',
]);

/**
 * A label as an id: capped at `MISCONCEPTION_LIMITS.label` characters, lower
 * case, every run of anything that is not a letter or a digit collapsed to one
 * space, trimmed. Empty when nothing is left.
 */
export function normaliseMisconception(label: string): string {
  return label
    .slice(0, MISCONCEPTION_LIMITS.label)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function contentWords(label: string): Set<string> {
  return new Set(
    normaliseMisconception(label)
      .split(' ')
      .filter((w) => w.length > 2 && !FRAME_WORDS.has(w)),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Whether two labels name one idea: content-word Jaccard at or above `SIMILAR_LABELS`. */
export function similarMisconceptions(a: string, b: string): boolean {
  return overlap(contentWords(a), contentWords(b)) >= SIMILAR_LABELS;
}

/** Shown on two distinct items, or in two sittings — and not cleared since. */
export function isConfirmed(m: Misconception): boolean {
  return m.clearedAt === null && (m.items.length >= 2 || m.sittings.length >= 2);
}

/**
 * THE WRONG IDEAS THIS OUTCOME'S EVIDENCE CONFIRMS, most shown first.
 *
 * One wrong answer is a slip, and is not here. Confirmed is 2+ distinct items
 * or 2+ sittings; a cleared idea is not here until it is shown again.
 */
export function confirmedMisconceptions(state: ConceptState): Array<Misconception & { id: string }> {
  return Object.entries(state.misconceptions ?? {})
    .filter(([, m]) => isConfirmed(m))
    .map(([id, m]) => ({ id, ...m }))
    .sort((x, y) => y.count - x.count || Date.parse(y.lastAt) - Date.parse(x.lastAt) || (x.id < y.id ? -1 : 1));
}

/** One wrong answer that showed an idea. */
export interface WrongIdea {
  /** The label the answer carried (a bank distractor's, or the judge's), if any. */
  label?: string;
  itemKey: string;
  /** The wrong option chosen, when the surface offered options. */
  chosenIndex: number | null;
  sessionId: string;
  /** The session clock. */
  at: string;
}

type Ideas = Record<string, Misconception>;

const addCapped = (list: readonly string[], value: string): string[] =>
  list.includes(value) || list.length >= MISCONCEPTION_LIMITS.items ? [...list] : [...list, value];

/**
 * Which entry a wrong answer belongs to, or null when it names no idea at all
 * (a skip, or a spoken miss with no label). A label joins the entry with the
 * same id, else the most similar labelled entry, ties to the smaller id so the
 * choice cannot depend on key order (jsonb does not keep it).
 */
function entryFor(ideas: Ideas, wrong: WrongIdea): { id: string; label: string | null } | null {
  const label = wrong.label?.trim().slice(0, MISCONCEPTION_LIMITS.label) ?? '';
  const id = normaliseMisconception(label);
  if (id !== '') {
    if (ideas[id]) return { id, label };
    const words = contentWords(label);
    let best: { id: string; score: number } | null = null;
    for (const [other, m] of Object.entries(ideas)) {
      if (m.label === null) continue;
      const score = overlap(words, contentWords(m.label));
      if (score < SIMILAR_LABELS) continue;
      if (!best || score > best.score || (score === best.score && other < best.id)) best = { id: other, score };
    }
    return best ? { id: best.id, label: ideas[best.id].label } : { id, label };
  }
  if (wrong.chosenIndex !== null && wrong.chosenIndex >= 0) {
    return { id: `option:${wrong.itemKey}#${wrong.chosenIndex}`, label: null };
  }
  return null;
}

/**
 * The one dropped to make room: a slip or a cleared idea before a standing
 * confirmed one, then the longest unseen, then the least shown, then by id.
 */
function evictOne(ideas: Ideas): Ideas {
  const [drop] = Object.entries(ideas).sort(
    ([a, x], [b, y]) =>
      Number(isConfirmed(x)) - Number(isConfirmed(y)) ||
      Date.parse(x.lastAt) - Date.parse(y.lastAt) ||
      x.count - y.count ||
      (a < b ? -1 : 1),
  )[0];
  const { [drop]: _gone, ...rest } = ideas;
  return rest;
}

/** A wrong answer, added to what the outcome remembers. Pure. */
export function recordWrongIdea(ideas: Ideas, wrong: WrongIdea): Ideas {
  const entry = entryFor(ideas, wrong);
  if (!entry) return ideas;
  const prev = ideas[entry.id];
  if (prev) {
    return {
      ...ideas,
      [entry.id]: {
        ...prev,
        count: prev.count + 1,
        items: addCapped(prev.items, wrong.itemKey),
        sittings: addCapped(prev.sittings, wrong.sessionId),
        lastAt: wrong.at,
        // Shown again: whatever had cleared it, or was on the way to, starts over.
        clearedAt: null,
        clearing: [],
      },
    };
  }
  const room = Object.keys(ideas).length >= MISCONCEPTION_LIMITS.perOutcome ? evictOne(ideas) : ideas;
  return {
    ...room,
    [entry.id]: {
      label: entry.label,
      count: 1,
      items: [wrong.itemKey],
      sittings: [wrong.sessionId],
      firstAt: wrong.at,
      lastAt: wrong.at,
      clearedAt: null,
      clearing: [],
    },
  };
}

/**
 * A cold right answer on `itemKey`: a step toward clearing every idea still
 * standing on this outcome, and the clearing itself at the second distinct
 * item. The caller decides what counts: cold (rung 0, and not straight after
 * being shown it) and graded by the server (fold.ts, P2 security review F4).
 * Pure.
 */
export function recordColdRight(ideas: Ideas, itemKey: string, at: string): Ideas {
  let next: Ideas | null = null;
  for (const [id, m] of Object.entries(ideas)) {
    if (m.clearedAt !== null || m.clearing.includes(itemKey)) continue;
    const clearing = [...m.clearing, itemKey];
    next ??= { ...ideas };
    next[id] = { ...m, clearing, clearedAt: clearing.length >= CLEARING_RIGHTS ? at : null };
  }
  return next ?? ideas;
}
