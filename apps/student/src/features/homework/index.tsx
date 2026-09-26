import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import { api, say } from '@/lib/backend'
import { Button } from '@/components/ui/button'
import { scoreText, standing } from '@/features/home'
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
        <p>This homework is not in your list.</p>
        <Link to='/' className='underline'>Back to your homework</Link>
      </div>
    )
  }

  if (mode === 'quiz') {
    return <Quiz a={a} onDone={() => setMode('review')} onCancel={() => setMode('overview')} />
  }

  const due = new Date(a.dueAt)
  const late = due < new Date()
  const behind = standing(a) === 'overdue'
  const mcq = a.answerTypes.includes('mcq')
  const photo = a.answerTypes.includes('photo')
  const attemptsLeft = a.attemptsAllowed - a.mcqAttemptsUsed
  const score = scoreText(a)

  return (
    <div className='space-y-5'>
      <Link to='/' className='inline-flex items-center gap-1 text-sm text-muted-foreground'>
        <ArrowLeft className='size-4' /> All homework
      </Link>
      <div>
        <p className='text-sm text-muted-foreground'>{a.subjectName}</p>
        <h1 className='text-2xl font-bold tracking-tight'>{a.title}</h1>
        <p className={behind ? 'text-sm text-orange-600' : 'text-sm text-muted-foreground'}>
          {late ? 'Was due' : 'Due'} {format(due, 'EEEE d MMM, h:mm a')} ({formatDistanceToNowStrict(due, { addSuffix: true })})
        </p>
      </div>
      {a.instructions && <p className='whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm'>{a.instructions}</p>}

      {a.markedAt && a.teacherScore !== null && (
        <div className='rounded-xl border border-primary/40 bg-primary/5 p-4'>
          <p className='text-sm text-muted-foreground'>Your teacher’s mark</p>
          <p className='text-3xl font-bold tabular-nums'>
            {a.teacherScore} <span className='text-lg font-normal text-muted-foreground'>/ {a.teacherMax}</span>
          </p>
        </div>
      )}

      {mcq && (
        <section className='space-y-3 rounded-xl border p-4'>
          <h2 className='font-semibold'>Questions</h2>
          {a.mcqAttemptsUsed === 0 ? (
            <>
              <p className='text-sm text-muted-foreground'>
                {a.questions} {a.questions === 1 ? 'question' : 'questions'} ·{' '}
                {a.attemptsAllowed === 1 ? 'one try' : `${a.attemptsAllowed} tries`}
                {late && ' · it will be marked late'}
              </p>
              <Button className='h-12 w-full text-base' onClick={() => setMode('quiz')}>
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
                <Button variant='outline' className='w-full' onClick={() => setMode('review')}>
                  See your answers
                </Button>
              )}
              {attemptsLeft > 0 && (
                <Button className='w-full' onClick={() => setMode('quiz')}>
                  Try again ({attemptsLeft} {attemptsLeft === 1 ? 'try' : 'tries'} left)
                </Button>
              )}
            </>
          )}
        </section>
      )}

      {photo && (
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
