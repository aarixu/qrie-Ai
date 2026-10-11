# Qrie control: the super admin panel, designed

**Date:** 2026-10-06 (revised the same day: school tracking and health, payments
through Cashfree, the teacher app's UI kit, the whole roadmap). **Status:** for
Aarav's review; nothing is built in the product repo. **Decisions and status live
in** `docs/handoff/2026-09-26-state-of-play.md` (the section "the super admin
panel"); this file is its architecture. The first slice's code was written and run
in a scratch checkout of branch `lms` and is stored beside its plan:
`docs/superpowers/plans/2026-10-06-super-admin-foundation/`.

Every claim below is **MEASURED** (read or run on 2026-10-06, with the file or
command), or marked **UNVERIFIED**. Facts about Cashfree come from its public
documentation, read on 2026-10-06; anything not yet tried in its sandbox is
UNVERIFIED.

---

## 1. What it is, in one paragraph

One web app, `apps/admin`, on its own address, that only named Qrie staff can open.
From it the owner sees the whole platform (is the tutor running, what is today's
spend, is a child waiting for a reply, which school is healthy, which has not paid)
and controls it: stop the tutor, move the ceiling, publish or pull a class, find a
school or a child, reset a PIN, raise an invoice and send a payment link, answer an
erasure request, flip a switch every app reads. Every control is a **named action**
that checks who you are, asks for a reason when it matters, and writes a line nobody
can edit. There is no SQL box and no "sign in as this child": the panel is powerful
because each action is safe, not because it can do anything.

It is **not** the school principal's panel (`apps/lms`, role `lms.require_admin`).
The two meet in four places (section 13).

## 2. Decisions

| Decision | By | Why |
|---|---|---|
| A real web app on its own origin, not a route in `apps/lms` and not scripts only | Aarav | It must survive a relay halt and must not share an origin with children's sessions (`qrie-ai.vercel.app`) |
| Control is named, audited actions; no SQL box, no table editor, no impersonation | design | Children's data; one stolen login must not be able to move the platform. Supabase's dashboard stays the emergency tool |
| Two doors to a user: a school, and "direct" users who came on their own | Aarav | Direct users are the only real population today (204 anonymous, 0 schools on 2026-09-24, STALE) |
| Owner (Aarav) plus one backup safety reviewer; three roles: owner, ops, safety (a `finance` role arrives with payments) | Aarav, design | A single reachable person is a single point of failure for a child's report |
| **The look and the UI kit are the teacher app's** (`apps/lms`, itself started from `satnaing/shadcn-admin`, MIT) | Aarav | One look across Qrie's tools; an admin-dashboard template is what that kit already is |
| **Payments through Cashfree, one merchant account, APIs and webhooks only** | Aarav | No payment code exists anywhere today |
| **Each school gets a health card: named signals, each green, amber, red or grey, with its reason; never a blended score** | design | A number hides why; a reason says what to do |
| Staff share the children's Supabase project; the check is inside every function | design | Joins to cost, school and billing tables need one database |
| Second factor is an authenticator app (TOTP), never SMS | design | Supabase offers TOTP and SMS; a phone number can be taken over |
| Hosted JWT lifetime is **not** shortened for staff | design | It is a project-wide setting. The staff row is read on every call, guarded actions want a code from the last 10 minutes, and the panel signs out after 15 idle minutes |
| Admin and billing tables live in the LMS lane: schemas `admin` and `billing`, migrations 0047 onward (0043 to 0046 are the LMS lane's own: AI drafts, hand-in once, parents, the lms-admin service), on a branch `admin` cut from `lms`; a later plan takes the next free numbers when it starts | design | LMS decision 10 (the LMS lane owns the database) |
| Alarm: a checker **outside** Supabase, two private Telegram chats, messages with counts only | design | An alarm inside the project it watches is silent exactly when the project is down |
| Licence ends: 14 to 30 days' grace, then the tutor goes off; homework, marks and exports stay | design ("use your common sense") | Never stop a child's homework over an invoice |
| Pilot is homework-only; a per-school AI budget comes later | assumed (memory, 2026-09-24) | Homework uses no model |
| Who is the data fiduciary for a school child, and who receives a distress disclosure | counsel | Not a build question; the panel holds a per-school row that blocks that school's import while "undecided" |
| GST rate, SAC code and invoice format | Aarav's CA | Tax, not code; the panel numbers invoices and prints what the CA decides |

## 3. People and roles

| Role | Who today | May | May not |
|---|---|---|---|
| `owner` | Aarav | everything below, plus add or remove staff, resume the tutor, move the ceiling, publish, erase, change a licence, void an invoice, refund | demote or deactivate themselves |
| `ops` | none yet | stop the tutor, flip ordinary switches, retract a class, work with schools and users, raise an invoice and send its link | see a child's words, resume, move the ceiling, erase, refund |
| `safety` | the backup reviewer | read the report list, open one report at a time with a case and a reason | change switches, schools, classes, billing |
| `finance` (plan 3) | an accountant, if ever | read billing, record an offline payment, download invoices | anything about children, switches or classes |

A stop is open to every active staff member on purpose: stopping money or harm must
never wait for a second person. Everything that makes money flow again, moves money
out, or cannot be undone needs the owner and a code verified in the last 10 minutes.

## 4. Architecture

```
  Staff browser (apps/admin, own origin, strict headers, the teacher app's UI kit)
        │  supabase-js, the person's OWN session (aal2)
        ▼
  Supabase project (one)
   ├─ Auth ............ email + password + TOTP; staff marked app_metadata.provisioned_by = 'staff'
   ├─ schema admin .... SECURITY DEFINER functions only; no table readable from a browser
   ├─ schema billing .. accounts, plans, subscriptions, invoices, payments, webhook events (plan 3)
   ├─ public.app_config(school)    ← read by the four apps (anon-callable, no secret in it)
   ├─ public.alert_snapshot(token) ← read by the outside checker
   ├─ Edge Function admin-api ...... Auth admin operations: PIN reset, disable, staff invite (plan 2)
   ├─ Edge Function billing-api .... the only caller of Cashfree's API; holds its keys (plan 3)
   ├─ Edge Function cashfree-webhook  Cashfree → us; verifies the signature (plan 3)
   └─ pg_cron: revert raised ceilings · nightly rollups (plan 6)

  Cashfree (one merchant account) ⇄ billing-api (calls out) / cashfree-webhook (calls in)
  Outside checker (GitHub Actions, every 5 min) ──► Telegram (ops chat, safety chat)
        also asks billing-api to reconcile open links and mandates once an hour (plan 3)
  Apps that obey it: classroom (tutor) · student · lms (teachers) · landing (contest)
        each reads public.app_config; a failed read means the app's built-in SAFE DEFAULT.
```

Boundaries, and why they are where they are:

- **`admin` and `billing` functions are the only door.** The browser never touches
  a table. Each function begins with `admin.require_staff`, so "who may do this" is
  one definition, tested against real Postgres.
- **Secrets live in Edge Functions only.** The service-role key (for the Auth admin
  API) is in `admin-api`; Cashfree's client id and secret are in `billing-api` and
  `cashfree-webhook`. Each verifies the caller first. The browser bundle is scanned
  for a service-role key (section 6).
- **The panel's data path avoids the relay**, which fails closed when halted.
- **The apps depend on the panel only through `public.app_config`**, with a built-in
  default if it cannot be read. The panel being down never turns a feature on.

## 5. Login and sessions

1. **The first owner** is made once from a laptop with the service role
   (`tools/admin-bootstrap`): a permanent account marked `provisioned_by = 'staff'`
   (so the sign-up trigger gives it no solo organisation, which it otherwise does,
   `0021:123-128`), the environment is set, the account becomes owner. The owner
   enrols an authenticator **immediately**.
2. **Signing in** is email and password, then a 6-digit code. There is no sign-up
   page. One message for every failure ("Those details did not work").
3. **The gate** is one tested decision (`decideGate`): signed out; enrol an
   authenticator; enter a code; checking; not staff; ready. A stranger is walked
   through the authenticator first and only then told "no access".
4. **Every function** checks, on every call: an active row in `platform_staff`, the
   token is not anonymous (`is_anonymous`), and the token is aal2. Removing a person
   takes effect on their next click.
5. **A guarded action** also wants the code verified in the last 10 minutes (the
   token's `amr` timestamps; UNVERIFIED on hosted Supabase until plan 1's browser
   check). The panel asks for a fresh code and retries once.
6. **Idle sign-out** after 15 minutes.
7. **Adding staff** (plan 2): invited inactive; the person enrols an authenticator;
   the owner confirms by phone and only then activates.
8. **Lost authenticator:** another owner removes the factor; a lone owner uses the
   service role (`docs/ops/admin-console.md`).

From Supabase's documentation (2026-10-06): MFA with TOTP and phone messaging (not
passkeys); the assurance level is the `aal` claim, readable as `auth.jwt()->>'aal'`;
anonymous users carry `is_anonymous` and share the `authenticated` role.

## 6. Security model

| Threat | Control | Where |
|---|---|---|
| A stolen password | the second factor; idle sign-out; no sign-up page | plan 1 |
| A stolen session token | guarded actions need a code from the last 10 minutes; the staff row is re-read per call; own origin with a Content-Security-Policy (scripts only from itself), no framing, no referrer, no third-party scripts | plan 1 |
| A child's anonymous session used against the panel | `is_anonymous` and aal2 checked inside every function; tested | plan 1 |
| A staff member misusing power | every action in an insert-only log with who and why; hand-written SQL on control tables leaves an "unmanaged change" row | plan 1 |
| The service-role key in a browser | not used by the panel; the bundle scan refuses any JWT whose payload says `role: service_role`, in every build | plan 1 |
| A forged payment notification | the webhook verifies Cashfree's signature (HMAC-SHA256 of timestamp plus the **raw** body, base64) before reading it; stored once by an idempotency key; a payment only counts when its amount and its invoice match | plan 3 |
| Cashfree's keys leaking | only in Edge Function secrets; never in the database, a log or the browser | plan 3 |
| Money moving by mistake | refunds and voids are owner-only with a fresh code; amounts are integers in paise; every money change is in the audit log | plan 3 |
| A forged alarm token | stored only as its SHA-256; wrong tokens counted and a burst refused; the snapshot holds counts only | plan 1 |
| A new admin function callable by everybody | explicit grants everywhere; a test pins the exact list a browser may call | plan 1 |
| Opening a child's words, address or photo without a reason | refused without a case and a typed reason; one record at a time; masked lists; quotas | plan 5 |
| A compromised founder phone | a second person who can stop the tutor; a second alarm phone on another device and carrier | Step 0 |

**Never shown, never exported, in any screen:** raw PINs or hashes; any secret value;
a child's transcript or answers outside one case-bound read; a report's note in a
list, alert or notification; full phone numbers and parent names in lists; home
addresses (one purpose-bound reveal for a prize post); photos in lookups; a ranked or
"at risk" list of children; a per-child behavioural trail; card or bank details (the
panel never receives them: Cashfree's pages collect them). Counsel to confirm the
safety review's reading of DPDP s.9(3) (no tracking or behavioural monitoring of
children); until then the panel never builds such a view.

**Residual risks, stated:** staff and children share one auth pool and JWT secret;
a database superuser can still disable the audit trigger (the log is copied off the
platform in plan 2); the alarm depends on GitHub's scheduler and Telegram, and
payments on Cashfree (all three are sub-processors to list on the privacy page);
Cashfree does not replay subscription webhooks (its documentation), so a missed one
is caught only by the hourly reconciliation.

## 7. Database

Schema `admin` (plan 1 verified; later plans add to it) and schema `billing` (plan 3).

| Object | Purpose | Plan |
|---|---|---|
| `admin.setting` | key/value; the environment name (`HOSTED`, `STAGING`, `DEMO`, `TEST`), the alarm's last check | 1 |
| `admin.platform_staff` | the allowlist: user, role, name, active; never cascades from `auth.users` | 1 |
| `admin.audit_event` | insert-only for every role; ids, reasons and hashes only | 1 |
| `admin.require_staff`, `require_fresh_mfa`, `check_environment` | the three checks every function composes | 1 |
| `admin.me`, `staff_list`, `staff_set`, `bootstrap_owner`, `set_environment` | identity and staff | 1 |
| `admin.relay_status`, `set_halt`, `set_caps`, `revert_caps`, `cap_override` | the stop switch and the ceiling (bounded 1000 to 1000000) | 1 |
| `admin.today()` | the home page | 1 |
| `admin.flag_def`, `app_flag`, `flag_list`, `flag_set`, `public.app_config` | remote switches | 1 |
| `admin.alert_token`, `alert_miss`, `public.alert_snapshot` | the outside checker's question | 1 |
| `admin.school_list()`, `admin.school_detail(code)`, `admin.school_health(code)`, `admin.school_note` (contacts, notes, "quiet until" for holidays), `admin.system_health()` | schools, their health, the platform's health | 2 |
| `billing.account`, `plan`, `subscription`, `invoice`, `payment`, `webhook_event`, `invoice_counter` | payments | 3 |
| `admin.safety_event`, `case`, `read_log`, `erasure_request`, `school_privacy` | safety capture, cases, purpose-bound reads, privacy | 5 |
| `admin.metric_daily` | nightly rollups for the charts | 6 |

Conventions: every function is `SECURITY DEFINER` with a fixed `search_path`; writes
set `admin.session` so the tripwire knows the change came through a function; the
staff-check error is always exactly `not allowed`; the environment is typed into
every write; money is `bigint` paise.

## 8. Control over every app

| Area | See | Change | Plan |
|---|---|---|---|
| **Tutor** (`apps/classroom`) | students now, spend, failures | stop and resume; the ceiling; banner and pause notice; `tutor.only_prepared` (replaces the compile-time `PROTOTYPE_ONLY_PREPARED`, `apps/classroom/src/lib/prototype.ts:29`); `tutor.compose_live_classes`; minimum build | 1, 4 |
| **Schools and the LMS** (`apps/lms`) | every school, its health, people, licence, activity | create a school, import people, set a licence, per-school switches, pause, export, offboard (never a delete button) | 2 |
| **Users** | the two doors, a person's card | PIN reset (the school admin first), disable with `mark_left` | 2 |
| **Billing** | revenue, outstanding, overdue, renewals, cost to serve | plans, subscriptions, invoices, payment links, offline payments, refunds; the licence follows payment | 3 |
| **Student app** (`apps/student`) | sign-ins per school | banner; minimum build; a school's suspension notice; a report button and helpline | 4, 5 |
| **Landing and contest** | entries today and the daily limit | open or close entries; the limit as a row; purge date | 4, 5 |
| **Classes** | pending list, reports by class, cost per class | publish (who and why), retract (files really removed), reject | 5 |
| **Safety and privacy** | reports by age; requests; retention truth | triage, evidence with a reason, per-school recipient; erase a child; fiduciary decision per school | 5 |
| **Relay and AI cost** | meter units, Rs per student-hour with its unpriced share | stop, ceiling; later a per-school budget | 1, 6, 7 |
| **Staff** | who, when, what they did | add or remove staff, roles | 2 |

**The switches (migration 0050):** `banner.message`, `banner.tone`, `tutor.enabled`
(per school too, guarded), `tutor.only_prepared` (guarded), `tutor.compose_live_classes`
(guarded), `contest.entries_open` (guarded), `app.min_version.classroom|student|lms`.
Plan 3 adds `billing.*` read-only states the apps can show (a school in grace, a school
suspended).

**Not a button, and why:** `RELAY_DISABLED` (the independent second stop, a secret set
from a laptop); distress rules, helplines, model allow-lists and retention windows
(they change in code with a review); deploys and migrations; raw SQL; "sign in as this
child". Each stays reachable to the owner through the cloud dashboards, behind a
hardware key.

## 9. Schools: tracking and health (plan 2)

**The schools list** (one table, the teacher app's data table): school, code, plan,
seats used of seats bought, licence end, payment state, **health** (its worst signal
and the reason), last active, students, teachers. Sort and filter by any of them; Ctrl+K
jumps to a school by name or code.

**One school's page**, in tabs:

- **Overview:** the health card (below), the licence and subscription, contacts.
- **People:** counts of students, teachers and admins; how many ever used it; search
  inside the school by name or login ID (door 1 of the users directory); a person's
  card; PIN reset (the school admin first), disable with `mark_left`.
- **Activity:** a timeline from the school's own activity log (`lms.audit_event`) and
  the platform's (`admin.audit_event`), plus homework published, work handed in,
  attendance marked, per week.
- **Billing:** subscription, invoices, payments; raise an invoice, send its payment
  link, record a bank transfer or cheque (section 10).
- **Switches:** this school's own values (for example `tutor.enabled`).
- **Notes:** contacts, call notes, and "on holiday until", which quiets the teaching
  and learning signals during a vacation (there is no school calendar in the schema).

**The health card.** Each signal is green, amber, red, or grey ("cannot tell yet"),
with its reason. The school's label is its worst signal, written out: "Needs
attention: no homework published in 14 days". Thresholds live in one function
(`admin.school_health`) so they are easy to tune once real schools exist.

| Signal | Green | Amber | Red | Grey | Source (all exist today) |
|---|---|---|---|---|---|
| Licence | more than 30 days left | 30 or fewer | 7 or fewer, or ended | no licence set | `lms.licence` (0041) |
| Payment | nothing overdue | an invoice 1 to 14 days overdue | more than 14 days, or a mandate failed | no billing account yet | `billing.invoice` (plan 3) |
| Seats | under 90% used | 90% or more | more than bought | no licence | `lms.seats_used` (0041) |
| Activation | 60% or more of students have done anything | 30 to 60% | under 30% | under 14 days since the first import | `lms.submission`, `ledger_event` by student |
| Teaching | homework published in the last 7 days | none in 7 | none in 14 | no classes yet | `lms.assignment.published_at` |
| Learning | 30% or more of students handed in work in the last 7 days | 10 to 30% | under 10% | nothing was due | `lms.submission.submitted_at` |
| Attendance | marked on the last school day | not in 3 days | not in 7 | the school never uses it | `lms.attendance.marked_at` |
| Safety | no unread report | an unread report | an unread unsafe report | none | `student_report.org_id` |
| Last active | within 3 days | within 7 | more than 14 | none | `lms.founder_schools().last_active` |

Counts only; no child is ranked or listed by these signals.

**The platform's own health ("System" page):** the relay (stopped or not, failure rate
in 5 minutes), each scheduled job's last run and result (the 90-day purge, the
ceiling revert, the nightly rollups, the billing reconciliation; read from
`cron.job_run_details` on the hosted project, which the test harness will need a stand-in
for), Cashfree (last webhook, signature failures in 24 hours, events not yet processed),
the alarm checker's heartbeat, the migration level, and the last restore drill (a date
typed by a person).

## 10. Subscriptions and payments, through Cashfree (plan 3)

**One Cashfree merchant account** for everything: schools now, college students later.
Its client id and secret are Supabase Edge Function secrets
(`CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET`, `CASHFREE_ENV` = sandbox or
production, `CASHFREE_API_VERSION`). Base URLs (documentation): sandbox
`https://sandbox.cashfree.com/pg`, production `https://api.cashfree.com/pg`; every call
sends `x-client-id`, `x-client-secret` and `x-api-version` (the documentation shows
`2026-01-01` today). Each order or link carries the school code and invoice number in
its notes, so one account still tells every payment apart.

**How a school pays.** Schools mostly pay a yearly or term fee, often by bank transfer:

1. **Invoice and a payment link** (the default). The panel raises an invoice (numbered
   with no gaps per financial year, for example `QRIE/2026-27/0001`); `billing-api`
   creates a Cashfree payment link for it (`POST /links`: amount, purpose, customer,
   `link_id` = the invoice number, expiry, `notify_url`; partial payments can be
   allowed for instalments); staff send the link by email or WhatsApp. When Cashfree
   reports the link `PAID` (event `PAYMENT_LINK_EVENT`), the invoice is paid.
2. **A bank transfer or cheque**, recorded by hand: amount, date, reference, a scan of
   the proof; owner or finance only; audited.
3. **A mandate for monthly plans** (later, and for college students): Cashfree
   Subscriptions (`POST /subscription/plans`, `POST /subscription/mandates`, the customer
   authorises by UPI Autopay, e-mandate or card; periodic plans are debited by Cashfree on
   schedule). UPI Autopay is limited to Rs 15,000 per debit without extra authentication
   (documentation), so a yearly school fee uses a link or an e-mandate.

**The licence follows the money.** A fully paid invoice for a subscription period sets
the school's licence (`lms.set_licence`: seats and last day) and writes an audit row as
"Cashfree". A trial is a licence with plan `pilot` and no invoice. After the last day:
**grace** (14 to 30 days, per school), then **suspended** (the tutor goes off; homework,
marks and exports stay; new imports stop; the school admin sees a banner), then
**ended** (data kept or erased as counsel decides; an export is offered first).

**The webhook** (`cashfree-webhook`, an Edge Function with no JWT check, because Cashfree
calls it):

- Verify first: `base64(HMAC-SHA256(x-webhook-timestamp + raw body, client secret))`
  must equal `x-webhook-signature`, computed on the **raw** body (documentation). A
  failure is stored as a signature failure and answered 401.
- Store once: `billing.webhook_event` keyed by the idempotency header (versions
  `2025-01-01` and later send one) or, failing that, a hash of the body. Delivery is
  at least once and can be out of order (documentation), so a repeat is a no-op and
  each event only ever moves an invoice forward (unpaid → partly paid → paid), never
  back.
- A payment counts only when its amount, currency and link or order id match the
  invoice. Then answer 200 so Cashfree stops retrying (it retries 3 times, at 2, 10
  and 30 minutes, by default).
- Subscription events (`SUBSCRIPTION_STATUS_CHANGED` and the payment events) are
  configured on Cashfree's separate "Subscriptions" webhook tab and are **not
  replayed** (documentation), so the hourly reconciliation (`GET /links/{id}`,
  `GET /subscription/mandates/{id}`) closes any gap. Exact event names and payload
  fields beyond these are UNVERIFIED until tried in the sandbox.

**Invoices and tax.** Qrie's own numbered invoice is the record; Cashfree only collects.
Each invoice prints Qrie's and the school's GSTIN, the SAC code and the GST rate the CA
decides, in rupees and paise. A refund (owner only, fresh code) goes through Cashfree's
refund API and creates a credit note.

**Billing pages:** Billing overview (collected this month, outstanding, overdue,
renewals due in 30, 60 and 90 days, cost to serve and margin per school once prices are
loaded), Invoices, Subscriptions, Payments, Webhook log; and each school's Billing tab.

**Aarav's steps for Cashfree:** complete the merchant account's business KYC and
settlement bank account; publish terms, refund and privacy pages on the website (payment
gateways ask for them; UNVERIFIED for Cashfree in particular); in the dashboard, set the
webhook URL (Payment Gateway tab and Subscriptions tab) to the `cashfree-webhook`
function; put the keys in Supabase secrets; try everything in the sandbox first.

## 11. The visualiser (plan 6)

**Principle:** trends and queues, never a child. Every chart is an aggregate; a school's
learning figure with fewer than 10 children is suppressed; there is no ranking.

| Page | Charts (7 and 30 days unless said) | Source |
|---|---|---|
| **Overview** | learners per day; minutes taught; classes served; spend against the ceiling; Rs per student-hour (unpriced share and a "floor" label); open reports | `learning_session`, `usage_cost`, `relay_budget_day`, `student_report` |
| **Money** | revenue collected and outstanding; renewals ahead; spend by day, relay, model and school; cost per prepared class; **margin per school** (fee against cost to serve) | `billing.*`, `usage_event`, `model_price` |
| **Schools** | health over time; seats used; activation; homework handed in; quiet-school timeline | the health signals, `lms.*` |
| **Learning** | outcomes covered by class and subject; misconception counts; practice done (n ≥ 10) | `ledger_event`, `learner_model`, `lms` insights |
| **Content** | classes by status; reports per class; class and picture cost; question banks by review state | `prepared_class`, `student_report`, `usage_event` |
| **Reliability** | refusals by reason; failure rate; latency; the alarm's heartbeat; webhook health | `usage_event.status`, `billing.webhook_event` |
| **Funnel** | contest entries, verified parents, first class, second day | `contest_signup`, `consent_record`, `learning_session` |
| **Safety** | reports by age and status; time to first look; capture coverage (never a bare zero) | `student_report`, `admin.safety_event` |

Pipeline: live numbers from the same functions as Today; trends from
`admin.metric_daily`, filled just after midnight IST and recomputable. Charts with
Recharts (MIT, already in `apps/lms`).

## 12. The panel's look and structure

**The UI is the teacher app's** (`apps/lms`), which started from `satnaing/shadcn-admin`
(MIT, its licence kept): the same sidebar, header, data tables, dialogs, toasts, theme
switch (light and dark) and Ctrl+K search, so Qrie's tools look like one product. The
files are **copied, not imported**, into `apps/admin`, so a change to the teacher app
never changes the console. Plan 1's shell is already built this way and verified.

Navigation as the plans land: **Today**, **Switches** (plan 1) · **Schools**, **Users**,
**System**, **Staff and audit** (plan 2) · **Billing** (plan 3) · **Safety**, **Classes**,
**Privacy** (plan 5) · **Money** and the charts (plan 6). Only pages that exist are in
the sidebar.

Page patterns: a permanent environment badge (red for `HOSTED`); a "this build is for X
but the database says Y" warning; a reason box on every change; a blast-radius line
before anything guarded; typed confirmation of the environment for every write; grey
"not captured", never a green zero.

## 13. Where it meets the school principal's panel

The licence and billing state (the school admin sees "licence ends on…", "invoice due",
and later can pay the link from inside the teacher app); the school's activity log, where
staff actions appear as "Qrie staff"; the seat counts the import checks; the principal's
co-signature on destructive actions on that school's data.

## 14. Roadmap: everything, in order, each plan its own document

| Plan | Delivers | When |
|---|---|---|
| **1 Foundation** (written, verified) | staff, audit, stop and ceiling, Today, switches, alarm, the shell on the teacher app's UI kit, bundle guard | first |
| **2 Schools, users and health** | schools list and page, the health card, the two-door users directory, the System page, `admin-api` (PIN reset, disable, staff invite), school notes, the audit copy off the platform | before school 1 |
| **3 Billing with Cashfree** | the `billing` schema, `billing-api` and `cashfree-webhook`, invoices, payment links, offline payments, the licence following payment, grace and suspension, hourly reconciliation, Billing pages | before the first **paid** school |
| **4 App wiring** | the four apps read `app_config`; the contest limit as a row; a school's grace or suspension banner in the teacher and student apps | with 3 |
| **5 Safety, classes, privacy** | server capture of distress flags, report triage, evidence with reasons, publish and retract, erasure, per-school fiduciary row | before school 1 |
| **6 Visualiser** | rollups and every chart above, money included | after 2 and 3 |
| **7 Later, each when its trigger fires** | college students (named accounts, Cashfree Subscriptions by UPI Autopay, course-map purchases); parent accounts and WhatsApp or SMS (needs DLT registration); the tutor inside the student app (a per-school AI budget, a per-relay stop); LAM health tiles after the server fold (L6); question-library review; GST e-invoicing if turnover requires it; staff lifecycle (quarterly review, auto-disable) | by trigger |

**Before a pilot school's children use it:** plans 1, 2 and 5, plus Step 0. **Before a
school pays:** plan 3 and 4's banner. A plan is expanded into tasks only when it starts,
because the hosted state, the VPS and the other lanes will have moved.

## 15. Steps that are Aarav's, and outside facts

In `docs/ops/admin-console.md` (stored with plan 1): `supabase db push` for 0026 to 0051
(hosted had nothing past 0025 on 2026-10-03, STALE); expose the `admin` schema (and later
`billing`); enable TOTP; consider closing email sign-up; make the owner; host the panel on
its own address; the Telegram bot and two chats; six GitHub secrets; an uptime monitor;
hardware-key MFA on every cloud account; a named backup safety reviewer and a second
person who can stop the tutor. For plan 3: the Cashfree account's KYC and settlement
account, policy pages, webhook URLs, keys in Supabase secrets, sandbox first; plan
prices; the CA's GST rate and SAC code. Counsel: the data fiduciary, who receives a
disclosure, whether any child words may be kept.

## 16. Verified, and not

**Measured on 2026-10-06:** plan 1's migrations 0047 to 0051 and their tests run on real
Postgres (PGlite) on top of `lms` migrations 0001 to 0042: **125 new tests in 16 files
pass**. A wider run of the suites touching these tables (105 files) passed 101 files and
1,375 tests, the new ones included; its only failures were 3 `tools/measure` suites that
read an untracked `.env.local`. The patches apply in order on a clean `lms@2278f6d`. The
console rebuilt on the teacher app's UI kit typechecks, and **builds with Tailwind 4**
(`vite build`, 2,098 modules). The earlier "Tailwind would not resolve" was the scratch
checkout: the repo root has Tailwind 3.4 (the tutor's) and v4 lives in
`apps/lms/node_modules`; `apps/admin` declares v4, so npm nests it the same way. The bundle
scan finds no secret in that build. Both CLIs run under Node's type stripping.

**Not measured:** a browser run against a real Supabase project (the authenticator
screens, the `amr` timestamps, schema exposure, the CSP in a browser); anything on the
hosted project; Telegram; GitHub's scheduler; anything at Cashfree (no sandbox call has
been made; event names beyond those quoted and all payload fields are UNVERIFIED); the
YAML of the new workflow (no parser at hand).
