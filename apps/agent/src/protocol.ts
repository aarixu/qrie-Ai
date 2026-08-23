import type { AnswerSignal, Attendance, Klass, StudentContext } from '@ai-tutor/persona';

/**
 * THE BRIEFING CONTRACT — what the browser tells this service when a hand goes
 * up, and what the worker reads back out of the dispatch.
 *
 * The same object travels twice: the browser POSTs it to `/doubt`, the token
 * server stringifies it into the agent dispatch, and the worker parses it out
 * of `ctx.job.metadata`. Dispatch metadata is the right channel because it is
 * per-invocation: the beat is different for every raised hand, and a token
 * minted once at the start of the lesson cannot express that.
 *
 * Every parser here is total: it returns a value or null, and never throws.
 * This data crosses a network boundary from a browser, so "malformed" is a
 * normal input rather than an exception.
 */

/** The agent name the worker registers under, and the name dispatch targets. */
export const AGENT_NAME = 'ai-tutor-doubt';

/** Token server routes, exported so the browser does not hard-code strings. */
export const TOKEN_PATH = '/token';
export const DOUBT_PATH = '/doubt';
export const HEALTH_PATH = '/health';

/** One earlier moment of the class the tutor may put back on the board. */
export interface RecallableBeat {
  id: string;
  topic: string;
}

/**
 * Everything the live tutor is told when she takes over the room.
 *
 * This mirrors `DoubtContext` from @ai-tutor/doubt-session (which this service
 * cannot import — it is not a dependency of apps/agent) plus the student
 * factors @ai-tutor/persona adapts to. The field names follow persona's
 * `LessonContext`, because that is what they are fed into; the browser adapter
 * maps `visibleElementIds` to `onScreen` and `recentBeats` to `recallableBeats`.
 */
export interface DoubtBrief {
  lessonId: string;
  beatId: string;
  beatTopic: string;
  /** e.g. "Science". Optional: persona omits the line when it is absent. */
  subject?: string;
  /** The lesson's own title. */
  title?: string;
  /** Narration of every beat up to and including the one they paused on. */
  transcriptSoFar: string;
  /** Element ids on the canvas at the moment the hand went up. */
  onScreen: string[];
  /** The ONLY legal targets for recall. An id outside this list is refused. */
  recallableBeats: RecallableBeat[];
  /** LiveKit identity of the student, so the agent talks to the right person. */
  studentIdentity: string;
  /** What she calls them. */
  studentName?: string;
  student: StudentContext;
}

export interface TokenRequest {
  room: string;
  identity: string;
  name?: string;
}

export interface TokenResponse {
  /** The websocket URL to connect to — the browser never learns the secret. */
  url: string;
  token: string;
  room: string;
  identity: string;
  expiresInSec: number;
}

export interface DoubtRequest {
  room: string;
  brief: DoubtBrief;
}

export interface DoubtResponse {
  dispatchId: string;
  room: string;
  agentName: string;
}

// --- parsing helpers --------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A trimmed non-empty string, or undefined. */
const text = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** Length cap for a room name or identity — see {@link safeName}. */
const NAME_MAX = 200;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * A room name or participant identity as it will appear in a JWT claim and in
 * server logs. Length is capped and control characters are refused, so a
 * hostile client cannot forge log lines or push a megabyte into a token.
 */
export function safeName(value: unknown): string | undefined {
  const name = text(value);
  if (name === undefined) return undefined;
  if (name.length > NAME_MAX) return undefined;
  return CONTROL_CHARS.test(name) ? undefined : name;
}

/**
 * The four check-question signals as a runtime set. Written as a Record over
 * the union so that adding a signal to @ai-tutor/persona fails to compile here
 * until it is accepted here too — a silently dropped factor is a tutor who
 * quietly stops adapting.
 */
const ANSWER_SIGNALS: Record<AnswerSignal, true> = {
  'fast-right': true,
  'slow-right': true,
  'fast-wrong': true,
  'slow-wrong': true,
};

const answerSignal = (value: unknown): AnswerSignal | undefined =>
  typeof value === 'string' && value in ANSWER_SIGNALS ? (value as AnswerSignal) : undefined;

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const attendance = (value: unknown): Attendance | undefined => {
  if (!isRecord(value)) return undefined;
  if (value.kind === 'streak') {
    const days = finite(value.days);
    return days === undefined ? undefined : { kind: 'streak', days };
  }
  if (value.kind === 'returning') {
    const daysAway = finite(value.daysAway);
    return daysAway === undefined ? undefined : { kind: 'returning', daysAway };
  }
  return undefined;
};

/** The classes this product teaches. */
const KLASS_MIN = 6;
const KLASS_MAX = 12;

/**
 * A brief without a usable class is refused rather than defaulted: persona
 * shapes every sentence around the class, and a guess would put a Class 12
 * explanation in front of a Class 6 student.
 */
const klass = (value: unknown): Klass | undefined => {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  if (value < KLASS_MIN || value > KLASS_MAX) return undefined;
  return value as Klass;
};

/**
 * Out-of-range numbers are passed through untouched: @ai-tutor/persona already
 * drops a mastery outside 0..1 or a negative count, and duplicating those
 * bounds here is how two definitions of "believable" drift apart.
 */
function readStudent(value: unknown): StudentContext | null {
  if (!isRecord(value)) return null;
  const level = klass(value.klass);
  if (level === undefined) return null;

  const student: StudentContext = { klass: level };
  const mastery = finite(value.mastery);
  if (mastery !== undefined) student.mastery = mastery;
  const misconception = text(value.namedMisconception);
  if (misconception !== undefined) student.namedMisconception = misconception;
  const doubtCount = finite(value.doubtCount);
  if (doubtCount !== undefined) student.doubtCount = doubtCount;
  const lastAnswer = answerSignal(value.lastAnswer);
  if (lastAnswer !== undefined) student.lastAnswer = lastAnswer;
  const attended = attendance(value.attendance);
  if (attended !== undefined) student.attendance = attended;
  return student;
}

const readBeats = (value: unknown): RecallableBeat[] => {
  if (!Array.isArray(value)) return [];
  const beats: RecallableBeat[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const id = text(entry.id);
    const topic = text(entry.topic);
    // A beat with no topic is worse than no beat: persona lists it for the
    // model to choose from, and an unlabelled choice is a coin toss.
    if (id !== undefined && topic !== undefined) beats.push({ id, topic });
  }
  return beats;
};

/**
 * A parsed brief, or null when the payload cannot brief anybody. The five
 * required fields are the ones with no honest default: which lesson, which
 * moment, what that moment is about, who to talk to, and which class they are
 * in.
 */
export function readDoubtBrief(value: unknown): DoubtBrief | null {
  if (!isRecord(value)) return null;

  const lessonId = text(value.lessonId);
  const beatId = text(value.beatId);
  const beatTopic = text(value.beatTopic);
  const studentIdentity = safeName(value.studentIdentity);
  const student = readStudent(value.student);
  if (
    lessonId === undefined ||
    beatId === undefined ||
    beatTopic === undefined ||
    studentIdentity === undefined ||
    student === null
  ) {
    return null;
  }

  const brief: DoubtBrief = {
    lessonId,
    beatId,
    beatTopic,
    transcriptSoFar: typeof value.transcriptSoFar === 'string' ? value.transcriptSoFar : '',
    onScreen: strings(value.onScreen),
    recallableBeats: readBeats(value.recallableBeats),
    studentIdentity,
    student,
  };

  const subject = text(value.subject);
  if (subject !== undefined) brief.subject = subject;
  const title = text(value.title);
  if (title !== undefined) brief.title = title;
  const studentName = text(value.studentName);
  if (studentName !== undefined) brief.studentName = studentName;
  return brief;
}

/** What the token server writes into the dispatch. */
export const encodeDoubtBrief = (brief: DoubtBrief): string => JSON.stringify(brief);

/** What the worker reads back out of `ctx.job.metadata`. */
export function parseDoubtBrief(raw: string | undefined | null): DoubtBrief | null {
  if (raw === undefined || raw === null || raw.length === 0) return null;
  try {
    return readDoubtBrief(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function readTokenRequest(value: unknown): TokenRequest | null {
  if (!isRecord(value)) return null;
  const room = safeName(value.room);
  const identity = safeName(value.identity);
  if (room === undefined || identity === undefined) return null;

  const request: TokenRequest = { room, identity };
  const name = safeName(value.name);
  if (name !== undefined) request.name = name;
  return request;
}

export function readDoubtRequest(value: unknown): DoubtRequest | null {
  if (!isRecord(value)) return null;
  const room = safeName(value.room);
  const brief = readDoubtBrief(value.brief);
  if (room === undefined || brief === null) return null;
  return { room, brief };
}
