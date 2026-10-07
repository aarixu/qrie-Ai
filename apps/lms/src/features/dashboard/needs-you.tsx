import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { format } from 'date-fns'
import type { NeedsAttention } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Problem } from '@/components/layout/page'

function what(n: NeedsAttention): string {
  const kids = (k: number) => `${k} ${k === 1 ? 'student' : 'students'}`
  switch (n.reason) {
    case 'photos':
      return `Mark ${n.count} ${n.count === 1 ? 'photo' : 'photos'} of work`
    case 'marks':
      return `Enter marks for ${kids(n.count)}`
    case 'release':
      return `Release the results (${n.count} handed in)`
    case 'notebooks':
      return `Check notebooks: ${kids(n.count)} not checked yet`
  }
}

/** Work in the teacher's classes waiting on them (lms.needs_attention). */
export function NeedsYou() {
  const needs = useQuery({ queryKey: ['needs-attention'], queryFn: api.needsAttention })
  if (needs.isPending) return null
  if (needs.isError) return <Problem error={needs.error} />
  return (
    <Card className='mb-6'>
      <CardHeader>
        <CardTitle>Needs you</CardTitle>
        <CardDescription>
          {needs.data.length === 0 ? 'Nothing is waiting on you. All caught up.' : 'Oldest first.'}
        </CardDescription>
      </CardHeader>
      {needs.data.length > 0 && (
        <CardContent>
          <ul className='divide-y'>
            {needs.data.map((n) => (
              <li key={`${n.assignmentId}-${n.reason}`} className='py-2'>
                <Link to='/homework/$assignmentId' params={{ assignmentId: n.assignmentId }} className='group block'>
                  <span className='font-medium group-hover:underline'>{what(n)}</span>
                  <span className='block text-sm text-muted-foreground'>
                    {n.title} · Class {n.className} {n.subjectName} · {n.reason === 'marks' ? 'held' : 'due'}{' '}
                    {format(new Date(n.dueAt), 'd MMM')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  )
}
