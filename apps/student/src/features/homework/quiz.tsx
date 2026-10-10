import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { isOffline, newKey, type MyAssignment } from '@ai-tutor/lms-client'
import { api, say } from '@/lib/backend'
import { useAuthStore } from '@/stores/auth-store'
// Relative: the tests' `@` is the teacher app's, which has no such file.
import { useOutbox } from '../../lib/outbox'
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
// until the child hands in. Kept per child, as the outbox is: on a shared
// phone the next child to open the quiz starts with nothing picked.
const draftKey = (who: string, id: string) => `qrie-answers-${who}-${id}`
function loadDraft(who: string, id: string): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(draftKey(who, id)) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}
function saveDraft(who: string, id: string, answers: Record<string, number> | null) {
  try {
    if (answers) localStorage.setItem(draftKey(who, id), JSON.stringify(answers))
    else localStorage.removeItem(draftKey(who, id))
  } catch {
    /* this phone keeps nothing; the answers live only on screen */
  }
}

// The key this hand-in is sent under (0044), kept on the phone (per child)
// until it is handed in, so sending it again — after a reload too — is the
// same hand-in.
const keyKey = (who: string, id: string) => `qrie-hand-in-key-${who}-${id}`
function handInKey(who: string, id: string): string {
  try {
    const kept = localStorage.getItem(keyKey(who, id))
    if (kept) return kept
    const made = newKey()
    localStorage.setItem(keyKey(who, id), made)
    return made
  } catch {
    return newKey()
  }
}
function forgetKey(who: string, id: string) {
  try {
    localStorage.removeItem(keyKey(who, id))
  } catch {
    /* nothing was kept */
  }
}

/** One question to a screen, big buttons, then a check before handing in. */
export function Quiz({
  a,
  endsAt,
  onDone,
  onCancel,
}: {
  a: MyAssignment
  /** A test's end, from the server's clock (lms.start_test); the quiz hands itself in then. */
  endsAt?: string
  onDone: () => void
  onCancel: () => void
}) {
  const queryClient = useQueryClient()
  // The quiz is only ever open for a signed-in child.
  const who = useAuthStore((s) => s.me?.userId) ?? 'nobody'
  const questions = useQuery({
    queryKey: ['questions', a.id],
    queryFn: () => api.assignmentQuestions(a.id),
  })
  const [at, setAt] = useState(0)
  const [answers, setAnswers] = useState<Record<string, number>>(() => loadDraft(who, a.id))
  const [checking, setChecking] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  // A test saves each answer to the school's server as it is tapped (0030),
  // so the server can hand in what was saved if the phone drops off.
  const isTest = a.kind === 'test'
  const { box } = useOutbox()
  // What happened to the last answer saved: null when the school has it.
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  const saved = useQuery({
    queryKey: ['saved-answers', a.id],
    queryFn: () => api.mySavedAnswers(a.id),
    enabled: isTest,
  })
  const merged = useRef(false)
  useEffect(() => {
    if (!saved.data || merged.current) return
    merged.current = true
    const fromServer = Object.fromEntries(saved.data.map((r) => [r.itemId, r.chosenIndex]))
    setAnswers((mine) => ({ ...fromServer, ...mine }))
  }, [saved.data])
  const choose = (itemId: string, index: number) => {
    setAnswers((mine) => ({ ...mine, [itemId]: index }))
    if (!isTest) return
    api.saveTestAnswer(a.id, itemId, index).then(
      () => setNote(null),
      async (e) => {
        if (isOffline(e) && box) {
          await box.add({ kind: 'answer', assignmentId: a.id, itemId, chosen: index })
          setNote({ text: 'Kept on this phone; it goes to your school when the internet is back', bad: false })
        } else {
          setNote({ text: `Not saved: ${say(e)}`, bad: true })
        }
      }
    )
  }

  useEffect(() => saveDraft(who, a.id, answers), [who, a.id, answers])

  // The countdown. The server enforces the limit; this only shows it, and
  // hands in whatever is answered when it runs out.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!endsAt) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [endsAt])
  const left = endsAt ? new Date(endsAt).getTime() - now : null
  const handedIn = useRef(false)

  async function handIn() {
    if (handedIn.current) return
    handedIn.current = true
    setBusy(true)
    const key = handInKey(who, a.id)
    try {
      const r = await api.submitMcq(a.id, answers, key)
      saveDraft(who, a.id, null)
      forgetKey(who, a.id)
      await queryClient.invalidateQueries({ queryKey: ['my-assignments'] })
      await queryClient.invalidateQueries({ queryKey: ['review', a.id] })
      await queryClient.invalidateQueries({ queryKey: ['my-progress'] })
      toast.success(
        r.correct === null
          ? 'Handed in! Your teacher will share the results.'
          : `Handed in! You got ${r.correct} out of ${r.total}.`
      )
      onDone()
    } catch (e) {
      if (isOffline(e) && box) {
        // No internet: the hand-in waits on the phone, under its key, and goes
        // by itself when the internet is back (components/outbox-banner.tsx).
        await box.add({ kind: 'mcq', assignmentId: a.id, title: a.title, answers, key })
        saveDraft(who, a.id, null)
        forgetKey(who, a.id)
        toast.info('No internet. Your answers are kept on this phone and will be handed in when it is back.')
        onDone()
        return
      }
      handedIn.current = false
      toast.error(say(e))
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }

  // Time up: hand in whatever is answered. A failure (offline) leaves the
  // answers saved on the phone and the button to try again.
  const autoTried = useRef(false)
  useEffect(() => {
    if (left !== null && left <= 0 && !autoTried.current) {
      autoTried.current = true
      void handIn()
    }
  })

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
      <div className='mb-3 space-y-1 text-sm text-muted-foreground'>
        <div className='flex items-center justify-between gap-2'>
          <span>
            Question {at + 1} of {qs.length}
          </span>
          {left !== null && <Countdown ms={left} />}
        </div>
        <div className='flex items-center justify-between gap-2 text-xs'>
          {isTest ? (
            <span className={cn(note?.bad ? 'text-destructive' : 'text-muted-foreground')}>
              {note ? note.text : 'Answers saved'}
            </span>
          ) : (
            <span />
          )}
          <button type='button' className='underline' onClick={onCancel}>
            {endsAt ? 'Leave (the clock keeps running)' : 'Save and leave'}
          </button>
        </div>
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
            onClick={() => choose(q.itemId, i)}
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

function Countdown({ ms }: { ms: number }) {
  const secs = Math.max(0, Math.floor(ms / 1000))
  const text = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
  return (
    <span
      role='timer'
      aria-label={`${text} left`}
      className={cn('rounded-full px-2 py-0.5 font-mono tabular-nums', secs < 60 ? 'bg-red-600 text-white' : 'bg-muted')}
    >
      {text}
    </span>
  )
}
