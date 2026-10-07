import { useCallback, useEffect, useState } from 'react'
import { friendlyError, type FlushResult } from '@ai-tutor/lms-client'
import { useQueryClient } from '@tanstack/react-query'
import { CloudOff, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useOutbox } from '@/lib/outbox'
import { Button } from '@/components/ui/button'

const EVERY_MS = 20_000

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * Sends what waits in the child's outbox (lib/outbox.ts) — when the app
 * opens, when the internet comes back, when the app comes back to the front,
 * and every 20 seconds while something waits — and says, while anything
 * waits, that it is kept on the phone.
 */
export function OutboxBanner() {
  const { jobs, flush } = useOutbox()
  const queryClient = useQueryClient()
  const [sending, setSending] = useState(false)

  const report = useCallback(
    (r: FlushResult | null) => {
      if (!r || (!r.sent.length && !r.refused.length)) return
      for (const j of r.sent) if (j.kind !== 'answer') toast.success(`Handed in: ${j.title}`)
      for (const { job, reason } of r.refused) {
        const why = friendlyError(new Error(reason))
        toast.error(job.kind === 'answer' ? `An answer could not be saved: ${why}` : `${job.title} could not be handed in: ${why}`)
      }
      for (const key of ['my-assignments', 'saved-answers', 'review', 'my-progress']) {
        void queryClient.invalidateQueries({ queryKey: [key] })
      }
    },
    [queryClient]
  )
  const tryNow = useCallback(async () => {
    setSending(true)
    try {
      report(await flush())
    } finally {
      setSending(false)
    }
  }, [flush, report])

  useEffect(() => {
    void tryNow()
    const online = () => void tryNow()
    const front = () => document.visibilityState === 'visible' && void tryNow()
    window.addEventListener('online', online)
    document.addEventListener('visibilitychange', front)
    return () => {
      window.removeEventListener('online', online)
      document.removeEventListener('visibilitychange', front)
    }
  }, [tryNow])
  useEffect(() => {
    if (!jobs.length) return
    const t = setInterval(() => void tryNow(), EVERY_MS)
    return () => clearInterval(t)
  }, [jobs.length, tryNow])

  if (!jobs.length) return null
  const handIns = jobs.filter((j) => j.kind !== 'answer').length
  const answers = jobs.length - handIns
  const what = [
    handIns ? count(handIns, 'hand-in', 'hand-ins') : null,
    answers ? count(answers, 'test answer', 'test answers') : null,
  ]
    .filter(Boolean)
    .join(' and ')
  return (
    <div role='status' className='mb-4 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50'>
      <p className='flex items-center gap-2 font-semibold'>
        <CloudOff className='size-4' /> Waiting for the internet
      </p>
      <p>
        {what} {jobs.length === 1 ? 'is' : 'are'} kept on this phone and will go to your school by{' '}
        {jobs.length === 1 ? 'itself' : 'themselves'} when the internet is back. Work counts as handed in when it reaches
        your school.
      </p>
      <Button size='sm' variant='outline' disabled={sending} onClick={() => void tryNow()}>
        {sending && <Loader2 className='animate-spin' />} Try now
      </Button>
    </div>
  )
}
