import { useState } from 'react';
import { billing } from '@/lib/client';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AdminPage } from '@/components/admin-page';
import type { Tone } from './model.ts';
import { Empty, ReadState, ToneBadge } from './parts.tsx';
import { useLoad } from './use-load.ts';

const STATUS_TONE: Record<string, Tone> = {
  processed: 'ok',
  ignored: 'grey',
  stored: 'warn',
  mismatch: 'bad',
  unparsed: 'warn',
  signature_failed: 'bad',
};

const time = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** What Cashfree sent, newest first: never a payload or a customer, only what was done with each call. */
export function WebhooksPage() {
  const [problems, setProblems] = useState(false);
  const log = useLoad(() => billing.webhookLog(problems), String(problems));
  return (
    <AdminPage
      title='Webhook log'
      actions={
        <div className='flex items-center gap-2'>
          <Switch id='problems-only' checked={problems} onCheckedChange={setProblems} />
          <Label htmlFor='problems-only'>Problems only</Label>
        </div>
      }
    >
      <ReadState loading={log.loading} refused={log.refused} error={log.error} hasData={log.data !== null} onRetry={() => void log.reload()} />
      {log.data && !log.refused && (
        <Card className='py-0'>
          <CardContent className='px-0'>
            {log.data.length === 0 ? (
              <div className='px-4'>
                <Empty>{problems ? 'No problems.' : 'Cashfree has not called yet.'}</Empty>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time (India)</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Link</TableHead>
                    <TableHead>Order</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {log.data.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell className='tabular-nums'>{time(w.receivedAt)}</TableCell>
                      <TableCell className='text-xs'>{w.eventType ?? '—'}</TableCell>
                      <TableCell className='font-mono text-xs'>{w.linkId ?? '—'}</TableCell>
                      <TableCell className='font-mono text-xs'>{w.orderId ?? '—'}</TableCell>
                      <TableCell>
                        <ToneBadge tone={STATUS_TONE[w.status] ?? 'grey'}>{w.status.replace('_', ' ')}</ToneBadge>
                      </TableCell>
                      <TableCell className='text-xs whitespace-normal'>{w.detail ?? ''}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </AdminPage>
  );
}
