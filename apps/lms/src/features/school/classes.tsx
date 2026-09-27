import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import type { SchoolClass } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
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
import { useSchoolClasses } from './overview'

/** Every class and subject in the school, with how it is going (lms.school_classes). */
export function SchoolClassesPage() {
  const classes = useSchoolClasses()
  const [open, setOpen] = useState<SchoolClass | null>(null)
  return (
    <Page title='Classes' description='Every section and subject, all work due so far. Open one for its trend.'>
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
                <TableHead>Mastery</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {classes.data.map((c) => {
                const b = band(c.mastery)
                return (
                  <TableRow key={`${c.sectionId}-${c.subjectId}`} className='cursor-pointer' onClick={() => setOpen(c)}>
                    <TableCell className='font-medium'>{c.className}</TableCell>
                    <TableCell>{c.subjectName}</TableCell>
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
        <Button asChild variant='outline' className='w-full'>
          <Link to='/school/students' search={{ section: c.sectionId }}>
            See Class {c.className}’s students
          </Link>
        </Button>
      </div>
    </>
  )
}
