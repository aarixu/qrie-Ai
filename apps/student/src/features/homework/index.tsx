import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { ArrowLeft, CheckCircle2, Clock } from 'lucide-react'
import { toast } from 'sonner'
import type { MyAssignment } from '@ai-tutor/lms-client'
import { api, say } from '@/lib/backend'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { kindLabel, scoreText, standing } from '@/features/home'
import { Photos } from './photos'
import { Quiz } from './quiz'
import { Review } from './review'

export function HomeworkPage({ assignmentId }: { assignmentId: string }) {
  const mine = useQuery({ queryKey: ['my-assignments'], queryFn: api.myAssignments })
  const [mode, setMode] = useState<'overview' | 'quiz' | 'review'>('overview')

  if (mine.isPending) return <p className='text-muted-foreground'>Loading…</p>
  if (mine.isError) return <p className='text-destructive'>{say(mine.error)}</p>
  const a = mine.data.find((x) => x.id === assignmentId)
  if (!a) {
    return (
      <div className='space-y-3'>
        <p>This is not in your list.</p>
        <Link to='/work' className='underline'>Back to your work</Link>
      </div>
    )
  }

  if (mode === 'quiz') {
    return (
      <Quiz
        a={a}
        endsAt={a.kind === 'test' ? (a.endsAt ?? undefined) : undefined}
        onDone={() => setMode('review')}
        onCancel={() => setMode('overview')}
      />
    )
  }

  const due = new Date(a.dueAt)
  const late = due < new Date()
  const behind = standing(a) === 'overdue'
  const test = a.kind === 'test'
  const paper = a.answerTypes.includes('paper')

  return (
    <div className='space-y-5'>
      <Link to='/work' className='inline-flex items-center gap-1 text-sm text-muted-foreground'>
        <ArrowLeft className='size-4' /> All work
      </Link>
      <div>
        <p className='text-sm text-muted-foreground'>
          {kindLabel(a)} · {a.subjectName}
        </p>
        <h1 className='text-2xl font-bold tracking-tight'>{a.title}</h1>
        <p className={behind ? 'text-sm text-orange-600' : 'text-sm text-muted-foreground'}>
          {paper
            ? `In class on ${format(due, 'EEEE d MMM')}`
            : `${test ? (late ? 'Closed' : 'Closes') : late ? 'Was due' : 'Due'} ${format(due, 'EEEE d MMM, h:mm a')} (${formatDistanceToNowStrict(due, { addSuffix: true })})`}
        </p>
      </div>
      {a.instructions && <p className='whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm'>{a.instructions}</p>}

      {a.resultsReleased && a.markedAt && a.teacherScore !== null && (
        <div className='rounded-xl border border-primary/40 bg-primary/5 p-4'>
          <p className='text-sm text-muted-foreground'>{paper ? 'Your marks' : 'Your teacher’s mark'}</p>
          <p className='text-3xl font-bold tabular-nums'>
            {a.teacherScore} <span className='text-lg font-normal text-muted-foreground'>/ {a.teacherMax}</span>
          </p>
        </div>
      )}

      {a.teacherStatus && <TeacherWord status={a.teacherStatus} />}

      {a.answerTypes.includes('checklist') && <Checklist a={a} />}

      {a.answerTypes.includes('mcq') &&
        (test ? (
          <TestSection a={a} mode={mode} onStart={() => setMode('quiz')} onReview={() => setMode('review')} />
        ) : (
          <QuestionsSection a={a} mode={mode} onStart={() => setMode('quiz')} onReview={() => setMode('review')} />
        ))}

      {paper && !(a.resultsReleased && a.teacherScore !== null) && (
        <section className='rounded-xl border p-4 text-sm'>
          This test is on paper, in class. Your marks appear here when your teacher shares them.
        </section>
      )}

      {a.answerTypes.includes('photo') && (
        <section className='space-y-3 rounded-xl border p-4'>
          <h2 className='font-semibold'>Photos of your work</h2>
          {a.photoSubmitted ? (
            <p className='flex items-center gap-2'>
              <CheckCircle2 className='size-5 text-green-600' /> Handed in. Your teacher will mark it.
            </p>
          ) : (
            <Photos a={a} />
          )}
        </section>
      )}
    </div>
  )
}

/** Written work in the notebook: one box per task, ticked when it is done. */
function Checklist({ a }: { a: MyAssignment }) {
  const queryClient = useQueryClient()
  const tasks = useQuery({ queryKey: ['my-tasks', a.id], queryFn: () => api.myTasks(a.id) })
  const tick = useMutation({
    mutationFn: ({ taskId, done }: { taskId: string; done: boolean }) => api.tickTask(taskId, done),
    onMutate: async ({ taskId, done }) => {
      queryClient.setQueryData(['my-tasks', a.id], (old: typeof tasks.data) =>
        old?.map((t) => (t.taskId === taskId ? { ...t, done } : t))
      )
    },
    onError: (e) => toast.error(say(e)),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['my-tasks', a.id] })
      queryClient.invalidateQueries({ queryKey: ['my-assignments'] })
    },
  })
  const list = tasks.data ?? []
  const done = list.filter((t) => t.done).length
  return (
    <section className='space-y-3 rounded-xl border p-4'>
      <div className='flex items-baseline justify-between'>
        <h2 className='font-semibold'>Written work</h2>
        {list.length > 0 && (
          <span className={cn('text-sm', done === list.length ? 'text-green-700' : 'text-muted-foreground')}>
            {done} of {list.length} done
          </span>
        )}
      </div>
      <p className='text-sm text-muted-foreground'>Do these in your notebook, and tick each one when it is done.</p>
      {tasks.isPending ? (
        <p className='text-sm text-muted-foreground'>Loading…</p>
      ) : tasks.isError ? (
        <p className='text-sm text-destructive'>{say(tasks.error)}</p>
      ) : (
        <ul className='space-y-2'>
          {list.map((t) => (
            <li key={t.taskId}>
              <button
                type='button'
                role='checkbox'
                aria-checked={t.done}
                onClick={() => tick.mutate({ taskId: t.taskId, done: !t.done })}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border-2 p-3 text-start transition-colors',
                  t.done ? 'border-green-600/50 bg-green-600/5' : 'active:bg-accent'
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border-2',
                    t.done ? 'border-green-600 bg-green-600 text-white' : 'border-muted-foreground/40'
                  )}
                  aria-hidden
                >
                  {t.done && '✓'}
                </span>
                <span className={cn(t.done && 'text-muted-foreground line-through')}>{t.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

type SectionProps = { a: MyAssignment; mode: string; onStart: () => void; onReview: () => void }

function QuestionsSection({ a, mode, onStart, onReview }: SectionProps) {
  const late = new Date(a.dueAt) < new Date()
  const attemptsLeft = a.attemptsAllowed - a.mcqAttemptsUsed
  const score = scoreText(a)
  return (
    <section className='space-y-3 rounded-xl border p-4'>
      <h2 className='font-semibold'>Questions</h2>
      {a.mcqAttemptsUsed === 0 ? (
        <>
          <p className='text-sm text-muted-foreground'>
            {a.questions} {a.questions === 1 ? 'question' : 'questions'} ·{' '}
            {a.attemptsAllowed === 1 ? 'one try' : `${a.attemptsAllowed} tries`}
            {late && ' · it will be marked late'}
          </p>
          <Button className='h-12 w-full text-base' onClick={onStart}>
            Start
          </Button>
        </>
      ) : (
        <>
          <p className='flex items-center gap-2'>
            <CheckCircle2 className='size-5 text-green-600' />
            Handed in{score && !a.markedAt ? ` — you got ${score}` : ''}
          </p>
          {mode === 'review' ? (
            <Review assignmentId={a.id} />
          ) : (
            <Button variant='outline' className='w-full' onClick={onReview}>
              See your answers
            </Button>
          )}
          {attemptsLeft > 0 && (
            <Button className='w-full' onClick={onStart}>
              Try again ({attemptsLeft} {attemptsLeft === 1 ? 'try' : 'tries'} left)
            </Button>
          )}
        </>
      )}
    </section>
  )
}

/**
 * An online test: it may not be open yet; starting it starts a clock the
 * school's server keeps (lms.start_test); the score waits for the teacher.
 */
function TestSection({ a, mode, onStart, onReview }: SectionProps) {
  const queryClient = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const start = useMutation({
    mutationFn: () => api.startTest(a.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['my-assignments'] })
      await queryClient.invalidateQueries({ queryKey: ['questions', a.id] })
      setConfirm(false)
      onStart()
    },
    onError: (e) => {
      setConfirm(false)
      toast.error(say(e))
    },
  })
  const now = new Date()
  const opens = a.opensAt ? new Date(a.opensAt) : null
  const handedIn = a.mcqAttemptsUsed > 0
  const ends = a.endsAt ? new Date(a.endsAt) : null
  const facts = `${a.questions} ${a.questions === 1 ? 'question' : 'questions'}${a.timeLimitMinutes ? ` · ${a.timeLimitMinutes} minutes` : ''} · one try`

  let body: React.ReactNode
  if (handedIn) {
    body = a.resultsReleased ? (
      <>
        <p className='flex items-center gap-2'>
          <CheckCircle2 className='size-5 text-green-600' /> Handed in — you got {scoreText(a)}
        </p>
        {mode === 'review' ? (
          <Review assignmentId={a.id} />
        ) : (
          <Button variant='outline' className='w-full' onClick={onReview}>
            See your answers
          </Button>
        )}
      </>
    ) : (
      <p className='flex items-center gap-2'>
        <CheckCircle2 className='size-5 text-green-600' /> Handed in. Your teacher will share the results.
      </p>
    )
  } else if (opens && opens > now) {
    body = (
      <p className='flex items-center gap-2 text-sm'>
        <Clock className='size-4' /> Opens {format(opens, 'EEEE d MMM, h:mm a')} ({formatDistanceToNowStrict(opens, { addSuffix: true })})
      </p>
    )
  } else if (ends && ends > now) {
    body = (
      <>
        <p className='text-sm'>You started this test. Your time ends at {format(ends, 'h:mm a')}.</p>
        <Button className='h-12 w-full text-base' onClick={onStart}>
          Carry on
        </Button>
      </>
    )
  } else if (ends) {
    body = (
      <p className='text-sm'>
        Your time is up. The answers you saved are being handed in — check back in a minute.
      </p>
    )
  } else if (new Date(a.dueAt) < now) {
    body = <p className='text-sm text-destructive'>This test has closed.</p>
  } else {
    body = (
      <Button className='h-12 w-full text-base' onClick={() => setConfirm(true)}>
        Start the test
      </Button>
    )
  }

  return (
    <section className='space-y-3 rounded-xl border p-4'>
      <h2 className='font-semibold'>Test</h2>
      <p className='text-sm text-muted-foreground'>{facts}</p>
      {body}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start the test now?</AlertDialogTitle>
            <AlertDialogDescription>
              {a.timeLimitMinutes
                ? `You will have ${a.timeLimitMinutes} minutes. The clock keeps running even if you leave the app, and your answers are handed in when it ends.`
                : 'You get one try.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction
              disabled={start.isPending}
              onClick={(e) => {
                e.preventDefault()
                start.mutate()
              }}
            >
              Start
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

/** What the teacher recorded after looking at the work (lms.set_work_status). */
function TeacherWord({ status }: { status: 'checked' | 'not_done' | 'absent' }) {
  const words = {
    checked: { text: 'Your teacher has checked this.', tone: 'border-green-600/40 bg-green-600/5 text-green-800' },
    not_done: { text: 'Your teacher marked this as not done.', tone: 'border-orange-500/40 bg-orange-500/5 text-orange-800' },
    absent: { text: 'You were marked absent for this.', tone: 'border-muted bg-muted text-muted-foreground' },
  }[status]
  return <p className={cn('rounded-xl border p-3 text-sm font-medium', words.tone)}>{words.text}</p>
}
