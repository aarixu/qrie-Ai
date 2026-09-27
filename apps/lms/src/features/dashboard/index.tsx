import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { formatDistanceToNowStrict } from 'date-fns'
import { CalendarPlus, Users } from 'lucide-react'
import type { TaughtClass } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import { useAuthStore } from '@/stores/auth-store'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loading, Page, Problem } from '@/components/layout/page'
import { EventDialog } from '@/features/events/event-dialog'
import { UpcomingList } from '@/features/events/upcoming'

export const className = (c: Pick<TaughtClass, 'grade' | 'sectionName'>) =>
  `Class ${c.grade}${c.sectionName}`

export function Dashboard() {
  const me = useAuthStore((s) => s.me)
  const classes = useQuery({ queryKey: ['classes'], queryFn: api.myClasses })
  const [eventOpen, setEventOpen] = useState(false)
  // One entry per section the teacher teaches, and the whole school for the admin.
  const audiences = [
    ...(me?.kind === 'admin' ? [{ sectionId: null, label: 'The whole school' }] : []),
    ...[...new Map((classes.data ?? []).map((c) => [c.sectionId, c])).values()].map((c) => ({
      sectionId: c.sectionId,
      label: `${className(c)} only`,
    })),
  ]

  return (
    <Page
      title='My classes'
      description={me ? `Signed in as ${me.displayName}, ${me.schoolName}.` : undefined}
      actions={
        audiences.length > 0 && (
          <Button variant='outline' onClick={() => setEventOpen(true)}>
            <CalendarPlus /> New event
          </Button>
        )
      }
    >
      {classes.isPending ? (
        <Loading what='your classes' />
      ) : classes.isError ? (
        <Problem error={classes.error} />
      ) : classes.data.length === 0 ? (
        <p className='text-muted-foreground'>
          You have no classes yet. Your school decides which classes you
          teach; ask the school office to add them.
        </p>
      ) : (
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {classes.data.map((c) => (
            <ClassCard key={`${c.sectionId}/${c.subjectId}`} c={c} />
          ))}
        </div>
      )}
      <section className='mt-8'>
        <h2 className='mb-2 text-lg font-semibold'>Coming up</h2>
        <UpcomingList empty='Nothing coming up. Tests you set and events you post appear here.' />
      </section>
      {audiences.length > 0 && <EventDialog open={eventOpen} onOpenChange={setEventOpen} audiences={audiences} />}
    </Page>
  )
}

function ClassCard({ c }: { c: TaughtClass }) {
  const work = useQuery({
    queryKey: ['class-assignments', c.sectionId, c.subjectId],
    queryFn: () => api.classAssignments(c.sectionId, c.subjectId),
  })
  const published = work.data?.filter((a) => a.published) ?? []
  const drafts = (work.data?.length ?? 0) - published.length
  const next = published
    .filter((a) => new Date(a.dueAt) > new Date())
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0]
  const last = published
    .filter((a) => new Date(a.dueAt) <= new Date())
    .sort((a, b) => b.dueAt.localeCompare(a.dueAt))[0]

  return (
    <Link
      to='/classes/$sectionId/$subjectId'
      params={{ sectionId: c.sectionId, subjectId: c.subjectId }}
      className='rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
    >
      <Card className='h-full transition-colors hover:bg-accent/50'>
        <CardHeader>
          <CardTitle>
            {className(c)} · {c.subjectName}
          </CardTitle>
          <CardDescription className='flex items-center gap-1'>
            <Users className='size-4' /> {c.students} students
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-1 text-sm'>
          {work.isPending ? (
            <p className='text-muted-foreground'>Loading homework…</p>
          ) : work.isError ? (
            <Problem error={work.error} />
          ) : (
            <>
              <p>
                {published.length} homework set
                {drafts > 0 && `, ${drafts} draft${drafts > 1 ? 's' : ''}`}
              </p>
              {next && (
                <p className='text-muted-foreground'>
                  Due {formatDistanceToNowStrict(new Date(next.dueAt), { addSuffix: true })}:{' '}
                  {next.title} — {next.submitted}/{next.students} handed in
                </p>
              )}
              {last && (
                <p className='text-muted-foreground'>
                  Last closed: {last.title} — {last.submitted}/{last.students} handed in
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}
