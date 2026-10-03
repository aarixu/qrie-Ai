import type { Transport } from './transport.ts';

/**
 * Everything the teacher app and the student app ask of the database, one
 * method per call of migration 0026 (plus the L3 functions it builds on).
 * What a caller may see and do is decided there, by row-level security and
 * the functions' own checks — never here. This file only names things.
 */

export type AccountKind = 'student' | 'teacher' | 'admin';
export type AssignmentKind = 'homework' | 'quiz' | 'test' | 'assignment';
/**
 * How students answer: MCQs (auto-marked), a photo of their work, a checklist
 * of written tasks they tick (0029), or on paper with marks the teacher enters.
 */
export type AnswerType = 'mcq' | 'photo' | 'typed' | 'checklist' | 'paper';
export type EventKind = 'event' | 'ptm' | 'exam' | 'holiday' | 'trip' | 'other';
/** The teacher's own word on a child's work (0030); a child's ticks are only theirs. */
export type WorkStatus = 'checked' | 'not_done' | 'absent';

export interface Me {
  userId: string;
  /** The school's id; the first folder of every photo of work (0025). */
  orgId: string;
  kind: AccountKind;
  displayName: string;
  loginId: string;
  schoolCode: string;
  schoolName: string;
  board: string;
  brand: Record<string, unknown>;
  logoPath: string | null;
}

export interface TaughtClass {
  sectionId: string;
  grade: number;
  sectionName: string;
  subjectId: string;
  subjectName: string;
  students: number;
}

export interface RosterRow {
  studentUserId: string;
  displayName: string;
  loginId: string;
  rollNumber: string | null;
}

export interface LibraryItem {
  id: string;
  /** 'library': Qrie's shared bank. 'school': written by this school's teachers. */
  source: 'library' | 'school';
  grade: number | null;
  subject: string | null;
  kind: 'mcq' | 'task';
  stem: string;
  options: string[] | null;
  correctIndex: number | null;
  outcomeIds: string[];
  /** Approved for THIS school; only approved questions can be set. */
  approved: boolean;
  /** Where it sits in the syllabus (0028); null for a question filed under no topic. */
  chapter: string | null;
  topic: string | null;
}

/** One topic of a class and subject, in syllabus order (0028). */
export interface LibraryTopic {
  chapter: string;
  outcomeId: string;
  title: string;
  questions: number;
}

export interface LibraryQuery {
  grade?: number;
  subject?: string;
  query?: string;
  /** A chapter slug, e.g. 'rational-numbers'. */
  chapter?: string;
  /** One topic (outcome id). */
  outcome?: string;
  limit?: number;
  offset?: number;
}

export interface NewItem {
  grade: number;
  subject: string;
  stem: string;
  /** The topic it is filed under; must be of the same class and subject. */
  outcomeId?: string;
  kind?: 'mcq' | 'task';
  options?: string[];
  correctIndex?: number;
}

export interface NewAssignment {
  sectionId: string;
  subjectId: string;
  kind: AssignmentKind;
  title: string;
  instructions?: string;
  dueAt: string;
  answerTypes: AnswerType[];
  attemptsAllowed?: number;
  /** Tests: students cannot start before this. */
  opensAt?: string;
  /** Tests only: kept by the server from each student's start. */
  timeLimitMinutes?: number;
  /** What marks are out of; required for work marked on paper. */
  maxMarks?: number;
}

export interface AssignmentSummary {
  id: string;
  kind: AssignmentKind;
  title: string;
  instructions: string | null;
  dueAt: string;
  published: boolean;
  publishedAt: string | null;
  answerTypes: AnswerType[];
  attemptsAllowed: number;
  items: number;
  /** Students who have handed in anything, or ticked every task. */
  submitted: number;
  students: number;
  opensAt: string | null;
  timeLimitMinutes: number | null;
  maxMarks: number | null;
  /** Tests: when the scores and answers were shown to students; null until then. */
  resultsReleasedAt: string | null;
  /** Written tasks on the checklist. */
  tasks: number;
  /** Set for some children of the class only (0040); `students` and `submitted` then count only them. */
  targeted: boolean;
}

/** One row per student on the class's current roster. */
export interface ResultRow {
  studentUserId: string;
  displayName: string;
  loginId: string;
  rollNumber: string | null;
  submitted: boolean;
  /** The latest MCQ attempt: the one a teacher marks. */
  submissionId: string | null;
  attempts: number;
  submittedAt: string | null;
  late: boolean;
  machineCorrect: number | null;
  machineTotal: number | null;
  teacherScore: number | null;
  teacherMax: number | null;
  photoSubmissionId: string | null;
  photoCount: number;
  photoTeacherScore: number | null;
  photoTeacherMax: number | null;
  tasksDone: number;
  tasksTotal: number;
  /** Marks for work done on paper, entered by the teacher. */
  paperScore: number | null;
  paperMax: number | null;
  teacherStatus: WorkStatus | null;
  /** A test: when the child started it; null if they have not. */
  startedAt: string | null;
}

export interface MyAssignment {
  id: string;
  kind: AssignmentKind;
  title: string;
  instructions: string | null;
  dueAt: string;
  publishedAt: string;
  subjectId: string;
  subjectName: string;
  answerTypes: AnswerType[];
  attemptsAllowed: number;
  questions: number;
  mcqAttemptsUsed: number;
  bestCorrect: number | null;
  bestTotal: number | null;
  photoSubmitted: boolean;
  teacherScore: number | null;
  teacherMax: number | null;
  markedAt: string | null;
  opensAt: string | null;
  timeLimitMinutes: number | null;
  maxMarks: number | null;
  /** False on a test until the teacher releases it: scores and answers stay hidden. */
  resultsReleased: boolean;
  tasksTotal: number;
  tasksDone: number;
  /** A test: when this student started it, and when their time ends. */
  startedAt: string | null;
  endsAt: string | null;
  teacherStatus: WorkStatus | null;
}

export interface Question {
  itemId: string;
  questionPosition: number;
  kind: 'mcq' | 'task';
  stem: string;
  options: string[] | null;
}

/** One question of a student's own latest attempt. */
export interface ReviewRow {
  itemId: string;
  questionPosition: number;
  stem: string;
  options: string[];
  chosenIndex: number | null;
  correct: boolean;
  /** Null while the student still has an attempt left and the due date has not passed. */
  correctIndex: number | null;
}

export interface Task {
  taskId: string;
  taskPosition: number;
  text: string;
}

export interface MyTask extends Task {
  done: boolean;
}

export interface TestClock {
  startedAt: string;
  endsAt: string;
}

export interface NewEvent {
  /** null: the whole school (admin only). */
  sectionId: string | null;
  title: string;
  startsAt: string;
  endsAt?: string;
  kind: EventKind;
  details?: string;
}

/** An event, or a test that has not closed, the caller may see (0029). */
export interface UpcomingEvent {
  id: string;
  source: 'event' | 'test';
  kind: EventKind | 'test';
  title: string;
  details: string | null;
  startsAt: string;
  endsAt: string | null;
  sectionId: string | null;
  /** e.g. '8A'; null for the whole school. */
  className: string | null;
  /** Posted by the caller. */
  mine: boolean | null;
}

/** Something in the teacher's own classes waiting on them (0030). */
export interface NeedsAttention {
  assignmentId: string;
  title: string;
  kind: AssignmentKind;
  sectionId: string;
  subjectId: string;
  className: string;
  subjectName: string;
  /** photos to mark; paper marks to enter; a closed test to release; notebooks to check. */
  reason: 'photos' | 'marks' | 'release' | 'notebooks';
  /** How many children it concerns (for 'release', how many handed in). */
  count: number;
  dueAt: string;
}

export interface McqResult {
  submissionId: string;
  /** Null on a test: its score is shown only once the teacher releases it. */
  correct: number | null;
  total: number | null;
}

export interface AssignmentOverview extends AssignmentSummary {
  sectionId: string;
  grade: number;
  sectionName: string;
  subjectId: string;
  subjectName: string;
}

/** A homework's question as its teacher sees it: with the key. */
export interface TeacherItem {
  itemId: string;
  questionPosition: number;
  kind: 'mcq' | 'task';
  stem: string;
  options: string[] | null;
  correctIndex: number | null;
  /** Per option: the misconception a wrong option was written to catch, or ''. */
  misconceptions: string[] | null;
  source: 'library' | 'school';
  outcomeIds: string[];
}

export interface ItemStats {
  itemId: string;
  questionPosition: number;
  stem: string;
  options: string[] | null;
  correctIndex: number | null;
  misconceptions: string[] | null;
  answered: number;
  correct: number;
  /** How many chose each option, over each student's latest attempt. */
  optionCounts: number[] | null;
}

export interface AssignmentChanges {
  title?: string;
  /** '' clears them. */
  instructions?: string;
  dueAt?: string;
  attemptsAllowed?: number;
  opensAt?: string;
  timeLimitMinutes?: number;
  maxMarks?: number;
}

export interface SubmissionPhoto {
  objectName: string;
  photoPosition: number;
}

/** What the brain believes about one student in one chapter (0027). */
export interface ChapterStanding {
  studentUserId: string;
  displayName: string;
  rollNumber: string | null;
  /** The knowledge graph's chapter slug, e.g. 'rational-numbers'. */
  chapter: string;
  /** Outcomes in the chapter the student has answered questions on. */
  outcomesSeen: number;
  answers: number;
  /** Mean belief over those outcomes, 0-1. */
  mastery: number;
  unassistedMastery: number;
}

/** A misconception a student's own wrong answers point to (0027). */
export interface ShownMisconception {
  studentUserId: string;
  displayName: string;
  rollNumber: string | null;
  chapter: string | null;
  label: string;
  times: number;
  lastAt: string;
}

/** A child of a class, as a list of children names them. */
export interface ClassChild {
  studentUserId: string;
  displayName: string;
  rollNumber: string | null;
}

/**
 * A misconception children of a class show now (0040): the last time each
 * answered a question of the class's work that can catch it, they chose it.
 */
export interface LikelyMisconception {
  /** The knowledge graph's chapter slug, e.g. 'rational-numbers'. */
  chapter: string;
  label: string;
  /** How many children of the class show it. */
  students: number;
  /** Who they are, by roll number. */
  children: ClassChild[];
  /** Approved questions on the chapter that practice can be set from now. */
  questions: number;
}

/** Practice on one chapter for some children of a class (0040). */
export interface NewPractice {
  sectionId: string;
  subjectId: string;
  chapter: string;
  /** Children of the class, as they are now. */
  studentUserIds: string[];
  dueAt: string;
  /** Questions that can catch this misconception are chosen first. */
  misconception?: string;
  /** Blank: 'Practice: ' and the chapter's name. */
  title?: string;
  /** 1 to 20; 5 when left out. Fewer are set when fewer are free. */
  questions?: number;
}

export interface MyChapter {
  grade: number;
  subject: string;
  chapter: string;
  outcomesSeen: number;
  answers: number;
  mastery: number;
}

// --- A student's report (0031): for the student, their teachers, the admin ---

export interface StudentCard {
  userId: string;
  displayName: string;
  loginId: string;
  rollNumber: string | null;
  sectionId: string | null;
  grade: number | null;
  /** e.g. '8A'. */
  className: string | null;
  schoolName: string;
}

/** One subject of a student's class, over work due so far. */
export interface StudentSubject {
  subjectId: string;
  subjectName: string;
  teacherName: string | null;
  workDue: number;
  handedIn: number;
  handinRate: number | null;
  /** 0-1; a test's score counts for the student only once released. */
  averageScore: number | null;
  /** The brain's mean belief over the chapters answered, 0-1. */
  mastery: number | null;
  chaptersSeen: number;
}

export interface TimelineRow {
  assignmentId: string;
  title: string;
  kind: AssignmentKind;
  subjectName: string;
  dueAt: string;
  handedIn: boolean;
  late: boolean;
  absent: boolean;
  /** 0-1; null when not marked — or, for the student, a test not yet released. */
  score: number | null;
}

export interface StudentChapter {
  subject: string;
  chapter: string;
  outcomesSeen: number;
  answers: number;
  mastery: number;
}

export interface StudentMistake {
  subject: string;
  chapter: string | null;
  label: string;
  times: number;
}

// --- The school portal (0031): the admin only ---

export interface SchoolOverview {
  schoolName: string;
  students: number;
  teachers: number;
  classes: number;
  subjects: number;
  workSet30d: number;
  handinRate30d: number | null;
  averageScore30d: number | null;
  activeStudents7d: number;
  mastery: number | null;
}

export interface SchoolClass {
  sectionId: string;
  subjectId: string;
  className: string;
  grade: number;
  subjectName: string;
  teacherName: string;
  teacherLoginId: string;
  students: number;
  workSet: number;
  handinRate: number | null;
  averageScore: number | null;
  mastery: number | null;
}

export interface SchoolStudent {
  userId: string;
  displayName: string;
  loginId: string;
  sectionId: string;
  className: string;
  rollNumber: string | null;
  workDue: number;
  handinRate: number | null;
  averageScore: number | null;
  mastery: number | null;
  lastActive: string | null;
}

export interface SchoolTeacher {
  userId: string;
  displayName: string;
  loginId: string;
  kind: AccountKind;
  classes: number;
  workSet: number;
  workSet30d: number;
  photosToMark: number;
  testsToRelease: number;
}

/** The school's colours (0033), each #rrggbb: the main one, and a second for highlights. */
export interface SchoolBrand {
  primary?: string;
  accent?: string;
}

/** A person's photo (0033): a small JPEG, as base64. */
export interface AccountPhoto {
  userId: string;
  base64: string;
  updatedAt: string;
}

/** One of this year's sections (0037). */
export interface SchoolSection {
  sectionId: string;
  className: string;
  grade: number;
  students: number;
}

/** The school's licence (0041), as its admin reads it. Set by Qrie only. */
export interface SchoolLicence {
  /** e.g. 'pilot'; null when no licence is set — then nothing is limited. */
  plan: string | null;
  seats: number | null;
  /** Students in a class of this year who have not left. */
  seatsUsed: number;
  /** The last day it runs, YYYY-MM-DD. */
  validUntil: string | null;
  /** Days from today (India's) to its last day: 0 on that day, below 0 once it has ended. */
  daysLeft: number | null;
}

export type LicenceWarning = 'ended' | 'ending' | 'full';

/** What the portal warns of: the licence has ended or ends within 30 days, or every seat is in use. */
export function licenceWarnings(l: SchoolLicence): LicenceWarning[] {
  const out: LicenceWarning[] = [];
  if (l.daysLeft !== null) {
    if (l.daysLeft < 0) out.push('ended');
    else if (l.daysLeft <= 30) out.push('ending');
  }
  if (l.seats !== null && l.seatsUsed >= l.seats) out.push('full');
  return out;
}

/** A day's mark (0036). Late counts as present; leave is left out of the rate. */
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'leave';

/** Present or late over the days not on leave; null when there are none. */
export function attendanceRate(statuses: AttendanceStatus[]): number | null {
  const counted = statuses.filter((s) => s !== 'leave');
  return counted.length ? counted.filter((s) => s === 'present' || s === 'late').length / counted.length : null;
}

export interface AttendanceRow {
  studentUserId: string;
  displayName: string;
  rollNumber: string | null;
  status: AttendanceStatus | null;
  markedByName: string | null;
}

export interface AttendanceTotals {
  studentUserId: string;
  displayName: string;
  rollNumber: string | null;
  present: number;
  late: number;
  absent: number;
  leave: number;
  rate: number | null;
}

export interface ClassAttendanceToday {
  sectionId: string;
  className: string;
  students: number;
  marked: number;
  present: number;
}

/** A teacher's comment on one child's work for one assignment (0038). */
export interface WorkComment {
  studentUserId: string;
  text: string;
  /** Whoever wrote it last; null if their account is gone. */
  writtenByName: string | null;
  writtenAt: string;
}

/** The comment on the child's own work, as the child reads it. */
export type MyWorkComment = Omit<WorkComment, 'studentUserId'>;

/** This year's remark on a child's report card (0038). */
export interface ReportRemark {
  /** Null while nobody has written one this year. */
  text: string | null;
  writtenByName: string | null;
  writtenAt: string | null;
  /** Whether the caller may write it: a teacher of the child's class this year, or the admin. */
  canEdit: boolean;
}

/** The kinds of file a notice may carry (0039), each checked by its first and last bytes. */
export type NoticeAttachmentMime = 'application/pdf' | 'image/jpeg' | 'image/png';

export interface NewNotice {
  /** 1 to 120 characters. */
  title: string;
  /** 1 to 2000 characters. */
  body: string;
  /** Sections of this year; null or empty: the whole school (the admin only). */
  sectionIds: string[] | null;
  /** One file of 512 KB at most, as base64; a blank name becomes 'attachment.pdf' and the like. */
  attachment?: { name?: string; mime: NoticeAttachmentMime; base64: string };
}

/** A notice the caller may read (0039), newest first: this school year's only. */
export interface Notice {
  noticeId: string;
  title: string;
  body: string;
  wholeSchool: boolean;
  /** The classes it was sent to, e.g. '8A, 8B'; null for the whole school. */
  classNames: string | null;
  sentByName: string | null;
  sentAt: string;
  attachmentName: string | null;
  attachmentMime: NoticeAttachmentMime | null;
  attachmentBytes: number | null;
  /** When the caller first opened it; null while unread. */
  readAt: string | null;
  /** Sent by the caller. */
  mine: boolean;
  /** Its writer, while at the school, and the admin may delete it and see who has read it. */
  canDelete: boolean;
  /** How many of its audience have read it, and how many it is for now; null for anyone but its writer and the admin. */
  readers: number | null;
  audience: number | null;
}

/** One person a notice is for now, and when they first opened it (null: not yet). */
export interface NoticeReader {
  userId: string;
  displayName: string;
  loginId: string;
  kind: 'student' | 'teacher';
  /** A child's class, e.g. '8A'; null for a teacher. */
  className: string | null;
  rollNumber: string | null;
  readAt: string | null;
}

export interface NoticeAttachment {
  fileName: string;
  mime: NoticeAttachmentMime;
  base64: string;
}

/** Someone marked as having left the school (0034). */
export interface LeftAccount {
  userId: string;
  displayName: string;
  loginId: string;
  kind: AccountKind;
  leftAt: string;
}

/** One thing an admin did (0034): who, what, to whom, when. */
export interface AuditEvent {
  at: string;
  actorName: string | null;
  action: string;
  /** A school ID, or a school ID and a class, e.g. 'SAF-T2 8A Mathematics'. */
  target: string;
  details: Record<string, unknown>;
}

/** The school's logo (0032): a PNG or JPEG, as base64. */
export interface SchoolLogo {
  mime: 'image/png' | 'image/jpeg';
  base64: string;
  updatedAt: string;
}

/** One published piece of a class's work, for its trend. */
export interface TrendPoint {
  assignmentId: string;
  title: string;
  kind: AssignmentKind;
  dueAt: string;
  students: number;
  handedIn: number;
  late: number;
  averageScore: number | null;
}

// --- Learn (0031): chapter-wise practice ---

export interface PracticeChapter {
  subjectName: string;
  chapter: string;
  /** Approved questions the student may practise now. */
  questions: number;
  answers: number;
  mastery: number | null;
}

export interface PracticeQuestion {
  itemId: string;
  stem: string;
  options: string[];
}

export interface PracticeResult {
  correct: boolean;
  correctIndex: number;
  misconception: string | null;
}

// 'work_set_30d' → 'workSet30d': a digit after an underscore joins as it is.
const camel = (k: string): string => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

function shape<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = v;
  return out as T;
}

export function createLmsClient(t: Transport) {
  const rows = async <T>(fn: string, args?: Record<string, unknown>): Promise<T[]> =>
    (await t.rows(fn, args)).map((r) => shape<T>(r));

  return {
    // --- anyone signed in --------------------------------------------------
    async me(): Promise<Me | null> {
      return (await rows<Me>('me'))[0] ?? null;
    },

    // --- a teacher -----------------------------------------------------------
    myClasses: () => rows<TaughtClass>('my_classes'),
    classRoster: (sectionId: string) => rows<RosterRow>('class_roster', { p_section: sectionId }),
    library: (q: LibraryQuery = {}) =>
      rows<LibraryItem>('library', {
        p_grade: q.grade,
        p_subject: q.subject,
        p_query: q.query,
        p_chapter: q.chapter,
        p_outcome: q.outcome,
        p_limit: q.limit,
        p_offset: q.offset,
      }),
    libraryTopics: (grade: number, subject: string) =>
      rows<LibraryTopic>('library_topics', { p_grade: grade, p_subject: subject }),
    async approveItem(itemId: string): Promise<void> {
      await t.value('approve_item', { p_item: itemId });
    },
    async writeItem(item: NewItem): Promise<string> {
      return (await t.value('write_item', {
        p_grade: item.grade,
        p_subject: item.subject,
        p_stem: item.stem,
        p_kind: item.kind ?? 'mcq',
        p_options: item.options,
        p_correct_index: item.correctIndex,
        p_outcome: item.outcomeId,
      })) as string;
    },
    async createAssignment(a: NewAssignment): Promise<string> {
      return (await t.value('create_assignment', {
        p_section: a.sectionId,
        p_subject: a.subjectId,
        p_kind: a.kind,
        p_title: a.title,
        p_instructions: a.instructions,
        p_due_at: a.dueAt,
        p_answer_types: a.answerTypes,
        p_attempts_allowed: a.attemptsAllowed,
        p_opens_at: a.opensAt,
        p_time_limit_minutes: a.timeLimitMinutes,
        p_max_marks: a.maxMarks,
      })) as string;
    },
    async setAssignmentItems(assignmentId: string, itemIds: string[]): Promise<void> {
      await t.value('set_assignment_items', { p_assignment: assignmentId, p_items: itemIds });
    },
    async publishAssignment(assignmentId: string): Promise<void> {
      await t.value('publish_assignment', { p_assignment: assignmentId });
    },
    classAssignments: (sectionId: string, subjectId: string) =>
      rows<AssignmentSummary>('class_assignments', { p_section: sectionId, p_subject: subjectId }),
    assignmentResults: (assignmentId: string) =>
      rows<ResultRow>('assignment_results', { p_assignment: assignmentId }),
    async assignmentOverview(assignmentId: string): Promise<AssignmentOverview | null> {
      return (await rows<AssignmentOverview>('assignment_overview', { p_assignment: assignmentId }))[0] ?? null;
    },
    assignmentItems: (assignmentId: string) => rows<TeacherItem>('assignment_items', { p_assignment: assignmentId }),
    itemStats: (assignmentId: string) => rows<ItemStats>('item_stats', { p_assignment: assignmentId }),
    async updateAssignment(assignmentId: string, c: AssignmentChanges): Promise<void> {
      await t.value('update_assignment', {
        p_assignment: assignmentId,
        p_title: c.title,
        p_instructions: c.instructions,
        p_due_at: c.dueAt,
        p_attempts_allowed: c.attemptsAllowed,
        p_opens_at: c.opensAt,
        p_time_limit_minutes: c.timeLimitMinutes,
        p_max_marks: c.maxMarks,
      });
    },
    async deleteDraft(assignmentId: string): Promise<void> {
      await t.value('delete_draft', { p_assignment: assignmentId });
    },
    submissionPhotos: (submissionId: string) =>
      rows<SubmissionPhoto>('submission_photos', { p_submission: submissionId }),
    async setAssignmentTasks(assignmentId: string, tasks: string[]): Promise<void> {
      await t.value('set_assignment_tasks', { p_assignment: assignmentId, p_tasks: tasks });
    },
    assignmentTasks: (assignmentId: string) => rows<Task>('assignment_tasks', { p_assignment: assignmentId }),
    async releaseResults(assignmentId: string): Promise<void> {
      await t.value('release_results', { p_assignment: assignmentId });
    },
    async recordPaperMark(assignmentId: string, studentUserId: string, score: number): Promise<void> {
      await t.value('record_paper_mark', { p_assignment: assignmentId, p_student: studentUserId, p_score: score });
    },
    async createEvent(e: NewEvent): Promise<string> {
      return (await t.value('create_event', {
        p_section: e.sectionId,
        p_title: e.title,
        p_starts_at: e.startsAt,
        p_kind: e.kind,
        p_details: e.details,
        p_ends_at: e.endsAt,
      })) as string;
    },
    async deleteEvent(eventId: string): Promise<void> {
      await t.value('delete_event', { p_event: eventId });
    },
    /** Checked, not done or absent for each named child; null clears it. */
    async setWorkStatus(assignmentId: string, studentUserIds: string[], status: WorkStatus | null): Promise<void> {
      await t.value('set_work_status', { p_assignment: assignmentId, p_students: studentUserIds, p_status: status });
    },
    async setTeacherMark(submissionId: string, score: number, max: number): Promise<void> {
      await t.value('set_teacher_mark', { p_submission: submissionId, p_score: score, p_max: max });
    },
    /** One comment on a child's work for published work; writing again replaces it, null or blank removes it. */
    async setWorkComment(assignmentId: string, studentUserId: string, text: string | null): Promise<void> {
      await t.value('set_work_comment', { p_assignment: assignmentId, p_student: studentUserId, p_text: text });
    },
    /** The comments on a piece of work, one per child on the class's roster. Its teachers and the admin. */
    workComments: (assignmentId: string) => rows<WorkComment>('work_comments', { p_assignment: assignmentId }),

    needsAttention: () => rows<NeedsAttention>('needs_attention'),
    classInsights: (sectionId: string, subjectId: string) =>
      rows<ChapterStanding>('class_insights', { p_section: sectionId, p_subject: subjectId }),
    classMisconceptions: (sectionId: string, subjectId: string) =>
      rows<ShownMisconception>('class_misconceptions', { p_section: sectionId, p_subject: subjectId }),
    /** The misconceptions children of the class show now, most children first. Its teachers and the admin. */
    classLikelyMisconceptions: (sectionId: string, subjectId: string) =>
      rows<LikelyMisconception>('class_likely_misconceptions', { p_section: sectionId, p_subject: subjectId }),
    /** Sets and publishes practice that only the children named see and hand in; returns its id. */
    async sendPractice(p: NewPractice): Promise<string> {
      return (await t.value('send_practice', {
        p_section: p.sectionId,
        p_subject: p.subjectId,
        p_chapter: p.chapter,
        p_students: p.studentUserIds,
        p_due_at: p.dueAt,
        p_misconception: p.misconception,
        p_title: p.title,
        p_questions: p.questions,
      })) as string;
    },

    classTrend: (sectionId: string, subjectId: string) =>
      rows<TrendPoint>('class_trend', { p_section: sectionId, p_subject: subjectId }),
    /** Approves every library question on a chapter; returns how many were new. */
    async approveChapter(grade: number, subject: string, chapter: string): Promise<number> {
      return (await t.value('approve_chapter', { p_grade: grade, p_subject: subject, p_chapter: chapter })) as number;
    },

    // --- a student's report: the student, their teachers, the admin ----------
    async studentCard(studentUserId: string): Promise<StudentCard | null> {
      return (await rows<StudentCard>('student_card', { p_student: studentUserId }))[0] ?? null;
    },
    studentSubjects: (studentUserId: string) => rows<StudentSubject>('student_subjects', { p_student: studentUserId }),
    studentTimeline: (studentUserId: string) => rows<TimelineRow>('student_timeline', { p_student: studentUserId }),
    studentChapters: (studentUserId: string) => rows<StudentChapter>('student_chapters', { p_student: studentUserId }),
    studentMistakes: (studentUserId: string) =>
      rows<StudentMistake>('student_misconceptions', { p_student: studentUserId }),
    /** This year's remark on the child's report card, and whether the caller may write it. */
    async reportRemark(studentUserId: string): Promise<ReportRemark> {
      const [r] = await rows<ReportRemark>('report_remark', { p_student: studentUserId });
      return r ?? { text: null, writtenByName: null, writtenAt: null, canEdit: false };
    },
    /** Writes this year's remark (the latest write wins); null or blank removes it. */
    async setReportRemark(studentUserId: string, text: string | null): Promise<void> {
      await t.value('set_report_remark', { p_student: studentUserId, p_text: text });
    },

    // --- the school portal: the admin ----------------------------------------
    async schoolOverview(): Promise<SchoolOverview | null> {
      return (await rows<SchoolOverview>('school_overview'))[0] ?? null;
    },
    schoolClasses: () => rows<SchoolClass>('school_classes'),
    schoolStudents: (sectionId?: string) => rows<SchoolStudent>('school_students', { p_section: sectionId }),
    schoolTeachers: () => rows<SchoolTeacher>('school_teachers'),
    async setSchoolBrand(brand: SchoolBrand): Promise<void> {
      await t.value('set_school_brand', { p_brand: brand });
    },
    /** A person's photo, a small JPEG as base64, by school ID; null removes it. The admin only. */
    async setAccountPhoto(loginId: string, base64: string | null): Promise<void> {
      await t.value('set_account_photo', { p_login_id: loginId, p_data: base64 });
    },
    /** The photos of these people the caller may see; people with none, or out of sight, are left out. */
    accountPhotos: (userIds: string[]) => rows<AccountPhoto>('account_photos', { p_users: userIds }),
    /** A student or teacher who has left: they and their classes' children stop seeing each other at once. */
    async markLeft(loginId: string): Promise<void> {
      await t.value('mark_left', { p_login_id: loginId });
    },
    /** Everyone marked as left, newest first. The admin only. */
    schoolLeft: () => rows<LeftAccount>('school_left'),
    /** Undoes markLeft. */
    async restoreAccount(loginId: string): Promise<void> {
      await t.value('restore_account', { p_login_id: loginId });
    },
    /** Gives a class (section and subject) to a teacher, by school ID, or takes it away. */
    async setTeaching(sectionId: string, subjectId: string, teacherLoginId: string, teaches: boolean): Promise<void> {
      await t.value('set_teaching', {
        p_section: sectionId,
        p_subject: subjectId,
        p_teacher_login_id: teacherLoginId,
        p_teaches: teaches,
      });
    },
    /**
     * Starts the new school year (dates YYYY-MM-DD): every child up a class in
     * the same section, Class 12 out of the school, each teacher on the same
     * classes. The admin only, in the week the year begins.
     */
    async startNewYear(label: string, startsOn: string, endsOn: string): Promise<{ promoted: number; graduated: number; sections: number }> {
      const [r] = await rows<{ promoted: number; graduated: number; sections: number }>('start_new_year', {
        p_label: label,
        p_starts_on: startsOn,
        p_ends_on: endsOn,
      });
      return r ?? { promoted: 0, graduated: 0, sections: 0 };
    },
    /** Moves a child to another section of this year; a null roll keeps theirs. */
    async moveStudent(loginId: string, sectionId: string, roll: string | null): Promise<void> {
      await t.value('move_student', { p_login_id: loginId, p_section: sectionId, p_roll: roll });
    },
    /** This year's sections and how many children each has. The admin only. */
    schoolSections: () => rows<SchoolSection>('school_sections'),
    /** The school's licence and its seats in use; every field but seatsUsed is null when none is set. The admin only. */
    async schoolLicence(): Promise<SchoolLicence> {
      const [r] = await rows<SchoolLicence>('school_licence');
      return r ?? { plan: null, seats: null, seatsUsed: 0, validUntil: null, daysLeft: null };
    },
    /** A class's list for one day (YYYY-MM-DD), each child's mark or null. Its teachers and the admin. */
    attendanceSheet: (sectionId: string, onDate: string) =>
      rows<AttendanceRow>('attendance_sheet', { p_section: sectionId, p_on: onDate }),
    /** Marks for one day, by student user id; marking again changes them. */
    async markAttendance(sectionId: string, onDate: string, marks: Record<string, AttendanceStatus>): Promise<void> {
      await t.value('mark_attendance', { p_section: sectionId, p_on: onDate, p_marks: marks });
    },
    /** Each child's days in a span (YYYY-MM-DD, both ends kept). */
    attendanceSummary: (sectionId: string, from: string, to: string) =>
      rows<AttendanceTotals>('attendance_summary', { p_section: sectionId, p_from: from, p_to: to }),
    /** One student's whole year: how many days are marked, and the rate. */
    async studentAttendance(studentUserId: string): Promise<{ marked: number; rate: number | null }> {
      const [r] = await rows<{ marked: number; rate: number | null }>('student_attendance', { p_student: studentUserId });
      return r ?? { marked: 0, rate: null };
    },
    /** Every class today: how many children, how many marked, how many came. The admin only. */
    schoolAttendanceToday: () => rows<ClassAttendanceToday>('school_attendance_today'),
    /** What the school's admins have done, newest first (lms.audit_log). */
    auditLog: (limit?: number) => rows<AuditEvent>('audit_log', { p_limit: limit }),
    /** A PNG or JPEG as base64, or (null, null) to remove the logo. */
    async setSchoolLogo(mime: SchoolLogo['mime'] | 'image/svg+xml' | null, base64: string | null): Promise<void> {
      await t.value('set_school_logo', { p_mime: mime, p_data: base64 });
    },
    /** The caller's school's logo, or null when it has none. */
    async schoolLogo(): Promise<SchoolLogo | null> {
      return (await rows<SchoolLogo>('school_logo'))[0] ?? null;
    },

    // --- notices (0039): a teacher or the admin sends; whoever it is for reads -
    /** Sends a notice to sections the caller teaches (the admin: any, or the whole school); returns its id. */
    async sendNotice(n: NewNotice): Promise<string> {
      return (await t.value('send_notice', {
        p_title: n.title,
        p_body: n.body,
        p_sections: n.sectionIds,
        p_attachment_name: n.attachment?.name,
        p_attachment_mime: n.attachment?.mime,
        p_attachment: n.attachment?.base64,
      })) as string;
    },
    /** Its writer, while at the school, or the admin. */
    async deleteNotice(noticeId: string): Promise<void> {
      await t.value('delete_notice', { p_notice: noticeId });
    },
    /** This year's notices the caller may read, newest first, with their own read time. */
    myNotices: () => rows<Notice>('my_notices'),
    /** Records that the caller opened it; the first time is kept. */
    async readNotice(noticeId: string): Promise<void> {
      await t.value('read_notice', { p_notice: noticeId });
    },
    /** The notice's file, or null when it has none. */
    async noticeAttachment(noticeId: string): Promise<NoticeAttachment | null> {
      return (await rows<NoticeAttachment>('notice_attachment', { p_notice: noticeId }))[0] ?? null;
    },
    /** Everyone the notice is for now, and when each first opened it. Its writer and the admin only. */
    noticeReaders: (noticeId: string) => rows<NoticeReader>('notice_readers', { p_notice: noticeId }),

    // --- a student -----------------------------------------------------------
    /** The child's own marked days in the last `days` (newest first), and their rate. */
    async myAttendance(days = 30): Promise<{ days: { onDate: string; status: AttendanceStatus }[]; rate: number | null }> {
      const list = await rows<{ onDate: string; status: AttendanceStatus }>('my_attendance', { p_days: days });
      return { days: list, rate: attendanceRate(list.map((d) => d.status)) };
    },
    myProgress: () => rows<MyChapter>('my_progress'),
    practiceChapters: () => rows<PracticeChapter>('practice_chapters'),
    practiceQuestions: (subject: string, chapter: string, count?: number) =>
      rows<PracticeQuestion>('practice_questions', { p_subject: subject, p_chapter: chapter, p_count: count }),
    /** Marks one practice answer at once; the session id is the device's, one per round. */
    async checkPracticeAnswer(sessionId: string, itemId: string, chosenIndex: number): Promise<PracticeResult> {
      const [r] = await rows<PracticeResult>('check_practice_answer', {
        p_session: sessionId,
        p_item: itemId,
        p_chosen: chosenIndex,
      });
      return r;
    },
    myAssignments: () => rows<MyAssignment>('my_assignments'),
    myTasks: (assignmentId: string) => rows<MyTask>('my_tasks', { p_assignment: assignmentId }),
    async tickTask(taskId: string, done: boolean): Promise<void> {
      await t.value('tick_task', { p_task: taskId, p_done: done });
    },
    /** One answer on a test, saved as it is tapped; null clears it. */
    async saveTestAnswer(assignmentId: string, itemId: string, chosenIndex: number | null): Promise<void> {
      await t.value('save_test_answer', { p_assignment: assignmentId, p_item: itemId, p_chosen: chosenIndex });
    },
    mySavedAnswers: (assignmentId: string) =>
      rows<{ itemId: string; chosenIndex: number }>('my_saved_answers', { p_assignment: assignmentId }),
    async startTest(assignmentId: string): Promise<TestClock> {
      const [clock] = await rows<TestClock>('start_test', { p_assignment: assignmentId });
      return clock;
    },
    upcomingEvents: (days?: number) => rows<UpcomingEvent>('upcoming_events', { p_days: days }),
    assignmentQuestions: (assignmentId: string) =>
      rows<Question>('assignment_questions', { p_assignment: assignmentId }),
    myReview: (assignmentId: string) => rows<ReviewRow>('my_review', { p_assignment: assignmentId }),
    /** The teacher's comment on the child's own work; on a test, only once its results are released. */
    async myWorkComment(assignmentId: string): Promise<MyWorkComment | null> {
      return (await rows<MyWorkComment>('my_work_comment', { p_assignment: assignmentId }))[0] ?? null;
    },
    async submitMcq(assignmentId: string, answers: Record<string, number>): Promise<McqResult> {
      const [r] = await rows<McqResult>('submit_mcq', {
        p_assignment: assignmentId,
        p_answers: answers,
      });
      return r;
    },
    async submitPhotos(assignmentId: string, objectNames: string[]): Promise<string> {
      return (await t.value('submit_photos', { p_assignment: assignmentId, p_paths: objectNames })) as string;
    },
  };
}

export type LmsClient = ReturnType<typeof createLmsClient>;
