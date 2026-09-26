import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { MyAssignment } from '@ai-tutor/lms-client'
import { api, say } from '@/lib/backend'
import { cn } from '@/lib/utils'
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
import { Button } from '@/components/ui/button'

const LETTERS = 'ABCDEF'

// Answers so far, kept on this phone so a dropped connection or a closed
// tab does not lose them. Only the chosen option numbers; never sent anywhere
// until the child hands in.
const draftKey = (id: string) => `qrie-answers-${id}`
function loadDraft(id: string): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(draftKey(id)) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}
function saveDraft(id: string, answers: Record<string, number> | null) {
  try {
    if (answers) localStorage.setItem(draftKey(id), JSON.stringify(answers))
    else localStorage.removeItem(draftKey(id))
  } catch {
    /* this phone keeps nothing; the answers live only on screen */
  }
}

/** One question to a screen, big buttons, then a check before handing in. */
export function Quiz({ a, onDone, onCancel }: { a: MyAssignment; onDone: () => void; onCancel: () => void }) {
  const queryClient = useQueryClient()
  const questions = useQuery({
    queryKey: ['questions', a.id],
    queryFn: () => api.assignmentQuestions(a.id),
  })
  const [at, setAt] = useState(0)
  const [answers, setAnswers] = useState<Record<string, number>>(() => loadDraft(a.id))
  const [checking, setChecking] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => saveDraft(a.id, answers), [a.id, answers])

  if (questions.isPending) return <p className='text-muted-foreground'>Loading the questions…</p>
  if (questions.isError) return <p className='text-destructive'>{say(questions.error)}</p>
  const qs = questions.data.filter((q) => q.kind === 'mcq' && q.options)
  if (qs.length === 0) {
    return (
      <div className='space-y-3'>
        <p>This homework has no questions to answer here.</p>
        <Button variant='outline' onClick={onCancel}>Back</Button>
      </div>
    )
  }
  const unanswered = qs.filter((q) => answers[q.itemId] === undefined).length

  async function handIn() {
    setBusy(true)
    try {
      const r = await api.submitMcq(a.id, answers)
      saveDraft(a.id, null)
      await queryClient.invalidateQueries({ queryKey: ['my-assignments'] })
      await queryClient.invalidateQueries({ queryKey: ['review', a.id] })
      toast.success(`Handed in! You got ${r.correct} out of ${r.total}.`)
      onDone()
    } catch (e) {
      toast.error(say(e))
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }

  if (checking) {
    return (
      <div className='space-y-4'>
        <h1 className='text-xl font-bold'>Check before you hand in</h1>
        <div className='grid grid-cols-5 gap-2'>
          {qs.map((q, i) => (
            <button
              key={q.itemId}
              type='button'
              className={cn(
                'rounded-lg border py-3 text-center font-medium',
                answers[q.itemId] === undefined ? 'border-orange-500 text-orange-600' : 'bg-primary/10'
              )}
              onClick={() => {
                setAt(i)
                setChecking(false)
              }}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <p className='text-sm text-muted-foreground'>
          {unanswered === 0
            ? 'You have answered every question.'
            : `${unanswered} not answered yet — tap a number to go back to it.`}
        </p>
        <Button className='h-12 w-full text-base' disabled={busy} onClick={() => setConfirm(true)}>
          Hand in
        </Button>
        <Button variant='ghost' className='w-full' onClick={() => setChecking(false)}>
          Back to the questions
        </Button>
        <AlertDialog open={confirm} onOpenChange={setConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Hand in now?</AlertDialogTitle>
              <AlertDialogDescription>
                {unanswered > 0
                  ? `${unanswered} ${unanswered === 1 ? 'question is' : 'questions are'} not answered and will count as wrong.`
                  : 'You cannot change your answers after this.'}
                {a.attemptsAllowed - a.mcqAttemptsUsed <= 1 && ' This is your last try.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Not yet</AlertDialogCancel>
              <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void handIn() }}>
                Hand in
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    )
  }

  const q = qs[at]
  const chosen = answers[q.itemId]
  return (
    <div className='flex min-h-[70svh] flex-col'>
      <div className='mb-3 flex items-center justify-between text-sm text-muted-foreground'>
        <span>
          Question {at + 1} of {qs.length}
        </span>
        <button type='button' className='underline' onClick={onCancel}>
          Save and leave
        </button>
      </div>
      <div className='mb-4 h-1.5 overflow-hidden rounded-full bg-muted'>
        <div className='h-full bg-primary transition-all' style={{ width: `${((at + 1) / qs.length) * 100}%` }} />
      </div>
      <p className='mb-5 text-lg font-medium whitespace-pre-wrap'>{q.stem}</p>
      <div className='space-y-3' role='radiogroup' aria-label={`Question ${at + 1}`}>
        {q.options!.map((opt, i) => (
          <button
            key={i}
            type='button'
            role='radio'
            aria-checked={chosen === i}
            className={cn(
              'flex w-full items-start gap-3 rounded-xl border-2 p-4 text-start transition-colors',
              chosen === i ? 'border-primary bg-primary/10' : 'border-border active:bg-accent'
            )}
            onClick={() => setAnswers({ ...answers, [q.itemId]: i })}
          >
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold',
                chosen === i && 'border-primary bg-primary text-primary-foreground'
              )}
            >
              {LETTERS[i]}
            </span>
            <span className='pt-0.5'>{opt}</span>
          </button>
        ))}
      </div>
      <div className='mt-auto flex gap-3 pt-6'>
        <Button variant='outline' className='h-12 flex-1' disabled={at === 0} onClick={() => setAt(at - 1)}>
          Back
        </Button>
        {at < qs.length - 1 ? (
          <Button className='h-12 flex-1' onClick={() => setAt(at + 1)}>
            Next
          </Button>
        ) : (
          <Button className='h-12 flex-1' onClick={() => setChecking(true)}>
            Check and hand in
          </Button>
        )}
      </div>
    </div>
  )
}
