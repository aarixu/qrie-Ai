import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Megaphone, Paperclip, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { friendlyError, type Notice, type NoticeReader } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import { downloadBase64 } from '@/lib/download'
import { usePhotos } from '@/lib/photos'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loading, Page, Problem } from '@/components/layout/page'
import { PersonAvatar } from '@/components/person-avatar'
import { NoticeDialog } from './notice-dialog'

export const audienceLabel = (n: Pick<Notice, 'wholeSchool' | 'classNames'>) =>
  n.wholeSchool ? 'Whole school' : `${n.classNames?.includes(',') ? 'Classes' : 'Class'} ${n.classNames ?? ''}`

const when = (iso: string) => format(new Date(iso), 'd MMM, h:mm a')
const kb = (bytes: number | null) => `${Math.max(1, Math.round((bytes ?? 0) / 1024))} KB`
/** Who it is for, who sent it (left out if their account is gone), and when. */
const byline = (n: Notice) => [audienceLabel(n), n.mine ? 'You' : n.sentByName, when(n.sentAt)].filter(Boolean).join(' · ')

/**
 * Notices (lms.my_notices): a message to classes — or, from the admin, the
 * whole school — with one file at most. Its writer and the admin see how many
 * of those it is for have read it, and who has not; a teacher also reads the
 * notices sent to the whole school and to the classes they teach, and opening
 * one records that they read it.
 */
export function NoticesPage() {
  const isAdmin = useAuthStore((s) => s.me?.kind) === 'admin'
  const notices = useQuery({ queryKey: ['notices'], queryFn: api.myNotices })
  const [writing, setWriting] = useState(false)
  const sent = (notices.data ?? []).filter((n) => n.canDelete)
  const forMe = (notices.data ?? []).filter((n) => !n.canDelete)
  const unread = forMe.filter((n) => !n.readAt).length

  return (
    <Page
      title='Notices'
      description={
        isAdmin
          ? 'Send a message to any class or to the whole school, and see who has read each notice — yours and your teachers’.'
          : 'Send a message to the classes you teach and see who has read it, and read the notices sent to you.'
      }
      actions={
        <Button onClick={() => setWriting(true)}>
          <Megaphone /> New notice
        </Button>
      }
    >
      {notices.isPending ? (
        <Loading what='the notices' />
      ) : notices.isError ? (
        <Problem error={notices.error} />
      ) : (
        <div className='grid gap-6 xl:grid-cols-5'>
          <section className={cn('space-y-3', isAdmin ? 'xl:col-span-5' : 'xl:col-span-3')}>
            <h2 className='text-sm font-semibold tracking-wide text-muted-foreground uppercase'>
              {isAdmin ? 'This year’s notices' : 'Sent by you'}
            </h2>
            {sent.length === 0 ? (
              <p className='text-sm text-muted-foreground'>No notices sent this year.</p>
            ) : (
              sent.map((n) => <SentNotice key={n.noticeId} n={n} />)
            )}
          </section>
          {!isAdmin && (
            <section className='space-y-3 xl:col-span-2'>
              <h2 className='flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase'>
                For you {unread > 0 && <Badge>{unread} unread</Badge>}
              </h2>
              {forMe.length === 0 ? (
                <p className='text-sm text-muted-foreground'>Nothing sent to you this year.</p>
              ) : (
                <ul className='space-y-2'>
                  {forMe.map((n) => (
                    <li key={n.noticeId}>
                      <IncomingNotice n={n} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
      <NoticeDialog open={writing} onOpenChange={setWriting} />
    </Page>
  )
}

function SentNotice({ n }: { n: Notice }) {
  const [who, setWho] = useState(false)
  const share = n.audience ? (n.readers ?? 0) / n.audience : 0
  return (
    <Card>
      <CardHeader className='flex flex-row items-start justify-between gap-3 space-y-0'>
        <div className='min-w-0 space-y-1'>
          <CardTitle className='text-base'>{n.title}</CardTitle>
          <CardDescription>{byline(n)}</CardDescription>
        </div>
        <DeleteNotice n={n} />
      </CardHeader>
      <CardContent className='space-y-3'>
        <p className='text-sm whitespace-pre-wrap'>{n.body}</p>
        {n.attachmentName && <AttachmentButton n={n} />}
        <div className='flex flex-wrap items-center gap-3'>
          <div className='min-w-40 flex-1'>
            <p className='mb-1 text-xs font-medium tabular-nums'>
              Read by {n.readers ?? 0} of {n.audience ?? 0}
            </p>
            <div className='h-1.5 overflow-hidden rounded-full bg-muted'>
              <div className='h-full rounded-full bg-primary' style={{ width: `${Math.round(share * 100)}%` }} />
            </div>
          </div>
          <Button variant='outline' size='sm' onClick={() => setWho(true)}>
            <Users /> Who has read it
          </Button>
        </div>
      </CardContent>
      {who && <ReadersDialog n={n} onClose={() => setWho(false)} />}
    </Card>
  )
}

function AttachmentButton({ n }: { n: Notice }) {
  const get = useMutation({
    mutationFn: () => api.noticeAttachment(n.noticeId),
    onSuccess: (a) => {
      if (a) downloadBase64(a.fileName, a.base64, a.mime)
    },
    onError: (e) => toast.error(friendlyError(e)),
  })
  return (
    <Button variant='outline' size='sm' className='max-w-full' disabled={get.isPending} onClick={() => get.mutate()}>
      <Paperclip />
      <span className='truncate'>{n.attachmentName}</span>
      <span className='text-muted-foreground tabular-nums'>{kb(n.attachmentBytes)}</span>
    </Button>
  )
}

function DeleteNotice({ n }: { n: Notice }) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => api.deleteNotice(n.noticeId),
    onSuccess: () => {
      toast.success('Notice deleted.')
      queryClient.invalidateQueries({ queryKey: ['notices'] })
      setOpen(false)
    },
    onError: (e) => toast.error(friendlyError(e)),
  })
  return (
    <>
      <Button variant='ghost' size='icon' aria-label={`Delete ${n.title}`} onClick={() => setOpen(true)}>
        <Trash2 />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this notice?</AlertDialogTitle>
            <AlertDialogDescription>
              “{n.title}” disappears from every app it was sent to, and the record of who read it goes with it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault()
                remove.mutate()
              }}
            >
              {remove.isPending ? 'Deleting…' : 'Delete notice'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** Who a notice is for now (lms.notice_readers): those yet to open it first. */
function ReadersDialog({ n, onClose }: { n: Notice; onClose: () => void }) {
  const readers = useQuery({ queryKey: ['notices', n.noticeId, 'readers'], queryFn: () => api.noticeReaders(n.noticeId) })
  const photos = usePhotos((readers.data ?? []).map((r) => r.userId))
  const rows = readers.data ?? []
  const notYet = rows.filter((r) => !r.readAt)
  const read = rows.filter((r) => r.readAt)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{n.title}</DialogTitle>
          <DialogDescription>
            {readers.data ? `Read by ${read.length} of ${rows.length}. ` : ''}
            Counted over everyone it is for now: a child who joins the class later is counted, and one who leaves is not.
          </DialogDescription>
        </DialogHeader>
        {readers.isPending ? (
          <Loading what='who has read it' />
        ) : readers.isError ? (
          <Problem error={readers.error} />
        ) : (
          <div className='max-h-[60vh] space-y-4 overflow-y-auto pe-1'>
            <ReaderList title={`Not read yet (${notYet.length})`} rows={notYet} photos={photos} empty='Everyone has read it.' />
            <ReaderList title={`Read (${read.length})`} rows={read} photos={photos} empty='Nobody has opened it yet.' />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ReaderList({
  title,
  rows,
  photos,
  empty,
}: {
  title: string
  rows: NoticeReader[]
  photos: Map<string, string>
  empty: string
}) {
  return (
    <section>
      <h3 className='mb-1 text-sm font-semibold'>{title}</h3>
      {rows.length === 0 ? (
        <p className='text-sm text-muted-foreground'>{empty}</p>
      ) : (
        <ul className='divide-y'>
          {rows.map((r) => (
            <li key={r.userId} className='flex items-center gap-3 py-2'>
              <PersonAvatar userId={r.userId} name={r.displayName} photo={photos.get(r.userId)} className='size-8' />
              <span className='min-w-0 flex-1'>
                <span className='block truncate text-sm font-medium'>{r.displayName}</span>
                <span className='block text-xs text-muted-foreground'>
                  {r.kind === 'teacher' ? 'Teacher' : `Class ${r.className}${r.rollNumber ? ` · Roll ${r.rollNumber}` : ''}`}
                </span>
              </span>
              {r.readAt && <span className='text-xs text-muted-foreground tabular-nums'>{when(r.readAt)}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function IncomingNotice({ n }: { n: Notice }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type='button'
        onClick={() => setOpen(true)}
        className='flex w-full items-start gap-3 rounded-md border bg-card p-3 text-start transition-colors hover:bg-accent'
      >
        <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-primary')} aria-hidden />
        <span className='min-w-0 flex-1'>
          <span className={cn('block truncate text-sm', !n.readAt && 'font-semibold')}>{n.title}</span>
          <span className='block text-xs text-muted-foreground'>{byline(n)}</span>
        </span>
        {n.attachmentName && <Paperclip className='mt-0.5 size-4 shrink-0 text-muted-foreground' aria-label='Has a file' />}
        {!n.readAt && <span className='sr-only'>Unread</span>}
      </button>
      {open && <NoticeView n={n} onClose={() => setOpen(false)} />}
    </>
  )
}

/** One notice sent to the teacher; opening it records that they read it (lms.read_notice). */
function NoticeView({ n, onClose }: { n: Notice; onClose: () => void }) {
  const queryClient = useQueryClient()
  const read = useMutation({
    mutationFn: () => api.readNotice(n.noticeId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notices'] }),
  })
  const marked = useRef(false)
  useEffect(() => {
    if (n.readAt || marked.current) return
    marked.current = true
    read.mutate()
  }, [n.readAt, read])
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{n.title}</DialogTitle>
          <DialogDescription>{byline(n)}</DialogDescription>
        </DialogHeader>
        <p className='max-h-[60vh] overflow-y-auto text-sm whitespace-pre-wrap'>{n.body}</p>
        {n.attachmentName && <AttachmentButton n={n} />}
      </DialogContent>
    </Dialog>
  )
}
