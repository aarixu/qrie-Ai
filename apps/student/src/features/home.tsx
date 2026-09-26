import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { Camera, ChevronRight, ListChecks } from 'lucide-react'
import type { MyAssignment } from '@ai-tutor/lms-client'
import { api, say } from '@/lib/backend'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Progress } from './progress'

/** Where one homework stands for this student. */
export function standing(a: MyAssignment): 'todo' | 'overdue' | 'done' {
  const mcqDone = !a.answerTypes.includes('mcq') || a.mcqAttemptsUsed > 0
  const photoDone = !a.answerTypes.includes('photo') || a.photoSubmitted
  if (mcqDone && photoDone) return 'done'
  return new Date(a.dueAt) < new Date() ? 'overdue' : 'todo'
}

export function scoreText(a: MyAssignment): string | null {
  if (a.teacherScore !== null && a.teacherMax) return `${a.teacherScore} / ${a.teacherMax}`
  if (a.bestTotal) return `${a.bestCorrect} / ${a.bestTotal}`
  return null
}

export function Home() {
  const mine = useQuery({ queryKey: ['my-assignments'], queryFn: api.myAssignments })

  if (mine.isPending) return <p className='text-muted-foreground'>Loading your homework…</p>
  if (mine.isError) return <p className='text-destructive'>{say(mine.error)}</p>

  const todo = mine.data.filter((a) => standing(a) === 'todo')
  const overdue = mine.data.filter((a) => standing(a) === 'overdue')
  const done = mine.data
    .filter((a) => standing(a) === 'done')
    .sort((a, b) => b.dueAt.localeCompare(a.dueAt))

  return (
    <div className='space-y-6'>
      <Section title='To do' empty='Nothing to do right now. Well done!' items={todo} />
      {overdue.length > 0 && (
        <Section
          title='Late — you can still hand these in'
          items={overdue}
          tone='late'
        />
      )}
      <Section title='Done' empty='Nothing handed in yet.' items={done} />
      <Progress />
    </div>
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

function Card({ a }: { a: MyAssignment }) {
  const s = standing(a)
  const score = scoreText(a)
  const due = new Date(a.dueAt)
  return (
    <Link
      to='/homework/$assignmentId'
      params={{ assignmentId: a.id }}
      className='flex items-center gap-3 rounded-xl border bg-card p-3 active:bg-accent'
    >
      <div className='flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
        {a.answerTypes.includes('mcq') ? <ListChecks className='size-5' /> : <Camera className='size-5' />}
      </div>
      <div className='min-w-0 flex-1'>
        <p className='text-xs text-muted-foreground'>{a.subjectName}</p>
        <p className='truncate font-medium'>{a.title}</p>
        <p className={cn('text-xs', s === 'overdue' ? 'text-orange-600' : 'text-muted-foreground')}>
          {s === 'done'
            ? `Due ${format(due, 'd MMM')}`
            : s === 'overdue'
              ? `Was due ${formatDistanceToNowStrict(due, { addSuffix: true })}`
              : `Due ${formatDistanceToNowStrict(due, { addSuffix: true })} · ${format(due, 'd MMM, h:mm a')}`}
        </p>
      </div>
      {s === 'done' &&
        (score ? (
          <Badge variant='secondary' className='tabular-nums'>{score}</Badge>
        ) : (
          <Badge variant='outline'>Handed in</Badge>
        ))}
      <ChevronRight className='size-4 shrink-0 text-muted-foreground' />
    </Link>
  )
}
