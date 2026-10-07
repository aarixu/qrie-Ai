import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { addDays, format, set } from 'date-fns'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { AnswerType } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Loading, Page, Problem } from '@/components/layout/page'
import { className } from '@/features/dashboard'
import { QuestionPicker, type PickedItem } from '@/features/questions/question-picker'
import { QuestionView } from '@/features/questions/question-view'
import { PART_LABELS, WORK_KINDS, defaultParts, kindLabel, type WorkKind } from './kinds'

type BuilderProps =
  | { mode: 'new'; sectionId: string; subjectId: string; kind: WorkKind }
  | { mode: 'edit'; assignmentId: string }

const LOCAL = "yyyy-MM-dd'T'HH:mm"
const at = (days: number, hours: number) => format(set(addDays(new Date(), days), { hours, minutes: 0 }), LOCAL)

/** New homework, assignment or test, or a draft being finished. Published work is changed from its own page. */
export function HomeworkBuilder(props: BuilderProps) {
  const editing = props.mode === 'edit' ? props.assignmentId : null
  const overview = useQuery({
    queryKey: ['overview', editing],
    queryFn: () => api.assignmentOverview(editing!),
    enabled: editing !== null,
  })
  const items = useQuery({
    queryKey: ['assignment-items', editing],
    queryFn: () => api.assignmentItems(editing!),
    enabled: editing !== null,
  })
  const tasks = useQuery({
    queryKey: ['assignment-tasks', editing],
    queryFn: () => api.assignmentTasks(editing!),
    enabled: editing !== null,
  })
  const classes = useQuery({ queryKey: ['classes'], queryFn: api.myClasses })

  const sectionId = props.mode === 'new' ? props.sectionId : overview.data?.sectionId
  const subjectId = props.mode === 'new' ? props.subjectId : overview.data?.subjectId
  const c = classes.data?.find((x) => x.sectionId === sectionId && x.subjectId === subjectId)

  if (classes.isPending || (editing && (overview.isPending || items.isPending || tasks.isPending))) {
    return <Page title='Work'><Loading what='the work' /></Page>
  }
  const failed = classes.error ?? overview.error ?? items.error ?? tasks.error
  if (failed) return <Page title='Work'><Problem error={failed} /></Page>
  if (editing && overview.data?.published) {
    return (
      <Page title='Work'>
        <p className='text-muted-foreground'>This is published; change it from its own page.</p>
      </Page>
    )
  }
  if (!c) return <Page title='Work'><p className='text-muted-foreground'>This is not one of your classes.</p></Page>

  const o = overview.data
  return (
    <Form
      key={editing ?? `new-${props.mode === 'new' ? props.kind : ''}`}
      assignmentId={editing}
      cls={c}
      initialKind={o ? (o.kind as WorkKind) : props.mode === 'new' ? props.kind : 'homework'}
      initial={
        o
          ? {
              title: o.title,
              instructions: o.instructions ?? '',
              due: format(new Date(o.dueAt), LOCAL),
              opens: o.opensAt ? format(new Date(o.opensAt), LOCAL) : '',
              timeLimit: o.timeLimitMinutes ? String(o.timeLimitMinutes) : '',
              maxMarks: o.maxMarks ? String(o.maxMarks) : '',
              answerTypes: o.answerTypes,
              attempts: o.attemptsAllowed,
              tasks: (tasks.data ?? []).map((t) => t.text),
              items: (items.data ?? []).map((i) => ({
                id: i.itemId,
                stem: i.stem,
                options: i.options ?? [],
                correctIndex: i.correctIndex ?? 0,
              })),
            }
          : undefined
      }
    />
  )
}

type Initial = {
  title: string
  instructions: string
  due: string
  opens: string
  timeLimit: string
  maxMarks: string
  answerTypes: AnswerType[]
  attempts: number
  tasks: string[]
  items: PickedItem[]
}

type FormProps = {
  assignmentId: string | null
  cls: { sectionId: string; subjectId: string; grade: number; sectionName: string; subjectName: string }
  initialKind: WorkKind
  initial?: Initial
}

function Form({ assignmentId, cls, initialKind, initial }: FormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isNew = assignmentId === null
  const [kind, setKind] = useState<WorkKind>(initialKind)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [instructions, setInstructions] = useState(initial?.instructions ?? '')
  const [due, setDue] = useState(initial?.due ?? (initialKind === 'homework' ? at(1, 20) : at(7, 20)))
  const [opens, setOpens] = useState(initial?.opens ?? '')
  const [timeLimit, setTimeLimit] = useState(initial?.timeLimit ?? (initialKind === 'test' ? '30' : ''))
  const [maxMarks, setMaxMarks] = useState(initial?.maxMarks ?? '')
  const [types, setTypes] = useState<AnswerType[]>(initial?.answerTypes ?? defaultParts(initialKind))
  const [attempts, setAttempts] = useState(initial?.attempts ?? 1)
  const [tasks, setTasks] = useState<string[]>(initial?.tasks.length ? initial.tasks : [''])
  const [items, setItems] = useState<PickedItem[]>(initial?.items ?? [])
  const [picking, setPicking] = useState(false)
  const [confirmPublish, setConfirmPublish] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<unknown>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const touch = <T,>(setter: (v: T) => void) => (v: T) => {
    setDirty(true)
    setter(v)
  }
  const label = kindLabel(kind)
  const test = kind === 'test'
  const paperTest = test && types.includes('paper')
  const mcq = types.includes('mcq')
  const checklist = types.includes('checklist')
  const filledTasks = tasks.map((t) => t.trim()).filter(Boolean)
  const dueDate = new Date(due)
  const opensDate = opens ? new Date(opens) : null
  const limit = timeLimit ? Number(timeLimit) : null
  const marks = maxMarks ? Number(maxMarks) : null

  const draftProblem = !title.trim()
    ? `Give the ${label.toLowerCase()} a title.`
    : Number.isNaN(dueDate.getTime())
      ? paperTest
        ? 'Choose the date of the test.'
        : 'Choose when it is due.'
      : types.length === 0
        ? 'Choose what students do.'
        : opensDate && opensDate >= dueDate
          ? 'It must open before it closes.'
          : limit !== null && !(Number.isInteger(limit) && limit >= 1 && limit <= 300)
            ? 'A time limit is 1 to 300 minutes.'
            : marks !== null && !(marks > 0 && marks <= 1000)
              ? 'Maximum marks must be between 1 and 1000.'
              : types.includes('paper') && marks === null
                ? 'Give the maximum marks for a test on paper.'
                : null
  const publishProblem =
    draftProblem ??
    (dueDate <= new Date() && !paperTest
      ? 'That time has passed; choose a later one to publish.'
      : mcq && items.length === 0
        ? 'Add at least one question to publish.'
        : checklist && filledTasks.length === 0
          ? 'Write at least one task to publish.'
          : null)

  function chooseKind(next: WorkKind) {
    setDirty(true)
    setKind(next)
    setTypes(defaultParts(next))
    if (next === 'test') {
      setTimeLimit(timeLimit || '30')
      setAttempts(1)
    } else {
      setTimeLimit('')
      setOpens('')
    }
  }

  function togglePart(part: 'checklist' | 'mcq' | 'photo', on: boolean) {
    touch(setTypes)(on ? [...types.filter((t) => t !== part), part] : types.filter((t) => t !== part))
  }

  async function save(publish: boolean) {
    setBusy(true)
    setProblem(null)
    try {
      let id = assignmentId
      const timing = {
        opensAt: opensDate && test && !paperTest ? opensDate.toISOString() : undefined,
        timeLimitMinutes: test && !paperTest && limit ? limit : undefined,
        maxMarks: marks ?? undefined,
      }
      if (id === null) {
        id = await api.createAssignment({
          sectionId: cls.sectionId,
          subjectId: cls.subjectId,
          kind,
          title: title.trim(),
          instructions: instructions.trim() || undefined,
          dueAt: dueDate.toISOString(),
          answerTypes: types,
          attemptsAllowed: test ? 1 : attempts,
          ...timing,
        })
      } else {
        await api.updateAssignment(id, {
          title: title.trim(),
          instructions: instructions.trim(),
          dueAt: dueDate.toISOString(),
          attemptsAllowed: attempts,
          ...timing,
        })
      }
      if (mcq) await api.setAssignmentItems(id, items.map((i) => i.id))
      if (checklist) await api.setAssignmentTasks(id, filledTasks)
      if (publish) await api.publishAssignment(id)
      setDirty(false)
      for (const key of [['class-assignments', cls.sectionId, cls.subjectId], ['overview', id], ['assignment-items', id], ['assignment-tasks', id], ['upcoming']]) {
        await queryClient.invalidateQueries({ queryKey: key })
      }
      if (publish) {
        toast.success(`${label} published to ${className(cls)}.`)
        navigate({ to: '/homework/$assignmentId', params: { assignmentId: id } })
      } else {
        toast.success('Draft saved. Students cannot see it until you publish.')
        if (isNew) navigate({ to: '/homework/$assignmentId/edit', params: { assignmentId: id }, replace: true })
      }
    } catch (e) {
      setProblem(e)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (assignmentId === null) return
    setBusy(true)
    try {
      await api.deleteDraft(assignmentId)
      setDirty(false)
      await queryClient.invalidateQueries({ queryKey: ['class-assignments', cls.sectionId, cls.subjectId] })
      toast.success('Draft deleted.')
      navigate({ to: '/classes/$sectionId/$subjectId', params: { sectionId: cls.sectionId, subjectId: cls.subjectId } })
    } catch (e) {
      setProblem(e)
    } finally {
      setBusy(false)
    }
  }

  const move = (i: number, by: number) => {
    const next = [...items]
    const [it] = next.splice(i, 1)
    next.splice(i + by, 0, it)
    touch(setItems)(next)
  }

  return (
    <Page
      title={isNew ? `New ${label.toLowerCase()}` : `Finish this ${label.toLowerCase()}`}
      description={`${className(cls)} · ${cls.subjectName}`}
      back={{ label: 'Back to the class', to: '/classes/$sectionId/$subjectId', params: { sectionId: cls.sectionId, subjectId: cls.subjectId } }}
      actions={
        <>
          {!isNew && (
            <Button variant='ghost' className='text-destructive' disabled={busy} onClick={() => setConfirmDelete(true)}>
              <Trash2 /> Delete draft
            </Button>
          )}
          <Button variant='outline' disabled={busy || !!draftProblem} onClick={() => save(false)}>
            Save draft
          </Button>
          <Button disabled={busy || !!publishProblem} onClick={() => setConfirmPublish(true)}>
            Publish
          </Button>
        </>
      }
    >
      {isNew && (
        <div className='mb-6 grid gap-2 sm:grid-cols-3' role='radiogroup' aria-label='Kind of work'>
          {WORK_KINDS.map((k) => (
            <button
              key={k.kind}
              type='button'
              role='radio'
              aria-checked={kind === k.kind}
              onClick={() => chooseKind(k.kind)}
              className={cn(
                'rounded-lg border p-3 text-start transition-colors',
                kind === k.kind ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-accent'
              )}
            >
              <p className='font-medium'>{k.label}</p>
              <p className='text-xs text-muted-foreground'>{k.blurb}</p>
            </button>
          ))}
        </div>
      )}

      <div className='grid gap-6 lg:grid-cols-[1fr_1.4fr]'>
        <div className='space-y-6'>
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='space-y-1.5'>
                <Label htmlFor='title'>Title</Label>
                <Input
                  id='title'
                  maxLength={200}
                  placeholder={test ? 'Unit test 1: Rational numbers' : 'Exercise 2.1'}
                  value={title}
                  onChange={(e) => touch(setTitle)(e.target.value)}
                />
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='instructions'>Instructions (optional)</Label>
                <Textarea
                  id='instructions'
                  maxLength={4000}
                  value={instructions}
                  onChange={(e) => touch(setInstructions)(e.target.value)}
                />
              </div>
              {test && !paperTest && (
                <div className='space-y-1.5'>
                  <Label htmlFor='opens'>Opens (optional)</Label>
                  <Input id='opens' type='datetime-local' value={opens} onChange={(e) => touch(setOpens)(e.target.value)} />
                  <p className='text-xs text-muted-foreground'>Students cannot start before this. Leave empty to open when you publish.</p>
                </div>
              )}
              <div className='space-y-1.5'>
                <Label htmlFor='due'>{paperTest ? 'Date of the test' : test ? 'Closes' : 'Due'}</Label>
                <Input id='due' type='datetime-local' value={due} onChange={(e) => touch(setDue)(e.target.value)} />
              </div>
              {test && !paperTest && (
                <div className='space-y-1.5'>
                  <Label htmlFor='limit'>Time limit (minutes)</Label>
                  <Input
                    id='limit'
                    inputMode='numeric'
                    className='w-32'
                    value={timeLimit}
                    onChange={(e) => touch(setTimeLimit)(e.target.value.replace(/\D/g, ''))}
                  />
                  <p className='text-xs text-muted-foreground'>
                    Counted by the school’s server from when each student starts; answers after it are not accepted.
                  </p>
                </div>
              )}
              {(kind === 'assignment' || types.includes('paper') || types.includes('photo')) && (
                <div className='space-y-1.5'>
                  <Label htmlFor='marks'>Maximum marks{types.includes('paper') ? '' : ' (optional)'}</Label>
                  <Input
                    id='marks'
                    inputMode='decimal'
                    className='w-32'
                    value={maxMarks}
                    onChange={(e) => touch(setMaxMarks)(e.target.value)}
                  />
                </div>
              )}
              {!test && (
                <div className='space-y-1.5'>
                  <Label>Tries at the questions</Label>
                  <Select value={String(attempts)} onValueChange={(v) => touch(setAttempts)(Number(v))} disabled={!mcq}>
                    <SelectTrigger className='w-32'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {(publishProblem || problem != null) && (
                <div className='text-sm'>
                  {problem != null ? <Problem error={problem} /> : <p className='text-muted-foreground'>{publishProblem}</p>}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>What students do</CardTitle>
              {!isNew && <CardDescription>Fixed when the draft was first saved.</CardDescription>}
            </CardHeader>
            <CardContent className='space-y-3'>
              {test ? (
                <RadioGroup
                  value={paperTest ? 'paper' : 'mcq'}
                  onValueChange={(v) => touch(setTypes)(v === 'paper' ? ['paper'] : ['mcq'])}
                  disabled={!isNew}
                >
                  <label className='flex items-start gap-2 text-sm'>
                    <RadioGroupItem value='mcq' className='mt-0.5' />
                    <span>
                      <span className='font-medium'>Online test</span> — multiple-choice, in the app, timed. Scores reach
                      students only when you release them.
                    </span>
                  </label>
                  <label className='flex items-start gap-2 text-sm'>
                    <RadioGroupItem value='paper' className='mt-0.5' />
                    <span>
                      <span className='font-medium'>On paper, in class</span> — you enter each student’s marks here.
                    </span>
                  </label>
                </RadioGroup>
              ) : (
                (['checklist', 'mcq', 'photo'] as const).map((part) => (
                  <label key={part} className='flex items-start gap-2 text-sm'>
                    <Checkbox
                      className='mt-0.5'
                      checked={types.includes(part)}
                      disabled={!isNew}
                      onCheckedChange={(on) => togglePart(part, on === true)}
                    />
                    <span>
                      <span className='font-medium'>{PART_LABELS[part].label}</span>
                      <span className='block text-xs text-muted-foreground'>{PART_LABELS[part].help}</span>
                    </span>
                  </label>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className='space-y-6'>
          {checklist && (
            <Card>
              <CardHeader>
                <CardTitle>Written work ({filledTasks.length} {filledTasks.length === 1 ? 'task' : 'tasks'})</CardTitle>
                <CardDescription>Each becomes a box the student ticks when it is done in their notebook.</CardDescription>
              </CardHeader>
              <CardContent className='space-y-2'>
                {tasks.map((t, i) => (
                  <div key={i} className='flex items-center gap-2'>
                    <span className='w-5 text-end text-sm text-muted-foreground'>{i + 1}.</span>
                    <Input
                      value={t}
                      maxLength={300}
                      placeholder={i === 0 ? 'Exercise 2.1, questions 1 to 5' : 'Another task'}
                      aria-label={`Task ${i + 1}`}
                      onChange={(e) => touch(setTasks)(tasks.map((x, j) => (j === i ? e.target.value : x)))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && tasks.length < 30) touch(setTasks)([...tasks.slice(0, i + 1), '', ...tasks.slice(i + 1)])
                      }}
                    />
                    <Button
                      variant='ghost'
                      size='icon'
                      aria-label={`Remove task ${i + 1}`}
                      disabled={tasks.length === 1}
                      onClick={() => touch(setTasks)(tasks.filter((_, j) => j !== i))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <Button variant='outline' size='sm' disabled={tasks.length >= 30} onClick={() => touch(setTasks)([...tasks, ''])}>
                  <Plus /> Add a task
                </Button>
              </CardContent>
            </Card>
          )}

          {mcq && (
            <Card>
              <CardHeader className='flex flex-row items-center justify-between'>
                <CardTitle>Questions ({items.length})</CardTitle>
                <Button size='sm' onClick={() => setPicking(true)}>
                  <Plus /> Add questions
                </Button>
              </CardHeader>
              <CardContent className='space-y-3'>
                {items.length === 0 && (
                  <p className='text-sm text-muted-foreground'>
                    No questions yet. Add them from the question bank, or write your own.
                  </p>
                )}
                {items.length > 15 && (
                  <p className='text-sm text-amber-700'>
                    {items.length} questions is a lot for one sitting; 15 or fewer keeps children answering with care.
                  </p>
                )}
                {items.map((it, i) => (
                  <div key={it.id} className='flex gap-3 rounded-lg border p-3'>
                    <span className='font-mono text-sm text-muted-foreground'>{i + 1}.</span>
                    <QuestionView className='flex-1' stem={it.stem} options={it.options} correctIndex={it.correctIndex} />
                    <div className='flex flex-col gap-1'>
                      <Button variant='ghost' size='icon' aria-label='Move up' disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp />
                      </Button>
                      <Button variant='ghost' size='icon' aria-label='Move down' disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown />
                      </Button>
                      <Button
                        variant='ghost'
                        size='icon'
                        aria-label='Remove'
                        onClick={() => touch(setItems)(items.filter((x) => x.id !== it.id))}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {paperTest && (
            <Card>
              <CardHeader>
                <CardTitle>Marks</CardTitle>
                <CardDescription>
                  After the test, open it from the class page and enter each student’s marks out of {marks ?? '…'}. Students see
                  them when you release the results.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </div>
      </div>

      <QuestionPicker
        open={picking}
        onOpenChange={setPicking}
        grade={cls.grade}
        subject={cls.subjectName}
        chosen={new Set(items.map((i) => i.id))}
        onPick={(it) => {
          if (!items.some((x) => x.id === it.id)) touch(setItems)([...items, it])
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title='Delete this draft?'
        desc='It has never been published, so no student has seen it. This cannot be undone.'
        confirmText='Delete'
        destructive
        isLoading={busy}
        handleConfirm={() => {
          setConfirmDelete(false)
          void remove()
        }}
      />
      <ConfirmDialog
        open={confirmPublish}
        onOpenChange={setConfirmPublish}
        title={`Publish to ${className(cls)}?`}
        desc={
          test && !paperTest
            ? `Students will see it now${opensDate ? ` and can start it from ${format(opensDate, 'd MMM, h:mm a')}` : ''}. Its questions cannot be changed after this.`
            : mcq || checklist
              ? 'Students will see it straight away. Its questions and tasks cannot be changed after that; the title, instructions and dates can.'
              : 'Students will see it straight away.'
        }
        confirmText='Publish'
        isLoading={busy}
        handleConfirm={() => {
          setConfirmPublish(false)
          void save(true)
        }}
      />
    </Page>
  )
}
