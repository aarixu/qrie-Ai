import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronRight, Hourglass, Target } from 'lucide-react'
import { api } from '@/lib/backend'
import { useAuthStore } from '@/stores/auth-store'
import { pickedCard, pickedForYou } from './picked'

/** Questions in a practice round. */
export const ROUND = 5

/**
 * The query for round `round` picked from the child's answers
 * (lms.practice_for_me, 0104). The card reads round 1 under the same key the
 * practice page does, so the round it opens is the one it describes; the
 * card fetches it afresh each time it is shown.
 */
export const pickedRound = (subject: string | undefined, round: number) => ({
  queryKey: ['practice-for-me', subject ?? null, round],
  queryFn: () => api.practiceForMe(subject ?? null, ROUND),
})

/**
 * "Picked for you": the round lms.practice_for_me (0104) starts now, of one
 * subject or of all, said in a child's words (pickedForYou). It opens that
 * round. When the child's answers picked nothing (no answers yet, or strong
 * on everything open) it says the answers are being checked while the brain
 * has not read them (lms.brain_status, 0105), and shows `fallback` otherwise
 * (pickedCard), as it does when the round cannot be fetched.
 */
export function PickedForYouCard({ subject, fallback = null }: { subject?: string; fallback?: React.ReactNode }) {
  const me = useAuthStore((s) => s.me)
  const picked = useQuery({ ...pickedRound(subject, 1), staleTime: 0 })
  const nothing = picked.isSuccess && pickedForYou(picked.data).length === 0
  const status = useQuery({
    queryKey: ['brain-status', me?.userId],
    queryFn: () => api.brainStatus(me!.userId),
    enabled: nothing && !!me,
  })
  if (picked.isPending) return null
  if (picked.isError) return <>{fallback}</>
  if (nothing && status.fetchStatus === 'fetching' && status.data === undefined) return null
  const card = pickedCard(picked.data, status.data)
  if (!card) return <>{fallback}</>
  if (!card.open) {
    return (
      <div className='flex items-center gap-3 rounded-2xl bg-muted p-4 text-sm text-muted-foreground'>
        <Hourglass className='size-5 shrink-0' />
        <p>{card.lines[0]}</p>
      </div>
    )
  }
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
        {card.lines.map((line) => (
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
