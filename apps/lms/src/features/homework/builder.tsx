import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { addDays, format, set } from 'date-fns'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { AnswerType } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Loading, Page, Problem } from '@/components/layout/page'
import { className } from '@/features/dashboard'
import { QuestionPicker, type PickedItem } from '@/features/questions/question-picker'
import { QuestionView } from '@/features/questions/question-view'

type BuilderProps =
  | { mode: 'new'; sectionId: string; subjectId: string }
  | { mode: 'edit'; assignmentId: string }

const LOCAL = "yyyy-MM-dd'T'HH:mm"

/** New homework, or a draft being finished. Published homework is changed from its own page. */
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
  const classes = useQuery({ queryKey: ['classes'], queryFn: api.myClasses })

  const sectionId = props.mode === 'new' ? props.sectionId : overview.data?.sectionId
  const subjectId = props.mode === 'new' ? props.subjectId : overview.data?.subjectId
  const c = classes.data?.find((x) => x.sectionId === sectionId && x.subjectId === subjectId)

  if (classes.isPending || (editing && (overview.isPending || items.isPending))) {
    return <Page title='Homework'><Loading what='the homework' /></Page>
  }
  const failed = classes.error ?? overview.error ?? items.error
  if (failed) return <Page title='Homework'><Problem error={failed} /></Page>
  if (editing && overview.data?.published) {
    return (
      <Page title='Homework'>
        <p className='text-muted-foreground'>This homework is published; change it from its own page.</p>
      </Page>
    )
  }
  if (!c) return <Page title='Homework'><p className='text-muted-foreground'>This is not one of your classes.</p></Page>

  return (
    <Form
      key={editing ?? 'new'}
      assignmentId={editing}
      cls={c}
      initial={
        overview.data
          ? {
              title: overview.data.title,
              instructions: overview.data.instructions ?? '',
              due: format(new Date(overview.data.dueAt), LOCAL),
              answerTypes: overview.data.answerTypes,
              attempts: overview.data.attemptsAllowed,
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
  answerTypes: AnswerType[]
  attempts: number
  items: PickedItem[]
}

type FormProps = {
  assignmentId: string | null
  cls: { sectionId: string; subjectId: string; grade: number; sectionName: string; subjectName: string }
  initial?: Initial
}

function Form({ assignmentId, cls, initial }: FormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [instructions, setInstructions] = useState(initial?.instructions ?? '')
  const [due, setDue] = useState(
    initial?.due ?? format(set(addDays(new Date(), 1), { hours: 20, minutes: 0 }), LOCAL)
  )
  const [types, setTypes] = useState<AnswerType[]>(initial?.answerTypes ?? ['mcq'])
  const [attempts, setAttempts] = useState(initial?.attempts ?? 1)
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
  const mcq = types.includes('mcq')
  const dueDate = new Date(due)
  const draftProblem = !title.trim()
    ? 'Give the homework a title.'
    : Number.isNaN(dueDate.getTime())
      ? 'Choose a due date.'
      : types.length === 0
        ? 'Choose how students answer.'
        : null
  const publishProblem =
    draftProblem ??
    (dueDate <= new Date()
      ? 'The due date has passed; choose a later one to publish.'
      : mcq && items.length === 0
        ? 'Add at least one question to publish.'
        : null)

  async function save(publish: boolean) {
    setBusy(true)
    setProblem(null)
    try {
      let id = assignmentId
      if (id === null) {
        id = await api.createAssignment({
          sectionId: cls.sectionId,
          subjectId: cls.subjectId,
          kind: 'homework',
          title: title.trim(),
          instructions: instructions.trim() || undefined,
          dueAt: dueDate.toISOString(),
          answerTypes: types,
          attemptsAllowed: attempts,
        })
      } else {
        await api.updateAssignment(id, {
          title: title.trim(),
          instructions: instructions.trim(),
          dueAt: dueDate.toISOString(),
          attemptsAllowed: attempts,
        })
      }
      if (mcq) await api.setAssignmentItems(id, items.map((i) => i.id))
      if (publish) await api.publishAssignment(id)
      setDirty(false)
      await queryClient.invalidateQueries({ queryKey: ['class-assignments', cls.sectionId, cls.subjectId] })
      await queryClient.invalidateQueries({ queryKey: ['overview', id] })
      await queryClient.invalidateQueries({ queryKey: ['assignment-items', id] })
      if (publish) {
        toast.success(`Published to ${className(cls)}.`)
        navigate({ to: '/homework/$assignmentId', params: { assignmentId: id } })
      } else {
        toast.success('Draft saved. Students cannot see it until you publish.')
        if (assignmentId === null) {
          navigate({ to: '/homework/$assignmentId/edit', params: { assignmentId: id }, replace: true })
        }
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
      title={assignmentId ? 'Finish this draft' : 'New homework'}
      description={`${className(cls)} · ${cls.subjectName}`}
      back={{ label: 'Back to the class', to: '/classes/$sectionId/$subjectId', params: { sectionId: cls.sectionId, subjectId: cls.subjectId } }}
      actions={
        <>
          {assignmentId !== null && (
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
      <div className='grid gap-6 lg:grid-cols-[1fr_1.4fr]'>
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='space-y-1.5'>
              <Label htmlFor='title'>Title</Label>
              <Input id='title' maxLength={200} value={title} onChange={(e) => touch(setTitle)(e.target.value)} />
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
            <div className='space-y-1.5'>
              <Label htmlFor='due'>Due</Label>
              <Input id='due' type='datetime-local' value={due} onChange={(e) => touch(setDue)(e.target.value)} />
            </div>
            <fieldset className='space-y-2' disabled={assignmentId !== null}>
              <legend className='text-sm font-medium'>How students answer</legend>
              {(
                [
                  ['mcq', 'Multiple-choice questions, marked automatically'],
                  ['photo', 'A photo of their notebook work, marked by you'],
                ] as const
              ).map(([t, label]) => (
                <label key={t} className='flex items-center gap-2 text-sm'>
                  <Checkbox
                    checked={types.includes(t)}
                    onCheckedChange={(on) =>
                      touch(setTypes)(on ? [...types, t] : types.filter((x) => x !== t))
                    }
                  />
                  {label}
                </label>
              ))}
              {assignmentId !== null && (
                <p className='text-xs text-muted-foreground'>Fixed when the draft was first saved.</p>
              )}
            </fieldset>
            <div className='space-y-1.5'>
              <Label>Attempts allowed</Label>
              <Select value={String(attempts)} onValueChange={(v) => touch(setAttempts)(Number(v))}>
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
            {(publishProblem || problem != null) && (
              <div className='text-sm'>
                {problem != null ? <Problem error={problem} /> : <p className='text-muted-foreground'>{publishProblem}</p>}
              </div>
            )}
          </CardContent>
        </Card>

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
          mcq
            ? 'Students will see it straight away. Its questions cannot be changed after that; the title, instructions and due date can.'
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
