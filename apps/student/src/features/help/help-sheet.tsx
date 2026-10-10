import { useEffect, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { Phone } from 'lucide-react'
import type { ProblemKind, ProblemReport } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import { failureText, HELPLINE_LINES, MAX_NOTE, NOT_SENT, prepareReport, REASONS } from '@/lib/report'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

type Outcome =
  | { state: 'idle' }
  | { state: 'sending' }
  | { state: 'sent'; why: 'support' | 'redirect' | null }
  | { state: 'failed'; message: string }

/** 'android' inside the Android app (Capacitor), else 'web'. */
const platform = (): 'web' | 'android' =>
  (globalThis as { Capacitor?: { isNativePlatform?(): boolean } }).Capacitor?.isNativePlatform?.() ? 'android' : 'web'

/**
 * HELP: the helplines first, always; then, for a student, a report to the
 * people who look after the app. The note lives only in this sheet's state:
 * it is cleared when the sheet closes and is never written to the phone. A
 * report is stamped once when Send is pressed, so Try again (offered when it
 * did not reach the server's own checks) sends the same report, which the
 * server answers as the same one.
 */
export function HelpSheet({ open, onOpenChange, canReport }: { open: boolean; onOpenChange(open: boolean): void; canReport: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [reason, setReason] = useState<ProblemKind | null>(null)
  const [note, setNote] = useState('')
  const [pending, setPending] = useState<{ report: ProblemReport; why: 'support' | 'redirect' | null } | null>(null)
  const [outcome, setOutcome] = useState<Outcome>({ state: 'idle' })

  useEffect(() => {
    if (!open) {
      setReason(null)
      setNote('')
      setPending(null)
      setOutcome({ state: 'idle' })
    }
  }, [open])

  async function send(p: { report: ProblemReport; why: 'support' | 'redirect' | null }) {
    setPending(p)
    setOutcome({ state: 'sending' })
    try {
      await api.reportProblem(p.report)
      setOutcome({ state: 'sent', why: p.why })
    } catch (e) {
      setOutcome({ state: 'failed', message: failureText(e) })
    }
  }

  function sendNew() {
    if (!reason) return
    void send(
      prepareReport({
        reason,
        note,
        pathname,
        now: new Date(),
        release: (import.meta.env.VITE_RELEASE as string | undefined) ?? null,
        platform: platform(),
      }),
    )
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className='max-h-[90svh] overflow-y-auto'>
        <AlertDialogHeader>
          <AlertDialogTitle>Help</AlertDialogTitle>
          <AlertDialogDescription>If you need to talk to someone now, these numbers are free.</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className='space-y-2'>
          {HELPLINE_LINES.map((h) => (
            <li key={h.number}>
              <a href={`tel:${h.number}`} className='flex items-center gap-3 rounded-lg border p-3'>
                <Phone className='size-5 shrink-0 text-primary' />
                <span>
                  <span className='block font-semibold'>
                    {h.name} {h.number}
                  </span>
                  <span className='block text-sm text-muted-foreground'>{h.what}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
        {canReport && (
          <div className='space-y-3 border-t pt-3'>
            <h2 className='font-semibold'>Tell us about a problem</h2>
            {outcome.state === 'sent' ? (
              <div className='space-y-2 text-sm' role='status'>
                {outcome.why === 'support' && (
                  <p className='font-medium'>
                    Somebody reading this is not the same as somebody helping you. Please tell an adult you trust today.
                  </p>
                )}
                <p>Sent to the people who look after this app. Somebody will read it.</p>
              </div>
            ) : (
              <>
                <fieldset className='space-y-2' disabled={outcome.state === 'sending'}>
                  <legend className='sr-only'>What is it about?</legend>
                  {REASONS.map((r) => (
                    <label key={r.id} className='flex items-center gap-2 text-sm'>
                      <input type='radio' name='problem-reason' value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} />
                      {r.label}
                    </label>
                  ))}
                </fieldset>
                <div className='space-y-1'>
                  <Label htmlFor='problem-words'>Tell us more (you can leave this empty)</Label>
                  <textarea
                    id='problem-words'
                    value={note}
                    maxLength={MAX_NOTE}
                    rows={4}
                    disabled={outcome.state === 'sending'}
                    onChange={(e) => setNote(e.target.value)}
                    className='w-full rounded-md border bg-background p-2 text-sm'
                  />
                  <p className='text-xs text-muted-foreground'>Phone numbers and email addresses are taken out before it is sent.</p>
                </div>
                {outcome.state === 'failed' && (
                  <p role='alert' className='text-sm text-destructive'>
                    {outcome.message}
                  </p>
                )}
              </>
            )}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
          {canReport && outcome.state === 'failed' && outcome.message === NOT_SENT && pending && (
            <Button variant='outline' onClick={() => void send(pending)}>
              Try again
            </Button>
          )}
          {canReport && outcome.state !== 'sent' && outcome.state !== 'failed' && (
            <Button disabled={!reason || outcome.state === 'sending'} onClick={sendNew}>
              {outcome.state === 'sending' ? 'Sending…' : 'Send'}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
