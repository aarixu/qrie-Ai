// COPIED, NOT IMPORTED, from the teacher app: ChartCard, axis and
// tooltipStyle of apps/lms/src/features/analytics/charts.tsx, unchanged but for
// imports, so a change to the teacher app never changes the console.

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function ChartCard({
  title,
  description,
  children,
  className,
  info,
}: {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
  /** Beside the title, e.g. MasteryInfo. */
  info?: React.ReactNode
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className={info ? 'flex items-center gap-1.5' : undefined}>
          {title}
          {info}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className='ps-2'>{children}</CardContent>
    </Card>
  )
}

export const axis = { fontSize: 12, fill: 'var(--muted-foreground)' }
export const tooltipStyle = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--popover-foreground)',
  fontSize: 12,
}
