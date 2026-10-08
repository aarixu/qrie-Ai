import type { BillingAccount, SchoolBilling } from '@ai-tutor/admin-client';
import { useState } from 'react';
import { toast } from 'sonner';
import { billing } from '@/lib/client';
import { useMe } from '@/lib/me';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { billingRights, formatDay, stateLabel, type Tone } from './model.ts';
import { Empty, InvoiceTable, PaymentTable, RaiseDialog, ReadState, RecordPaymentDialog, SubscriptionTable, ToneBadge } from './parts.tsx';
import { useLoad } from './use-load.ts';
import { WriteDialog } from './write-dialog.tsx';

const SIGNAL_TONE: Record<SchoolBilling['signal']['level'], Tone> = { green: 'ok', amber: 'warn', red: 'bad', grey: 'grey' };

type Open = 'account' | 'grace' | 'subscription' | 'raise' | 'record' | null;

/**
 * ONE SCHOOL'S BILLING (seam S2: plan 2's school page renders this as its
 * Billing tab; the console's own /billing/schools/$orgId frames it too).
 *
 * Its billing contact is shown in full here, one record at a time, and in no
 * list. The actions shown follow the role; the database refuses the rest.
 */
export function SchoolBillingTab(props: { orgId: string; code: string }) {
  const page = useLoad(() => billing.school(props.orgId), props.orgId);
  return (
    <>
      <ReadState loading={page.loading} refused={page.refused} error={page.error} hasData={page.data !== null} onRetry={() => void page.reload()} />
      {page.data && !page.refused && <SchoolBillingView data={page.data} code={props.code} onChanged={() => void page.reload()} />}
    </>
  );
}

export function SchoolBillingView({ data, code, onChanged }: { data: SchoolBilling; code: string; onChanged: () => void }) {
  const rights = billingRights(useMe().role);
  const [open, setOpen] = useState<Open>(null);
  const close = () => {
    setOpen(null);
    onChanged();
  };
  const state = stateLabel(data.state.state, data.state.graceUntil);
  const a = data.account;
  return (
    <div className='space-y-4'>
      <div className='grid gap-4 md:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle className='flex flex-wrap items-center gap-2 text-base'>
              Licence <ToneBadge tone={state.tone}>{state.text}</ToneBadge>
            </CardTitle>
            <CardDescription>
              <ToneBadge tone={SIGNAL_TONE[data.signal.level]}>Payment</ToneBadge> {data.signal.reason}
            </CardDescription>
          </CardHeader>
          <CardContent className='text-sm'>
            {data.licence ? (
              <p>
                {data.licence.plan} · {data.licence.seatsUsed} of {data.licence.seats} seats in use · last day {formatDay(data.licence.validUntil)}
              </p>
            ) : (
              <p className='text-muted-foreground'>No licence set.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Billing account</CardTitle>
            <CardDescription>{a ? `Grace after the licence ends: ${a.graceDays} days.` : `${code} has no billing account.`}</CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            {a ? (
              <Table>
                <TableBody>
                  {[
                    ['Legal name', a.legalName],
                    ['GSTIN', a.gstin ?? 'Unregistered'],
                    ['State code', a.stateCode],
                    ['Address', a.address],
                    ['Contact', a.contactName],
                    ['Email', a.contactEmail ?? '—'],
                    ['Phone', a.contactPhone ?? '—'],
                  ].map(([k, v]) => (
                    <TableRow key={k}>
                      <TableCell className='w-32 text-muted-foreground'>{k}</TableCell>
                      <TableCell className='whitespace-normal'>{v}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Empty>No billing account yet. Set one up to raise an invoice.</Empty>
            )}
            <div className='flex flex-wrap gap-2'>
              {rights.raise && (
                <Button size='sm' variant='outline' onClick={() => setOpen('account')}>
                  {a ? 'Edit' : 'Set up the billing account'}
                </Button>
              )}
              {rights.grace && a && (
                <Button size='sm' variant='outline' onClick={() => setOpen('grace')}>
                  Grace days
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {a && (
        <div className='flex flex-wrap gap-2'>
          {rights.raise && <Button onClick={() => setOpen('subscription')}>New subscription</Button>}
          {rights.raise && (
            <Button variant='outline' onClick={() => setOpen('raise')}>
              Raise an invoice
            </Button>
          )}
          {rights.record && (
            <Button variant='outline' onClick={() => setOpen('record')}>
              Record a payment
            </Button>
          )}
        </div>
      )}

      <Card className='py-0'>
        <CardHeader className='pt-4'>
          <CardTitle className='text-base'>Subscriptions</CardTitle>
        </CardHeader>
        <CardContent className='px-0'>
          {data.subscriptions.length === 0 ? <Empty>No subscriptions yet.</Empty> : <SubscriptionTable rows={data.subscriptions} showSchool={false} />}
        </CardContent>
      </Card>
      <Card className='py-0'>
        <CardHeader className='pt-4'>
          <CardTitle className='text-base'>Invoices</CardTitle>
        </CardHeader>
        <CardContent className='px-0'>
          {data.invoices.length === 0 ? (
            <Empty>No invoices yet.</Empty>
          ) : (
            <InvoiceTable rows={data.invoices} rights={rights} onChanged={onChanged} showSchool={false} />
          )}
        </CardContent>
      </Card>
      <Card className='py-0'>
        <CardHeader className='pt-4'>
          <CardTitle className='text-base'>Payments</CardTitle>
        </CardHeader>
        <CardContent className='px-0'>
          {data.payments.length === 0 ? (
            <Empty>No payments yet.</Empty>
          ) : (
            <PaymentTable rows={data.payments} rights={rights} onChanged={onChanged} showSchool={false} />
          )}
        </CardContent>
      </Card>

      {open === 'account' && <AccountDialog orgId={data.school.orgId} code={data.school.code} current={a} onClose={close} />}
      {open === 'grace' && a && <GraceDialog orgId={data.school.orgId} code={data.school.code} current={a.graceDays} onClose={close} />}
      {open === 'subscription' && <RaiseDialog orgId={data.school.orgId} kind='subscription' onClose={close} />}
      {open === 'raise' && <RaiseDialog orgId={data.school.orgId} kind='other' onClose={close} />}
      {open === 'record' && <RecordPaymentDialog orgId={data.school.orgId} onClose={close} />}
    </div>
  );
}

function AccountDialog({ orgId, code, current, onClose }: { orgId: string; code: string; current: BillingAccount | null; onClose: () => void }) {
  const [legalName, setLegalName] = useState(current?.legalName ?? '');
  const [gstin, setGstin] = useState(current?.gstin ?? '');
  const [stateCode, setStateCode] = useState(current?.stateCode ?? '');
  const [address, setAddress] = useState(current?.address ?? '');
  const [contactName, setContactName] = useState(current?.contactName ?? '');
  const [contactEmail, setContactEmail] = useState(current?.contactEmail ?? '');
  const [contactPhone, setContactPhone] = useState(current?.contactPhone ?? '');
  const field = (id: string, label: string, value: string, set: (v: string) => void, wide = false) => (
    <div className={wide ? 'space-y-1 sm:col-span-2' : 'space-y-1'}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => set(e.target.value)} />
    </div>
  );
  return (
    <WriteDialog
      title={`${code}'s billing account`}
      blast='Invoices raised from now on carry these details; issued ones keep theirs. Payment links go to this phone, and to this email when there is one.'
      confirmLabel='Save'
      onClose={onClose}
      onConfirm={async ({ env, reason }) => {
        await billing.accountSet({
          orgId,
          legalName,
          gstin: gstin.trim() === '' ? null : gstin,
          stateCode,
          address,
          contactName,
          contactEmail: contactEmail.trim() === '' ? null : contactEmail,
          contactPhone: contactPhone.trim() === '' ? null : contactPhone,
          reason,
          env,
        });
        toast.success(`${code}'s billing account saved.`);
      }}
    >
      <div className='grid gap-3 sm:grid-cols-2'>
        {field('acct-name', 'Legal name', legalName, setLegalName, true)}
        {field('acct-gstin', 'GSTIN (empty if unregistered)', gstin, setGstin)}
        {field('acct-state', 'State code', stateCode, setStateCode)}
        {field('acct-address', 'Billing address', address, setAddress, true)}
        {field('acct-contact', 'Billing contact', contactName, setContactName)}
        {field('acct-phone', 'Phone (10 digits)', contactPhone, setContactPhone)}
        {field('acct-email', 'Email', contactEmail, setContactEmail, true)}
      </div>
    </WriteDialog>
  );
}

function GraceDialog({ orgId, code, current, onClose }: { orgId: string; code: string; current: number; onClose: () => void }) {
  const [days, setDays] = useState(String(current));
  return (
    <WriteDialog
      title={`Grace days for ${code}`}
      blast={`After its licence's last day, ${code} keeps the tutor for ${days} days before it is suspended.`}
      guarded
      confirmLabel='Save'
      onClose={onClose}
      onConfirm={async ({ env, reason }) => {
        await billing.graceSet(orgId, Number(days), reason, env);
        toast.success(`${code} now has ${days} days of grace.`);
      }}
    >
      <div className='space-y-1'>
        <Label htmlFor='grace-days'>Days, 14 to 30</Label>
        <Input id='grace-days' inputMode='numeric' value={days} onChange={(e) => setDays(e.target.value)} />
      </div>
    </WriteDialog>
  );
}
