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

**The Apps page** (`src/features/apps/`) lists which app reads which switch,
when, and what it does when it cannot; it and the line said before a switch changes
(`describeFlagChange` in `src/lib/confirm.ts`) come from one list, `src/lib/app-readers.ts`.
Running it: `docs/ops/admin-console.md` section 7.

**Safety, classes and privacy (plan 5)** live in `src/features/safety/`,
`src/features/classes/` and `src/features/privacy/`, reading and writing through
`safety`, `classes` and `privacy` in `src/lib/client.ts`. The Safety page lists
reports by kind, status and age, never their words; a child's words appear only on
a case's own page (`/safety/cases/$caseId`), one report at a time, each reading
logged by the database. The Classes pages publish, retract and reject (removal goes
through `admin-api`'s `class-remove`, which deletes the files from Storage). The
Privacy page holds erasure requests, each school's data-protection decision and
what is kept; a request's own page (`/privacy/requests/$requestId`) is the only page
with an Erase button, and erasing goes through `admin-api`'s `erase`. Running it:
`docs/ops/admin-console.md` section 8.

**The charts (plan 6)** live in `src/features/charts/`: eight pages under Charts
(`/charts/overview`, `money`, `schools`, `learning`, `content`, `reliability`,
`funnel`, `safety`), reading through `charts` in `src/lib/client.ts`, with what they
draw decided in `src/features/charts/model.ts`. `src/components/charts/chart-card.tsx`
and `kpi.tsx` are copied from the teacher app's `src/features/analytics/charts.tsx`,
not imported. [Recharts](https://github.com/recharts/recharts) draws them; it is MIT
licensed, copyright (c) 2015-present recharts, and its licence ships in its package.
Running it: `docs/ops/admin-console.md` section 9.
