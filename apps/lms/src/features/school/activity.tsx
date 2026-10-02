import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import type { AuditEvent } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Loading, Page, Problem } from '@/components/layout/page'

const WORDS: Record<string, string> = {
  left: 'Marked as left',
  restored: 'Brought back',
  'teaching-added': 'Class given',
  'teaching-removed': 'Class taken away',
  'photo-set': 'Photo changed',
  'photo-removed': 'Photo removed',
  'logo-set': 'Logo changed',
  'logo-removed': 'Logo removed',
  'colours-set': 'Colours changed',
  'pin-reset': 'New PIN given',
  'people-added': 'People added',
}

/** What the school's admins have done, newest first (lms.audit_log). */
export function SchoolActivityPage() {
  const log = useQuery({ queryKey: ['school', 'audit'], queryFn: () => api.auditLog(200) })
  return (
    <Page title='Activity log' description='Every change to who is in the school, who teaches what, and how it looks. Newest first.'>
      {log.isPending ? (
        <Loading what='the activity log' />
      ) : log.isError ? (
        <Problem error={log.error} />
      ) : log.data.length === 0 ? (
        <p className='text-muted-foreground'>Nothing has been changed yet.</p>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-44'>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>What</TableHead>
                <TableHead>About</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {log.data.map((e: AuditEvent, i) => (
                <TableRow key={`${e.at}-${i}`}>
                  <TableCell className='text-muted-foreground tabular-nums'>{format(new Date(e.at), 'd MMM yyyy, h:mm a')}</TableCell>
                  <TableCell className='font-medium'>{e.actorName ?? 'The system'}</TableCell>
                  <TableCell>
                    <Badge variant='secondary'>{WORDS[e.action] ?? e.action}</Badge>
                  </TableCell>
                  <TableCell className='font-mono text-xs'>{e.target || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Page>
  )
}
