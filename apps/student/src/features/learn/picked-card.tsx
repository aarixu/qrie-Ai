import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronRight, Target } from 'lucide-react'
import { api } from '@/lib/backend'
import { pickedForYou } from './picked'

/** Questions in a practice round. */
export const ROUND = 5

/**
 * The query for round `round` picked from the child's answers
 * (lms.practice_for_me, 0064). The card reads round 1 under the same key the
 * practice page does, so the round it opens is the one it describes; the
 * card fetches it afresh each time it is shown.
 */
export const pickedRound = (subject: string | undefined, round: number) => ({
  queryKey: ['practice-for-me', subject ?? null, round],
  queryFn: () => api.practiceForMe(subject ?? null, ROUND),
})

/**
 * "Picked for you": the round lms.practice_for_me (0064) starts now, of one
 * subject or of all, said in a child's words (pickedForYou). It opens that
 * round. When the child's answers picked nothing (no answers yet, or strong
 * on everything open) it shows `fallback` instead.
 */
export function PickedForYouCard({ subject, fallback = null }: { subject?: string; fallback?: React.ReactNode }) {
  const picked = useQuery(pickedRound(subject, 1))
  const lines = pickedForYou(picked.data ?? [])
  if (picked.isPending) return null
  if (lines.length === 0) return <>{fallback}</>
  return (
    <Link
      to='/learn/practice'
      search={subject ? { subject } : {}}
      className='flex items-center gap-3 rounded-2xl bg-brand-accent p-4 text-brand-accent-foreground shadow-sm active:opacity-90'
    >
      <div className='flex size-12 shrink-0 items-center justify-center rounded-xl bg-white/40'>
        <Target className='size-6' />
      </div>
      <div className='min-w-0 flex-1'>
        <p className='text-xs opacity-80'>Picked for you{subject ? ` · ${subject}` : ''}</p>
        {lines.map((line) => (
          <p key={line} className='font-semibold'>
            {line}
          </p>
        ))}
        <p className='text-xs opacity-80'>From your own answers, with the answer shown straight away</p>
      </div>
      <ChevronRight className='size-5 shrink-0' />
    </Link>
  )
}
