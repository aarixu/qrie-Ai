// COPIED, NOT IMPORTED, from the teacher app: Kpi of
// apps/lms/src/features/analytics/charts.tsx, so a change to the teacher app
// never changes the console. Changed: the teacher app's per-label colours
// (KPI_HUE, hueFor), which the console does not have, are replaced by an
// optional `colour` (default var(--primary)), and the icon's tint is mixed
// with color-mix so a CSS variable works as the colour.

import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function Kpi({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  info,
  colour = 'var(--primary)',
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  icon?: React.ElementType
  tone?: 'bad' | 'good'
  /** Beside the label. */
  info?: React.ReactNode
  /** The strip along the top and the icon's colour. */
  colour?: string
}) {
  return (
    <Card className='relative gap-2 overflow-hidden py-4'>
      <span className='absolute inset-x-0 top-0 h-1' style={{ background: colour }} aria-hidden />
      <CardHeader className='flex flex-row items-center justify-between space-y-0 px-4'>
        <CardTitle className='flex items-center gap-1 text-sm font-medium text-muted-foreground'>
          {label}
          {info}
        </CardTitle>
        {Icon && (
          <span
            className='flex size-9 items-center justify-center rounded-xl'
            style={{ background: `color-mix(in oklab, ${colour} 12%, transparent)`, color: colour }}
            aria-hidden
          >
            <Icon className='size-[18px]' />
          </span>
        )}
      </CardHeader>
      <CardContent className='px-4'>
        <div
          className={cn(
            'text-2xl font-bold tabular-nums',
            tone === 'bad' && 'text-red-600',
            tone === 'good' && 'text-green-600'
          )}
        >
          {value}
        </div>
        {hint && <p className='text-xs text-muted-foreground'>{hint}</p>}
      </CardContent>
    </Card>
  )
}
