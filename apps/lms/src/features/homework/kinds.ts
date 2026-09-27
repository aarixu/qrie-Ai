import type { AnswerType, AssignmentKind } from '@ai-tutor/lms-client'

/** The kinds of work a teacher can set, as the teacher app names them. */
export type WorkKind = Extract<AssignmentKind, 'homework' | 'assignment' | 'test'>

export const WORK_KINDS: { kind: WorkKind; label: string; blurb: string }[] = [
  { kind: 'homework', label: 'Homework', blurb: 'Written work in the notebook, questions, or both — due soon.' },
  { kind: 'assignment', label: 'Assignment', blurb: 'A longer piece of work, marked by you, often with a photo of it.' },
  { kind: 'test', label: 'Test', blurb: 'Online and timed, or on paper in class with marks you enter.' },
]

export function kindLabel(kind: string): string {
  return WORK_KINDS.find((k) => k.kind === kind)?.label ?? 'Work'
}

/** What a new piece of work starts with: most homework is done in the notebook. */
export function defaultParts(kind: WorkKind): AnswerType[] {
  return kind === 'test' ? ['mcq'] : kind === 'assignment' ? ['checklist', 'photo'] : ['checklist']
}

export const PART_LABELS: Record<'checklist' | 'mcq' | 'photo', { label: string; help: string }> = {
  checklist: {
    label: 'Written work in the notebook',
    help: 'List the tasks; each student ticks them off as they finish.',
  },
  mcq: {
    label: 'Multiple-choice questions',
    help: 'Answered in the app and marked automatically — best for learning something and checking it at once.',
  },
  photo: {
    label: 'A photo of their work',
    help: 'Students hand in photos of their notebook pages; you mark them.',
  },
}
