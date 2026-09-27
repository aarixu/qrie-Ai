import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { UserPlus } from 'lucide-react'
import { api } from '@/lib/backend'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Loading, Page, Problem } from '@/components/layout/page'
import { ChartCard } from '@/features/analytics/charts'
import { ResetPinButton } from './reset-pin'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

/** The school's teachers and what each has set and has waiting (lms.school_teachers). */
export function SchoolTeachersPage() {
  const teachers = useQuery({ queryKey: ['school', 'teachers'], queryFn: api.schoolTeachers })
  return (
    <Page
      title='Teachers'
      description='Who teaches what, what they have set, and what is waiting on them.'
      actions={
        <Button asChild variant='outline'>
          <Link to='/school/people'>
            <UserPlus /> Add teachers
          </Link>
        </Button>
      }
    >
      {teachers.isPending ? (
        <Loading what='the teachers' />
      ) : teachers.isError ? (
        <Problem error={teachers.error} />
      ) : (
        <div className='space-y-6'>
          <ChartCard title='Work set in the last 30 days'>
            <ResponsiveContainer width='100%' height={220}>
              <BarChart
                data={teachers.data.filter((t) => t.kind === 'teacher').map((t) => ({ name: t.displayName.split(' ')[0], Work: t.workSet30d }))}
                margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray='3 3' stroke='var(--border)' vertical={false} />
                <XAxis dataKey='name' tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} width={32} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} cursor={{ fill: 'var(--muted)' }} />
                <Bar dataKey='Work' fill='var(--chart-1)' radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <div className='overflow-x-auto rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>School ID</TableHead>
                  <TableHead className='text-center'>Classes</TableHead>
                  <TableHead className='text-center'>Work set</TableHead>
                  <TableHead className='text-center'>Last 30 days</TableHead>
                  <TableHead className='text-center'>Photos to mark</TableHead>
                  <TableHead className='text-center'>Tests to release</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {teachers.data.map((t) => (
                  <TableRow key={t.userId}>
                    <TableCell className='font-medium'>
                      {t.displayName} {t.kind === 'admin' && <Badge variant='secondary'>Admin</Badge>}
                    </TableCell>
                    <TableCell className='font-mono text-sm'>{t.loginId}</TableCell>
                    <TableCell className='text-center tabular-nums'>{t.classes}</TableCell>
                    <TableCell className='text-center tabular-nums'>{t.workSet}</TableCell>
                    <TableCell className='text-center tabular-nums'>{t.workSet30d}</TableCell>
                    <TableCell className={cn('text-center tabular-nums', t.photosToMark > 0 && 'font-medium text-orange-600')}>
                      {t.photosToMark}
                    </TableCell>
                    <TableCell className={cn('text-center tabular-nums', t.testsToRelease > 0 && 'font-medium text-orange-600')}>
                      {t.testsToRelease}
                    </TableCell>
                    <TableCell className='text-end'>
                      <ResetPinButton loginId={t.loginId} name={t.displayName} size='sm' />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </Page>
  )
}
