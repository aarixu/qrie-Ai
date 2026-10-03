import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { format } from 'date-fns'
import { ArrowLeft, ChevronRight, FileDown, Megaphone, Paperclip } from 'lucide-react'
import { toast } from 'sonner'
import type { Notice } from '@ai-tutor/lms-client'
import { api, say } from '@/lib/backend'
import { downloadBase64 } from '@/lib/download'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

/** This year's notices for the child: their class's and the whole school's (lms.my_notices). */
function useNotices() {
  return useQuery({ queryKey: ['notices'], queryFn: api.myNotices })
}

const forWhom = (n: Notice) =>
  n.wholeSchool ? 'Whole school' : `${n.classNames?.includes(',') ? 'Classes' : 'Class'} ${n.classNames ?? ''}`
const kb = (bytes: number | null) => `${Math.max(1, Math.round((bytes ?? 0) / 1024))} KB`

/** The latest notices on Home, with how many are unread; nothing while there are none. */
export function NoticesOnHome() {
  const notices = useNotices()
  if (notices.isError) return <p className='text-sm text-destructive'>{say(notices.error)}</p>
  const rows = notices.data ?? []
  if (rows.length === 0) return null
  const unread = rows.filter((n) => !n.readAt).length
  return (
    <section>
      <div className='mb-2 flex items-baseline justify-between'>
        <h2 className='flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase'>
          Notices {unread > 0 && <Badge>{unread} new</Badge>}
        </h2>
        <Link to='/notices' className='text-sm font-medium text-primary'>
          All notices
        </Link>
      </div>
      <ul className='space-y-2'>
        {rows.slice(0, 3).map((n) => (
          <li key={n.noticeId}>
            <NoticeRow n={n} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function NoticeRow({ n }: { n: Notice }) {
  return (
    <Link
      to='/notices/$noticeId'
      params={{ noticeId: n.noticeId }}
      className='flex items-center gap-3 rounded-2xl border bg-card p-3 active:bg-accent'
    >
      <div className='relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary'>
        <Megaphone className='size-5' />
        {!n.readAt && <span className='absolute -top-0.5 -right-0.5 size-3 rounded-full border-2 border-card bg-brand-accent' aria-hidden />}
      </div>
      <div className='min-w-0 flex-1'>
        <p className='text-xs text-muted-foreground'>
          {forWhom(n)}
          {n.sentByName ? ` · ${n.sentByName}` : ''} · {format(new Date(n.sentAt), 'd MMM')}
        </p>
        <p className={cn('truncate', n.readAt ? 'font-medium' : 'font-bold')}>
          {!n.readAt && <span className='sr-only'>New: </span>}
          {n.title}
        </p>
        <p className='truncate text-xs text-muted-foreground'>{n.body}</p>
      </div>
      {n.attachmentName && <Paperclip className='size-4 shrink-0 text-muted-foreground' aria-label='Has a file' />}
      <ChevronRight className='size-4 shrink-0 text-muted-foreground' />
    </Link>
  )
}

export function NoticesPage() {
  const notices = useNotices()
  return (
    <div className='space-y-4'>
      <Link to='/' className='inline-flex items-center gap-1 text-sm text-muted-foreground'>
        <ArrowLeft className='size-4' /> Home
      </Link>
      <h1 className='text-2xl font-bold tracking-tight'>Notices</h1>
      {notices.isPending ? (
        <p className='text-muted-foreground'>Loading notices…</p>
      ) : notices.isError ? (
        <p className='text-destructive'>{say(notices.error)}</p>
      ) : notices.data.length === 0 ? (
        <p className='rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground'>
          No notices from your school this year.
        </p>
      ) : (
        <ul className='space-y-2'>
          {notices.data.map((n) => (
            <li key={n.noticeId}>
              <NoticeRow n={n} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** One notice. Opening it records that the child has read it (lms.read_notice). */
export function NoticePage({ noticeId }: { noticeId: string }) {
  const notices = useNotices()
  const queryClient = useQueryClient()
  const n = notices.data?.find((x) => x.noticeId === noticeId)
  const read = useMutation({
    mutationFn: () => api.readNotice(noticeId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notices'] }),
  })
  const marked = useRef(false)
  useEffect(() => {
    if (!n || n.readAt || marked.current) return
    marked.current = true
    read.mutate()
  }, [n, read])

  if (notices.isPending) return <p className='text-muted-foreground'>Loading…</p>
  if (notices.isError) return <p className='text-destructive'>{say(notices.error)}</p>
  if (!n) {
    return (
      <div className='space-y-3'>
        <p>This notice is not in your list.</p>
        <Link to='/notices' className='underline'>
          All notices
        </Link>
      </div>
    )
  }
  return (
    <div className='space-y-5'>
      <Link to='/notices' className='inline-flex items-center gap-1 text-sm text-muted-foreground'>
        <ArrowLeft className='size-4' /> All notices
      </Link>
      <div>
        <p className='text-sm text-muted-foreground'>
          {forWhom(n)}
          {n.sentByName ? ` · ${n.sentByName}` : ''}
        </p>
        <h1 className='text-2xl font-bold tracking-tight'>{n.title}</h1>
        <p className='text-sm text-muted-foreground'>{format(new Date(n.sentAt), 'EEEE d MMMM, h:mm a')}</p>
      </div>
      <p className='rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap'>{n.body}</p>
      {n.attachmentName && <Attachment n={n} />}
    </div>
  )
}

/** The notice's file: a picture is shown on the page; either kind can be saved to the phone. */
function Attachment({ n }: { n: Notice }) {
  const picture = n.attachmentMime === 'image/png' || n.attachmentMime === 'image/jpeg'
  const file = useQuery({
    queryKey: ['notice-file', n.noticeId],
    queryFn: () => api.noticeAttachment(n.noticeId),
    enabled: picture,
    staleTime: Infinity,
  })
  const save = useMutation({
    mutationFn: async () => file.data ?? (await api.noticeAttachment(n.noticeId)),
    onSuccess: (a) => {
      if (a) downloadBase64(a.fileName, a.base64, a.mime)
    },
    onError: (e) => toast.error(say(e)),
  })
  return (
    <div className='space-y-2'>
      {picture && file.data && (
        <img src={`data:${file.data.mime};base64,${file.data.base64}`} alt={n.attachmentName ?? ''} className='w-full rounded-xl border bg-white' />
      )}
      {picture && file.isError && <p className='text-sm text-destructive'>{say(file.error)}</p>}
      <Button variant='outline' className='h-11 w-full' disabled={save.isPending} onClick={() => save.mutate()}>
        <FileDown />
        <span className='truncate'>{save.isPending ? 'Getting the file…' : `Download ${n.attachmentName}`}</span>
        <span className='text-muted-foreground tabular-nums'>{kb(n.attachmentBytes)}</span>
      </Button>
    </div>
  )
}
