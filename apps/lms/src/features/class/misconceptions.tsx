import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { addDays, format, set } from 'date-fns'
import { Send } from 'lucide-react'
import { toast } from 'sonner'
import { friendlyError, type ClassChild, type LikelyMisconception } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import { chapterTitle } from '@/lib/curriculum'
import { usePhotos } from '@/lib/photos'
import { PersonAvatar } from '@/components/person-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Problem } from '@/components/layout/page'

type ClassProps = { sectionId: string; subjectId: string }

/** How many are listed before "Show all". */
const FIRST = 5
const LOCAL = "yyyy-MM-dd'T'HH:mm"

const children = (n: number) => `${n} ${n === 1 ? 'child' : 'children'}`
const sentence = (label: string) => label.charAt(0).toUpperCase() + label.slice(1)

export function useLikelyMisconceptions({ sectionId, subjectId }: ClassProps) {
  return useQuery({
    queryKey: ['likely-misconceptions', sectionId, subjectId],
    queryFn: () => api.classLikelyMisconceptions(sectionId, subjectId),
  })
}

/**
 * The misconceptions the most children of the class show now
 * (lms.class_likely_misconceptions), each with who and the chapter, and
 * practice on that chapter for just those children. Nothing while loading,
 * and nothing when no child shows one.
 */
export function LikelyMisconceptions({ sectionId, subjectId }: ClassProps) {
  const list = useLikelyMisconceptions({ sectionId, subjectId })
  const [all, setAll] = useState(false)
  const [sending, setSending] = useState<LikelyMisconception | null>(null)
  const photos = usePhotos((list.data ?? []).flatMap((m) => m.children.map((c) => c.studentUserId)))
  if (list.isError) return <Problem error={list.error} />
  if (!list.data?.length) return null
  const shown = all ? list.data : list.data.slice(0, FIRST)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Likely misconceptions in this class</CardTitle>
        <CardDescription>
          Each wrong option in Qrie’s questions was written to catch one mistake. A child is listed once they have
          made the same mistake twice — on two questions or in two sittings, in homework or with Qrie’s tutor — until
          they get it right again on their own. One slip is not listed. Most children first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className='divide-y'>
          {shown.map((m) => (
            <li key={`${m.chapter}|${m.label}`} className='flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0'>
              <div className='min-w-0 flex-1 space-y-1.5'>
                <div className='flex flex-wrap items-baseline gap-2'>
                  <Badge variant='secondary' className='tabular-nums'>
                    {children(m.students)}
                  </Badge>
                  <span className='font-medium'>{sentence(m.label)}</span>
                  <span className='text-sm text-muted-foreground'>· {chapterTitle(m.chapter)}</span>
                </div>
                <div className='flex items-center gap-2'>
                  <span className='flex -space-x-2'>
                    {m.children.slice(0, 6).map((c) => (
                      <PersonAvatar
                        key={c.studentUserId}
                        userId={c.studentUserId}
                        name={c.displayName}
                        photo={photos.get(c.studentUserId)}
                        className='size-6 ring-2 ring-background'
                      />
                    ))}
                  </span>
                  <span className='text-xs text-muted-foreground'>{m.children.map((c) => c.displayName).join(', ')}</span>
                </div>
              </div>
              {m.questions > 0 ? (
                <Button variant='outline' size='sm' onClick={() => setSending(m)}>
                  <Send /> Send practice to {m.students === 1 ? 'this child' : `these ${m.students}`}
                </Button>
              ) : (
                <p className='max-w-56 text-xs text-muted-foreground'>
                  No approved question on this chapter is free to set.{' '}
                  <Link to='/bank' className='underline'>
                    Approve some in the question bank
                  </Link>
                  .
                </p>
              )}
            </li>
          ))}
        </ul>
        {list.data.length > FIRST && (
          <Button variant='link' size='sm' className='mt-2 px-0' onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show all ${list.data.length}`}
          </Button>
        )}
      </CardContent>
      {sending && (
        <SendPracticeDialog
          key={`${sending.chapter}|${sending.label}`}
          sectionId={sectionId}
          subjectId={subjectId}
          misconception={sending}
          onClose={() => setSending(null)}
        />
      )}
    </Card>
  )
}

/**
 * Practice on the misconception's chapter (lms.send_practice): its children
 * ticked to start with, the rest of the class there to add.
 */
function SendPracticeDialog({
  sectionId,
  subjectId,
  misconception: m,
  onClose,
}: ClassProps & { misconception: LikelyMisconception; onClose: () => void }) {
  const queryClient = useQueryClient()
  const roster = useQuery({ queryKey: ['roster', sectionId], queryFn: () => api.classRoster(sectionId) })
  const [picked, setPicked] = useState(() => new Set(m.children.map((c) => c.studentUserId)))
  const [title, setTitle] = useState(`Practice: ${chapterTitle(m.chapter)}`)
  const [due, setDue] = useState(format(set(addDays(new Date(), 3), { hours: 20, minutes: 0 }), LOCAL))
  const [count, setCount] = useState('5')
  const dueAt = new Date(due)
  const others: ClassChild[] = (roster.data ?? []).filter((r) => !m.children.some((c) => c.studentUserId === r.studentUserId))
  const photos = usePhotos([...m.children, ...others].map((c) => c.studentUserId))
  const problem =
    picked.size === 0
      ? 'Tick at least one child.'
      : !title.trim()
        ? 'Give the practice a title.'
        : Number.isNaN(dueAt.getTime()) || dueAt <= new Date()
          ? 'Choose a due date still to come.'
          : null

  const send = useMutation({
    mutationFn: () =>
      api.sendPractice({
        sectionId,
        subjectId,
        chapter: m.chapter,
        misconception: m.label,
        studentUserIds: [...picked],
        dueAt: dueAt.toISOString(),
        title: title.trim(),
        questions: Number(count),
      }),
    onSuccess: () => {
      toast.success(`Practice sent to ${children(picked.size)}. It is in their Work tab now.`)
      queryClient.invalidateQueries({ queryKey: ['class-assignments', sectionId, subjectId] })
      queryClient.invalidateQueries({ queryKey: ['likely-misconceptions', sectionId, subjectId] })
      queryClient.invalidateQueries({ queryKey: ['trend', sectionId, subjectId] })
      onClose()
    },
    onError: (e) => toast.error(friendlyError(e)),
  })

  const toggle = (id: string, on: boolean) => {
    const next = new Set(picked)
    if (on) next.add(id)
    else next.delete(id)
    setPicked(next)
  }
  const row = (c: ClassChild) => (
    <li key={c.studentUserId}>
      <label className='flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted'>
        <Checkbox checked={picked.has(c.studentUserId)} onCheckedChange={(v) => toggle(c.studentUserId, v === true)} />
        <PersonAvatar userId={c.studentUserId} name={c.displayName} photo={photos.get(c.studentUserId)} className='size-7' />
        <span className='flex-1 text-sm font-medium'>{c.displayName}</span>
        <span className='text-xs text-muted-foreground tabular-nums'>{c.rollNumber && `Roll ${c.rollNumber}`}</span>
      </label>
    </li>
  )
  const n = Number(count)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Practice on {chapterTitle(m.chapter)}</DialogTitle>
          <DialogDescription>
            For “{m.label}”. Only the children ticked see it in their Work tab, and only they count in its
            hand-ins.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='max-h-64 space-y-2 overflow-y-auto rounded-md border p-2'>
            <p className='px-2 text-xs font-medium text-muted-foreground'>Showing this mistake now</p>
            <ul>{m.children.map(row)}</ul>
            {others.length > 0 && (
              <>
                <p className='px-2 pt-1 text-xs font-medium text-muted-foreground'>Others in the class</p>
                <ul>{others.map(row)}</ul>
              </>
            )}
            {roster.isError && <Problem error={roster.error} />}
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='pr-title'>Title</Label>
            <Input id='pr-title' maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <Label htmlFor='pr-due'>Due</Label>
              <Input id='pr-due' type='datetime-local' value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
            <div className='space-y-1.5'>
              <Label>Questions</Label>
              <Select value={count} onValueChange={setCount}>
                <SelectTrigger aria-label='Questions'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['3', '5', '10', '20'].map((v) => (
                    <SelectItem key={v} value={v}>
                      Up to {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className='text-xs text-muted-foreground'>
            {m.questions} approved {m.questions === 1 ? 'question' : 'questions'} on this chapter{' '}
            {m.questions === 1 ? 'is' : 'are'} free to set, those that catch this mistake first — so it will have{' '}
            {Math.min(m.questions, n)}. One attempt; the answers are shown once it is handed in or due.
          </p>
        </div>
        <DialogFooter className='items-center gap-2'>
          {problem && <p className='me-auto text-sm text-muted-foreground'>{problem}</p>}
          <Button disabled={!!problem || send.isPending} onClick={() => send.mutate()}>
            <Send /> {send.isPending ? 'Sending…' : `Send practice to ${picked.size === 1 ? 'this child' : `these ${picked.size}`}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
