import { HELPLINES, redact, screen } from '@ai-tutor/safety'
import type { ProblemKind, ProblemPlace, ProblemReport } from '@ai-tutor/lms-client'

/**
 * A STUDENT'S REPORT, MADE READY ON THE PHONE (plan 5). Pure, so what travels
 * is tested: the place in the app it was sent from, and the note scrubbed by
 * the same safety screen the tutor uses before it leaves the phone. Nothing
 * here keeps the note anywhere.
 */

/** lms.report_problem refuses a longer note. */
export const MAX_NOTE = 500

export const REASONS: { id: ProblemKind; label: string }[] = [
  { id: 'wrong', label: 'Something here is wrong' },
  { id: 'rude', label: 'Something here upset me' },
  { id: 'unsafe', label: 'Something here does not feel safe' },
  { id: 'other', label: 'Something else' },
]

export const HELPLINE_LINES: { name: string; number: string; what: string }[] = [
  { name: 'Tele-MANAS', number: HELPLINES.telemanas, what: 'free, any time, someone will listen' },
  { name: 'Childline', number: HELPLINES.childline, what: 'if someone is hurting you' },
]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Where in the app a report was sent from; a homework's id when it is about one. */
export function placeOf(pathname: string): { where: ProblemPlace; itemId: string | null } {
  const path = pathname.replace(/\/+$/, '') || '/'
  const homework = /^\/homework\/([^/]+)/.exec(path)
  if (homework) return { where: 'homework', itemId: UUID.test(homework[1]) ? homework[1].toLowerCase() : null }
  if (path === '/work' || path.startsWith('/work/')) return { where: 'work', itemId: null }
  if (path === '/learn/practice' || path.startsWith('/learn/practice/')) return { where: 'practice', itemId: null }
  if (path === '/learn' || path.startsWith('/learn/')) return { where: 'learn', itemId: null }
  if (path === '/progress' || path.startsWith('/progress/')) return { where: 'progress', itemId: null }
  if (path === '/notices' || path.startsWith('/notices/')) return { where: 'notices', itemId: null }
  return { where: 'home', itemId: null }
}

/**
 * The report as it travels. The note goes through the safety screen: kept as
 * cleaned when it has no objection; when it reads as distress ('support') or
 * an off-limits question ('redirect'), it is masked and still travels, and a
 * distress note is filed as unsafe whatever reason was tapped. Phone numbers,
 * email addresses and addresses are masked in every case. Cut to 500
 * characters, because masking can lengthen it.
 */
export function prepareReport(i: {
  reason: ProblemKind
  note: string
  pathname: string
  now: Date
  release: string | null
  platform: 'web' | 'android'
}): { report: ProblemReport; why: 'support' | 'redirect' | null } {
  const verdict = screen(i.note, 'from-student', { limit: MAX_NOTE })
  const why = verdict.kind === 'support' || verdict.kind === 'redirect' ? verdict.kind : null
  const text =
    verdict.kind === 'allow' || verdict.kind === 'clean' ? verdict.text : redact(i.note, 'from-student', { limit: MAX_NOTE }).text
  const { where, itemId } = placeOf(i.pathname)
  return {
    report: {
      kind: why === 'support' ? 'unsafe' : i.reason,
      note: text.slice(0, MAX_NOTE),
      where,
      itemId,
      platform: i.platform,
      release: i.release,
      at: i.now.toISOString(),
    },
    why,
  }
}

/** What the sheet says when a report did not send and the server gave none of its own reasons. */
export const NOT_SENT = 'This did not send, and nothing was kept on this phone. Try again, or tell a teacher.'

/** lms.report_problem's refusals (0067), shown to the child as they are. */
const SERVER_SAYS = [
  'only a student can send a report from here',
  'a report is wrong, rude, unsafe or other',
  'say where in the app this happened',
  'a report is at most 500 characters',
  'say whether this is the web app or the Android app',
  'You have sent 10 reports today. Please tell a teacher, or call Childline on 1098 if you need help now.',
]

export function failureText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return SERVER_SAYS.find((s) => message.includes(s)) ?? NOT_SENT
}
