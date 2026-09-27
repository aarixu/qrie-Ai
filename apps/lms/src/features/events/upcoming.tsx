import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { format, isSameDay } from 'date-fns'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { UpcomingEvent } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loading, Problem } from '@/components/layout/page'
import { eventKindLabel } from './event-dialog'

export function useUpcoming() {
  return useQuery({ queryKey: ['upcoming'], queryFn: () => api.upcomingEvents(60) })
}

export function when(e: Pick<UpcomingEvent, 'startsAt' | 'endsAt'>): string {
  const s = new Date(e.startsAt)
  // Midnight with no end: an all-day event, such as a holiday.
  if (!e.endsAt && s.getHours() === 0 && s.getMinutes() === 0) return format(s, 'EEE d MMM')
  if (!e.endsAt) return format(s, 'EEE d MMM, h:mm a')
  const end = new Date(e.endsAt)
  return isSameDay(s, end)
    ? `${format(s, 'EEE d MMM, h:mm')}–${format(end, 'h:mm a')}`
    : `${format(s, 'd MMM')} – ${format(end, 'd MMM')}`
}

/** What is coming up: events and open tests the teacher may see, optionally for one class only. */
export function UpcomingList({ sectionId, empty }: { sectionId?: string; empty: string }) {
  const queryClient = useQueryClient()
  const upcoming = useUpcoming()
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteEvent(id),
    onSuccess: () => {
      toast.success('Event deleted.')
      queryClient.invalidateQueries({ queryKey: ['upcoming'] })
    },
  })
  if (upcoming.isPending) return <Loading what='what is coming up' />
  if (upcoming.isError) return <Problem error={upcoming.error} />
  const rows = upcoming.data.filter((e) => !sectionId || e.sectionId === sectionId || e.sectionId === null)
  if (rows.length === 0) return <p className='text-sm text-muted-foreground'>{empty}</p>
  return (
    <ul className='divide-y rounded-md border'>
      {rows.map((e) => (
        <li key={`${e.source}-${e.id}`} className='flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm'>
          <span className='w-40 shrink-0 text-muted-foreground tabular-nums'>{when(e)}</span>
          <Badge variant={e.source === 'test' ? 'default' : 'secondary'}>{eventKindLabel(e.kind)}</Badge>
          {e.source === 'test' ? (
            <Link to='/homework/$assignmentId' params={{ assignmentId: e.id }} className='font-medium hover:underline'>
              {e.title}
            </Link>
          ) : (
            <span className='font-medium'>{e.title}</span>
          )}
          <span className='text-muted-foreground'>{e.className ? `Class ${e.className}` : 'Whole school'}</span>
          {e.details && e.source === 'event' && <span className='basis-full ps-[10.75rem] text-muted-foreground'>{e.details}</span>}
          {e.source === 'event' && e.mine && (
            <Button
              variant='ghost'
              size='icon'
              className='ms-auto'
              aria-label={`Delete ${e.title}`}
              disabled={remove.isPending}
              onClick={() => remove.mutate(e.id)}
            >
              <Trash2 />
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}
