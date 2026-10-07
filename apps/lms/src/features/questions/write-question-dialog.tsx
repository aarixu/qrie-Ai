import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { letter } from './question-view'
import { TopicFilter } from './topic-filter'

export type WrittenItem = {
  id: string
  stem: string
  options: string[]
  correctIndex: number
}

type WriteQuestionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  grade: number
  subject: string
  /** Where to file it to begin with; the teacher can change it. */
  chapter?: string
  outcome?: string
  /** Called with the new question once it is saved (and so approved). */
  onWritten?: (item: WrittenItem) => void
}

/**
 * A teacher's own multiple-choice question, for their school only. It is
 * approved as it is written (0023), so it can go on homework at once.
 */
export function WriteQuestionDialog({
  open,
  onOpenChange,
  grade,
  subject,
  chapter,
  outcome,
  onWritten,
}: WriteQuestionDialogProps) {
  const queryClient = useQueryClient()
  const [stem, setStem] = useState('')
  const [place, setPlace] = useState<{ chapter: string | undefined; outcome: string | undefined }>({
    chapter,
    outcome,
  })
  const [options, setOptions] = useState(['', '', '', ''])
  const [correct, setCorrect] = useState<number | null>(null)

  const filled = options.map((o) => o.trim())
  const problem = !stem.trim()
    ? 'Write the question.'
    : filled.some((o) => !o)
      ? 'Fill in every option, or remove the empty ones.'
      : new Set(filled).size !== filled.length
        ? 'Two options are the same.'
        : correct === null
          ? 'Choose which option is correct.'
          : null

  const save = useMutation({
    mutationFn: () =>
      api.writeItem({
        grade,
        subject,
        outcomeId: place.outcome,
        stem: stem.trim(),
        options: filled,
        correctIndex: correct!,
      }),
    onSuccess: (id) => {
      const written = { id, stem: stem.trim(), options: filled, correctIndex: correct! }
      toast.success('Question saved to your school’s bank.')
      queryClient.invalidateQueries({ queryKey: ['library'] })
      setStem('')
      setOptions(['', '', '', ''])
      setCorrect(null)
      onOpenChange(false)
      onWritten?.(written)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Write a question</DialogTitle>
          <DialogDescription>
            Class {grade} {subject}. Only teachers at your school will see it.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-4'>
          <div className='space-y-1.5'>
            <Label>Topic</Label>
            <div className='flex flex-wrap gap-2'>
              <TopicFilter
                mode='choose'
                grade={grade}
                subject={subject}
                chapter={place.chapter}
                outcome={place.outcome}
                onChange={setPlace}
              />
            </div>
            <p className='text-xs text-muted-foreground'>
              Filed under a topic, it can be found by chapter, and your students’ answers to it count towards what Qrie learns
              about them.
            </p>
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='stem'>Question</Label>
            <Textarea
              id='stem'
              value={stem}
              maxLength={2000}
              onChange={(e) => setStem(e.target.value)}
            />
          </div>
          <div className='space-y-2'>
            <Label>Options — choose the correct one</Label>
            <RadioGroup
              value={correct === null ? '' : String(correct)}
              onValueChange={(v) => setCorrect(Number(v))}
            >
              {options.map((o, i) => (
                <div key={i} className='flex items-center gap-2'>
                  <RadioGroupItem value={String(i)} id={`opt-${i}`} aria-label={`Option ${letter(i)} is correct`} />
                  <span className='w-4 font-mono text-sm text-muted-foreground'>{letter(i)}</span>
                  <Input
                    value={o}
                    maxLength={300}
                    onChange={(e) =>
                      setOptions(options.map((x, j) => (j === i ? e.target.value : x)))
                    }
                  />
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    disabled={options.length <= 2}
                    aria-label={`Remove option ${letter(i)}`}
                    onClick={() => {
                      setOptions(options.filter((_, j) => j !== i))
                      setCorrect(correct === i ? null : correct !== null && correct > i ? correct - 1 : correct)
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </RadioGroup>
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={options.length >= 6}
              onClick={() => setOptions([...options, ''])}
            >
              <Plus /> Add an option
            </Button>
          </div>
        </div>
        <DialogFooter className='items-center gap-2'>
          {problem && <p className='me-auto text-sm text-muted-foreground'>{problem}</p>}
          <Button
            disabled={!!problem || save.isPending}
            onClick={() => save.mutate()}
          >
            Save question
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
