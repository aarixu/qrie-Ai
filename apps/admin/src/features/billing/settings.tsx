import type { BillingSettings } from '@ai-tutor/admin-client';
import { useState } from 'react';
import { toast } from 'sonner';
import { billing } from '@/lib/client';
import { useMe } from '@/lib/me';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { AdminPage } from '@/components/admin-page';
import { billingRights } from './model.ts';
import { ReadState, ToneBadge } from './parts.tsx';
import { useLoad } from './use-load.ts';
import { WriteDialog } from './write-dialog.tsx';

/**
 * Qrie's own details as the seller, printed on every invoice. Whether Qrie is
 * registered for GST, the SAC code, the rate and the invoice's title are the
 * CA's decisions; the owner enters them here.
 */
export function SettingsPage() {
  const rights = billingRights(useMe().role);
  const [editing, setEditing] = useState(false);
  const s = useLoad(() => billing.settings());
  const d = s.data;
  return (
    <AdminPage title='Billing settings' actions={rights.settings && d && <Button onClick={() => setEditing(true)}>Edit</Button>}>
      <ReadState loading={s.loading} refused={s.refused} error={s.error} hasData={d !== null} onRetry={() => void s.reload()} />
      {d && !s.refused && (
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-base'>
              The seller{' '}
              <ToneBadge tone={d.ready ? 'ok' : 'bad'}>{d.ready ? 'Ready to invoice' : 'Not ready: no invoice can be raised'}</ToneBadge>
            </CardTitle>
            <CardDescription>These are the CA's decisions. Invoices already issued keep the details they were issued with.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {[
                  ['Legal name', d.legalName || '—'],
                  ['GSTIN', d.gstin ?? 'Not registered'],
                  ['State code', d.stateCode || '—'],
                  ['Address', d.address || '—'],
                  ['SAC code', d.sacCode || '—'],
                  ['GST rate', d.gstRateBp === null ? '—' : `${d.gstRateBp / 100}%`],
                  ['Invoice title', d.title],
                ].map(([k, v]) => (
                  <TableRow key={k}>
                    <TableCell className='w-48 text-muted-foreground'>{k}</TableCell>
                    <TableCell className='whitespace-normal'>{v}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {editing && d && (
        <SettingsDialog
          current={d}
          onClose={() => {
            setEditing(false);
            void s.reload();
          }}
        />
      )}
    </AdminPage>
  );
}

function SettingsDialog({ current, onClose }: { current: BillingSettings; onClose: () => void }) {
  const [legalName, setLegalName] = useState(current.legalName);
  const [gstin, setGstin] = useState(current.gstin ?? '');
  const [stateCode, setStateCode] = useState(current.stateCode);
  const [address, setAddress] = useState(current.address);
  const [sacCode, setSacCode] = useState(current.sacCode);
  const [rate, setRate] = useState(current.gstRateBp === null ? '' : String(current.gstRateBp / 100));
  const [title, setTitle] = useState(current.title);
  return (
    <WriteDialog
      title='Edit the seller'
      blast='Every invoice raised from now on carries these details. Invoices already issued keep theirs.'
      guarded
      confirmLabel='Save'
      onClose={onClose}
      onConfirm={async ({ env, reason }) => {
        const percent = Number(rate);
        if (rate.trim() === '' || !Number.isFinite(percent)) throw new Error('Enter the GST rate as a percentage, such as 18.');
        await billing.settingsSet({
          legalName,
          gstin: gstin.trim() === '' ? null : gstin,
          stateCode,
          address,
          sacCode,
          gstRateBp: Math.round(percent * 100),
          title,
          reason,
          env,
        });
        toast.success('Seller details saved.');
      }}
    >
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='space-y-1 sm:col-span-2'>
          <Label htmlFor='seller-name'>Legal name</Label>
          <Input id='seller-name' value={legalName} onChange={(e) => setLegalName(e.target.value)} />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='seller-gstin'>GSTIN (empty if not registered)</Label>
          <Input id='seller-gstin' value={gstin} onChange={(e) => setGstin(e.target.value)} />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='seller-state'>State code</Label>
          <Input id='seller-state' inputMode='numeric' value={stateCode} onChange={(e) => setStateCode(e.target.value)} placeholder='27' />
        </div>
        <div className='space-y-1 sm:col-span-2'>
          <Label htmlFor='seller-address'>Address</Label>
          <Input id='seller-address' value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='seller-sac'>SAC code</Label>
          <Input id='seller-sac' inputMode='numeric' value={sacCode} onChange={(e) => setSacCode(e.target.value)} />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='seller-rate'>GST rate, %</Label>
          <Input id='seller-rate' inputMode='decimal' value={rate} onChange={(e) => setRate(e.target.value)} placeholder='18' />
        </div>
        <div className='space-y-1 sm:col-span-2'>
          <Label htmlFor='seller-title'>Invoice title</Label>
          <Input id='seller-title' value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
      </div>
    </WriteDialog>
  );
}
