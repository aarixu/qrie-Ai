import type { Transport } from './transport.ts';

/**
 * Everything the teacher app and the student app ask of the database, one
 * method per call of migration 0026 (plus the L3 functions it builds on).
 * What a caller may see and do is decided there, by row-level security and
 * the functions' own checks — never here. This file only names things.
 */

export type AccountKind = 'student' | 'teacher' | 'admin';
export type AssignmentKind = 'homework' | 'quiz' | 'test' | 'assignment';
export type AnswerType = 'mcq' | 'photo' | 'typed';

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
}

export interface LibraryQuery {
  grade?: number;
  subject?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface NewItem {
  grade: number;
  subject: string;
  stem: string;
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
  /** Students who have handed in anything. */
  submitted: number;
  students: number;
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
}

export interface Question {
  itemId: string;
  questionPosition: number;
  kind: 'mcq' | 'task';
  stem: string;
  options: string[] | null;
}

export interface McqResult {
  submissionId: string;
  correct: number;
  total: number;
}

const camel = (k: string): string => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

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
        p_limit: q.limit,
        p_offset: q.offset,
      }),
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
    async setTeacherMark(submissionId: string, score: number, max: number): Promise<void> {
      await t.value('set_teacher_mark', { p_submission: submissionId, p_score: score, p_max: max });
    },

    // --- a student -----------------------------------------------------------
    myAssignments: () => rows<MyAssignment>('my_assignments'),
    assignmentQuestions: (assignmentId: string) =>
      rows<Question>('assignment_questions', { p_assignment: assignmentId }),
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
