# Qrie control — the staff console

The platform's own console: staff only, on its own address. Design:
`docs/superpowers/specs/2026-10-06-super-admin-panel-design.md`. Setup and running it:
`docs/ops/admin-console.md`.

Its look and its UI kit are the teacher app's (`apps/lms`), which started from
[satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin), MIT licensed,
copyright (c) 2024 Sat Naing. That licence is kept in [LICENSE](LICENSE) and covers
the files that came from it: `src/components/ui/*`, `src/components/layout/{header,main,nav-group,types,authenticated-layout}.tsx`,
`src/context/{theme,layout,search}-provider.tsx`, `src/components/{theme-switch,skip-to-main,confirm-dialog}.tsx`,
`src/hooks/*`, `src/lib/{utils,cookies}.ts`, `src/styles/*`,
`src/components/data-table/*` (its `index.ts` without the teacher app's bulk-actions line),
`src/components/ui/{tabs,popover,checkbox,textarea}.tsx` and `src/tanstack-table.d.ts`. They are copied, not
imported, so a change to the teacher app never changes this one.

**Billing (plan 3)** lives in `src/features/billing/`: the Billing pages (overview,
invoices and one invoice, subscriptions, payments, schools, the webhook log, plans,
settings), each reading through `billing` in `src/lib/client.ts` and writing through
one write dialog that checks the environment and a typed reason first. An invoice's
print page (`/billing/invoices/$invoiceId/print`, the sheet in `invoice-sheet.tsx`)
opens the browser's print dialog, where "Save as PDF" gives the file. Each school's
billing is `SchoolBillingTab({ orgId, code })` in `school-billing-tab.tsx`, which
`/billing/schools/$orgId` frames and plan 2's school page renders as its Billing tab.
Cashfree's keys are never in this app: only the `billing-api` and `cashfree-webhook`
Edge Functions hold them. Running it: `docs/ops/admin-console.md` section 6.
