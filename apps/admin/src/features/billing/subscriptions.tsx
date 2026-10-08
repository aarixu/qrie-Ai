import { useState } from 'react';
import { billing } from '@/lib/client';
import { useMe } from '@/lib/me';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AdminPage } from '@/components/admin-page';
import { billingRights } from './model.ts';
import { Empty, RaiseDialog, ReadState, SubscriptionTable } from './parts.tsx';
import { useLoad } from './use-load.ts';

/** What each school has bought: plan, seats, period, the price per seat it was sold at. */
export function SubscriptionsPage() {
  const rights = billingRights(useMe().role);
  const [creating, setCreating] = useState(false);
  const list = useLoad(() => billing.subscriptions());
  return (
    <AdminPage title='Subscriptions' actions={rights.raise && <Button onClick={() => setCreating(true)}>New subscription</Button>}>
      <ReadState loading={list.loading} refused={list.refused} error={list.error} hasData={list.data !== null} onRetry={() => void list.reload()} />
      {list.data && !list.refused && (
        <Card className='py-0'>
          <CardContent className='px-0'>
            {list.data.length === 0 ? (
              <div className='px-4'>
                <Empty>No subscriptions yet.</Empty>
              </div>
            ) : (
              <SubscriptionTable rows={list.data} />
            )}
          </CardContent>
        </Card>
      )}
      {creating && (
        <RaiseDialog
          kind='subscription'
          onClose={() => {
            setCreating(false);
            void list.reload();
          }}
        />
      )}
    </AdminPage>
  );
}
