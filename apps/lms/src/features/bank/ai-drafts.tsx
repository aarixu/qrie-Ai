import { useState } from 'react'
import { draftQuestions, friendlyError, type ItemDraft } from '@ai-tutor/lms-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { api, backend } from '@/lib/backend'
import { chapterTitle } from '@/lib/curriculum'
import { Badge } from '@/components/ui/badge'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { letter, QuestionView } from '@/features/questions/question-view'
import { TopicFilter, useTopics } from '@/features/questions/topic-filter'

const DRAFTS = ['item-drafts'] as const

type DraftWithAiProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  grade: number
  subject: string
  chapter?: string
  outcome?: string
}

/**
 * Asks the AI for questions on one topic (lms-client draftQuestions). They
 * come back as drafts in the teacher's own queue, never straight into the
 * bank: the teacher checks and adds each one (lms.item_draft, 0043).
 */
export function DraftWithAiDialog({ open, onOpenChange, grade, subject, chapter, outcome }: DraftWithAiProps) {
  const queryClient = useQueryClient()
  const topics = useTopics(grade, subject)
  const [place, setPlace] = useState<{ chapter: string | undefined; outcome: string | undefined }>({ chapter, outcome })
  const [count, setCount] = useState('5')
  const [note, setNote] = useState('')
  const topic = (topics.data ?? []).find((t) => t.outcomeId === place.outcome)

  const draft = useMutation({
    mutationFn: () =>
      draftQuestions(backend, {
        grade,
        subject,
        chapter: chapterTitle(topic!.chapter),
        topic: topic!.title,
        outcomeId: topic!.outcomeId,
        count: Number(count),
        note: note.trim() || null,
      }),
    onSuccess: ({ kept, rejected }) => {
      const waiting = `${kept} ${kept === 1 ? 'draft is' : 'drafts are'} waiting for you to check.`
      const dropped = rejected
        ? ` ${rejected} the AI wrote ${rejected === 1 ? 'was' : 'were'} not usable and ${rejected === 1 ? 'was' : 'were'} left out.`
        : ''
      toast.success(waiting + dropped)
      queryClient.invalidateQueries({ queryKey: DRAFTS })
      setNote('')
      onOpenChange(false)
    },
    onError: (e) => toast.error(friendlyError(e)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Draft questions with AI</DialogTitle>
          <DialogDescription>
            Class {grade} {subject}. AI can be wrong: its questions wait for you, and no student sees one until you
            check it and add it.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-4'>
          <div className='space-y-1.5'>
            <Label>Topic</Label>
            <div className='flex flex-wrap gap-2'>
              <TopicFilter mode='choose' grade={grade} subject={subject} chapter={place.chapter} outcome={place.outcome} onChange={setPlace} />
            </div>
            <p className='text-xs text-muted-foreground'>
              The questions are filed under this topic, so your students’ answers count towards what Qrie learns about them.
            </p>
          </div>
          <div className='space-y-1.5'>
            <Label>How many</Label>
            <Select value={count} onValueChange={setCount}>
              <SelectTrigger className='w-32' aria-label='How many questions'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['3', '5', '10'].map((n) => (
                  <SelectItem key={n} value={n}>
                    {n} questions
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='ai-note'>Anything to tell the AI (optional)</Label>
            <Textarea
              id='ai-note'
              value={note}
              maxLength={300}
              placeholder='For example: word problems about a school canteen.'
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className='items-center gap-2'>
          {!topic && <p className='me-auto text-sm text-muted-foreground'>Choose a topic.</p>}
          <Button disabled={!topic || draft.isPending} onClick={() => draft.mutate()}>
            <Sparkles /> {draft.isPending ? 'Drafting…' : `Draft ${count} questions`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The mistakes a draft's wrong options catch, as "B — Thinks …". */
function Mistakes({ d }: { d: { options: string[]; correctIndex: number; misconceptions: string[] | null } }) {
  const shown = (d.misconceptions ?? []).map((m, i) => ({ m, i })).filter(({ m, i }) => m && i !== d.correctIndex)
  if (!shown.length) return null
  return (
    <div className='space-y-0.5 text-xs text-muted-foreground'>
      <p className='font-medium'>The mistake each wrong option catches</p>
      {shown.map(({ m, i }) => (
        <p key={i}>
          <span className='font-mono'>{letter(i)}</span> — {m}
        </p>
      ))}
    </div>
  )
}

/** The caller's drafts, newest first, each to add as it is, edit and add, or discard. */
export function DraftQueue() {
  const queryClient = useQueryClient()
  const drafts = useQuery({ queryKey: DRAFTS, queryFn: api.myItemDrafts })
  const [editing, setEditing] = useState<ItemDraft | null>(null)
  const done = (message: string) => {
    toast.success(message)
    queryClient.invalidateQueries({ queryKey: DRAFTS })
    queryClient.invalidateQueries({ queryKey: ['library'] })
  }
  const add = useMutation({
    mutationFn: (d: ItemDraft) => api.acceptItemDraft(d.draftId, { stem: d.stem, options: d.options, correctIndex: d.correctIndex }),
    onSuccess: () => done('Added to your school’s bank.'),
    onError: (e) => toast.error(friendlyError(e)),
  })
  const discard = useMutation({
    mutationFn: (d: ItemDraft) => api.discardItemDraft(d.draftId),
    onSuccess: () => done('Draft discarded.'),
    onError: (e) => toast.error(friendlyError(e)),
  })
  if (!drafts.data?.length) return null
  const busy = add.isPending || discard.isPending

  return (
    <Card className='mb-6'>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <Sparkles className='size-5' /> Drafts waiting for you ({drafts.data.length})
        </CardTitle>
        <CardDescription>
          Written by AI. Check the answer and every word before adding a question; only then can it be set.
        </CardDescription>
      </CardHeader>
      <CardContent className='grid gap-3 lg:grid-cols-2'>
        {drafts.data.map((d) => (
          <div key={d.draftId} className='space-y-3 rounded-lg border p-4'>
            <div className='flex flex-wrap items-center gap-1'>
              <Badge variant='outline'>AI draft</Badge>
              <span className='text-xs text-muted-foreground'>
                Class {d.grade} {d.subject}
                {d.chapter && ` · ${chapterTitle(d.chapter)}`}
                {d.topic && ` › ${d.topic}`}
              </span>
            </div>
            <QuestionView stem={d.stem} options={d.options} correctIndex={d.correctIndex} />
            <Mistakes d={d} />
            <div className='flex flex-wrap gap-2'>
              <Button size='sm' disabled={busy} onClick={() => add.mutate(d)}>
                Add
              </Button>
              <Button size='sm' variant='outline' disabled={busy} onClick={() => setEditing(d)}>
                Edit and add
              </Button>
              <Button size='sm' variant='ghost' disabled={busy} onClick={() => discard.mutate(d)}>
                Discard
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
      {editing && <EditDraftDialog key={editing.draftId} draft={editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}

/** A draft's question, options, answer and mistakes, edited, then added. */
function EditDraftDialog({ draft, onClose }: { draft: ItemDraft; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [stem, setStem] = useState(draft.stem)
  const [options, setOptions] = useState(draft.options)
  const [labels, setLabels] = useState(draft.misconceptions ?? draft.options.map(() => ''))
  const [correct, setCorrect] = useState(draft.correctIndex)
  const filled = options.map((o) => o.trim())
  const problem = !stem.trim()
    ? 'Write the question.'
    : filled.some((o) => !o)
      ? 'Fill in every option.'
      : new Set(filled.map((o) => o.toLowerCase())).size !== filled.length
        ? 'Two options are the same.'
        : null
  const save = useMutation({
    mutationFn: () =>
      api.acceptItemDraft(draft.draftId, {
        stem: stem.trim(),
        options: filled,
        correctIndex: correct,
        misconceptions: labels.map((l, i) => (i === correct ? '' : l.trim())),
      }),
    onSuccess: () => {
      toast.success('Added to your school’s bank.')
      queryClient.invalidateQueries({ queryKey: DRAFTS })
      queryClient.invalidateQueries({ queryKey: ['library'] })
      onClose()
    },
    onError: (e) => toast.error(friendlyError(e)),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Check and add</DialogTitle>
          <DialogDescription>
            Class {draft.grade} {draft.subject}
            {draft.topic && ` · ${draft.topic}`}. Once added, it is your question, and it can be set.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-4'>
          <div className='space-y-1.5'>
            <Label htmlFor='draft-stem'>Question</Label>
            <Textarea id='draft-stem' value={stem} maxLength={2000} onChange={(e) => setStem(e.target.value)} />
          </div>
          <div className='space-y-2'>
            <Label>Options — choose the correct one</Label>
            <RadioGroup value={String(correct)} onValueChange={(v) => setCorrect(Number(v))}>
              {options.map((o, i) => (
                <div key={i} className='space-y-1'>
                  <div className='flex items-center gap-2'>
                    <RadioGroupItem value={String(i)} id={`draft-opt-${i}`} aria-label={`Option ${letter(i)} is correct`} />
                    <span className='w-4 font-mono text-sm text-muted-foreground'>{letter(i)}</span>
                    <Input
                      value={o}
                      maxLength={200}
                      aria-label={`Option ${letter(i)}`}
                      onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))}
                    />
                  </div>
                  {i !== correct && (
                    <Input
                      className='ms-10 h-8 w-[calc(100%-2.5rem)] text-xs'
                      value={labels[i] ?? ''}
                      maxLength={120}
                      placeholder='The mistake this option catches (optional)'
                      aria-label={`The mistake option ${letter(i)} catches`}
                      onChange={(e) => setLabels(labels.map((x, j) => (j === i ? e.target.value : x)))}
                    />
                  )}
                </div>
              ))}
            </RadioGroup>
          </div>
        </div>
        <DialogFooter className='items-center gap-2'>
          {problem && <p className='me-auto text-sm text-muted-foreground'>{problem}</p>}
          <Button disabled={!!problem || save.isPending} onClick={() => save.mutate()}>
            Add to my questions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
