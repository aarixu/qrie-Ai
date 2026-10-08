import { Link } from '@tanstack/react-router';
import { billing } from '@/lib/client';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AdminPage } from '@/components/admin-page';
import { formatDay, stateLabel } from './model.ts';
import { formatPaise } from './money.ts';
import { Empty, ReadState, ToneBadge } from './parts.tsx';
import { useLoad } from './use-load.ts';

/** Every school with its billing state. No contact here: a school's own page shows its billing contact. */
export function BillingSchoolsPage() {
  const list = useLoad(() => billing.accounts());
  return (
    <AdminPage title='Schools and billing'>
      <ReadState loading={list.loading} refused={list.refused} error={list.error} hasData={list.data !== null} onRetry={() => void list.reload()} />
      {list.data && !list.refused && (
        <Card className='py-0'>
          <CardContent className='px-0'>
            {list.data.length === 0 ? (
              <div className='px-4'>
                <Empty>No schools yet.</Empty>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>School</TableHead>
                    <TableHead>Billing account</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Licence until</TableHead>
                    <TableHead className='text-end'>Outstanding</TableHead>
                    <TableHead className='text-end'>Days overdue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.data.map((a) => {
                    const s = stateLabel(a.state, null);
                    return (
                      <TableRow key={a.orgId}>
                        <TableCell className='font-mono text-xs'>
                          <Link to='/billing/schools/$orgId' params={{ orgId: a.orgId }} className='underline-offset-4 hover:underline'>
                            {a.code}
                          </Link>
                        </TableCell>
                        <TableCell>{a.name}</TableCell>
                        <TableCell>{a.hasAccount ? 'Set' : 'Not set'}</TableCell>
                        <TableCell>
                          <ToneBadge tone={s.tone}>{a.state === 'grace' ? 'Grace' : s.text}</ToneBadge>
                        </TableCell>
                        <TableCell>{a.licenceUntil ? formatDay(a.licenceUntil) : '—'}</TableCell>
                        <TableCell className='text-end tabular-nums'>{formatPaise(a.outstandingPaise)}</TableCell>
                        <TableCell className='text-end tabular-nums'>{a.overdueDays > 0 ? a.overdueDays : '—'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </AdminPage>
  );
}
