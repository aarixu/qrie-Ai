import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  Activity,
  Brain,
  CalendarPlus,
  ClipboardList,
  GraduationCap,
  School,
  Target,
  Users,
} from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { SchoolStudent } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loading, Page, Problem } from '@/components/layout/page'
import { ChartCard, ClassBars, Kpi, band, pct, shortClass } from '@/features/analytics/charts'
import { EventDialog } from '@/features/events/event-dialog'
import { UpcomingList } from '@/features/events/upcoming'

export const useSchoolClasses = () => useQuery({ queryKey: ['school', 'classes'], queryFn: api.schoolClasses })
export const useSchoolStudents = (section?: string) =>
  useQuery({ queryKey: ['school', 'students', section ?? 'all'], queryFn: () => api.schoolStudents(section) })


/**
 * The school portal's home, for the admin (lms.school_*): the whole school
 * at a glance, class by class, and who needs attention.
 */
export function SchoolOverviewPage() {
  const overview = useQuery({ queryKey: ['school', 'overview'], queryFn: api.schoolOverview })
  const classes = useSchoolClasses()
  const students = useSchoolStudents()
  const [eventOpen, setEventOpen] = useState(false)
  const o = overview.data

  return (
    <Page
      title='School overview'
      description={o ? o.schoolName : undefined}
      actions={
        <Button variant='outline' onClick={() => setEventOpen(true)}>
          <CalendarPlus /> New school event
        </Button>
      }
    >
      {overview.isPending ? (
        <Loading what='the school' />
      ) : overview.isError ? (
        <Problem error={overview.error} />
      ) : !o ? null : (
        <div className='space-y-6'>
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
            <Kpi label='Students' icon={GraduationCap} value={o.students} hint={`${o.activeStudents7d} active in the last 7 days`} />
            <Kpi label='Teachers' icon={Users} value={o.teachers} hint={`${o.classes} sections, ${o.subjects} subjects`} />
            <Kpi label='Work set' icon={ClipboardList} value={o.workSet30d} hint='Published in the last 30 days' />
            <Kpi
              label='Hand-in rate'
              icon={Activity}
              value={pct(o.handinRate30d)}
              hint='Work due in the last 30 days'
              tone={(o.handinRate30d ?? 1) < 0.6 ? 'bad' : undefined}
            />
            <Kpi label='Average score' icon={Target} value={pct(o.averageScore30d)} hint='Marked work, last 30 days' />
            <Kpi label='Mastery' icon={Brain} value={pct(o.mastery)} hint={`${band(o.mastery).label} — from every answer`} />
            <Kpi label='Classes' icon={School} value={classes.data?.length ?? '—'} hint='Section and subject pairs taught' />
            <Kpi
              label='Need attention'
              icon={Activity}
              value={students.data ? atRisk(students.data).length : '—'}
              hint='Students below 60% hand-in or 40% mastery'
              tone={students.data && atRisk(students.data).length > 0 ? 'bad' : 'good'}
            />
          </div>

          <div className='grid gap-4 lg:grid-cols-3'>
            <ChartCard
              title='Class by class'
              description='Hand-in rate and average score, all work due so far.'
              className='lg:col-span-2'
            >
              {classes.isPending ? (
                <Loading what='the classes' />
              ) : classes.isError ? (
                <Problem error={classes.error} />
              ) : (
                <ClassBars rows={classes.data.map((c) => ({ name: shortClass(c.className, c.subjectName), handin: c.handinRate, score: c.averageScore }))} />
              )}
            </ChartCard>
            <ChartCard title='Where students stand' description='By the learning model’s belief, all subjects.'>
              {students.isPending ? <Loading what='the students' /> : students.isError ? <Problem error={students.error} /> : <Bands rows={students.data} />}
            </ChartCard>
          </div>

          <div className='grid gap-4 lg:grid-cols-2'>
            <Card>
              <CardHeader>
                <CardTitle>Students who need attention</CardTitle>
                <CardDescription>Lowest first. Open a student for their full report.</CardDescription>
              </CardHeader>
              <CardContent>
                {students.data && <AtRiskList rows={atRisk(students.data).slice(0, 8)} />}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Coming up</CardTitle>
                <CardDescription>Events and tests across the school.</CardDescription>
              </CardHeader>
              <CardContent>
                <UpcomingList empty='Nothing coming up. Post a school event above.' />
              </CardContent>
            </Card>
          </div>
        </div>
      )}
      <EventDialog open={eventOpen} onOpenChange={setEventOpen} audiences={[{ sectionId: null, label: 'The whole school' }]} />
    </Page>
  )
}

export function atRisk(rows: SchoolStudent[]): SchoolStudent[] {
  return rows
    .filter((s) => (s.handinRate !== null && s.handinRate < 0.6) || (s.mastery !== null && s.mastery < 0.4))
    .sort((a, b) => (a.handinRate ?? 1) + (a.mastery ?? 1) - ((b.handinRate ?? 1) + (b.mastery ?? 1)))
}

function AtRiskList({ rows }: { rows: SchoolStudent[] }) {
  if (rows.length === 0) return <p className='text-sm text-muted-foreground'>Nobody below the line. All good.</p>
  return (
    <ul className='divide-y'>
      {rows.map((s) => (
        <li key={s.userId}>
          <Link
            to='/students/$studentId'
            params={{ studentId: s.userId }}
            className='flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2 hover:bg-accent/50'
          >
            <span>
              <span className='font-medium'>{s.displayName}</span>{' '}
              <span className='text-sm text-muted-foreground'>Class {s.className}</span>
            </span>
            <span className='flex gap-3 text-sm whitespace-nowrap tabular-nums'>
              <span className={(s.handinRate ?? 1) < 0.6 ? 'text-destructive' : 'text-muted-foreground'}>
                {pct(s.handinRate)} handed in
              </span>
              <span className={band(s.mastery).text}>{pct(s.mastery)} mastery</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function Bands({ rows }: { rows: SchoolStudent[] }) {
  const groups = [
    { name: 'Secure', colour: '#16a34a', n: rows.filter((r) => r.mastery !== null && r.mastery >= 0.7).length },
    { name: 'Getting there', colour: '#d97706', n: rows.filter((r) => r.mastery !== null && r.mastery >= 0.4 && r.mastery < 0.7).length },
    { name: 'Needs help', colour: '#dc2626', n: rows.filter((r) => r.mastery !== null && r.mastery < 0.4).length },
    { name: 'No answers yet', colour: '#94a3b8', n: rows.filter((r) => r.mastery === null).length },
  ].filter((g) => g.n > 0)
  return (
    <div>
      <ResponsiveContainer width='100%' height={200}>
        <PieChart>
          <Pie data={groups} dataKey='n' nameKey='name' innerRadius={50} outerRadius={80} paddingAngle={2}>
            {groups.map((g) => (
              <Cell key={g.name} fill={g.colour} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
      <ul className='mt-2 grid grid-cols-2 gap-1 text-sm'>
        {groups.map((g) => (
          <li key={g.name} className='flex items-center gap-2'>
            <span className='size-2.5 rounded-full' style={{ background: g.colour }} />
            {g.name} <span className='ms-auto tabular-nums text-muted-foreground'>{g.n}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
