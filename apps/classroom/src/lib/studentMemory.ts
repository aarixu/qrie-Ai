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
 * WHAT IS KEPT, AND WHAT IS NOT. On the DEVICE (localStorage), and only what a
 * tutor would jot in a notebook:
 *   - interests, from a FIXED list the student taps at onboarding — never free
 *     text;
 *   - topics that were hard (a wrong answer), topics that went well (right with
 *     no help), and topics they raised a hand about — the topic line of an
 *     AUTHORED or reviewed class only (ClassRoom's `remember`), never the
 *     child's words and never the title of a page they brought in;
 *   - the last class and how far it got, and the promise they picked at the end
 *     of a class (stored as an id, spoken once, then cleared).
 * No name, no answers, no transcripts.
 *
 * WHERE IT GOES. `memoryNotes` become a few private lines in the doubt tutor's
 * prompt (sent through the relay to Google Vertex, like the rest of a doubt);
 * `greetingMemory` feeds the class's first spoken line. Nothing here reaches
 * class preparation for a class that could be kept (LiveClass.tsx).
 *
 * WHEN IT IS CLEARED. Account deletion and a different signed-in student on the
 * same phone (`registerDeviceReset`); "Reset progress" clears everything but the
 * interests (`forgetProgressMemory`). A TRIAL (`mayPersist()` false: no consent
 * yet, a kiosk, a guest) neither reads nor writes it — a guest never hears, and
 * is never briefed from, another child's notebook.
 */

import { mayPersist, type TutorLanguage } from './workspace';
import { registerDeviceReset } from '../stores/localStore';

const KEY = 'qrie:student-memory';
/** Written by the first greeting build (2026-09-29, one commit); cleared with the rest. */
const OLD_LAST_CLASS_KEY = 'qrie:last-class';
const MAX_TOPICS = 8;
const MAX_TOPIC_CHARS = 80;
/** Topics as they appear inside a note line — short, so the instruction survives the cap. */
const NOTE_TOPIC_CHARS = 40;
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

/**
 * The promises offered at the end of a class. Stored by id; the screen shows
 * English (app UI is English for everyone) and she SAYS it in the child's
 * language.
 */
export const PROMISES = {
  'no-hints-3': { en: '3 questions without hints', 'hi-en': '3 sawaal bina hint ke' },
  'revise-10': { en: 'revise this for 10 minutes', 'hi-en': '10 minute ka revision' },
  'explain-home': { en: 'explain it to someone at home', 'hi-en': 'ghar pe kisi ko samjhaana' },
} as const;
export type PromiseId = keyof typeof PROMISES;
const PROMISE_IDS: ReadonlySet<string> = new Set(Object.keys(PROMISES));

interface TopicMark {
  topic: string;
  lessonId: string;
  at: number;
  count: number;
  /** A later unassisted win on the same topic. */
  resolved?: boolean;
  /** When the greeting last named it, so it is named at most once. */
  mentionedAt?: number;
}

export interface StudentMemory {
  version: 1;
  interests: InterestId[];
  struggles: TopicMark[];
  wins: TopicMark[];
  doubts: TopicMark[];
  lastSession?: { lessonId: string; title: string; topicRef?: string; at: number; beatsDone: number; total: number };
  commitment?: { id: PromiseId; lessonTitle: string; at: number };
}

const empty = (): StudentMemory => ({ version: 1, interests: [], struggles: [], wins: [], doubts: [] });

/** One line of plain text: no quotes or backslashes (it is quoted in a prompt), capped. */
const clip = (s: string, max = MAX_TOPIC_CHARS): string =>
  s.replace(/["\\`]/g, "'").replace(/\s+/g, ' ').trim().slice(0, max);

/** Whether a remembered (clipped) class title is this class's title. */
export const sameTitle = (remembered: string, title: string): boolean =>
  clip(title).toLowerCase() === remembered.toLowerCase();

const isMark = (x: unknown): x is TopicMark => {
  const m = x as TopicMark | null;
  return (
    typeof m === 'object' &&
    m !== null &&
    typeof m.topic === 'string' &&
    typeof m.lessonId === 'string' &&
    Number.isFinite(m.at) &&
    Number.isFinite(m.count)
  );
};
const marks = (v: unknown): TopicMark[] =>
  Array.isArray(v) ? v.filter(isMark).map((m) => ({ ...m, topic: clip(m.topic) })).slice(-MAX_TOPICS) : [];

export function readMemory(): StudentMemory {
  // A trial persists nothing and is told nothing (see the header).
  if (!mayPersist()) return empty();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const m = JSON.parse(raw) as Partial<StudentMemory> | null;
    if (!m || m.version !== 1) return empty();
    const ls = m.lastSession;
    const cm = m.commitment;
    return {
      version: 1,
      interests: Array.isArray(m.interests) ? m.interests.filter((i): i is InterestId => INTEREST_IDS.has(i)) : [],
      struggles: marks(m.struggles),
      wins: marks(m.wins),
      doubts: marks(m.doubts),
      ...(ls && typeof ls.lessonId === 'string' && typeof ls.title === 'string' && Number.isFinite(ls.at)
        ? { lastSession: { ...ls, title: clip(ls.title) } }
        : {}),
      ...(cm && PROMISE_IDS.has(cm.id) && Number.isFinite(cm.at)
        ? { commitment: { id: cm.id, lessonTitle: clip(String(cm.lessonTitle ?? '')), at: cm.at } }
        : {}),
    };
  } catch {
    // A corrupt or unreadable store is a fresh notebook, never a broken class.
    return empty();
  }
}

function write(m: StudentMemory): void {
  if (!mayPersist()) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    // Private mode or a full store: she simply will not remember.
  }
}

function mark(list: readonly TopicMark[], at: { topic: string; lessonId: string }, now: number): TopicMark[] {
  const topic = clip(at.topic);
  if (topic === '') return [...list];
  const same = (x: TopicMark) => x.topic === topic && x.lessonId === at.lessonId;
  const found = list.find(same);
  const rest = list.filter((x) => !same(x));
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

/** A right answer with no help on this topic; the matching struggle is marked resolved. */
export function recordWin(at: { topic: string; lessonId: string }, now = Date.now()): void {
  const m = readMemory();
  const topic = clip(at.topic);
  write({
    ...m,
    wins: mark(m.wins, at, now),
    struggles: m.struggles.map((s) =>
      s.topic === topic && s.lessonId === at.lessonId ? { ...s, resolved: true } : s,
    ),
  });
}

/** A hand raised on this topic — the lesson's topic line, never the child's words. */
export function recordDoubtTopic(at: { topic: string; lessonId: string }, now = Date.now()): void {
  const m = readMemory();
  write({ ...m, doubts: mark(m.doubts, at, now) });
}

export function setLastSession(
  s: { lessonId: string; title: string; topicRef?: string; beatsDone: number; total: number },
  now = Date.now(),
): void {
  const m = readMemory();
  write({ ...m, lastSession: { ...s, title: clip(s.title), at: now } });
}

export function setCommitment(c: { id: PromiseId; lessonTitle: string }, now = Date.now()): void {
  if (!PROMISE_IDS.has(c.id)) return;
  const m = readMemory();
  write({ ...m, commitment: { id: c.id, lessonTitle: clip(c.lessonTitle), at: now } });
}

/** The promise has been said back to them once; it is not repeated at every class forever. */
export function clearCommitment(): void {
  const m = readMemory();
  const { commitment: _said, ...rest } = m;
  write(rest);
}

/** The greeting named this struggle; it is not named again. */
export function markStruggleMentioned(topic: string, lessonId: string, now = Date.now()): void {
  const m = readMemory();
  write({
    ...m,
    struggles: m.struggles.map((s) => (s.topic === topic && s.lessonId === lessonId ? { ...s, mentionedAt: now } : s)),
  });
}

/** "Reset progress": every mark, the last class and the promise go; the interests they chose stay. */
export function forgetProgressMemory(): void {
  const m = readMemory();
  write({ version: 1, interests: m.interests, struggles: [], wins: [], doubts: [] });
}

export function forgetMemory(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(OLD_LAST_CLASS_KEY);
  } catch {
    // Nothing to forget.
  }
}

// Account deletion, or a different signed-in student on this phone, clears it.
registerDeviceReset(KEY, forgetMemory);

const ago = (at: number, now: number): string => {
  const days = Math.floor((now - at) / DAY);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};

const labelOf = (id: InterestId): string => INTERESTS.find((i) => i.id === id)?.label.toLowerCase() ?? id;
const noteTopic = (t: string): string => `"${clip(t, NOTE_TOPIC_CHARS)}"`;

/**
 * At most six private notes for her prompt, most useful first (the promise and
 * open trouble before history), each short enough that its instruction
 * survives the persona's 300-character cap. Empty when there is nothing.
 */
export function memoryNotes(lang: TutorLanguage, now = Date.now()): string[] {
  const m = readMemory();
  const notes: string[] = [];
  if (m.commitment) {
    notes.push(
      `At the end of last class they promised themselves: ${PROMISES[m.commitment.id].en}. Encourage it; never scold if it did not happen.`,
    );
  }
  const hard = m.struggles.filter((s) => !s.resolved).slice(-3);
  if (hard.length > 0) {
    notes.push(
      `Recently found hard: ${hard.map((s) => `${noteTopic(s.topic)} (${ago(s.at, now)})`).join('; ')}. If today touches these, check that part gently first.`,
    );
  }
  if (m.interests.length > 0) {
    const likes = m.interests.map(labelOf).join(', ');
    notes.push(
      `They enjoy ${likes}. When an everyday example would help, take it from these${lang === 'hi-en' ? ', in Hinglish' : ''} — never force it.`,
    );
  }
  if (m.lastSession) {
    const s = m.lastSession;
    const done = s.beatsDone >= s.total ? 'finished it' : `stopped ${s.beatsDone} of ${s.total} steps in`;
    notes.push(`Last class: ${noteTopic(s.title)}, ${ago(s.at, now)} — ${done}.`);
  }
  const wins = m.wins.slice(-3);
  if (wins.length > 0) notes.push(`Answered well on their own: ${wins.map((w) => noteTopic(w.topic)).join(', ')}. Build on these.`);
  const doubts = m.doubts.slice(-3);
  if (doubts.length > 0) notes.push(`Raised a hand before about: ${doubts.map((d) => noteTopic(d.topic)).join(', ')}.`);
  return notes.slice(0, 6);
}

/**
 * What the class's first line may say: the last class; the promise (then
 * cleared by the caller, once said); and ONE struggle — only from the last
 * class, missed at least twice, within three days, never named before.
 */
export function greetingMemory(lang: TutorLanguage, now = Date.now()): {
  lastTitle?: string;
  lastLessonId?: string;
  /** The syllabus topic of the last class — a topic prepared again keeps it under a new id and title. */
  lastTopicRef?: string;
  promise?: string;
  struggle?: { topic: string; lessonId: string };
} {
  const m = readMemory();
  const last = m.lastSession;
  const struggle = last
    ? m.struggles
        .filter(
          (s) =>
            !s.resolved &&
            s.mentionedAt === undefined &&
            s.lessonId === last.lessonId &&
            s.count >= 2 &&
            now - s.at < 3 * DAY,
        )
        .at(-1)
    : undefined;
  return {
    ...(last ? { lastTitle: last.title, lastLessonId: last.lessonId } : {}),
    ...(last && typeof last.topicRef === 'string' ? { lastTopicRef: last.topicRef } : {}),
    ...(m.commitment ? { promise: PROMISES[m.commitment.id][lang] } : {}),
    ...(struggle ? { struggle: { topic: struggle.topic, lessonId: struggle.lessonId } } : {}),
  };
}

/**
 * One planner line from their interests — for a class that is NEVER kept (a
 * free-text or brought-in page, no topicRef). A kept class is replayed to every
 * later student on the topic, so one child's hobbies must not shape it.
 */
export function interestLine(): string[] {
  const likes = readMemory().interests.map(labelOf);
  return likes.length > 0
    ? [`The student enjoys ${likes.join(', ')}. Where a real-life example would help, prefer one from these.`]
    : [];
}
