import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { format } from 'date-fns'
import { Image as ImageIcon, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import type { AssignmentOverview, ItemStats, ResultRow } from '@ai-tutor/lms-client'
import { api, backend } from '@/lib/backend'
import { cn } from '@/lib/utils'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Loading, Page, Problem } from '@/components/layout/page'
import { StatusBadge, scoreOf } from '@/features/class'
import { className } from '@/features/dashboard'
import { QuestionView, letter } from '@/features/questions/question-view'

export function HomeworkDetail({ assignmentId }: { assignmentId: string }) {
  const overview = useQuery({
    queryKey: ['overview', assignmentId],
    queryFn: () => api.assignmentOverview(assignmentId),
  })
  const results = useQuery({
    queryKey: ['results', assignmentId],
    queryFn: () => api.assignmentResults(assignmentId),
  })
  const [editing, setEditing] = useState(false)

  if (overview.isPending) return <Page title='Homework'><Loading what='the homework' /></Page>
  if (overview.isError) return <Page title='Homework'><Problem error={overview.error} /></Page>
  const a = overview.data
  if (!a) return <Page title='Homework'><p className='text-muted-foreground'>This homework is not one of yours.</p></Page>
  if (!a.published) {
    return (
      <Page title={a.title}>
        <p className='text-muted-foreground'>
          This is a draft.{' '}
          <Link to='/homework/$assignmentId/edit' params={{ assignmentId }} className='underline'>
            Finish and publish it
          </Link>
          .
        </p>
      </Page>
    )
  }
  const mcq = a.answerTypes.includes('mcq')
  const photo = a.answerTypes.includes('photo')

  return (
    <Page
      title={a.title}
      description={
        <span className='flex flex-wrap items-center gap-2'>
          <StatusBadge a={a} />
          {className(a)} · {a.subjectName} · due {format(new Date(a.dueAt), 'd MMM yyyy, h:mm a')}
        </span>
      }
      back={{ label: 'Back to the class', to: '/classes/$sectionId/$subjectId', params: { sectionId: a.sectionId, subjectId: a.subjectId } }}
      actions={
        <Button variant='outline' onClick={() => setEditing(true)}>
          <Pencil /> Edit details
        </Button>
      }
    >
      {a.instructions && <p className='mb-4 max-w-3xl whitespace-pre-wrap'>{a.instructions}</p>}
      {results.isPending ? (
        <Loading what='the results' />
      ) : results.isError ? (
        <Problem error={results.error} />
      ) : (
        <>
          <Summary a={a} rows={results.data} />
          <Tabs defaultValue='students' className='mt-6 space-y-4'>
            <TabsList>
              <TabsTrigger value='students'>Students</TabsTrigger>
              {mcq && <TabsTrigger value='questions'>Question analysis</TabsTrigger>}
            </TabsList>
            <TabsContent value='students'>
              <Students a={a} rows={results.data} mcq={mcq} photo={photo} />
            </TabsContent>
            {mcq && (
              <TabsContent value='questions'>
                <QuestionAnalysis assignmentId={assignmentId} />
              </TabsContent>
            )}
          </Tabs>
        </>
      )}
      <EditDialog a={a} open={editing} onOpenChange={setEditing} />
    </Page>
  )
}

function Summary({ a, rows }: { a: AssignmentOverview; rows: ResultRow[] }) {
  const handedIn = rows.filter((r) => r.submitted)
  const late = handedIn.filter((r) => r.late)
  const scores = handedIn.map(scoreOf).filter((s): s is number => s !== null)
  const avg = scores.length ? scores.reduce((x, y) => x + y, 0) / scores.length : null
  const closed = new Date(a.dueAt) <= new Date()
  const missing = rows.filter((r) => !r.submitted)
  const toMark = handedIn.filter((r) => r.photoSubmissionId && r.photoTeacherScore === null)
  const stat = (title: string, value: string, note?: string) => (
    <Card>
      <CardHeader className='pb-2'>
        <CardDescription>{title}</CardDescription>
        <CardTitle className='text-2xl tabular-nums'>{value}</CardTitle>
      </CardHeader>
      {note && <CardContent className='text-xs text-muted-foreground'>{note}</CardContent>}
    </Card>
  )
  return (
    <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
      {stat('Handed in', `${handedIn.length} / ${rows.length}`, late.length ? `${late.length} late` : undefined)}
      {stat('Average score', avg === null ? '—' : `${Math.round(avg * 100)}%`)}
      {stat(
        closed ? 'Missing' : 'Not yet handed in',
        String(missing.length),
        missing.slice(0, 4).map((r) => r.displayName).join(', ') + (missing.length > 4 ? '…' : '')
      )}
      {stat('Photos to mark', String(toMark.length))}
    </div>
  )
}

function Students({ a, rows, mcq, photo }: { a: AssignmentOverview; rows: ResultRow[]; mcq: boolean; photo: boolean }) {
  const [marking, setMarking] = useState<{ row: ResultRow; kind: 'mcq' | 'photo' } | null>(null)
  return (
    <div className='overflow-x-auto rounded-md border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className='w-14'>Roll</TableHead>
            <TableHead>Student</TableHead>
            <TableHead>Status</TableHead>
            {mcq && <TableHead className='text-end'>Auto score</TableHead>}
            {mcq && <TableHead className='text-end'>Your mark</TableHead>}
            {photo && <TableHead>Photos</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.studentUserId}>
              <TableCell className='tabular-nums'>{r.rollNumber}</TableCell>
              <TableCell className='font-medium'>{r.displayName}</TableCell>
              <TableCell>
                {r.submitted ? (
                  <span className={cn(r.late && 'text-orange-600')}>
                    {r.late ? 'Late' : 'Handed in'}
                    {r.submittedAt && (
                      <span className='ms-1 text-xs text-muted-foreground'>
                        {format(new Date(r.submittedAt), 'd MMM, h:mm a')}
                      </span>
                    )}
                    {r.attempts > 1 && <span className='ms-1 text-xs text-muted-foreground'>(attempt {r.attempts})</span>}
                  </span>
                ) : (
                  <span className={cn(new Date(a.dueAt) <= new Date() ? 'text-destructive' : 'text-muted-foreground')}>
                    {new Date(a.dueAt) <= new Date() ? 'Missing' : 'Not yet'}
                  </span>
                )}
              </TableCell>
              {mcq && (
                <TableCell className='text-end tabular-nums'>
                  {r.machineTotal !== null ? `${r.machineCorrect} / ${r.machineTotal}` : '—'}
                </TableCell>
              )}
              {mcq && (
                <TableCell className='text-end'>
                  {r.submissionId ? (
                    <Button variant='ghost' size='sm' onClick={() => setMarking({ row: r, kind: 'mcq' })}>
                      {r.teacherScore !== null ? `${r.teacherScore} / ${r.teacherMax}` : 'Add mark'}
                    </Button>
                  ) : (
                    '—'
                  )}
                </TableCell>
              )}
              {photo && (
                <TableCell>
                  {r.photoSubmissionId ? (
                    <Button variant='outline' size='sm' onClick={() => setMarking({ row: r, kind: 'photo' })}>
                      <ImageIcon /> {r.photoCount} · {r.photoTeacherScore !== null ? `${r.photoTeacherScore} / ${r.photoTeacherMax}` : 'mark'}
                    </Button>
                  ) : (
                    '—'
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {marking && (
        <MarkDialog assignmentId={a.id} row={marking.row} kind={marking.kind} onClose={() => setMarking(null)} />
      )}
    </div>
  )
}

/**
 * The teacher's mark, kept beside the machine's (0024): for MCQ work it can
 * confirm or override the automatic score; for photos it is the only mark.
 */
function MarkDialog({
  assignmentId,
  row,
  kind,
  onClose,
}: {
  assignmentId: string
  row: ResultRow
  kind: 'mcq' | 'photo'
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const submissionId = kind === 'mcq' ? row.submissionId! : row.photoSubmissionId!
  const [score, setScore] = useState(
    String((kind === 'mcq' ? (row.teacherScore ?? row.machineCorrect) : row.photoTeacherScore) ?? '')
  )
  const [max, setMax] = useState(
    String((kind === 'mcq' ? (row.teacherMax ?? row.machineTotal) : row.photoTeacherMax) ?? 10)
  )
  const photos = useQuery({
    queryKey: ['photos', submissionId],
    queryFn: async () => {
      const list = await api.submissionPhotos(submissionId)
      return Promise.all(list.map(async (p) => ({ ...p, url: await backend.workUrl(p.objectName) })))
    },
    enabled: kind === 'photo',
    staleTime: 5 * 60 * 1000,
  })
  const s = Number(score)
  const m = Number(max)
  const invalid = score.trim() === '' || !(m > 0) || !(s >= 0) || s > m || m > 1000
  const save = useMutation({
    mutationFn: () => api.setTeacherMark(submissionId, s, m),
    onSuccess: () => {
      toast.success(`Mark saved for ${row.displayName}.`)
      queryClient.invalidateQueries({ queryKey: ['results', assignmentId] })
      onClose()
    },
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn(kind === 'photo' && 'sm:max-w-3xl')}>
        <DialogHeader>
          <DialogTitle>{row.displayName}</DialogTitle>
          <DialogDescription>
            {kind === 'mcq'
              ? `Automatic score ${row.machineCorrect} / ${row.machineTotal}. Your mark is kept beside it; the student sees yours.`
              : 'Their notebook work. Your mark is the only one this work gets.'}
          </DialogDescription>
        </DialogHeader>
        {kind === 'photo' && (
          <div className='max-h-[60vh] space-y-3 overflow-y-auto'>
            {photos.isPending ? (
              <Loading what='the photos' />
            ) : photos.isError ? (
              <Problem error={photos.error} />
            ) : (
              photos.data.map((p) => (
                <a key={p.objectName} href={p.url} target='_blank' rel='noreferrer'>
                  <img src={p.url} alt={`Page ${p.photoPosition}`} className='w-full rounded-md border' />
                </a>
              ))
            )}
          </div>
        )}
        <div className='flex items-end gap-2'>
          <div className='space-y-1.5'>
            <Label htmlFor='score'>Mark</Label>
            <Input id='score' inputMode='decimal' className='w-24' value={score} onChange={(e) => setScore(e.target.value)} />
          </div>
          <span className='pb-2'>out of</span>
          <div className='space-y-1.5'>
            <Label htmlFor='max'>Out of</Label>
            <Input id='max' inputMode='decimal' className='w-24' value={max} onChange={(e) => setMax(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={invalid || save.isPending} onClick={() => save.mutate()}>
            Save mark
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Question by question, hardest first: how many got it right, what the rest
 * chose, and the misconception behind the most-chosen wrong answer — what
 * to reteach tomorrow.
 */
function QuestionAnalysis({ assignmentId }: { assignmentId: string }) {
  const stats = useQuery({
    queryKey: ['item-stats', assignmentId],
    queryFn: () => api.itemStats(assignmentId),
  })
  if (stats.isPending) return <Loading what='the analysis' />
  if (stats.isError) return <Problem error={stats.error} />
  const rate = (s: ItemStats) => (s.answered ? s.correct / s.answered : 1)
  const ordered = [...stats.data].sort((x, y) => rate(x) - rate(y))
  return (
    <div className='space-y-4'>
      <p className='text-sm text-muted-foreground'>
        Hardest first, over each student’s latest attempt.
      </p>
      {ordered.map((s) => {
        const wrong = (s.optionCounts ?? [])
          .map((n, i) => ({ n, i }))
          .filter((o) => o.i !== s.correctIndex && o.n > 0)
          .sort((x, y) => y.n - x.n)[0]
        const label = wrong ? s.misconceptions?.[wrong.i]?.trim() : undefined
        const pct = s.answered ? Math.round(rate(s) * 100) : null
        return (
          <Card key={s.itemId}>
            <CardHeader className='pb-2'>
              <CardDescription className='flex flex-wrap gap-2'>
                <span>Question {s.questionPosition}</span>
                <span className={cn('font-medium', pct !== null && pct < 50 ? 'text-destructive' : 'text-foreground')}>
                  {pct === null ? 'Nobody has answered yet' : `${pct}% right (${s.correct} of ${s.answered})`}
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-2'>
              <QuestionView
                stem={s.stem}
                options={s.options}
                correctIndex={s.correctIndex}
                counts={s.optionCounts}
                misconceptions={s.misconceptions}
              />
              {wrong && (
                <p className='text-sm'>
                  Most common wrong answer: <span className='font-medium'>{letter(wrong.i)}</span> ({wrong.n}{' '}
                  {wrong.n === 1 ? 'student' : 'students'})
                  {label ? ` — likely misconception: ${label}.` : '.'}
                </p>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function EditDialog({ a, open, onOpenChange }: { a: AssignmentOverview; open: boolean; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(a.title)
  const [instructions, setInstructions] = useState(a.instructions ?? '')
  const [due, setDue] = useState(format(new Date(a.dueAt), "yyyy-MM-dd'T'HH:mm"))
  const dueDate = new Date(due)
  const invalid = !title.trim() || Number.isNaN(dueDate.getTime())
  const save = useMutation({
    mutationFn: () =>
      api.updateAssignment(a.id, { title: title.trim(), instructions: instructions.trim(), dueAt: dueDate.toISOString() }),
    onSuccess: () => {
      toast.success('Homework updated.')
      queryClient.invalidateQueries({ queryKey: ['overview', a.id] })
      queryClient.invalidateQueries({ queryKey: ['class-assignments', a.sectionId, a.subjectId] })
      onOpenChange(false)
    },
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
          <DialogDescription>
            Students see the change at once. The questions are fixed now that it is published.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='space-y-1.5'>
            <Label htmlFor='e-title'>Title</Label>
            <Input id='e-title' maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='e-inst'>Instructions</Label>
            <Textarea id='e-inst' maxLength={4000} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='e-due'>Due</Label>
            <Input id='e-due' type='datetime-local' value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={invalid || save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
