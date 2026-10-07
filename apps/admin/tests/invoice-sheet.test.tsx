import type { InvoiceDetail } from '@ai-tutor/admin-client';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { InvoiceSheet, PRINT_CSS } from '../src/features/billing/invoice-sheet.tsx';

/**
 * The printable invoice's sheet, rendered in jsdom. What a real browser's
 * print preview shows is UNVERIFIED; this checks what the sheet says.
 * Relative imports only: the root vitest `@` alias points at apps/lms/src.
 */

const roots: Root[] = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = '';
});

async function render(d: InvoiceDetail): Promise<HTMLElement> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<InvoiceSheet detail={d} />));
  return host;
}

const paid: InvoiceDetail = {
  id: 'inv-1',
  number: 'QRIE/26-27/0001',
  orgId: 'org-1',
  schoolCode: 'ABC',
  schoolName: 'ABC Public School',
  kind: 'subscription',
  issuedOn: '2026-10-07',
  dueOn: '2026-10-22',
  totalPaise: 2_360_000,
  paidPaise: 2_360_000,
  status: 'paid',
  openLink: null,
  subscriptionId: 'sub-1',
  description: 'Standard plan, 40 seats, 01 Apr 2026 to 31 Mar 2027',
  quantity: 40,
  unitPaise: 50_000,
  taxablePaise: 2_000_000,
  gstRateBp: 1800,
  cgstPaise: 180_000,
  sgstPaise: 180_000,
  igstPaise: 0,
  seller: {
    legalName: 'Qrie Learning Private Limited',
    gstin: '27AAAAA0000A1Z5',
    stateCode: '27',
    address: 'Pune, Maharashtra',
    sacCode: '999293',
    title: 'Tax invoice',
  },
  buyer: {
    legalName: 'ABC Education Trust',
    gstin: '27ABCDE1234F1Z5',
    stateCode: '27',
    address: '1 School Road',
    schoolCode: 'ABC',
    schoolName: 'ABC Public School',
  },
  paidOn: '2026-10-08',
  voidedAt: null,
  links: [],
  payments: [],
  creditNotes: [{ number: 'QRCN/26-27/0001', amountPaise: 118_000, taxablePaise: 100_000, taxPaise: 18_000, issuedOn: '2026-10-09' }],
};

describe('the printable invoice sheet', () => {
  it('shows the title, number, issue and due dates, both GSTINs with state codes, the school code, SAC, quantity, rate and taxable value in rupees and paise', async () => {
    const text = (await render(paid)).textContent ?? '';
    expect(text).toContain('Tax invoice');
    expect(text).toContain('QRIE/26-27/0001');
    expect(text).toContain('07 Oct 2026');
    expect(text).toContain('22 Oct 2026');
    expect(text).toContain('Qrie Learning Private Limited');
    expect(text).toContain('GSTIN 27AAAAA0000A1Z5');
    expect(text).toContain('ABC Education Trust');
    expect(text).toContain('GSTIN 27ABCDE1234F1Z5');
    expect(text).toContain('State code 27');
    expect(text).toContain('School code ABC');
    expect(text).toContain('999293');
    expect(text).toContain('Standard plan, 40 seats, 01 Apr 2026 to 31 Mar 2027');
    expect(text).toContain('₹500.00');
    expect(text).toContain('₹20,000.00');
  });

  it('splits the tax into CGST and SGST at half the rate inside one state, and totals in rupees and paise', async () => {
    const text = (await render(paid)).textContent ?? '';
    expect(text).toContain('CGST at 9%');
    expect(text).toContain('SGST at 9%');
    expect(text).toContain('₹1,800.00');
    expect(text).not.toContain('IGST');
    expect(text).toContain('₹23,600.00');
    expect(text).toContain('Paid on 08 Oct 2026');
  });

  it('prints IGST at the full rate across states, "Unregistered" for a buyer without a GSTIN and "Not registered under GST" for a seller without one', async () => {
    const across: InvoiceDetail = {
      ...paid,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 360_000,
      status: 'unpaid',
      paidPaise: 0,
      paidOn: null,
      creditNotes: [],
      seller: { ...paid.seller, gstin: null },
      buyer: { ...paid.buyer, gstin: null, stateCode: '29' },
    };
    const text = (await render(across)).textContent ?? '';
    expect(text).toContain('IGST at 18%');
    expect(text).toContain('₹3,600.00');
    expect(text).not.toContain('CGST');
    expect(text).toContain('Unregistered');
    expect(text).toContain('Not registered under GST');
    expect(text).toContain('State code 29');
    expect(text).toContain('Unpaid');
    expect(text).not.toContain('Credit notes');
  });

  it('lists the credit notes against the invoice', async () => {
    const host = await render(paid);
    expect(host.textContent).toContain('Credit notes');
    expect(host.textContent).toContain('QRCN/26-27/0001');
    expect(host.textContent).toContain('09 Oct 2026');
    expect(host.textContent).toContain('₹1,180.00');
  });

  it('marks the sheet for print; the print stylesheet names the sidebar, the header and the button to hide (a real print preview is UNVERIFIED)', async () => {
    const host = await render(paid);
    expect(host.querySelector("[data-print='sheet']")).not.toBeNull();
    expect(PRINT_CSS).toContain("[data-slot='sidebar']");
    expect(PRINT_CSS).toContain('header');
    expect(PRINT_CSS).toContain("[data-print='hide']");
    expect(PRINT_CSS).toContain('display: none');
  });
});
