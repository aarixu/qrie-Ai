import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { ChapterStanding, ShownMisconception } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import { chapterTitle } from '@/lib/curriculum'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Loading, Problem } from '@/components/layout/page'
import { freshness, waitingText } from '@/features/analytics/freshness'
import { MasteryInfo } from '@/features/analytics/mastery-info'
import { LikelyMisconceptions } from './misconceptions'

/** Below this belief on their own, after enough answers given alone, a student is listed as needing help. */
const NEEDS_HELP = 0.4
const ENOUGH_ANSWERS = 3

const pct = (x: number) => `${Math.round(x * 100)}%`

function tone(m: number | null) {
  if (m === null) return 'text-muted-foreground'
  return m < NEEDS_HELP
    ? 'bg-red-500/15 text-red-700 dark:text-red-400'
    : m < 0.7
      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
      : 'bg-green-600/15 text-green-700 dark:text-green-400'
}

/**
 * What Qrie's learning model believes about this class, chapter by chapter
 * (lms.class_insights), and the misconceptions the students' own wrong
 * answers point to (lms.class_misconceptions per student; the class's
 * likely ones, with practice for those children, from
 * lms.class_likely_misconceptions). Belief is per outcome, from every answer
 * handed in, with prerequisites taken into account — so it is not the same
 * as the average mark. The figure shown first is from answers given on their
 * own; how they do with hints is beside it (0065). Above, how fresh it is
 * (lms.class_brain_status).
 */
export function Insights({ sectionId, subjectId }: { sectionId: string; subjectId: string }) {
  const standing = useQuery({
    queryKey: ['insights', sectionId, subjectId],
    queryFn: () => api.classInsights(sectionId, subjectId),
  })
  const shown = useQuery({
    queryKey: ['misconceptions', sectionId, subjectId],
    queryFn: () => api.classMisconceptions(sectionId, subjectId),
  })
  const status = useQuery({
    queryKey: ['brain-status', sectionId, subjectId],
    queryFn: () => api.classBrainStatus(sectionId, subjectId),
  })
  if (standing.isError) return <Problem error={standing.error} />
  if (shown.isError) return <Problem error={shown.error} />
  if (standing.isPending || shown.isPending) return <Loading what='the insights' />
  const fresh = freshness(status.data)
  if (standing.data.length === 0) {
    return (
      <p className='text-muted-foreground'>
        {waitingText(status.data) ??
          'No answers yet, so nothing to show. Insights appear once students hand in homework.'}
      </p>
    )
  }
  return (
    <div className='space-y-6'>
      <p className='max-w-3xl text-sm text-muted-foreground'>
        Worked out by Qrie’s learning model from every answer each student has handed in, question by
        question — not from the marks. The first figure is from answers given on their own; “with help” is how
        they do after hints. “Needs help” means below {pct(NEEDS_HELP)} on their own after at least{' '}
        {ENOUGH_ANSWERS} answers given alone in that chapter.
        {fresh && (
          <span className={cn('ms-1 font-medium', fresh.delayed ? 'text-amber-700 dark:text-amber-400' : '')}>
            {fresh.text}.
          </span>
        )}
      </p>
      <NeedsHelp rows={standing.data} shown={shown.data} />
      <LikelyMisconceptions sectionId={sectionId} subjectId={subjectId} />
      <Heatmap rows={standing.data} />
    </div>
  )
}

/** The rows below NEEDS_HELP on their own, after ENOUGH_ANSWERS or more answers given alone. */
export function needsHelp(rows: ChapterStanding[]): ChapterStanding[] {
  return rows.filter(
    (r) => r.unassistedMastery !== null && r.unassistedObservations >= ENOUGH_ANSWERS && r.unassistedMastery < NEEDS_HELP
  )
}

/** How they do after hints, beside the figure on their own; nothing when they had none. */
function WithHelp({ r }: { r: ChapterStanding }) {
  if (r.assistedPerformance === null) return null
  return <span className='ms-1 text-[11px] text-muted-foreground tabular-nums'>with help {pct(r.assistedPerformance)}</span>
}

function NeedsHelp({ rows, shown }: { rows: ChapterStanding[]; shown: ShownMisconception[] }) {
  const byChapter = new Map<string, ChapterStanding[]>()
  for (const r of needsHelp(rows)) {
    byChapter.set(r.chapter, [...(byChapter.get(r.chapter) ?? []), r])
  }
  const chapters = [...byChapter.entries()].sort((a, b) => b[1].length - a[1].length)
  // The mistakes this student's own wrong answers in this chapter point to,
  // most repeated first; two is enough for a teacher to act on.
  const mistakesOf = (s: ChapterStanding) =>
    shown
      .filter((m) => m.studentUserId === s.studentUserId && m.chapter === s.chapter)
      .sort((a, b) => b.times - a.times)
      .slice(0, 2)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Who needs help, on what</CardTitle>
        <CardDescription>
          {chapters.length === 0 ? 'Nobody is below the line in any chapter.' : 'Chapters with the most students struggling first.'}
        </CardDescription>
      </CardHeader>
      {chapters.length > 0 && (
        <CardContent className='space-y-5'>
          {chapters.map(([chapter, list]) => (
            <div key={chapter}>
              <p className='mb-2 font-medium'>
                {chapterTitle(chapter)}{' '}
                <span className='text-sm font-normal text-muted-foreground'>
                  — {list.length} {list.length === 1 ? 'student' : 'students'}
                </span>
              </p>
              <ul className='space-y-1.5'>
                {list
                  .sort((a, b) => a.unassistedMastery! - b.unassistedMastery!)
                  .map((s) => {
                    const mistakes = mistakesOf(s)
                    return (
                      <li key={s.studentUserId} className='flex flex-wrap items-baseline gap-x-2 text-sm'>
                        <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium tabular-nums', tone(s.unassistedMastery))}>
                          {pct(s.unassistedMastery!)}
                        </span>
                        <WithHelp r={s} />
                        <Link to='/students/$studentId' params={{ studentId: s.studentUserId }} className='font-medium hover:underline'>
                          {s.displayName}
                        </Link>
                        <span className='text-muted-foreground'>({s.answers} answers)</span>
                        {mistakes.length > 0 && (
                          <span className='text-muted-foreground'>
                            — likely:{' '}
                            {mistakes.map((m) => (m.times > 1 ? `${m.label} (${m.times}×)` : m.label)).join('; ')}
                          </span>
                        )}
                      </li>
                    )
                  })}
              </ul>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  )
}

/** Every student and chapter: the figure on their own, and with help beside it. */
export function Heatmap({ rows }: { rows: ChapterStanding[] }) {
  const chapters = [...new Set(rows.map((r) => r.chapter))].sort()
  const students = new Map<string, { name: string; roll: string | null; by: Map<string, ChapterStanding> }>()
  for (const r of rows) {
    const s = students.get(r.studentUserId) ?? { name: r.displayName, roll: r.rollNumber, by: new Map() }
    s.by.set(r.chapter, r)
    students.set(r.studentUserId, s)
  }
  const ordered = [...students.values()].sort(
    (a, b) => Number(a.roll ?? 1e9) - Number(b.roll ?? 1e9) || a.name.localeCompare(b.name)
  )
  return (
    <div>
      <h2 className='mb-2 flex items-center gap-1.5 font-semibold'>
        Every student, every chapter <MasteryInfo />
      </h2>
      <p className='mb-2 text-sm text-muted-foreground'>
        On their own first: answers given without a hint. With help, in small type: how they do after hints.
      </p>
      <div className='overflow-x-auto rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='sticky left-0 bg-background'>Student</TableHead>
              {chapters.map((c) => (
                <TableHead key={c} className='min-w-28 text-center'>
                  {chapterTitle(c)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordered.map((s) => (
              <TableRow key={s.name + s.roll}>
                <TableCell className='sticky left-0 bg-background font-medium'>
                  <span className='me-2 text-muted-foreground tabular-nums'>{s.roll}</span>
                  {s.name}
                </TableCell>
                {chapters.map((c) => {
                  const r = s.by.get(c)
                  return (
                    <TableCell key={c} className='text-center'>
                      {r ? (
                        <span title={`${r.answers} answers across ${r.outcomesSeen} topics, ${r.unassistedObservations} on their own`}>
                          <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium tabular-nums', tone(r.unassistedMastery))}>
                            {r.unassistedMastery === null ? '—' : pct(r.unassistedMastery)}
                          </span>
                          <WithHelp r={r} />
                        </span>
                      ) : (
                        <span className='text-muted-foreground'>—</span>
                      )}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
