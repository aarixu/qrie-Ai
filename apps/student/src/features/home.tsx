import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { CalendarDays, Camera, ChevronRight, ClipboardCheck, ListChecks, NotebookPen } from 'lucide-react'
import type { MyAssignment, UpcomingEvent } from '@ai-tutor/lms-client'
import { api, say } from '@/lib/backend'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Progress } from './progress'

export function kindLabel(a: Pick<MyAssignment, 'kind'>): string {
  return a.kind === 'test' ? 'Test' : a.kind === 'assignment' ? 'Assignment' : 'Homework'
}

/**
 * Where one piece of work stands for this student. 'none' is work with
 * nothing to do in the app — a test on paper — until its marks arrive.
 */
export function standing(a: MyAssignment): 'todo' | 'overdue' | 'done' | 'none' {
  const onlyPaper = a.answerTypes.every((t) => t === 'paper')
  if (onlyPaper) return a.resultsReleased && a.teacherScore !== null ? 'done' : 'none'
  const mcqDone = !a.answerTypes.includes('mcq') || a.mcqAttemptsUsed > 0
  const photoDone = !a.answerTypes.includes('photo') || a.photoSubmitted
  const tasksDone = !a.answerTypes.includes('checklist') || (a.tasksTotal > 0 && a.tasksDone === a.tasksTotal)
  if (mcqDone && photoDone && tasksDone) return 'done'
  return new Date(a.dueAt) < new Date() ? 'overdue' : 'todo'
}

/** The mark to show: the teacher's where given, else the best try — once the student may see it. */
export function scoreText(a: MyAssignment): string | null {
  if (!a.resultsReleased) return null
  if (a.teacherScore !== null && a.teacherMax) return `${a.teacherScore} / ${a.teacherMax}`
  if (a.bestTotal) return `${a.bestCorrect} / ${a.bestTotal}`
  return null
}

export function Home() {
  const mine = useQuery({ queryKey: ['my-assignments'], queryFn: api.myAssignments })

  if (mine.isPending) return <p className='text-muted-foreground'>Loading your work…</p>
  if (mine.isError) return <p className='text-destructive'>{say(mine.error)}</p>

  const todo = mine.data.filter((a) => standing(a) === 'todo')
  const overdue = mine.data.filter((a) => standing(a) === 'overdue')
  const done = mine.data
    .filter((a) => standing(a) === 'done')
    .sort((a, b) => b.dueAt.localeCompare(a.dueAt))

  return (
    <div className='space-y-6'>
      <ComingUp />
      <Section title='To do' empty='Nothing to do right now. Well done!' items={todo} />
      {overdue.length > 0 && (
        <Section title='Late — you can still hand these in' items={overdue} tone='late' />
      )}
      <Section title='Done' empty='Nothing handed in yet.' items={done} />
      <Progress />
    </div>
  )
}

const EVENT_WORDS: Record<string, string> = {
  test: 'Test',
  ptm: 'PTM',
  exam: 'Exam',
  holiday: 'Holiday',
  trip: 'Trip',
  event: 'Event',
  other: 'Event',
}

/** Tests and school events in the next few weeks (lms.upcoming_events). */
function ComingUp() {
  const upcoming = useQuery({ queryKey: ['upcoming'], queryFn: () => api.upcomingEvents(30) })
  const rows = upcoming.data ?? []
  if (upcoming.isError) return <p className='text-sm text-destructive'>{say(upcoming.error)}</p>
  if (rows.length === 0) return null
  return (
    <section>
      <h2 className='mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase'>Coming up</h2>
      <ul className='space-y-2'>
        {rows.slice(0, 5).map((e) => (
          <li key={`${e.source}-${e.id}`}>
            <EventRow e={e} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function EventRow({ e }: { e: UpcomingEvent }) {
  const starts = new Date(e.startsAt)
  const inner = (
    <div className='flex items-center gap-3 rounded-xl border bg-card p-3'>
      <div className='flex w-12 shrink-0 flex-col items-center rounded-lg bg-primary/10 py-1 text-primary'>
        <span className='text-xs uppercase'>{format(starts, 'MMM')}</span>
        <span className='text-lg leading-none font-bold'>{format(starts, 'd')}</span>
      </div>
      <div className='min-w-0 flex-1'>
        <p className='text-xs text-muted-foreground'>
          {EVENT_WORDS[e.kind] ?? 'Event'}
          {e.source === 'test' && e.details ? ` · ${e.details}` : ''}
          {e.source === 'event' && !e.className ? ' · Whole school' : ''}
        </p>
        <p className='truncate font-medium'>{e.title}</p>
        <p className='text-xs text-muted-foreground'>
          {starts.getHours() === 0 && starts.getMinutes() === 0 && !e.endsAt ? format(starts, 'EEEE') : format(starts, 'EEE, h:mm a')}
        </p>
        {e.source === 'event' && e.details && <p className='mt-1 text-xs text-muted-foreground'>{e.details}</p>}
      </div>
      {e.source === 'test' ? <ChevronRight className='size-4 shrink-0 text-muted-foreground' /> : <CalendarDays className='size-4 shrink-0 text-muted-foreground' />}
    </div>
  )
  return e.source === 'test' ? (
    <Link to='/homework/$assignmentId' params={{ assignmentId: e.id }} className='block active:opacity-80'>
      {inner}
    </Link>
  ) : (
    inner
  )
}

function Section({
  title,
  items,
  empty,
  tone,
}: {
  title: string
  items: MyAssignment[]
  empty?: string
  tone?: 'late'
}) {
  return (
    <section>
      <h2 className={cn('mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground', tone === 'late' && 'text-orange-600')}>
        {title} {items.length > 0 && `(${items.length})`}
      </h2>
      {items.length === 0 ? (
        <p className='text-sm text-muted-foreground'>{empty}</p>
      ) : (
        <ul className='space-y-2'>
          {items.map((a) => (
            <li key={a.id}>
              <Card a={a} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Icon({ a }: { a: MyAssignment }) {
  if (a.kind === 'test') return <ClipboardCheck className='size-5' />
  if (a.answerTypes.includes('checklist')) return <NotebookPen className='size-5' />
  if (a.answerTypes.includes('mcq')) return <ListChecks className='size-5' />
  return <Camera className='size-5' />
}

function Card({ a }: { a: MyAssignment }) {
  const s = standing(a)
  const score = scoreText(a)
  const due = new Date(a.dueAt)
  const ticked = a.answerTypes.includes('checklist') && s !== 'done' && a.tasksDone > 0
  return (
    <Link
      to='/homework/$assignmentId'
      params={{ assignmentId: a.id }}
      className='flex items-center gap-3 rounded-xl border bg-card p-3 active:bg-accent'
    >
      <div className='flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
        <Icon a={a} />
      </div>
      <div className='min-w-0 flex-1'>
        <p className='text-xs text-muted-foreground'>
          {kindLabel(a)} · {a.subjectName}
        </p>
        <p className='truncate font-medium'>{a.title}</p>
        <p className={cn('text-xs', s === 'overdue' ? 'text-orange-600' : 'text-muted-foreground')}>
          {s === 'done'
            ? `Due ${format(due, 'd MMM')}`
            : s === 'overdue'
              ? `Was due ${formatDistanceToNowStrict(due, { addSuffix: true })}`
              : `Due ${formatDistanceToNowStrict(due, { addSuffix: true })} · ${format(due, 'd MMM, h:mm a')}`}
          {ticked && ` · ${a.tasksDone} of ${a.tasksTotal} ticked`}
        </p>
      </div>
      {a.teacherStatus === 'checked' && s !== 'done' && <Badge variant='outline'>Checked</Badge>}
      {s === 'done' &&
        (score ? (
          <Badge variant='secondary' className='tabular-nums'>{score}</Badge>
        ) : (
          <Badge variant='outline'>
            {a.teacherStatus === 'checked' ? 'Checked ✓' : a.kind === 'test' && !a.resultsReleased ? 'Handed in' : 'Done'}
          </Badge>
        ))}
      <ChevronRight className='size-4 shrink-0 text-muted-foreground' />
    </Link>
  )
}
