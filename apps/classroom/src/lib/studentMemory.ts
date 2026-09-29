/**
 * WHAT MEERA REMEMBERS ABOUT A STUDENT (Aarav, 2026-09-29: "their personal
 * memory helps it communicate better").
 *
 * A tutor who sees a child every week knows what they like, which topic was
 * hard last time, what they asked about, where they stopped, and what they
 * promised to do. Before this file the tutor knew the class, a mastery number
 * for the current lesson, a streak, and nothing else — every doubt started
 * from zero.
 *
 * WHAT IS KEPT, AND WHAT IS NOT. On the DEVICE only (localStorage), and only
 * what a tutor would jot in a notebook:
 *   - interests, from a FIXED list the student taps at onboarding — never free
 *     text, so nothing a child typed can ride into a prompt;
 *   - topics that were hard (a wrong answer), topics that went well (right with
 *     no help), and topics they raised a hand about — the lesson's own topic
 *     line, never the child's words;
 *   - the last class and how far it got, and the one-line commitment they
 *     accepted at the end of a class.
 * No name (the greeting reads the profile directly), no transcripts, no
 * answers. `forgetMemory` clears it. Server-side memory waits for the LMS
 * lane's tables (the learner entity, TD6); until then a new phone starts fresh.
 *
 * It reaches her through `memoryNotes` — a few private lines in the persona's
 * notes block, which the prompt tells her never to read out — and through
 * `greetingMemory`, which the class's first line uses.
 */

import type { TutorLanguage } from './workspace';
import { registerDeviceReset } from '../stores/localStore';

const KEY = 'qrie:student-memory';
const MAX_TOPICS = 8;
const MAX_TOPIC_CHARS = 80;
const DAY = 86_400_000;

/** The list a student picks from. Ids are stored; labels are shown. */
export const INTERESTS = [
  { id: 'cricket', label: 'Cricket', emoji: '🏏' },
  { id: 'football', label: 'Football', emoji: '⚽' },
  { id: 'music', label: 'Music', emoji: '🎵' },
  { id: 'dance', label: 'Dance', emoji: '💃' },
  { id: 'drawing', label: 'Drawing', emoji: '🎨' },
  { id: 'cooking', label: 'Cooking', emoji: '🍳' },
  { id: 'gaming', label: 'Gaming', emoji: '🎮' },
  { id: 'movies', label: 'Movies', emoji: '🎬' },
  { id: 'animals', label: 'Animals', emoji: '🐾' },
  { id: 'space', label: 'Space', emoji: '🚀' },
  { id: 'reading', label: 'Reading', emoji: '📚' },
  { id: 'building', label: 'Building things', emoji: '🛠️' },
] as const;
export type InterestId = (typeof INTERESTS)[number]['id'];
const INTEREST_IDS: ReadonlySet<string> = new Set(INTERESTS.map((i) => i.id));

interface TopicMark {
  topic: string;
  lessonId: string;
  at: number;
  count: number;
  /** A later unassisted win on the same topic. */
  resolved?: boolean;
}

export interface StudentMemory {
  version: 1;
  interests: InterestId[];
  struggles: TopicMark[];
  wins: TopicMark[];
  doubts: TopicMark[];
  lastSession?: { lessonId: string; title: string; at: number; beatsDone: number; total: number };
  commitment?: { text: string; lessonTitle: string; at: number };
}

const empty = (): StudentMemory => ({ version: 1, interests: [], struggles: [], wins: [], doubts: [] });

const clip = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, MAX_TOPIC_CHARS);

export function readMemory(): StudentMemory {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const m = JSON.parse(raw) as Partial<StudentMemory>;
    if (m?.version !== 1) return empty();
    return {
      version: 1,
      interests: (m.interests ?? []).filter((i): i is InterestId => INTEREST_IDS.has(i)),
      struggles: Array.isArray(m.struggles) ? m.struggles : [],
      wins: Array.isArray(m.wins) ? m.wins : [],
      doubts: Array.isArray(m.doubts) ? m.doubts : [],
      ...(m.lastSession ? { lastSession: m.lastSession } : {}),
      ...(m.commitment ? { commitment: m.commitment } : {}),
    };
  } catch {
    // A corrupt or unreadable store is a fresh notebook, never a broken class.
    return empty();
  }
}

function write(m: StudentMemory): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    // Private mode or a full store: she simply will not remember.
  }
}

function mark(list: readonly TopicMark[], at: { topic: string; lessonId: string }, now: number): TopicMark[] {
  const topic = clip(at.topic);
  if (topic === '') return [...list];
  const found = list.find((x) => x.topic === topic);
  const rest = list.filter((x) => x.topic !== topic);
  const next: TopicMark = found
    ? { ...found, at: now, count: found.count + 1, resolved: false }
    : { topic, lessonId: at.lessonId, at: now, count: 1 };
  return [...rest, next].sort((a, b) => a.at - b.at).slice(-MAX_TOPICS);
}

export function setInterests(ids: readonly string[]): void {
  const m = readMemory();
  write({ ...m, interests: [...new Set(ids.filter((i): i is InterestId => INTEREST_IDS.has(i)))] });
}

/** A wrong answer on this topic. */
export function recordStruggle(at: { topic: string; lessonId: string }, now = Date.now()): void {
  const m = readMemory();
  write({ ...m, struggles: mark(m.struggles, at, now) });
}

/** A right answer with no help on this topic; a matching struggle is marked resolved. */
export function recordWin(at: { topic: string; lessonId: string }, now = Date.now()): void {
  const m = readMemory();
  const topic = clip(at.topic);
  write({
    ...m,
    wins: mark(m.wins, at, now),
    struggles: m.struggles.map((s) => (s.topic === topic ? { ...s, resolved: true } : s)),
  });
}

/** A hand raised on this topic — the lesson's topic line, never the child's words. */
export function recordDoubtTopic(at: { topic: string; lessonId: string }, now = Date.now()): void {
  const m = readMemory();
  write({ ...m, doubts: mark(m.doubts, at, now) });
}

export function setLastSession(
  s: { lessonId: string; title: string; beatsDone: number; total: number },
  now = Date.now(),
): void {
  const m = readMemory();
  write({ ...m, lastSession: { ...s, title: clip(s.title), at: now } });
}

export function setCommitment(c: { text: string; lessonTitle: string }, now = Date.now()): void {
  const m = readMemory();
  write({ ...m, commitment: { text: clip(c.text), lessonTitle: clip(c.lessonTitle), at: now } });
}

export function clearCommitment(): void {
  const m = readMemory();
  const { commitment: _drop, ...rest } = m;
  write(rest);
}

export function forgetMemory(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}

// A phone handed to the next student, or a student deleted, clears this too.
registerDeviceReset(KEY, forgetMemory);

const ago = (at: number, now: number, lang: TutorLanguage): string => {
  const days = Math.floor((now - at) / DAY);
  if (lang === 'hi-en') return days <= 0 ? 'aaj' : days === 1 ? 'kal' : `${days} din pehle`;
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};

const labelOf = (id: InterestId): string => INTERESTS.find((i) => i.id === id)?.label.toLowerCase() ?? id;

/**
 * A few private notes for her prompt. Plain facts, each one actionable — what
 * to reach for, what to check, what to build on. Empty when there is nothing.
 */
export function memoryNotes(lang: TutorLanguage, now = Date.now()): string[] {
  const m = readMemory();
  const notes: string[] = [];
  if (m.interests.length > 0) {
    const likes = m.interests.map(labelOf).join(', ');
    notes.push(
      lang === 'hi-en'
        ? `They enjoy ${likes}. When an everyday example would help, take it from these (in Hinglish), but never force it.`
        : `They enjoy ${likes}. When an everyday example would help, take it from these, but never force it.`,
    );
  }
  const hard = m.struggles.filter((s) => !s.resolved).slice(-3);
  if (hard.length > 0) {
    notes.push(
      `Recently found hard: ${hard.map((s) => `"${s.topic}" (${s.count} miss${s.count > 1 ? 'es' : ''}, ${ago(s.at, now, 'en')})`).join('; ')}. If today touches these, check that part gently first.`,
    );
  }
  const fixed = m.struggles.filter((s) => s.resolved).slice(-2);
  if (fixed.length > 0) {
    notes.push(`Got past earlier trouble with: ${fixed.map((s) => `"${s.topic}"`).join(', ')} — worth a word of recognition if it comes up.`);
  }
  const wins = m.wins.slice(-3);
  if (wins.length > 0) notes.push(`Answered well on their own: ${wins.map((w) => `"${w.topic}"`).join(', ')}. Build on these.`);
  const doubts = m.doubts.slice(-3);
  if (doubts.length > 0) notes.push(`Raised a hand before about: ${doubts.map((d) => `"${d.topic}"`).join(', ')}.`);
  if (m.lastSession) {
    const s = m.lastSession;
    const done = s.beatsDone >= s.total ? 'finished it' : `stopped ${s.beatsDone} of ${s.total} steps in`;
    notes.push(`Last class: "${s.title}", ${ago(s.at, now, 'en')} — ${done}.`);
  }
  if (m.commitment) notes.push(`They promised themselves: "${m.commitment.text}". Encourage it; never scold if it did not happen.`);
  return notes;
}

/** What the class's first line needs: the last class, the commitment, one open struggle. */
export function greetingMemory(): {
  lastTitle?: string;
  lastLessonId?: string;
  commitment?: { text: string; lessonTitle: string };
  struggle?: string;
} {
  const m = readMemory();
  const open = m.struggles.filter((s) => !s.resolved);
  return {
    ...(m.lastSession ? { lastTitle: m.lastSession.title, lastLessonId: m.lastSession.lessonId } : {}),
    ...(m.commitment ? { commitment: { text: m.commitment.text, lessonTitle: m.commitment.lessonTitle } } : {}),
    ...(open.length > 0 ? { struggle: open[open.length - 1].topic } : {}),
  };
}

/** One planner line from their interests, or none (live class prep, LiveClass.tsx). */
export function interestLine(): string[] {
  const likes = readMemory().interests.map(labelOf);
  return likes.length > 0
    ? [`The student enjoys ${likes.join(', ')}. Where a real-life example would help, prefer one from these.`]
    : [];
}
