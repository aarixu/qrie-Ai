import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Check, Lightbulb, RotateCcw, X } from 'lucide-react'
import type { PracticeForMe, PracticeQuestion, PracticeResult } from '@ai-tutor/lms-client'
import { api, say } from '@/lib/backend'
import { cn } from '@/lib/utils'
import { uuid } from '@/lib/uuid'
import { Button } from '@/components/ui/button'
import { chapterTitle } from '../progress'
import { ROUND, pickedRound } from './picked-card'

const LETTERS = 'ABCDEF'
const PICKED = 'Picked for you'

/**
 * One practice round: a few questions, one at a time, each marked the moment
 * it is tapped (lms.check_practice_answer) with the right answer shown and,
 * for a wrong one, the mistake it usually means. One session per round, so
 * the brain reads the round as one sitting. With a chapter, the chapter's
 * questions in a random order (lms.practice_questions); without one, the
 * round picked from the child's own answers, in `subject` or in all
 * (lms.practice_for_me).
 */
export function Practice({ subject, chapter }: { subject?: string; chapter?: string }) {
  const queryClient = useQueryClient()
  const [round, setRound] = useState(1)
  const [session, setSession] = useState(uuid)
  const [index, setIndex] = useState(0)
  const [chosen, setChosen] = useState<number | null>(null)
  const [results, setResults] = useState<PracticeResult[]>([])

  const questions = useQuery<(PracticeQuestion & Partial<PracticeForMe>)[]>({
    ...(subject && chapter
      ? {
          queryKey: ['practice-questions', subject, chapter, round],
          queryFn: () => api.practiceQuestions(subject, chapter, ROUND),
        }
      : pickedRound(subject, round)),
    staleTime: Infinity,
    gcTime: 0,
  })
  const check = useMutation({
    mutationFn: (v: { itemId: string; chosen: number }) => api.checkPracticeAnswer(session, v.itemId, v.chosen),
    onSuccess: (r) => setResults((rs) => [...rs, r]),
  })

  const exit = (
    <Link to='/learn' aria-label='Leave practice' className='rounded-full p-1 text-muted-foreground active:bg-accent'>
      <X className='size-6' />
    </Link>
  )
  if (questions.isPending) return <p className='text-muted-foreground'>Getting your questions…</p>
  if (questions.isError) return <p className='text-destructive'>{say(questions.error)}</p>
  const qs = questions.data
  if (qs.length === 0) {
    return (
      <div className='space-y-4 text-center'>
        <div className='flex justify-start'>{exit}</div>
        <p className='font-medium'>No questions to practise {chapter ? 'in this chapter ' : ''}right now.</p>
        <p className='text-sm text-muted-foreground'>
          Questions that are on homework or a test still open are kept back until it closes.
        </p>
        <Button asChild>
          <Link to='/learn'>Back to Learn</Link>
        </Button>
      </div>
    )
  }

  const finished = results.length === qs.length && chosen === null
  if (finished) {
    const right = results.filter((r) => r.correct).length
    return (
      <Summary
        right={right}
        total={qs.length}
        heading={chapter ? chapterTitle(chapter) : PICKED}
        onAgain={() => {
          setRound((n) => n + 1)
          setSession(uuid())
          setIndex(0)
          setResults([])
        }}
      />
    )
  }

  const q = qs[index]!
  const result = results[index]
  const answered = result !== undefined

  const next = () => {
    setChosen(null)
    if (index + 1 < qs.length) {
      setIndex(index + 1)
    } else {
      queryClient.invalidateQueries({ queryKey: ['practice-chapters'] })
      queryClient.invalidateQueries({ queryKey: ['my-progress'] })
      queryClient.invalidateQueries({ queryKey: ['my-subjects'] })
    }
  }

  return (
    <div className='flex min-h-[calc(100svh-2rem)] flex-col'>
      <div className='flex items-center gap-3'>
        {exit}
        <div className='flex flex-1 gap-1' aria-label={`Question ${index + 1} of ${qs.length}`}>
          {qs.map((x, i) => (
            <div
              key={x.itemId}
              className={cn(
                'h-2 flex-1 rounded-full',
                results[i] ? (results[i]!.correct ? 'bg-green-500' : 'bg-red-500') : i === index ? 'bg-primary/40' : 'bg-muted'
              )}
            />
          ))}
        </div>
      </div>
      <p className='mt-4 text-xs text-muted-foreground'>
        {q.subject ?? subject} · {chapter ? chapterTitle(chapter) : (q.outcomeTitle ?? PICKED)} · {index + 1} of {qs.length}
      </p>
      <h1 className='mt-1 text-lg leading-snug font-semibold whitespace-pre-line'>{q.stem}</h1>

      <ul className='mt-4 space-y-2'>
        {q.options.map((opt, i) => {
          const isRight = answered && i === result.correctIndex
          const isWrongPick = answered && i === chosen && !result.correct
          return (
            <li key={i}>
              <button
                disabled={answered || check.isPending}
                onClick={() => {
                  setChosen(i)
                  check.mutate({ itemId: q.itemId, chosen: i })
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border-2 p-3 text-start transition-colors',
                  !answered && chosen === i && 'border-primary bg-primary/5',
                  !answered && chosen !== i && 'active:bg-accent',
                  isRight && 'border-green-600 bg-green-600/10',
                  isWrongPick && 'border-red-600 bg-red-600/10',
                  answered && !isRight && !isWrongPick && 'opacity-60'
                )}
              >
                <span
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold',
                    isRight && 'border-green-600 bg-green-600 text-white',
                    isWrongPick && 'border-red-600 bg-red-600 text-white'
                  )}
                >
                  {isRight ? <Check className='size-4' /> : isWrongPick ? <X className='size-4' /> : LETTERS[i]}
                </span>
                <span className='flex-1'>{opt}</span>
              </button>
            </li>
          )
        })}
      </ul>

      {check.isError && <p className='mt-3 text-sm text-destructive'>{say(check.error)}</p>}

      {answered && (
        <div
          role='status'
          className={cn(
            'mt-4 rounded-xl p-3',
            result.correct ? 'bg-green-600/10 text-green-800 dark:text-green-300' : 'bg-red-600/10 text-red-800 dark:text-red-300'
          )}
        >
          <p className='font-semibold'>{result.correct ? 'Correct!' : `Not quite. The answer is ${LETTERS[result.correctIndex]}.`}</p>
          {!result.correct && result.misconception && (
            <p className='mt-1 flex gap-1.5 text-sm'>
              <Lightbulb className='mt-0.5 size-4 shrink-0' />
              <span>Watch out: {result.misconception}</span>
            </p>
          )}
        </div>
      )}

      <div className='mt-auto pt-6'>
        <Button className='h-12 w-full text-base' disabled={!answered} onClick={next}>
          {index + 1 < qs.length ? 'Next question' : 'See how you did'}
        </Button>
      </div>
    </div>
  )
}

function Summary({ right, total, heading, onAgain }: { right: number; total: number; heading: string; onAgain: () => void }) {
  const share = right / total
  const [title, line] =
    share === 1
      ? ['Perfect!', heading === PICKED ? 'Every one right.' : 'Every one right. You know this chapter.']
      : share >= 0.6
        ? ['Well done!', 'Most of them right. One more round will make it stick.']
        : ['Good try!', 'Every wrong answer shows you what to look at again. Try another round.']
  return (
    <div className='flex min-h-[calc(100svh-2rem)] flex-col items-center justify-center text-center'>
      <div
        className='relative flex size-36 items-center justify-center rounded-full'
        style={{ background: `conic-gradient(var(--primary) ${share * 360}deg, var(--muted) 0deg)` }}
      >
        <div className='flex size-28 flex-col items-center justify-center rounded-full bg-background'>
          <span className='text-3xl font-bold tabular-nums'>
            {right}/{total}
          </span>
          <span className='text-xs text-muted-foreground'>right</span>
        </div>
      </div>
      <h1 className='mt-6 text-2xl font-bold'>{title}</h1>
      <p className='mt-1 text-muted-foreground'>{line}</p>
      <p className='mt-1 text-sm text-muted-foreground'>{heading}</p>
      <div className='mt-8 w-full space-y-2'>
        <Button className='h-12 w-full text-base' onClick={onAgain}>
          <RotateCcw /> Practise again
        </Button>
        <Button asChild variant='outline' className='h-12 w-full text-base'>
          <Link to='/learn'>Back to Learn</Link>
        </Button>
      </div>
    </div>
  )
}
