import type { InvoiceDetail, InvoiceRow, PaymentRow, SubscriptionRow } from '@ai-tutor/admin-client';
import { Link } from '@tanstack/react-router';
import { Copy } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { billing } from '@/lib/client';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  formatDay,
  invoiceTone,
  linkBlast,
  paymentBlast,
  refundBlast,
  todayIst,
  voidBlast,
  type BillingRights,
  type Tone,
} from './model.ts';
import { formatPaise, parseRupees } from './money.ts';
import { useLoad } from './use-load.ts';
import { WriteDialog } from './write-dialog.tsx';

/**
 * THE PIECES EVERY BILLING PAGE SHARES: the four states of a read, the tone
 * badge, the invoice, payment and subscription tables, and the dialogs for
 * each billing write. Each table hides an action the role may not use
 * (billingRights); the database refuses it anyway.
 */

const TONE_CLASS: Record<Tone, string> = {
  ok: 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400',
  warn: 'border-amber-500/50 text-amber-700 dark:text-amber-400',
  bad: 'border-red-600/50 text-red-700 dark:text-red-400',
  grey: 'text-muted-foreground',
};

export function ToneBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <Badge variant='outline' className={cn(TONE_CLASS[tone])}>
      {children}
    </Badge>
  );
}

/** Loading, refused and error states of a read; null once there is data to show. */
export function ReadState({
  loading,
  refused,
  error,
  hasData,
  onRetry,
}: {
  loading: boolean;
  refused: boolean;
  error: string | null;
  hasData: boolean;
  onRetry: () => void;
}) {
  if (refused) {
    return (
      <Alert>
        <AlertDescription>You do not have access to billing.</AlertDescription>
      </Alert>
    );
  }
  if (error && !hasData) {
    return (
      <Alert variant='destructive'>
        <AlertDescription className='flex flex-wrap items-center gap-3'>
          {error}
          <Button size='sm' variant='outline' onClick={onRetry}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (loading && !hasData) {
    return (
      <div className='space-y-2'>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className='h-9' />
        ))}
      </div>
    );
  }
  return null;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className='py-6 text-sm text-muted-foreground'>{children}</p>;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Link copied.');
  } catch {
    toast.error('Could not copy; select the link and copy it by hand.');
  }
}

/** The link Cashfree made, ready to copy and send (staff send it on WhatsApp themselves). */
export function LinkReady({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Payment link ready</DialogTitle>
          <DialogDescription>Send this link to the school. It is for the amount still due and cannot be paid in parts.</DialogDescription>
        </DialogHeader>
        <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => void copy(url)}>
            <Copy /> Copy link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Send a payment link: reads the school's billing account only to say whether Cashfree will email it. */
export function SendLinkDialog({ invoice, onClose }: { invoice: InvoiceRow; onClose: () => void }) {
  const school = useLoad(() => billing.school(invoice.orgId), invoice.orgId);
  const [url, setUrl] = useState<string | null>(null);
  // The write dialog closes itself on success; the made link is then shown instead.
  const made = useRef<string | null>(null);
  const hasEmail = Boolean(school.data?.account?.contactEmail);
  if (url) return <LinkReady url={url} onClose={onClose} />;
  return (
    <WriteDialog
      title={`Send a payment link for ${invoice.number}`}
      blast={linkBlast(invoice, hasEmail)}
      confirmLabel='Make the link'
      onClose={() => {
        if (made.current) setUrl(made.current);
        else onClose();
      }}
      onConfirm={async ({ env, reason }) => {
        const answer = await billing.sendLink({ invoiceId: invoice.id, reason, env });
        made.current = answer.url;
      }}
    />
  );
}

export function VoidDialog({ invoice, onClose }: { invoice: InvoiceRow; onClose: () => void }) {
  return (
    <WriteDialog
      title={`Void ${invoice.number}?`}
      blast={voidBlast(invoice)}
      guarded
      confirmLabel='Void it'
      onClose={onClose}
      onConfirm={async ({ env, reason }) => {
        await billing.voidInvoice({ invoiceId: invoice.id, reason, env });
        toast.success(`${invoice.number} is void.`);
      }}
    />
  );
}

/**
 * Record a bank transfer or cheque. With `invoiceId` the invoice is fixed; else
 * a picker of what is still due (one school's, with `orgId`).
 */
export function RecordPaymentDialog({ invoiceId, orgId, onClose }: { invoiceId?: string; orgId?: string; onClose: () => void }) {
  const open = useLoad(async () => {
    const [unpaid, partly] = await Promise.all([
      billing.invoices({ orgId, status: 'unpaid' }),
      billing.invoices({ orgId, status: 'partly_paid' }),
    ]);
    return [...partly, ...unpaid];
  });
  const [chosen, setChosen] = useState(invoiceId ?? '');
  const detail = useLoad(async () => (chosen ? billing.invoice(chosen) : null), chosen);
  const subs = useLoad(async () => (detail.data ? billing.subscriptions(detail.data.orgId) : []), detail.data?.id ?? '');
  const [source, setSource] = useState<'bank_transfer' | 'cheque'>('bank_transfer');
  const [amount, setAmount] = useState('');
  const [receivedOn, setReceivedOn] = useState(todayIst());
  const [reference, setReference] = useState('');

  const d: InvoiceDetail | null = detail.data ?? null;
  const due = d ? d.totalPaise - d.paidPaise : 0;
  const parsed = amount.trim() === '' && d ? ({ ok: true, paise: due } as const) : parseRupees(amount);
  const sub = d?.subscriptionId ? subs.data?.find((s) => s.id === d.subscriptionId) : undefined;
  const blast = d && parsed.ok ? paymentBlast(d, parsed.paise, sub ? { seats: sub.seats, endsOn: sub.endsOn } : null) : 'Choose an invoice and an amount.';

  return (
    <WriteDialog
      title='Record a payment'
      blast={blast}
      guarded
      confirmLabel='Record it'
      onClose={onClose}
      onConfirm={async ({ env, reason }) => {
        if (!d) throw new Error('Choose an invoice.');
        if (!parsed.ok) throw new Error(parsed.error);
        const r = await billing.paymentRecord({ invoiceId: d.id, source, amountPaise: parsed.paise, receivedOn, reference, reason, env });
        toast.success(r.licenceSet ? `Recorded. ${d.number} is paid and the licence is set.` : `Recorded. ${d.number} is ${r.invoiceStatus.replace('_', ' ')}.`);
      }}
    >
      <div className='grid gap-3 sm:grid-cols-2'>
        {!invoiceId && (
          <div className='space-y-1 sm:col-span-2'>
            <Label>Invoice</Label>
            <Select value={chosen} onValueChange={setChosen}>
              <SelectTrigger className='w-full'>
                <SelectValue placeholder={open.loading ? 'Loading…' : 'Choose an invoice still due'} />
              </SelectTrigger>
              <SelectContent>
                {(open.data ?? []).map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.number} · {i.schoolCode} · {formatPaise(i.totalPaise - i.paidPaise)} due
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className='space-y-1'>
          <Label>How it came</Label>
          <Select value={source} onValueChange={(v) => setSource(v as 'bank_transfer' | 'cheque')}>
            <SelectTrigger className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='bank_transfer'>Bank transfer</SelectItem>
              <SelectItem value='cheque'>Cheque</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1'>
          <Label htmlFor='pay-amount'>Amount in rupees</Label>
          <Input id='pay-amount' inputMode='decimal' value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={d ? formatPaise(due) : ''} />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='pay-day'>Received on</Label>
          <Input id='pay-day' type='date' value={receivedOn} max={todayIst()} onChange={(e) => setReceivedOn(e.target.value)} />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='pay-ref'>{source === 'cheque' ? 'Cheque number' : 'UTR'}</Label>
          <Input id='pay-ref' value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
      </div>
    </WriteDialog>
  );
}

export function RefundDialog({ payment, onClose }: { payment: PaymentRow; onClose: () => void }) {
  const left = payment.amountPaise - payment.refundedPaise;
  const [amount, setAmount] = useState('');
  const parsed = amount.trim() === '' ? ({ ok: true, paise: left } as const) : parseRupees(amount);
  return (
    <WriteDialog
      title={`Refund a payment of ${formatPaise(payment.amountPaise)}`}
      blast={parsed.ok ? refundBlast(payment, parsed.paise) : parsed.error}
      guarded
      confirmLabel='Ask Cashfree to refund'
      onClose={onClose}
      onConfirm={async ({ env, reason }) => {
        if (!parsed.ok) throw new Error(parsed.error);
        const r = await billing.refund({ paymentId: payment.id, amountPaise: parsed.paise, reason, env });
        toast.success(r.creditNote ? `Refunded. Credit note ${r.creditNote} issued.` : `Refund ${r.status}.`);
      }}
    >
      <div className='space-y-1'>
        <Label htmlFor='refund-amount'>Amount in rupees (up to {formatPaise(left)})</Label>
        <Input id='refund-amount' inputMode='decimal' value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={formatPaise(left)} />
      </div>
    </WriteDialog>
  );
}

type InvoiceAction = { kind: 'link' | 'void'; invoice: InvoiceRow } | null;

/** The actions on one invoice: copy its open link, send a link, check with Cashfree, void. */
export function InvoiceActions({
  invoice,
  rights,
  onChanged,
}: {
  invoice: InvoiceRow;
  rights: BillingRights;
  onChanged: () => void;
}) {
  const [action, setAction] = useState<InvoiceAction>(null);
  const [checking, setChecking] = useState(false);
  const open = invoice.status === 'unpaid' || invoice.status === 'partly_paid';
  const close = () => {
    setAction(null);
    onChanged();
  };
  async function check() {
    setChecking(true);
    try {
      const r = await billing.checkLink(invoice.id);
      toast.success(r.checked === 0 ? 'No open link to check.' : `Checked ${r.checked} link${r.checked === 1 ? '' : 's'}; ${r.changed} changed.`);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setChecking(false);
    }
  }
  return (
    <div className='flex flex-wrap justify-end gap-1'>
      {invoice.openLink?.url && (
        <Button size='sm' variant='ghost' onClick={() => void copy(invoice.openLink!.url!)}>
          <Copy /> Copy link
        </Button>
      )}
      {rights.sendLink && open && !invoice.openLink && (
        <Button size='sm' variant='outline' onClick={() => setAction({ kind: 'link', invoice })}>
          Send link
        </Button>
      )}
      {rights.sendLink && invoice.openLink && (
        <Button size='sm' variant='outline' disabled={checking} onClick={() => void check()}>
          {checking ? 'Checking…' : 'Check with Cashfree'}
        </Button>
      )}
      {rights.void && invoice.status === 'unpaid' && (
        <Button size='sm' variant='ghost' className='text-destructive' onClick={() => setAction({ kind: 'void', invoice })}>
          Void
        </Button>
      )}
      {action?.kind === 'link' && <SendLinkDialog invoice={action.invoice} onClose={close} />}
      {action?.kind === 'void' && <VoidDialog invoice={action.invoice} onClose={close} />}
    </div>
  );
}

export function InvoiceTable({
  rows,
  rights,
  onChanged,
  showSchool = true,
}: {
  rows: InvoiceRow[];
  rights: BillingRights;
  onChanged: () => void;
  showSchool?: boolean;
}) {
  const today = todayIst();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Number</TableHead>
          {showSchool && <TableHead>School</TableHead>}
          <TableHead>Issued</TableHead>
          <TableHead>Due</TableHead>
          <TableHead className='text-end'>Total</TableHead>
          <TableHead className='text-end'>Paid</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Link</TableHead>
          <TableHead className='text-end'>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const t = invoiceTone(r.status, r.dueOn, today);
          return (
            <TableRow key={r.id}>
              <TableCell className='font-mono text-xs'>
                <Link to='/billing/invoices/$invoiceId' params={{ invoiceId: r.id }} className='underline-offset-4 hover:underline'>
                  {r.number}
                </Link>
              </TableCell>
              {showSchool && <TableCell>{r.schoolCode}</TableCell>}
              <TableCell>{formatDay(r.issuedOn)}</TableCell>
              <TableCell>{formatDay(r.dueOn)}</TableCell>
              <TableCell className='text-end tabular-nums'>{formatPaise(r.totalPaise)}</TableCell>
              <TableCell className='text-end tabular-nums'>{formatPaise(r.paidPaise)}</TableCell>
              <TableCell>
                <ToneBadge tone={t.tone}>{t.label}</ToneBadge>
              </TableCell>
              <TableCell className='text-xs text-muted-foreground'>{r.openLink ? r.openLink.status.replace('_', ' ') : '—'}</TableCell>
              <TableCell>
                <InvoiceActions invoice={r} rights={rights} onChanged={onChanged} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

const SOURCE: Record<PaymentRow['source'], string> = { cashfree_link: 'Cashfree link', bank_transfer: 'Bank transfer', cheque: 'Cheque' };

export function PaymentTable({
  rows,
  rights,
  onChanged,
  showSchool = true,
}: {
  rows: PaymentRow[];
  rights: BillingRights;
  onChanged: () => void;
  showSchool?: boolean;
}) {
  const [refunding, setRefunding] = useState<PaymentRow | null>(null);
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            {showSchool && <TableHead>School</TableHead>}
            <TableHead>Invoice</TableHead>
            <TableHead>Source</TableHead>
            <TableHead className='text-end'>Amount</TableHead>
            <TableHead>Received</TableHead>
            <TableHead>Reference</TableHead>
            <TableHead>Recorded by</TableHead>
            <TableHead className='text-end'>Refunded</TableHead>
            <TableHead className='text-end'>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => (
            <TableRow key={p.id}>
              {showSchool && <TableCell>{p.schoolCode}</TableCell>}
              <TableCell className='font-mono text-xs'>
                {p.invoiceId ? (
                  <Link to='/billing/invoices/$invoiceId' params={{ invoiceId: p.invoiceId }} className='underline-offset-4 hover:underline'>
                    {p.invoiceNumber}
                  </Link>
                ) : (
                  '—'
                )}
              </TableCell>
              <TableCell>
                {SOURCE[p.source]}
                {!p.counted && <div className='text-xs text-destructive'>Not counted: {p.notCountedWhy}</div>}
              </TableCell>
              <TableCell className='text-end tabular-nums'>{formatPaise(p.amountPaise)}</TableCell>
              <TableCell>{formatDay(p.receivedOn)}</TableCell>
              <TableCell className='font-mono text-xs'>{p.reference}</TableCell>
              <TableCell>{p.recordedAs}</TableCell>
              <TableCell className='text-end tabular-nums'>{p.refundedPaise > 0 ? formatPaise(p.refundedPaise) : '—'}</TableCell>
              <TableCell className='text-end'>
                {rights.refund && p.refundable && (
                  <Button size='sm' variant='outline' onClick={() => setRefunding(p)}>
                    Refund
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {refunding && (
        <RefundDialog
          payment={refunding}
          onClose={() => {
            setRefunding(null);
            onChanged();
          }}
        />
      )}
    </>
  );
}

export function SubscriptionTable({ rows, showSchool = true }: { rows: SubscriptionRow[]; showSchool?: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {showSchool && <TableHead>School</TableHead>}
          <TableHead>Plan</TableHead>
          <TableHead className='text-end'>Seats</TableHead>
          <TableHead>Period</TableHead>
          <TableHead className='text-end'>Per seat</TableHead>
          <TableHead>Invoice</TableHead>
          <TableHead>Licence</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((s) => (
          <TableRow key={s.id}>
            {showSchool && <TableCell>{s.schoolCode}</TableCell>}
            <TableCell>
              {s.planName}
              {s.cancelledAt && <div className='text-xs text-muted-foreground'>Cancelled</div>}
            </TableCell>
            <TableCell className='text-end tabular-nums'>{s.seats}</TableCell>
            <TableCell>
              {formatDay(s.startsOn)} to {formatDay(s.endsOn)}
            </TableCell>
            <TableCell className='text-end tabular-nums'>{formatPaise(s.seatPricePaise)}</TableCell>
            <TableCell className='font-mono text-xs'>
              {s.invoiceId ? (
                <Link to='/billing/invoices/$invoiceId' params={{ invoiceId: s.invoiceId }} className='underline-offset-4 hover:underline'>
                  {s.invoiceNumber}
                </Link>
              ) : (
                '—'
              )}
              {s.invoiceStatus && <div className='font-sans text-muted-foreground'>{s.invoiceStatus.replace('_', ' ')}</div>}
            </TableCell>
            <TableCell className='text-xs'>{s.licenceAppliedAt ? 'Set from this payment' : 'Not set yet'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Raise an invoice: a subscription (plan, seats, start) or one line of anything else. */
export function RaiseDialog({
  orgId,
  kind: startKind = 'subscription',
  onClose,
}: {
  orgId?: string;
  kind?: 'subscription' | 'other';
  onClose: () => void;
}) {
  const accounts = useLoad(() => billing.accounts());
  const plans = useLoad(() => billing.plans());
  const [org, setOrg] = useState(orgId ?? '');
  const [kind, setKind] = useState<'subscription' | 'other'>(startKind);
  const [plan, setPlan] = useState('');
  const [seats, setSeats] = useState('');
  const [startsOn, setStartsOn] = useState(todayIst());
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDays, setDueDays] = useState('15');

  const onSale = (plans.data ?? []).filter((p) => p.active);
  const chosenPlan = onSale.find((p) => p.code === plan);
  const seatCount = Number(seats);
  const parsed = parseRupees(amount);
  const blast =
    kind === 'subscription'
      ? chosenPlan && Number.isInteger(seatCount) && seatCount > 0
        ? `${chosenPlan.name} for ${seatCount} seats from ${formatDay(startsOn)}: ${formatPaise(seatCount * chosenPlan.seatPricePaise)} before GST. The invoice takes the next number and is never edited or deleted.`
        : 'Choose a plan and the number of seats.'
      : parsed.ok
        ? `${formatPaise(parsed.paise)} before GST. The invoice takes the next number and is never edited or deleted.`
        : 'Describe it and enter the amount.';

  return (
    <WriteDialog
      title='Raise an invoice'
      blast={blast}
      confirmLabel='Raise it'
      onClose={onClose}
      onConfirm={async ({ env, reason }) => {
        if (!org) throw new Error('Choose a school.');
        const days = Number(dueDays);
        if (!Number.isInteger(days) || days < 0 || days > 90) throw new Error('Payment is due 0 to 90 days after the invoice.');
        if (kind === 'subscription') {
          if (!chosenPlan) throw new Error('Choose a plan on sale.');
          if (!Number.isInteger(seatCount) || seatCount < 1) throw new Error('Seats are a whole number above zero.');
          const r = await billing.subscriptionCreate({ orgId: org, plan: chosenPlan.code, seats: seatCount, startsOn, dueDays: days, reason, env });
          toast.success(`Invoice ${r.number} raised.`);
        } else {
          if (!parsed.ok) throw new Error(parsed.error);
          const r = await billing.invoiceRaise({ orgId: org, description, amountPaise: parsed.paise, dueDays: days, reason, env });
          toast.success(`Invoice ${r.number} raised.`);
        }
      }}
    >
      <div className='grid gap-3 sm:grid-cols-2'>
        {!orgId && (
          <div className='space-y-1 sm:col-span-2'>
            <Label>School</Label>
            <Select value={org} onValueChange={setOrg}>
              <SelectTrigger className='w-full'>
                <SelectValue placeholder={accounts.loading ? 'Loading…' : 'Choose a school with a billing account'} />
              </SelectTrigger>
              <SelectContent>
                {(accounts.data ?? [])
                  .filter((a) => a.hasAccount)
                  .map((a) => (
                    <SelectItem key={a.orgId} value={a.orgId}>
                      {a.code} · {a.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className='space-y-1'>
          <Label>Kind</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as 'subscription' | 'other')}>
            <SelectTrigger className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='subscription'>Subscription</SelectItem>
              <SelectItem value='other'>Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1'>
          <Label htmlFor='raise-due'>Due in days</Label>
          <Input id='raise-due' inputMode='numeric' value={dueDays} onChange={(e) => setDueDays(e.target.value)} />
        </div>
        {kind === 'subscription' ? (
          <>
            <div className='space-y-1'>
              <Label>Plan</Label>
              <Select value={plan} onValueChange={setPlan}>
                <SelectTrigger className='w-full'>
                  <SelectValue placeholder={onSale.length ? 'Choose a plan' : 'No plan on sale yet'} />
                </SelectTrigger>
                <SelectContent>
                  {onSale.map((p) => (
                    <SelectItem key={p.code} value={p.code}>
                      {p.name} · {p.months} months · {formatPaise(p.seatPricePaise)} a seat
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-1'>
              <Label htmlFor='raise-seats'>Seats</Label>
              <Input id='raise-seats' inputMode='numeric' value={seats} onChange={(e) => setSeats(e.target.value)} />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='raise-start'>Starts on</Label>
              <Input id='raise-start' type='date' value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </div>
          </>
        ) : (
          <>
            <div className='space-y-1 sm:col-span-2'>
              <Label htmlFor='raise-desc'>Description</Label>
              <Input id='raise-desc' maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='raise-amount'>Amount in rupees, before GST</Label>
              <Input id='raise-amount' inputMode='decimal' value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </>
        )}
      </div>
    </WriteDialog>
  );
}
