import type { BillingOverview as Overview } from '@ai-tutor/admin-client';
import { billing } from '@/lib/client';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminPage } from '@/components/admin-page';
import { attentionSummary, type Tone } from './model.ts';
import { formatPaise } from './money.ts';
import { ReadState } from './parts.tsx';
import { useLoad } from './use-load.ts';

const TONE: Record<Tone, string> = {
  ok: 'border-l-4 border-l-emerald-500',
  warn: 'border-l-4 border-l-amber-500',
  bad: 'border-l-4 border-l-red-600',
  grey: 'border-l-4 border-l-muted-foreground/40',
};

interface Tile {
  label: string;
  value: string;
  detail: string;
  tone: Tone;
}

const ago = (m: number | null) => (m === null ? 'never' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`);

/** The tiles, from counts and sums only: no school is named here. */
export function overviewTiles(o: Overview): Tile[] {
  const a = o.attention;
  const needs = attentionSummary(a);
  return [
    { label: 'Collected this month', value: formatPaise(o.collectedThisMonthPaise), detail: 'Counted payments received since the 1st.', tone: 'grey' },
    { label: 'Outstanding', value: formatPaise(o.outstandingPaise), detail: 'Still due on unpaid and part-paid invoices.', tone: 'grey' },
    {
      label: 'Overdue',
      value: `${o.overdue.count} · ${formatPaise(o.overdue.paise)}`,
      detail: 'Invoices past their due day.',
      tone: o.overdue.count > 0 ? 'bad' : 'ok',
    },
    {
      label: 'Renewals ahead',
      value: `${o.renewals.in30} / ${o.renewals.in60} / ${o.renewals.in90}`,
      detail: 'Paid licences ending within 30, 60 and 90 days.',
      tone: o.renewals.in30 > 0 ? 'warn' : 'grey',
    },
    {
      label: 'Grace / suspended',
      value: `${o.states.grace} / ${o.states.suspended}`,
      detail: 'Schools past their licence. Suspended includes ended; the tutor is off for both.',
      tone: o.states.suspended > 0 ? 'bad' : o.states.grace > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Needs attention',
      value: String(needs.count),
      detail: needs.detail,
      tone: needs.count > 0 ? 'bad' : 'ok',
    },
    { label: 'Last webhook', value: ago(a.lastWebhookMinutesAgo), detail: `${a.openLinks} payment links open.`, tone: 'grey' },
    {
      label: 'Last reconciliation',
      value: ago(a.reconciledMinutesAgo),
      detail: 'The hourly check with Cashfree, asked by the outside checker.',
      tone: a.reconciledMinutesAgo === null ? 'grey' : a.reconciledMinutesAgo > 120 ? 'bad' : 'ok',
    },
  ];
}

/** Billing at a glance. */
export function BillingOverviewPage() {
  const o = useLoad(() => billing.overview());
  return (
    <AdminPage title='Billing'>
      <ReadState loading={o.loading} refused={o.refused} error={o.error} hasData={o.data !== null} onRetry={() => void o.reload()} />
      {o.data && !o.refused && (
        <div className='space-y-4'>
          <section aria-label='Billing status' className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
            {overviewTiles(o.data).map((t) => (
              <Card key={t.label} className={cn('gap-2 py-4', TONE[t.tone])}>
                <CardHeader className='px-4'>
                  <CardDescription>{t.label}</CardDescription>
                  <CardTitle className='text-xl tabular-nums'>{t.value}</CardTitle>
                </CardHeader>
                <CardContent className='px-4 text-xs text-muted-foreground'>{t.detail}</CardContent>
              </Card>
            ))}
          </section>
          <p className='text-sm text-muted-foreground'>Cost to serve and margin arrive with the money charts (plan 6).</p>
        </div>
      )}
    </AdminPage>
  );
}
