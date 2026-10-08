import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  Activity,
  Brain,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  GraduationCap,
  School,
  Target,
  UserPlus,
  Users,
} from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { SchoolStudent } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loading, Page, Problem } from '@/components/layout/page'
import { ChartCard, ClassBars, Kpi, band, pct, shortClass } from '@/features/analytics/charts'
import { MasteryInfo } from '@/features/analytics/mastery-info'
import { BrandHero, greeting } from '@/components/brand-hero'
import { PersonAvatar } from '@/components/person-avatar'
import { usePhotos } from '@/lib/photos'
import { useAuthStore } from '@/stores/auth-store'
import { useSchoolLogo } from '@/lib/brand'
import { EventDialog } from '@/features/events/event-dialog'
import { UpcomingList } from '@/features/events/upcoming'
import { LicenceBanner, LicenceCard } from './licence'

export const useSchoolClasses = () => useQuery({ queryKey: ['school', 'classes'], queryFn: api.schoolClasses })
export const useSchoolStudents = (section?: string) =>
  useQuery({ queryKey: ['school', 'students', section ?? 'all'], queryFn: () => api.schoolStudents(section) })


/**
 * The school portal's home, for the admin (lms.school_*): the whole school
 * at a glance, class by class, who needs attention, and the licence.
 */
export function SchoolOverviewPage() {
  const overview = useQuery({ queryKey: ['school', 'overview'], queryFn: api.schoolOverview })
  const classes = useSchoolClasses()
  const students = useSchoolStudents()
  const [eventOpen, setEventOpen] = useState(false)
  const me = useAuthStore((s) => s.me)
  const logo = useSchoolLogo(!!me)
  const attendance = useQuery({ queryKey: ['school', 'attendance-today'], queryFn: api.schoolAttendanceToday })
  const today = {
    sections: attendance.data?.length ?? 0,
    markedSections: (attendance.data ?? []).filter((c) => c.marked > 0).length,
    marked: (attendance.data ?? []).reduce((n, c) => n + c.marked, 0),
    present: (attendance.data ?? []).reduce((n, c) => n + c.present, 0),
  }
  const o = overview.data

  return (
    <Page
      title='School overview'
      hero={
        <BrandHero
          title={greeting(me?.displayName)}
          subtitle={o ? `${o.students} students · ${o.teachers} teachers · ${o.classes} sections` : 'Your school at a glance.'}
        >
          <Button variant='secondary' onClick={() => setEventOpen(true)}>
            <CalendarPlus /> New school event
          </Button>
          <Button asChild variant='secondary'>
            <Link to='/school/people'>
              <UserPlus /> Add people
            </Link>
          </Button>
        </BrandHero>
      }
    >
      <LicenceBanner className='mb-6' />
      {overview.isPending ? (
        <Loading what='the school' />
      ) : overview.isError ? (
        <Problem error={overview.error} />
      ) : !o ? null : (
        <div className='space-y-6'>
          <GettingStarted
            people={o.students > 0 && o.teachers > 0}
            logo={!!logo}
            colours={typeof me?.brand?.primary === 'string'}
            work={o.workSet30d > 0}
            school={o.schoolName}
          />
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
            <Kpi
              label='Mastery'
              icon={Brain}
              value={pct(o.unassistedMastery)}
              hint={`${band(o.unassistedMastery).label} — on their own`}
              info={<MasteryInfo />}
            />
            <Kpi
              label='Attendance today'
              icon={School}
              value={pct(today.present / Math.max(today.marked, 1))}
              hint={
                today.sections
                  ? `${today.markedSections} of ${today.sections} classes marked · ${today.present} of ${today.marked} came`
                  : 'No classes yet'
              }
              tone={today.marked > 0 && today.present / today.marked < 0.75 ? 'bad' : undefined}
            />
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
            <ChartCard
              title='Where students stand'
              description='Mastery is Qrie’s estimate, from every answer a student gives, of how well they can do each chapter on their own — not a mark. Secure is 70% or more, Getting there 40–70%, Needs help under 40%.'
              info={<MasteryInfo />}
            >
              {students.isPending ? <Loading what='the students' /> : students.isError ? <Problem error={students.error} /> : <Bands rows={students.data} />}
            </ChartCard>
          </div>

          <div className='grid gap-4 lg:grid-cols-2 xl:grid-cols-3'>
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
            <LicenceCard />
          </div>
        </div>
      )}
      <EventDialog open={eventOpen} onOpenChange={setEventOpen} audiences={[{ sectionId: null, label: 'The whole school' }]} />
    </Page>
  )
}

export function atRisk(rows: SchoolStudent[]): SchoolStudent[] {
  return rows
    .filter((s) => (s.handinRate !== null && s.handinRate < 0.6) || (s.unassistedMastery !== null && s.unassistedMastery < 0.4))
    .sort((a, b) => (a.handinRate ?? 1) + (a.unassistedMastery ?? 1) - ((b.handinRate ?? 1) + (b.unassistedMastery ?? 1)))
}

function AtRiskList({ rows }: { rows: SchoolStudent[] }) {
  const photos = usePhotos(rows.map((r) => r.userId))
  if (rows.length === 0) return <p className='text-sm text-muted-foreground'>Nobody below the line. All good.</p>
  return (
    <ul className='divide-y'>
      {rows.map((s) => (
        <li key={s.userId}>
          <Link
            to='/students/$studentId'
            params={{ studentId: s.userId }}
            className='flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-md px-1 py-2 hover:bg-accent/50'
          >
            <span className='flex items-center gap-3'>
              <PersonAvatar userId={s.userId} name={s.displayName} photo={photos.get(s.userId)} className='size-9' />
              <span>
                <span className='font-medium'>{s.displayName}</span>{' '}
                <span className='text-sm text-muted-foreground'>Class {s.className}</span>
              </span>
            </span>
            <span className='flex gap-3 text-sm whitespace-nowrap tabular-nums'>
              <span className={(s.handinRate ?? 1) < 0.6 ? 'text-destructive' : 'text-muted-foreground'}>
                {pct(s.handinRate)} handed in
              </span>
              <span className={band(s.unassistedMastery).text}>{pct(s.unassistedMastery)} mastery</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function Bands({ rows }: { rows: SchoolStudent[] }) {
  const groups = [
    { name: 'Secure', colour: '#16a34a', n: rows.filter((r) => r.unassistedMastery !== null && r.unassistedMastery >= 0.7).length },
    { name: 'Getting there', colour: '#d97706', n: rows.filter((r) => r.unassistedMastery !== null && r.unassistedMastery >= 0.4 && r.unassistedMastery < 0.7).length },
    { name: 'Needs help', colour: '#dc2626', n: rows.filter((r) => r.unassistedMastery !== null && r.unassistedMastery < 0.4).length },
    { name: 'Nothing on their own yet', colour: '#94a3b8', n: rows.filter((r) => r.unassistedMastery === null).length },
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

/**
 * A new school's first steps, until each is done or the admin hides the card
 * (remembered on this device only).
 */
function GettingStarted({
  people,
  logo,
  colours,
  work,
  school,
}: {
  people: boolean
  logo: boolean
  colours: boolean
  work: boolean
  school: string
}) {
  const key = `qrie.setup-hidden.${school}`
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  const steps = [
    { done: people, label: 'Add your students and teachers, and give them their IDs and PINs', to: '/school/people' as const },
    { done: logo, label: 'Upload your school’s logo', to: '/school/settings' as const },
    { done: colours, label: 'Choose your school’s colours', to: '/school/settings' as const },
    { done: work, label: 'Teachers set their first homework or test', to: '/school/teachers' as const },
  ]
  const done = steps.filter((x) => x.done).length
  if (hidden || done === steps.length) return null
  return (
    <Card className='border-primary/30'>
      <CardHeader className='flex flex-row items-start justify-between gap-3 space-y-0'>
        <div>
          <CardTitle>Getting started</CardTitle>
          <CardDescription>
            {done} of {steps.length} done. Each step makes the apps your school’s own.
          </CardDescription>
        </div>
        <Button
          variant='ghost'
          size='sm'
          onClick={() => {
            setHidden(true)
            try {
              localStorage.setItem(key, '1')
            } catch {
              /* hidden for this visit only */
            }
          }}
        >
          Hide
        </Button>
      </CardHeader>
      <CardContent>
        <div className='mb-3 h-2 overflow-hidden rounded-full bg-muted'>
          <div className='h-full rounded-full bg-primary transition-all' style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
        <ul className='space-y-1.5'>
          {steps.map((x) => (
            <li key={x.label}>
              <Link to={x.to} className='flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-accent/50'>
                {x.done ? (
                  <CheckCircle2 className='size-5 shrink-0 text-green-600' />
                ) : (
                  <span className='size-5 shrink-0 rounded-full border-2' />
                )}
                <span className={x.done ? 'text-muted-foreground line-through' : 'font-medium'}>{x.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
