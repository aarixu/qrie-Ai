import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { format } from 'date-fns'
import { AlertTriangle, BookCheck, Brain, ClipboardList, Target, CalendarCheck } from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { StudentSubject, TimelineRow } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import { chapterTitle } from '@/lib/curriculum'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Loading, Page, Problem } from '@/components/layout/page'
import { ChartCard, Kpi, MEASURE, MasteryBars, band, pct } from '@/features/analytics/charts'
import { MasteryInfo } from '@/features/analytics/mastery-info'
import { kindLabel } from '@/features/homework/kinds'
import { ResetPinButton } from '@/features/school/reset-pin'
import { LeaveButton } from '@/features/school/leavers'
import { MoveStudentButton } from '@/features/school/new-year'
import { ProfileHeader } from './profile-header'
import { ParentsCard } from './parents'
import { RemarkCard } from './remark'
import { ReportCardButtons } from './report-buttons'

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

/** Hand-ins over work due, across the subjects shown. */
export function handinOf(subjects: StudentSubject[]): number | null {
  const due = subjects.reduce((n, s) => n + s.workDue, 0)
  return due ? subjects.reduce((n, s) => n + s.handedIn, 0) / due : null
}

const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

/**
 * One student's report (lms.student_*): who they are, how each subject is
 * going, this year's teacher's remark, what the learning model believes
 * chapter by chapter, and every piece of work. A teacher sees only the
 * subjects they teach the child; the school's admin sees all of them. The
 * server decides; this only shows.
 */
export function StudentReport({ studentId }: { studentId: string }) {
  const me = useAuthStore((s) => s.me)
  const navigate = useNavigate()
  const card = useQuery({ queryKey: ['student', studentId, 'card'], queryFn: () => api.studentCard(studentId) })
  const subjects = useQuery({ queryKey: ['student', studentId, 'subjects'], queryFn: () => api.studentSubjects(studentId) })
  const chapters = useQuery({ queryKey: ['student', studentId, 'chapters'], queryFn: () => api.studentChapters(studentId) })
  const timeline = useQuery({ queryKey: ['student', studentId, 'timeline'], queryFn: () => api.studentTimeline(studentId) })
  const attendance = useQuery({
    queryKey: ['student', studentId, 'attendance'],
    queryFn: () => api.studentAttendance(studentId),
  })
  const mistakes = useQuery({ queryKey: ['student', studentId, 'mistakes'], queryFn: () => api.studentMistakes(studentId) })

  const back =
    me?.kind === 'admin'
      ? { label: 'Students', to: '/school/students' as const }
      : { label: 'Home', to: '/' as const }
  const s = card.data

  return (
    <Page
      title='Student report'
      back={back}
      actions={
        card.data && (
          <>
            <ReportCardButtons studentId={studentId} />
            {me?.kind === 'admin' && <ResetPinButton loginId={card.data.loginId} name={card.data.displayName} />}
            {me?.kind === 'admin' && (
              <MoveStudentButton loginId={card.data.loginId} name={card.data.displayName} roll={card.data.rollNumber} />
            )}
            {me?.kind === 'admin' && (
              <LeaveButton
                loginId={card.data.loginId}
                name={card.data.displayName}
                kind='student'
                onDone={() => navigate({ to: '/school/students' })}
              />
            )}
          </>
        )
      }
    >
      {card.isPending ? (
        <Loading what='the student' />
      ) : card.isError ? (
        <Problem error={card.error} />
      ) : !s ? (
        <p className='text-muted-foreground'>No such student.</p>
      ) : (
        <div className='space-y-6'>
          <ProfileHeader
            card={s}
            ring={band(mean((subjects.data ?? []).map((x) => x.mastery))).colour}
            ringNote={
              subjects.data && (
                <>
                  Ring colour: mastery, {band(mean(subjects.data.map((x) => x.mastery))).label}
                  <MasteryInfo />
                </>
              )
            }
            canEditPhoto={me?.kind === 'admin'}
            note={me?.kind !== 'admin' ? 'Showing the subjects you teach them.' : undefined}
          />

          {subjects.isError ? (
            <Problem error={subjects.error} />
          ) : subjects.isPending ? (
            <Loading what='their subjects' />
          ) : (
            <>
              <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-5'>
                <Kpi
                  label='Hand-in rate'
                  icon={ClipboardList}
                  value={pct(handinOf(subjects.data))}
                  hint={`${subjects.data.reduce((n, x) => n + x.handedIn, 0)} of ${subjects.data.reduce((n, x) => n + x.workDue, 0)} pieces of work due`}
                  tone={(handinOf(subjects.data) ?? 1) < 0.6 ? 'bad' : undefined}
                />
                <Kpi
                  label='Average score'
                  icon={Target}
                  value={pct(mean(subjects.data.map((x) => x.averageScore)))}
                  hint='Over marked work'
                />
                <Kpi
                  label='Mastery'
                  icon={Brain}
                  value={pct(mean(subjects.data.map((x) => x.mastery)))}
                  hint={band(mean(subjects.data.map((x) => x.mastery))).label}
                  info={<MasteryInfo />}
                />
                <Kpi
                  label='Attendance'
                  icon={CalendarCheck}
                  value={pct(attendance.data?.rate ?? null)}
                  hint={attendance.data?.marked ? `${attendance.data.marked} days marked this year` : 'No days marked yet'}
                  tone={(attendance.data?.rate ?? 1) < 0.75 ? 'bad' : undefined}
                />
                <Kpi
                  label='Chapters practised'
                  icon={BookCheck}
                  value={subjects.data.reduce((n, x) => n + x.chaptersSeen, 0)}
                  hint='With answers the model has read'
                />
              </div>
              <SubjectTable subjects={subjects.data} />
            </>
          )}

          <RemarkCard studentId={studentId} name={s.displayName} />

          {me?.kind === 'admin' && <ParentsCard studentId={studentId} loginId={s.loginId} name={s.displayName} />}

          <div className='grid gap-4 lg:grid-cols-2'>
            <ChartCard title='Scores over time' description='Each marked piece of work, oldest first.'>
              {timeline.isPending ? <Loading what='their work' /> : timeline.isError ? <Problem error={timeline.error} /> : <ScoreHistory rows={timeline.data} />}
            </ChartCard>
            <ChartCard
              title='Chapter by chapter'
              description='What Qrie’s learning model believes, from every answer — not the marks.'
              info={<MasteryInfo />}
            >
              {chapters.isPending ? (
                <Loading what='the chapters' />
              ) : chapters.isError ? (
                <Problem error={chapters.error} />
              ) : (
                <MasteryBars
                  rows={chapters.data.map((c) => ({ label: `${chapterTitle(c.chapter)}`, mastery: c.mastery }))}
                />
              )}
            </ChartCard>
          </div>

          {mistakes.data && mistakes.data.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className='flex items-center gap-2'>
                  <AlertTriangle className='size-4 text-amber-600' /> Likely misconceptions
                </CardTitle>
                <CardDescription>What this student’s own wrong answers point to, most repeated first.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className='space-y-1.5 text-sm'>
                  {mistakes.data.map((m) => (
                    <li key={`${m.chapter}-${m.label}`} className='flex flex-wrap gap-x-2'>
                      <Badge variant='secondary'>{m.times}×</Badge>
                      <span className='font-medium'>{m.label}</span>
                      <span className='text-muted-foreground'>
                        {m.subject}
                        {m.chapter && ` · ${chapterTitle(m.chapter)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>All work</CardTitle>
              <CardDescription>Newest first.</CardDescription>
            </CardHeader>
            <CardContent>
              {timeline.isPending ? (
                <Loading what='their work' />
              ) : timeline.isError ? (
                <Problem error={timeline.error} />
              ) : (
                <WorkTable rows={timeline.data} linkWork={me?.kind !== 'admin'} />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </Page>
  )
}

function SubjectTable({ subjects }: { subjects: StudentSubject[] }) {
  if (subjects.length === 0) return <p className='text-muted-foreground'>No subjects to show.</p>
  return (
    <div className='overflow-x-auto rounded-md border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Subject</TableHead>
            <TableHead>Teacher</TableHead>
            <TableHead className='w-56'>Handed in</TableHead>
            <TableHead className='text-center'>Average</TableHead>
            <TableHead>
              <span className='inline-flex items-center gap-1'>
                Mastery <MasteryInfo />
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {subjects.map((x) => {
            const b = band(x.mastery)
            return (
              <TableRow key={x.subjectId}>
                <TableCell className='font-medium'>{x.subjectName}</TableCell>
                <TableCell className='text-muted-foreground'>{x.teacherName ?? '—'}</TableCell>
                <TableCell>
                  <div className='flex items-center gap-2'>
                    <div className='h-2 w-28 overflow-hidden rounded-full bg-muted'>
                      <div className='h-full rounded-full bg-primary' style={{ width: `${(x.handinRate ?? 0) * 100}%` }} />
                    </div>
                    <span className='text-sm tabular-nums'>
                      {x.handedIn}/{x.workDue}
                    </span>
                  </div>
                </TableCell>
                <TableCell className={cn('text-center tabular-nums', (x.averageScore ?? 1) < 0.5 && 'text-destructive')}>
                  {pct(x.averageScore)}
                </TableCell>
                <TableCell>
                  <span className={cn('text-sm font-medium', b.text)}>
                    {x.mastery === null ? b.label : `${pct(x.mastery)} · ${b.label}`}
                  </span>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function ScoreHistory({ rows }: { rows: TimelineRow[] }) {
  const data = rows
    .filter((r) => r.score !== null)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .map((r) => ({ name: format(new Date(r.dueAt), 'd MMM'), title: r.title, Score: Math.round(r.score! * 100) }))
  if (data.length === 0) return <p className='px-4 text-sm text-muted-foreground'>Nothing marked yet.</p>
  return (
    <ResponsiveContainer width='100%' height={240}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray='3 3' stroke='var(--border)' />
        <XAxis dataKey='name' tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
        <YAxis domain={[0, 100]} unit='%' width={44} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
          formatter={(v) => `${v}%`}
          labelFormatter={(_, p) => (p?.[0]?.payload as { title?: string } | undefined)?.title ?? ''}
        />
        <Line type='monotone' dataKey='Score' stroke={MEASURE.average} strokeWidth={2.5} dot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

export function workState(r: TimelineRow): { label: string; className: string } {
  if (r.absent) return { label: 'Absent', className: 'text-muted-foreground' }
  if (r.handedIn) return r.late ? { label: 'Handed in late', className: 'text-orange-600' } : { label: 'Handed in', className: 'text-green-600' }
  if (new Date(r.dueAt) > new Date()) return { label: 'Open', className: 'text-muted-foreground' }
  return { label: 'Missing', className: 'text-destructive' }
}

function WorkTable({ rows, linkWork }: { rows: TimelineRow[]; linkWork: boolean }) {
  if (rows.length === 0) return <p className='text-muted-foreground'>No work set yet.</p>
  return (
    <div className='overflow-x-auto'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Due</TableHead>
            <TableHead>Work</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className='text-center'>Score</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const st = workState(r)
            return (
              <TableRow key={r.assignmentId}>
                <TableCell className='text-muted-foreground tabular-nums'>{format(new Date(r.dueAt), 'd MMM')}</TableCell>
                <TableCell>
                  <Badge variant='outline' className='me-2'>
                    {kindLabel(r.kind)}
                  </Badge>
                  {linkWork ? (
                    <Link to='/homework/$assignmentId' params={{ assignmentId: r.assignmentId }} className='font-medium hover:underline'>
                      {r.title}
                    </Link>
                  ) : (
                    <span className='font-medium'>{r.title}</span>
                  )}
                </TableCell>
                <TableCell className='text-muted-foreground'>{r.subjectName}</TableCell>
                <TableCell className={cn('text-sm font-medium', st.className)}>{st.label}</TableCell>
                <TableCell className={cn('text-center tabular-nums', (r.score ?? 1) < 0.5 && 'text-destructive')}>
                  {pct(r.score)}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
