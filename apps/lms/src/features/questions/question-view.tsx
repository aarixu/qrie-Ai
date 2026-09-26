import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const LETTERS = 'ABCDEF'

export function letter(i: number): string {
  return LETTERS[i] ?? String(i + 1)
}

type QuestionViewProps = {
  stem: string
  options: string[] | null
  correctIndex: number | null
  /** Per option, how many students chose it; shown as bars when given. */
  counts?: number[] | null
  misconceptions?: string[] | null
  className?: string
}

/** A question as a teacher reads it: the key marked, and — with counts — how the class answered. */
export function QuestionView({
  stem,
  options,
  correctIndex,
  counts,
  misconceptions,
  className,
}: QuestionViewProps) {
  const total = counts?.reduce((a, b) => a + b, 0) ?? 0
  return (
    <div className={cn('space-y-2', className)}>
      <p className='font-medium whitespace-pre-wrap'>{stem}</p>
      {options && (
        <ul className='space-y-1.5'>
          {options.map((opt, i) => {
            const right = i === correctIndex
            const n = counts?.[i] ?? 0
            const label = misconceptions?.[i]?.trim()
            return (
              <li key={i} className='text-sm'>
                <div
                  className={cn(
                    'relative flex items-start gap-2 overflow-hidden rounded-md border px-2 py-1.5',
                    right && 'border-green-600/60'
                  )}
                >
                  {counts && total > 0 && (
                    <div
                      aria-hidden
                      className={cn(
                        'absolute inset-y-0 left-0',
                        right ? 'bg-green-600/15' : 'bg-orange-500/15'
                      )}
                      style={{ width: `${(n / total) * 100}%` }}
                    />
                  )}
                  <span className='relative font-mono text-muted-foreground'>
                    {letter(i)}
                  </span>
                  <span className='relative flex-1'>{opt}</span>
                  {right && (
                    <Check className='relative size-4 shrink-0 text-green-600' aria-label='correct answer' />
                  )}
                  {counts && (
                    <span className='relative shrink-0 tabular-nums text-muted-foreground'>
                      {n}
                    </span>
                  )}
                </div>
                {counts && !right && n > 0 && label && (
                  <p className='mt-0.5 ps-6 text-xs text-muted-foreground'>
                    Likely misconception: {label}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
