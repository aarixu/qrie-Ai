import { useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { billing } from '@/lib/client';
import { useMe } from '@/lib/me';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AdminPage } from '@/components/admin-page';
import { billingRights, formatDay, invoiceTone, printModel, todayIst } from './model.ts';
import { formatPaise } from './money.ts';
import { Empty, InvoiceActions, ReadState, RecordPaymentDialog, ToneBadge } from './parts.tsx';
import { useLoad } from './use-load.ts';

const SOURCE = { cashfree_link: 'Cashfree link', bank_transfer: 'Bank transfer', cheque: 'Cheque' } as const;

/** One invoice: its line and tax, its payment links, its payments and its credit notes. */
export function InvoiceDetailPage() {
  const { invoiceId } = useParams({ from: '/billing/invoices/$invoiceId' });
  const rights = billingRights(useMe().role);
  const [recording, setRecording] = useState(false);
  const inv = useLoad(() => billing.invoice(invoiceId), invoiceId);
  const d = inv.data;
  const tone = d ? invoiceTone(d.status, d.dueOn, todayIst()) : null;
  const print = d ? printModel(d) : null;
  return (
    <AdminPage
      title={d ? `Invoice ${d.number}` : 'Invoice'}
      actions={
        d && (
          <div className='flex flex-wrap gap-2'>
            <InvoiceActions invoice={d} rights={rights} onChanged={() => void inv.reload()} />
            {rights.record && (d.status === 'unpaid' || d.status === 'partly_paid') && (
              <Button variant='outline' size='sm' onClick={() => setRecording(true)}>
                Record a payment
              </Button>
            )}
          </div>
        )
      }
    >
      <ReadState loading={inv.loading} refused={inv.refused} error={inv.error} hasData={d !== null} onRetry={() => void inv.reload()} />
      {d && print && tone && !inv.refused && (
        <div className='space-y-4'>
          <Card>
            <CardHeader>
              <CardTitle className='flex flex-wrap items-center gap-2 text-base'>
                {d.schoolName} <ToneBadge tone={tone.tone}>{tone.label}</ToneBadge>
              </CardTitle>
              <CardDescription>
                Issued {formatDay(d.issuedOn)} · due {formatDay(d.dueOn)}
                {d.paidOn ? ` · paid ${formatDay(d.paidOn)}` : ''} · SAC {print.sac} · GST {print.rate}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  {print.lines.map((l) => (
                    <TableRow key={l.label}>
                      <TableCell className='whitespace-normal'>{l.label}</TableCell>
                      <TableCell className='text-end tabular-nums'>{l.amount}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className='font-semibold'>Total</TableCell>
                    <TableCell className='text-end font-semibold tabular-nums'>{print.total}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Received</TableCell>
                    <TableCell className='text-end tabular-nums'>{formatPaise(d.paidPaise)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Payment links</CardTitle>
            </CardHeader>
            <CardContent>
              {d.links.length === 0 ? (
                <Empty>No payment link has been made for this invoice.</Empty>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Link</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className='text-end'>Amount</TableHead>
                      <TableHead className='text-end'>Paid</TableHead>
                      <TableHead>Expires</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.links.map((l) => (
                      <TableRow key={l.linkId}>
                        <TableCell className='font-mono text-xs'>
                          {l.url ? (
                            <a href={l.url} target='_blank' rel='noreferrer' className='underline-offset-4 hover:underline'>
                              {l.linkId}
                            </a>
                          ) : (
                            l.linkId
                          )}
                        </TableCell>
                        <TableCell>{l.status.replace('_', ' ')}</TableCell>
                        <TableCell className='text-end tabular-nums'>{formatPaise(l.amountPaise)}</TableCell>
                        <TableCell className='text-end tabular-nums'>{formatPaise(l.amountPaidPaise)}</TableCell>
                        <TableCell>{formatDay(l.expiresAt.slice(0, 10))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Payments</CardTitle>
            </CardHeader>
            <CardContent>
              {d.payments.length === 0 ? (
                <Empty>No payment yet.</Empty>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead className='text-end'>Amount</TableHead>
                      <TableHead>Received</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Counted</TableHead>
                      <TableHead>Recorded by</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>{SOURCE[p.source]}</TableCell>
                        <TableCell className='text-end tabular-nums'>{formatPaise(p.amountPaise)}</TableCell>
                        <TableCell>{formatDay(p.receivedOn)}</TableCell>
                        <TableCell className='font-mono text-xs'>{p.reference}</TableCell>
                        <TableCell className='whitespace-normal'>{p.counted ? 'Yes' : `No: ${p.notCountedWhy}`}</TableCell>
                        <TableCell>{p.recordedAs}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {d.creditNotes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className='text-base'>Credit notes</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Number</TableHead>
                      <TableHead>Issued</TableHead>
                      <TableHead className='text-end'>Taxable</TableHead>
                      <TableHead className='text-end'>Tax</TableHead>
                      <TableHead className='text-end'>Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.creditNotes.map((c) => (
                      <TableRow key={c.number}>
                        <TableCell className='font-mono text-xs'>{c.number}</TableCell>
                        <TableCell>{formatDay(c.issuedOn)}</TableCell>
                        <TableCell className='text-end tabular-nums'>{formatPaise(c.taxablePaise)}</TableCell>
                        <TableCell className='text-end tabular-nums'>{formatPaise(c.taxPaise)}</TableCell>
                        <TableCell className='text-end tabular-nums'>{formatPaise(c.amountPaise)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      )}
      {recording && d && (
        <RecordPaymentDialog
          invoiceId={d.id}
          onClose={() => {
            setRecording(false);
            void inv.reload();
          }}
        />
      )}
    </AdminPage>
  );
}
