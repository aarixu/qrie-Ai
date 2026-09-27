import type { Me } from '@ai-tutor/lms-client'
import type { ReportBrand, ReportData } from '@ai-tutor/lms-report'
import { api } from '@/lib/backend'

/** Everything one student's report card shows, as the caller may see it (lms.student_*). */
export async function reportFor(studentId: string): Promise<ReportData> {
  const [card, subjects, chapters, timeline, mistakes] = await Promise.all([
    api.studentCard(studentId),
    api.studentSubjects(studentId),
    api.studentChapters(studentId),
    api.studentTimeline(studentId),
    api.studentMistakes(studentId),
  ])
  if (!card) throw new Error('No such student.')
  return { card, subjects, chapters, timeline, mistakes }
}

/** The school's name, colour and logo, for the top of the card. */
export async function brandOf(me: Me): Promise<ReportBrand> {
  const logo = await api.schoolLogo().catch(() => null)
  return {
    schoolName: me.schoolName,
    primary: typeof me.brand?.primary === 'string' ? me.brand.primary : null,
    logo: logo ? { mime: logo.mime, base64: logo.base64 } : null,
  }
}

/** A teacher's card shows only the subjects they teach the child; it says so. */
export function scopeFor(me: Me): string | undefined {
  return me.kind === 'admin' ? undefined : `Showing the subjects taught by ${me.displayName}`
}

/** Runs `fn` over `items`, at most `limit` at a time, keeping their order. */
export async function inTurn<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  onDone?: (count: number) => void
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i]!)
      onDone?.(++done)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
