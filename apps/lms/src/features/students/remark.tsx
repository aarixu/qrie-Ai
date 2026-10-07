import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { MessageSquareQuote, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { friendlyError } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loading, Problem } from '@/components/layout/page'

const LIMIT = 600

/**
 * This year's teacher's remark (lms.report_remark), also printed on the PDF
 * report card. A teacher of the child's class this year, or the admin,
 * writes it; whoever writes last replaces it.
 */
export function RemarkCard({ studentId, name }: { studentId: string; name: string }) {
  const remark = useQuery({ queryKey: ['student', studentId, 'remark'], queryFn: () => api.reportRemark(studentId) })
  const [editing, setEditing] = useState(false)
  const r = remark.data
  return (
    <Card>
      <CardHeader className='flex flex-row items-start justify-between gap-4 space-y-0'>
        <div className='space-y-1.5'>
          <CardTitle className='flex items-center gap-2'>
            <MessageSquareQuote className='size-4' /> Teacher’s remark
          </CardTitle>
          <CardDescription>This year’s, on the report card. {name} sees it too.</CardDescription>
        </div>
        {r?.canEdit && (
          <Button variant='outline' size='sm' onClick={() => setEditing(true)}>
            <Pencil /> {r.text ? 'Edit' : 'Write'}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {remark.isPending ? (
          <Loading what='the remark' />
        ) : remark.isError ? (
          <Problem error={remark.error} />
        ) : r?.text ? (
          <figure className='space-y-1'>
            <blockquote className='max-w-3xl text-sm whitespace-pre-wrap'>{r.text}</blockquote>
            <figcaption className='text-xs text-muted-foreground'>
              {[r.writtenByName, r.writtenAt && format(new Date(r.writtenAt), 'd MMM yyyy')].filter(Boolean).join(', ')}
            </figcaption>
          </figure>
        ) : (
          <p className='text-sm text-muted-foreground'>No remark written this year.</p>
        )}
      </CardContent>
      {r && editing && (
        <RemarkDialog studentId={studentId} name={name} text={r.text ?? ''} onClose={() => setEditing(false)} />
      )}
    </Card>
  )
}

function RemarkDialog({
  studentId,
  name,
  text,
  onClose,
}: {
  studentId: string
  name: string
  text: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [value, setValue] = useState(text)
  const save = useMutation({
    mutationFn: (next: string | null) => api.setReportRemark(studentId, next),
    onSuccess: (_, next) => {
      toast.success(next ? `Remark saved for ${name}.` : `Remark removed for ${name}.`)
      void queryClient.invalidateQueries({ queryKey: ['student', studentId, 'remark'] })
      onClose()
    },
    onError: (e) => toast.error(friendlyError(e)),
  })
  const trimmed = value.trim()
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remark for {name}</DialogTitle>
          <DialogDescription>
            One remark for the year, printed on the report card. Saving replaces whatever was written before, by
            anyone.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-1.5'>
          <Label htmlFor='remark-text'>Remark</Label>
          <Textarea
            id='remark-text'
            rows={5}
            maxLength={LIMIT}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder='What is going well, and the one thing to work on next.'
          />
          <p className='text-end text-xs text-muted-foreground tabular-nums'>
            {value.length} / {LIMIT}
          </p>
        </div>
        <DialogFooter>
          {text && (
            <Button variant='ghost' className='me-auto' disabled={save.isPending} onClick={() => save.mutate(null)}>
              Remove
            </Button>
          )}
          <Button variant='outline' onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!trimmed || trimmed === text || save.isPending} onClick={() => save.mutate(trimmed)}>
            {save.isPending ? 'Saving…' : 'Save remark'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
