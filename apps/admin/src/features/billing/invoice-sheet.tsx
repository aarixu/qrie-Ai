import type { InvoiceDetail } from '@ai-tutor/admin-client';
import { formatDay, printModel } from './model.ts';
import { formatPaise } from './money.ts';

/**
 * THE PRINTED INVOICE: one white, A4-wide sheet built from printModel. It
 * imports nothing through the console's `@` alias, so a test renders it as it
 * is; the page around it (invoice-print.tsx) loads the invoice and prints.
 */

/**
 * The print stylesheet the print page puts in a `<style media='print'>`: the
 * sidebar, the header and anything marked `data-print='hide'` (the button) are
 * not printed, and only the sheet stays visible. What a real browser's print
 * preview makes of it is UNVERIFIED.
 */
export const PRINT_CSS = `
@page { size: A4; margin: 12mm; }
[data-slot='sidebar'], header, [data-print='hide'] { display: none !important; }
body * { visibility: hidden; }
[data-print='sheet'], [data-print='sheet'] * { visibility: visible; }
[data-print='sheet'] { position: absolute; left: 0; top: 0; width: 100%; max-width: none; margin: 0; box-shadow: none; }
`;

const cell = 'border-b border-neutral-300 px-2 py-1.5 align-top';
const amount = `${cell} text-end tabular-nums whitespace-nowrap`;

export function InvoiceSheet({ detail: d }: { detail: InvoiceDetail }) {
  const m = printModel(d);
  const taxLines = m.lines.slice(1);
  return (
    <article data-print='sheet' className='mx-auto w-full max-w-[210mm] space-y-6 rounded-sm bg-white p-8 text-sm text-neutral-900 shadow-sm'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div>
          <h2 className='text-xl font-bold'>{m.title}</h2>
          <p className='font-mono'>{m.number}</p>
        </div>
        <dl className='grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5'>
          <dt className='text-neutral-600'>Issued on</dt>
          <dd>{formatDay(d.issuedOn)}</dd>
          <dt className='text-neutral-600'>Due on</dt>
          <dd>{formatDay(d.dueOn)}</dd>
        </dl>
      </div>

      <div className='grid gap-6 sm:grid-cols-2'>
        <section>
          <h3 className='mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-600'>From</h3>
          {m.seller.map((line, i) => (
            <p key={i} className={i === 0 ? 'font-semibold' : undefined}>
              {line}
            </p>
          ))}
        </section>
        <section>
          <h3 className='mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-600'>Bill to</h3>
          {m.buyer.map((line, i) => (
            <p key={i} className={i === 0 ? 'font-semibold' : undefined}>
              {line}
            </p>
          ))}
        </section>
      </div>

      <table className='w-full border-collapse'>
        <thead>
          <tr className='text-start text-xs text-neutral-600'>
            <th className={`${cell} text-start font-semibold`}>Description</th>
            <th className={`${cell} text-start font-semibold`}>SAC</th>
            <th className={`${cell} text-end font-semibold`}>Quantity</th>
            <th className={`${cell} text-end font-semibold`}>Rate</th>
            <th className={`${cell} text-end font-semibold`}>Taxable value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={cell}>{d.description}</td>
            <td className={cell}>{m.sac}</td>
            <td className={`${cell} text-end tabular-nums`}>{d.quantity}</td>
            <td className={amount}>{formatPaise(d.unitPaise)}</td>
            <td className={amount}>{formatPaise(d.taxablePaise)}</td>
          </tr>
          {taxLines.map((l) => (
            <tr key={l.label}>
              <td className={cell} colSpan={4}>
                {l.label}
              </td>
              <td className={amount}>{l.amount}</td>
            </tr>
          ))}
          <tr className='font-semibold'>
            <td className={cell} colSpan={4}>
              Total
            </td>
            <td className={amount}>{m.total}</td>
          </tr>
        </tbody>
      </table>

      <p>
        <span className='text-neutral-600'>Status: </span>
        {m.status}
      </p>

      {d.creditNotes.length > 0 && (
        <section>
          <h3 className='mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-600'>Credit notes against this invoice</h3>
          <table className='w-full border-collapse'>
            <thead>
              <tr className='text-xs text-neutral-600'>
                <th className={`${cell} text-start font-semibold`}>Number</th>
                <th className={`${cell} text-start font-semibold`}>Issued on</th>
                <th className={`${cell} text-end font-semibold`}>Taxable value</th>
                <th className={`${cell} text-end font-semibold`}>Tax</th>
                <th className={`${cell} text-end font-semibold`}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {d.creditNotes.map((c) => (
                <tr key={c.number}>
                  <td className={`${cell} font-mono`}>{c.number}</td>
                  <td className={cell}>{formatDay(c.issuedOn)}</td>
                  <td className={amount}>{formatPaise(c.taxablePaise)}</td>
                  <td className={amount}>{formatPaise(c.taxPaise)}</td>
                  <td className={amount}>{formatPaise(c.amountPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </article>
  );
}
