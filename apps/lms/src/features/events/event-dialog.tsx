import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { addDays, format, set } from 'date-fns'
import { toast } from 'sonner'
import type { EventKind } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import { Button } from '@/components/ui/button'
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
import { Textarea } from '@/components/ui/textarea'
import { Problem } from '@/components/layout/page'

export const EVENT_KINDS: { kind: EventKind; label: string }[] = [
  { kind: 'ptm', label: 'Parent–teacher meeting' },
  { kind: 'exam', label: 'Exam' },
  { kind: 'event', label: 'School event' },
  { kind: 'trip', label: 'Trip' },
  { kind: 'holiday', label: 'Holiday' },
  { kind: 'other', label: 'Other' },
]

export const eventKindLabel = (k: string) =>
  k === 'test' ? 'Test' : (EVENT_KINDS.find((e) => e.kind === k)?.label ?? 'Event')

const LOCAL = "yyyy-MM-dd'T'HH:mm"

type EventDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Where it is shown: one class (its section), or — for the admin — the whole school. */
  audiences: { sectionId: string | null; label: string }[]
}

/** A PTM, exam, trip or other date, for a class or the whole school (lms.create_event). */
export function EventDialog({ open, onOpenChange, audiences }: EventDialogProps) {
  const queryClient = useQueryClient()
  const [audience, setAudience] = useState(audiences[0]?.sectionId ?? 'school')
  const [kind, setKind] = useState<EventKind>('ptm')
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [starts, setStarts] = useState(format(set(addDays(new Date(), 7), { hours: 10, minutes: 0 }), LOCAL))
  const [ends, setEnds] = useState('')
  const startsAt = new Date(starts)
  const endsAt = ends ? new Date(ends) : null
  const problem = !title.trim()
    ? 'Give the event a title.'
    : Number.isNaN(startsAt.getTime())
      ? 'Choose when it starts.'
      : endsAt && endsAt < startsAt
        ? 'It cannot end before it starts.'
        : null

  const save = useMutation({
    mutationFn: () =>
      api.createEvent({
        sectionId: audience === 'school' ? null : audience,
        kind,
        title: title.trim(),
        details: details.trim() || undefined,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt?.toISOString(),
      }),
    onSuccess: () => {
      toast.success('Event posted. Students see it under “Coming up”.')
      queryClient.invalidateQueries({ queryKey: ['upcoming'] })
      setTitle('')
      setDetails('')
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>New event</DialogTitle>
          <DialogDescription>It appears for every student it is for, under “Coming up”.</DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <Label>For</Label>
              <Select value={audience ?? 'school'} onValueChange={setAudience}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {audiences.map((a) => (
                    <SelectItem key={a.sectionId ?? 'school'} value={a.sectionId ?? 'school'}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-1.5'>
              <Label>Kind</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as EventKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_KINDS.map((k) => (
                    <SelectItem key={k.kind} value={k.kind}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='ev-title'>Title</Label>
            <Input id='ev-title' maxLength={200} placeholder='PTM for Class 8A' value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <Label htmlFor='ev-starts'>Starts</Label>
              <Input id='ev-starts' type='datetime-local' value={starts} onChange={(e) => setStarts(e.target.value)} />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='ev-ends'>Ends (optional)</Label>
              <Input id='ev-ends' type='datetime-local' value={ends} onChange={(e) => setEnds(e.target.value)} />
            </div>
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='ev-details'>Details (optional)</Label>
            <Textarea
              id='ev-details'
              maxLength={2000}
              placeholder='Where, what to bring, who should come.'
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
          </div>
          {save.isError && <Problem error={save.error} />}
        </div>
        <DialogFooter className='items-center gap-2'>
          {problem && <p className='me-auto text-sm text-muted-foreground'>{problem}</p>}
          <Button disabled={!!problem || save.isPending} onClick={() => save.mutate()}>
            Post event
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
