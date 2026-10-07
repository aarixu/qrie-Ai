import type { InvoiceStatus } from '@ai-tutor/admin-client';
import { useState } from 'react';
import { billing } from '@/lib/client';
import { useMe } from '@/lib/me';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AdminPage } from '@/components/admin-page';
import { billingRights } from './model.ts';
import { Empty, InvoiceTable, RaiseDialog, ReadState } from './parts.tsx';
import { useLoad } from './use-load.ts';

const FILTERS: { value: InvoiceStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All invoices' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partly_paid', label: 'Partly paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
];

/** Every invoice, newest first, with its actions. */
export function InvoicesPage() {
  const rights = billingRights(useMe().role);
  const [status, setStatus] = useState<InvoiceStatus | 'all'>('all');
  const [raising, setRaising] = useState(false);
  const list = useLoad(() => billing.invoices(status === 'all' ? undefined : { status }), status);
  return (
    <AdminPage
      title='Invoices'
      actions={
        <div className='flex gap-2'>
          <Select value={status} onValueChange={(v) => setStatus(v as InvoiceStatus | 'all')}>
            <SelectTrigger className='w-40'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {rights.raise && <Button onClick={() => setRaising(true)}>Raise an invoice</Button>}
        </div>
      }
    >
      <ReadState loading={list.loading} refused={list.refused} error={list.error} hasData={list.data !== null} onRetry={() => void list.reload()} />
      {list.data && !list.refused && (
        <Card className='py-0'>
          <CardContent className='px-0'>
            {list.data.length === 0 ? (
              <div className='px-4'>
                <Empty>No invoices yet. Raise one from here or from a school's billing page.</Empty>
              </div>
            ) : (
              <InvoiceTable rows={list.data} rights={rights} onChanged={() => void list.reload()} />
            )}
          </CardContent>
        </Card>
      )}
      {raising && (
        <RaiseDialog
          onClose={() => {
            setRaising(false);
            void list.reload();
          }}
        />
      )}
    </AdminPage>
  );
}
