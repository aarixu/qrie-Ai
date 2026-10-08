import { useEffect, useId, useRef, useState } from 'react'
import { Info } from 'lucide-react'

/** Where a chapter's word changes (standingOf, features/standing.ts): Strong from STRONG up, Needs practice under GETTING_THERE. */
export const STRONG = 0.7
export const GETTING_THERE = 0.4
/** Below this many answers given alone in a chapter, its word is "Just started" (or "with help"), whatever the model believes. */
export const FEW_ANSWERS = 3

const pct = (x: number) => `${Math.round(x * 100)}%`

/**
 * "What do these mean?" beside the words a child's chapters are shown by
 * (standingOf, features/standing.ts): a few sentences in their words. Like
 * the report card's footnote (packages/lms-report, card.ts) it says the
 * standing is the learning model's, from the answers they give in the app,
 * and not a mark — a teacher's mark never reaches the ledger the model reads.
 * It opens under the button and closes on a tap outside or Escape.
 */
export function MasteryInfo() {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const outside = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <span ref={box} className='relative inline-flex'>
      <button
        type='button'
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className='inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium normal-case tracking-normal text-muted-foreground active:opacity-70'
      >
        <Info className='size-3.5' /> What do these mean?
      </button>
      {open && (
        <span
          id={id}
          role='note'
          className='absolute top-full right-0 z-30 mt-2 block w-72 max-w-[calc(100vw-2rem)] space-y-2 rounded-xl border bg-popover p-3 text-left text-sm font-normal normal-case tracking-normal text-popover-foreground shadow-lg'
        >
          <span className='block'>
            How sure Qrie is that you can do each chapter on your own. Qrie’s learning model works it out from every
            answer you give in the app — homework, tests and practice.
          </span>
          <span className='block'>
            A right answer moves it up, a wrong one moves it down. It is not a mark: your teacher’s marks do not
            change it.
          </span>
          <span className='block'>An answer you give after a hint counts as with help, not as on your own.</span>
          <span className='block text-muted-foreground'>
            Strong: {pct(STRONG)} or more on your own. Getting there (with help): {pct(STRONG)} or more with hints,
            not yet on your own. Getting there: {Math.round(GETTING_THERE * 100)}–{pct(STRONG)}. Needs practice: under{' '}
            {pct(GETTING_THERE)}. Just started: fewer than {FEW_ANSWERS} answers on your own in that chapter so far.
          </span>
        </span>
      )}
    </span>
  )
}
