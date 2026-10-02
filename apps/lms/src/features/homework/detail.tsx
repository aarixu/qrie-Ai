import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { format } from 'date-fns'
import { Image as ImageIcon, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import type { AssignmentOverview, ItemStats, ResultRow, WorkStatus } from '@ai-tutor/lms-client'
import { api, backend } from '@/lib/backend'
import { usePhotos } from '@/lib/photos'
import { cn } from '@/lib/utils'
import { PersonAvatar } from '@/components/person-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Loading, Page, Problem } from '@/components/layout/page'
import { StatusBadge as WorkStateBadge, scoreOf } from '@/features/class'
import { className } from '@/features/dashboard'
import { QuestionView, letter } from '@/features/questions/question-view'
import { kindLabel } from './kinds'

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
  const checklist = a.answerTypes.includes('checklist')
  const paper = a.answerTypes.includes('paper')
  const test = a.kind === 'test'

  return (
    <Page
      title={a.title}
      description={
        <span className='flex flex-wrap items-center gap-2'>
          <WorkStateBadge a={a} />
          <span>{kindLabel(a.kind)}</span>
          <span aria-hidden>·</span>
          {className(a)} · {a.subjectName} ·{' '}
          {paper
            ? `on ${format(new Date(a.dueAt), 'd MMM yyyy')}, out of ${a.maxMarks}`
            : test
              ? `${a.opensAt ? `opens ${format(new Date(a.opensAt), 'd MMM, h:mm a')}, ` : ''}closes ${format(new Date(a.dueAt), 'd MMM, h:mm a')}${a.timeLimitMinutes ? `, ${a.timeLimitMinutes} min` : ''}`
              : `due ${format(new Date(a.dueAt), 'd MMM yyyy, h:mm a')}`}
        </span>
      }
      back={{ label: 'Back to the class', to: '/classes/$sectionId/$subjectId', params: { sectionId: a.sectionId, subjectId: a.subjectId } }}
      actions={
        <>
          {test && <ReleaseResults a={a} />}
          <Button variant='outline' onClick={() => setEditing(true)}>
            <Pencil /> Edit details
          </Button>
        </>
      }
    >
      {a.instructions && <p className='mb-4 max-w-3xl whitespace-pre-wrap'>{a.instructions}</p>}
      {checklist && <TaskList assignmentId={assignmentId} />}
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
              {paper ? (
                <PaperMarks a={a} rows={results.data} />
              ) : (
                <Students a={a} rows={results.data} mcq={mcq} photo={photo} checklist={checklist} />
              )}
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
  const types = a.answerTypes
  const paper = types.includes('paper')
  const scored = types.some((t) => t === 'mcq' || t === 'paper' || t === 'photo')
  const onlyChecklist = types.every((t) => t === 'checklist')
  const absent = rows.filter((r) => r.teacherStatus === 'absent')
  const present = rows.filter((r) => r.teacherStatus !== 'absent')
  const handedIn = present.filter((r) => r.submitted)
  const late = handedIn.filter((r) => r.late)
  const scores = handedIn.map(scoreOf).filter((s): s is number => s !== null)
  const avg = scores.length ? scores.reduce((x, y) => x + y, 0) / scores.length : null
  const closed = new Date(a.dueAt) <= new Date()
  const missing = present.filter((r) => !r.submitted)
  const inProgress = missing.filter((r) => r.startedAt)
  const toMark = handedIn.filter((r) => r.photoSubmissionId && r.photoTeacherScore === null)
  const checked = rows.filter((r) => r.teacherStatus === 'checked')
  const names = (list: ResultRow[]) => list.slice(0, 4).map((r) => r.displayName).join(', ') + (list.length > 4 ? '…' : '')
  const stat = (title: string, value: string, note?: string) => (
    <Card key={title}>
      <CardHeader className='pb-2'>
        <CardDescription>{title}</CardDescription>
        <CardTitle className='text-2xl tabular-nums'>{value}</CardTitle>
      </CardHeader>
      {note && <CardContent className='text-xs text-muted-foreground'>{note}</CardContent>}
    </Card>
  )
  const cards = [
    paper
      ? stat('Marked', `${handedIn.length} / ${present.length}`, absent.length ? `${absent.length} absent` : undefined)
      : onlyChecklist
        ? stat('Ticked everything', `${handedIn.length} / ${rows.length}`, 'Their own word — check the notebooks')
        : stat('Handed in', `${handedIn.length} / ${present.length}`, late.length ? `${late.length} late` : undefined),
    scored && stat('Average score', avg === null ? '—' : `${Math.round(avg * 100)}%`),
    !paper &&
      stat(
        closed ? 'Missing' : 'Not yet handed in',
        String(missing.length - inProgress.length),
        names(missing.filter((r) => !r.startedAt))
      ),
    inProgress.length > 0 && stat('Taking it now', String(inProgress.length), names(inProgress)),
    types.includes('photo') && stat('Photos to mark', String(toMark.length)),
    (types.includes('checklist') || onlyChecklist) && stat('Checked by you', `${checked.length} / ${rows.length}`),
    paper && absent.length > 0 && stat('Absent', String(absent.length), names(absent)),
  ].filter(Boolean)
  return <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>{cards}</div>
}

function Students({
  a,
  rows,
  mcq,
  photo,
  checklist,
}: {
  a: AssignmentOverview
  rows: ResultRow[]
  mcq: boolean
  photo: boolean
  checklist: boolean
}) {
  const photos = usePhotos(rows.map((r) => r.studentUserId))
  const [marking, setMarking] = useState<{ row: ResultRow; kind: 'mcq' | 'photo' } | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const toggle = (id: string, on: boolean) => {
    const next = new Set(picked)
    if (on) next.add(id)
    else next.delete(id)
    setPicked(next)
  }
  const allPicked = rows.length > 0 && picked.size === rows.length
  return (
    <div className='space-y-2'>
    <StatusBar a={a} picked={[...picked]} onDone={() => setPicked(new Set())} />
    <div className='overflow-x-auto rounded-md border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className='w-10'>
              <Checkbox
                aria-label='Select every student'
                checked={allPicked}
                onCheckedChange={(on) => setPicked(on === true ? new Set(rows.map((r) => r.studentUserId)) : new Set())}
              />
            </TableHead>
            <TableHead className='w-14'>Roll</TableHead>
            <TableHead>Student</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Your check</TableHead>
            {checklist && <TableHead className='text-end'>Written work</TableHead>}
            {mcq && <TableHead className='text-end'>Auto score</TableHead>}
            {mcq && <TableHead className='text-end'>Your mark</TableHead>}
            {photo && <TableHead>Photos</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.studentUserId} data-state={picked.has(r.studentUserId) ? 'selected' : undefined}>
              <TableCell>
                <Checkbox
                  aria-label={`Select ${r.displayName}`}
                  checked={picked.has(r.studentUserId)}
                  onCheckedChange={(on) => toggle(r.studentUserId, on === true)}
                />
              </TableCell>
              <TableCell className='tabular-nums'>{r.rollNumber}</TableCell>
              <TableCell className='font-medium'>
                <span className='flex items-center gap-2'>
                  <PersonAvatar userId={r.studentUserId} name={r.displayName} photo={photos.get(r.studentUserId)} className='size-7' />
                  {r.displayName}
                </span>
              </TableCell>
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
                ) : r.startedAt ? (
                  <span className='text-muted-foreground'>Started {format(new Date(r.startedAt), 'h:mm a')}</span>
                ) : (
                  <span className={cn(new Date(a.dueAt) <= new Date() ? 'text-destructive' : 'text-muted-foreground')}>
                    {new Date(a.dueAt) <= new Date() ? 'Missing' : 'Not yet'}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <StatusBadge status={r.teacherStatus} />
              </TableCell>
              {checklist && (
                <TableCell className={cn('text-end tabular-nums', r.tasksDone === r.tasksTotal && 'text-green-700')}>
                  {r.tasksDone} / {r.tasksTotal} ticked
                </TableCell>
              )}
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
      void queryClient.invalidateQueries({ queryKey: ['results', assignmentId] }).then(() => queryClient.invalidateQueries({ queryKey: ['needs-attention'] }))
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

/** The written tasks, as the students see them. */
function TaskList({ assignmentId }: { assignmentId: string }) {
  const tasks = useQuery({
    queryKey: ['assignment-tasks', assignmentId],
    queryFn: () => api.assignmentTasks(assignmentId),
  })
  if (!tasks.data?.length) return null
  return (
    <Card className='mb-4 max-w-3xl'>
      <CardHeader className='pb-2'>
        <CardDescription>Written work in the notebook — students tick each task when it is done</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className='list-decimal space-y-1 ps-5 text-sm'>
          {tasks.data.map((t) => (
            <li key={t.taskId}>{t.text}</li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}

/**
 * A test's scores and answers reach its students only when the teacher says
 * (lms.release_results). Once released they stay released.
 */
function ReleaseResults({ a }: { a: AssignmentOverview }) {
  const queryClient = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const release = useMutation({
    mutationFn: () => api.releaseResults(a.id),
    onSuccess: () => {
      toast.success('Results released. Students can see their scores now.')
      queryClient.invalidateQueries({ queryKey: ['overview', a.id] })
      queryClient.invalidateQueries({ queryKey: ['class-assignments', a.sectionId, a.subjectId] })
      queryClient.invalidateQueries({ queryKey: ['needs-attention'] })
      setConfirm(false)
    },
  })
  if (a.resultsReleasedAt) {
    return (
      <span className='self-center text-sm text-muted-foreground'>
        Results released {format(new Date(a.resultsReleasedAt), 'd MMM, h:mm a')}
      </span>
    )
  }
  return (
    <>
      <Button onClick={() => setConfirm(true)}>Release results</Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title='Release the results?'
        desc={
          a.answerTypes.includes('paper')
            ? 'Every student will see the marks you have entered. Check them first.'
            : 'Every student will see their score and which answers were right. This cannot be undone.'
        }
        confirmText='Release'
        isLoading={release.isPending}
        handleConfirm={() => release.mutate()}
      />
    </>
  )
}

/** Marks for a test on paper: one box per student, saved as the teacher moves on (lms.record_paper_mark). */
function PaperMarks({ a, rows }: { a: AssignmentOverview; rows: ResultRow[] }) {
  const photos = usePhotos(rows.map((r) => r.studentUserId))
  const entered = rows.filter((r) => r.paperScore !== null || r.teacherStatus === 'absent').length
  return (
    <div className='space-y-2'>
      <p className='text-sm text-muted-foreground'>
        {entered} of {rows.length} marked. Type a mark and press Enter or move to the next box; it saves by itself.
      </p>
      <div className='overflow-x-auto rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='w-14'>Roll</TableHead>
              <TableHead>Student</TableHead>
              <TableHead className='w-48'>Marks (out of {a.maxMarks})</TableHead>
              <TableHead className='w-24'>Absent</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.studentUserId}>
                <TableCell className='tabular-nums'>{r.rollNumber}</TableCell>
                <TableCell className='font-medium'>
                <span className='flex items-center gap-2'>
                  <PersonAvatar userId={r.studentUserId} name={r.displayName} photo={photos.get(r.studentUserId)} className='size-7' />
                  {r.displayName}
                </span>
              </TableCell>
                <TableCell>
                  <MarkBox a={a} row={r} />
                </TableCell>
                <TableCell>
                  <AbsentBox a={a} row={r} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function MarkBox({ a, row }: { a: AssignmentOverview; row: ResultRow }) {
  const queryClient = useQueryClient()
  const saved = row.paperScore === null ? '' : String(row.paperScore)
  const [value, setValue] = useState(saved)
  const n = Number(value)
  const invalid = value.trim() !== '' && (!(n >= 0) || n > (a.maxMarks ?? 0))
  const save = useMutation({
    mutationFn: () => api.recordPaperMark(a.id, row.studentUserId, n),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['results', a.id] }).then(() => queryClient.invalidateQueries({ queryKey: ['needs-attention'] })),
  })
  const commit = () => {
    if (value.trim() === '' || value === saved || invalid) return
    save.mutate()
  }
  return (
    <div className='flex items-center gap-2'>
      <Input
        inputMode='decimal'
        className={cn('w-24', invalid && 'border-destructive')}
        aria-label={`Marks for ${row.displayName}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit()
            ;(e.currentTarget.closest('tr')?.nextElementSibling?.querySelector('input') as HTMLInputElement | null)?.focus()
          }
        }}
      />
      <span className='text-xs text-muted-foreground'>
        {invalid ? `0 to ${a.maxMarks}` : save.isPending ? 'Saving…' : save.isError ? 'Not saved' : value === saved && saved ? 'Saved' : ''}
      </span>
    </div>
  )
}

const STATUS_WORDS: Record<WorkStatus, string> = { checked: 'Checked', not_done: 'Not done', absent: 'Absent' }

function StatusBadge({ status }: { status: WorkStatus | null }) {
  if (!status) return <span className='text-muted-foreground'>—</span>
  return (
    <Badge variant={status === 'checked' ? 'secondary' : 'outline'} className={cn(status === 'not_done' && 'border-orange-500 text-orange-700')}>
      {STATUS_WORDS[status]}
    </Badge>
  )
}

/**
 * The teacher's own word on each child's work, set for everyone selected at
 * once (lms.set_work_status) — after checking notebooks in class, say. A
 * child's ticks are only the child's word; this is the teacher's.
 */
function StatusBar({ a, picked, onDone }: { a: AssignmentOverview; picked: string[]; onDone: () => void }) {
  const queryClient = useQueryClient()
  const set = useMutation({
    mutationFn: (status: WorkStatus | null) => api.setWorkStatus(a.id, picked, status),
    onSuccess: (_, status) => {
      toast.success(`${picked.length} ${picked.length === 1 ? 'student' : 'students'} ${status ? `marked ${STATUS_WORDS[status].toLowerCase()}` : 'cleared'}.`)
      void queryClient.invalidateQueries({ queryKey: ['results', a.id] }).then(() => queryClient.invalidateQueries({ queryKey: ['needs-attention'] }))
      onDone()
    },
  })
  return (
    <div className='flex flex-wrap items-center gap-2 text-sm'>
      <span className='text-muted-foreground'>
        {picked.length ? `${picked.length} selected — mark as:` : 'Select students to mark their work as checked, not done or absent.'}
      </span>
      {picked.length > 0 &&
        (['checked', 'not_done', 'absent'] as const).map((st) => (
          <Button key={st} size='sm' variant='outline' disabled={set.isPending} onClick={() => set.mutate(st)}>
            {STATUS_WORDS[st]}
          </Button>
        ))}
      {picked.length > 0 && (
        <Button size='sm' variant='ghost' disabled={set.isPending} onClick={() => set.mutate(null)}>
          Clear
        </Button>
      )}
    </div>
  )
}

function AbsentBox({ a, row }: { a: AssignmentOverview; row: ResultRow }) {
  const queryClient = useQueryClient()
  const set = useMutation({
    mutationFn: (absent: boolean) => api.setWorkStatus(a.id, [row.studentUserId], absent ? 'absent' : null),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['results', a.id] }).then(() => queryClient.invalidateQueries({ queryKey: ['needs-attention'] })),
  })
  return (
    <Checkbox
      aria-label={`${row.displayName} was absent`}
      checked={row.teacherStatus === 'absent'}
      disabled={set.isPending}
      onCheckedChange={(on) => set.mutate(on === true)}
    />
  )
}
