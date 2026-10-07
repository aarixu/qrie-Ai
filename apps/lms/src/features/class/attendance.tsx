import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, startOfMonth } from 'date-fns'
import { CheckCheck } from 'lucide-react'
import { toast } from 'sonner'
import { friendlyError, type AttendanceStatus } from '@ai-tutor/lms-client'
import { useIsNarrow } from '@/hooks/use-mobile'
import { api } from '@/lib/backend'
import { usePhotos } from '@/lib/photos'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Loading, Problem } from '@/components/layout/page'
import { PersonAvatar } from '@/components/person-avatar'
import { pct } from '@/features/analytics/charts'

const MARKS: { status: AttendanceStatus; short: string; label: string; colour: string }[] = [
  { status: 'present', short: 'P', label: 'Present', colour: '#059669' },
  { status: 'absent', short: 'A', label: 'Absent', colour: '#dc2626' },
  { status: 'late', short: 'L', label: 'Late', colour: '#d97706' },
  { status: 'leave', short: 'Lv', label: 'On leave', colour: '#2563eb' },
]

const ymd = (d: Date) => format(d, 'yyyy-MM-dd')

/**
 * The class's attendance: a day's list to mark (lms.mark_attendance), and the
 * month so far, child by child (lms.attendance_summary).
 */
export function Attendance({ sectionId }: { sectionId: string }) {
  const today = ymd(new Date())
  const [day, setDay] = useState(today)
  const queryClient = useQueryClient()
  const sheet = useQuery({
    queryKey: ['attendance', sectionId, day],
    queryFn: () => api.attendanceSheet(sectionId, day),
  })
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({})
  useEffect(() => {
    setMarks(Object.fromEntries((sheet.data ?? []).filter((r) => r.status).map((r) => [r.studentUserId, r.status!])))
  }, [sheet.data])
  const photos = usePhotos((sheet.data ?? []).map((r) => r.studentUserId))
  const save = useMutation({
    mutationFn: () => api.markAttendance(sectionId, day, marks),
    onSuccess: () => {
      toast.success(`Attendance saved for ${format(new Date(day), 'd MMM')}.`)
      queryClient.invalidateQueries({ queryKey: ['attendance', sectionId] })
    },
    onError: (e) => toast.error(friendlyError(e)),
  })

  const rows = sheet.data ?? []
  const counts = MARKS.map((m) => ({ ...m, n: rows.filter((r) => marks[r.studentUserId] === m.status).length }))
  const unmarked = rows.filter((r) => !marks[r.studentUserId]).length

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader className='flex flex-row flex-wrap items-end justify-between gap-3 space-y-0'>
          <div>
            <CardTitle>Mark attendance</CardTitle>
            <CardDescription>
              {counts.map((c) => `${c.n} ${c.label.toLowerCase()}`).join(' · ')}
              {unmarked > 0 && ` · ${unmarked} not marked`}
            </CardDescription>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <Input type='date' value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} className='w-40' aria-label='Day' />
            <Button
              variant='outline'
              onClick={() => setMarks((m) => ({ ...Object.fromEntries(rows.map((r) => [r.studentUserId, 'present' as const])), ...m }))}
            >
              <CheckCheck /> Everyone else present
            </Button>
            <Button disabled={save.isPending || Object.keys(marks).length === 0} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {sheet.isPending ? (
            <Loading what='the class list' />
          ) : sheet.isError ? (
            <Problem error={sheet.error} />
          ) : rows.length === 0 ? (
            <p className='text-sm text-muted-foreground'>No students in this class yet.</p>
          ) : (
            <ul className='divide-y'>
              {rows.map((r) => (
                <li key={r.studentUserId} className='flex flex-wrap items-center gap-3 py-2'>
                  <span className='w-6 text-end text-sm text-muted-foreground tabular-nums'>{r.rollNumber}</span>
                  <PersonAvatar userId={r.studentUserId} name={r.displayName} photo={photos.get(r.studentUserId)} className='size-8' />
                  <span className='min-w-32 flex-1 font-medium'>{r.displayName}</span>
                  {/* On a phone the four marks take a full row of their own, big enough for a thumb. */}
                  <span className='flex gap-1 max-sm:w-full' role='radiogroup' aria-label={`${r.displayName}'s attendance`}>
                    {MARKS.map((m) => {
                      const on = marks[r.studentUserId] === m.status
                      return (
                        <button
                          key={m.status}
                          type='button'
                          role='radio'
                          aria-checked={on}
                          title={m.label}
                          onClick={() => setMarks((x) => ({ ...x, [r.studentUserId]: m.status }))}
                          className={cn(
                            'h-8 min-w-9 rounded-md border px-2 text-sm font-semibold transition-colors max-sm:h-10 max-sm:flex-1',
                            on ? 'border-transparent text-white' : 'text-muted-foreground hover:bg-accent'
                          )}
                          style={on ? { background: m.colour } : undefined}
                        >
                          {m.short}
                        </button>
                      )
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <MonthSoFar sectionId={sectionId} today={today} />
    </div>
  )
}

/** The month child by child: a table from sm up, a line per child on a phone. */
function MonthSoFar({ sectionId, today }: { sectionId: string; today: string }) {
  const narrow = useIsNarrow()
  const from = ymd(startOfMonth(new Date()))
  const sum = useQuery({
    queryKey: ['attendance', sectionId, 'month', from],
    queryFn: () => api.attendanceSummary(sectionId, from, today),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>This month</CardTitle>
        <CardDescription>Present or late, over the days marked; days on leave are left out.</CardDescription>
      </CardHeader>
      <CardContent>
        {sum.isPending ? (
          <Loading what='the month' />
        ) : sum.isError ? (
          <Problem error={sum.error} />
        ) : narrow ? (
          <ul className='divide-y rounded-md border text-sm'>
            {sum.data.map((r) => (
              <li key={r.studentUserId} className='flex items-center gap-3 px-3 py-2'>
                <span className='w-5 shrink-0 text-end text-muted-foreground tabular-nums'>{r.rollNumber}</span>
                <span className='min-w-0 flex-1'>
                  <span className='block truncate font-medium'>{r.displayName}</span>
                  <span className='block text-xs text-muted-foreground tabular-nums'>
                    {MARKS.map((m) => `${r[m.status]} ${m.label.toLowerCase()}`).join(' · ')}
                  </span>
                </span>
                <span className={cn('shrink-0 font-medium tabular-nums', (r.rate ?? 1) < 0.75 && 'text-destructive')}>
                  {pct(r.rate)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className='overflow-x-auto rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-14'>Roll</TableHead>
                  <TableHead>Student</TableHead>
                  {MARKS.map((m) => (
                    <TableHead key={m.status} className='text-center'>
                      {m.label}
                    </TableHead>
                  ))}
                  <TableHead className='text-center'>Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sum.data.map((r) => (
                  <TableRow key={r.studentUserId}>
                    <TableCell className='tabular-nums'>{r.rollNumber}</TableCell>
                    <TableCell className='font-medium'>{r.displayName}</TableCell>
                    <TableCell className='text-center tabular-nums'>{r.present}</TableCell>
                    <TableCell className='text-center tabular-nums'>{r.absent}</TableCell>
                    <TableCell className='text-center tabular-nums'>{r.late}</TableCell>
                    <TableCell className='text-center tabular-nums'>{r.leave}</TableCell>
                    <TableCell className={cn('text-center font-medium tabular-nums', (r.rate ?? 1) < 0.75 && 'text-destructive')}>
                      {pct(r.rate)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
