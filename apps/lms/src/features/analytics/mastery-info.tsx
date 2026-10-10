import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { GETTING_THERE, SECURE, band, pct } from './charts'

/**
 * "What is mastery?": the small (i) beside every Mastery label, opening the
 * same few sentences wherever it is. They say only what the brain does:
 * packages/lms-brain folds the ledger, and the ledger holds the answers
 * students give in the app — a teacher's mark, a test on paper, photos and
 * ticks never reach it. Every Mastery figure in this app is the one from
 * answers given on their own (lms.* unassisted_mastery, 0105); "with help"
 * beside it is assisted_performance.
 */
export function MasteryInfo({ className }: { className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type='button'
          aria-label='What is mastery?'
          title='What is mastery?'
          className={cn(
            'inline-flex size-5 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            className
          )}
        >
          <Info className='size-3.5' />
        </button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-80 max-w-[calc(100vw-2rem)] space-y-2 text-sm leading-relaxed font-normal'>
        <p className='font-semibold'>What is mastery?</p>
        <p>
          Qrie’s learning model’s estimate of how well a student can do each topic on their own, worked out from
          every answer they give in the app — homework, tests and practice. It is not a mark.
        </p>
        <p>
          On their own counts only answers given without a hint. With help, shown beside it where there is any, is
          how they do after hints. High with help and low on their own means they can follow it, not yet do it alone.
        </p>
        <p>
          A right answer raises it and a wrong one lowers it, for the topic the question checks and for topics
          linked to it in the syllabus. Marks teachers give, tests on paper, photos of notebook work and ticked
          tasks do not change it.
        </p>
        <p className='text-muted-foreground'>
          {band(SECURE).label} is {pct(SECURE)} or more, {band(GETTING_THERE).label} {Math.round(GETTING_THERE * 100)}–
          {pct(SECURE)}, {band(0).label} under {pct(GETTING_THERE)}. For a subject, a class or the school it is
          the average of these estimates over the topics answered on their own.
        </p>
      </PopoverContent>
    </Popover>
  )
}
