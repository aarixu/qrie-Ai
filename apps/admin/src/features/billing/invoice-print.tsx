import { useParams } from '@tanstack/react-router';
import { Printer } from 'lucide-react';
import { billing } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { AdminPage } from '@/components/admin-page';
import { InvoiceSheet, PRINT_CSS } from './invoice-sheet.tsx';
import { ReadState } from './parts.tsx';
import { useLoad } from './use-load.ts';

/**
 * /billing/invoices/$invoiceId/print: the invoice on one white sheet, and a
 * button that opens the browser's print dialog, where "Save as PDF" gives the
 * file. The print stylesheet hides the console around the sheet; how a real
 * print preview looks is UNVERIFIED.
 */
export function InvoicePrint() {
  const { invoiceId } = useParams({ from: '/billing/invoices/$invoiceId/print' });
  const inv = useLoad(() => billing.invoice(invoiceId), invoiceId);
  const d = inv.data;
  return (
    <AdminPage
      title={d ? `Print ${d.number}` : 'Print invoice'}
      actions={
        d && (
          <div data-print='hide'>
            <Button onClick={() => window.print()}>
              <Printer /> Print or save as PDF
            </Button>
          </div>
        )
      }
    >
      <style media='print'>{PRINT_CSS}</style>
      <ReadState loading={inv.loading} refused={inv.refused} error={inv.error} hasData={d !== null} onRetry={() => void inv.reload()} />
      {d && !inv.refused && <InvoiceSheet detail={d} />}
    </AdminPage>
  );
}
