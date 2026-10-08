# Qrie control, Plan 3: Billing with Cashfree. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Schools pay Qrie through one Cashfree merchant account, by payment link or by a bank transfer or cheque recorded by hand. Qrie numbers its own invoices with no gaps, Cashfree only collects, every money change is audited, the licence follows the money, a school that has not paid goes through grace into suspension (tutor off, homework kept), and an hourly check closes any webhook Cashfree did not deliver.

**Architecture:** Tables in a new schema `billing` that no API role can read or write. Every browser call is a SECURITY DEFINER function in the already exposed `admin` schema (`admin.billing_*`), beginning with `admin.require_staff`. Two Edge Functions hold Cashfree's keys: `billing-api` (the only caller of Cashfree; it forwards the staff member's own JWT to the database for every permission decision and uses the service role only to record what Cashfree answered, through service-role-only functions) and `cashfree-webhook` (no JWT; verifies Cashfree's HMAC on the raw body before anything else). Their logic lives in `tools/billing/src` as fetch-only TypeScript tested by vitest over the real migrations, with Cashfree behind an interface and faked in tests; the two `index.ts` files are thin Deno adapters, as `lms-admin` and `relay` are. The outside checker asks `billing-api` to reconcile with its own token; the database paces it to once an hour.

**Tech Stack:** Postgres (migrations 0056 to 0060) tested on PGlite through `supabase/tests/harness.ts`; TypeScript with WebCrypto (HMAC-SHA256, SHA-256) so the same code runs in Node and Deno; React 19, Vite, TanStack Router, Tailwind 4 and the console's copied UI kit; vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-super-admin-panel-design.md` (sections 3, 6, 7, 8 "Billing", 9 "Payment" signal, 10, 14). It lives in the main checkout on `phase3-completion`; read it there, never edit it. Plan 1 (format exemplar): `docs/superpowers/plans/2026-10-06-super-admin-foundation.md`, same place.

**Status of this document:** written 2026-10-07 on branch `admin-billing` (cut from `admin@eb17436`). Nothing in it is built. Every fact about the repository below was read on 2026-10-07 and cites its file and line; every fact about Cashfree cites the page it was read from on 2026-10-07; everything else is marked UNVERIFIED.

---

## Cashfree's contract, as documented (read 2026-10-07)

| Fact | Source |
|---|---|
| Base URLs: sandbox `https://sandbox.cashfree.com/pg`, production `https://api.cashfree.com/pg` | https://www.cashfree.com/docs/api-reference/payments/latest/payment-links/create |
| Headers on every call: `x-client-id`, `x-client-secret`, `x-api-version` (required; documented value `2026-01-01`); optional `x-request-id`, `x-idempotency-key` (a UUID; "If the request fails or times out, you can safely retry it using the same key") | same page; https://www.cashfree.com/docs/api-reference/payments/latest/refunds/create-refund.md (header definitions) |
| `POST /links`: required `link_amount` (number, rupees, two decimals), `link_currency` (INR), `link_purpose` (shown to the customer, up to 500 characters), `customer_details` (with `customer_phone` required; `customer_email`, `customer_name` optional); optional `link_id` ("Alphanumeric and only - and _ allowed", 50 characters), `link_partial_payments`, `link_minimum_partial_amount`, `link_expiry_time` (ISO 8601, default 30 days), `link_notes` (string key-values, at most 5 pairs), `link_notify` (`send_sms`, `send_email`, `send_whatsapp`), `link_meta` (`notify_url` HTTPS, `return_url`), `link_auto_reminders` | https://www.cashfree.com/docs/api-reference/payments/latest/payment-links/create-payment-link.md |
| The answer (LinkEntity): `cf_link_id` (string), `link_id`, `link_status`, `link_amount`, `link_amount_paid`, `link_currency`, `link_url`, `link_expiry_time`, `link_notes`, `link_meta`, `link_qrcode`, `customer_details` | same page |
| "SMS notifications are sent only in the production environment. In the sandbox environment, only email notifications are sent if enabled." | https://www.cashfree.com/docs/api-reference/payments/latest/payment-links/create |
| `GET /links/{link_id}` returns the same LinkEntity | https://www.cashfree.com/docs/api-reference/payments/latest/payment-links/fetch-payment-link-details.md |
| `GET /links/{link_id}/orders?status=ALL|PAID` (default PAID) lists the link's orders: `order_id`, `cf_order_id`, `order_amount`, `order_currency`, `order_status` (`ACTIVE`, `PAID`, `EXPIRED`) | https://www.cashfree.com/docs/api-reference/payments/latest/payment-links/get-orders-for-a-payment-link.md |
| Cancel a link: "Only a link in ACTIVE status can be cancelled" (`POST /links/{link_id}/cancel`; the path is UNVERIFIED beyond the index's page title) | https://www.cashfree.com/docs/llms.txt index entry "Cancel Payment Link" |
| Link webhook: `type` = `PAYMENT_LINK_EVENT`, `version` 1, `event_time`, `data.{cf_link_id (number in the example), link_id, link_status, link_currency, link_amount (string "200.12"), link_amount_paid (string), link_notes, customer_details, order}`; `order` = `{order_id, order_amount (string), order_expiry_time, order_hash, transaction_id, transaction_status}` and "Will be null for cancelled and expired link statuses"; `link_status` "Possible values: PAID, PARTIALLY_PAID, EXPIRED, CANCELLED"; `transaction_status` "Possible values: SUCCESS". The page also says "We send the webhook response in a form data format." while showing JSON | https://www.cashfree.com/docs/api-reference/payments/latest/payment-links/webhooks.md |
| Signature: header `x-webhook-signature`, timestamp header `x-webhook-timestamp`; `signedPayload = x-webhook-timestamp + rawBody`, `expectedSignature = Base64Encode(HMAC-SHA256(signedPayload, clientSecret))`; "Always compute the signature from the raw request body string"; after a secret rotation Cashfree signs with the secret active when the event was sent | https://www.cashfree.com/docs/api-reference/webhooks/payloads-and-signatures.md |
| Retries: Payment Gateway default "up to three times at 2, 10, and 30-minute intervals" when the answer is not HTTP 200; configurable up to 10 | https://www.cashfree.com/docs/api-reference/webhooks/reliability-and-operations.md |
| At-least-once delivery; "Don't assume delivery order"; "For Payment Gateway webhooks on version `2025-01-01`, also use the `x-idempotency-key` header value as a de-duplication key where applicable"; recommends rejecting a timestamp older than five minutes; Batch Resend exists in the dashboard | same page |
| `POST /orders/{order_id}/refunds`: `refund_amount` (number, required), `refund_id` (required, 3 to 40, "alphanumeric"), `refund_note` (3 to 100; in sandbox `SUCCESS`, `FAILED`, `PENDING` or `ACTIVE` in the note simulates that status), `refund_speed` (`STANDARD` default, `INSTANT`); answer RefundEntity with `cf_refund_id`, `refund_id`, `order_id`, `refund_amount`, `refund_status` in `SUCCESS, PENDING, PENDING_APPROVAL, CANCELLED, ONHOLD, REJECTED`; "You can initiate refunds only within six months of the original successful transaction's date and time" | https://www.cashfree.com/docs/api-reference/payments/latest/refunds/create-refund.md |
| `GET /orders/{order_id}/refunds/{refund_id}` (Get Refund) | https://www.cashfree.com/docs/_llms/payments-apis.md (index) |
| Refund webhook `type` = `REFUND_STATUS_WEBHOOK`, `data.refund.{cf_refund_id, refund_id, order_id, refund_amount (number), refund_status, ...}` | https://www.cashfree.com/docs/api-reference/payments/latest/refunds/webhooks.md |
| Webhook endpoints are configured in the Merchant Dashboard under Payment Gateway > Developers > Webhooks | https://www.cashfree.com/docs/api-reference/webhooks/reliability-and-operations.md |

And one fact about Indian tax that decides the invoice number's shape: CGST Rule 46(b) asks for "a consecutive serial number not exceeding sixteen characters ... containing alphabets or numerals or special characters hyphen or dash and slash ... unique for a financial year" (https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule46_v1.00.html). `QRIE/2026-27/0001`, the spec's example, is 17 characters, so this plan numbers invoices `QRIE/26-27/0001` (15) and credit notes `QRCN/26-27/0001`. Ruling R1.

## Where it builds on plan 1 and the LMS lane (read 2026-10-07)

- `admin.platform_staff.role` is `check (role in ('owner', 'ops', 'safety'))` (`supabase/migrations/0047_admin_foundation.sql:66`); `admin.staff_set` repeats the list in a literal (`0047:249-251`).
- `admin.require_staff(p_roles text[] default array['owner','ops','safety'])`: owner always passes, else `not allowed` 42501 (`0047:160-177`). `admin.require_fresh_mfa(10)` (`0047:182-197`). `admin.check_environment(p_env)` raises `this console is X, not Y` (`0047:199-209`). `admin.audit(p_who, p_action, p_kind, p_id, p_reason, p_details)` and `admin.audit_service(...)` (`0047:115-139`). `admin.tripwire()` writes `unmanaged-change` unless `admin.session` is `on` (`0047:141-154`). `admin.me()` calls `require_staff()` with the default roles (`0047:211-222`). `admin.bootstrap_status()` returns `{environment, hasOwner}` and is granted to `service_role` (`0047:326-335, 374`). `grant usage on schema admin to authenticated, service_role` (`0047:36`).
- Writes set `perform set_config('admin.session', 'on', true)` (`0048:116`). A cron job is `select cron.schedule(name, schedule, $job$ ... $job$)` (`0048:195`); the harness's `cron` shim records it in `cron.job` (`supabase/tests/harness.ts:105-128`).
- `public.app_config(p_school text default null) returns jsonb`, `language sql stable security definer`, granted to `anon, authenticated, service_role` (`0050:141-160`). Plan 1's note for plan 3: per-school billing states there "can be read by anyone who guesses a school code. Keep them coarse (grace and suspended only)." (plan 1 document, last line).
- `lms.school (org_id uuid pk, code text unique ^[A-Z0-9]{3,12}$, display_name, ...)` (`0022:46-60`). `lms.licence (org_id pk, plan ^[a-z][a-z0-9-]{0,29}$, seats 1..100000, valid_until date, set_at)` (`0041:35-41`). `lms.set_licence(p_code, p_plan, p_seats, p_until)`, service role only, writes the school's own log through `lms.audit(org, 'licence-set', plan, {seats, validUntil})` with `auth.uid()` as actor (`0041:70-99`, `0034:50-57`). `lms.seats_used(p_org)` (`0041:52-64`). `lms.india_today()` = `(now() at time zone 'Asia/Kolkata')::date` (`0036:32-38`).
- Test tools: `freshDatabase`, `asClaims`, `asService`, `createUser` (`harness.ts`); `makeStaff`, `aal2`, `fresh`, `anonymousChild`, `setEnvironment` (`supabase/tests/admin-fixtures.ts:24-49`, typed `StaffRole = 'owner'|'ops'|'safety'`); `buildSchool(db, code)` (`supabase/tests/fixtures.ts`). PGlite's collation is `C` (measured 2026-10-07), so `admin-invariants.test.ts`'s `order by 1` puts `_` before letters (`billing_account_set` before `billing_accounts`).
- The client transport splices names that match `^[a-z][a-z_]{0,62}$` and arguments matching `^p_[a-z_]{1,60}$` (no digits), and sends only an argument named `p_value` as jsonb (`packages/admin-client/src/transport.ts:67-71`). `toAdminError` sorts messages into `needs-mfa` / `not-allowed` / `wrong-environment` / `other` (`errors.ts:24`). `Me.role` is `'owner' | 'ops' | 'safety'` (`api.ts:6`).
- The edge-function pattern: logic in testable TypeScript (`tools/lms-import/src/admin.ts` `handleAdmin(req, deps)` with `verify`, `rpc`), a Deno entry that reads `Deno.env` and answers 503 naming missing variables (`supabase/functions/lms-admin/index.ts`), tests that bind `rpc` to PGlite with `asService` (`tools/lms-import/tests/admin.test.ts:27-56`). Deno entries import `../../../tools/...` (the deployed relay does the same from `packages/relay`).
- The outside checker: `runOnce(env, nowMinutes, fetchImpl)` sends each alert and throws on a failed send (`tools/admin-alert/src/run.ts:54-64`); its workflow sparse-checks-out `tools/admin-alert` and passes six secrets (`.github/workflows/admin-alert.yml`).
- The console: `checkWrite({expectedEnv, databaseEnv, typed, reason})` (`apps/admin/src/lib/confirm.ts`), `useGuarded()` retries once after a fresh code on `needs-mfa` (`lib/stepup.tsx`), `useMe()`, `EXPECTED_ENV`, `AdminPage`, code-based routes in `src/router.tsx`, `sidebarData` in `src/components/layout/data/sidebar-data.ts`, CSP `connect-src 'self' https://*.supabase.co` (`apps/admin/vercel.json`) which already covers `<project>.supabase.co/functions/v1/*`. The kit's sidebar renders `data-slot='sidebar'` (`apps/admin/src/components/ui/sidebar.tsx:168`).
- Smoke-tested on PGlite on 2026-10-07 (scratch script, not committed): the financial-year expression below gives `26-27` for 2026-04-01, `25-26` for 2026-03-31, and `26-27` for 2026-03-31T19:00Z read in IST; the counter upsert gives 1..5 for five calls and a rolled-back sixth leaves 5; the GST split rounds 100000 paise at 1800 bp to 9000 + 9000 inside a state and 100001 to 18000 IGST across states; `jsonb_build_object` carries a bigint as a JSON number. The wave's cross-check (2026-10-07) ran 0056's DO block alone on PGlite against four `staff_set` bodies: 0047's (widened; refuses `auditor` with `a role is owner, ops, safety or finance`), plan 2's 0054 shape with no role list (left alone; refuses with its own sentence), an unrecognised list (stops) and none (stops).

## Global Constraints

- Work only in `C:/Users/Ashish Sharma/curie/.claude/worktrees/admin-billing` on branch `admin-billing`. Never touch the main checkout's working tree, `.claude/worktrees/lms`, `.claude/worktrees/admin` or any other worktree. Never push, deploy, run `supabase db push`, call Cashfree, Supabase-hosted, Telegram or GitHub, or put a real secret anywhere (test secrets are obvious strings such as `test-client-secret`).
- Migrations **0056 to 0060 only** (S8). Never edit 0001 to 0051. Plan 2 builds 0052 to 0055 at the same time on another branch; gaps are fine.
- Every `admin.*` function: `SECURITY DEFINER`, `set search_path = admin, billing, lms, public` (only the schemas it uses), begins with `admin.require_staff(...)`, refuses with exactly `not allowed` (42501). Money and owner actions also call `admin.require_fresh_mfa(10)`. Every write takes `p_env` and calls `admin.check_environment(p_env)`, takes `p_reason` (3+ characters after trim, message `say why, in a few words`), sets `admin.session`, and writes `admin.audit` with ids, amounts, statuses and hashes only.
- Every function and table in this plan says who may use it: `revoke all ... from public, anon, authenticated` (and `service_role` for `billing.*`), then explicit grants. `supabase/tests/admin-invariants.test.ts` pins the exact `authenticated` list; `supabase/tests/billing-invariants.test.ts` (new) pins that nothing in schema `billing` is reachable by any API role.
- Money is `bigint` paise in the database and integer paise (`number`, within `Number.MAX_SAFE_INTEGER`) in TypeScript. Cashfree's rupee amounts are converted at the edge by one tested module (`tools/billing/src/money.ts`). Days that mean "a day" are IST (`lms.india_today()`).
- The browser never reads a table. Console writes go through `checkWrite` and send `EXPECTED_ENV`; guarded ones through `useGuarded`. App text is English, sentence case. Reasons are typed.
- Spec section 6, "Never shown, never exported": no card or bank details anywhere (Cashfree's pages collect them); no full phone number or contact name in any list (a school's own billing page shows its billing contact, one record at a time); the webhook log stores a whitelisted extract and never `customer_details`; a signature failure stores only a hash and a length; health signals are counts. No child appears anywhere in billing.
- COMMENTS ARE CLAIMS: every comment, doc line and test name states only what the code does. Anything not run is marked UNVERIFIED.
- TDD: write the failing test, run it, see it fail for the stated reason, implement, see it pass. Database tests carry `// @vitest-environment node`.
- The two Edge Function entries and `tools/billing/src` use fetch and WebCrypto only (no `node:` imports in `src`), explicit `.ts` import paths, erasable TypeScript only (no enums, no parameter properties), as plan 1's CLIs.
- Windows, PowerShell 5.1: write files without a BOM; commit with a message file (helper below). End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

```powershell
# Run once per shell, from the worktree root.
function Commit([string]$msg) {
  $f = Join-Path $env:TEMP 'qrie-billing-commit.txt'
  [System.IO.File]::WriteAllText($f, "$msg`n`nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`n")
  git commit -F $f
}
```

## Seams with plan 2 (built at the same time; plan 2 merges first)

| Seam | This plan |
|---|---|
| S1 | Creates `admin.school_payment_signal(p_org uuid) returns jsonb` with `create or replace` in 0058, same signature and grants as plan 2's stub (no grant to `authenticated` or `anon`), with section 9's thresholds. Its own tests call it directly. |
| S2 | Writes the real `export function SchoolBillingTab(props: { orgId: string; code: string })` in `apps/admin/src/features/billing/school-billing-tab.tsx` (Task 13). The merge takes this version. |
| S3 | New module `packages/admin-client/src/billing.ts`; one `export * from './billing.ts';` line in `index.ts`; one construction line in `apps/admin/src/lib/client.ts`. |
| S4 | Adds only Billing routes and one sidebar group. |
| S5 | The only plan that changes `public.app_config` (0060). |
| S6 | Adds `finance` with a new migration (0056) that widens the role constraint; it widens `staff_set`'s literal only where 0047's body still has it, and never recreates the 5-argument `staff_set` that plan 2's 0054 drops (merge note 2). |
| S7 | Calls `lms.set_licence` only from its own definer code (`billing.apply_licence`, 0058). Never edits 0041. |
| S8 | 0056 to 0060. |
| S9 | Plan-1 files changed: `admin-invariants.test.ts` (list), `router.tsx`, `sidebar-data.ts`, `admin-client/src/index.ts`, `lib/client.ts`, `docs/ops/admin-console.md` (new section 6; plan 2 takes section 5 and merges first), `apps/admin/README.md`. **Beyond S9, each needed by this plan's own scope and noted in its task:** `packages/admin-client/src/api.ts` (one line: `Me.role` gains `'finance'`, needed by S6), `tools/admin-alert/src/run.ts` and `.github/workflows/admin-alert.yml` (the hourly reconciliation request, deliverable 7; additive, optional when its token is unset). |

## Review Focus

1. **A forged or replayed notification moves no money.** The signature is checked on the raw bytes before parsing; a failure is stored as hash plus length and answered 401; a duplicate is a no-op; an event only ever moves an invoice forward; a payment counts only when its amount equals the link's amount, its currency is INR and its notes name the same invoice. (Task 6 `signature.test.ts`; Task 4 `billing-cashfree.test.ts` "webhook events"; Task 7 `webhook.test.ts`.)
2. **Money cannot move out or be wiped by mistake.** Refunds and voids are the owner's with a fresh code, through `billing-api`, which asks the database first and calls Cashfree only after the database said yes; a void with money on it is refused; a void cancels the link at Cashfree before the invoice changes; issued invoices and payments cannot be edited or deleted even with hand-written SQL. (Tasks 2, 3, 4, 8.)
3. **Gapless invoice numbers per Indian financial year** under many calls at once and across a failed raise; the year turns on 1 April IST. (Task 2.)
4. **The licence follows the money and nothing else in billing sets it**; it is never shortened by a late payment for an older period; a suspended school's tutor is off through `app_config`; homework is untouched. (Tasks 3, 5.)
5. **Cashfree's keys and the service role never reach a browser or a log**: the keys live only in the two Edge Functions' environment; errors carry Cashfree's code, never a header; the checker holds its own token, not the service-role key. (Tasks 6, 8, 9, and the bundle scan in Task 14.)
6. **Who may do what** is pinned: `authenticated` may call exactly the listed functions, each of which refuses a child, an aal1 session, safety, and the wrong role; nothing in `billing` is reachable by any API role. (Tasks 1, 2, 5.)

## Interfaces (what this plan produces and consumes)

**Consumes (plan 1 and the LMS lane):** `admin.require_staff`, `require_fresh_mfa`, `check_environment`, `audit`, `audit_service`, `tripwire`, `environment`, `bootstrap_status`, `admin.setting`, `admin.platform_staff`, `admin.audit_event`; `lms.school`, `lms.licence`, `lms.set_licence`, `lms.seats_used`, `lms.india_today`; `public.app_config` (replaced); `cron.schedule`; `packages/admin-client` transport and errors; `apps/admin` `checkWrite`, `useGuarded`, `useMe`, `EXPECTED_ENV`, `AdminPage`, UI kit; `tools/admin-alert/src/run.ts`; harness and fixtures.

**Produces, SQL (browser-callable, `authenticated`; each checks staff itself):**
`admin.billing_settings()`, `billing_settings_set(p_legal_name, p_gstin, p_state, p_address, p_sac, p_gst_rate_bp, p_title, p_reason, p_env)`, `billing_plans()`, `billing_plan_set(p_code, p_name, p_months, p_seat_price_paise, p_active, p_reason, p_env)`, `billing_account_set(p_org, p_legal_name, p_gstin, p_state, p_address, p_contact_name, p_contact_email, p_contact_phone, p_reason, p_env)`, `billing_subscription_create(p_org, p_plan, p_seats, p_starts_on, p_due_days, p_reason, p_env)`, `billing_invoice_raise(p_org, p_description, p_amount_paise, p_due_days, p_reason, p_env)`, `billing_subscriptions(p_org default null)`, `billing_invoices(p_org default null, p_status default null)`, `billing_invoice(p_invoice)`, `billing_payment_record(p_invoice, p_source, p_amount_paise, p_received_on, p_reference, p_reason, p_env)`, `billing_payments(p_org default null)`, `billing_invoice_void(p_invoice, p_reason, p_env, p_commit)`, `billing_link_prepare(p_invoice, p_reason, p_env)`, `billing_refund_prepare(p_payment, p_amount_paise, p_reason, p_env)`, `billing_webhook_log(p_problems default false)`, `billing_grace_set(p_org, p_days, p_reason, p_env)`, `billing_overview()`, `billing_accounts()`, `billing_school(p_org)`. All return `jsonb` (or `void`).

**Produces, SQL (service role only, called by the two Edge Functions and cron):** `admin.billing_link_created(p_link_id, p_cf_link_id, p_url, p_expires_at)`, `billing_link_failed(p_link_id, p_why)`, `billing_link_observed(p_link_id, p_value)`, `billing_webhook_ingest(p_key, p_body_sha256, p_body_length, p_value)`, `billing_signature_failed(p_body_sha256, p_body_length, p_why)`, `billing_refund_result(p_refund_id, p_value)`, `billing_reconcile_due(p_force default false)`, `billing_reconcile_done(p_value)`, `billing_compute_states()`.

**Produces, SQL (internal, no API grant):** `admin.school_payment_signal(p_org uuid) returns jsonb` (S1), and in schema `billing`: `fy_of`, `next_number`, `format_number`, `gst_split`, `raise_invoice`, `seller_ready`, `audit_as`, `settle`, `apply_licence`, `payment_signal_on`, `link_rank`, `link_status_of`, `advance_link`, `apply_link_payment`, `apply_link_event`, `apply_refund_status`, `issue_credit_note`, `state_for`, `invoice_guard` (trigger), `no_delete` (trigger). Tables `billing.seller, plan, account, subscription, number_counter, invoice, payment_link, payment, refund, credit_note, webhook_event, school_state`. Cron job `billing-states` at `40 18 * * *` (00:10 IST). `public.app_config` gains `billing.state` (`ok|grace|suspended`) and `billing.grace_until` (`YYYY-MM-DD` or `""`), and `tutor.enabled = false` for a suspended school.

**Produces, TypeScript:** `tools/billing/src/money.ts` (`paiseFromRupees`, `rupeesFromPaise`, `MoneyError`), `signature.ts` (`signWebhook`, `verifyWebhook`, `sha256Hex`), `cashfree.ts` (`interface CashfreeApi`, `cashfreeHttp(cfg)`, `CashfreeError`, `cashfreeBaseUrl`), `extract.ts` (`extractEvent`), `rest.ts` (`adminRpc`), `webhook.ts` (`handleWebhook`), `api.ts` (`handleBillingApi`); Edge Functions `supabase/functions/billing-api/index.ts`, `supabase/functions/cashfree-webhook/index.ts`; `tools/admin-alert/src/reconcile.ts` (`askReconcile`); `packages/admin-client/src/billing.ts` (`createBillingClient`, `billingApiFetch`, types); console pages under `apps/admin/src/features/billing/` including `SchoolBillingTab` (S2) and the print page.

**Edge Function routes:** `billing-api` (POST JSON, `--no-verify-jwt`, checks every call itself): `/link {invoiceId, reason, env}`, `/check {invoiceId}`, `/void {invoiceId, reason, env}`, `/refund {paymentId, amountPaise, reason, env}` (all with the staff member's `Authorization: Bearer <session>`), `/reconcile` (with `Authorization: Bearer <BILLING_RECONCILE_TOKEN>`). `cashfree-webhook` (POST from Cashfree, `--no-verify-jwt`).

## File structure

| Path | Responsibility | Task |
|---|---|---|
| `supabase/migrations/0056_admin_finance_role.sql` | the `finance` role; `staff_set` and `me()` admit it | 1 |
| `supabase/tests/billing-fixtures.ts` | `makeFinance`, `readySeller`, `readyPlan`, `billedSchool`, `subscribe`, `rpc` | 1, 2 |
| `supabase/tests/admin-finance-role.test.ts` | the role | 1 |
| `supabase/migrations/0057_billing_ledger.sql` | schema `billing`, every table, numbering, GST split, settings, plans, accounts, subscriptions, invoices, their reads | 2 |
| `supabase/tests/billing-ledger.test.ts`, `billing-invariants.test.ts` | the ledger; nothing in `billing` reachable | 2 |
| `supabase/migrations/0058_billing_payments_licence.sql` | offline payments, settling, the licence follows money, void, S1 | 3 |
| `supabase/tests/billing-payments.test.ts` | the above | 3 |
| `supabase/migrations/0059_billing_cashfree.sql` | links, webhook ingest, refunds and credit notes, reconciliation bookkeeping, webhook log | 4 |
| `supabase/tests/billing-cashfree.test.ts` | the above, database side | 4 |
| `supabase/migrations/0060_billing_states.sql` | grace, suspension, ended; daily job; `app_config` (S5); overview, accounts list, school page | 5 |
| `supabase/tests/billing-states.test.ts` | the above | 5 |
| `supabase/tests/admin-invariants.test.ts` (modify) | the `authenticated` list grows per task | 2 to 5 |
| `tools/billing/src/{money,signature,cashfree,extract,rest}.ts` + tests | the edge primitives | 6 |
| `tools/billing/src/webhook.ts`, `supabase/functions/cashfree-webhook/index.ts` + `tools/billing/tests/webhook.test.ts` | the webhook | 7 |
| `tools/billing/src/api.ts`, `supabase/functions/billing-api/index.ts` + `tools/billing/tests/api.test.ts`, `tools/billing/tests/fake-cashfree.ts` | billing-api | 8 |
| `tools/admin-alert/src/reconcile.ts`, `run.ts` (modify), `.github/workflows/admin-alert.yml` (modify) + `tests/reconcile.test.ts` | hourly reconciliation from outside | 9 |
| `packages/admin-client/src/billing.ts`, `index.ts`, `api.ts` (modify) + `tests/billing.test.ts` | the typed client | 10 |
| `apps/admin/src/features/billing/{money,model}.ts`, `write-dialog.tsx`, `use-load.ts` + `apps/admin/tests/billing-{money,model}.test.ts` | pure helpers and the shared dialog | 11 |
| `apps/admin/src/features/billing/{index,invoices,invoice-detail,subscriptions,payments,webhooks,plans,settings,schools}.tsx`, `src/router.tsx`, `sidebar-data.ts`, `src/lib/client.ts` | the pages | 12 |
| `apps/admin/src/features/billing/{invoice-print,school-billing-tab,school-page}.tsx` | print page and S2 | 13 |
| `docs/ops/admin-console.md` (section 6), `apps/admin/README.md` | Aarav's steps and the runbook | 14 |

---

### Task 1: The finance role (0056)

**Files:**
- Create: `supabase/migrations/0056_admin_finance_role.sql`
- Create: `supabase/tests/billing-fixtures.ts` (only `makeFinance` in this task)
- Test: `supabase/tests/admin-finance-role.test.ts`

**Interfaces:**
- Consumes: `0047`'s table, `staff_set`, `me`, `require_staff`.
- Produces: role `finance` accepted by `admin.platform_staff`; `admin.staff_set` accepts `finance`; `admin.me()` answers for finance; `makeFinance(db, name?) => Promise<{ id: string; role: 'finance' }>`.

- [ ] **Step 1: Write the failing tests**

`supabase/tests/billing-fixtures.ts` (start):

```ts
import type { PGlite } from '@electric-sql/pglite';
import { createUser } from './harness.ts';

/** A finance member, made as makeStaff makes the others (admin-fixtures.ts), with the role plan 3 adds. */
export async function makeFinance(db: PGlite, name = 'finance person'): Promise<{ id: string; role: 'finance' }> {
  const id = await createUser(db, { appMeta: { provisioned_by: 'staff' } });
  await db.query(`insert into admin.platform_staff (user_id, role, display_name) values ($1, 'finance', $2)`, [id, name]);
  return { id, role: 'finance' };
}
```

`supabase/tests/admin-finance-role.test.ts` (`// @vitest-environment node`; `beforeAll`: `freshDatabase()`, `setEnvironment`, `makeStaff(db,'owner','Aarav')`, `makeStaff(db,'ops')`, `makeFinance(db)`). Tests:
1. `finance is a role the staff table accepts, and an unknown role is not`: `makeFinance` succeeds; `insert ... role 'auditor'` rejects with a check violation.
2. `a finance member reaches me() and is told their role`: as `aal2(finance)`, `select admin.me()` → `role: 'finance'`.
3. `finance is refused Today, the switches, the relay and the stop`: `admin.today()`, `admin.flag_list()`, `admin.relay_status()`, `admin.set_halt(true,'test stop','TEST')` each reject with `not allowed` (spec section 3: finance may not touch switches; ruling R11).
4. `the owner makes a finance member through staff_set with a fresh code`: `createUser({provisioned_by:'staff'})`, then as `fresh(owner)` `admin.staff_set(p_user => u, p_role => 'finance', p_name => 'Accounts', p_active => true, p_reason => 'new accountant')`; `platform_staff.role = 'finance'`.
5. `staff_set still refuses a role that does not exist`: the same call with `p_role => 'auditor'` rejects with `/a role is owner, ops, safety or finance|there is no staff role called auditor/` (the first is 0047's body widened by 0056; the second is plan 2's 0054 body, which this file meets once plan 2 is merged).

Both calls go through one helper in the test file, `staffSet(claims, args)`, which reads `select max(pronargs) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'admin' and p.proname = 'staff_set'` and adds `p_env => 'TEST'` when it is 6 (plan 2's M2 signature), so the file passes on this branch alone and after plan 2 is merged. It never creates a 5-argument `staff_set` (seam S6).

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run supabase/tests/admin-finance-role.test.ts`
Expected: FAIL in `beforeAll` (`makeFinance` violates `platform_staff_role_check`).

- [ ] **Step 3: Write the migration**

`supabase/migrations/0056_admin_finance_role.sql`:

```sql
-- THE FINANCE ROLE (spec section 3): reads billing, records an offline payment,
-- prints invoices. Nothing about children, switches or classes: every plan-1
-- function keeps its own role list, so finance reaches only me() there.

alter table admin.platform_staff drop constraint if exists platform_staff_role_check;
alter table admin.platform_staff add constraint platform_staff_role_check
  check (role in ('owner', 'ops', 'safety', 'finance'));

-- 0047's staff_set names the roles in a literal; where that literal is in the
-- body, it is widened in place. Plan 2's 0054 replaces staff_set (six
-- arguments, with p_env) by a body that takes the roles from the check
-- constraint above and names no role list, so there is nothing to widen and
-- the constraint is all it needs. A body that names 'safety' in any other way
-- stops the migration, so a role list this block does not recognise is
-- noticed instead of silently left without finance.
do $$
declare
  f record;
  body text;
  seen integer := 0;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'admin' and p.proname = 'staff_set' loop
    seen := seen + 1;
    body := pg_get_functiondef(f.oid);
    if position('(''owner'', ''ops'', ''safety'')' in body) > 0 then
      body := replace(body, '(''owner'', ''ops'', ''safety'')', '(''owner'', ''ops'', ''safety'', ''finance'')');
      body := replace(body, 'a role is owner, ops or safety', 'a role is owner, ops, safety or finance');
      execute body;
    elsif position('''safety''' in body) > 0 then
      raise exception 'admin.staff_set names its roles in a way 0056 does not recognise: add finance to it by hand';
    end if;
  end loop;
  if seen = 0 then
    raise exception 'admin.staff_set does not exist';
  end if;
end
$$;

-- me() is how the console learns who is signed in; finance must reach it.
create or replace function admin.me()
returns jsonb
language plpgsql stable security definer
set search_path = admin, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['owner', 'ops', 'safety', 'finance']);
begin
  return jsonb_build_object('userId', me.user_id, 'role', me.role,
                            'displayName', me.display_name, 'environment', admin.environment());
end;
$$;
revoke all on function admin.me() from public, anon;
grant execute on function admin.me() to authenticated;
```

(`execute body` re-runs `create or replace` with the same signature, so the grants of 0047:364/371 stay as they are. After plan 2's 0054, no body has the literal and nothing is re-run: plan 2's `staff_set` and `staff_invite` catch the constraint's `check_violation`, so they accept `finance` from the widened constraint alone.)

- [ ] **Step 4: Run and see them pass, then everything that reads staff**

Run: `npx vitest run supabase/tests/admin-finance-role.test.ts`
Expected: PASS, 5 tests.
Run: `npx vitest run supabase/tests/admin- packages/admin-client`
Expected: PASS (plan 1's files unchanged in behaviour; `admin-invariants` still passes because no new function is callable).

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/0056_admin_finance_role.sql supabase/tests/billing-fixtures.ts supabase/tests/admin-finance-role.test.ts
Commit "feat: a finance role that reaches billing and nothing about children"
```

---

### Task 2: The ledger: schema, numbering, settings, plans, accounts, invoices (0057)

**Files:**
- Create: `supabase/migrations/0057_billing_ledger.sql`
- Modify: `supabase/tests/billing-fixtures.ts` (add the helpers below)
- Test: `supabase/tests/billing-ledger.test.ts`, `supabase/tests/billing-invariants.test.ts`; modify `supabase/tests/admin-invariants.test.ts`

**Interfaces:**
- Consumes: Task 1; `lms.school`, `lms.india_today`.
- Produces: every `billing` table (DDL below); internal `billing.fy_of(date) returns text`, `billing.next_number(p_series text, p_fy text) returns integer`, `billing.format_number(p_series text, p_fy text, p_n integer) returns text`, `billing.gst_split(p_taxable bigint, p_rate_bp integer, p_seller_state text, p_buyer_state text, out cgst bigint, out sgst bigint, out igst bigint)`, `billing.seller_ready() returns text` (null when ready, else the message), `billing.raise_invoice(p_org uuid, p_sub uuid, p_kind text, p_description text, p_quantity integer, p_unit bigint, p_due_on date, p_by uuid) returns billing.invoice`, triggers `billing.invoice_guard()` and `billing.no_delete()`; the ten browser functions listed under Interfaces for 0057.
- Fixture helpers: `SELLER` (constants below), `readySeller(db, owner)`, `readyPlan(db, owner, code = 'standard', months = 12, seatPricePaise = 50_000)`, `billedSchool(db, who, code, over?: Partial<{state: string; gstin: string | null; phone: string | null; email: string | null}>) => Promise<{ org: string; code: string }>` (uses `buildSchool` then `admin.billing_account_set`), `subscribe(db, who, org, plan, seats, startsOn, dueDays = 15) => Promise<{ subscriptionId: string; invoiceId: string; number: string }>`, and `rpc<T>(db, claims, fn, args: Record<string, unknown>) => Promise<T>` (one `asClaims` call building `select admin.<fn>(<p_x> => $n, ...) as v`, with `::jsonb` for `p_value` as the transport does).

`SELLER`: `{ legalName: 'Qrie Learning Private Limited', gstin: '27AAAAA0000A1Z5', state: '27', address: 'Pune, Maharashtra', sac: '999293', rateBp: 1800, title: 'Tax invoice' }`. These are test values only; the real ones are the CA's (Aarav's steps).

- [ ] **Step 1: Write the failing tests**

`supabase/tests/billing-invariants.test.ts` (whole-database checks; `freshDatabase()` once):
1. `no billing table can be read or written by anon, authenticated or service_role`: for every table in schema `billing` and each role, `has_table_privilege(role, oid, 'select,insert,update,delete')` is false.
2. `no billing function can be called by anon, authenticated or service_role`: for every function in schema `billing`, `has_function_privilege(role, oid, 'execute')` is false.
3. `every billing table except the webhook log and school_state carries the tripwire`: `pg_trigger` has a trigger calling `admin.tripwire` on `seller, plan, account, subscription, number_counter, invoice, payment_link, payment, refund, credit_note`.

`supabase/tests/billing-ledger.test.ts` (`beforeAll`: database, `setEnvironment`, owner, ops, safety, `makeFinance`, child via `anonymousChild`). Tests:

*Settings and plans*
1. `only the owner, with a fresh code, sets the seller's details`: as `aal2(ops)` → `not allowed`; as `aal2(owner)` (stale) → `confirm with your authenticator code first`; as `fresh(owner)` → stored; `admin.billing_settings()` as `aal2(finance)` returns them; an audit row `billing-settings-set` exists.
2. `the seller's GSTIN must start with its state code, and there is no GST without a GSTIN`: GSTIN `29...` with state `27` → `the GSTIN's first two digits are its state code`; `p_gstin => null` with rate 1800 → `without a GSTIN the GST rate is 0`; rate 2900 → `a GST rate is 0 to 2800 basis points`.
3. `a plan has a lower-case code that is not pilot, 1 to 36 months, and a price in paise`: `pilot` → `pilot is a trial, not a plan that is sold`; `Standard` is stored as `standard`; months 0 → refused; price −1 → refused; ops → `not allowed`.

*Accounts*
4. `ops set a school's billing account; finance, safety and a child cannot` (spec section 3: finance reads billing, records offline payments and prints invoices; raising and sending links are ops').
5. `a contact phone is 10 digits starting 6 to 9 and an email has an @; a school GSTIN matches its state`: `12345` → `a phone is 10 digits`; `x` → `that is not an email address`.

*Raising*
6. `nothing is raised until the seller's details are complete`: fresh database without `readySeller` → `set the seller's details in Billing settings first`.
7. `a subscription invoice is seats times price, with CGST and SGST inside one state`: plan 50,000 paise/seat/year, 40 seats, buyer state 27: `taxable_paise = 2000000`, `cgst = sgst = 180000`, `igst = 0`, `total = 2360000`, `description` names the plan, seats and the two dates, `ends_on = starts_on + 12 months − 1 day`, `due_on = issued_on + 15`, number `QRIE/<fy>/0001`.
8. `across states it is IGST`: buyer state 29: `igst = 360000`, `cgst = sgst = 0`.
9. `numbers run 0001, 0002 and on, with none repeated or skipped, under twenty raises at once`: `Promise.all` of 20 `billing_invoice_raise` → the set of `seq` is exactly 1..20 and every `number` is unique. (PGlite runs them one at a time; the guarantee across connections is the row lock in `next_number`, UNVERIFIED on hosted Postgres.)
10. `a raise that fails leaves no gap`: inside one `asClaims` transaction raise, then throw; the next raise takes the number the failed one would have had.
11. `the financial year turns on 1 April in India`: `billing.fy_of('2026-04-01') = '26-27'`, `('2026-03-31') = '25-26'`, `fy_of(('2026-03-31T19:00:00Z'::timestamptz at time zone 'Asia/Kolkata')::date) = '26-27'`; `format_number('invoice','26-27',7) = 'QRIE/26-27/0007'`, `format_number('credit_note','26-27',1) = 'QRCN/26-27/0001'`, and 100000 → `the invoice series is full for this year`.
12. `a school cannot be sold two subscriptions for the same days`: second overlapping `billing_subscription_create` → `this school already has a subscription for part of that time`.
13. `an ad hoc invoice has one line and takes the next number in the same series`.
14. `an issued invoice is never edited or deleted, even by hand, and a hand edit elsewhere is logged`: as the database owner, `update billing.invoice set total_paise = 1` → `an issued invoice is not edited`; `delete from billing.invoice` → `billing records are never deleted`; `update billing.plan set name = 'x'` by hand succeeds and leaves an `unmanaged-change` row with `target_kind = 'plan'`, while the functions in this file leave none.

*Reading*
15. `the invoice list carries no contact phone, email or name`: `JSON.stringify(admin.billing_invoices())` contains neither the account's phone, email nor contact name.
16. `a child, an aal1 owner and safety are refused every billing read`: `billing_settings`, `billing_plans`, `billing_invoices`, `billing_invoice`, `billing_subscriptions` each → `not allowed`.

In `admin-invariants.test.ts`, add to the `authenticated` list (C collation order): `admin.billing_account_set`, `admin.billing_invoice`, `admin.billing_invoice_raise`, `admin.billing_invoices`, `admin.billing_plan_set`, `admin.billing_plans`, `admin.billing_settings`, `admin.billing_settings_set`, `admin.billing_subscription_create`, `admin.billing_subscriptions`, placed before `admin.flag_list`.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run supabase/tests/billing-ledger.test.ts supabase/tests/billing-invariants.test.ts supabase/tests/admin-invariants.test.ts`
Expected: FAIL (`schema "billing" does not exist`; the invariants list is missing ten names).

- [ ] **Step 3: Write the migration**

`supabase/migrations/0057_billing_ledger.sql`. Header comment: what the schema holds, that no API role can reach it, that Qrie's numbered invoice is the record and Cashfree only collects (spec section 10), the 16-character rule with its URL, and that issued invoices and payments are never edited or deleted.

```sql
create schema if not exists billing;
revoke all on schema billing from public;

create table if not exists billing.seller (
  id boolean primary key default true check (id),
  legal_name text not null default '' check (char_length(legal_name) <= 120),
  gstin text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  state_code text not null default '' check (state_code = '' or state_code ~ '^[0-9]{2}$'),
  address text not null default '' check (char_length(address) <= 400),
  sac_code text not null default '' check (sac_code = '' or sac_code ~ '^[0-9]{4,8}$'),
  gst_rate_bp integer check (gst_rate_bp is null or gst_rate_bp between 0 and 2800),
  invoice_title text not null default 'Tax invoice' check (char_length(invoice_title) between 1 and 40),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into billing.seller default values on conflict do nothing;

create table if not exists billing.plan (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9-]{0,29}$' and code <> 'pilot'),
  name text not null check (char_length(name) between 1 and 80),
  months integer not null check (months between 1 and 36),
  seat_price_paise bigint not null check (seat_price_paise >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists billing.account (
  org_id uuid primary key references lms.school (org_id) on delete restrict,
  legal_name text not null check (char_length(legal_name) between 1 and 120),
  gstin text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  state_code text not null check (state_code ~ '^[0-9]{2}$'),
  address text not null check (char_length(address) between 1 and 400),
  contact_name text not null check (char_length(contact_name) between 1 and 80),
  contact_email text check (contact_email is null or contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_phone text check (contact_phone is null or contact_phone ~ '^[6-9][0-9]{9}$'),
  grace_days integer not null default 14 check (grace_days between 14 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists billing.subscription (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references billing.account on delete restrict,
  plan_id uuid not null references billing.plan on delete restrict,
  seats integer not null check (seats between 1 and 100000),
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  seat_price_paise bigint not null check (seat_price_paise >= 0),
  -- How it is collected. Plan 7 adds 'mandate' (Cashfree Subscriptions, UPI Autopay).
  collection text not null default 'invoice' check (collection in ('invoice')),
  created_at timestamptz not null default now(),
  created_by uuid,
  licence_applied_at timestamptz,
  cancelled_at timestamptz
);
create index if not exists subscription_org on billing.subscription (org_id, starts_on);

create table if not exists billing.number_counter (
  series text not null check (series in ('invoice', 'credit_note')),
  fy text not null check (fy ~ '^[0-9]{2}-[0-9]{2}$'),
  last_number integer not null check (last_number > 0),
  primary key (series, fy)
);

create table if not exists billing.invoice (
  id uuid primary key default gen_random_uuid(),
  number text not null unique check (char_length(number) <= 16),
  fy text not null,
  seq integer not null,
  org_id uuid not null references billing.account on delete restrict,
  subscription_id uuid unique references billing.subscription on delete restrict,
  kind text not null check (kind in ('subscription', 'other')),
  description text not null check (char_length(description) between 1 and 200),
  quantity integer not null check (quantity >= 1),
  unit_paise bigint not null check (unit_paise >= 0),
  taxable_paise bigint not null check (taxable_paise = quantity * unit_paise),
  gst_rate_bp integer not null check (gst_rate_bp between 0 and 2800),
  cgst_paise bigint not null check (cgst_paise >= 0),
  sgst_paise bigint not null check (sgst_paise >= 0),
  igst_paise bigint not null check (igst_paise >= 0),
  total_paise bigint not null check (total_paise > 0 and total_paise = taxable_paise + cgst_paise + sgst_paise + igst_paise),
  currency text not null default 'INR' check (currency = 'INR'),
  issued_on date not null,
  due_on date not null check (due_on >= issued_on),
  seller jsonb not null,
  buyer jsonb not null,
  status text not null default 'unpaid' check (status in ('unpaid', 'partly_paid', 'paid', 'void')),
  paid_paise bigint not null default 0 check (paid_paise >= 0),
  paid_on date,
  voided_at timestamptz,
  raised_by uuid,
  created_at timestamptz not null default now(),
  unique (fy, seq),
  check ((kind = 'subscription') = (subscription_id is not null))
);
create index if not exists invoice_org on billing.invoice (org_id, issued_on desc);

create table if not exists billing.payment_link (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references billing.invoice on delete restrict,
  attempt integer not null check (attempt >= 1),
  link_id text not null unique check (link_id ~ '^[A-Za-z0-9_-]{1,50}$'),
  cf_link_id text,
  url text check (url is null or url ~ '^https://'),
  amount_paise bigint not null check (amount_paise > 0),
  status text not null default 'creating'
    check (status in ('creating', 'active', 'partly_paid', 'paid', 'expired', 'cancelled', 'failed')),
  amount_paid_paise bigint not null default 0 check (amount_paid_paise >= 0),
  expires_at timestamptz not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_checked_at timestamptz,
  unique (invoice_id, attempt)
);
create unique index if not exists payment_link_one_open on billing.payment_link (invoice_id)
  where status in ('creating', 'active', 'partly_paid');

create table if not exists billing.payment (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references billing.account on delete restrict,
  invoice_id uuid references billing.invoice on delete restrict,
  link_id uuid references billing.payment_link on delete restrict,
  source text not null check (source in ('cashfree_link', 'bank_transfer', 'cheque')),
  amount_paise bigint not null check (amount_paise > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  received_on date not null,
  reference text not null check (char_length(reference) between 1 and 80),
  cf_order_id text unique,
  counted boolean not null,
  not_counted_why text check (not_counted_why is null or char_length(not_counted_why) <= 200),
  recorded_by uuid,
  recorded_as text not null,
  created_at timestamptz not null default now(),
  check (counted = (not_counted_why is null)),
  check ((source = 'cashfree_link') = (cf_order_id is not null))
);
create unique index if not exists payment_offline_once on billing.payment (invoice_id, source, reference)
  where source <> 'cashfree_link';

create table if not exists billing.refund (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references billing.payment on delete restrict,
  refund_id text not null unique check (refund_id ~ '^[A-Za-z0-9]{3,40}$'),
  amount_paise bigint not null check (amount_paise > 0),
  status text not null default 'requested' check (status in ('requested', 'pending', 'success', 'failed')),
  cf_refund_id text,
  detail text check (detail is null or char_length(detail) <= 200),
  requested_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists billing.credit_note (
  id uuid primary key default gen_random_uuid(),
  number text not null unique check (char_length(number) <= 16),
  fy text not null,
  seq integer not null,
  invoice_id uuid not null references billing.invoice on delete restrict,
  refund_id uuid not null unique references billing.refund on delete restrict,
  amount_paise bigint not null check (amount_paise > 0),
  taxable_paise bigint not null check (taxable_paise >= 0),
  tax_paise bigint not null check (tax_paise >= 0 and taxable_paise + tax_paise = amount_paise),
  issued_on date not null,
  unique (fy, seq)
);

create table if not exists billing.webhook_event (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default clock_timestamp(),
  idem_key text unique,
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  body_length integer not null check (body_length >= 0),
  signature_ok boolean not null,
  event_type text check (event_type is null or char_length(event_type) <= 60),
  link_id text, order_id text, refund_id text,
  payload jsonb not null default '{}'::jsonb,
  status text not null check (status in ('stored', 'processed', 'ignored', 'mismatch', 'unparsed', 'signature_failed')),
  detail text check (detail is null or char_length(detail) <= 200),
  processed_at timestamptz,
  check (signature_ok or (idem_key is null and payload = '{}'::jsonb))
);
create index if not exists webhook_event_time on billing.webhook_event (received_at desc);

create table if not exists billing.school_state (
  org_id uuid primary key references lms.school (org_id) on delete cascade,
  state text not null check (state in ('none', 'trial', 'active', 'grace', 'suspended', 'ended')),
  since date not null,
  checked_on date not null
);
```

Then, for every table: `revoke all on billing.<t> from public, anon, authenticated, service_role; alter table billing.<t> enable row level security;` and, for the ten listed in invariants test 3, `create trigger <t>_tripwire after insert or update or delete on billing.<t> for each row execute function admin.tripwire();`.

Guards:

```sql
create or replace function billing.no_delete() returns trigger language plpgsql as $$
begin
  raise exception 'billing records are never deleted' using errcode = '42501';
end;
$$;
-- before delete (row) and before truncate (statement) on: invoice, payment, payment_link, refund, credit_note, subscription, account, plan.

create or replace function billing.invoice_guard() returns trigger language plpgsql as $$
declare
  rank_old integer := case old.status when 'unpaid' then 0 when 'partly_paid' then 1 when 'paid' then 2 else 3 end;
  rank_new integer := case new.status when 'unpaid' then 0 when 'partly_paid' then 1 when 'paid' then 2 else 3 end;
begin
  if (new.number, new.fy, new.seq, new.org_id, new.subscription_id, new.kind, new.description, new.quantity,
      new.unit_paise, new.taxable_paise, new.gst_rate_bp, new.cgst_paise, new.sgst_paise, new.igst_paise,
      new.total_paise, new.currency, new.issued_on, new.due_on, new.seller, new.buyer)
     is distinct from
     (old.number, old.fy, old.seq, old.org_id, old.subscription_id, old.kind, old.description, old.quantity,
      old.unit_paise, old.taxable_paise, old.gst_rate_bp, old.cgst_paise, old.sgst_paise, old.igst_paise,
      old.total_paise, old.currency, old.issued_on, old.due_on, old.seller, old.buyer) then
    raise exception 'an issued invoice is not edited' using errcode = '42501';
  end if;
  if old.status = 'void' then
    raise exception 'a void invoice does not change' using errcode = '42501';
  end if;
  if new.status = 'void' and old.paid_paise > 0 then
    raise exception 'an invoice with money on it cannot be void' using errcode = '42501';
  end if;
  if new.paid_paise < old.paid_paise or (new.status <> 'void' and rank_new < rank_old) then
    raise exception 'an invoice only moves forward' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger invoice_guard before update on billing.invoice for each row execute function billing.invoice_guard();
```

Helpers (internal):

```sql
create or replace function billing.fy_of(p_day date) returns text language sql immutable as $$
  select case when extract(month from p_day) >= 4
    then to_char(p_day, 'YY') || '-' || to_char(p_day + interval '1 year', 'YY')
    else to_char(p_day - interval '1 year', 'YY') || '-' || to_char(p_day, 'YY') end
$$;

-- Gapless: the counter row is locked by the upsert until the transaction ends,
-- and a transaction that fails rolls its number back with it.
create or replace function billing.next_number(p_series text, p_fy text) returns integer language sql volatile as $$
  insert into billing.number_counter (series, fy, last_number) values (p_series, p_fy, 1)
  on conflict (series, fy) do update set last_number = billing.number_counter.last_number + 1
  returning last_number
$$;

create or replace function billing.format_number(p_series text, p_fy text, p_n integer) returns text language plpgsql immutable as $$
begin
  if p_n > 99999 then
    raise exception 'the % series is full for this year', case p_series when 'invoice' then 'invoice' else 'credit note' end;
  end if;
  return case p_series when 'invoice' then 'QRIE/' else 'QRCN/' end || p_fy || '/' || lpad(p_n::text, 4, '0');
end;
$$;

-- Half-up rounding in whole paise. Inside one state, CGST and SGST are each half
-- the rate; across states, IGST is the whole rate. The CA confirms (Aarav's steps).
create or replace function billing.gst_split(p_taxable bigint, p_rate_bp integer, p_seller_state text, p_buyer_state text,
  out cgst bigint, out sgst bigint, out igst bigint) language sql immutable as $$
  select case when p_seller_state = p_buyer_state then (p_taxable * p_rate_bp + 10000) / 20000 else 0 end,
         case when p_seller_state = p_buyer_state then (p_taxable * p_rate_bp + 10000) / 20000 else 0 end,
         case when p_seller_state = p_buyer_state then 0 else (p_taxable * p_rate_bp + 5000) / 10000 end
$$;
```

(Note on test 11's message: `the invoice series is full for this year` for series `invoice`.)

`billing.seller_ready()`: returns `set the seller's details in Billing settings first` when any of `legal_name, state_code, address, sac_code` is empty or `gst_rate_bp` is null; else null.

`billing.raise_invoice(p_org, p_sub, p_kind, p_description, p_quantity, p_unit, p_due_on, p_by) returns billing.invoice`: raises `seller_ready()`'s message if not null; reads `billing.account` (missing → `set up this school's billing account first`); `taxable := p_quantity * p_unit`; `gst_split(taxable, seller.gst_rate_bp, seller.state_code, account.state_code)`; total must be > 0 (`an invoice must be for more than nothing`); `fy := fy_of(lms.india_today())`; `seq := next_number('invoice', fy)`; `number := format_number('invoice', fy, seq)`; inserts with `issued_on = lms.india_today()`, `seller = jsonb_build_object('legalName','gstin','stateCode','address','sacCode','title')` and `buyer = jsonb_build_object('legalName','gstin','stateCode','address','schoolCode','schoolName')` (no contact fields); returns the row.

Browser functions (each `security definer`, `set search_path = admin, billing, lms, public`):

| Function | Who | Checks, in order, and effect |
|---|---|---|
| `admin.billing_settings() returns jsonb` | owner, ops, finance | `{legalName, gstin, stateCode, address, sacCode, gstRateBp, title, ready: seller_ready() is null, updatedAt}` |
| `admin.billing_settings_set(p_legal_name text, p_gstin text, p_state text, p_address text, p_sac text, p_gst_rate_bp integer, p_title text, p_reason text, p_env text) returns void` | owner + fresh code | env; reason; trims; `upper(p_gstin)`; GSTIN prefix = state (`the GSTIN's first two digits are its state code`); null GSTIN ⇒ rate 0 (`without a GSTIN the GST rate is 0`); rate 0..2800 (`a GST rate is 0 to 2800 basis points`); session on; update the one row; audit `billing-settings-set`, kind `setting`, id `seller`, details `{gstRateBp, sacCode, hasGstin}` |
| `admin.billing_plans() returns jsonb` | owner, ops, finance | array of `{code, name, months, seatPricePaise, active}` ordered by `active desc, code` |
| `admin.billing_plan_set(p_code text, p_name text, p_months integer, p_seat_price_paise bigint, p_active boolean, p_reason text, p_env text) returns void` | owner + fresh code | env; reason; `code := lower(btrim(p_code))`; `pilot` → `pilot is a trial, not a plan that is sold`; shape, months, price (`a price is 0 or more paise`); upsert on code (price change applies to subscriptions sold later: each subscription keeps `seat_price_paise`); audit `plan-set` with `{code, months, seatPricePaise, active}` |
| `admin.billing_account_set(p_org uuid, p_legal_name text, p_gstin text, p_state text, p_address text, p_contact_name text, p_contact_email text, p_contact_phone text, p_reason text, p_env text) returns void` | owner, ops | env; reason; school exists (`there is no such school`); shapes (`a phone is 10 digits starting 6 to 9`, `that is not an email address`, the GSTIN prefix rule); empty strings become null for gstin/email/phone; upsert (grace_days untouched); audit `billing-account-set`, kind `school`, id = school code, details `{hasGstin, hasEmail, hasPhone, stateCode}` |
| `admin.billing_subscription_create(p_org uuid, p_plan text, p_seats integer, p_starts_on date, p_due_days integer, p_reason text, p_env text) returns jsonb` | owner, ops | env; reason; account exists; plan active (`there is no plan called % that is on sale`); seats 1..100000; start not null; due days `coalesce(p_due_days, 15)` in 0..90; `ends_on := (p_starts_on + make_interval(months => plan.months))::date - 1`; overlap with a not-cancelled subscription of that org → refused; insert subscription; `billing.raise_invoice(org, sub, 'subscription', format('%s plan, %s seats, %s to %s', plan.name, seats, to_char(start,'DD Mon YYYY'), to_char(ends,'DD Mon YYYY')), seats, plan.seat_price_paise, lms.india_today() + due_days, me.user_id)`; audit `subscription-created` and `invoice-raised` (`{number, totalPaise}`); returns `{subscriptionId, invoiceId, number}` |
| `admin.billing_invoice_raise(p_org uuid, p_description text, p_amount_paise bigint, p_due_days integer, p_reason text, p_env text) returns jsonb` | owner, ops | env; reason; description 1..200; amount > 0; kind `other`, quantity 1, unit = amount; audit `invoice-raised`; returns `{invoiceId, number}` |
| `admin.billing_subscriptions(p_org uuid default null) returns jsonb` | owner, ops, finance | array of `{id, orgId, schoolCode, schoolName, plan, planName, seats, startsOn, endsOn, seatPricePaise, invoiceId, invoiceNumber, invoiceStatus, licenceAppliedAt, cancelledAt}` newest first, limit 500 |
| `admin.billing_invoices(p_org uuid default null, p_status text default null) returns jsonb` | owner, ops, finance | array of `{id, number, orgId, schoolCode, schoolName, kind, issuedOn, dueOn, totalPaise, paidPaise, status, openLink: {linkId, url, status} or null}` newest first, limit 500; `p_status` one of the four or null |
| `admin.billing_invoice(p_invoice uuid) returns jsonb` | owner, ops, finance | one invoice with every column in camelCase, `seller`, `buyer`, `links: [{linkId, url, status, amountPaise, amountPaidPaise, expiresAt, createdAt}]`, `payments: [{id, source, amountPaise, receivedOn, reference, counted, notCountedWhy, recordedAs, refundedPaise}]`, `creditNotes: [{number, amountPaise, taxablePaise, taxPaise, issuedOn}]`; missing → `there is no such invoice` |

Dates in answers are `to_char(d, 'YYYY-MM-DD')`, as `lms.school_licence` does (`0041:102-104`).

Grants at the end: `revoke all on function ... from public, anon, authenticated;` for every `billing.*` function and trigger function, plus `from service_role` for `billing.*`; `revoke ... from public, anon` then `grant execute ... to authenticated` for the ten `admin.billing_*` functions.

- [ ] **Step 4: Add the fixtures and run the tests**

Add the helpers listed under Interfaces to `billing-fixtures.ts`.
Run: `npx vitest run supabase/tests/billing-ledger.test.ts supabase/tests/billing-invariants.test.ts supabase/tests/admin-invariants.test.ts`
Expected: PASS: 16 + 3 + 4 tests.

- [ ] **Step 5: Nothing else moved**

Run: `npx vitest run supabase/tests packages/admin-client packages/lms-client`
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add supabase/migrations/0057_billing_ledger.sql supabase/tests/billing-fixtures.ts supabase/tests/billing-ledger.test.ts supabase/tests/billing-invariants.test.ts supabase/tests/admin-invariants.test.ts
Commit "feat: the billing ledger: gapless invoice numbers per financial year, GST split, plans and accounts"
```

---

### Task 3: Money in by hand, settling, the licence follows the money, void, S1 (0058)

**Files:**
- Create: `supabase/migrations/0058_billing_payments_licence.sql`
- Test: `supabase/tests/billing-payments.test.ts`; modify `admin-invariants.test.ts`

**Interfaces:**
- Consumes: Task 2; `lms.licence`, `lms.set_licence`.
- Produces (internal): `billing.audit_as(p_actor uuid, p_role text, p_name text, p_action text, p_kind text, p_id text, p_reason text, p_details jsonb)` (inserts into `admin.audit_event` with that actor; used for "Cashfree"); `billing.settle(p_invoice uuid, p_actor uuid, p_role text, p_name text) returns jsonb {status, licenceSet}`; `billing.apply_licence(p_sub uuid, p_actor uuid, p_role text, p_name text) returns boolean`; `billing.payment_signal_on(p_org uuid, p_day date) returns jsonb`; `admin.school_payment_signal(p_org uuid) returns jsonb` (S1, no API grant).
- Produces (browser): `admin.billing_payment_record(...)`, `admin.billing_payments(p_org uuid default null)`, `admin.billing_invoice_void(p_invoice uuid, p_reason text, p_env text, p_commit boolean) returns jsonb {openLinks: text[], voided: boolean}`.

- [ ] **Step 1: Write the failing tests**

`supabase/tests/billing-payments.test.ts` (`beforeAll`: database, env, owner (`Aarav`), ops, safety, finance (`Accounts`), `readySeller`, `readyPlan`, two schools via `billedSchool`). Tests:
1. `finance records a bank transfer with a fresh code; the owner may; ops and safety may not`: `aal2(finance)` → `confirm with your authenticator code first`; `fresh(finance)` → `{paymentId, invoiceStatus: 'partly_paid', licenceSet: false}` for half the total; `fresh(ops)` → `not allowed`.
2. `a part payment makes the invoice partly paid, the rest makes it paid with today's date`.
3. `refuses more than is due, a void or paid invoice, a future date, an unknown source and the same reference twice`: messages `that is more than the % paise still due`, `this invoice is void`, `this invoice is already paid`, `a payment cannot be received in the future`, `a payment by hand is a bank transfer or a cheque`, and the unique index (`this reference is already recorded for this invoice`).
4. `a fully paid subscription invoice sets the school's licence: plan, seats and last day, and says who`: `lms.licence` = `{plan: 'standard', seats: 40, valid_until: ends_on}`; `admin.audit_event` has `licence-from-payment` with `actor_name = 'Accounts'` and `target_id` = the school code; `lms.audit_event` has `licence-set`.
5. `a late payment for an older period never shortens a longer licence`: pay a 2027-28 subscription, then a 2026-27 one: `valid_until` stays the later date; an audit `licence-kept` row exists.
6. `an ad hoc invoice paid in full does not touch the licence`.
7. `void is the owner's with a fresh code, only with nothing paid; the number stays used and the subscription is cancelled`: finance → `not allowed`; owner stale → needs code; on a partly paid invoice → `an invoice with money on it cannot be void`; on an unpaid one with `p_commit => false` → `{openLinks: [], voided: false}` and nothing changed; with `p_commit => true` → `status = 'void'`, `subscription.cancelled_at` set, the next raise takes the next number (no reuse).
8. `void waits for an open payment link to be cancelled`: insert a `billing.payment_link` row (as the database owner, `status 'active'`); `p_commit => false` returns its `link_id` in `openLinks`; `p_commit => true` → `cancel the payment link first`.
9. `audit rows hold ids, amounts and a hash of the reference, never the reference`: the `payment-recorded` row's `details` has `referenceSha256` (64 hex) and no key whose value equals the typed reference.
10. `the payment signal is grey with no billing account` (`billing.payment_signal_on(org, today)` → `{"level":"grey","reason":"No billing account yet."}`).
11. `green when nothing is overdue` (`Nothing is overdue.`).
12. `amber 1 to 14 days overdue, red after 14`: an invoice due today; `payment_signal_on(org, due_on + 1)` → amber `An invoice is 1 day overdue.`; `+ 14` → amber `... 14 days overdue.`; `+ 15` → red `An invoice is 15 days overdue.`; once paid → green.
13. `admin.school_payment_signal is not callable from a browser, and answers as payment_signal_on for today`: `has_function_privilege('authenticated', 'admin.school_payment_signal(uuid)', 'execute')` is false; as the database owner its answer equals `payment_signal_on(org, lms.india_today())`.

Add to the `authenticated` list: `admin.billing_invoice_void`, `admin.billing_payment_record`, `admin.billing_payments`.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run supabase/tests/billing-payments.test.ts supabase/tests/admin-invariants.test.ts`
Expected: FAIL (`function admin.billing_payment_record ... does not exist`).

- [ ] **Step 3: Write the migration**

`0058_billing_payments_licence.sql`. Bodies, in prose where the SQL is plain:

`billing.audit_as`: one `insert into admin.audit_event (actor, actor_role, actor_name, action, target_kind, target_id, reason, details, environment) values (..., admin.environment())`.

```sql
create or replace function billing.settle(p_invoice uuid, p_actor uuid, p_role text, p_name text)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, billing, lms, public
as $$
declare
  inv billing.invoice;
  paid bigint;
  next_status text;
  licence_set boolean := false;
begin
  select * into inv from billing.invoice where id = p_invoice for update;
  if inv.status = 'void' then
    return jsonb_build_object('status', 'void', 'licenceSet', false);
  end if;
  select coalesce(sum(p.amount_paise) filter (where p.counted), 0) into paid
    from billing.payment p where p.invoice_id = p_invoice;
  next_status := case when paid >= inv.total_paise then 'paid' when paid > 0 then 'partly_paid' else 'unpaid' end;
  perform set_config('admin.session', 'on', true);
  update billing.invoice
     set paid_paise = paid, status = next_status,
         paid_on = case when next_status = 'paid' and inv.status <> 'paid' then lms.india_today() else paid_on end
   where id = p_invoice;
  if next_status = 'paid' and inv.status <> 'paid' and inv.subscription_id is not null then
    licence_set := billing.apply_licence(inv.subscription_id, p_actor, p_role, p_name);
  end if;
  return jsonb_build_object('status', next_status, 'licenceSet', licence_set);
end;
$$;
```

`billing.apply_licence(p_sub, p_actor, p_role, p_name) returns boolean`: reads the subscription, its plan code and the school code; `select valid_until into cur from lms.licence where org_id = sub.org_id`; if `cur > sub.ends_on` → `billing.audit_as(..., 'licence-kept', 'school', code, 'a later period is already paid', {subscription, endsOn, licenceUntil})`, return false; else `perform lms.set_licence(code, plan.code, sub.seats, sub.ends_on)`, `update billing.subscription set licence_applied_at = now()`, `billing.audit_as(..., 'licence-from-payment', 'school', code, 'invoice paid', {subscription, plan, seats, validUntil})`, return true.

`admin.billing_payment_record(p_invoice uuid, p_source text, p_amount_paise bigint, p_received_on date, p_reference text, p_reason text, p_env text) returns jsonb`: `require_staff(array['finance'])`; `require_fresh_mfa(10)` (ruling R8); env; reason; source in `bank_transfer, cheque`; amount > 0; `p_received_on <= lms.india_today()`; reference trimmed 1..80; invoice `for update` (missing / void / paid messages above); amount ≤ `total − paid`; session on; insert `counted = true, recorded_by = me.user_id, recorded_as = me.display_name, currency 'INR', org_id = invoice.org_id`; a unique violation on `payment_offline_once` is caught and re-raised as `this reference is already recorded for this invoice`; `r := billing.settle(id, me.user_id, me.role, me.display_name)`; audit `payment-recorded`, kind `invoice`, id = number, details `{amountPaise, source, referenceSha256: encode(sha256(convert_to(reference,'utf8')),'hex'), invoiceStatus}`; returns `{paymentId, invoiceStatus, licenceSet}`.

`admin.billing_payments(p_org uuid default null) returns jsonb`: owner, ops, finance; array of `{id, orgId, schoolCode, invoiceId, invoiceNumber, source, amountPaise, receivedOn, reference, counted, notCountedWhy, recordedAs, refundedPaise, refundable}` newest first, limit 500, where `refundedPaise` = sum of refunds in `requested, pending, success` and `refundable` = `source = 'cashfree_link' and received_on >= lms.india_today() - 180 and amount > refundedPaise`. (The `billing.refund` table exists from 0057; it is filled in Task 4.)

`admin.billing_invoice_void(p_invoice uuid, p_reason text, p_env text, p_commit boolean) returns jsonb`: `require_staff(array[]::text[])`; `require_fresh_mfa(10)`; env; reason; invoice `for update`; missing / already void (`this invoice is already void`) / `paid_paise > 0` → `an invoice with money on it cannot be void`; `open := array_agg(link_id) from payment_link where invoice_id and status in ('creating','active','partly_paid')`; if `not coalesce(p_commit, false)` → return `{openLinks: coalesce(open, '{}'), voided: false}`; if `open` is not empty → `cancel the payment link first`; session on; `update invoice set status = 'void', voided_at = now()`; `update subscription set cancelled_at = now() where id = invoice.subscription_id`; audit `invoice-voided`; return `{openLinks: [], voided: true}`.

`billing.payment_signal_on(p_org, p_day) returns jsonb` (stable): no account → grey `No billing account yet.`; `days := p_day - min(due_on)` over invoices with `status in ('unpaid','partly_paid') and due_on < p_day`; none → green `Nothing is overdue.`; `days <= 14` → amber; else red; reason `format('An invoice is %s day%s overdue.', days, case when days = 1 then '' else 's' end)`. A failed mandate is plan 7's (no mandate exists yet), so red here is only "more than 14 days".

`admin.school_payment_signal(p_org uuid) returns jsonb`: `select billing.payment_signal_on(p_org, lms.india_today())`, `language sql stable security definer`, `set search_path = admin, billing, lms, public` (plan 2's stub has `admin, public`; `create or replace` sets the new one); `revoke all ... from public, anon, authenticated;` and no grant (S1). Its reason for a school with no billing account is exactly plan 2's stub text, `No billing account yet.`, so plan 2's tests that read the stub (`admin-school-health.test.ts` test 2 and test 20) still pass after the merge.

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run supabase/tests/billing-payments.test.ts supabase/tests/admin-invariants.test.ts supabase/tests/billing-invariants.test.ts`
Expected: PASS: 13 + 4 + 3 tests.

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/0058_billing_payments_licence.sql supabase/tests/billing-payments.test.ts supabase/tests/admin-invariants.test.ts
Commit "feat: offline payments, the licence follows the money, void with nothing paid, and the payment signal"
```

---

### Task 4: Cashfree's side, in the database (0059)

**Files:**
- Create: `supabase/migrations/0059_billing_cashfree.sql`
- Test: `supabase/tests/billing-cashfree.test.ts`; modify `admin-invariants.test.ts`

**Interfaces:**
- Consumes: Tasks 2 and 3 (`settle`, `audit_as`).
- Produces: the browser functions `admin.billing_link_prepare`, `admin.billing_refund_prepare`, `admin.billing_webhook_log`; the nine service-role functions listed under Interfaces except `billing_compute_states`; internal `billing.link_rank(text) returns integer`, `billing.link_status_of(text) returns text`, `billing.advance_link(p_link uuid, p_status text, p_amount_paid bigint) returns boolean`, `billing.apply_link_payment(p_link uuid, p_order_id text, p_amount bigint, p_currency text, p_reference text, p_received_on date, p_notes jsonb) returns text` (`counted`, `duplicate`, or the reason it was not counted), `billing.apply_link_event(p_value jsonb) returns table (status text, detail text)`, `billing.apply_refund_status(p_refund_id text, p_status text, p_cf_refund_id text, p_detail text) returns text`, `billing.issue_credit_note(p_refund uuid) returns text`.

**The extract** (`p_value` of `billing_webhook_ingest`, produced by `tools/billing/src/extract.ts` in Task 6). Only these paths are read and stored; anything else in `p_value` is dropped by the function itself:

```json
{ "type": "PAYMENT_LINK_EVENT", "eventTime": "2026-10-07T12:55:06+05:30",
  "link": { "linkId": "QRIE-26-27-0001", "cfLinkId": "1576977", "status": "PAID",
            "amountPaise": 2360000, "amountPaidPaise": 2360000, "currency": "INR",
            "notes": { "school": "ABC", "invoice": "QRIE/26-27/0001" } },
  "order": { "orderId": "CFPay_x", "amountPaise": 2360000, "transactionId": "1021206", "transactionStatus": "SUCCESS" } }
{ "type": "REFUND_STATUS_WEBHOOK", "eventTime": "...",
  "refund": { "refundId": "qrierf...", "cfRefundId": "11325632", "orderId": "CFPay_x", "status": "SUCCESS", "amountPaise": 200 } }
{ "type": "<anything else>", "eventTime": "..." }
{ "unparsed": true }
```

**Link ids:** the invoice number with `/` replaced by `-` (`QRIE/26-27/0001` → `QRIE-26-27-0001`), plus `-<attempt>` from the second attempt on (Cashfree allows `A-Z a-z 0-9 - _`, 50 characters; documented above). Ruling R2.

- [ ] **Step 1: Write the failing tests**

`supabase/tests/billing-cashfree.test.ts` (setup as Task 3, plus a `linkEvent(over)` builder returning the extract above for a given link and order, and `ingest(key, value)` calling `admin.billing_webhook_ingest` through `asService`). Tests:

*Payment links*
1. `ops prepares a link: id from the invoice number, the amount still due, school and invoice in the notes, the billing contact as customer`: `admin.billing_link_prepare(inv, 'send', 'TEST')` as `aal2(ops)` → `{linkRowId, linkId: 'QRIE-26-27-0001', amountPaise: total, currency: 'INR', purpose: 'Qrie invoice QRIE/26-27/0001 for <school name>', customer: {name, phone, email}, notes: {school, invoice}, expiresAt, sendEmail: true, existing: false}`; a `payment_link` row in `creating`; `expiresAt` = 23:59:59 IST on `greatest(due_on, today) + 30`.
2. `a second prepare while one is open answers with that link; after a failed one the next is attempt 2`: second call while `creating` → same `linkRowId` (`existing: false`, so billing-api retries with the same idempotency key); after `billing_link_created` → `existing: true, url`; after `billing_link_failed` → a new row with `link_id` ending `-2`.
3. `no link without the contact's phone, for a void or paid invoice, or for safety or finance`: `add the billing contact's phone first`, `this invoice is void`, `this invoice is already paid`, `not allowed` (safety and finance each).
4. `link_created, link_failed and link_observed are the service role's alone`: as `fresh(owner)` each → permission denied (no execute grant).

*Webhook events*
5. `a PAID event for the whole amount pays the invoice and sets the licence, in Cashfree's name`: invoice `paid`, link `paid`, one counted payment with `cf_order_id`, `recorded_as = 'Cashfree'`; `admin.audit_event` `licence-from-payment` with `actor_name = 'Cashfree'`, `actor_role = 'service'`; the event row `processed`.
6. `the same delivery twice is stored once and pays once`: second `ingest` with the same key → `{duplicate: true}`; one payment, one event row.
7. `a second event with another key for the same order pays once`: different key, same `orderId` → event `processed`, still one payment (`apply_link_payment` → `duplicate`).
8. `out of order, an EXPIRED after PAID leaves the link and the invoice paid`.
9. `an amount, currency or notes that do not match are stored, not counted, and marked mismatch`: three events (order amount 1 paisa less; currency `USD`; notes invoice another number) → each a payment with `counted = false` and its reason (`the amount is not the link's amount`, `the currency is not INR`, `the notes name another invoice`), invoice unchanged, event `mismatch`.
10. `money on a void invoice is stored, not counted, and needs a refund`: void an invoice whose link row was set `cancelled` by hand, then a PAID event → payment `counted = false`, `not_counted_why = 'the invoice was void'`; it appears in `billing_payments` with `refundable = true`.
11. `an event for a link Qrie did not make is stored and ignored`.
12. `a body that was not JSON is stored as unparsed`.
13. `the stored event keeps only the whitelisted fields`: `ingest` with an extract plus `customer_details: {customer_phone: '9876543210'}` and `link.customer = ...` → the row's `payload` text contains no `9876543210`.
14. `a signature failure is stored with its hash and length only`: `admin.billing_signature_failed(sha, 120, 'mismatch')` → row `signature_ok = false, status 'signature_failed', payload = {}, idem_key null`.

*Refunds*
15. `the owner, with a fresh code, asks for a refund of up to what is left; finance and ops may not`: after a Cashfree payment of 2,360,000 → `admin.billing_refund_prepare(pay, 1000000, ...)` → `{refundRowId, refundId (qrierf + 32 hex), orderId, amountPaise: 1000000, note: 'Refund for QRIE/26-27/0001'}`; a second for 1,400,000 → refused `at most 1360000 paise can still be refunded`; finance → `not allowed`; stale owner → needs code.
16. `SUCCESS issues one credit note, QRCN/<fy>/0001, with its tax share; a later PENDING changes nothing`: `admin.billing_refund_result(refundId, {status: 'SUCCESS', cfRefundId: '1'})` → refund `success`, credit note with `tax_paise = round(amount × (cgst+sgst+igst) / total)`; repeat SUCCESS → no second note; then `PENDING` → still `success`; `REJECTED` on another → `failed`, no note.
17. `a payment made by hand cannot be refunded here`: `only a payment made through a Cashfree link can be refunded here`.

*Reconciliation*
18. `due at most once in 55 minutes`: first `billing_reconcile_due()` → `{due: true, links: [...], refunds: [...]}`; second → `{due: false}`; with `admin.setting billing_reconcile_started` set by hand to an hour ago → due; `p_force => true` → due.
19. `an observed link pays the invoice exactly as a webhook would`: `admin.billing_link_observed(linkId, {status: 'PAID', amountPaidPaise: total, currency: 'INR', orders: [{orderId, amountPaise: total, status: 'PAID'}]})` → invoice `paid`, `{changed: true, counted: 1, mismatched: 0}`; again → `{changed: false, counted: 0, ...}`.
20. `done records the time and the counts`: `admin.billing_reconcile_done({checked: 3, changed: 1, failed: 0})` → `admin.setting billing_reconciled_at` set; audit `billing-reconciled` by service with those counts.
21. `the webhook log lists problems first and never a customer`: `admin.billing_webhook_log(true)` returns only `signature_failed, mismatch, unparsed`; every row has `{id, receivedAt, status, detail, eventType, linkId, orderId}` and no `payload`.

Add to the `authenticated` list: `admin.billing_link_prepare`, `admin.billing_refund_prepare`, `admin.billing_webhook_log`. Add to the `service_role` `arrayContaining` list and to the "not callable by authenticated" loop: `admin.billing_link_created`, `admin.billing_link_failed`, `admin.billing_link_observed`, `admin.billing_reconcile_done`, `admin.billing_reconcile_due`, `admin.billing_refund_result`, `admin.billing_signature_failed`, `admin.billing_webhook_ingest`.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run supabase/tests/billing-cashfree.test.ts supabase/tests/admin-invariants.test.ts`
Expected: FAIL (`admin.billing_link_prepare` does not exist).

- [ ] **Step 3: Write the migration**

Rules the bodies follow:

- `billing.link_rank(s)`: `creating` 0, `active` 1, `failed` 1, `partly_paid` 2, `expired` 3, `cancelled` 3, `paid` 4. `billing.link_status_of(cf)`: `ACTIVE`→`active`, `PARTIALLY_PAID`→`partly_paid`, `PAID`→`paid`, `EXPIRED`→`expired`, `CANCELLED`→`cancelled`, anything else → null.
- `billing.advance_link(p_link, p_status, p_amount_paid)`: when `p_status` is null, only `amount_paid_paise := greatest(old, p_amount_paid)`; else update to `p_status` only if `link_rank(p_status) > link_rank(old.status)`; always `amount_paid_paise = greatest(...)`, `updated_at = now()`, `last_checked_at = now()`; returns whether status or amount changed.
- `billing.apply_link_payment(p_link, p_order_id, p_amount, p_currency, p_reference, p_received_on, p_notes)`: if a payment with `cf_order_id = p_order_id` exists → `duplicate`. Else decide `why` (first that applies): invoice void → `the invoice was void`; `p_currency <> 'INR'` → `the currency is not INR`; `p_amount <> link.amount_paise` → `the amount is not the link's amount`; `p_notes ->> 'invoice'` present and ≠ invoice number → `the notes name another invoice`; `p_amount > total − paid` → `more than is still due`. Insert the payment (`source 'cashfree_link'`, `counted = why is null`, `recorded_as 'Cashfree'`, `reference = coalesce(p_reference, p_order_id)`, `received_on = coalesce(p_received_on, lms.india_today())`); if counted, `billing.settle(invoice, null, 'service', 'Cashfree')`; audit_as Cashfree `payment-received` or `payment-not-counted` (`{invoice number, amountPaise, why}`); return `counted` or `why`.
- `billing.apply_link_event(p_value)`: link row by `p_value #>> '{link,linkId}'` `for update`; none → `('ignored', 'No invoice has this link.')`. If `order` is an object and `transactionStatus = 'SUCCESS'`: `r := apply_link_payment(link, orderId, (order->>'amountPaise')::bigint, link->>'currency', order->>'transactionId', (eventTime at IST)::date, link->'notes')`. Also a mismatch when `(link->>'amountPaise')::bigint <> link.amount_paise` (detail `the link's amount is not the one Qrie asked for`). `advance_link(link, link_status_of(link->>'status'), (link->>'amountPaidPaise')::bigint)`. Status `mismatch` with `r` as detail when `r` is not `counted`/`duplicate`, else `processed`.
- `admin.billing_link_prepare(p_invoice, p_reason, p_env)`: `require_staff(array['ops'])`; env; reason; invoice; void/paid messages; account phone null → `add the billing contact's phone first`; open link row: `creating` → return its payload again with `existing: false`; `active`/`partly_paid` → `{existing: true, linkId, url, amountPaise}`; else `attempt := coalesce(max(attempt), 0) + 1`, `link_id := replace(number, '/', '-') || case when attempt > 1 then '-' || attempt else '' end`, `amount := total − paid`, `expires_at := ((greatest(due_on, lms.india_today()) + 30)::timestamp + time '23:59:59') at time zone 'Asia/Kolkata'`; insert; audit `link-prepared`; return the payload in Step 1 test 1 (`expiresAt` as `to_char(expires_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS"+05:30"')`, `sendEmail: contact_email is not null`).
- `admin.billing_link_created(p_link_id, p_cf_link_id, p_url, p_expires_at)`: row must be `creating` or `failed` (a lost answer found later), else no change; sets `cf_link_id, url, status 'active', expires_at = coalesce(p_expires_at, expires_at)`; `audit_service('link-created', 'invoice', number, '', {linkId})`.
- `admin.billing_link_failed(p_link_id, p_why)`: only from `creating` to `failed`; `audit_service('link-failed', ..., left(p_why, 200))`.
- `admin.billing_link_observed(p_link_id, p_value)`: for each element of `p_value -> 'orders'` with `status = 'PAID'`: `apply_link_payment(link, orderId, amountPaise, coalesce(currency, p_value->>'currency'), null, null, null)`; then `advance_link(link, link_status_of(p_value->>'status'), amountPaidPaise)`; returns `{changed, counted, mismatched}`.
- `admin.billing_webhook_ingest(p_key, p_body_sha256, p_body_length, p_value)`: session on; `insert into billing.webhook_event (idem_key, body_sha256, body_length, signature_ok, event_type, link_id, order_id, refund_id, payload, status) values (p_key, ..., true, left(p_value->>'type', 60), p_value #>> '{link,linkId}', p_value #>> '{order,orderId}', p_value #>> '{refund,refundId}', <whitelist>, 'stored') on conflict (idem_key) do nothing returning id`; no id → `{duplicate: true}`. `<whitelist>` is built with `jsonb_strip_nulls(jsonb_build_object('type', ..., 'eventTime', ..., 'link', jsonb_build_object('linkId', 'cfLinkId', 'status', 'amountPaise', 'amountPaidPaise', 'currency', 'notes', jsonb_build_object('school', left(.., 40), 'invoice', left(.., 40))), 'order', ..., 'refund', ..., 'unparsed', ...))`. Dispatch: `unparsed` → `unparsed` (`The body was not JSON; the hourly check reads the link instead.`); `PAYMENT_LINK_EVENT` → `apply_link_event`; `REFUND_STATUS_WEBHOOK` → `apply_refund_status(refundId, status, cfRefundId, null)` → `processed` or `ignored` (`No refund has this id.`); else `ignored` (`Not an event billing uses.`). Update the row's `status, detail, processed_at`. Return `{duplicate: false, status}`.
- `admin.billing_signature_failed(p_body_sha256, p_body_length, p_why)`: insert `signature_ok = false, status 'signature_failed', detail = left(p_why, 200)`.
- `admin.billing_refund_prepare(p_payment, p_amount_paise, p_reason, p_env)`: owner (`array[]::text[]`) + fresh; env; reason; payment `for update`; `only a payment made through a Cashfree link can be refunded here`; `received_on < lms.india_today() - 180` → `Cashfree refunds only within six months of the payment`; `left := amount − sum(refunds requested|pending|success)`; `p_amount_paise between 1 and left` else `at most % paise can still be refunded`; insert refund with `refund_id := 'qrierf' || replace(gen_random_uuid()::text, '-', '')`; audit `refund-requested` (`{paymentId, amountPaise}`); return `{refundRowId, refundId, orderId: cf_order_id, amountPaise, note: 'Refund for ' || coalesce(invoice number, 'a Qrie payment')}`.
- `billing.apply_refund_status(p_refund_id, p_status, p_cf_refund_id, p_detail)`: map `SUCCESS`→`success`; `PENDING`, `PENDING_APPROVAL`, `ONHOLD`→`pending`; `CANCELLED`, `REJECTED`, `FAILED`→`failed`; rank `requested` 0 < `pending` 1 < `success`/`failed` 2; update only upward; on reaching `success`, `issue_credit_note(refund.id)` when the payment was counted and has an invoice; audit_as Cashfree `refund-<status>`; returns the stored status (or null for an unknown refund id).
- `billing.issue_credit_note(p_refund)`: once per refund (unique); `fy := fy_of(today)`, `seq := next_number('credit_note', fy)`; `tax := (amount * (cgst+sgst+igst) * 2 + total) / (2 * total)` (half-up of `amount × tax / total`), `taxable := amount − tax`; returns the number.
- `admin.billing_refund_result(p_refund_id, p_value)`: `apply_refund_status(p_refund_id, p_value->>'status', p_value->>'cfRefundId', p_value->>'detail')`; returns `{status, creditNote}`.
- `admin.billing_reconcile_due(p_force boolean default false)`: reads `admin.setting` `billing_reconcile_started`; when not forced and that is within 55 minutes → `{due: false}`; else writes `now()` there and returns `{due: true, links: [{linkId, status, createdMinutesAgo}] for status in ('creating','active','partly_paid') and created within 180 days, oldest checked first, limit 50, refunds: [{refundId, orderId, status, createdMinutesAgo}] for status in ('requested','pending'), limit 50}`.
- `admin.billing_reconcile_done(p_value)`: writes `billing_reconciled_at`; `audit_service('billing-reconciled', 'billing', 'reconcile', '', {checked, changed, failed})` with the three integers only.
- `admin.billing_webhook_log(p_problems boolean default false)`: owner, ops, finance; newest 200 rows, `p_problems` keeps `signature_failed, mismatch, unparsed`; fields as test 21.

`admin.setting.key` must match `^[a-z][a-z_]{1,40}$` (`0047:43`): `billing_reconcile_started` and `billing_reconciled_at` do.

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run supabase/tests/billing-cashfree.test.ts supabase/tests/admin-invariants.test.ts supabase/tests/billing-invariants.test.ts`
Expected: PASS: 21 + 4 + 3 tests.

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/0059_billing_cashfree.sql supabase/tests/billing-cashfree.test.ts supabase/tests/admin-invariants.test.ts
Commit "feat: payment links, webhook events stored once and only moving forward, refunds with credit notes, reconciliation bookkeeping"
```

---

### Task 5: Grace, suspension, the apps' view, and the billing pages' reads (0060)

**Files:**
- Create: `supabase/migrations/0060_billing_states.sql`
- Test: `supabase/tests/billing-states.test.ts`; modify `admin-invariants.test.ts`

**Interfaces:**
- Consumes: Tasks 2 to 4; `public.app_config` (0050); `lms.licence`, `lms.seats_used`.
- Produces: `billing.state_for(p_org uuid, p_day date) returns table (state text, grace_until date)`; `admin.billing_grace_set`; `admin.billing_compute_states() returns integer` (service role; cron `billing-states` `40 18 * * *`); `public.app_config(p_school text default null)` with `billing.state` and `billing.grace_until` (S5); `admin.billing_overview()`, `admin.billing_accounts()`, `admin.billing_school(p_org uuid)`.

**The ladder** (spec section 10; ruling R5 for `ended`):

| State | When (IST day `d`, licence last day `L`, grace `g` = the account's `grace_days`, 14 without an account) | `billing.state` in `app_config` |
|---|---|---|
| `none` | no `lms.licence` row | `ok` |
| `trial` | `d <= L` and plan `pilot` | `ok` |
| `active` | `d <= L`, any other plan | `ok` |
| `grace` | `L < d <= L + g` | `grace`, `billing.grace_until = L + g` |
| `suspended` | `L + g < d <= L + g + 60` | `suspended`; `tutor.enabled = false` |
| `ended` | `d > L + g + 60` | `suspended`; `tutor.enabled = false` |

- [ ] **Step 1: Write the failing tests**

`supabase/tests/billing-states.test.ts`:
1. `the ladder: none, trial, active, grace to its last day, suspended, ended 60 days later`: set `lms.licence` with `lms.set_licence` as the database owner, then `billing.state_for(org, day)` for `L`, `L+1`, `L+14`, `L+15`, `L+74`, `L+75` and a pilot licence.
2. `grace is 14 days unless the owner sets 14 to 30 for that school, with a fresh code`: `admin.billing_grace_set(org, 30, ...)` as `fresh(owner)` → `L+30` is grace; 31 → `grace is 14 to 30 days`; finance → `not allowed`.
3. `app_config says ok, grace with its last day, or suspended, and nothing finer`: for each state, `public.app_config(code)` → `billing.state` in `{ok, grace, suspended}` and `billing.grace_until` `YYYY-MM-DD` only in grace (else `""`). (`app_config` reads today, so the test sets the licence's last day relative to `lms.india_today()`.)
4. `a suspended school's tutor is off whatever its own switch says`: `admin.flag_set('tutor.enabled','school',code,true,...)` then a licence that ended 20 days ago → `tutor.enabled = false`; another school unaffected.
5. `app_config with no school says ok and keeps every plan-1 key`: `public.app_config(null)` → `billing.state = 'ok'`, `billing.grace_until = ''`, and the nine plan-1 keys with their defaults.
6. `app_config is still callable with no sign-in`: as `anon`, `select public.app_config('ABC')` works.
7. `the daily job records each change once, audits it, and is scheduled`: `admin.billing_compute_states()` as service → returns the number changed; run twice → second returns 0; `admin.audit_event` `billing-state-changed` rows with `{from, to}`; `cron.job` has `billing-states` with schedule `40 18 * * *`.
8. `the job forgets signature failures older than 90 days`: a `signature_failed` row with `received_at` 91 days ago (inserted by the database owner) is gone after the job; a 10-day-old one stays.
9. `the overview: collected this month, outstanding, overdue, renewals ahead, counts only`: `admin.billing_overview()` as finance → `{collectedThisMonthPaise, outstandingPaise, overdue: {count, paise}, renewals: {in30, in60, in90}, states: {grace, suspended}, attention: {notCounted, webhookProblems24h, signatureFailures24h, lastWebhookMinutesAgo, reconciledMinutesAgo, openLinks}}`, with values from fixtures; its JSON has no school name, phone or email.
10. `a school's billing page has its account with the contact, its state, licence, subscriptions, invoices and payments; safety is refused`: `admin.billing_school(org)` keys `{school: {orgId, code, name}, account, state: {state, graceUntil}, licence: {plan, seats, seatsUsed, validUntil} | null, subscriptions, invoices, payments, signal}` (`signal` = `payment_signal_on(org, today)`); `admin.billing_accounts()` lists every school with `{orgId, code, name, hasAccount, state, licenceUntil, outstandingPaise, overdueDays}` and no contact fields.

Add to the `authenticated` list: `admin.billing_accounts`, `admin.billing_grace_set`, `admin.billing_overview`, `admin.billing_school`; to the service list: `admin.billing_compute_states`. Final list, in order:

```ts
[
  'admin.billing_account_set', 'admin.billing_accounts', 'admin.billing_grace_set', 'admin.billing_invoice',
  'admin.billing_invoice_raise', 'admin.billing_invoice_void', 'admin.billing_invoices', 'admin.billing_link_prepare',
  'admin.billing_overview', 'admin.billing_payment_record', 'admin.billing_payments', 'admin.billing_plan_set',
  'admin.billing_plans', 'admin.billing_refund_prepare', 'admin.billing_school', 'admin.billing_settings',
  'admin.billing_settings_set', 'admin.billing_subscription_create', 'admin.billing_subscriptions',
  'admin.billing_webhook_log', 'admin.flag_list', 'admin.flag_set', 'admin.me', 'admin.relay_status',
  'admin.set_caps', 'admin.set_halt', 'admin.staff_list', 'admin.staff_set', 'admin.today',
]
```

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run supabase/tests/billing-states.test.ts supabase/tests/admin-invariants.test.ts`
Expected: FAIL (`billing.state_for` does not exist).

- [ ] **Step 3: Write the migration**

`billing.state_for` (`language sql stable`): join `lms.licence` (left) and `billing.account` (left) for `p_org`, then the table above.

`public.app_config` replaced (same signature; `language sql stable security definer`; `set search_path = admin, billing, lms, public`):

```sql
create or replace function public.app_config(p_school text default null)
returns jsonb
language sql stable security definer
set search_path = admin, billing, lms, public
as $$
  with flags as (
    select coalesce(jsonb_object_agg(d.key, coalesce(sv.value, gv.value, d.safe_default)), '{}'::jsonb) as v
      from admin.flag_def d
      left join admin.app_flag gv on gv.key = d.key and gv.scope = 'global'
      left join admin.app_flag sv on sv.key = d.key and sv.scope = 'school'
                                 and sv.scope_id = upper(coalesce(p_school, '-'))
  ), st as (
    select case when f.state = 'grace' then 'grace'
                when f.state in ('suspended', 'ended') then 'suspended'
                else 'ok' end as coarse,
           case when f.state = 'grace' then to_char(f.grace_until, 'YYYY-MM-DD') else '' end as until
      from lms.school s, billing.state_for(s.org_id, lms.india_today()) f
     where s.code = upper(coalesce(p_school, '-'))
  )
  select flags.v
         || jsonb_build_object('billing.state', coalesce((select coarse from st), 'ok'),
                               'billing.grace_until', coalesce((select until from st), ''))
         || case when (select coarse from st) = 'suspended'
                 then jsonb_build_object('tutor.enabled', false) else '{}'::jsonb end
    from flags
$$;
revoke all on function public.app_config(text) from public;
grant execute on function public.app_config(text) to anon, authenticated, service_role;
```

(`billing.state_for` and `lms.india_today` are reached as the definer; the `billing.*` revoke from API roles stays.)

`admin.billing_grace_set(p_org, p_days, p_reason, p_env)`: owner + fresh; env; reason; account exists; 14..30 (`grace is 14 to 30 days`); session on; update; audit `grace-set` `{days}`.

`admin.billing_compute_states()`: session on; for each `lms.school`: `(state, _) := state_for(org, lms.india_today())`; insert or update `billing.school_state` when the state differs (`since = today`), else only `checked_on`; on a difference `admin.audit_service('billing-state-changed', 'school', code, '', {from, to})`; then `delete from billing.webhook_event where not signature_ok and received_at < now() - interval '90 days'`; return the number changed. `select cron.schedule('billing-states', '40 18 * * *', $job$ select admin.billing_compute_states(); $job$);` (18:40 UTC is 00:10 IST.)

`admin.billing_overview()`, `admin.billing_accounts()`, `admin.billing_school(p_org)`: owner, ops, finance; shapes as tests 9 and 10. Renewals count licences with `plan <> 'pilot'` and `valid_until` between today and today + 30/60/90. `lastWebhookMinutesAgo` and `reconciledMinutesAgo` are null when never (the page shows grey "never", not zero).

- [ ] **Step 4: Run and see them pass, then every database file**

Run: `npx vitest run supabase/tests/billing-states.test.ts supabase/tests/admin-invariants.test.ts`
Expected: PASS: 10 + 4.
Run: `npx vitest run supabase/tests packages/admin-client packages/lms-client`
Expected: PASS, including plan 1's `admin-flags.test.ts` (its `app_config` assertions read plan-1 keys only).

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/0060_billing_states.sql supabase/tests/billing-states.test.ts supabase/tests/admin-invariants.test.ts
Commit "feat: grace, suspension and end of a school's licence, the apps' coarse billing state, and the billing reads"
```

---

### Task 6: Edge primitives: money, signature, Cashfree client, extract, REST (`tools/billing`)

**Files:**
- Create: `tools/billing/src/{money,signature,cashfree,extract,rest}.ts`
- Test: `tools/billing/tests/{money,signature,cashfree,extract,rest}.test.ts`

**Interfaces:**

```ts
// money.ts
export class MoneyError extends Error {}
/** "200.12", "55.00", 22, 100.81 → paise. Refuses negatives, more than two decimals, NaN, non-finite, above MAX_SAFE_INTEGER. */
export function paiseFromRupees(v: string | number): number;
/** 2360000 → 23600, 12345 → 123.45 (a number with at most two decimals). */
export function rupeesFromPaise(p: number): number;

// signature.ts (WebCrypto only)
export async function sha256Hex(bytes: Uint8Array): Promise<string>;
export async function signWebhook(secret: string, timestamp: string, body: Uint8Array): Promise<string>; // base64
export async function verifyWebhook(secret: string, timestamp: string | null, signature: string | null, body: Uint8Array): Promise<boolean>;

// cashfree.ts
export type CashfreeEnv = 'sandbox' | 'production';
export interface CashfreeConfig { env: CashfreeEnv; clientId: string; clientSecret: string; apiVersion: string; fetchImpl?: typeof fetch }
export interface CashfreeLink { link_id: string; cf_link_id: string; link_url: string; link_status: string; link_amount: number; link_amount_paid: number; link_currency: string; link_expiry_time?: string }
export interface CashfreeLinkOrder { order_id: string; order_amount: number; order_currency: string; order_status: string }
export interface CashfreeRefund { refund_id: string; cf_refund_id: string; order_id: string; refund_amount: number; refund_status: string }
export interface CreateLinkBody { link_id: string; link_amount: number; link_currency: 'INR'; link_purpose: string;
  customer_details: { customer_phone: string; customer_email?: string; customer_name?: string };
  link_partial_payments: false; link_expiry_time: string; link_notes: Record<string, string>;
  link_notify: { send_sms: false; send_email: boolean }; link_meta: { notify_url: string }; link_auto_reminders: false }
export interface CashfreeApi {
  createLink(body: CreateLinkBody, idempotencyKey: string): Promise<CashfreeLink>;
  getLink(linkId: string): Promise<CashfreeLink>;
  linkOrders(linkId: string): Promise<CashfreeLinkOrder[]>;          // GET /links/{id}/orders?status=PAID
  cancelLink(linkId: string): Promise<CashfreeLink>;                  // POST /links/{id}/cancel
  createRefund(orderId: string, body: { refund_amount: number; refund_id: string; refund_note: string; refund_speed: 'STANDARD' }, idempotencyKey: string): Promise<CashfreeRefund>;
  getRefund(orderId: string, refundId: string): Promise<CashfreeRefund>;
}
export class CashfreeError extends Error { readonly status: number; readonly code: string }
export function cashfreeBaseUrl(env: CashfreeEnv): string;
export function cashfreeHttp(cfg: CashfreeConfig): CashfreeApi;

// extract.ts
export type WebhookExtract = Record<string, unknown>; // the shapes in Task 4
/** The whitelisted extract, with amounts in paise; null when the amounts are malformed. */
export function extractEvent(payload: unknown): WebhookExtract | null;

// rest.ts
export class RpcError extends Error { readonly status: number }
/** POST <url>/rest/v1/rpc/<fn> with Content-Profile: admin. `authorization` is the caller's header (user calls) or "Bearer <service key>". */
export function adminRpc(url: string, apikey: string, fetchImpl?: typeof fetch):
  (authorization: string, fn: string, args: Record<string, unknown>) => Promise<unknown>;
```

`signature.ts`, the core:

```ts
const enc = new TextEncoder();
const concat = (a: Uint8Array, b: Uint8Array) => { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; };
const key = (secret: string, use: KeyUsage[]) =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, use);
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

export async function signWebhook(secret: string, timestamp: string, body: Uint8Array): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', await key(secret, ['sign']), concat(enc.encode(timestamp), body));
  return toBase64(new Uint8Array(mac));
}

// verify() compares in constant time inside WebCrypto; a malformed signature is simply false.
export async function verifyWebhook(secret: string, timestamp: string | null, signature: string | null, body: Uint8Array): Promise<boolean> {
  if (!secret || !timestamp || !signature) return false;
  let given: Uint8Array;
  try { given = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0)); } catch { return false; }
  return crypto.subtle.verify('HMAC', await key(secret, ['verify']), given, concat(enc.encode(timestamp), body));
}
```

(`String.fromCharCode(...bytes)` is safe here: a SHA-256 MAC is 32 bytes.)

- [ ] **Step 1: Write the failing tests**

- `money.test.ts`: (1) `reads Cashfree's amounts as paise`: `"200.12"`→20012, `"55.00"`→5500, `22`→2200, `100.81`→10081, `"0.1"`→10, `"7"`→700; (2) `refuses negatives, three decimals, NaN, Infinity, empty strings and amounts past a safe integer`; (3) `writes paise as rupees with at most two decimals`: 2360000→23600, 12345→123.45, 1→0.01, 0→0; and a round trip for 0..10000 paise holds.
- `signature.test.ts`: (1) `matches node:crypto's HMAC-SHA256 base64 of timestamp + raw body` (the test computes the expected value with `node:crypto` `createHmac('sha256', secret).update(ts + raw).digest('base64')`, Cashfree's documented Node sample); (2) `fails for one changed byte, another timestamp, another secret, an empty, missing or non-base64 signature`; (3) `checks the raw bytes, so a body with its spacing and key order kept passes and the same JSON re-serialised fails`; (4) `sha256Hex gives the 64-character hex digest`.
- `cashfree.test.ts` (a recording fake `fetchImpl`): (1) `sandbox and production base URLs`; (2) `createLink posts /links with x-client-id, x-client-secret, x-api-version, x-idempotency-key and the JSON body`; (3) `getLink, linkOrders (status=PAID), cancelLink, createRefund and getRefund use the documented paths and methods` (`GET /links/L`, `GET /links/L/orders?status=PAID`, `POST /links/L/cancel`, `POST /orders/O/refunds`, `GET /orders/O/refunds/R`; path segments URI-encoded); (4) `an error answer becomes CashfreeError with the status and Cashfree's code, and no message carries the secret or the client id` (fake answers `{ "code": "link_post_failed", "message": "..." }` with 400; a thrown network error becomes `CashfreeError` status 0 code `network`); (5) `refuses to build without an id, a secret, a version, or an env other than sandbox or production`.
- `extract.test.ts`: (1) `a PAYMENT_LINK_EVENT keeps the link, its order and the two notes, in paise` (fixture: Cashfree's documented example, with `link_amount: "200.12"`, `order.order_amount: "22.00"`, `cf_link_id: 1576977` → `"1576977"`, `transaction_id: 1021206` → `"1021206"`); (2) `customer details, the link URL, the purpose and any other field are dropped` (`JSON.stringify(out)` has no `9000000000`, `john@gmail.com`, `link_url`); (3) `a REFUND_STATUS_WEBHOOK keeps refund id, order id, status and amount in paise`; (4) `anything else keeps only its type and time`; (5) `a malformed amount gives null`.
- `rest.test.ts`: (1) `a user call sends the caller's Authorization, the anon apikey and Content-Profile: admin to /rest/v1/rpc/<fn>`; (2) `a refusal becomes RpcError with the database's message and the HTTP status, and no message carries a key` (fake 403 `{"message":"not allowed","code":"42501"}` → `RpcError('not allowed', 403)`; a 500 HTML body → message `the database did not answer (500)`).

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run tools/billing`
Expected: FAIL (the `../src/...` imports cannot be resolved).

- [ ] **Step 3: Implement the five modules**

`cashfree.ts` headers on every call: `{ 'x-client-id': cfg.clientId, 'x-client-secret': cfg.clientSecret, 'x-api-version': cfg.apiVersion, accept: 'application/json' }`, plus `content-type: application/json` with a body and `x-idempotency-key` on the two creates. An error's message is `Cashfree answered <status> <code>` plus Cashfree's `message` cut to 200 characters; headers are never formatted into anything.

`extract.ts` builds exactly the Task 4 shapes; `link.notes` keeps only `school` and `invoice`, each cut to 40 characters; strings only.

- [ ] **Step 4: Run and see them pass, then typecheck**

Run: `npx vitest run tools/billing`
Expected: PASS, 5 files, 19 tests.
Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```powershell
git add tools/billing
Commit "feat: billing edge primitives: paise, Cashfree's webhook signature, a Cashfree client behind an interface, the event extract"
```

---

### Task 7: The webhook (`cashfree-webhook`)

**Files:**
- Create: `tools/billing/src/webhook.ts`, `supabase/functions/cashfree-webhook/index.ts`
- Test: `tools/billing/tests/webhook.test.ts`

**Interfaces:**
- Consumes: Task 6 (`verifyWebhook`, `sha256Hex`, `extractEvent`), Task 4's service functions.
- Produces:

```ts
export interface WebhookRequest { method: string; headers: Record<string, string | undefined>; body: Uint8Array }
export interface WebhookDeps {
  secret: string;                                             // CASHFREE_CLIENT_SECRET
  rpc(fn: string, args: Record<string, unknown>): Promise<unknown>; // admin.* with the service role
}
export const MAX_BODY_BYTES = 262144;
export async function handleWebhook(req: WebhookRequest, deps: WebhookDeps): Promise<{ status: number; body: unknown }>;
```

Order of `handleWebhook`, each step returning at once:
1. no secret → 503 `{error: 'cashfree-webhook is missing CASHFREE_CLIENT_SECRET'}`; method not POST → 405.
2. body longer than `MAX_BODY_BYTES` → 413, nothing stored.
3. `hash = sha256Hex(body)`; `verifyWebhook(secret, headers['x-webhook-timestamp'], headers['x-webhook-signature'], body)` false → `rpc('billing_signature_failed', {p_body_sha256: hash, p_body_length: body.length, p_why: missing headers ? 'missing signature headers' : 'signature does not match'})` (its own failure is swallowed and logged) → 401 `{error: 'signature'}`.
4. parse `new TextDecoder().decode(body)` as JSON; failure → `p_value = {unparsed: true}`; else `extractEvent(json) ?? {unparsed: true}`.
5. `key = headers['x-idempotency-key'] || 'sha256:' + hash`.
6. `rpc('billing_webhook_ingest', {p_key: key, p_body_sha256: hash, p_body_length: body.length, p_value})` → 200 `{ok: true}`; a thrown error → 500 `{error: 'not stored'}` (Cashfree retries; the error goes to `console.error` without the body).

The timestamp's age is not checked (ruling R12): retries may carry the original timestamp (UNVERIFIED), and a replay is harmless because the event is stored once and only moves forward.

Deno entry `supabase/functions/cashfree-webhook/index.ts` (`// @ts-nocheck`, header comment in the style of `lms-admin/index.ts`: what it is, `supabase functions deploy cashfree-webhook --no-verify-jwt` because Cashfree sends no Supabase JWT and the signature is checked here first, the secrets it reads, not yet run against a deployed project): reads `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CASHFREE_CLIENT_SECRET`; answers 503 naming any missing; headers lower-cased into a plain object; `body = new Uint8Array(await request.arrayBuffer())`; `rpc = (fn, args) => adminRpc(URL, SERVICE_KEY)('Bearer ' + SERVICE_KEY, fn, args)`; `Deno.serve`.

- [ ] **Step 1: Write the failing tests**

`tools/billing/tests/webhook.test.ts` (`// @vitest-environment node`; over the real migrations: `freshDatabase`, env, owner, `readySeller`, `readyPlan`, `billedSchool`, `subscribe`; a link prepared and created through the service functions; `rpc` bound to `asService` exactly as `tools/lms-import/tests/admin.test.ts:33-43`, calling `admin.<fn>` with `::jsonb` for `p_value`; `signed(body, ts)` builds headers with `signWebhook('test-client-secret', ts, bytes)`; the body is Cashfree's documented example re-pointed at the test link, written as a string with its own spacing). Tests:
1. `a signed PAID event is stored, processed and answered 200, and the invoice is paid`.
2. `a wrong signature is answered 401, stored as a signature failure, and changes nothing else`.
3. `missing timestamp or signature headers are a signature failure`.
4. `the same delivery twice is answered 200 both times and pays once`.
5. `the idempotency header is the key when Cashfree sends one, else the body's hash` (two deliveries with the same body and different `x-idempotency-key` → two rows, one payment; without the header → key `sha256:<hex>`).
6. `an EXPIRED event after PAID leaves the invoice paid`.
7. `a signed body that is not JSON is stored as unparsed and answered 200`.
8. `when the database fails, the answer is 500 so Cashfree retries` (an `rpc` that throws).
9. `no secret answers 503 and a GET answers 405`.
10. `a body over 256 KiB is answered 413 and nothing is stored`.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run tools/billing/tests/webhook.test.ts`
Expected: FAIL (`../src/webhook.ts` cannot be resolved).

- [ ] **Step 3: Implement `webhook.ts` and the Deno entry**

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run tools/billing`
Expected: PASS, 6 files, 29 tests.

- [ ] **Step 5: Commit**

```powershell
git add tools/billing/src/webhook.ts tools/billing/tests/webhook.test.ts supabase/functions/cashfree-webhook/index.ts
Commit "feat: the Cashfree webhook: signature on the raw body first, stored once, answered so Cashfree stops retrying"
```

---

### Task 8: `billing-api`, the only caller of Cashfree

**Files:**
- Create: `tools/billing/src/api.ts`, `tools/billing/tests/fake-cashfree.ts`, `supabase/functions/billing-api/index.ts`
- Test: `tools/billing/tests/api.test.ts`

**Interfaces:**
- Consumes: Tasks 4 and 6; `admin.me()`, `admin.bootstrap_status()`.
- Produces:

```ts
export interface BillingApiRequest { method: string; path: string; authorization?: string; body: unknown }
export interface BillingApiDeps {
  /** An admin.* function run AS THE CALLER: their Authorization header goes to the database, which decides. */
  userRpc(authorization: string, fn: string, args: Record<string, unknown>): Promise<unknown>;
  /** An admin.* function run with the service role. */
  serviceRpc(fn: string, args: Record<string, unknown>): Promise<unknown>;
  cashfree: CashfreeApi;
  cashfreeEnv: CashfreeEnv;
  webhookUrl: string;          // <SUPABASE_URL>/functions/v1/cashfree-webhook
  reconcileToken: string;      // BILLING_RECONCILE_TOKEN; '' disables /reconcile
}
export async function handleBillingApi(req: BillingApiRequest, deps: BillingApiDeps): Promise<{ status: number; body: unknown }>;
```

`fake-cashfree.ts`: `fakeCashfree()` returns `{ api: CashfreeApi, calls: {method, args}[], links: Map, refunds: Map, failNext(status, code), pay(linkId, orderId, amountPaise) }`, holding links and refunds in memory with Cashfree's field names.

Behaviour (every route: POST only (405), JSON object body (400), unknown route 404; `RpcError` from a `userRpc` maps by message: `not allowed` → 403, `confirm with your authenticator code first` → 403 with that message, `this console is ...` → 409, any other 400 message → 400 with the message, 5xx → 502 `Could not reach the database.`; a `CashfreeError` → 502 `Cashfree refused (<code>).`):

- **Pairing** (ruling R16): every staff route starts with `me = userRpc(auth, 'me', {})`; `/reconcile` uses `serviceRpc('bootstrap_status', {})`. `environment === 'HOSTED'` requires `cashfreeEnv === 'production'`, any other environment requires `sandbox`; otherwise 503 `Cashfree is set to <env> but this database is <ENV>; nothing was sent.`
- **`/link`** `{invoiceId, reason, env}`: `prep = userRpc(auth, 'billing_link_prepare', {p_invoice, p_reason, p_env})`; `prep.existing` → 200 `{linkId, url, existing: true}`; else `createLink({link_id: prep.linkId, link_amount: rupeesFromPaise(prep.amountPaise), link_currency: 'INR', link_purpose: prep.purpose, customer_details: {customer_phone, customer_email?, customer_name}, link_partial_payments: false, link_expiry_time: prep.expiresAt, link_notes: prep.notes, link_notify: {send_sms: false, send_email: prep.sendEmail}, link_meta: {notify_url: webhookUrl}, link_auto_reminders: false}, prep.linkRowId)`; on `CashfreeError` with status 409 → `getLink(prep.linkId)` (a link made before whose answer was lost; UNVERIFIED that Cashfree answers 409 for a repeated `link_id`); other `CashfreeError` → `serviceRpc('billing_link_failed', {p_link_id, p_why: code})` and 502; then `serviceRpc('billing_link_created', {p_link_id, p_cf_link_id: String(cf_link_id), p_url: link_url, p_expires_at: link_expiry_time ?? null})` → 200 `{linkId, url, existing: false}`.
- **`/check`** `{invoiceId}`: `detail = userRpc(auth, 'billing_invoice', {p_invoice})` (the permission check); for each link in `creating, active, partly_paid`: `observe(linkId)` = `getLink` (404 on a `creating` row → `billing_link_failed`) then, if `link_amount_paid > 0`, `linkOrders`, then `serviceRpc('billing_link_observed', {p_link_id, p_value: {status, amountPaidPaise, currency, orders: [{orderId, amountPaise, currency, status}]}})`; a `creating` row Cashfree has → `billing_link_created` first. 200 `{checked, changed}`.
- **`/void`** `{invoiceId, reason, env}`: `plan = userRpc(auth, 'billing_invoice_void', {..., p_commit: false})`; for each open link: `getLink`; `PAID` or `PARTIALLY_PAID` → `observe` and 409 `Money arrived on this link; the invoice was not voided. Refund it from Payments if needed.`; `ACTIVE` → `cancelLink`, then `observe` (records `cancelled`); then `userRpc(auth, 'billing_invoice_void', {..., p_commit: true})` → 200 `{voided: true}`. A `needs-mfa` refusal on the first call means Cashfree is never called.
- **`/refund`** `{paymentId, amountPaise, reason, env}`: `prep = userRpc(auth, 'billing_refund_prepare', {p_payment, p_amount_paise, p_reason, p_env})`; `createRefund(prep.orderId, {refund_amount: rupeesFromPaise(prep.amountPaise), refund_id: prep.refundId, refund_note: prep.note, refund_speed: 'STANDARD'}, prep.refundRowId)`; then `serviceRpc('billing_refund_result', {p_refund_id, p_value: {status: refund_status, cfRefundId: cf_refund_id}})` → 200 `{status, creditNote}`. `CashfreeError` with status 400 to 499 → `billing_refund_result` with `{status: 'FAILED', detail: code}` and 502; status 0 or 5xx → leave it `requested` and 502 `Cashfree did not answer; the hourly check will find out what happened.`
- **`/reconcile`** (no body needed): `reconcileToken` empty → 404; `bearerFrom(authorization)` (`packages/relay/src/auth.ts:33`) compared with the token by comparing `sha256Hex` of both (equal-length digests; not a timing oracle on the token) → mismatch 401 before any database call; pairing; `due = serviceRpc('billing_reconcile_due', {p_force: false})`; `!due.due` → 200 `{ran: false}`; for each link (at most 50): `observe` (and `creating` older than 10 minutes: `getLink` → 404 → `billing_link_failed('not at Cashfree')`, found → `billing_link_created` then `observe`); for each refund: `getRefund(orderId, refundId)` → `billing_refund_result`, and 404 on a `requested` refund older than 10 minutes → `FAILED` `not at Cashfree`; each item's failure is counted, not thrown; `serviceRpc('billing_reconcile_done', {p_value: {checked, changed, failed}})` → 200 `{ran: true, checked, changed, failed}`.

Deno entry `supabase/functions/billing-api/index.ts` (`// @ts-nocheck`; header comment: the only caller of Cashfree, deploy with `--no-verify-jwt` because every route checks its caller (staff routes in the database through the caller's own token, `/reconcile` with its token), the secrets it reads, CORS, not yet run against a deployed project): reads `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_ORIGIN`, `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET`, `CASHFREE_ENV`, `CASHFREE_API_VERSION`, `BILLING_RECONCILE_TOKEN` (optional); 503 naming missing required ones; CORS as plan 2's `admin-api`: `access-control-allow-origin` is the `ADMIN_ORIGIN` secret (the console's own address; the same secret plan 2's runbook sets for `admin-api`; missing → 503 naming it), `vary: origin`, `authorization, content-type`, `POST, OPTIONS` (`/reconcile` is called from a server, where CORS does not apply); `userRpc = (auth, fn, args) => adminRpc(URL, ANON)(auth, fn, args)`; `serviceRpc = (fn, args) => adminRpc(URL, SERVICE)('Bearer ' + SERVICE, fn, args)`; `cashfree = cashfreeHttp({...})`.

- [ ] **Step 1: Write the failing tests**

`tools/billing/tests/api.test.ts` (over the real migrations; `userRpc` maps a test bearer token to claims, `fresh(owner)`, `aal2(owner)`, `aal2(ops)`, `aal2(safety)`, a child's, and runs `admin.<fn>` under `asClaims`, throwing `RpcError(message, 400)` on a database error, and 403 when the message is `not allowed` or about the authenticator; `serviceRpc` under `asService`; Cashfree is `fakeCashfree()`). Tests:
1. `/link: ops gets a Cashfree link; Cashfree is asked once with the link id, the amount in rupees, the notes, notify_url and the idempotency key; the database holds the url, active`.
2. `/link again returns the open link without asking Cashfree`.
3. `/link when Cashfree refuses: the row is failed, the answer is 502 with Cashfree's code, and nothing in it is the secret`.
4. `a child, an aal1 session and safety are refused before Cashfree is asked` (fake `calls` empty).
5. `sandbox keys against a HOSTED database, or production keys against TEST, send nothing` (environment set with `admin.set_environment('HOSTED', true)` in a second database, or `cashfreeEnv: 'production'` here).
6. `/check reads the link and its paid orders and pays the invoice` (fake `pay(...)` first).
7. `/void cancels an active link at Cashfree and then voids; money already on the link stops the void and is recorded`.
8. `/void without a fresh code answers with the authenticator message and asks Cashfree nothing`.
9. `/refund: the owner with a fresh code; Cashfree's SUCCESS issues the credit note`.
10. `/refund when Cashfree does not answer leaves the refund requested and says the hourly check will find out`.
11. `/reconcile refuses a missing or wrong token without touching the database` (a `serviceRpc` spy is never called).
12. `/reconcile runs at most once an hour, checks open links and pending refunds, and records what it did`.
13. `/reconcile finishes a link whose creation answer was lost` (a `creating` row older than 10 minutes, set by the database owner; the fake already has the link → `active`).
14. `an unknown route is 404 and a GET is 405`.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run tools/billing/tests/api.test.ts`
Expected: FAIL (`../src/api.ts` cannot be resolved).

- [ ] **Step 3: Implement `api.ts`, `fake-cashfree.ts` and the Deno entry**

- [ ] **Step 4: Run and see them pass, then typecheck**

Run: `npx vitest run tools/billing`
Expected: PASS, 7 files, 43 tests.
Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```powershell
git add tools/billing/src/api.ts tools/billing/tests/api.test.ts tools/billing/tests/fake-cashfree.ts supabase/functions/billing-api/index.ts
Commit "feat: billing-api: links, checks, voids and refunds asked of the database first, and an hourly reconciliation"
```

---

### Task 9: The outside checker asks for reconciliation

This changes two plan-1 files beyond S9 (`run.ts`, `admin-alert.yml`), because deliverable 7 puts the hourly request in the existing checker. The change is additive: with no `BILLING_RECONCILE_TOKEN` the checker behaves exactly as before.

**Files:**
- Create: `tools/admin-alert/src/reconcile.ts`
- Modify: `tools/admin-alert/src/run.ts`, `.github/workflows/admin-alert.yml`
- Test: `tools/admin-alert/tests/reconcile.test.ts`

**Interfaces:**
- Produces: `askReconcile(env: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string; BILLING_RECONCILE_TOKEN: string }, fetchImpl?: typeof fetch): Promise<{ ok: boolean; status: number; ran: boolean | null }>` (never throws; never returns or logs the token); `Env.BILLING_RECONCILE_TOKEN?: string`; `runOnce` returns `{ sent, reconcile: ReconcileResult | null }` and runs the reconcile in a `finally` after the sends, so a failed Telegram send still reconciles and still throws.

Request: `POST ${SUPABASE_URL}/functions/v1/billing-api/reconcile`, headers `authorization: Bearer <token>`, `apikey: <anon key>` (the gateway may want it; UNVERIFIED), `content-type: application/json`, body `{}`. The pacing is the database's (55 minutes), so asking every five minutes costs one database read when nothing is due.

- [ ] **Step 1: Write the failing tests**

`tools/admin-alert/tests/reconcile.test.ts`:
1. `asks billing-api's reconcile route with the token as Bearer and the anon key as apikey`.
2. `never throws; a network error or a 500 comes back as ok false, and the token is in neither the result nor anything logged` (spy on `console.log`/`console.error`).
3. `runOnce asks once when the token is set, and not at all when it is not` (reusing `run.test.ts`'s `stub` pattern; the snapshot answer from that file).
4. `a failed Telegram send still lets the reconcile run, and the send's error still surfaces`.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run tools/admin-alert`
Expected: FAIL (`../src/reconcile.ts` cannot be resolved); `run.test.ts` still passes.

- [ ] **Step 3: Implement**

`run.ts`: import `askReconcile`; `Env` gains the optional field; `runOnce` wraps the send loop in `try { ... } finally { const token = env.BILLING_RECONCILE_TOKEN; if (token) reconcile = await askReconcile({ SUPABASE_URL: env.SUPABASE_URL, SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY, BILLING_RECONCILE_TOKEN: token }, fetchImpl); }` (a narrowed property does not narrow `env` itself, so passing `env` would not typecheck against `BILLING_RECONCILE_TOKEN: string`); `envFromProcess` reads the optional variable without throwing; the main block prints `reconcile: ran`, `reconcile: not due` or `reconcile: failed (<status>)`. Update the file's header comment to say it also asks `billing-api` to reconcile when that token is set.

`admin-alert.yml`: add `BILLING_RECONCILE_TOKEN: ${{ secrets.BILLING_RECONCILE_TOKEN }}` to the step's `env`, and one header-comment line saying so (an unset secret is an empty string, which skips the request).

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run tools/admin-alert`
Expected: PASS, 3 files (plan 1's 21 tests plus 4).
Run: `node --experimental-strip-types tools/admin-alert/src/run.ts`
Expected: throws `SUPABASE_URL is not set` (unchanged).

- [ ] **Step 5: Commit**

```powershell
git add tools/admin-alert .github/workflows/admin-alert.yml
Commit "feat: the outside checker asks billing-api to reconcile, paced to once an hour by the database"
```

---

### Task 10: The typed billing client

**Files:**
- Create: `packages/admin-client/src/billing.ts`
- Modify: `packages/admin-client/src/index.ts` (one export line), `packages/admin-client/src/api.ts` (`Me.role` gains `'finance'`; beyond S9, needed by S6)
- Test: `packages/admin-client/tests/billing.test.ts`

**Interfaces:**
- Consumes: `AdminTransport`, `toAdminError`, `AdminError`.
- Produces:

```ts
export type StaffRoleWithFinance = 'owner' | 'ops' | 'safety' | 'finance';
export type InvoiceStatus = 'unpaid' | 'partly_paid' | 'paid' | 'void';
export interface BillingSettings { legalName: string; gstin: string | null; stateCode: string; address: string; sacCode: string; gstRateBp: number | null; title: string; ready: boolean; updatedAt: string }
export interface BillingPlan { code: string; name: string; months: number; seatPricePaise: number; active: boolean }
export interface InvoiceRow { id: string; number: string; orgId: string; schoolCode: string; schoolName: string; kind: 'subscription' | 'other'; issuedOn: string; dueOn: string; totalPaise: number; paidPaise: number; status: InvoiceStatus; openLink: { linkId: string; url: string | null; status: string } | null }
export interface InvoiceDetail extends InvoiceRow { description: string; quantity: number; unitPaise: number; taxablePaise: number; gstRateBp: number; cgstPaise: number; sgstPaise: number; igstPaise: number; seller: Record<string, string | null>; buyer: Record<string, string | null>; paidOn: string | null; links: LinkRow[]; payments: PaymentRow[]; creditNotes: CreditNoteRow[] }
export interface PaymentRow { id: string; orgId: string; schoolCode: string; invoiceId: string | null; invoiceNumber: string | null; source: 'cashfree_link' | 'bank_transfer' | 'cheque'; amountPaise: number; receivedOn: string; reference: string; counted: boolean; notCountedWhy: string | null; recordedAs: string; refundedPaise: number; refundable: boolean }
export interface SubscriptionRow { ... as admin.billing_subscriptions }
export interface WebhookRow { id: number; receivedAt: string; status: string; detail: string | null; eventType: string | null; linkId: string | null; orderId: string | null }
export interface BillingOverview { ... as admin.billing_overview }
export interface AccountRow { ... as admin.billing_accounts }
export interface SchoolBilling { ... as admin.billing_school }
export interface BillingApi { post(route: 'link' | 'check' | 'void' | 'refund', body: Record<string, unknown>): Promise<unknown> }
export function billingApiFetch(o: { functionsUrl: string; accessToken: () => Promise<string | null>; fetchImpl?: typeof fetch }): BillingApi;
export interface BillingClient {
  overview(): Promise<BillingOverview>; accounts(): Promise<AccountRow[]>; school(orgId: string): Promise<SchoolBilling>;
  settings(): Promise<BillingSettings>; settingsSet(i: {...; reason: string; env: string}): Promise<void>;
  plans(): Promise<BillingPlan[]>; planSet(i: {...}): Promise<void>;
  accountSet(i: {...}): Promise<void>; graceSet(orgId: string, days: number, reason: string, env: string): Promise<void>;
  subscriptions(orgId?: string): Promise<SubscriptionRow[]>;
  subscriptionCreate(i: { orgId: string; plan: string; seats: number; startsOn: string; dueDays?: number; reason: string; env: string }): Promise<{ subscriptionId: string; invoiceId: string; number: string }>;
  invoiceRaise(i: { orgId: string; description: string; amountPaise: number; dueDays?: number; reason: string; env: string }): Promise<{ invoiceId: string; number: string }>;
  invoices(f?: { orgId?: string; status?: InvoiceStatus }): Promise<InvoiceRow[]>; invoice(id: string): Promise<InvoiceDetail>;
  payments(orgId?: string): Promise<PaymentRow[]>;
  paymentRecord(i: { invoiceId: string; source: 'bank_transfer' | 'cheque'; amountPaise: number; receivedOn: string; reference: string; reason: string; env: string }): Promise<{ paymentId: string; invoiceStatus: InvoiceStatus; licenceSet: boolean }>;
  webhookLog(problemsOnly?: boolean): Promise<WebhookRow[]>;
  sendLink(i: { invoiceId: string; reason: string; env: string }): Promise<{ linkId: string; url: string; existing: boolean }>;
  checkLink(invoiceId: string): Promise<{ checked: number; changed: number }>;
  voidInvoice(i: { invoiceId: string; reason: string; env: string }): Promise<{ voided: true }>;
  refund(i: { paymentId: string; amountPaise: number; reason: string; env: string }): Promise<{ status: string; creditNote: string | null }>;
}
export function createBillingClient(t: AdminTransport, api: BillingApi): BillingClient;
```

Every method goes through the same `guard` as `createAdminClient` (`api.ts:92-98`), so every refusal is an `AdminError`. Optional arguments left `undefined` are omitted (the transport drops them), so `p_org default null` applies. `billingApiFetch`: no token → `AdminError('You do not have access to this.', 'not-allowed')` without a network call; `POST ${functionsUrl}/${route}` with `authorization: Bearer <token>`, `content-type: application/json`; a non-2xx answer throws `new Error(body.error ?? 'billing-api answered <status>')`, which `toAdminError` sorts (`not allowed` → not-allowed, the authenticator message → needs-mfa, `this console is` → wrong-environment).

- [ ] **Step 1: Write the failing tests**

`packages/admin-client/tests/billing.test.ts` (over the real migrations through `pgliteAdminTransport`, and a recording fake `fetch` for the api):
1. `reads come back typed: settings, plans, invoices, one invoice, payments, subscriptions, webhook log, overview, accounts, a school` (numbers are numbers, dates `YYYY-MM-DD`).
2. `subscriptionCreate and invoiceRaise return the invoice number`.
3. `paymentRecord with an old code is needs-mfa; with a fresh one it pays`.
4. `billing-api calls post to <functions>/billing-api/<route> with the session's token`.
5. `billing-api refusals are typed: not-allowed, needs-mfa, wrong-environment and other`.
6. `with no session, a billing-api call is not-allowed and nothing is sent`.
7. `me() types a finance member` (`makeFinance` → `role: 'finance'`).

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run packages/admin-client/tests/billing.test.ts`
Expected: FAIL (`createBillingClient` is not exported).

- [ ] **Step 3: Implement**, add `export * from './billing.ts';` to `index.ts`, and change `Me.role` in `api.ts:6` to `'owner' | 'ops' | 'safety' | 'finance'`.

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run packages/admin-client`
Expected: PASS, 5 files (plan 1's 31 tests plus 7).
Run: `npm run typecheck`
Expected: no errors (the console compiles with the wider role).

- [ ] **Step 5: Commit**

```powershell
git add packages/admin-client
Commit "feat: a typed billing client over the admin functions and billing-api"
```

---

### Task 11: Console helpers: money, roles, blast lines, print model, the write dialog

**Files:**
- Create: `apps/admin/src/features/billing/money.ts`, `model.ts`, `write-dialog.tsx`, `use-load.ts`
- Test: `apps/admin/tests/billing-money.test.ts`, `apps/admin/tests/billing-model.test.ts` (relative imports only: the root vitest `@` alias points at `apps/lms/src`, plan 1's M14)

**Interfaces:**

```ts
// money.ts
export function formatPaise(p: number): string;          // 12345678 → '₹1,23,456.78' (Indian grouping, integer arithmetic)
export function parseRupees(text: string): { ok: true; paise: number } | { ok: false; error: string };

// model.ts
export interface BillingRights { read: boolean; raise: boolean; sendLink: boolean; record: boolean; refund: boolean; void: boolean; settings: boolean; grace: boolean }
export function billingRights(role: 'owner' | 'ops' | 'safety' | 'finance'): BillingRights;
export type Tone = 'ok' | 'warn' | 'bad' | 'grey';
export function invoiceTone(status: InvoiceStatus, dueOn: string, today: string): { tone: Tone; label: string };
export function voidBlast(i: InvoiceRow): string;
export function refundBlast(p: PaymentRow, amountPaise: number): string;
export function paymentBlast(i: InvoiceDetail, amountPaise: number): string;
export function linkBlast(i: InvoiceRow, hasEmail: boolean): string;
export interface PrintLine { label: string; amount: string }
export function printModel(d: InvoiceDetail): { title: string; number: string; seller: string[]; buyer: string[]; lines: PrintLine[]; total: string; sac: string; rate: string; status: string };
export function stateLabel(state: string, graceUntil: string | null): { tone: Tone; text: string };
export function todayIst(now?: Date): string; // YYYY-MM-DD in Asia/Kolkata
```

`write-dialog.tsx`: `WriteDialog({ title, blast, guarded, children, confirmLabel, onConfirm: (v: { env: string; reason: string }) => Promise<void>, onClose })`: the reason box, "Type <env> to confirm", the blast line, "you will be asked for a fresh authenticator code" when `guarded`, `checkWrite` before anything runs, `useGuarded` around `onConfirm`, the error in `role='alert'`, a busy button. Every billing write uses it.

`use-load.ts`: `useLoad<T>(fn: () => Promise<T>)` → `{ data, error, loading, reload }`, where `error` is the `AdminError` message and `refused` is `error.code === 'not-allowed'`.

Rights (ruling R9, spec section 3): owner all; ops `read, raise, sendLink`; finance `read, record`; safety nothing.

Blast lines: void: `Invoice <n> is cancelled for good. Its number stays used. Its payment link is cancelled at Cashfree first. The licence does not change.`; refund: `<₹x> goes back to the payer through Cashfree. A credit note is issued when Cashfree confirms. The licence does not change; change it on the school's page if needed.`; payment: `<₹x> is recorded against <n>.` plus `This pays it in full and sets <school>'s licence to <seats> seats until <date>.` when it completes a subscription invoice, plus `It has an open payment link for <₹y>; if the school pays that too, the extra will need a refund.` when a link is open; link: `Cashfree makes a payment page for <₹x>.` plus ` Cashfree emails it to the billing contact.` when an email is set.

- [ ] **Step 1: Write the failing tests**

`billing-money.test.ts`: (1) `formats paise with Indian grouping and two decimals` (12345678 → `₹1,23,456.78`; 0 → `₹0.00`; 5 → `₹0.05`; 100000000 → `₹10,00,000.00`); (2) `parses typed rupees and refuses the rest` (`"1,23,456.7"` → 12345670; `"50"` → 5000; `" 0.05 "` → 5; refuses `""`, `"-1"`, `"1.234"`, `"abc"`, `"0"` with `Enter an amount above zero, in rupees, with at most two decimals.`).

`billing-model.test.ts`: (1) `rights by role`; (2) `invoice tone: paid ok, void grey, unpaid before its due day grey, 1 to 14 days late warn, later bad`; (3) `blast lines name the amount, the licence effect and an open link`; (4) `print model: CGST and SGST inside one state, IGST across, lines add up to the total, "Not registered under GST" when the seller has no GSTIN, both GSTINs when present, SAC and rate printed`; (5) `state labels: grace says its last day, suspended and ended say the tutor is off`; (6) `todayIst turns at midnight India time` (`2026-03-31T18:29:00Z` → `2026-03-31`, `18:30Z` → `2026-04-01`).

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run apps/admin/tests/billing-money.test.ts apps/admin/tests/billing-model.test.ts`
Expected: FAIL (modules cannot be resolved).

- [ ] **Step 3: Implement** the four files.

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run apps/admin`
Expected: PASS (plan 1's console tests plus 2 + 6).
Run: `npx tsc -p apps/admin/tsconfig.json --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```powershell
git add apps/admin/src/features/billing apps/admin/tests/billing-money.test.ts apps/admin/tests/billing-model.test.ts
Commit "feat: console billing helpers: rupees and paise, rights by role, blast lines, the print model, one write dialog"
```

---

### Task 12: The billing pages

**Files:**
- Create: `apps/admin/src/features/billing/{index,invoices,invoice-detail,subscriptions,payments,webhooks,plans,settings,schools}.tsx`
- Modify: `apps/admin/src/router.tsx`, `apps/admin/src/components/layout/data/sidebar-data.ts`, `apps/admin/src/lib/client.ts`

**Interfaces:**
- Consumes: Tasks 10 and 11.
- Produces: routes `/billing`, `/billing/invoices`, `/billing/invoices/$invoiceId`, `/billing/subscriptions`, `/billing/payments`, `/billing/schools`, `/billing/schools/$orgId` (Task 13 adds its component), `/billing/webhooks`, `/billing/plans`, `/billing/settings`; sidebar group `Billing` (icons `Wallet, FileText, Repeat, IndianRupee, School, Webhook, Tags, Settings` from lucide-react, all present in `node_modules/lucide-react/dist/esm/icons` on 2026-10-07); `billing` in `lib/client.ts`:

```ts
export const billing = createBillingClient(
  supabaseAdminTransport(supabase as unknown as AdminRpcClient),
  billingApiFetch({
    functionsUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/billing-api`,
    accessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
  }),
);
```

Every page is `<AdminPage title=...>`, loads through `useLoad`, and has four states: **loading** (`Skeleton` rows), **refused** (`Alert`: `You do not have access to billing.`), **error** (`Alert variant='destructive'` with the message and a "Try again" button), **empty** (one muted sentence, given below). Amounts with `formatPaise`; dates as `DD Mon YYYY`. Buttons a role may not use are not rendered (`billingRights(me.role)`); the database refuses anyway.

| Page | Shows | Actions (rights) | Empty |
|---|---|---|---|
| Overview `/billing` | tiles: Collected this month, Outstanding, Overdue (count and amount; red when any), Renewals in 30/60/90 days, Schools in grace / suspended (counts), Needs attention (payments not counted, webhook problems in 24 h, signature failures in 24 h), Last webhook and Last reconciliation (grey "never" when null; red when reconciliation is over 2 hours old); "Cost to serve and margin arrive with the money charts (plan 6)." | none | n/a |
| Invoices | table: number, school, issued, due, total, paid, status (tone and label), link | Raise (raise): dialog with school picker (`billing.accounts()` with an account), kind Subscription (plan, seats, start date, due days) or Other (description, amount, due days); Send link (sendLink): `WriteDialog` with `linkBlast`, then shows the URL with a Copy button; Copy link (any reader, when open); Check with Cashfree (sendLink); Void (void): `WriteDialog` guarded, `voidBlast`; status filter | `No invoices yet. Raise one from here or from a school's billing page.` |
| Invoice detail `/billing/invoices/$invoiceId` | the invoice's lines, tax split, links (url, status, paid), payments (counted or why not), credit notes | the same actions as the row, Record a payment (record), Print (opens the print page) | n/a |
| Subscriptions | school, plan, seats, period, price per seat, invoice and its status, licence applied | New subscription (raise) | `No subscriptions yet.` |
| Payments | two sections: **Needs attention** (`counted = false`, with the reason), then all: school, invoice, source, amount, received, reference, recorded by, refunded | Record a payment (record; invoice picker of unpaid/partly paid; source, amount via `parseRupees`, received date, reference; `WriteDialog` guarded with `paymentBlast`); Refund (refund, when `refundable`; amount defaulting to what is left; guarded; `refundBlast`) | `No payments yet.` |
| Schools `/billing/schools` | every school: code, name, account set or not, state (`stateLabel`), licence until, outstanding, days overdue | opens `/billing/schools/$orgId` | `No schools yet.` |
| Webhook log | newest first: time, type, link, order, status, detail; a "Problems only" switch | none | `Cashfree has not called yet.` |
| Plans | code, name, months, price per seat, on sale | New plan / Edit (settings: owner; guarded) | `No plans yet. The owner enters the prices.` |
| Settings | seller name, GSTIN (or "Not registered"), state code, address, SAC, GST rate (as a percentage from basis points), invoice title, ready or not | Edit (settings: owner; guarded; the fields are the CA's decisions, said on the page) | n/a |

- [ ] **Step 1: Add the routes and sidebar group** (each route's component is its page; `$invoiceId` and `$orgId` via `useParams`).

- [ ] **Step 2: Write the pages** as the table says.

- [ ] **Step 3: Typecheck and build**

```powershell
npx tsc -p apps/admin/tsconfig.json --noEmit
$env:VITE_SUPABASE_URL='http://127.0.0.1:54321'; $env:VITE_SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlc2lnbmF0dXJl'; $env:VITE_ADMIN_ENV='TEST'
npm run admin:build
Remove-Item -Recurse -Force apps/admin/dist
```

Expected: no type errors; Vite builds; the scan ends `No secret found in N built files.`

- [ ] **Step 4: Browser check (needs a Supabase project with 0001 to 0060, the `admin` schema exposed, an owner; UNVERIFIED until then)**

With `npm run admin` and a TEST database: sign in as owner; Settings → enter the test seller; Plans → a plan; Schools → a school → set its account (Task 13's page); Invoices → Raise a subscription invoice → it appears as `QRIE/<fy>/0001`; Payments → Record a bank transfer for the whole amount (asks for a fresh code) → the invoice is paid and the school's licence shows the period; Void on another invoice asks for a fresh code; sign in as a finance member → Today shows "You do not have access to this." and Billing works; as safety → Billing shows `You do not have access to billing.` No console errors, no CSP violations.

- [ ] **Step 5: Commit**

```powershell
git add apps/admin/src
Commit "feat: billing pages in the console: overview, invoices, subscriptions, payments, schools, webhook log, plans, settings"
```

---

### Task 13: The printable invoice and each school's Billing tab (S2)

**Files:**
- Create: `apps/admin/src/features/billing/invoice-print.tsx`, `school-billing-tab.tsx`, `school-page.tsx`
- Modify: `apps/admin/src/router.tsx` (route `/billing/invoices/$invoiceId/print` and the component of `/billing/schools/$orgId`)

**Interfaces:**
- Produces: `export function SchoolBillingTab(props: { orgId: string; code: string })` (S2: exactly this name, file and props; plan 2's school page renders it); `SchoolBillingPage` (route `/billing/schools/$orgId`, frames the tab in `AdminPage` with the school's name); `InvoicePrint` (route `/billing/invoices/$invoiceId/print`).

`SchoolBillingTab` loads `billing.school(orgId)` and shows: the state (`stateLabel`) and the payment signal (its level and reason); the licence (plan, seats used of seats, last day); the billing account (legal name, GSTIN, state, address, contact name, email and phone: one record, so the full contact is shown here and nowhere in a list) with Edit (owner, ops) and Grace days (owner, guarded); subscriptions, invoices and payments for this school (the same row components as Task 12) with New subscription, Raise, Send link, Record a payment. States: loading, refused, error, and "No billing account yet. Set one up to raise an invoice." when `account` is null.

`InvoicePrint` renders `printModel(detail)` on a white A4-width sheet: the title from settings ("Tax invoice" by default), number, issue and due dates, seller block (legal name, address, GSTIN or "Not registered under GST", state code), buyer block (legal name, address, GSTIN or "Unregistered", state code, school code), the line (description, SAC, quantity, rate in rupees and paise, taxable value), CGST and SGST at half the rate each or IGST at the rate, total in rupees and paise, the status, and the credit notes against it. A "Print or save as PDF" button calls `window.print()`. A `<style media='print'>` element in the page hides `[data-slot='sidebar']`, `header` and the button (the kit renders `data-slot='sidebar'`, `components/ui/sidebar.tsx:168`; the result in a real print preview is UNVERIFIED). Inline `<style>` is allowed by the CSP (`style-src 'self' 'unsafe-inline'`).

- [ ] **Step 1: Write the three components and the routes**

- [ ] **Step 2: Typecheck and build** (the Task 12 commands)

Expected: no type errors; build passes the scan.

- [ ] **Step 3: Browser check (UNVERIFIED until a project exists)**: open a paid invoice → Print → the browser's preview shows only the sheet, both GSTINs, SAC, the rate and amounts like `₹23,600.00`.

- [ ] **Step 4: Commit**

```powershell
git add apps/admin/src
Commit "feat: a printable invoice and each school's billing tab"
```

---

### Task 14: Runbook, README, and the whole gate

**Files:**
- Modify: `docs/ops/admin-console.md` (new section `## 6. Billing with Cashfree (plan 3)`; plan 2 appends its own section 5 on its branch and merges first, so this branch numbers its section 6 even though section 5 is absent here), `apps/admin/README.md` (one paragraph: the Billing pages, the print page, `SchoolBillingTab`)

- [ ] **Step 1: Write the runbook section** with exactly the steps in "Aarav's steps" below, in that order, each with its command or dashboard path and its UNVERIFIED marks, plus: "Day to day" (overview every morning; Needs attention means a refund or a call; a red reconciliation tile means read `billing-api`'s logs), "If something goes wrong" (a payment stuck unpaid: Check with Cashfree on the invoice; Cashfree's dashboard Batch Resend; a leaked Cashfree secret: rotate in Cashfree, set the new one in Supabase secrets, keep the old one active until in-flight webhooks clear, per Cashfree's note), and "What billing will never do" (store card or bank details; delete an invoice; change a licence on a refund; charge a mandate before plan 7).

- [ ] **Step 2: The whole gate**

```powershell
npm run typecheck
$env:VITE_SUPABASE_URL='http://127.0.0.1:54321'; $env:VITE_SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlc2lnbmF0dXJl'; $env:VITE_ADMIN_ENV='TEST'
npm run admin:build
Remove-Item -Recurse -Force apps/admin/dist
$env:VITE_SUPABASE_ANON_KEY='test-anon'
npx vitest run --exclude "tools/measure/**" --exclude "**/node_modules/**" *> "$env:TEMP\qrie-billing-suite.txt"
Get-Content "$env:TEMP\qrie-billing-suite.txt" -Tail 40
```

Expected: typecheck clean; the build passes the secret scan; the suite (7 to 15 minutes) ends with every file passing except any that also fail on `admin@eb17436` for reasons outside this plan (name them in the report). `Select-String -Path "$env:TEMP\qrie-billing-suite.txt" -Pattern 'billing|finance'` shows only passes.

- [ ] **Step 3: Scan for secrets and stray claims**

Run: `git grep -n -I -E "x-client-secret|CASHFREE_CLIENT_SECRET|BILLING_RECONCILE_TOKEN" -- apps packages`
Expected: no match (the names appear only in `tools/billing`, `supabase/functions`, `tools/admin-alert`, the workflow and the docs).

- [ ] **Step 4: Commit, then finish the branch**

```powershell
git add docs/ops/admin-console.md apps/admin/README.md
Commit "ops: billing runbook: Cashfree KYC, policy pages, webhook URLs, secrets, sandbox first, reconciliation token"
```

Then use superpowers:finishing-a-development-branch. Pushing, `supabase db push`, deploying the two functions and everything at Cashfree are Aarav's steps.

---

## Merge notes (plan 2 merges first, then this branch)

1. **Migrations:** plan 2's 0052 to 0055 run before 0056 to 0060. 0058 replaces plan 2's `admin.school_payment_signal` stub (S1, same signature and grants), so plan 2's `school_health` reads the real signal.
2. **0056 and plan 2's `staff_set`.** Plan 2's 0054 drops the 5-argument `staff_set` and adds a 6-argument one (with `p_env`) that takes its roles from `platform_staff`'s check constraint and names no role list. 0056's DO block widens only a body that has the literal `('owner', 'ops', 'safety')` and leaves plan 2's body alone, so after the merge `finance` is accepted through the widened constraint with no hand edit, and no 5-argument `staff_set` comes back (S6). `admin-finance-role.test.ts` tests 4 and 5 call `staff_set` through a helper that adds `p_env => 'TEST'` when the function has six arguments, and accept either refusal sentence.
3. **0056 replaces `admin.me()`** to admit finance. Plan 2 does not change `me()` (checked in its document), so nothing to reconcile.
4. **`admin-invariants.test.ts`:** take the union of both lists, in C collation order (`_` sorts before letters: `admin.school_note_add` before `admin.school_notes`, `admin.billing_account_set` before `admin.billing_accounts`), and keep plan 2's last test, which pins three public functions (`alert_snapshot`, `app_config`, `audit_head`).
5. **`router.tsx`, `sidebar-data.ts`, `admin-client/src/index.ts`, `lib/client.ts`, `admin-client/src/api.ts`, `apps/admin/README.md`:** keep both sides' added lines. In `sidebar-data.ts` both sides add `School` to the one `lucide-react` import: keep it once (a duplicate identifier does not compile). Put the Billing group after plan 2's "Schools and people" group (spec section 12's order: Today, Switches, Schools, Users, System, Staff and audit, Billing). In `api.ts` plan 2 changes `StaffSetInput` (M2) and this branch changes `Me.role`: keep both. `export *` from `billing.ts` and from plan 2's five modules must not export the same name (TypeScript refuses an ambiguous re-export); none of the names listed in either document collide, and `npm run typecheck` on the merged branch proves it.
6. **`school-billing-tab.tsx`:** take this branch's file (S2; git reports an add/add conflict). Plan 2's Billing tab passes `orgId` and `code`.
7. **Finance in plan 2's console (S6):** add `'finance'` to `STAFF_ROLES` in `apps/admin/src/features/staff/roles.ts` (plan 2's one role constant), so the Staff page can invite and set a finance member; plan 2's `staff.ts` types roster roles as plain strings, so the client needs no change. A finance member opening plan 2's pages (Schools, Users, System, Staff) is refused by the database and sees the refused state; they reach Billing.
8. **The System page's Cashfree card** (plan 2's `admin.system_health().cashfree`) reads `billing.webhook_event`'s `received_at`, `signature_ok` and `status` (`'stored'` = not yet processed) and `admin.setting` `billing_reconciled_at`, with `to_regclass` so it says "not captured" before 0057 exists. Keep those three column names, that status value and that setting key in 0057 and 0059. After the merge, check once in a test or the PGlite REPL that `admin.system_health() -> 'cashfree' ->> 'captured'` is `true`.
9. **Two write dialogs and two load hooks:** plan 2 has `components/write-dialog.tsx` and `lib/use-load.ts`; this branch has `features/billing/write-dialog.tsx` and `features/billing/use-load.ts`, because neither branch can import the other's. They do not collide. Folding billing's onto plan 2's is a follow-up, not part of the merge.
10. **A suspended school takes no new imports (spec section 10).** Neither branch enforces it: plan 2's `admin.api_gate('people-import', ...)` refuses only an offboarded school, and the school admin's import is the LMS lane's. Plan 4 (app wiring) owns it, in its own migration: `api_gate` refuses `people-import` when `billing.state_for(org, lms.india_today())` is `suspended` or `ended`, and `lms-admin` does the same for the school admin.
11. After merging, run the whole gate (Task 14 Step 2) on the merged branch.

## Aarav's steps (only he can do these)

1. **Cashfree account:** sign up, complete business KYC (PAN, business proof, the director's KYC; exact list UNVERIFIED), add and verify the settlement bank account, and get Payment Gateway with Payment Links enabled.
2. **Policy pages on the website** (landing): terms, refund and cancellation, privacy (listing Cashfree as a sub-processor, spec section 6), contact, and pricing. Payment gateways ask for them during activation; which ones Cashfree requires is UNVERIFIED.
3. **The CA's decisions**, entered by you in Billing → Settings: whether Qrie is GST-registered (GSTIN or none), the SAC code, the GST rate, the invoice title ("Tax invoice" or what the CA says), and that the numbering `QRIE/26-27/0001` and credit notes `QRCN/26-27/0001` suit them; also the CGST plus SGST versus IGST rule and the rounding (Ruling R14).
4. **Prices**, entered by you in Billing → Plans: each plan's code, months and price per seat.
5. **Apply the migrations** (after plan 2's): `npx supabase db push` applies 0056 to 0060 with the rest. No new schema needs exposing: billing's browser functions are in `admin`, already exposed in plan 1's step 2.
6. **Sandbox keys into Supabase secrets** (never on a command line):
   ```bash
   # a file outside the repo, deleted after
   printf 'CASHFREE_CLIENT_ID=%s\nCASHFREE_CLIENT_SECRET=%s\nCASHFREE_ENV=sandbox\nCASHFREE_API_VERSION=2026-01-01\nBILLING_RECONCILE_TOKEN=%s\n' "<id>" "<secret>" "$(openssl rand -hex 24)" > /tmp/cf.env
   npx supabase secrets set --env-file /tmp/cf.env && rm /tmp/cf.env
   ```
   Keep the same reconciliation token for step 9. `billing-api` also reads `ADMIN_ORIGIN`, the console's address, which plan 2's runbook step already sets for `admin-api` (one secret serves both functions); if it is not set yet: `npx supabase secrets set ADMIN_ORIGIN=https://<the console's address>`. The functions refuse sandbox keys against a database whose environment is `HOSTED`, so the sandbox run happens on a TEST or STAGING project, or the keys are production ones on HOSTED.
7. **Deploy the two functions:** `npx supabase functions deploy billing-api --no-verify-jwt` and `npx supabase functions deploy cashfree-webhook --no-verify-jwt`.
8. **The two webhook URLs**, in Cashfree's sandbox dashboard: Payment Gateway → Developers → Webhooks: add `https://<project>.supabase.co/functions/v1/cashfree-webhook`, version `2025-01-01` or later (so Cashfree sends `x-idempotency-key`), events: payment links and refunds; and the **Subscriptions** webhook tab: the same URL (plan 7 uses it; until then its events are stored and ignored). Tab and event names in the dashboard are UNVERIFIED.
9. **The reconciliation token in GitHub:** Settings → Secrets → Actions → `BILLING_RECONCILE_TOKEN` = the token from step 6.
10. **Try everything in the sandbox:** raise an invoice for a demo school, Send link, pay it with Cashfree's sandbox test method, see the webhook log show `processed`, the invoice `paid` and the licence moved; raise another and let it be checked by "Check with Cashfree"; refund part of a payment with the refund note `SUCCESS` (Cashfree's sandbox simulation) and see the credit note; void an unpaid invoice with a link and see the link cancelled; wait an hour and see "Last reconciliation" update.
11. **Go live:** production keys, `CASHFREE_ENV=production`, on the HOSTED project only; the production webhook URL in the production dashboard; one real Re 1 invoice to yourself, then refund it.
12. **Decide later (no build needed now):** whether a finance member may stop the tutor (Ruling R11: now they may not, reading spec section 3's "nothing about switches" over its "a stop is open to every active staff member"; allowing it means widening `admin.set_halt`'s stop branch, a plan-1 function); whether `app_config` should tell the apps more than ok, grace and suspended (Ruling R5); whether a refund should also shorten a licence (now: never automatically); whether proof scans of offline payments are needed (deferred, Ruling R10); counsel on what "ended" means for a school's data (spec section 10).

## UNVERIFIED

- Everything at Cashfree: no sandbox call has been made. In particular: whether the payment-link webhook body is JSON (the page shows JSON but says "form data format"; this plan stores a signed non-JSON body as `unparsed` and lets reconciliation settle it); whether `PAYMENT_LINK_EVENT` deliveries carry `x-idempotency-key`; the format of `x-webhook-timestamp` and whether a retry re-signs with a new timestamp; whether amounts arrive as strings or numbers on the 2026-01-01 version; the full list of `link_status` values returned by `GET /links/{id}`; the HTTP status for a repeated `link_id`; the cancel-link path `POST /links/{link_id}/cancel`; whether Cashfree's idempotency key replays the first answer for `POST /links`; the sandbox payment and refund simulations; the dashboard's tab and event names; KYC and policy-page requirements.
- The Supabase functions gateway with `--no-verify-jwt`: that a request carrying a non-Supabase bearer token (the reconciliation token) and an `apikey` reaches the function; that `../../../tools/billing` imports bundle on deploy (the deployed relay imports `packages/relay` the same way); the function wall-clock limit for 50 Cashfree calls.
- That PostgREST, called by `billing-api` with the staff member's own token, gives the same `aal` and `amr` claims the console's direct calls do (plan 1's own `amr` check is still UNVERIFIED in a browser).
- Gapless numbering under truly concurrent connections on hosted Postgres (argued from the counter's row lock; PGlite runs one transaction at a time).
- The tax details: the CGST/SGST/IGST split by state code, half-up rounding per component, the credit note's tax share, the 16-character rule applied to credit notes (Rule 53 is assumed to follow Rule 46's shape).
- The print stylesheet in a real browser's print preview.
- `pg_cron` on the hosted project running `billing-states` at 18:40 UTC (the harness records the schedule only).
- GitHub's scheduler and the private-repository cost note in plan 1 (unchanged: this adds one request to each existing run).

## Rulings (decisions the spec did not settle, each with its cost if wrong)

- **R1** Invoice numbers `QRIE/26-27/0001`, credit notes `QRCN/26-27/0001` (CGST Rule 46(b): 16 characters; the spec's `QRIE/2026-27/0001` is 17). Cost: if the CA wants another shape, change `billing.format_number` before the first real invoice; after that, numbers are permanent.
- **R2** Link id = the invoice number with `/` → `-`, `-2`, `-3` for later attempts. Cost: none known; Cashfree's documented charset allows it.
- **R3** Browser functions live in the exposed `admin` schema; `billing` holds tables and helpers and is exposed to nothing. Cost: none for Aarav (no schema to expose); the `admin` namespace grows by 30 functions (20 for staff, 9 for the service role, 1 internal).
- **R4** `billing-api` forwards the staff member's own JWT so the database makes every permission decision, and uses the service role only through service-role-only functions to record Cashfree's answers. Cost: two database round trips per action.
- **R5** `app_config` is coarse: `billing.state` is `ok | grace | suspended` (trial, active and none read `ok`; ended reads `suspended`), plus `billing.grace_until` (S5's example listed six values; plan 1's note asked for coarse because anyone who guesses a school code can read it). Cost: plan 4 cannot show "trial" or "ended" from `app_config` (the teacher app already reads its own licence through `lms.school_licence`).
- **R6** `ended` begins 60 days after grace ends and acts like `suspended`. Cost: only a label until counsel decides what ending means for data.
- **R7** One line per invoice; instalments are separate invoices; links never allow partial payments. Cost: a school paying in parts needs one invoice per part.
- **R8** Recording an offline payment needs a fresh code (owner or finance), because it can set a licence. Cost: one more code prompt.
- **R9** Ops may read billing, raise invoices, set a school's billing account and send links; finance reads billing, records offline payments and prints invoices, and nothing else (spec section 3's "may" list for finance); refunds, voids, plans, settings and grace days are the owner's with a fresh code; safety sees no billing. Cost: if ops should record payments, or Aarav wants his accountant to raise invoices and send links too, one role array changes per function (a departure from spec section 3 he would decide).
- **R10** Scans of offline payment proof are deferred (no Storage bucket in this plan). Cost: the proof stays in email or the bank statement; the reference number is recorded.
- **R11** Finance cannot stop the tutor or see Today (spec section 3: nothing about switches or children), although section 3 also says a stop is open to every active staff member. Cost: one fewer person who can stop the tutor.
- **R12** The webhook does not reject old timestamps (Cashfree recommends five minutes); replays are harmless because events are stored once and only move forward. Cost: a captured, validly signed event can be resent, and changes nothing.
- **R13** A link payment counts only when its amount equals the link's amount, its currency is INR and its notes name the same invoice; anything else is stored uncounted and listed for a refund. Cost: a genuine but odd payment needs a person.
- **R14** GST: CGST plus SGST at half the rate each inside one state, IGST across states (state codes from GSTIN prefixes or entered), half-up per component. Cost: if the CA wants a different rule or rounding, change `billing.gst_split` before the first real invoice.
- **R15** Reconciliation is paced by the database (55 minutes), and the checker asks every run. Cost: one cheap read every five minutes.
- **R16** `billing-api` refuses production keys on a non-HOSTED database and sandbox keys on HOSTED. Cost: sandbox testing needs a TEST or STAGING project.
- **R17** Void only when nothing is paid, cancelling any open link at Cashfree first; a void never frees its number. Cost: a part-paid invoice must be refunded before it can be voided.
- **R18** A refund never changes paid amounts or the licence; a credit note is issued when Cashfree reports SUCCESS. Cost: the owner changes the licence by hand after a refund when needed.
- **R19** Cashfree emails the link when the account has an email; SMS and WhatsApp from Cashfree are off; staff copy the link for WhatsApp. Cost: a school without an email gets the link only from staff.
- **R20** The webhook log keeps a whitelisted extract; signature failures keep a hash and length; failures older than 90 days are deleted by the daily job. Cost: no raw body to inspect after the fact (Cashfree's dashboard log has it).
- **R21** Billing tables are revoked from `service_role` too; only definer functions touch them. Cost: no direct REST access to billing for scripts.
- **R22** Edge logic lives in `tools/billing` (no new npm workspace, so no lockfile change). Cost: none.
- **R23** Grace is 14 days by default, 14 to 30 per school, owner-only with a fresh code. Cost: none known.
- **R24** Due date defaults to 15 days after issue (0 to 90 allowed). Cost: a default the owner changes per invoice.
- **R25** A paid plan cannot be called `pilot`; a price of 0 cannot be invoiced (a trial is a `pilot` licence set from the school page, plan 2). Cost: none known.

Added by the fix pass after review (2026-10-08):

- **R26** Money Cashfree reports that no stored payment accounts for is never dropped. A link becomes `paid` or `partly_paid` only when the payments stored for it (counted or not) add up to what Cashfree says was paid; otherwise it keeps its status, so Check with Cashfree and the hourly reconciliation keep reading it, a closed link too (the hourly one reads links made in the last 180 days), the webhook event is marked `mismatch`, the invoice and its link show the amount (`unrecordedPaise`), the overview counts it (`attention.linksUnrecorded`), and the invoice takes no new link, no payment by hand and no void until the payment is found. Cost: if Cashfree's answer is read wrongly (its formats are UNVERIFIED), that invoice stays blocked until the code is fixed; nothing is lost and nothing is charged twice.
- **R27** A payment by hand is never recorded while the invoice has an open payment link. `admin.billing_payment_record` gains `p_commit` (default true): with false it makes every check and answers the open links; with true it refuses while one is open. `billing-api`'s `/record` (finance or the owner, fresh code) asks with false, cancels the links at Cashfree (re-reading a link whose cancel is refused, in case it was just paid), then asks with true; if Cashfree says a link was paid, it records that payment and nothing by hand (409). The console sends a payment to `/record` when the invoice has an open link and straight to the database otherwise, so recording by hand never depends on Cashfree being set up. Money paid later on an old, cancelled link is stored uncounted ("more than is still due"), refundable and counted under Needs attention (R13). Cost: finance's recording calls Cashfree when a link is open, and fails (nothing recorded) if Cashfree does not answer.

## Self-review

**Spec coverage.** Section 3 (finance role, who may refund and void): Tasks 1, 2 to 5, R9, R11. Section 6 (forged notifications, Cashfree keys, money by mistake, never-shown list): Tasks 4, 6 to 8, 11, 12, Review Focus 1, 2, 5. Section 7 (`billing.account, plan, subscription, invoice, payment, webhook_event, invoice_counter`): Task 2 (`number_counter` is the counter, with a series column for credit notes). Section 8 Billing row (plans, subscriptions, invoices, payment links, offline payments, refunds, the licence follows payment; `billing.*` states for the apps): Tasks 2 to 5, 12. Section 9 payment signal: Task 3 (S1); section 9's System page row for Cashfree is read by plan 2's `admin.system_health` from `billing.webhook_event` and `billing_reconciled_at` (merge note 8). Section 10 in full: links (Task 4, 8), offline (Task 3), mandates (designed for, not built: `subscription.collection`, R7; plan 7), the licence follows the money (Task 3), grace, suspension, ended (Task 5), the webhook (Tasks 4, 7), invoices and tax (Tasks 2, 13), refunds and credit notes (Tasks 4, 8), billing pages (Tasks 12, 13; cost to serve and margin are plan 6, said on the Overview), Aarav's steps (Task 14). Section 14 roadmap row 3: all of it; plan 4 consumes `billing.state` and `billing.grace_until`; "new imports stop" when suspended is plan 4's, for both the school admin's import and the console's (`admin.api_gate`; merge note 10).

**Seams.** S1 to S9 each map to a task (table above); the three plan-1 files changed beyond S9 are named with their reason.

**Placeholders.** Function bodies that are plain checks are given as ordered rules with their exact messages rather than SQL; the non-obvious ones (counter, GST split, guard trigger, settle, signature, app_config) are given as code. Test names and their assertions are given for every test file; the counts in Expected lines are the numbered tests in this document.

**Type consistency.** The jsonb shapes returned by the SQL (camelCase keys) are the TypeScript interfaces of Task 10; the extract's shape is shared by Task 4's tests and Task 6's `extractEvent`; `link_id` and `refund_id` rules are the same in SQL checks and Cashfree's documented limits; the `authenticated` list in Task 5 is the union of Tasks 2 to 5.

**Not verified:** the list under UNVERIFIED.
