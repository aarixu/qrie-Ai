import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, XCircle } from 'lucide-react'
import { api, say } from '@/lib/backend'
import { cn } from '@/lib/utils'

const LETTERS = 'ABCDEF'

/**
 * The student's own latest attempt. Right or wrong always; the right answer
 * only once it can no longer help a resubmission (lms.my_review).
 */
export function Review({ assignmentId }: { assignmentId: string }) {
  const review = useQuery({
    queryKey: ['review', assignmentId],
    queryFn: () => api.myReview(assignmentId),
  })
  if (review.isPending) return <p className='text-sm text-muted-foreground'>Loading your answers…</p>
  if (review.isError) return <p className='text-sm text-destructive'>{say(review.error)}</p>
  const hidden = review.data.some((r) => r.correctIndex === null && !r.correct)

  return (
    <div className='space-y-4'>
      {hidden && (
        <p className='rounded-lg bg-muted p-3 text-sm'>
          You still have a try left, so the right answers stay hidden until you use it or the due date passes.
        </p>
      )}
      {review.data.map((r) => (
        <div key={r.itemId} className='space-y-2 border-t pt-3 first:border-t-0 first:pt-0'>
          <p className='flex items-start gap-2 font-medium'>
            {r.correct ? (
              <CheckCircle2 className='mt-0.5 size-5 shrink-0 text-green-600' aria-label='right' />
            ) : (
              <XCircle className='mt-0.5 size-5 shrink-0 text-destructive' aria-label='wrong' />
            )}
            <span>
              {r.questionPosition}. {r.stem}
            </span>
          </p>
          <ul className='space-y-1 ps-7 text-sm'>
            {r.options.map((opt, i) => (
              <li
                key={i}
                className={cn(
                  'rounded-md px-2 py-1',
                  i === r.correctIndex && 'bg-green-600/15 font-medium',
                  i === r.chosenIndex && !r.correct && 'bg-destructive/10'
                )}
              >
                {LETTERS[i]}. {opt}
                {i === r.chosenIndex && <span className='ms-1 text-muted-foreground'>(your answer)</span>}
                {i === r.correctIndex && i !== r.chosenIndex && <span className='ms-1'>(right answer)</span>}
              </li>
            ))}
            {r.chosenIndex === null && <li className='text-muted-foreground'>You did not answer this one.</li>}
          </ul>
        </div>
      ))}
    </div>
  )
}
