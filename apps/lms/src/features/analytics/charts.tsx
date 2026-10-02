import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { format } from 'date-fns'
import type { TrendPoint } from '@ai-tutor/lms-client'
import { hueFor } from '@/lib/palette'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/** A fraction of 1 as a whole percentage, or a dash when there is none. */
export function pct(x: number | null | undefined): string {
  return x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`
}

const SHORT: Record<string, string> = { Mathematics: 'Maths', Science: 'Sci', English: 'Eng', 'Social Science': 'SSt', Hindi: 'Hin' }

/** A class and subject short enough for a chart's axis: '8A Maths'. */
export function shortClass(className: string, subject: string): string {
  return `${className} ${SHORT[subject] ?? subject.slice(0, 4)}`
}

const toPct = (x: number | null | undefined) => (x === null || x === undefined ? null : Math.round(x * 100))

/**
 * The three words a teacher reads a mastery by. The brain's belief is a
 * probability; these bands are only how it is shown.
 */
export function band(m: number | null | undefined): { label: string; colour: string; text: string } {
  if (m === null || m === undefined) return { label: 'No answers yet', colour: 'var(--muted-foreground)', text: 'text-muted-foreground' }
  if (m < 0.4) return { label: 'Needs help', colour: '#dc2626', text: 'text-red-600' }
  if (m < 0.7) return { label: 'Getting there', colour: '#d97706', text: 'text-amber-600' }
  return { label: 'Secure', colour: '#16a34a', text: 'text-green-600' }
}

/** One colour per measure, the same on every screen and chart, whatever the school's colours. */
export const MEASURE = {
  handin: '#059669',
  average: '#2563eb',
  work: '#d97706',
  mastery: '#c026d3',
} as const

const KPI_HUE: Record<string, string> = {
  Students: '#4f46e5',
  Teachers: '#7c3aed',
  'Work set': MEASURE.work,
  'Hand-in rate': MEASURE.handin,
  'Work handed in': MEASURE.handin,
  'Average score': MEASURE.average,
  'Average mark': MEASURE.average,
  Mastery: MEASURE.mastery,
  Classes: '#0891b2',
  'Need attention': '#e11d48',
  'Handed in late': '#ea580c',
  'Chapters practised': '#0d9488',
  'Attendance today': '#0284c7',
  Attendance: '#0284c7',
}

export function Kpi({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  icon?: React.ElementType
  tone?: 'bad' | 'good'
}) {
  const colour = KPI_HUE[label] ?? hueFor(label).solid
  return (
    <Card className='relative gap-2 overflow-hidden py-4'>
      <span className='absolute inset-x-0 top-0 h-1' style={{ background: colour }} aria-hidden />
      <CardHeader className='flex flex-row items-center justify-between space-y-0 px-4'>
        <CardTitle className='text-sm font-medium text-muted-foreground'>{label}</CardTitle>
        {Icon && (
          <span
            className='flex size-9 items-center justify-center rounded-xl'
            style={{ background: `${colour}1f`, color: colour }}
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

export function ChartCard({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className='ps-2'>{children}</CardContent>
    </Card>
  )
}

const axis = { fontSize: 12, fill: 'var(--muted-foreground)' }
const tooltipStyle = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--popover-foreground)',
  fontSize: 12,
}

/** Work by work, oldest first: the class's average score and how many handed in. */
export function TrendChart({ points, height = 260 }: { points: TrendPoint[]; height?: number }) {
  const past = points.filter((p) => new Date(p.dueAt) <= new Date())
  if (past.length === 0) return <p className='px-4 text-sm text-muted-foreground'>No work has closed yet.</p>
  const data = past.map((p) => ({
    name: format(new Date(p.dueAt), 'd MMM'),
    title: p.title,
    'Average score': toPct(p.averageScore),
    'Handed in': p.students ? Math.round((p.handedIn / p.students) * 100) : null,
  }))
  return (
    <ResponsiveContainer width='100%' height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray='3 3' stroke='var(--border)' />
        <XAxis dataKey='name' tick={axis} tickLine={false} axisLine={false} />
        <YAxis domain={[0, 100]} tick={axis} tickLine={false} axisLine={false} unit='%' width={44} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v) => `${v}%`}
          labelFormatter={(_, payload) => (payload?.[0]?.payload as { title?: string } | undefined)?.title ?? ''}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type='monotone' dataKey='Average score' stroke={MEASURE.average} strokeWidth={2.5} dot={{ r: 3.5 }} connectNulls />
        <Line type='monotone' dataKey='Handed in' stroke={MEASURE.handin} strokeWidth={2.5} dot={{ r: 3.5 }} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  )
}

/** One pair of bars per class: hand-in rate and average score. */
export function ClassBars({
  rows,
  height = 280,
}: {
  rows: { name: string; handin: number | null; score: number | null }[]
  height?: number
}) {
  if (rows.length === 0) return <p className='px-4 text-sm text-muted-foreground'>No classes yet.</p>
  const data = rows.map((r) => ({ name: r.name, 'Handed in': toPct(r.handin), 'Average score': toPct(r.score) }))
  return (
    <ResponsiveContainer width='100%' height={height}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray='3 3' stroke='var(--border)' vertical={false} />
        <XAxis dataKey='name' tick={{ ...axis, fontSize: 11 }} tickLine={false} axisLine={false} interval={0} />
        <YAxis domain={[0, 100]} tick={axis} tickLine={false} axisLine={false} unit='%' width={44} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${v}%`} cursor={{ fill: 'var(--muted)' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey='Handed in' fill={MEASURE.handin} radius={[4, 4, 0, 0]} />
        <Bar dataKey='Average score' fill={MEASURE.average} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Horizontal bars, one per row, coloured by band. */
export function MasteryBars({ rows }: { rows: { label: string; mastery: number | null }[] }) {
  if (rows.length === 0) return <p className='px-4 text-sm text-muted-foreground'>No answers yet, so nothing to show.</p>
  const data = rows.map((r) => ({ label: r.label, Mastery: toPct(r.mastery) ?? 0, raw: r.mastery }))
  return (
    <ResponsiveContainer width='100%' height={Math.max(120, data.length * 36 + 24)}>
      <BarChart data={data} layout='vertical' margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray='3 3' stroke='var(--border)' horizontal={false} />
        <XAxis type='number' domain={[0, 100]} tick={axis} tickLine={false} axisLine={false} unit='%' />
        <YAxis type='category' dataKey='label' tick={axis} tickLine={false} axisLine={false} width={170} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${v}%`} cursor={{ fill: 'var(--muted)' }} />
        <Bar dataKey='Mastery' radius={[0, 4, 4, 0]} barSize={18}>
          {data.map((d) => (
            <Cell key={d.label} fill={band(d.raw).colour} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
