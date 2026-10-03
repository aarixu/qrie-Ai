import { useState } from 'react'
import { friendlyError } from '@ai-tutor/lms-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import type { SchoolClass } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Loading, Page, Problem } from '@/components/layout/page'
import { TrendChart, band, pct } from '@/features/analytics/charts'
import { MasteryInfo } from '@/features/analytics/mastery-info'
import { SubjectBadge } from '@/components/subject-icon'
import { LikelyMisconceptions } from '@/features/class/misconceptions'
import { useSchoolClasses } from './overview'

/** Every class and subject in the school, with how it is going (lms.school_classes). */
export function SchoolClassesPage() {
  const classes = useSchoolClasses()
  const [open, setOpen] = useState<SchoolClass | null>(null)
  return (
    <Page title='Classes' description='Every section and subject, all work due so far. Open one for its trend and likely misconceptions.'>
      {classes.isPending ? (
        <Loading what='the classes' />
      ) : classes.isError ? (
        <Problem error={classes.error} />
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Class</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Teacher</TableHead>
                <TableHead className='text-center'>Students</TableHead>
                <TableHead className='text-center'>Work set</TableHead>
                <TableHead className='w-48'>Handed in</TableHead>
                <TableHead className='text-center'>Average</TableHead>
                <TableHead>
                  <span className='inline-flex items-center gap-1'>
                    Mastery <MasteryInfo />
                  </span>
                </TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {classes.data.map((c) => {
                const b = band(c.mastery)
                return (
                  <TableRow key={`${c.sectionId}-${c.subjectId}`} className='cursor-pointer' onClick={() => setOpen(c)}>
                    <TableCell className='font-medium'>{c.className}</TableCell>
                    <TableCell>
                      <span className='flex items-center gap-2'>
                        <SubjectBadge subject={c.subjectName} className='size-8' />
                        {c.subjectName}
                      </span>
                    </TableCell>
                    <TableCell className='text-muted-foreground'>{c.teacherName}</TableCell>
                    <TableCell className='text-center tabular-nums'>{c.students}</TableCell>
                    <TableCell className='text-center tabular-nums'>{c.workSet}</TableCell>
                    <TableCell>
                      <div className='flex items-center gap-2'>
                        <div className='h-2 w-24 overflow-hidden rounded-full bg-muted'>
                          <div className='h-full rounded-full bg-primary' style={{ width: `${(c.handinRate ?? 0) * 100}%` }} />
                        </div>
                        <span className='text-sm tabular-nums'>{pct(c.handinRate)}</span>
                      </div>
                    </TableCell>
                    <TableCell className={cn('text-center tabular-nums', (c.averageScore ?? 1) < 0.5 && 'text-destructive')}>
                      {pct(c.averageScore)}
                    </TableCell>
                    <TableCell className={cn('text-sm font-medium', b.text)}>{c.mastery === null ? b.label : `${pct(c.mastery)} · ${b.label}`}</TableCell>
                    <TableCell>
                      <ChevronRight className='size-4 text-muted-foreground' />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <Sheet open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className='w-full sm:max-w-xl'>
          {open && <ClassTrendSheet c={open} />}
        </SheetContent>
      </Sheet>
    </Page>
  )
}

function ClassTrendSheet({ c }: { c: SchoolClass }) {
  const trend = useQuery({
    queryKey: ['trend', c.sectionId, c.subjectId],
    queryFn: () => api.classTrend(c.sectionId, c.subjectId),
  })
  return (
    <>
      <SheetHeader>
        <SheetTitle>
          Class {c.className} · {c.subjectName}
        </SheetTitle>
        <SheetDescription>
          {c.teacherName} · {c.students} students · {c.workSet} pieces of work
        </SheetDescription>
      </SheetHeader>
      <div className='px-4'>
        <ChangeTeacher c={c} />
      </div>
      <div className='space-y-4 overflow-y-auto px-4 pb-6'>
        {trend.isPending ? (
          <Loading what='the trend' />
        ) : trend.isError ? (
          <Problem error={trend.error} />
        ) : (
          <>
            <TrendChart points={trend.data} />
            <ul className='divide-y rounded-md border text-sm'>
              {[...trend.data].reverse().map((t) => (
                <li key={t.assignmentId} className='flex justify-between gap-3 px-3 py-2'>
                  <span className='font-medium'>{t.title}</span>
                  <span className='shrink-0 text-muted-foreground tabular-nums'>
                    {t.handedIn}/{t.students} in · {pct(t.averageScore)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <LikelyMisconceptions sectionId={c.sectionId} subjectId={c.subjectId} />
        <Button asChild variant='outline' className='w-full'>
          <Link to='/school/students' search={{ section: c.sectionId }}>
            See Class {c.className}’s students
          </Link>
        </Button>
      </div>
    </>
  )
}

/** Gives the class to another teacher (lms.set_teaching): the new one first, then the old one off. */
function ChangeTeacher({ c }: { c: SchoolClass }) {
  const queryClient = useQueryClient()
  const teachers = useQuery({ queryKey: ['school', 'teachers'], queryFn: api.schoolTeachers })
  const [next, setNext] = useState<string>('')
  const move = useMutation({
    mutationFn: async () => {
      await api.setTeaching(c.sectionId, c.subjectId, next, true)
      await api.setTeaching(c.sectionId, c.subjectId, c.teacherLoginId, false)
    },
    onSuccess: () => {
      toast.success('The class has a new teacher.')
      queryClient.invalidateQueries({ queryKey: ['school'] })
      setNext('')
    },
    onError: (e) => toast.error(friendlyError(e)),
  })
  const others = (teachers.data ?? []).filter((t) => t.loginId !== c.teacherLoginId)
  return (
    <div className='flex flex-wrap items-end gap-2 rounded-lg border p-3'>
      <div className='min-w-48 flex-1 space-y-1'>
        <p className='text-xs font-medium text-muted-foreground'>Give this class to</p>
        <Select value={next} onValueChange={setNext}>
          <SelectTrigger aria-label='New teacher' className='w-full'>
            <SelectValue placeholder='Choose a teacher' />
          </SelectTrigger>
          <SelectContent>
            {others.map((t) => (
              <SelectItem key={t.loginId} value={t.loginId}>
                {t.displayName} ({t.loginId})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button disabled={!next || move.isPending} onClick={() => move.mutate()}>
        {move.isPending ? 'Saving…' : 'Change teacher'}
      </Button>
    </div>
  )
}
