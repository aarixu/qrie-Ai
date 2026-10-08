import { useState } from 'react';
import { billing } from '@/lib/client';
import { useMe } from '@/lib/me';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminPage } from '@/components/admin-page';
import { billingRights } from './model.ts';
import { Empty, PaymentTable, ReadState, RecordPaymentDialog } from './parts.tsx';
import { useLoad } from './use-load.ts';

/**
 * Money received. First the payments that were not counted against their
 * invoice (wrong amount, wrong currency, another invoice's notes, a void
 * invoice, more than was due): each needs a refund or a call. Then every
 * payment, newest first.
 */
export function PaymentsPage() {
  const rights = billingRights(useMe().role);
  const [recording, setRecording] = useState(false);
  const list = useLoad(() => billing.payments());
  const attention = (list.data ?? []).filter((p) => !p.counted && p.refundedPaise < p.amountPaise);
  const reload = () => void list.reload();
  return (
    <AdminPage title='Payments' actions={rights.record && <Button onClick={() => setRecording(true)}>Record a payment</Button>}>
      <ReadState loading={list.loading} refused={list.refused} error={list.error} hasData={list.data !== null} onRetry={reload} />
      {list.data && !list.refused && (
        <div className='space-y-4'>
          {attention.length > 0 && (
            <Card className='border-l-4 border-l-red-600'>
              <CardHeader>
                <CardTitle className='text-base'>Needs attention</CardTitle>
                <CardDescription>Received but not counted against an invoice: refund it, or call the school.</CardDescription>
              </CardHeader>
              <CardContent className='px-0'>
                <PaymentTable rows={attention} rights={rights} onChanged={reload} />
              </CardContent>
            </Card>
          )}
          <Card className='py-0'>
            <CardContent className='px-0'>
              {list.data.length === 0 ? (
                <div className='px-4'>
                  <Empty>No payments yet.</Empty>
                </div>
              ) : (
                <PaymentTable rows={list.data} rights={rights} onChanged={reload} />
              )}
            </CardContent>
          </Card>
        </div>
      )}
      {recording && (
        <RecordPaymentDialog
          onClose={() => {
            setRecording(false);
            reload();
          }}
        />
      )}
    </AdminPage>
  );
}
