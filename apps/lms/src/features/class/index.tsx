import { useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { format } from 'date-fns'
import { CalendarPlus, ChevronDown, Plus } from 'lucide-react'
import type { AssignmentSummary, ResultRow } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loading, Page, Problem } from '@/components/layout/page'
import { className } from '@/features/dashboard'
import { EventDialog } from '@/features/events/event-dialog'
import { UpcomingList } from '@/features/events/upcoming'
import { WORK_KINDS, kindLabel } from '@/features/homework/kinds'
import { Insights } from './insights'

type ClassPageProps = { sectionId: string; subjectId: string }

export function ClassPage({ sectionId, subjectId }: ClassPageProps) {
  const classes = useQuery({ queryKey: ['classes'], queryFn: api.myClasses })
  const c = classes.data?.find(
    (x) => x.sectionId === sectionId && x.subjectId === subjectId
  )
  const [eventOpen, setEventOpen] = useState(false)

  return (
    <Page
      title={c ? `${className(c)} · ${c.subjectName}` : 'Class'}
      description={c ? `${c.students} students` : undefined}
      back={{ label: 'My classes', to: '/' }}
      actions={
        c && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Plus /> Create <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-64'>
              {WORK_KINDS.map((k) => (
                <DropdownMenuItem key={k.kind} asChild>
                  <Link
                    to='/classes/$sectionId/$subjectId/new'
                    params={{ sectionId, subjectId }}
                    search={{ kind: k.kind }}
                    className='flex flex-col items-start gap-0'
                  >
                    <span className='font-medium'>{k.label}</span>
                    <span className='text-xs text-muted-foreground'>{k.blurb}</span>
                  </Link>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setEventOpen(true)}>
                <CalendarPlus /> Event (PTM, exam, trip…)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      }
    >
      {classes.isPending ? (
        <Loading what='the class' />
      ) : classes.isError ? (
        <Problem error={classes.error} />
      ) : !c ? (
        <p className='text-muted-foreground'>
          This is not one of your classes.
        </p>
      ) : (
        <Tabs defaultValue='homework' className='space-y-4'>
          <TabsList>
            <TabsTrigger value='homework'>Classwork</TabsTrigger>
            <TabsTrigger value='upcoming'>Coming up</TabsTrigger>
            <TabsTrigger value='insights'>Insights</TabsTrigger>
            <TabsTrigger value='grades'>Gradebook</TabsTrigger>
            <TabsTrigger value='students'>Students</TabsTrigger>
          </TabsList>
          <TabsContent value='homework'>
            <HomeworkList sectionId={sectionId} subjectId={subjectId} />
          </TabsContent>
          <TabsContent value='upcoming'>
            <UpcomingList sectionId={sectionId} empty='Nothing coming up for this class. Use Create → Event to add one.' />
          </TabsContent>
          <TabsContent value='insights'>
            <Insights sectionId={sectionId} subjectId={subjectId} />
          </TabsContent>
          <TabsContent value='grades'>
            <Gradebook sectionId={sectionId} subjectId={subjectId} />
          </TabsContent>
          <TabsContent value='students'>
            <Roster sectionId={sectionId} />
          </TabsContent>
        </Tabs>
      )}
      {c && (
        <EventDialog
          open={eventOpen}
          onOpenChange={setEventOpen}
          audiences={[{ sectionId, label: `${className(c)} only` }]}
        />
      )}
    </Page>
  )
}

export function statusOf(a: AssignmentSummary): { label: string; tone: 'draft' | 'open' | 'closed' } {
  if (!a.published) return { label: 'Draft', tone: 'draft' }
  if (a.opensAt && new Date(a.opensAt) > new Date()) {
    return { label: `Opens ${format(new Date(a.opensAt), 'd MMM')}`, tone: 'draft' }
  }
  return new Date(a.dueAt) > new Date()
    ? { label: 'Open', tone: 'open' }
    : { label: 'Closed', tone: 'closed' }
}

export function StatusBadge({ a }: { a: AssignmentSummary }) {
  const s = statusOf(a)
  return (
    <Badge
      variant={s.tone === 'open' ? 'default' : s.tone === 'draft' ? 'outline' : 'secondary'}
    >
      {s.label}
    </Badge>
  )
}

function useClassWork(sectionId: string, subjectId: string) {
  return useQuery({
    queryKey: ['class-assignments', sectionId, subjectId],
    queryFn: () => api.classAssignments(sectionId, subjectId),
  })
}

function HomeworkList({ sectionId, subjectId }: ClassPageProps) {
  const navigate = useNavigate()
  const work = useClassWork(sectionId, subjectId)
  if (work.isPending) return <Loading what='homework' />
  if (work.isError) return <Problem error={work.error} />
  if (work.data.length === 0) {
    return (
      <p className='text-muted-foreground'>
        Nothing set yet. Use Create to set homework, an assignment or a test.
      </p>
    )
  }
  const open = (a: AssignmentSummary) =>
    a.published
      ? navigate({ to: '/homework/$assignmentId', params: { assignmentId: a.id } })
      : navigate({ to: '/homework/$assignmentId/edit', params: { assignmentId: a.id } })

  return (
    <div className='overflow-x-auto rounded-md border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Work</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Due</TableHead>
            <TableHead>What students do</TableHead>
            <TableHead className='w-48'>Handed in</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {work.data.map((a) => (
            <TableRow
              key={a.id}
              className='cursor-pointer'
              tabIndex={0}
              onClick={() => open(a)}
              onKeyDown={(e) => e.key === 'Enter' && open(a)}
            >
              <TableCell className='font-medium'>{a.title}</TableCell>
              <TableCell>{kindLabel(a.kind)}</TableCell>
              <TableCell>
                <StatusBadge a={a} />
              </TableCell>
              <TableCell>{format(new Date(a.dueAt), 'd MMM, h:mm a')}</TableCell>
              <TableCell className='text-sm text-muted-foreground'>{partsOf(a)}</TableCell>
              <TableCell>
                {a.published ? <Progress done={a.submitted} of={a.students} /> : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/** What a piece of work asks of students, in a few words. */
export function partsOf(a: AssignmentSummary): string {
  const parts: string[] = []
  if (a.answerTypes.includes('checklist')) parts.push(`${a.tasks} ${a.tasks === 1 ? 'task' : 'tasks'} in the notebook`)
  if (a.answerTypes.includes('mcq')) {
    parts.push(`${a.items} ${a.items === 1 ? 'question' : 'questions'}${a.timeLimitMinutes ? `, ${a.timeLimitMinutes} min` : ''}`)
  }
  if (a.answerTypes.includes('photo')) parts.push('photo')
  if (a.answerTypes.includes('paper')) parts.push(`on paper, out of ${a.maxMarks ?? '?'}`)
  return parts.join(' · ')
}

export function Progress({ done, of }: { done: number; of: number }) {
  const pct = of ? Math.round((done / of) * 100) : 0
  return (
    <div className='flex items-center gap-2'>
      <div className='h-2 flex-1 overflow-hidden rounded-full bg-muted'>
        <div className='h-full bg-primary' style={{ width: `${pct}%` }} />
      </div>
      <span className='w-12 text-end text-xs tabular-nums text-muted-foreground'>
        {done}/{of}
      </span>
    </div>
  )
}

/**
 * Every student against every published homework: the score of their latest
 * attempt (the teacher's mark where one is given), late work flagged, and
 * missing work shown as missing — the view a teacher uses to spot who is
 * falling behind.
 */
function Gradebook({ sectionId, subjectId }: ClassPageProps) {
  const work = useClassWork(sectionId, subjectId)
  const published = (work.data ?? [])
    .filter((a) => a.published)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
  const results = useQueries({
    queries: published.map((a) => ({
      queryKey: ['results', a.id],
      queryFn: () => api.assignmentResults(a.id),
    })),
  })
  if (work.isPending || results.some((r) => r.isPending)) return <Loading what='the gradebook' />
  const failed = work.error ?? results.find((r) => r.isError)?.error
  if (failed) return <Problem error={failed} />
  if (published.length === 0) {
    return <p className='text-muted-foreground'>Nothing published yet, so nothing to grade.</p>
  }

  const byStudent = new Map<string, { row: ResultRow; cells: (ResultRow | undefined)[] }>()
  results.forEach((r, col) => {
    for (const row of r.data ?? []) {
      const entry = byStudent.get(row.studentUserId) ?? { row, cells: [] }
      entry.cells[col] = row
      byStudent.set(row.studentUserId, entry)
    }
  })

  return (
    <div className='overflow-x-auto rounded-md border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className='sticky left-0 bg-background'>Student</TableHead>
            {published.map((a) => (
              <TableHead key={a.id} className='min-w-28 text-center'>
                <Link
                  to='/homework/$assignmentId'
                  params={{ assignmentId: a.id }}
                  className='hover:underline'
                >
                  {a.title}
                </Link>
              </TableHead>
            ))}
            <TableHead className='text-center'>Average</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...byStudent.values()].map(({ row, cells }) => {
            const scores = cells.map(scoreOf).filter((s): s is number => s !== null)
            const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
            return (
              <TableRow key={row.studentUserId}>
                <TableCell className='sticky left-0 bg-background font-medium'>
                  <span className='me-2 text-muted-foreground tabular-nums'>{row.rollNumber}</span>
                  {row.displayName}
                </TableCell>
                {published.map((a, i) => (
                  <TableCell key={a.id} className='text-center'>
                    <GradeCell r={cells[i]} past={new Date(a.dueAt) < new Date()} />
                  </TableCell>
                ))}
                <TableCell
                  className={cn('text-center font-medium tabular-nums', avg !== null && avg < 0.5 && 'text-destructive')}
                >
                  {avg === null ? '—' : `${Math.round(avg * 100)}%`}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

/** The teacher's mark where given, else the machine's; a fraction of 1. */
export function scoreOf(r: ResultRow | undefined): number | null {
  if (!r) return null
  if (r.paperScore !== null && r.paperMax) return r.paperScore / r.paperMax
  if (r.teacherScore !== null && r.teacherMax) return r.teacherScore / r.teacherMax
  if (r.machineTotal) return (r.machineCorrect ?? 0) / r.machineTotal
  if (r.photoTeacherScore !== null && r.photoTeacherMax) return r.photoTeacherScore / r.photoTeacherMax
  return null
}

function GradeCell({ r, past }: { r: ResultRow | undefined; past: boolean }) {
  if (r?.teacherStatus === 'absent') return <span className='text-muted-foreground'>Absent</span>
  if (r?.teacherStatus === 'not_done') return <span className='text-destructive'>Not done</span>
  if (!r || !r.submitted) {
    return past ? (
      <span className='text-destructive'>Missing</span>
    ) : (
      <span className='text-muted-foreground'>—</span>
    )
  }
  const s = scoreOf(r)
  return (
    <span className={cn('tabular-nums', s !== null && s < 0.5 && 'text-destructive')}>
      {s !== null
        ? `${Math.round(s * 100)}%`
        : r.tasksTotal > 0 && r.tasksDone === r.tasksTotal
          ? 'Done'
          : 'To mark'}
      {r.late && <span className='ms-1 text-xs text-orange-600'>late</span>}
    </span>
  )
}

function Roster({ sectionId }: { sectionId: string }) {
  const roster = useQuery({
    queryKey: ['roster', sectionId],
    queryFn: () => api.classRoster(sectionId),
  })
  if (roster.isPending) return <Loading what='the students' />
  if (roster.isError) return <Problem error={roster.error} />
  return (
    <div className='overflow-x-auto rounded-md border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className='w-16'>Roll</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>School ID</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {roster.data.map((s) => (
            <TableRow key={s.studentUserId}>
              <TableCell className='tabular-nums'>{s.rollNumber ?? '—'}</TableCell>
              <TableCell className='font-medium'>{s.displayName}</TableCell>
              <TableCell className='font-mono text-sm'>{s.loginId}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
