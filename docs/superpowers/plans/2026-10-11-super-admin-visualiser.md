# Qrie control, Plan 6: The visualiser. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner sees the platform as trends and queues, never as a child: eight chart pages (Overview, Money, Schools, Learning, Content, Reliability, Funnel, Safety) over 7 and 30 days, built from one table of daily aggregates (`admin.metric_daily`) that a pg_cron job fills just after midnight India time and that the owner can recompute for a date range with a fresh authenticator code. Live tiles on each page come from the functions Today, System, Billing and Safety already call. Every learning figure for a group of fewer than 10 children is suppressed, no chart lists or ranks a child, and a figure whose source this database does not hold reads "Not captured" in grey with its reason, never zero. The spec's "Relay and AI cost" row (meter units, Rs per student-hour with its unpriced share), the student app's "sign-ins per school", and plan 3's deferred "cost to serve and margin per school" are delivered here.

**Architecture:** New tables in the `admin` schema (`metric_def` the catalogue, `metric_daily` the numbers, `metric_run` the run log, `metric_family` the list of roll-up functions), written only by SECURITY DEFINER functions and read only through `admin.metric_series(page, days, school)`, which checks the page's roles, applies the small-group rule and marks what is not captured. Roll-ups are one internal function per family (tutor, spend, relay, calls, money, webhooks, schools, learning, funnel, content, safety), each registered in `admin.metric_family` and called in order by `admin.metric_compute(day, nightly)`. Two live lists that are not daily series (margin and renewals; content lists) get their own reads. The console gets a "Charts" group of eight pages drawn with Recharts, on plan 2's `useLoad`/`LoadView` and plan 2's `WriteDialog` for the one write (recompute).

**Tech Stack:** Postgres (migrations 0071 to 0074) tested on PGlite through `supabase/tests/harness.ts`; TypeScript (`packages/admin-client`); React 19, Vite, TanStack Router, Tailwind 4, the console's copied UI kit, Recharts 3 (MIT); vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-super-admin-panel-design.md` sections 3 (roles), 4 (pg_cron nightly rollups), 6 (never shown), 7 (`admin.metric_daily`, plan 6), 8 rows "Relay and AI cost", "Student app" (sign-ins per school), "Billing" (cost to serve), 10 (Billing overview: "cost to serve and margin per school once prices are loaded"), 11 (the visualiser), 12 (grey "not captured"), 14 (plan 6). It lives in the main checkout (`C:/Users/Ashish Sharma/curie`); read it there, never edit it. Format exemplars: plan 1 (main checkout, `docs/superpowers/plans/2026-10-06-super-admin-foundation.md`), plans 2 to 5 (this branch, `docs/superpowers/plans/2026-10-0{7,8}-super-admin-*.md`).

**Status of this document:** written 2026-10-11 on branch `admin-charts` (cut from `admin@f61a758`, where plans 1 to 5 and the merge glue 0061 and 0070 are merged; the full suite there was 4,872 passed, 2 skipped). Nothing in it is built. Every fact about the repository below was read or run on 2026-10-11 and cites its file and line; everything else is marked UNVERIFIED.

**THE TUTOR CODE ON THIS BRANCH IS OLDER THAN THE LIVE TUTOR.** `apps/classroom`, `packages/relay` and `supabase/functions/relay` here predate the live relay (branches `phase3-completion` and `voice-stt-tts`; the live relay has commits `743c05a`, `1dcfcfe` and `18733af`, which this branch does not). **This plan changes no file in `apps/classroom`, `packages/relay` or `supabase/functions/relay`**, and nothing there may be deployed from this branch. Where a chart would need the relay to record more (refusals by reason, latency), the chart says "Not captured" instead (ruling R13).

---

## What exists, read 2026-10-11

**The tutor's own records (the sources of Overview, Money's spend, Reliability's calls).**
- `public.learning_session` (`supabase/migrations/0006_ledger.sql:26-45`): `id`, `org_id` (not null), `user_id`, `source`, `topic_ref`, `started_at` (the device's clock), `ended_at`, `active_ms` (time on task, `:36-42`), `received_at` (the server's clock, `:44`); `prep_id` added in `0018_org_and_attribution_columns.sql:191-192`. Sources widened to `class, quiz, diagnostic, doubt, homework, test, practice, api` (`0021_school_safe_tenancy.sql:58-60`). `ended_at` is never written null after 0011 (`0011_close_session_once.sql:21-27, 74-75`). LMS practice writes a sitting with `ended_at` and no `active_ms` (`0031_lms_analytics_and_learn.sql:593-596`).
- `public.ledger_event` (`0006:52-110`): `org_id`, `user_id`, `session_id`, `kind` (`asked, answered, helped, ...`, `:77-81`), `source`, `outcome_ids text[]` (`:89`), `payload jsonb` (`:110`), `received_at` (`:75`; "what any billing, rate or audit question must use", `:72`). Practice answers are `answered`/`practice` events with `payload` `{correct, chosenIndex, itemId, assistanceRung}` (`0031:601-606`).
- `public.usage_event` (`0008_usage.sql:19-40`): `user_id`, `session_id`, `at` (server default `now()`, `:26`), `relay` in `llm, speech, hear, class, icons` (`:27`), `provider`, `model` (nullable), `status` (upstream; "0 means dispatched without a visible outcome (a stream the host carried)", `:30-32`), token, image, character, audio and byte counts. `org_id`, `prep_id`, `bucket` (`live|warm`, null = unattributed) added in `0018:44-45, 188-195`. No column records how long a call took (searched every `alter table public.usage_event`: only 0018's).
- `public.model_price` (`0008:48-59`), `public.price_at(provider, model, unit, at)` (`0008:118-131`), and the view `public.usage_cost` = `usage_event.*` plus `inr` and `unpriced` (`0018:252-279`; service role only, `0018:285-288`). `public.cost_per_student_hour(days)` divides the spend of closed sittings with `active_ms > 0` (by `received_at`) by their active hours (`0008:176-211`). The Rs 5 per student-hour ceiling is named in `apps/classroom/src/lib/liveClass.ts:440`.
- The meter: `public.relay_budget_day (day date primary key, units, updated_at)` (`0015_project_spend_cap.sql:30-34`), its `day` being the UTC day (`0015:62`); `public.relay_control` one row with `global_units_per_day` (`0016_relay_control.sql:29-36`), bounded 1000 to 1000000 (`0048_admin_relay_control.sql:30-44`). Only `admin.set_caps` and `admin.revert_caps` change the ceiling (`0048:164, 186`, searched), and each writes an audit row: `ceiling-set` with `details {from, to, spentToday}` (`0048:165-166`) and `ceiling-reverted` with `details {to}` (`0048:189-190`). The revert runs at 00:05 UTC (`0048:195`).
- **Refusals are not recorded.** `public.claim_relay` (current body `0064_app_admission_reads.sql:50-...`) writes only `relay_usage` (`:112`) and `relay_budget_day` (`:169`); a refusal returns a reason and keeps no row.
- `admin.today()` (current body `0070_admin_wave2_merge.sql:16-84`): units today on the UTC day (`:23, 36`), students in the last 10 minutes (`:37`), unread reports and the unsafe ones (`:39-42`), the ceiling (`:67`); callable by owner, ops and safety (`require_staff()` defaults, `0047_admin_foundation.sql:160`). `admin.relay_status()` (`0048:60-...`) the same roles.

**Schools and the LMS (the sources of the Schools and Learning pages).**
- `lms.school (org_id, code, display_name, ...)` (`0022_lms_school_structure.sql:46-60`); `lms.account (user_id, org_id, login_id, kind, display_name, created_at)` (`0022:101-109`) with `left_at` (`0034_lms_who_sees_what.sql:29`).
- `lms.assignment (... published_at, due_at ...)` (`0023_lms_homework.sql:68-87`); `lms.item (org_id null = the library, outcome_ids, grade, subject, kind, options, correct_index, misconceptions jsonb, ...)` (`0023:28-58`); `lms.item_approval (org_id, item_id, ...)` (`0023:60-66`); `lms.item_draft` (`0043_lms_item_drafts.sql:25-40`).
- `lms.submission (org_id, assignment_id, student_user_id, kind, attempt, submitted_at, late)` (`0024_lms_submissions.sql:25-37`); `lms.submission_answer (submission_id, item_id, chosen_index, correct)` (`0024:41-47`).
- `lms.outcome (id, grade, subject, chapter, title)` (`0027_lms_insights.sql:22-28`) and `position` (`0028_lms_question_bank.sql:15`). A misconception is the label at the chosen wrong option's index in `lms.item.misconceptions` when that array is an array (`0040_lms_likely_misconceptions.sql:540-553`).
- `lms.attendance (student_user_id, on_date, org_id, section_id, status, marked_by, marked_at)` (`0036_lms_attendance.sql:15-24`); `lms.india_today()` = `(now() at time zone 'Asia/Kolkata')::date` (`0036:32-38`).
- `lms.licence (org_id, plan, seats, valid_until, set_at)` (`0041_lms_licence.sql:35-41`); `lms.seats_used(org)` (`0041:52-64`, service role only).
- `admin.school_health_for(org)` (body `0052_admin_schools_health.sql:120-313`; its payment signal replaced in 0058, its grey safety sentence in 0067) returns `{level, label, quietUntil, lastActiveOn, students, signals}`; activation is "students who have handed in work or have a ledger event here" (`0052:186-196`), learning is "students who handed in work in the last 7 days" (`0052:221-230`), last active reads attendance, submissions, published homework and ledger events (`0052:266-273`). `admin.school_org(code)` (`0052:50-64`), `admin.require_reason` (`0052:66-75`). `admin.school_weekly` (`0053_admin_school_page.sql:115-141`) counts a school's weekly homework, hand-ins and attendance.
- **No sign-in record exists in any migration** (searched `sign_in`, `signin`, `last_seen`, `signed_in`, `last_sign`). The harness's `auth.users` has `created_at, email, id, is_anonymous, raw_app_meta_data, raw_user_meta_data` and no `last_sign_in_at` (measured on PGlite 2026-10-11). Supabase's hosted `auth.users` has a `last_sign_in_at` column (UNVERIFIED on Qrie's project).

**Money.**
- `billing.subscription (org_id, plan_id, seats, starts_on, ends_on, seat_price_paise, ..., cancelled_at)` (`0057_billing_ledger.sql:79-93`); `billing.invoice (... org_id, subscription_id, kind, taxable_paise, total_paise, issued_on, due_on, status unpaid|partly_paid|paid|void, paid_paise, voided_at ...)` (`0057:103-133`); `billing.payment (org_id, invoice_id, source, amount_paise, received_on, counted, ..., reversed_at)` (`0057:157-181`); `billing.webhook_event (received_at, signature_ok, event_type, status stored|processed|ignored|mismatch|unparsed|signature_failed, ...)` (`0057:213-227`); signature failures are deleted after 90 days (`0060_billing_states.sql:148`). `admin.billing_overview()` reads collected this month, outstanding, overdue and renewals for owner, ops and finance (`0060:168-213`, roles `:174`). The nightly `billing-states` job runs at 18:40 UTC (`0060:154`).

**Content, safety, funnel.**
- `public.prepared_class (id, topic_ref, title, ..., created_at)` (`0004_prepared_class.sql:19-32`) with `review_status pending|published|retracted`, `published_at`, `version`, `retracted_at` (`0018:308-322`); `admin.class_review (class_id, ..., action published|retracted|rejected|files-removed, at, ...)` (`0068_admin_classes.sql:27-45`); `admin.class_cost_for(topic)` and `admin.class_reports(class, topic)` (internal, `0068:56-91`); `admin.classes(status)` for owner, ops and safety (`0068:126-132`).
- `public.student_report (... org_id, kind wrong|rude|unsafe|other, note, ..., received_at, status, actioned_at)` (`0019_report_and_consent.sql:36-70`); statuses `new|seen|triaged|closed`, `seen_at` ("the first look"), `closed_at`, and "0019's actioned_at is the time a report became triaged" (`0067_admin_safety_cases.sql:29-36`); reports closed before 0067 have no `closed_at` (`0067:31` sets the status only). `admin.safety_overview()` (owner and safety, `0067:122-176`) returns counts, unread ages, the 30-day first look and capture.
- `admin.safety_event (id, category, direction, org_id, platform, release, at, received_at)` (`0065_admin_safety_capture.sql:11-20`); `admin.distress_capture()` (`0065:90-...`), the setting `distress_capture_since`.
- `public.contest_signup (user_id unique, ..., created_at)` (`0020_contest_signup_and_otp_attempts.sql:33-70`); `public.consent_record (user_id, ..., source contest|self_serve, otp_verified_at not null, contest_code)` (`0019:180-191`).

**The admin lane this builds on.** `admin.require_staff(roles)` (owner always passes; refusal `not allowed` 42501; default roles owner, ops, safety), `require_fresh_mfa(10)`, `check_environment`, `environment()`, `audit(...)`, `audit_service(...)`, `tripwire()` (`0047:115-209`); `admin.setting` keys `^[a-z][a-z_]{1,40}$` (`0047:42-46`). `admin.system_health()` (`0055_admin_audit_chain_system.sql:194-284`) lists every `cron.job` with its last run (`:217-237`), counts the relay's failures in 5 minutes as `status = 0 or status >= 500` (`:214-216`), and reads the alarm's last check from the one setting `alert_last_seen` (`:244`), which `public.alert_snapshot` overwrites on every check (`0065:187`); no history of checks is kept. Cron jobs today: `admin-privacy-daily` (`45 19`), `admin-revert-caps` (`5 0`), `billing-states` (`40 18`), `lms-finalize-tests`, `purge-old-ledger` (measured on PGlite 2026-10-11).
- `supabase/tests/admin-invariants.test.ts:40-125` pins the exact `authenticated` list (C collation); `:128-173` the service-role list; `:175-202` internals.
- Test tools: `freshDatabase`, `createUser`, `asClaims`, `asService` (`supabase/tests/harness.ts`; the `cron` shim records `cron.job` rows, `:105-128`); `makeStaff`, `aal2`, `fresh`, `anonymousChild`, `setEnvironment` (`admin-fixtures.ts`); `buildSchool` (`fixtures.ts:42-...`), `addStudents`, `ageStudents`, `publish`, `handIn`, `markAttendance`, `tutorSession`, `ledgerEvent`, `fileReport`, `setLicence`, `ago` (`admin-school-fixtures.ts`); `rpc`, `serviceRpc`, `makeFinance`, `readySeller`, `readyPlan`, `billedSchool`, `subscribe` (`billing-fixtures.ts`); `keepFlag`, `report`, `classRow` (`safety-fixtures.ts`); `addHostedStandIns` (`admin-standins.ts`).
- Measured on PGlite 2026-10-11: a statement-level trigger running `admin.tripwire()` writes an `unmanaged-change` row with `target_kind` = the table name; a unique index on `(day, coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), dim)` builds; `('2026-10-10'::date)::timestamp at time zone 'Asia/Kolkata'` is `2026-10-09T18:30:00Z`; `timezone()` is `stable`, not immutable; `jsonb_build_object('v', 12345678901::bigint)` gives a JSON number.

**The console.** `apps/admin/src/components/layout/data/sidebar-data.ts` (groups; each item's `roles`), `src/lib/nav.ts` (`navFor` keeps a collapsible whose sub-items are all filtered out; `homeFor`), `src/components/command-menu.tsx:54-66` (lists only items with a `url`, so a collapsible's sub-items are not offered), `src/components/layout/nav-group.tsx` (renders collapsibles), `src/router.tsx` (code routes), `src/lib/client.ts`, `src/lib/use-load.ts`, `src/components/load-view.tsx`, `src/components/admin-page.tsx`, `src/components/write-dialog.tsx` (`WriteDialog`: blast line, reason, typed environment, `guarded`), `src/features/billing/money.ts` (`formatPaise`), `src/lib/tiles.ts` (`ALARM_STALE_MINUTES = 15`), `src/features/safety/model.ts` (plan 5's `captureText`). `apps/admin/tests/nav.test.ts` pins every role's sidebar. Tests in `apps/admin/tests` import relatively (the root `@` alias points at `apps/lms/src`).
- **Charts in the teacher app.** `apps/lms/package.json:49` declares `recharts ^3.8.1`; the installed copy is 3.10.1, MIT, "Copyright (c) 2015-present recharts" (`node_modules/recharts/package.json`, `LICENSE`, measured). The teacher app's chart frame and tile are in `apps/lms/src/features/analytics/charts.tsx`: `Kpi` (`:74-123`), `ChartCard` (`:125-151`), the axis and tooltip styles (`:153-160`); they import `@/lib/palette` and `date-fns`, which `apps/admin` does not have. `apps/admin/package.json` has no `recharts`. Recharts 3.10.1 exports `ReferenceArea`, `ReferenceLine`, `LineChart`, `BarChart`, `AreaChart`, `ResponsiveContainer`; lucide-react 1.39.0 exports `ChartLine` (measured).

## Global Constraints

- Work only in `C:/Users/Ashish Sharma/curie/.claude/worktrees/admin-charts` on branch `admin-charts`. Never touch the main checkout's working tree or any other worktree. Never push, deploy, run `supabase db push`, call a hosted service, or put a real secret anywhere. No change to `apps/classroom`, `packages/relay` or `supabase/functions/relay`.
- Migrations **0071 to 0074 only**. Never edit 0001 to 0070 (merged into `admin`). Later tasks of this plan may append to a migration an earlier task of this plan created (it is not merged yet).
- Every `admin.*` function: `SECURITY DEFINER`, `set search_path` to the schemas it uses, begins with `admin.require_staff(...)` for the roles of ruling R9; refusal is exactly `not allowed` (42501). The one write (`admin.metric_recompute`) also calls `admin.require_fresh_mfa(10)`, takes `p_env` (`admin.check_environment`) and `p_reason` (`admin.require_reason`), sets `admin.session`, and writes `admin.audit` with dates and counts only.
- Explicit `revoke all ... from public, anon, authenticated` (and `service_role` for tables and internals), then explicit grants. `supabase/tests/admin-invariants.test.ts` pins the exact lists; keep it updated in each task.
- **Trends and queues, never a child.** `admin.metric_daily` has no column that can hold a person's id; a dimension is a fixed word, a relay or model name, a report kind or status, or a curriculum label from a library question. No read returns a user id, login ID, name, note, phone or address. No chart lists, ranks or follows a child. A child figure (ruling R3) is returned as `null` with `suppressed: true` when it, or its sum or difference with any other figure the read returns, would describe fewer than 10 children (ruling R2, as corrected in the fix pass). A source this database does not hold reads `captured: false` with a reason; the console shows it grey, "Not captured", never a zero. A day with no roll-up has no point; the console shows it grey, never a zero.
- "A day" is an Asia/Kolkata day: `[d::timestamp at time zone 'Asia/Kolkata', (d + 1)::timestamp at time zone 'Asia/Kolkata')`, through `admin.ist_start(d)`. The meter's units and the ceiling are the exception (UTC days, ruling R4). Money is `bigint` paise.
- The browser never reads a table; the console reads through `packages/admin-client`. App text is English, sentence case.
- COMMENTS ARE CLAIMS: every comment, doc line, test name and UI sentence states only what the code does. Anything not run is UNVERIFIED.
- TDD: write the failing test, run it, see it fail for the stated reason, implement, see it pass. Database tests carry `// @vitest-environment node`.
- Windows, PowerShell 5.1: write files without a BOM; commit with a message file (helper below). End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- After each task, add one line to `.superpowers/build-ledger.md` (task, commit, test result). Never push (Aarav's step).

```powershell
# Run once per shell, from the worktree root.
function Commit([string]$msg) {
  $f = Join-Path $env:TEMP 'qrie-charts-commit.txt'
  [System.IO.File]::WriteAllText($f, "$msg`n`nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`n")
  git commit -F $f
}
```

## Review Focus

1. **No child in any number** (Task 8): the store's columns are pinned; a sweep seeds children with marker names, login IDs, notes and contest details, runs the nightly job and a recompute, calls every read as the owner, and finds none of them; every dimension in the store matches the allowed vocabulary.
2. **Small groups** (Tasks 2, 5, 6, 8): 9 children suppressed, 10 shown, for a point and for a total; funnel cohorts are returned only as window totals; per-school learning only through a one-school view.
3. **Not captured is never zero** (Tasks 2, 3, 5, 7, 11, 12): refusals by reason, latency, the alarm's history, sign-ins without the column, distress flags before capture; a day with no run has no point.
4. **Days**: India days at the right boundary (an event at 18:45 UTC lands on the next India day); the meter and the ceiling on UTC days, one day behind, and the page says so (Task 3).
5. **Who may do what**: the page roles (R9) pinned by test; recompute is the owner's with a fresh code, a reason and the environment, at most 92 days ending yesterday; the nightly job is the service role's and pg_cron's only.
6. **Recompute does not rewrite history it cannot see**: snapshots are left alone (R7); what a recompute counts is what the tables hold now (R8), and the runbook says so.

## Interfaces (what this plan produces and consumes)

**Consumes:** plan 1 (`require_staff`, `require_fresh_mfa`, `check_environment`, `environment`, `audit`, `audit_service`, `tripwire`, `admin.setting`, `admin.audit_event`, `admin.today`, `admin.relay_status`, the console shell); plan 2 (`require_reason`, `school_org`, `school_health_for`, `system_health`, `school_index`, `WriteDialog`, `useLoad`, `LoadView`, `AdminPage`, `Write`); plan 3 (`billing.*` tables, `billing_overview`, `formatPaise`); plan 4 (`roles?` on nav items, `navFor`); plan 5 (`safety_overview`, `distress_capture`, `class_cost_for`, `class_reports`, `class_review`, `classes`, `captureText`, `ClassCost`, `ClassReports`); the LMS lane and the tutor's tables listed above (read only).

**Produces, SQL, browser-callable (`authenticated`; each checks staff itself):**
`admin.metric_series(p_page text, p_days integer, p_school text default null) returns jsonb`;
`admin.metric_recompute(p_from date, p_to date, p_reason text, p_env text) returns jsonb` (owner, fresh code);
`admin.money_view(p_days integer) returns jsonb` (owner, ops, finance);
`admin.content_view() returns jsonb` (owner, ops).

**Produces, SQL, service role only:** `admin.metric_nightly() returns jsonb`.

**Produces, SQL, internal (no API grant):** `admin.ist_start(date)`, `admin.chart_roles(text)`, `admin.signins_readable()`, `admin.ceiling_on(date)`, `admin.metric_json(admin.metric_def, date, date, uuid, boolean)`, `admin.metric_compute(date, boolean)`, families `admin.metric_family_{tutor,spend,relay,calls,money,webhooks,schools,learning,funnel,content,safety}(date, boolean) returns integer`. Tables `admin.metric_def`, `admin.metric_daily`, `admin.metric_run`, `admin.metric_family`. Cron job `admin-metrics-nightly` at `50 18 * * *` (00:20 India time).

**Produces, TypeScript:** `packages/admin-client/src/charts.ts` (`ChartPage`, `MetricUnit`, `MetricPoint`, `Metric`, `ChartSeries`, `MarginRow`, `RenewalWeek`, `MoneyView`, `ContentView`, `RecomputeResult`, `ChartsClient`, `createChartsClient`); `apps/admin/src/components/charts/{chart-card,kpi,series-chart,not-captured}.tsx`; `apps/admin/src/features/charts/{model.ts, frame.tsx, recompute-dialog.tsx, overview.tsx, money.tsx, schools.tsx, learning.tsx, content.tsx, reliability.tsx, funnel.tsx, safety.tsx}`; routes `/charts/{overview,money,schools,learning,content,reliability,funnel,safety}`; the sidebar group "Charts".

## File structure

| Path | Responsibility | Task |
|---|---|---|
| `.superpowers/.gitignore`, `.superpowers/build-ledger.md` | the ledger (ignored by git) | 1 |
| `supabase/migrations/0071_admin_metrics.sql` | catalogue, store, run log, family list, read, the not-captured rows | 2 |
| `0071` (append) | dispatcher, nightly, recompute, cron; families tutor, spend, relay, calls | 3 |
| `supabase/tests/metrics-fixtures.ts` | `metricDef`, `putMetric`, `atIst`, `sitting`, `usage`, `price`, `nightly`, `series` | 2, 3 |
| `supabase/tests/admin-metrics-store.test.ts` | the store and the read | 2 |
| `supabase/tests/admin-metrics-tutor.test.ts` | tutor, spend, relay, calls, jobs, recompute | 3 |
| `supabase/migrations/0072_admin_metrics_money.sql` + `supabase/tests/admin-metrics-money.test.ts` | money and webhook families, `money_view` | 4 |
| `supabase/migrations/0073_admin_metrics_schools_learning.sql` + `supabase/tests/admin-metrics-schools.test.ts` | schools family, sign-ins | 5 |
| `0073` (append) + `supabase/tests/admin-metrics-learning.test.ts` | learning and funnel families | 6 |
| `supabase/migrations/0074_admin_metrics_content_safety.sql` + `supabase/tests/admin-metrics-content-safety.test.ts` | content and safety families, `content_view` | 7 |
| `supabase/tests/admin-metrics-privacy.test.ts`, `admin-invariants.test.ts` | the never-a-child sweep, the final lists | 8 |
| `packages/admin-client/src/charts.ts`, `index.ts` + `packages/admin-client/tests/charts.test.ts` | typed client | 9 |
| `apps/admin/package.json`, `package-lock.json`, `apps/admin/src/components/charts/*`, `apps/admin/src/features/charts/model.ts`, `apps/admin/src/lib/nav.ts`, `sidebar-data.ts`, `command-menu.tsx` + `apps/admin/tests/{charts-model,nav}.test.ts` | Recharts, the copied chart pieces, pure helpers, the nav | 10 |
| `apps/admin/src/features/charts/{frame,recompute-dialog,overview,money,safety}.tsx`, `router.tsx`, `lib/client.ts` | three pages and the shared frame | 11 |
| `apps/admin/src/features/charts/{schools,learning,content,reliability,funnel}.tsx`, `router.tsx` | five pages | 12 |
| `docs/ops/admin-console.md` (section 9), `apps/admin/README.md` | runbook, provenance, the whole gate | 13 |

---

### Task 1: Baseline and the ledger

**Files:** Create `.superpowers/.gitignore` (one line `*`), `.superpowers/build-ledger.md`.

- [ ] **Step 1: Dependencies.** The worktree's `node_modules` was installed by the planner on 2026-10-11 (`npm ci --no-audit --no-fund`, 854 packages, exit 0). If `node_modules` is missing or empty, run `npm ci --no-audit --no-fund` (about 9 minutes).
- [ ] **Step 2: Baseline**

Run: `npx vitest run supabase/tests/admin-invariants.test.ts supabase/tests/admin-today.test.ts supabase/tests/admin-system.test.ts apps/admin/tests/nav.test.ts packages/admin-client/tests/safety-classes-privacy.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: The ledger.** Create `.superpowers/.gitignore` with `*` and `.superpowers/build-ledger.md` with a heading and the line `Task 1: baseline, <head sha>, <n> passed`. Nothing to commit (the folder is ignored).

---

### Task 2: The store and the read (0071)

**Files:**
- Create: `supabase/migrations/0071_admin_metrics.sql`, `supabase/tests/metrics-fixtures.ts`, `supabase/tests/admin-metrics-store.test.ts`
- Modify: `supabase/tests/admin-invariants.test.ts`

**Interfaces:**
- Produces the four tables, `admin.ist_start`, `admin.chart_roles`, `admin.signins_readable`, `admin.metric_json`, `admin.metric_series`, and the three catalogue rows that are never captured on this branch.
- Fixtures (`metrics-fixtures.ts`):
  - `metricDef(db, over: Partial<{key: string; pages: string[]; label: string; unit: string; dayKind: 'india' | 'utc'; kind: 'daily' | 'window' | 'snapshot' | 'cohort'; scope: 'platform' | 'school' | 'both'; childFigure: boolean; total: 'sum' | 'last' | 'none'; position: number}>) => Promise<string>` inserts a catalogue row as the database owner with `admin.session` on (defaults: `test.count`, `{overview}`, `count`, `india`, `daily`, `platform`, false, `sum`, 900).
  - `putMetric(db, row: {day: string; metric: string; org?: string | null; dim?: string; value: number; children?: number | null}) => Promise<void>` (session on).
  - `atIst(daysAgo: number, hhmm = '10:00') => string`: SQL text for the instant `hh:mm` India time on `lms.india_today() - daysAgo`.
  - `series(db, claims, page, days, school?) => Promise<ChartSeriesJson>` (calls `admin.metric_series` through `rpc`).

- [ ] **Step 1: Write the failing tests**

`supabase/tests/admin-metrics-store.test.ts` (`beforeAll`: `freshDatabase()`, `setEnvironment`, owner, ops, safety, `makeFinance`, `anonymousChild`, `buildSchool(db, 'CHA')`). Tests:
1. `the store holds a day, a metric, a school, a dimension, a whole number and a group size, and nothing that names a person`: `information_schema.columns` of `admin.metric_daily` ordered = `['children','computed_at','day','dim','id','metric','org_id','value']`; `has_table_privilege(role, t, 'select,insert,update,delete')` is false for `anon`, `authenticated` and `service_role` on `admin.metric_def`, `admin.metric_daily`, `admin.metric_run`, `admin.metric_family`.
2. `each page is read by the roles of ruling R9`: owner reads all eight pages; ops reads `overview, money, schools, learning, content, reliability, funnel` and is refused `safety` with `not allowed`; safety reads `safety` and is refused `overview` and `money`; finance reads `money` and is refused `overview`; an anonymous child, and the owner at `aal1` (`aal2(owner, {aal: 'aal1'})`), are refused `overview`.
3. `an unknown page, a day count other than 7 or 30, and a one-school view of a page without one are refused`: owner `p_page 'sales'` → `there is no chart page called sales`; `p_days 14` → `days is 7 or 30`; `('overview', 7, 'CHA')` → `this page has no view of one school`; `('schools', 7, 'NOPE')` → `there is no school with the code NOPE`.
4. `a day with no roll-up has no point, and a computed zero is a point of 0`: `metricDef(db, {key: 'test.count'})`; `putMetric` for yesterday value 0 and three days ago value 4; the 7-day series' `test.count` points = `[{day: d-3, dim: '', school: null, value: 4, suppressed: false}, {day: d-1, ..., value: 0, ...}]` (no point for the other days); `from` = today − 7, `to` = today − 1; `total` = `{value: 4, suppressed: false}`.
5. `a child figure for fewer than 10 children is suppressed, at 10 it is shown, and the total follows the same rule`: a `childFigure: true, total: 'sum'` def; rows `(d-2, value 3, children 9)` and `(d-1, value 5, children 10)` → points `{value: null, suppressed: true}` and `{value: 5, suppressed: false}`; total `{value: 8, suppressed: false}` (19 children); with only the 9-children row, total `{value: null, suppressed: true}`. The returned JSON has no `children` key anywhere (`JSON.stringify` does not contain `"children"`).
6. `a one-school view reads that school's rows; the platform view reads the platform's rows, or every school's for a school-only metric`: a `scope: 'both'` def with a platform row (value 7) and a CHA row (value 2): `('learning', 7)` → value 7, `school: null`; `('learning', 7, 'CHA')` → value 2, `school: 'CHA'`, and the series' `school` = `{code: 'CHA', name: 'CHA Public School'}`; a `scope: 'school'` def with rows for CHA and a second school → the platform view returns both, each with its code.
7. `what this database cannot see reads not captured, with its reason, never a zero`: `('reliability', 7)` as owner contains `relay.refusals`, `calls.latency` and `alarm.history`, each `captured: false`, `why` a sentence of at least 20 characters, `points: []`, `total: null`.
8. `a UTC metric's window ends a day earlier`: a `dayKind: 'utc'` def → its `from` = series `from` − 1, its `to` = series `to` − 1; a row on series `to` is not returned, one on `to − 1` is.
9. `a cohort metric is returned as a total only`: a `kind: 'cohort', childFigure: true, total: 'sum'` def with rows children 6 and 5 → `points: []`, `total: {value: <sum>, suppressed: false}`.
10. `a hand-made change to the store leaves an unmanaged-change row`: insert into `admin.metric_daily` without `admin.session` → an `admin.audit_event` row `action 'unmanaged-change'`, `target_kind 'metric_daily'`.
11. `the series says when the last roll-up finished`: with no `metric_run` row, `lastRun` is null; after inserting one (`to_day` yesterday, `nightly` true), `lastRun` = `{through: <yesterday>, finishedAt: <iso>, nightly: true}`.

In `admin-invariants.test.ts`, add `'admin.metric_series'` between `'admin.me'` and `'admin.read_log_list'`, and add `['admin', 'ist_start']`, `['admin', 'chart_roles']`, `['admin', 'signins_readable']`, `['admin', 'metric_json']` to the internals loop.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run supabase/tests/admin-metrics-store.test.ts supabase/tests/admin-invariants.test.ts`
Expected: FAIL (`relation "admin.metric_def" does not exist`; the `authenticated` list lacks `admin.metric_series`).

- [ ] **Step 3: Write the migration**

`supabase/migrations/0071_admin_metrics.sql`:

```sql
-- THE VISUALISER'S NUMBERS (spec sections 7 and 11, plan 6).
--
-- Every chart in the console reads admin.metric_daily: one whole number per
-- India day, metric, school (or the platform) and dimension. A dimension is a
-- fixed word (a relay, a model, a report kind, a status, a level) or a
-- curriculum label of a library question; no column can hold a person's id.
-- Roll-up functions (one per family, listed in admin.metric_family) fill it;
-- admin.metric_series is the only read. A learning figure for fewer than 10
-- children leaves the database as null; a source this database does not hold
-- is marked not captured with its reason; a day nobody rolled up has no point.

create table if not exists admin.metric_def (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  position integer not null,
  pages text[] not null check (cardinality(pages) > 0
    and pages <@ array['overview', 'money', 'schools', 'learning', 'content', 'reliability', 'funnel', 'safety']),
  label text not null check (char_length(label) between 1 and 80),
  unit text not null check (unit in ('count', 'paise', 'ms', 'minutes', 'units')),
  -- 'utc' only for the meter's units and the ceiling (ruling R4).
  day_kind text not null default 'india' check (day_kind in ('india', 'utc')),
  -- daily: that day; window: the 7 or 30 days ending that day (the key says
  -- which); snapshot: as seen by the nightly run, never recomputed (R7);
  -- cohort: people who entered that day, returned as window totals only (R19).
  kind text not null check (kind in ('daily', 'window', 'snapshot', 'cohort')),
  scope text not null check (scope in ('platform', 'school', 'both')),
  -- A figure about children's learning or use: suppressed under 10 (R2, R3).
  child_figure boolean not null default false,
  total text not null default 'none' check (total in ('sum', 'last', 'none')),
  -- False when this database has no source for it at all (R13).
  captured boolean not null default true,
  -- Said when the figure is not captured (static, or the dynamic checks in
  -- admin.metric_json).
  why text check (why is null or char_length(why) between 20 and 300),
  -- An admin.setting key holding the first day this figure exists.
  since_setting text
);

create table if not exists admin.metric_daily (
  id bigint generated always as identity primary key,
  day date not null,
  metric text not null references admin.metric_def (key) on delete cascade,
  org_id uuid references lms.school (org_id) on delete cascade,
  dim text not null default '' check (char_length(dim) <= 200),
  value bigint not null,
  -- How many children the figure describes; read only by admin.metric_json's
  -- small-group rule and never returned.
  children integer check (children is null or children >= 0),
  computed_at timestamptz not null default now()
);
create unique index if not exists metric_daily_one
  on admin.metric_daily (day, metric, coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), dim);
create index if not exists metric_daily_metric_day on admin.metric_daily (metric, day);

create table if not exists admin.metric_run (
  id bigint generated always as identity primary key,
  from_day date not null,
  to_day date not null check (to_day >= from_day),
  nightly boolean not null,
  by_staff uuid,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz not null default clock_timestamp(),
  rows integer not null default 0
);

-- The roll-up functions, called in position order by admin.metric_compute
-- (Task 3). Each is admin.metric_family_<name>(p_day date, p_nightly boolean)
-- returns integer (the rows it wrote).
create table if not exists admin.metric_family (
  name text primary key check (name ~ '^[a-z][a-z_]{1,30}$'),
  position integer not null unique,
  fn text not null check (fn ~ '^admin\.metric_family_[a-z_]{1,30}$')
);

revoke all on admin.metric_def, admin.metric_daily, admin.metric_run, admin.metric_family
  from public, anon, authenticated, service_role;
alter table admin.metric_def enable row level security;
alter table admin.metric_daily enable row level security;
alter table admin.metric_run enable row level security;
alter table admin.metric_family enable row level security;
-- Statement-level: one audit row per hand-made statement, not one per row.
drop trigger if exists metric_daily_tripwire on admin.metric_daily;
create trigger metric_daily_tripwire after insert or update or delete on admin.metric_daily
  for each statement execute function admin.tripwire();
drop trigger if exists metric_def_tripwire on admin.metric_def;
create trigger metric_def_tripwire after insert or update or delete on admin.metric_def
  for each statement execute function admin.tripwire();
```

Then, in order:
- `admin.ist_start(p_day date) returns timestamptz`, `language sql stable` (timezone() is stable, measured): `select p_day::timestamp at time zone 'Asia/Kolkata'`. Revoked from `public, anon, authenticated, service_role`.
- `admin.chart_roles(p_page text) returns text[]`, `language sql immutable`: `money` → `array['ops','finance']`; `safety` → `array['safety']`; `overview, schools, learning, content, reliability, funnel` → `array['ops']`; anything else → `array[]::text[]` (the owner only, who is then told the page does not exist). Revoked as above.
- `admin.signins_readable() returns boolean`, `language sql stable security definer`, `search_path = admin, public`: whether `information_schema.columns` has `auth.users.last_sign_in_at`. Revoked as above.
- `admin.metric_json(d admin.metric_def, p_from date, p_to date, p_org uuid, p_one_school boolean) returns jsonb`, internal:

```sql
create or replace function admin.metric_json(d admin.metric_def, p_from date, p_to date, p_org uuid, p_one_school boolean)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  f date := case when d.day_kind = 'utc' then p_from - 1 else p_from end;
  t date := case when d.day_kind = 'utc' then p_to - 1 else p_to end;
  since date;
  ok boolean := d.captured;
  pts jsonb;
  tot jsonb;
begin
  if d.since_setting is not null then
    select (s.value #>> '{}')::date into since from admin.setting s where s.key = d.since_setting;
    ok := ok and since is not null;
  end if;
  if d.key = 'school.signins' then
    ok := ok and admin.signins_readable();
  end if;
  if not ok then
    return jsonb_build_object('key', d.key, 'label', d.label, 'unit', d.unit, 'dayKind', d.day_kind, 'kind', d.kind,
      'captured', false, 'why', d.why, 'capturedSince', null, 'from', f, 'to', t, 'total', null, 'points', '[]'::jsonb);
  end if;
  with r as (
    select m.day, m.dim, s.code as school, m.value, m.children,
           d.child_figure and coalesce(m.children, 0) < 10 as hidden
      from admin.metric_daily m
      left join lms.school s on s.org_id = m.org_id
     where m.metric = d.key and m.day between f and t
       and (since is null or m.day >= since)
       and case when p_one_school then m.org_id = p_org
                when d.scope = 'school' then m.org_id is not null
                else m.org_id is null end
  )
  select
    case when d.kind = 'cohort' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('day', r.day, 'dim', r.dim, 'school', r.school,
               'value', case when r.hidden then null else r.value end, 'suppressed', r.hidden)
             order by r.day, r.school nulls first, r.dim)
        from r), '[]'::jsonb) end,
    case d.total
      when 'none' then null
      when 'sum' then (
        select jsonb_build_object(
                 'value', case when d.child_figure and coalesce(sum(r.children), 0) < 10 then null else coalesce(sum(r.value), 0) end,
                 'suppressed', d.child_figure and coalesce(sum(r.children), 0) < 10)
          from r where r.dim = '')
      else (
        select jsonb_build_object(
                 'value', case when d.child_figure and coalesce(sum(r.children), 0) < 10 then null else sum(r.value) end,
                 'suppressed', d.child_figure and coalesce(sum(r.children), 0) < 10)
          from r where r.dim = '' and r.day = (select max(x.day) from r x where x.dim = ''))
    end
  into pts, tot;
  return jsonb_build_object('key', d.key, 'label', d.label, 'unit', d.unit, 'dayKind', d.day_kind, 'kind', d.kind,
    'captured', true, 'why', null, 'capturedSince', since, 'from', f, 'to', t, 'total', tot, 'points', pts);
end;
$$;
```

- `admin.metric_series(p_page text, p_days integer, p_school text default null) returns jsonb`, `plpgsql stable security definer`, `search_path = admin, lms, public`, rules in order: `me := admin.require_staff(admin.chart_roles(p_page))`; `chart_roles` empty → `there is no chart page called <p_page or (none)>`; `p_days` not 7 or 30 → `days is 7 or 30`; `p_school` not null: page not `schools` or `learning` → `this page has no view of one school`, else `org := admin.school_org(p_school)`; `last_day := lms.india_today() - 1`, `first_day := last_day - p_days + 1`; metrics = `admin.metric_json(d, first_day, last_day, org, p_school is not null)` for every `d` with `p_page = any(d.pages)` and (`p_school is null` or `d.scope <> 'platform'`), ordered by `d.position`; return `{page, days, from, to, school: {code, name} | null, lastRun: {through: to_day, finishedAt, nightly} | null (the latest metric_run by finished_at), metrics}`. Revoke from `public, anon`; grant `authenticated`.
- The three rows never captured on this branch (ruling R13), inserted with `on conflict (key) do update`:

| key | position | pages | label | unit | kind | scope | why |
|---|---|---|---|---|---|---|---|
| `relay.refusals` | 600 | `{reliability}` | Refusals by reason | count | daily | platform | `The relay's refusals (stopped, the ceiling, a child's day used up, too fast) are answered by claim_relay, which keeps no record of them.` |
| `calls.latency` | 610 | `{reliability}` | Latency | ms | daily | platform | `No call's duration is recorded: usage_event has no column for it.` |
| `alarm.history` | 620 | `{reliability}` | Alarm checks over time | count | daily | platform | `Only the alarm's last check is kept (one setting, overwritten by every check), so there is no history to draw.` |

Each with `captured false`, `total 'none'`. Grants: revoke the four internals from `public, anon, authenticated, service_role`.

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run supabase/tests/admin-metrics-store.test.ts supabase/tests/admin-invariants.test.ts`
Expected: PASS (11 new).

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/0071_admin_metrics.sql supabase/tests/metrics-fixtures.ts supabase/tests/admin-metrics-store.test.ts supabase/tests/admin-invariants.test.ts
Commit "feat: a store of daily aggregates for the charts, read by page and role, small groups suppressed, gaps never zero"
```

---

### Task 3: The nightly job, recompute, and the tutor's figures (0071, appended)

**Files:**
- Modify: `supabase/migrations/0071_admin_metrics.sql` (append), `supabase/tests/metrics-fixtures.ts` (add `sitting`, `usage`, `price`, `nightly`), `supabase/tests/admin-invariants.test.ts`
- Create: `supabase/tests/admin-metrics-tutor.test.ts`

**Interfaces:**
- `admin.metric_compute(p_day date, p_nightly boolean) returns integer` (internal), `admin.metric_nightly() returns jsonb` (service role), `admin.metric_recompute(p_from date, p_to date, p_reason text, p_env text) returns jsonb` (owner, fresh code) → `{from, to, days, rows}`, `admin.ceiling_on(p_utc_day date) returns integer` (internal), four families.
- Fixtures: `sitting(db, {org, user, source?: string, receivedSql: string, endedSql?: string | null, activeMs?: number | null, topic?: string}) => Promise<string>`; `usage(db, {user, org?, session?, atSql, relay?, provider?, model?, status?, promptTokens?, images?, bucket?, prep?}) => Promise<void>`; `price(db, model, unit, inrPerUnit)`; `nightly(db) => serviceRpc(db, 'metric_nightly', {})`.

The catalogue rows this task adds (`insert ... on conflict (key) do update`; `scope 'platform'` unless said; `child_figure` false):

| key | pos | pages | label | unit | kind | total | dims written |
|---|---|---|---|---|---|---|---|
| `tutor.learners` | 10 | overview | Learners per day | count | daily | none | `''`, `school`, `direct` |
| `tutor.minutes` | 20 | overview | Minutes on task | ms | daily | sum | `''` |
| `tutor.classes` | 30 | overview | Classes served | count | daily | sum | `''` |
| `relay.units` | 40 | overview | Meter units used (UTC day) | units | daily, `utc` | none | `''` |
| `relay.ceiling` | 41 | overview | The ceiling (UTC day) | units | daily, `utc` | none | `''` |
| `cost.sitting_paise` | 50 | overview | Spend of closed sittings | paise | daily | sum | `''` |
| `cost.active_ms` | 51 | overview | Time on task of those sittings | ms | daily | sum | `''` |
| `cost.sitting_calls` | 52 | overview | Calls in those sittings | count | daily | sum | `''` |
| `cost.sitting_unpriced_calls` | 53 | overview | Unpriced calls in those sittings | count | daily | sum | `''` |
| `spend.paise` | 100 | money, content | AI spend | paise | daily | sum | `''`, `relay:<r>`, `model:<m or none>`, `bucket:<live, warm or none>`, `who:school`, `who:direct` |
| `spend.calls` | 101 | money | Calls | count | daily | sum | `''` |
| `spend.unpriced_calls` | 102 | money | Unpriced calls | count | daily | sum | `''` |
| `spend.school_paise` | 110 | money | AI spend by school | paise | daily, scope `school` | sum | `''` |
| `spend.school_unpriced_calls` | 111 | money | Unpriced calls by school | count | daily, scope `school` | sum | `''` |
| `prep.count` | 120 | money | Classes prepared | count | daily | sum | `''` |
| `prep.paise` | 121 | money | Spend preparing them | paise | daily | sum | `''` |
| `prep.unpriced_calls` | 122 | money | Unpriced preparing calls | count | daily | sum | `''` |
| `pictures.count` | 130 | content | Pictures made | count | daily | sum | `''` |
| `pictures.paise` | 131 | content | Spend on pictures | paise | daily | sum | `''` |
| `pictures.unpriced_calls` | 132 | content | Unpriced picture calls | count | daily | sum | `''` |
| `calls.outcome` | 500 | reliability | Calls by outcome | count | daily | sum | `''`, `ok`, `client`, `server`, `none`, `other`, `<relay>:<class>` |

- [ ] **Step 1: Write the failing tests**

`supabase/tests/admin-metrics-tutor.test.ts` (`beforeAll`: fresh database, environment, owner, ops; `buildSchool(db, 'TUT')`; a direct child `anonymousChild(db)`; `price(db, 'gemini-x', 'prompt_token', 0.001)`; model `unpriced-model` has no price). Each test computes with `select admin.metric_compute(<day>, false)` as the database owner unless it tests the jobs. Tests:
1. `learners count each person once a day, split into school and direct, on the India day the server received them`: TUT's `kid8a` has a sitting received at `atIst(2, '09:00')` and an answer the same day; the direct child an answer at `atIst(2, '23:50')`; `kid8b` an answer received at `atIst(2, '00:15')`, which is 18:45 UTC on the calendar day before (the boundary case). Day −2 rows: `''` = 3, `school` = 2, `direct` = 1; day −3 has `''` = 0.
2. `minutes on task add closed sittings with measured time; open sittings and sittings without time do not count`: three sittings received day −1: closed with `active_ms` 600000, closed with null, open (no `ended_at`) with 60000 → `tutor.minutes` = 600000.
3. `classes served count class sittings only`: a `class` and a `doubt` sitting → 1.
4. `the cost of closed sittings: their spend in paise, their time, their calls and how many are unpriced`: a closed sitting (active 3600000) with two `llm` usage rows (`gemini-x`, 1000 prompt tokens each = ₹1 each) and one `unpriced-model` row → `cost.sitting_paise` 200, `cost.active_ms` 3600000, `cost.sitting_calls` 3, `cost.sitting_unpriced_calls` 1.
5. `spend by relay, model, bucket, school and direct, with a zero row for a school that spent nothing`: usage on day −1 for `kid8a` (org TUT, `llm`, `gemini-x`, bucket `live`) and the direct child (`speech`, model null) → `spend.paise` dims include `relay:llm`, `relay:speech`, `model:gemini-x`, `model:none`, `bucket:live`, `bucket:none`, `who:school`, `who:direct`; a second school `buildSchool(db, 'TUZ')` has `spend.school_paise` value 0.
6. `preparations are counted by their id; pictures by images priced as image`: two `live` rows with the same `prep_id` and one with another → `prep.count` 2; a row with `images 2` and an `image` price of ₹2 → `pictures.count` 2, `pictures.paise` 400; an `images 1` row on `unpriced-model` → `pictures.unpriced_calls` 1.
7. `meter units and the ceiling are kept by UTC day, a day behind the India day, and a past ceiling is the one in force when that day ended`: `relay_budget_day` rows for UTC days today − 3 (1200 units) and today − 2; computing India day today − 2 writes `relay.units` for UTC day today − 3 = 1200; `admin.ceiling_on(today_utc - 3)` = 50000 with no audit row; after `admin.set_caps(60000, ...)` as `fresh(owner)` (an audit row now), `ceiling_on(today_utc - 3)` is still 50000 (the `from` of the later row) and `ceiling_on(today_utc)` = 60000.
8. `calls by outcome: answered, refused upstream, failed upstream, and no visible outcome, overall and per relay`: statuses 200, 429, 503, 0 on `llm` → dims `ok` 1, `client` 1, `server` 1, `none` 1, `llm:server` 1, `''` 4.
9. `the nightly job rolls up yesterday, refreshes the six days before, logs one run, and only the service role may call it`: `nightly(db)` → `{day: <yesterday>, rows: >0}`; `metric_run` has one row `nightly true`, `from_day` = today − 7, `to_day` = today − 1; `has_function_privilege('authenticated', 'admin.metric_nightly()', 'execute')` false; `service_role` true.
10. `the owner recomputes a range with a fresh code and a reason`: `rpc(db, fresh(owner), 'metric_recompute', {p_from: today-5, p_to: today-2, p_reason: 'prices loaded', p_env: 'TEST'})` → `{from, to, days: 4, rows}`; one audit row `metrics-recomputed`, `target_kind 'metrics'`, `details` exactly `{from, to, days, rows}`; `metric_run` row `nightly false`, `by_staff` = owner.
11. `recompute is refused to ops, a stale code, the wrong environment, a day not yet over, a range over 92 days, and without a reason`: ops (`fresh(ops)`) → `not allowed`; `aal2(owner)` → `confirm with your authenticator code first`; `p_env 'HOSTED'` → `this console is TEST, not HOSTED`; `p_to` = today → `pick up to 92 days, ending yesterday or earlier`; `p_from` = today − 100, `p_to` = today − 1 → the same; `p_from > p_to` → the same; `p_reason 'x'` → `say why, in a few words`.
12. `a recompute leaves a past day's snapshots as they were`: `metricDef(db, {key: 'test.snap', kind: 'snapshot'})`, `putMetric` day −3 value 9; recompute day −3 → the row is still there with value 9.
13. `the job runs at 18:50 UTC, which is 00:20 in India`: `cron.job` where `jobname = 'admin-metrics-nightly'` → `schedule '50 18 * * *'`, `command 'select admin.metric_nightly();'`.
14. `every registered family exists`: for each `admin.metric_family` row, `to_regprocedure(fn || '(date, boolean)')` is not null.

In `admin-invariants.test.ts`: add `'admin.metric_recompute'` between `'admin.me'` and `'admin.metric_series'`; add `'admin.metric_nightly'` to both service-role lists; add `['admin', 'metric_compute']`, `['admin', 'ceiling_on']`, `['admin', 'metric_family_tutor']`, `['admin', 'metric_family_spend']`, `['admin', 'metric_family_relay']`, `['admin', 'metric_family_calls']` to the internals loop.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run supabase/tests/admin-metrics-tutor.test.ts supabase/tests/admin-invariants.test.ts`
Expected: FAIL (`function admin.metric_compute(date, boolean) does not exist`).

- [ ] **Step 3: Append to the migration**

```sql
-- ---------------------------------------------------------------------------
-- Running the roll-ups.
-- ---------------------------------------------------------------------------

-- Rolls up one India day. Rows of that day that a recompute may rebuild are
-- deleted first (daily and window figures on the India day; daily UTC figures
-- on the day before, because the run for India day D writes UTC day D - 1:
-- ruling R4); snapshots are deleted and rewritten only by the nightly run
-- (R7). Cohorts are each family's own (the funnel's, 0073). Returns the rows
-- written.
create or replace function admin.metric_compute(p_day date, p_nightly boolean)
returns integer
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  f record;
  n integer;
  total integer := 0;
begin
  perform set_config('admin.session', 'on', true);
  delete from admin.metric_daily m using admin.metric_def d
   where d.key = m.metric
     and ((d.day_kind = 'india' and d.kind in ('daily', 'window') and m.day = p_day)
       or (d.day_kind = 'utc' and d.kind = 'daily' and m.day = p_day - 1)
       or (p_nightly and d.kind = 'snapshot' and m.day = p_day));
  for f in select x.fn from admin.metric_family x order by x.position loop
    execute format('select %s($1, $2)', f.fn) into n using p_day, p_nightly;
    total := total + coalesce(n, 0);
  end loop;
  return total;
end;
$$;

-- pg_cron, 18:50 UTC (00:20 in India): yesterday with its snapshots, then the
-- six days before without them (sittings close and devices sync late).
create or replace function admin.metric_nightly()
returns jsonb
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  yesterday date := lms.india_today() - 1;
  n integer := 0;
  d date;
begin
  perform pg_advisory_xact_lock(hashtext('admin.metric_daily'));
  n := admin.metric_compute(yesterday, true);
  for d in select generate_series(yesterday - 6, yesterday - 1, interval '1 day')::date loop
    n := n + admin.metric_compute(d, false);
  end loop;
  insert into admin.metric_run (from_day, to_day, nightly, rows) values (yesterday - 6, yesterday, true, n);
  return jsonb_build_object('day', yesterday, 'rows', n);
end;
$$;

select cron.schedule('admin-metrics-nightly', '50 18 * * *', $job$ select admin.metric_nightly(); $job$);
```

`admin.metric_recompute(p_from date, p_to date, p_reason text, p_env text) returns jsonb`, plpgsql volatile definer, `search_path = admin, lms, public`, rules in order: `me := admin.require_staff(array[]::text[])` (owner); `admin.require_fresh_mfa(10)`; `admin.check_environment(p_env)`; `admin.require_reason(p_reason)`; `p_from` or `p_to` null, `p_from > p_to`, `p_to >= lms.india_today()` or `p_to - p_from > 91` → `pick up to 92 days, ending yesterday or earlier`; `pg_advisory_xact_lock(hashtext('admin.metric_daily'))`; for each day from `p_from` to `p_to`, `rows += admin.metric_compute(day, false)`; insert `admin.metric_run (from_day, to_day, nightly, by_staff, rows)`; `admin.audit(me, 'metrics-recomputed', 'metrics', '', p_reason, jsonb_build_object('from', p_from, 'to', p_to, 'days', p_to - p_from + 1, 'rows', rows))`; return the same four keys. Revoke from `public, anon`; grant `authenticated`.

`admin.ceiling_on(p_utc_day date) returns integer`, `language sql stable security definer`, `search_path = admin, public` (ruling R5): the end of that UTC day is `(p_utc_day + 1)::timestamp at time zone 'UTC'`; the answer is, in order of preference, `(details ->> 'to')::int` of the latest `admin.audit_event` with `action in ('ceiling-set', 'ceiling-reverted')` and `at` before that end; else `(details ->> 'from')::int` of the earliest `ceiling-set` at or after it; else `relay_control.global_units_per_day` now.

The four families, each `(p_day date, p_nightly boolean) returns integer`, plpgsql volatile definer, `search_path = admin, lms, public`, `s := admin.ist_start(p_day)`, `e := admin.ist_start(p_day + 1)`, inserting with `admin.session` already on (set by the dispatcher) and returning `row_count` totals. Each family always writes the platform row with dim `''` (0 when nothing happened), and a per-school row for every `lms.school` when its metric's scope is `school`:

- `admin.metric_family_tutor`:

```sql
  with who as (
    select ls.user_id, ls.org_id from public.learning_session ls where ls.received_at >= s and ls.received_at < e
    union
    select le.user_id, le.org_id from public.ledger_event le where le.received_at >= s and le.received_at < e
  ), tagged as (
    select w.user_id, exists (select 1 from lms.school sc where sc.org_id = w.org_id) as at_school from who w
  )
  insert into admin.metric_daily (day, metric, dim, value)
  select p_day, 'tutor.learners', x.dim, x.n from (
    select '' as dim, count(distinct user_id) as n from tagged
    union all select 'school', count(distinct user_id) filter (where at_school) from tagged
    union all select 'direct', count(distinct user_id) filter (where not at_school) from tagged) x;
```

  then `tutor.minutes` = `coalesce(sum(active_ms), 0)` of sittings with `received_at` in the day, `ended_at is not null`, `active_ms > 0`; `tutor.classes` = sittings with `source = 'class'` received in the day; and the four `cost.*` rows exactly as `public.cost_per_student_hour` builds them (`0008:189-205`): `closed` = those sittings, joined `left join public.usage_cost u on u.session_id = c.id`, `cost.sitting_paise = round(coalesce(sum(u.inr), 0) * 100)`, `cost.active_ms = sum(c.active_ms)` over distinct sittings, `cost.sitting_calls = count(u.id)`, `cost.sitting_unpriced_calls = count(u.id) filter (where u.unpriced)`.
- `admin.metric_family_spend`: over `public.usage_cost u where u.at >= s and u.at < e`: `spend.paise` dim `''` = `round(coalesce(sum(inr), 0) * 100)`, and one row per non-empty group for `relay:` || relay, `model:` || `left(coalesce(model, 'none'), 190)`, `bucket:` || `coalesce(bucket, 'none')`, `who:school` / `who:direct` (by whether `u.org_id` is a school); `spend.calls`, `spend.unpriced_calls`; `spend.school_paise` and `spend.school_unpriced_calls` for every school (`left join` from `lms.school`, 0 when none); `prep.count` = `count(distinct prep_id) filter (where bucket = 'live' and prep_id is not null)`, `prep.paise` = their spend, `prep.unpriced_calls`; `pictures.count` = `coalesce(sum(images), 0)`, `pictures.paise` = `round(coalesce(sum(images * public.price_at(provider, model, 'image', at)), 0) * 100)` over rows with `images > 0`, `pictures.unpriced_calls` = rows with `images > 0` and that price null.
- `admin.metric_family_relay`: `x := p_day - 1` (the UTC day); `relay.units` = `coalesce((select b.units from public.relay_budget_day b where b.day = x), 0)`; `relay.ceiling` = `admin.ceiling_on(x)`; both on `day = x`.
- `admin.metric_family_calls`: over `public.usage_event` in the day; class = `case when status = 0 then 'none' when status between 200 and 399 then 'ok' when status between 400 and 499 then 'client' when status >= 500 then 'server' else 'other' end`; dims `''` (all), each class, and `relay || ':' || class`.

Register the four: `insert into admin.metric_family (name, position, fn) values ('tutor', 10, 'admin.metric_family_tutor'), ('spend', 20, 'admin.metric_family_spend'), ('relay', 30, 'admin.metric_family_relay'), ('calls', 40, 'admin.metric_family_calls') on conflict (name) do update set position = excluded.position, fn = excluded.fn;` and the catalogue rows of the table above. Grants: revoke every new function from `public, anon, authenticated, service_role`, except `metric_nightly` (revoke `public, anon, authenticated`; grant `service_role`) and `metric_recompute` (revoke `public, anon`; grant `authenticated`).

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run supabase/tests/admin-metrics-tutor.test.ts supabase/tests/admin-metrics-store.test.ts supabase/tests/admin-invariants.test.ts supabase/tests/admin-system.test.ts supabase/tests/admin-relay.test.ts`
Expected: PASS (14 new; `admin-system.test.ts`'s job list now also holds `admin-metrics-nightly`, and it asserts with `toContain`).

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/0071_admin_metrics.sql supabase/tests/metrics-fixtures.ts supabase/tests/admin-metrics-tutor.test.ts supabase/tests/admin-invariants.test.ts
Commit "feat: the nightly roll-up and the owner's recompute; learners, minutes, classes, spend, the meter and the ceiling, calls by outcome"
```

---

### Task 4: Money: collected, outstanding, webhooks, margin and renewals (0072)

**Files:** Create `supabase/migrations/0072_admin_metrics_money.sql`, `supabase/tests/admin-metrics-money.test.ts`; modify `supabase/tests/admin-invariants.test.ts`

Catalogue rows (platform, India days):

| key | pos | pages | label | unit | kind | total |
|---|---|---|---|---|---|---|
| `money.collected_paise` | 200 | money | Collected | paise | daily | sum |
| `money.outstanding_paise` | 210 | money | Outstanding at the day's end | paise | daily | last |
| `money.overdue_paise` | 220 | money | Overdue at the day's end | paise | daily | last |
| `webhook.events` | 520 | reliability | Payment notifications by result | count | daily | sum |

**Interfaces:** `admin.metric_family_money`, `admin.metric_family_webhooks` (internal); `admin.money_view(p_days integer) returns jsonb`:

```ts
{ from: string; to: string; days: 7 | 30;
  margin: { code: string; name: string; feePaise: number; costPaise: number; costIsFloor: boolean;
            marginPaise: number; noFee: boolean; daysRolledUp: number }[];   // every school, by code
  directCostPaise: number;                // spend of children who came on their own (who:direct), same window
  renewals: { weekStart: string; schools: number; paiseAtCurrentPrice: number }[] }   // 13 weeks from this week
```

- [ ] **Step 1: Write the failing tests** (`beforeAll`: fresh database, environment, owner, ops, safety, `makeFinance`; `readySeller`, `readyPlan(db, owner, 'standard', 12, 50_000)`; `billedSchool(db, owner, 'MNY')`; `subscribe(db, owner, org, 'standard', 100, <today − 30>)`)
1. `collected is the counted payments received that India day, less any reversed`: record an offline payment received yesterday through `admin.billing_payment_record` as `fresh(owner)`; a second payment recorded and then reversed (`admin.billing_payment_reverse`) → yesterday's `money.collected_paise` = the first payment only.
2. `outstanding and overdue at a day's end: issued by then, not void by then, less counted payments received by then`: the invoice issued today − 30 with due 15 days later: for day today − 20, `money.outstanding_paise` = `total_paise` and overdue 0; for yesterday, after a part payment received today − 5, outstanding = total − part and overdue = the same (due date passed); a voided invoice (`admin.billing_invoice_void`) adds nothing on days after it was voided.
3. `payment notifications by result, counted by the day they arrived`: three `billing.webhook_event` rows inserted with `admin.session` on (statuses `processed`, `processed`, `signature_failed`) received yesterday → `webhook.events` dims `processed` 2, `signature_failed` 1, `''` 3.
4. `margin: the invoiced fee spread over its subscription's days, against the school's AI spend in the window, a floor when any call was unpriced`: put `spend.school_paise` rows of 1000 a day for MNY on the 7 days ending yesterday and one `spend.school_unpriced_calls` row of 1 → `money_view(7).margin` MNY: `feePaise` = `floor(taxable_paise * 7 / (ends_on - starts_on + 1))`, `costPaise` 7000, `costIsFloor` true, `marginPaise` = fee − 7000, `noFee` false, `daysRolledUp` 7.
5. `a school with no subscription, a void invoice or a cancelled subscription earns no fee in the window`: `buildSchool(db, 'PIL')` with a pilot licence → `noFee` true, `feePaise` 0.
6. `renewals ahead: thirteen weeks, non-pilot licences ending in each, valued at the latest subscription's seats times its seat price`: set MNY's licence with `lms.set_licence('MNY', 'standard', 100, <a day in the third week>)` as the service role → that week's `schools` 1 and `paiseAtCurrentPrice` 100 × 50 000; PIL's pilot licence is not counted; the list has 13 weeks, the first starting on this week's Monday (`date_trunc('week', ...)`).
7. `money_view is for the owner, ops and finance; safety and a child are refused; days are 7 or 30`.
8. `the Money page lists collected, outstanding and overdue; finance reads it`: `metric_series('money', 7)` as `aal2(finance)` holds `money.collected_paise`, `money.outstanding_paise`, `money.overdue_paise`, `spend.paise`, `spend.school_paise`, `prep.paise`.

Add `'admin.money_view'` after `'admin.metric_series'` in the `authenticated` list, and `metric_family_money`, `metric_family_webhooks` to the internals loop.

- [ ] **Step 2: Run** `npx vitest run supabase/tests/admin-metrics-money.test.ts supabase/tests/admin-invariants.test.ts` → FAIL (`function admin.money_view(integer) does not exist`; no `money.collected_paise` row).

- [ ] **Step 3: Write the migration.** Header: what each figure counts and that recomputing an old day counts the payments, reversals and voids as they stand now (R8). The families:
- `admin.metric_family_money`: `money.collected_paise` = `coalesce(sum(p.amount_paise), 0)` from `billing.payment p where p.counted and p.reversed_at is null and p.received_on = p_day`; outstanding and overdue:

```sql
  select coalesce(sum(greatest(i.total_paise - coalesce(pd.paid, 0), 0)), 0),
         coalesce(sum(greatest(i.total_paise - coalesce(pd.paid, 0), 0)) filter (where i.due_on < p_day), 0)
    into outstanding, overdue
    from billing.invoice i
    left join lateral (
      select sum(p.amount_paise) as paid from billing.payment p
       where p.invoice_id = i.id and p.counted and p.reversed_at is null and p.received_on <= p_day
    ) pd on true
   where i.issued_on <= p_day and (i.voided_at is null or i.voided_at >= e);
```

- `admin.metric_family_webhooks`: `webhook.events` dim `''` = count of `billing.webhook_event` with `received_at` in the day, and one row per `status`.
- `admin.money_view(p_days)`: `me := admin.require_staff(array['ops', 'finance'])`; days 7 or 30 (`days is 7 or 30`); `t := lms.india_today() - 1`, `f := t - p_days + 1`. Per `lms.school`: fee = `coalesce(sum(i.taxable_paise * overlap / span), 0)` (integer division) over `billing.subscription sub join billing.invoice i on i.subscription_id = sub.id` where `i.status <> 'void'` and `sub.cancelled_at is null`, `span = sub.ends_on - sub.starts_on + 1`, `overlap = greatest(0, least(sub.ends_on, t) - greatest(sub.starts_on, f) + 1)`; cost = sum of `spend.school_paise` rows of that school in `[f, t]`; floor = any `spend.school_unpriced_calls` row of that school in the window with value > 0; `daysRolledUp` = distinct days with a `spend.school_paise` row; `noFee` = fee = 0. `directCostPaise` = sum of `spend.paise` rows with dim `who:direct` in the window. Renewals: for `g` in 0 to 12, `w := date_trunc('week', lms.india_today()::timestamp)::date + 7 * g`; schools = licences with `plan <> 'pilot'` and `valid_until between w and w + 6`; value = sum over those schools of the latest subscription's (`order by sub.ends_on desc limit 1`) `seats * seat_price_paise`. Register both families (positions 50, 60). Revoke `money_view` from `public, anon`; grant `authenticated`; internals revoked from all four roles.

- [ ] **Step 4: Run** the Step 2 command plus `supabase/tests/billing-invariants.test.ts supabase/tests/admin-metrics-tutor.test.ts` → PASS (8 new).
- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/0072_admin_metrics_money.sql supabase/tests/admin-metrics-money.test.ts supabase/tests/admin-invariants.test.ts
Commit "feat: money over time (collected, outstanding, overdue), payment notifications by result, margin per school and renewals ahead"
```

---

### Task 5: Schools over time and sign-ins (0073)

**Files:** Create `supabase/migrations/0073_admin_metrics_schools_learning.sql`, `supabase/tests/admin-metrics-schools.test.ts`; modify `supabase/tests/metrics-fixtures.ts` (`addSignInColumn(db)`: `alter table auth.users add column if not exists last_sign_in_at timestamptz`, the hosted column's stand-in), `supabase/tests/admin-invariants.test.ts`

Catalogue rows (all `scope 'school'`, `pages {schools}`):

| key | pos | label | unit | kind | child figure (group) | total |
|---|---|---|---|---|---|---|
| `school.health` | 300 | Health | count (dim = level, value 1) | snapshot | no | none |
| `school.students` | 310 | Students | count | snapshot | no | last |
| `school.seats_used` | 320 | Seats used | count | snapshot | no | last |
| `school.seats_bought` | 321 | Seats bought | count | snapshot | no | last |
| `school.activated` | 330 | Students who have done anything | count | snapshot | yes (the school's students) | last |
| `school.handed_in_7d` | 340 | Students who handed in work in 7 days | count | window | yes (the school's students) | last |
| `school.homework_published` | 350 | Homework published | count | daily | no | sum |
| `school.active` | 360 | Any activity (0 or 1) | count | daily | no | none |
| `school.signins` | 370 | Students who signed in | count | snapshot | yes (the school's students) | none |

`school.signins` has `why` = `This database does not record when people sign in (auth.users has no last_sign_in_at).`

- [ ] **Step 1: Write the failing tests** (`beforeAll`: fresh database, environment, owner, ops, safety; `buildSchool(db, 'BIG')` + `addStudents(db, big, 'BIG', 10)` (12 students), `ageStudents(db, big.org, 30)`; `buildSchool(db, 'SML')` (2 students); `setLicence(db, 'BIG', 20, 60)`)
1. `the nightly run records each school's health level once`: after `nightly(db)`, yesterday's `school.health` rows: one per school, value 1, dim = `admin.school_health_for(org) ->> 'level'` at run time.
2. `students, seats used and seats bought are snapshots of the run`: BIG `school.students` 12, `school.seats_used` = `lms.seats_used(big.org)`, `school.seats_bought` 20; SML has no `seats_bought` row (no licence).
3. `activation and hand-ins follow the health card's definitions, and a school with fewer than 10 students reads suppressed`: 6 BIG students hand in yesterday (`publish`, `handIn`), so `school.activated` = 6 and `school.handed_in_7d` = 6 with `children` 12; SML 1 hand-in; `metric_series('schools', 7)` as owner: BIG's points show 6, SML's `value null, suppressed true`.
4. `homework published and any activity are counted per school per day, and recomputed`: a homework published on day −2 at BIG → `school.homework_published` 1 and `school.active` 1 for day −2 after `admin.metric_compute(today − 2, false)`; SML `school.active` 0.
5. `snapshots are not written by a recompute`: `rpc(... 'metric_recompute' ...)` for day −3 writes no `school.health` row for day −3.
6. `sign-ins are not captured where the database has no sign-in time, and say why`: `metric_series('schools', 7)`'s `school.signins` has `captured false`, the why above, `points []`.
7. `with a sign-in time, the run counts each school's students whose last sign-in fell yesterday`: `addSignInColumn(db)`; set `last_sign_in_at` to `atIst(1, '08:00')` for 11 BIG students and 1 SML student, to today for one more; `nightly(db)` → BIG yesterday 11 (`children` 12, shown), SML 1 (suppressed); the series has `captured true`.
8. `the one-school view reads only that school`: `metric_series('schools', 30, 'BIG')` points all have `school: 'BIG'`.
9. `the Schools page is read by the owner and ops, not by safety` (`not allowed` for `aal2(safety)`; ops resolves).

- [ ] **Step 2: Run** `npx vitest run supabase/tests/admin-metrics-schools.test.ts` → FAIL (no `school.health` rows).
- [ ] **Step 3: Write the migration.** Header: the figures, that activation, hand-ins and last activity follow `admin.school_health_for`'s definitions (cite `0052:186-196, 221-230, 266-273`), that per-school figures about children are suppressed under 10 students at read (R2, R3), and that sign-ins are read from `auth.users.last_sign_in_at` only where the column exists (R14). `admin.metric_family_schools(p_day, p_nightly)`, for each `lms.school sc`:
  - when `p_nightly`: `h := admin.school_health_for(sc.org_id)`; `school.health` dim `h ->> 'level'` value 1; `students := count(*) from lms.account a where a.org_id = sc.org_id and a.kind = 'student' and a.left_at is null`; `school.students`; `school.seats_used = lms.seats_used(sc.org_id)`; `school.seats_bought = l.seats` when a licence exists; `school.activated` (the `0052:192-196` query) with `children = students`; and, when `admin.signins_readable()`, `execute` the count of that school's active student accounts joined to `auth.users u` with `u.last_sign_in_at >= s and u.last_sign_in_at < e` into `school.signins` with `children = students`;
  - always: `school.homework_published` = `lms.assignment` with `published_at` in the day; `school.active` = 1 when any of `lms.attendance.marked_at`, `lms.submission.submitted_at`, `lms.assignment.published_at`, `public.ledger_event.received_at` (this school's `org_id`) falls in the day, else 0; `school.handed_in_7d` = `count(distinct s.student_user_id)` from `lms.submission s join lms.account a on a.user_id = s.student_user_id and a.left_at is null` where `s.org_id = sc.org_id and s.submitted_at >= e - interval '7 days' and s.submitted_at < e`, `children` = the school's active students now.
  Register `('schools', 70, 'admin.metric_family_schools')`.
- [ ] **Step 4: Run** `npx vitest run supabase/tests/admin-metrics-schools.test.ts supabase/tests/admin-school-health.test.ts supabase/tests/admin-invariants.test.ts` → PASS (9 new). Add `['admin', 'metric_family_schools']` to the internals loop first.
- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/0073_admin_metrics_schools_learning.sql supabase/tests/metrics-fixtures.ts supabase/tests/admin-metrics-schools.test.ts supabase/tests/admin-invariants.test.ts
Commit "feat: schools over time (health, seats, activation, hand-ins, activity) and sign-ins per school where the database records them"
```

---

### Task 6: Learning and the contest funnel (0073, appended)

**Files:** Modify `supabase/migrations/0073_admin_metrics_schools_learning.sql` (append), `supabase/tests/admin-invariants.test.ts`; create `supabase/tests/admin-metrics-learning.test.ts`

Catalogue rows:

| key | pos | pages | label | unit | kind | scope | child figure (group) | total | dim |
|---|---|---|---|---|---|---|---|---|---|
| `learn.outcomes_covered_30d` | 400 | learning | Outcomes answered in 30 days | count | window | both | yes (children who answered) | none | `<grade>\|<subject>` |
| `learn.outcomes_total` | 401 | learning | Outcomes in the syllabus map | count | daily | platform | no | none | `<grade>\|<subject>` |
| `learn.misconceptions_30d` | 410 | learning | Answers showing a misconception, 30 days | count | window | platform | yes (children who chose it) | none | `<grade>\|<subject>\|<label>` |
| `learn.practice_answers` | 420 | learning | Practice answers | count | daily | both | yes (children who practised) | none | `''` |
| `funnel.entries` | 450 | funnel | Contest entries | count | daily | platform | no | sum | `''` |
| `funnel.cohort` | 451 | funnel | Entrants | count | cohort | platform | yes (entrants) | sum | `''` |
| `funnel.verified` | 452 | funnel | A parent verified | count | cohort | platform | yes (entrants) | sum | `''` |
| `funnel.first_class` | 453 | funnel | Had a first class | count | cohort | platform | yes (entrants) | sum | `''` |
| `funnel.second_day` | 454 | funnel | Came back on a second day | count | cohort | platform | yes (entrants) | sum | `''` |

- [ ] **Step 1: Write the failing tests** (`beforeAll`: fresh database, environment, owner, ops; `buildSchool(db, 'LRN')` + `addStudents(db, lrn, 'LRN', 10)` (12 students); `lms.outcome` rows `o1, o2, o3` for grade 8 Mathematics; a library item `i1` (`library_ref 'lib-1'`, outcome `o1`, options 4, correct 0, misconceptions `['', 'adds denominators', '', '']`); a school item `i2` (org LRN, outcome `o2`, misconceptions `['', 'a teacher''s own label', '', '']`))
1. `outcomes answered in 30 days, by class and subject, with the children who answered`: 10 children answer `o1` (ledger `answered` events with `outcome_ids '{o1}'`, received yesterday), one answers `o2` → yesterday's platform row `8|Mathematics` value 2, and `learn.outcomes_total` `8|Mathematics` = 3; LRN's row the same.
2. `nine children are suppressed and ten are shown, at the platform and in one school`: with only 9 children answering, `metric_series('learning', 7)` returns `value null, suppressed true`; with 10, the value; `metric_series('learning', 7, 'LRN')` the same.
3. `misconceptions come from wrong options of library questions only`: 10 children submit homework MCQ answers (`lms.submission` + `lms.submission_answer`, `chosen_index 1`) on `i1` and on `i2` → one row `8|Mathematics|adds denominators` value 10; no row carries `a teacher's own label`.
4. `a practice answer counts on the day the server received it`: `lms.check_practice_answer`-shaped events (`kind 'answered', source 'practice'`) from 10 children yesterday → `learn.practice_answers` 10 at the platform and for LRN.
5. `contest entries by India day`: three `contest_signup` rows (`created_at` yesterday) → `funnel.entries` 3.
6. `a cohort counts entrants who had a parent verified, a first class, and a second day`: 10 entrants yesterday, 4 with a `consent_record`, 3 with a `class` sitting, 2 of them with sittings on two India days → `funnel.cohort` 10, `funnel.verified` 4, `funnel.first_class` 3, `funnel.second_day` 2 (all `children` 10).
7. `the funnel is read as totals only, and a total under 10 entrants is suppressed`: `metric_series('funnel', 7)`'s cohort metrics have `points []`; totals shown for 10 entrants; with a fresh database and 4 entrants, totals `{value: null, suppressed: true}`; `funnel.entries` keeps its daily points.
8. `the nightly run refreshes the last 30 cohorts`: an entrant from day −20 has a first class today − 1; after `nightly(db)`, day −20's `funnel.first_class` rose by one.

- [ ] **Step 2: Run** `npx vitest run supabase/tests/admin-metrics-learning.test.ts` → FAIL (no `learn.*` rows).
- [ ] **Step 3: Append.**
  - `admin.metric_family_learning(p_day, p_nightly)`: `w := e - interval '30 days'`. `answers` = (a) `public.ledger_event le` with `kind = 'answered'` and `received_at in [w, e)`, each `unnest(le.outcome_ids)` with `le.user_id`, `le.org_id`; (b) `lms.submission s join lms.submission_answer sa ... join lms.item i on i.id = sa.item_id` with `s.submitted_at in [w, e)`, each `unnest(i.outcome_ids)` with `s.student_user_id`, `s.org_id`. Join `lms.outcome o on o.id = outcome` for `grade`, `subject`. Platform rows: `count(distinct o.id)` and `children = count(distinct user)` per `grade|subject`; per-school rows the same grouped by school (`org_id` in `lms.school`). `learn.outcomes_total` = `count(*) from lms.outcome group by grade, subject`. Misconceptions (platform): wrong answers on library items (`i.org_id is null`) from (b) (`sa.chosen_index <> i.correct_index`) and from (a) practice events (`(payload ->> 'itemId')::uuid`, `(payload ->> 'chosenIndex')::int`), label `nullif(btrim(i.misconceptions ->> chosen), '')` when `jsonb_typeof(i.misconceptions) = 'array'` (as `0040:548-553` and `0031:608`), grouped by `grade|subject|left(label, 120)`, `value = count(*)`, `children = count(distinct user)`. Practice: `ledger_event` `kind 'answered'`, `source 'practice'`, received in the day; platform and per school; `children = count(distinct user_id)`.
  - `admin.metric_family_funnel(p_day, p_nightly)`: `funnel.entries` = `contest_signup` with `created_at` in the day. Cohort days: `p_day` alone, or `p_day - 29` to `p_day` when `p_nightly`; for each cohort day `c` it deletes its own `funnel.cohort|verified|first_class|second_day` rows of day `c` and writes: entrants `n` = signups created in `c` (children `n`); verified = entrants with any `consent_record`; first class = entrants with a `learning_session` of source `class`; second day = entrants whose sittings span at least two distinct `(received_at at time zone 'Asia/Kolkata')::date`. Every cohort row has `children = n`.
  Register `('learning', 80, ...)`, `('funnel', 90, ...)`.
- [ ] **Step 4: Run** `npx vitest run supabase/tests/admin-metrics-learning.test.ts supabase/tests/admin-metrics-store.test.ts supabase/tests/admin-invariants.test.ts` → PASS (8 new). Add both families to the internals loop first.
- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/0073_admin_metrics_schools_learning.sql supabase/tests/admin-metrics-learning.test.ts supabase/tests/admin-invariants.test.ts
Commit "feat: learning in aggregate (outcomes answered, library misconceptions, practice) and the contest funnel as cohort totals, small groups hidden"
```

---

### Task 7: Content and safety over time (0074)

**Files:** Create `supabase/migrations/0074_admin_metrics_content_safety.sql`, `supabase/tests/admin-metrics-content-safety.test.ts`; modify `supabase/tests/admin-invariants.test.ts`

Catalogue rows (platform):

| key | pos | pages | label | unit | kind | total | dim |
|---|---|---|---|---|---|---|---|
| `content.classes` | 140 | content | Classes by status | count | snapshot | none | `pending`, `published`, `retracted`, `removed` |
| `content.bank` | 150 | content | Question bank | count | snapshot | none | `library`, `school_approved`, `school_waiting`, `drafts` |
| `reports.new` | 60 | overview, safety | New reports | count | daily | sum | `''`, `wrong`, `rude`, `unsafe`, `other` |
| `reports.open` | 61 | overview, safety | Open reports at the day's end | count | daily | last | `''`, `new`, `seen`, `triaged` |
| `reports.looked` | 62 | safety | Reports looked at, by the day they arrived | count | daily | sum | `''` |
| `reports.first_look_median` | 63 | safety | Median minutes to the first look | minutes | daily | none | `''` |
| `safety.flags` | 70 | safety | Distress flags | count | daily | sum | `''`, `from-student`, `to-student` |

`safety.flags` has `since_setting 'distress_capture_since'` and `why` = `Distress flags are not captured yet: none has arrived and the day capture went live is not recorded.`

**Interfaces:** `admin.content_view() returns jsonb` (owner, ops): `{classes: {pending, published, retracted, removed}, bank: {library, schoolApproved, schoolWaiting, drafts}, mostReported: [{id, title, topicRef, reports: {total, open, unsafe}}] (10, most reports first, only classes with at least one), mostCost: [{id, title, topicRef, cost: {inr, liveInr, warmInr, unpriced, calls, sittings}}] (10, highest inr first, only classes with calls)}`.

- [ ] **Step 1: Write the failing tests** (`beforeAll`: fresh database, environment, owner, ops, safety; `buildSchool(db, 'CNT')`; plan 5's `classRow` for three classes (one pending, two published), one removed through `admin.class_review` rows; `lms.item` rows: two library, one school item approved (`lms.item_approval`), one not; one `lms.item_draft`)
1. `classes by status and the question bank are snapshots of the nightly run`: after `nightly(db)`, yesterday's `content.classes` = pending 1, published 2, retracted 0, removed 1; `content.bank` = library 2, school_approved 1, school_waiting 1, drafts 1.
2. `new reports by kind, by the day they arrived`: `fileReport` twice yesterday (`wrong`, `unsafe`) → `''` 2, `wrong` 1, `unsafe` 1.
3. `open reports at a day's end are rebuilt from when each was looked at, triaged and closed`: a report received day −3, `seen_at` day −2, `actioned_at` day −1 and still open; computing day −3 → `new` 1; day −2 → `seen` 1; day −1 → `triaged` 1; a report with `status 'closed'` and no `closed_at` counts on no day.
4. `the first look: reports looked at and the median minutes, by the day they arrived`: two reports received yesterday, seen after 10 and 30 minutes → `reports.looked` 2, `reports.first_look_median` 20; a day where no report was looked at has no median row.
5. `distress flags are counted only from the day capture went live, and read not captured before`: with no flag and no setting, `metric_series('safety', 7)`'s `safety.flags` is `captured false` with its why; after `keepFlag` (which records `distress_capture_since` = today) and a flag kept with `received_at` set to yesterday, computing yesterday writes no row (before capture) and `capturedSince` is today; recording capture as live from today − 5 (`admin.safety_capture_set` as `fresh(owner)`) and recomputing yesterday writes `''` 1 and its direction.
6. `content_view lists the most reported and the costliest classes with counts only`: two reports on one class (`lesson_id` = its id) → `mostReported[0]` that class with `reports.total` 2; the JSON contains no `note`.
7. `the Safety page is the owner's and safety's; content_view is the owner's and ops'`: `metric_series('safety', 7)` as ops → `not allowed`; `content_view()` as safety and finance → `not allowed`.

Add `'admin.content_view'` between `'admin.classes'` and `'admin.contest_purge_set'` in the `authenticated` list, and `metric_family_content`, `metric_family_safety` to the internals loop.

- [ ] **Step 2: Run** `npx vitest run supabase/tests/admin-metrics-content-safety.test.ts supabase/tests/admin-invariants.test.ts` → FAIL (no `content_view`).
- [ ] **Step 3: Write the migration.**
  - `admin.metric_family_content(p_day, p_nightly)`: only when `p_nightly`. `content.classes`: `count(*)` of `public.prepared_class` per `review_status` (each of the three written, 0 included), and `removed` = `count(distinct cr.class_id)` from `admin.class_review cr` with `action in ('retracted', 'rejected')` and no `prepared_class` row of that id. `content.bank`: `library` = `lms.item` with `org_id is null`; `school_approved` / `school_waiting` = school items with / without an `lms.item_approval` row for their own `org_id`; `drafts` = `count(*)` of `lms.item_draft`.
  - `admin.metric_family_safety(p_day, p_nightly)`: `reports.new` by `received_at` in the day, `''` and per kind. `reports.open`: reports with `received_at < e`, excluding `status = 'closed' and (closed_at is null or closed_at < e)`; state at `e` = `triaged` when `actioned_at < e`, else `seen` when `seen_at < e`, else `new` (ruling R20); `''` and per state. `reports.looked` = reports received in the day with `seen_at is not null`; `reports.first_look_median` = `floor(percentile_cont(0.5) within group (order by extract(epoch from seen_at - received_at) / 60))` over them, written only when there is at least one. `safety.flags`: `since := (select (value #>> '{}')::date from admin.setting where key = 'distress_capture_since')`; when `since` is not null and `p_day >= since`, count `admin.safety_event` with `received_at` in the day, `''` and per `direction`.
  - `admin.content_view()`: `me := admin.require_staff(array['ops'])`; the two snapshots computed live as above; `mostReported` and `mostCost` from `public.prepared_class p` with `admin.class_reports(p.id, p.topic_ref)` and `admin.class_cost_for(p.topic_ref)` (plan 5's internals, `0068:56-91`).
  Register `('content', 100, ...)`, `('safety', 110, ...)`; grants as before.
- [ ] **Step 4: Run** the Step 2 command plus `supabase/tests/admin-safety-cases.test.ts supabase/tests/admin-classes.test.ts` → PASS (7 new).
- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/0074_admin_metrics_content_safety.sql supabase/tests/admin-metrics-content-safety.test.ts supabase/tests/admin-invariants.test.ts
Commit "feat: classes and question banks over time, reports by kind and status, time to the first look, distress flags from the day capture went live"
```

---

### Task 8: Never a child: the sweep, and the final lists

**Files:** Create `supabase/tests/admin-metrics-privacy.test.ts`; modify `supabase/tests/admin-invariants.test.ts` (confirm the final lists below)

- [ ] **Step 1: Write the tests** (`beforeAll`: fresh database, environment, owner; `addSignInColumn(db)`; `buildSchool(db, 'SWP')` + `addStudents(db, swp, 'SWP', 10)` with display names `Zzmarker Child <n>`; for every child: a sitting, an answer, a usage row, a homework hand-in, a practice answer, a report with note `zzsecretnote`, a contest entry (`student_name 'Zzmarker Entrant'`, phone `+919999999999`, address `zz house`), a consent record (`parent_name 'Zzmarker Parent'`), a sign-in time; a distress flag; then `nightly(db)` and `metric_recompute` for the 30 days ending yesterday)
1. `no read returns a child's id, login ID, name, words, phone or address`: `JSON.stringify` of `metric_series` for every page with 7 and 30 days, `metric_series('schools'|'learning', 30, 'SWP')`, `money_view(30)` and `content_view()` contains none of: any child's `user_id`, any `SWP-` login ID, `Zzmarker`, `zzsecretnote`, `9999999999`, `zz house`.
2. `the store holds no person's id`: no `admin.metric_daily.dim` matches a uuid pattern; every `org_id` is an `lms.school.org_id`; every dim matches `^$|^(school|direct|ok|client|server|none|other|green|amber|red|grey|new|seen|triaged|wrong|rude|unsafe|from-student|to-student|pending|published|retracted|removed|library|school_approved|school_waiting|drafts|processed|ignored|mismatch|unparsed|stored|signature_failed)$|^(relay|model|bucket|who):|^[a-z]+:(ok|client|server|none|other)$|^[0-9]{1,2}\|`.
3. `every child figure is marked as one`: the catalogue's `child_figure` keys are exactly `school.activated, school.handed_in_7d, school.signins, learn.outcomes_covered_30d, learn.misconceptions_30d, learn.practice_answers, funnel.cohort, funnel.verified, funnel.first_class, funnel.second_day`.
4. `every figure that can be not captured has a reason`: every row with `captured = false`, `since_setting` set, or key `school.signins` has a `why`.
5. `the browser can call exactly four new functions`: the final `authenticated` list (below) and the internals (every `admin.metric_family_*`, `metric_compute`, `metric_json`, `ceiling_on`, `ist_start`, `chart_roles`, `signins_readable`) not executable by `authenticated` or `anon`.

The final additions to `admin-invariants.test.ts`'s `authenticated` list (C collation): `'admin.content_view'` after `'admin.classes'`; `'admin.metric_recompute'`, `'admin.metric_series'`, `'admin.money_view'` after `'admin.me'` and before `'admin.read_log_list'`. Service role: `'admin.metric_nightly'`.

- [ ] **Step 2: Run** `npx vitest run supabase/tests/admin-metrics-privacy.test.ts supabase/tests/admin-invariants.test.ts`. Expected: PASS. If a test fails, the failure is a real leak or a missing mark: fix the migration it points at (0071 to 0074, all unmerged), never the assertion.
- [ ] **Step 3: Commit**

```powershell
git add supabase/tests/admin-metrics-privacy.test.ts supabase/tests/admin-invariants.test.ts
Commit "test: no chart read carries a child's id, name, words, phone or address; every child figure and every gap is marked"
```

---

### Task 9: The typed client

**Files:** Create `packages/admin-client/src/charts.ts`, `packages/admin-client/tests/charts.test.ts`; modify `packages/admin-client/src/index.ts` (one `export * from './charts.ts';`)

```ts
// charts.ts
import type { ClassCost, ClassReports } from './classes.ts';
import type { Write } from './schools.ts';
import type { AdminTransport } from './transport.ts';

export type ChartPage = 'overview' | 'money' | 'schools' | 'learning' | 'content' | 'reliability' | 'funnel' | 'safety';
export type ChartDays = 7 | 30;
export type MetricUnit = 'count' | 'paise' | 'ms' | 'minutes' | 'units';
export interface MetricPoint { day: string; dim: string; school: string | null; value: number | null; suppressed: boolean }
export interface Metric {
  key: string; label: string; unit: MetricUnit; dayKind: 'india' | 'utc';
  kind: 'daily' | 'window' | 'snapshot' | 'cohort';
  captured: boolean; why: string | null; capturedSince: string | null;
  from: string; to: string;
  total: { value: number | null; suppressed: boolean } | null;
  points: MetricPoint[];
}
export interface ChartSeries {
  page: ChartPage; days: ChartDays; from: string; to: string;
  school: { code: string; name: string } | null;
  lastRun: { through: string; finishedAt: string; nightly: boolean } | null;
  metrics: Metric[];
}
export interface MarginRow { code: string; name: string; feePaise: number; costPaise: number; costIsFloor: boolean; marginPaise: number; noFee: boolean; daysRolledUp: number }
export interface RenewalWeek { weekStart: string; schools: number; paiseAtCurrentPrice: number }
export interface MoneyView { from: string; to: string; days: ChartDays; margin: MarginRow[]; directCostPaise: number; renewals: RenewalWeek[] }
export interface ContentClassRow { id: string; title: string; topicRef: string }
export interface ContentView {
  classes: Record<'pending' | 'published' | 'retracted' | 'removed', number>;
  bank: { library: number; schoolApproved: number; schoolWaiting: number; drafts: number };
  mostReported: (ContentClassRow & { reports: ClassReports })[];
  mostCost: (ContentClassRow & { cost: ClassCost })[];
}
export interface RecomputeResult { from: string; to: string; days: number; rows: number }
export interface ChartsClient {
  series(page: ChartPage, days: ChartDays, school?: string): Promise<ChartSeries>;
  money(days: ChartDays): Promise<MoneyView>;
  content(): Promise<ContentView>;
  recompute(i: { from: string; to: string } & Write): Promise<RecomputeResult>;
}
export function createChartsClient(t: AdminTransport): ChartsClient;
```

Every call goes through `guard` (`read.ts`); `day()` for every date (PGlite sends `T00:00:00.000Z`, PostgREST a bare date), `num()` / `numOrNull()` for every number (PostgREST may send a bigint as text).

- [ ] **Step 1: Write the failing tests** (end to end on PGlite through `pgliteAdminTransport`, as `users-staff-system.test.ts:1-50` does; seed with the Task 3 fixtures and `nightly`)
1. `series comes back typed: dates as YYYY-MM-DD, numbers as numbers, suppressed points as null`.
2. `a refusal is a typed AdminError: ops reading Safety is not-allowed; a stale owner recomputing is needs-mfa`.
3. `money and content views come back typed`.
4. `recompute sends the environment and the reason and returns the counts`.
- [ ] **Step 2: Run** `npx vitest run packages/admin-client/tests/charts.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run packages/admin-client` → PASS. `npm run typecheck` → no errors (`git grep -n "ChartPage\|MetricPoint" packages/admin-client/src` shows only `charts.ts`).
- [ ] **Step 5: Commit**

```powershell
git add packages/admin-client/src/charts.ts packages/admin-client/src/index.ts packages/admin-client/tests/charts.test.ts
Commit "feat: a typed client for the chart pages, the money and content views and the recompute"
```

---

### Task 10: Recharts, the copied chart pieces, the pure helpers, the nav

**Files:**
- Modify: `apps/admin/package.json` (`"recharts": "^3.8.1"` in `dependencies`, the teacher app's range), `package-lock.json` (by `npm install --no-audit --no-fund`), `apps/admin/src/lib/nav.ts`, `apps/admin/src/components/layout/data/sidebar-data.ts`, `apps/admin/src/components/command-menu.tsx`, `apps/admin/tests/nav.test.ts`
- Create: `apps/admin/src/components/charts/chart-card.tsx`, `apps/admin/src/components/charts/kpi.tsx`, `apps/admin/src/components/charts/series-chart.tsx`, `apps/admin/src/components/charts/not-captured.tsx`, `apps/admin/src/features/charts/model.ts`, `apps/admin/tests/charts-model.test.ts`

**The copied pieces.** `chart-card.tsx` is `ChartCard`, `axis` and `tooltipStyle` from `apps/lms/src/features/analytics/charts.tsx:125-160`, unchanged but for imports (`@/components/ui/card` exists in `apps/admin`). `kpi.tsx` is `Kpi` from `:74-123` with `KPI_HUE` and `hueFor` (which `apps/admin` does not have) replaced by an optional `colour` prop (default `var(--primary)`). Each file's header names its source file and says it is copied, not imported, so a change to the teacher app never changes the console. `series-chart.tsx` (new): `SeriesChart({ points, kind: 'line' | 'bar' | 'stacked', series: {key, label, colour}[], unit, reference?: {value, label} })` on `ResponsiveContainer`; days whose state is not `value` are drawn as grey `ReferenceArea` bands (`fill: var(--muted)`) and listed under the chart ("No figure: <days>", "Fewer than 10 children: <days>", "Not captured: <days>"). `not-captured.tsx`: a grey card with the metric's label, "Not captured", and its `why`.

```ts
// features/charts/model.ts (pure; tested)
import type { ChartDays, ChartPage, Me, Metric } from '@ai-tutor/admin-client';
export const CHART_PAGES: { page: ChartPage; title: string; url: string; roles: Me['role'][] }[];
//   overview 'Overview' ['owner','ops']; money 'Money' ['owner','ops','finance']; schools, learning, content,
//   reliability, funnel ['owner','ops']; safety 'Safety' ['owner','safety']  (admin.chart_roles, ruling R9)
export const SUPPRESSED_TEXT = 'Fewer than 10 children: not shown.';
export const NO_FIGURE_TEXT = 'No figure for this day yet.';
export const NOT_CAPTURED_TEXT = 'Not captured';
export const TARGET_PAISE_PER_HOUR = 500;            // the Rs 5 per student-hour ceiling (apps/classroom/src/lib/liveClass.ts:440)
export type DayState = 'value' | 'suppressed' | 'no-figure' | 'not-captured';
export interface DayPoint { day: string; value: number | null; state: DayState }
export function daysBetween(from: string, to: string): string[];
export function seriesFor(m: Metric, o?: { dim?: string; school?: string | null }): DayPoint[];
//   not captured: every day 'not-captured'; before capturedSince: 'not-captured'; no point: 'no-figure';
//   suppressed: 'suppressed' (value null); else 'value'
export function dimsOf(m: Metric, prefix: string): string[];     // 'relay:' → ['llm','speech'] (sorted, prefix removed)
export function sumOf(points: DayPoint[]): number | null;         // null when no day has a value
export function perStudentHourPaise(sittingPaise: number, activeMs: number): number | null; // null when activeMs is 0
export function unpricedShare(unpriced: number, calls: number): number | null;             // null when calls is 0
export function floorWord(unpriced: number): '' | 'at least ';
export function formatValue(unit: Metric['unit'], v: number | null, state?: DayState): string;
//   null → '—' with the state's text; paise → formatPaise; ms → '<n> min' (rounded down); minutes → '<n> min'; units, count → grouped
export function healthByDay(m: Metric): { day: string; green: number; amber: number; red: number; grey: number }[];
export function quietGrid(m: Metric): { school: string; days: { day: string; active: boolean | null }[] }[];
export function latestBySchool(m: Metric): { school: string; value: number | null; suppressed: boolean }[];
export function recomputeCheck(from: string, to: string, todayIst: string): { ok: true } | { ok: false; error: string };
//   same rule as the database: from ≤ to, to < today, at most 92 days → 'Pick up to 92 days, ending yesterday or earlier.'
export function recomputeBlast(from: string, to: string): string;
//   'The figures of <from> to <to> are worked out again from the records as they are now. Health, seats, activation,
//    sign-ins, classes by status and the question bank keep the values seen on their night. Records erased or purged
//    since are not counted.'
export function utcNote(m: Metric): string | null;  // dayKind 'utc' → 'By UTC day, the ceiling's own day; this line ends a day earlier.'
```

**The nav.** `sidebar-data.ts` gains a last group `Charts` with one collapsible item `{ title: 'Charts', icon: ChartLine, items: CHART_PAGES.map(p => ({ title: p.title, url: p.url, roles: p.roles })) }` (no `roles` on the parent: absent means every role). `navFor` (`lib/nav.ts`) also drops a collapsible item left with no sub-items, and its docblock says so. `command-menu.tsx` lists a collapsible's sub-items as `Charts: <title>`.

- [ ] **Step 1: Write the failing tests**
`apps/admin/tests/charts-model.test.ts` (relative imports): (1) `CHART_PAGES gives each page the roles the database gives it`; (2) `seriesFor marks not captured, before capture, no figure, suppressed and value days, and never turns a gap into 0`; (3) `dimsOf, sumOf and latestBySchool`; (4) `Rs per student-hour from paise and time, and the unpriced share and the floor word`; (5) `formatValue for each unit and state`; (6) `healthByDay and quietGrid`; (7) `recomputeCheck and recomputeBlast's exact text`; (8) `utcNote for UTC metrics only`.
`apps/admin/tests/nav.test.ts` changes: `every` gains `'Charts'` last; safety's list ends `'Classes', 'Charts'`; finance's list ends `'Settings', 'Charts'` and its groups are `['Platform', 'Billing', 'Charts']`; new: `the Charts pages follow the role: owner all eight, ops all but Safety, safety Safety only, finance Money only`; `a collapsible left with no sub-items is dropped`.
- [ ] **Step 2: Run** `npx vitest run apps/admin/tests/charts-model.test.ts apps/admin/tests/nav.test.ts` → FAIL (model missing; no Charts group).
- [ ] **Step 3: Implement.** Add the dependency: edit `apps/admin/package.json`, then `npm install --no-audit --no-fund` (UNVERIFIED offline: it may need the network to confirm the lock; recharts 3.10.1 is already in the root `node_modules`). Then the four components, the model, the nav changes.
- [ ] **Step 4: Run** `npx vitest run apps/admin` → PASS; `npx tsc -p apps/admin/tsconfig.json --noEmit` → no output.
- [ ] **Step 5: Commit**

```powershell
git add apps/admin/package.json package-lock.json apps/admin/src/components/charts apps/admin/src/features/charts/model.ts apps/admin/src/lib/nav.ts apps/admin/src/components/layout/data/sidebar-data.ts apps/admin/src/components/command-menu.tsx apps/admin/tests/charts-model.test.ts apps/admin/tests/nav.test.ts
Commit "feat: Recharts in the console, the teacher app's chart frame copied, chart helpers that never draw a gap as zero, a Charts group by role"
```

---

### Task 11: The frame, the recompute, and the Overview, Money and Safety pages

**Files:** Create `apps/admin/src/features/charts/{frame,recompute-dialog,overview,money,safety}.tsx`; modify `apps/admin/src/router.tsx`, `apps/admin/src/lib/client.ts` (`export const charts = createChartsClient(rpc);`)

`frame.tsx`: `ChartsFrame({ page, title, schoolPicker?, children(series, days, school) })` inside `<AdminPage title>`: a 7 / 30 days toggle (default 7, kept in the URL search `?days=`), for Schools and Learning a school select ("All schools" or a code from `schools.index()`), "Figures through <lastRun.through>, rolled up <istStamp(finishedAt)>" or "No roll-up has run yet." (grey), and for the owner a **Recompute** button; the series loads through `useLoad` and `LoadView`. `recompute-dialog.tsx`: `WriteDialog` (`guarded`, `title 'Recompute figures'`, `blast recomputeBlast(from, to)`, two date fields defaulting to the window, `canConfirm` = `recomputeCheck(...).ok`, the check's error shown under the fields) calling `charts.recompute`, then reloading.

Routes: `/charts/overview`, `/charts/money`, `/charts/safety` (and in Task 12 the other five). Every chart that has no value day shows `seriesFor`'s states; a metric with `captured: false` renders `NotCaptured`.

| Page | Live tiles (the same functions as Today) | Charts (metric keys) |
|---|---|---|
| Overview | `admin.today()`: Students now, Units today of the ceiling, Unread reports (red when `unsafeNew` > 0) | Learners per day, stacked school and direct (`tutor.learners`); Minutes on task (`tutor.minutes`); Classes served (`tutor.classes`); Spend against the ceiling: bars of `relay.units`, a line of `relay.ceiling`, with `utcNote`; Rs per student-hour per day = `perStudentHourPaise(cost.sitting_paise, cost.active_ms)` with a `ReferenceLine` at `TARGET_PAISE_PER_HOUR` labelled "Rs 5 target", the window figure, its unpriced share, and the title prefixed "At least " (`floorWord`) when any day had an unpriced call; Open reports (`reports.open`) and new reports by kind (`reports.new`) |
| Money | `billing.overview()`: collected this month, outstanding, overdue | Collected per day and outstanding at each day's end (`money.collected_paise`, `money.outstanding_paise`, `money.overdue_paise`); Renewals ahead (13 weeks, `money_view.renewals`); Spend by day stacked by relay (`spend.paise` `relay:`), by model (window totals, `model:`), by school (`spend.school_paise` window totals, top 10, plus "Children who came on their own" = `directCostPaise`); Cost per prepared class (`prep.paise ÷ prep.count` per day; window average); Margin per school (table and bars: fee, AI spend, margin; "at least" spend when `costIsFloor`; "No fee (pilot or none)" when `noFee`; "AI spend only: hosting, storage, messages and people are not counted.") |
| Safety | `safety.overview()`: unread by age (`unreadAges`), by status (`counts`), time to first look (30 days, median and slowest), capture (`captureText`) | Open reports by status at each day's end (`reports.open`); new reports by kind (`reports.new`); median minutes to the first look per day (`reports.first_look_median`) with `reports.looked`; distress flags per day by direction (`safety.flags`), with "captured on <n> of <N> days" and grey "Not captured" before `capturedSince` |

- [ ] **Step 1: Client line, routes, frame and dialog.**
- [ ] **Step 2: The three pages, as the table says.**
- [ ] **Step 3: Typecheck and build**

```powershell
npx tsc -p apps/admin/tsconfig.json --noEmit
$env:VITE_SUPABASE_URL='http://127.0.0.1:54321'; $env:VITE_SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlc2lnbmF0dXJl'; $env:VITE_ADMIN_ENV='TEST'
npm run admin:build
Remove-Item -Recurse -Force apps/admin/dist
```

Expected: no type errors; Vite builds; the scan ends `No secret found in N built files.`
- [ ] **Step 4: Browser check (needs a Supabase project with 0001 to 0074, the `admin` schema exposed, an owner, an ops member and a finance member; UNVERIFIED until then):** as owner, Overview draws, Recompute asks for a fresh code and the figures reload; as finance, only Charts → Money is offered; as ops, Safety is not offered.
- [ ] **Step 5: Commit**

```powershell
git add apps/admin/src
Commit "feat: chart pages Overview, Money and Safety, a 7 or 30 day frame, and the owner's recompute"
```

---

### Task 12: The Schools, Learning, Content, Reliability and Funnel pages

**Files:** Create `apps/admin/src/features/charts/{schools,learning,content,reliability,funnel}.tsx`; modify `apps/admin/src/router.tsx`

| Page | Live | Charts (metric keys) | One school (`?school=`) |
|---|---|---|---|
| Schools | none | Health over time, stacked by level (`healthByDay(school.health)`); Seats used and bought, summed (`school.seats_used`, `school.seats_bought`); Activation by school (`latestBySchool(school.activated)` over `school.students`, as a percentage, `SUPPRESSED_TEXT` where suppressed); Homework handed in by school (`school.handed_in_7d` over students); Homework published per day (`school.homework_published`); Quiet-school timeline (`quietGrid(school.active)`: a filled cell when active, an empty one when not, grey when no figure); Sign-ins per school (`school.signins`: the window's daily counts summed, labelled "a student is counted once a day", grey "Not captured" with the why) | each chart as one line for that school |
| Learning | none | Outcomes answered in 30 days by class and subject: bars of `learn.outcomes_covered_30d` over `learn.outcomes_total` (latest day), suppressed rows written out; Misconceptions: the latest day's `learn.misconceptions_30d` rows, most answers first, top 15, and "<n> more hidden: fewer than 10 children each"; Practice answers per day (`learn.practice_answers`) | the same for that school (no misconceptions: platform only) |
| Content | `charts.content()` (classes by status now, bank now, most reported, costliest to date) | Classes by status over time (`content.classes`); Question bank by review state (`content.bank`); Class cost per day: `spend.paise` `bucket:live` and `bucket:warm`; Pictures (`pictures.count`, `pictures.paise`, "at least" when `pictures.unpriced_calls` > 0); tables Most reported and Costliest to date (counts and rupees only) | n/a |
| Reliability | `system.health()`: relay stopped or not, events and failures in 5 minutes, the alarm's last check (warn when over `ALARM_STALE_MINUTES`), Cashfree (last notification, signature failures in 24 h, unprocessed), every job with its last status (`admin-metrics-nightly` among them) | Calls by outcome per day, stacked `ok`, `client`, `server`, `none` (`calls.outcome`), and failure rate = server ÷ all, with "Calls with no visible outcome are streams the host carried (0008); the System page's 5-minute count treats them as failures."; Payment notifications by result (`webhook.events`); `NotCaptured` for `relay.refusals`, `calls.latency`, `alarm.history` | n/a |
| Funnel | none | Contest entries per day (`funnel.entries`); the funnel as window totals: entrants → a parent verified → a first class → a second day (`funnel.cohort`, `funnel.verified`, `funnel.first_class`, `funnel.second_day` totals), `SUPPRESSED_TEXT` when suppressed | n/a |

- [ ] **Step 1: The routes.**
- [ ] **Step 2: The five pages, as the table says.**
- [ ] **Step 3: Typecheck and build** (Task 11 Step 3's commands). Expected: the same.
- [ ] **Step 4: Scan for a child in the pages:** `git grep -n -I -E "display_?[Nn]ame|login_?[Ii]d|loginId|note|userId|user_id" -- apps/admin/src/features/charts packages/admin-client/src/charts.ts` → no match.
- [ ] **Step 5: Commit**

```powershell
git add apps/admin/src
Commit "feat: chart pages Schools, Learning, Content, Reliability and Funnel, with not captured and small groups shown as such"
```

---

### Task 13: Runbook, README, and the whole gate

**Files:** Modify `docs/ops/admin-console.md` (append `## 9. The charts (plan 6)`), `apps/admin/README.md` (one paragraph)

- [ ] **Step 1: Section 9** with: **What the charts are** (eight pages, which role sees which (R9), daily aggregates rolled up at 00:20 India time, live tiles from Today, System, Billing and Safety); **What they never show** (a child; a learning figure for fewer than 10 children; a zero for something not captured: the list of R13); **Setup, once (Aarav's steps)** exactly as "Aarav's steps" below; **Day to day** (figures run through yesterday; "No figure" means no roll-up ran for that day; the meter and the ceiling are by UTC day and end a day earlier; "at least" means some calls have no price row yet: add prices to `model_price`, then Recompute); **If something goes wrong** (the System page shows `admin-metrics-nightly`'s last status; a failed night loses that day's snapshots for good and its other figures come back with Recompute; a recompute counts the records as they are now, so erased children, signature failures older than 90 days and sittings purged by `purge-old-ledger` are not counted (R8); to stop the job: `select cron.unschedule('admin-metrics-nightly');` from the dashboard, and the charts stop moving); **Kept** (`admin.metric_daily` holds aggregates only and is kept indefinitely; it is not in the Privacy page's "What is kept" table (R23)). The line **"Plan 6 changes no tutor code; nothing in `apps/classroom`, `packages/relay` or `supabase/functions/relay` may be deployed from this branch until it is merged with `phase3-completion` and `voice-stt-tts` (743c05a, 1dcfcfe, 18733af)."**
- [ ] **Step 2: README paragraph:** the chart pages live in `src/features/charts/`, read through `charts` in `src/lib/client.ts`; `src/components/charts/chart-card.tsx` and `kpi.tsx` are copied from the teacher app's `src/features/analytics/charts.tsx`, not imported; Recharts (MIT, copyright (c) 2015-present recharts) draws them and its licence ships in its package; running it: `docs/ops/admin-console.md` section 9.
- [ ] **Step 3: The whole gate**

```powershell
npm run typecheck
$env:VITE_SUPABASE_URL='http://127.0.0.1:54321'; $env:VITE_SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlc2lnbmF0dXJl'; $env:VITE_ADMIN_ENV='TEST'
npm run admin:build
Remove-Item -Recurse -Force apps/admin/dist
$env:VITE_SUPABASE_ANON_KEY='test-anon'
npx vitest run --exclude "tools/measure/**" --exclude "**/node_modules/**" *> "$env:TEMP\qrie-charts-suite.txt"
Get-Content "$env:TEMP\qrie-charts-suite.txt" -Tail 40
```

Expected: typecheck clean; the console builds and its scan ends `No secret found`; the suite (15 to 20 minutes) ends with every file passing: 4,872 + this plan's new tests (11 + 14 + 8 + 9 + 8 + 7 + 5 + 4 + 8 model + 2 nav = 76) passed, 2 skipped. Known flakes, not this plan's: `tools/lms-demo/tests/brain.test.ts` and `apps/classroom/tests/reportReplay.test.ts`; if one fails, rerun it alone and report both runs.
- [ ] **Step 4: Commit, then finish the branch**

```powershell
git add docs/ops/admin-console.md apps/admin/README.md
Commit "ops: the charts runbook, where the chart pieces came from, and the deploy hold on the tutor code"
```

Then use superpowers:finishing-a-development-branch. Pushing, `supabase db push` and deploying are Aarav's steps.

---

## Merge notes (this branch merges into `admin`)

1. `admin-charts` was cut from `admin@f61a758` and is the only plan of wave 3; nothing else is building on `admin` now. Merge with a fast-forward or a merge commit; no conflict is expected.
2. Migrations 0071 to 0074 come after `admin`'s 0070. The `lam-one-brain` lane uses 0100 to 0108, so the numbers do not collide. When `admin` is next merged with `lms` or `lam-one-brain`, run `supabase/tests/admin-metrics-*.test.ts` there: the families read `lms.*` tables those lanes may change (`lms.submission`, `lms.item`, `lms.outcome`, `lms.account`).
3. Shared files changed here: `supabase/tests/admin-invariants.test.ts` (four `authenticated` names, one service-role name, internals), `apps/admin/src/router.tsx`, `sidebar-data.ts`, `lib/nav.ts`, `command-menu.tsx`, `lib/client.ts`, `apps/admin/tests/nav.test.ts`, `packages/admin-client/src/index.ts`, `apps/admin/package.json`, `package-lock.json`, `docs/ops/admin-console.md`, `apps/admin/README.md`.
4. After merging, run the whole gate (Task 13 Step 3) on `admin`.

## Aarav's steps (only he can do these)

1. **Apply the migrations:** `npx supabase db push` applies 0071 to 0074 with the rest (hosted had nothing past 0025 on 2026-10-03, STALE: 0026 to 0070 go first). Nothing new to expose: every function is in `admin`.
2. **Check the job:** on the System page, `admin-metrics-nightly` appears with its schedule (`50 18 * * *`); after the first night its last status should read `succeeded`.
3. **Fill the past once:** on any chart page, press Recompute (owner, fresh code) for the 92 days ending yesterday, then again for the 92 before that if you want them. Snapshots (health, seats, activation, sign-ins, classes by status, question bank) start from the first night and cannot be filled backwards.
4. **Load prices:** until `public.model_price` holds a row for each model in use, spend and Rs per student-hour read "at least" (the unpriced share says how much). After adding prices, Recompute the days you care about.
5. **Redeploy the console** (it has a new dependency, Recharts) the way you host it (`docs/ops/admin-console.md` section 1).
6. **Do not deploy the tutor or the relay from this branch** (unchanged here, and older than live).
7. **Ask counsel** (add to the list in section 8 of the runbook): whether per-school daily sign-in counts and the contest funnel (entered → a parent verified → a first class → a second day, as 7- and 30-day totals, groups under 10 hidden) are outside DPDP s.9(3)'s "tracking or behavioural monitoring" of children. Until counsel answers they are built with the small-group rule; if counsel says no, the two catalogue rows can be set `captured = false` by a reviewed migration.

## UNVERIFIED

- Everything on a hosted project: 0071 to 0074 have not been applied there; pg_cron running `admin-metrics-nightly` at 18:50 UTC (the harness records the schedule only); how long a night or a 92-day recompute takes on real volumes (`usage_cost` prices every row with `price_at`, `0018:258-279`).
- That Qrie's hosted `auth.users` has `last_sign_in_at`, that the student app's PIN sign-in updates it, and that a definer function may read it.
- That the live relay records `images`, `prep_id` and `bucket` the way this branch's older relay code does (`packages/relay/src/usage.ts:89-99`, `handler.ts:384-395`); the charts read whatever rows exist.
- `npm install` adding Recharts to `apps/admin` without the network (the package is already in the root `node_modules`).
- The chart pages in a real browser (light and dark, the grey bands, the recompute dialog's fresh-code prompt).
- `percentile_cont` and the dynamic `execute` of family names on hosted Postgres (both run on PGlite in plans 5 and here).
- The tests' counts are this document's numbered tests; nothing here has been run.

## Rulings (decisions the spec did not settle, each with its cost if wrong)

- **R1** One table of daily aggregates: day, metric, school or none, a dimension from a fixed vocabulary, a whole number, and the group size behind it; no column can hold a person. Cost: no chart can ever drill down to a child (intended); a new kind of figure needs a catalogue row and a family change.
- **R2** (corrected in the fix pass) The small-group rule is applied at read (`admin.metric_json`), threshold 10 (`admin.metric_min_group()`), to the child figures of R3; the group sizes (`children`, `rest_children`) are stored and never returned. Its aim: no child figure `admin.metric_series` returns, alone or added to or subtracted from any other it returns for either frame, the platform or any school, on any day, describes 1 to 9 children. Four parts: (a) a row whose group is under 10 is null and suppressed; (b) a platform row of a figure also kept per school (practice, outcomes answered) is also hidden when `rest_children`, the children with a part of it outside every school row of 10 or more, is 1 to 9, so the platform minus the shown schools never isolates a direct child or a small school; (c) a child figure's total is hidden when any row it adds up is hidden; (d) no two figures of a kind cover overlapping days: learning windows are fixed 30-day blocks (R18) and the funnel's cohorts are complete India weeks (R19). A school figure's group is the school's active students (R3), so a shown school's figure, and its change from one day to the next, is about 10 or more students. `supabase/tests/admin-metrics-small-groups.test.ts` runs the reviewers' attacks against the database: what subtraction can isolate, across frames, schools and the views of consecutive days. Costs: (1) a figure rolled up again after its records change (an erasure, the ledger purge, an owner's recompute after either) differs from the one shown before by those records; the console keeps no earlier figure, but a person who wrote one down can subtract; (2) some group sizes can be read from figures that are not child figures (a school's students, contest entries per day), a count and not a child's data; (3) plan 2's health card still shows every school's activation and hand-in percentages, a small school's too (`0052:186-237`, merged), and plan 2's direct-user summary and lookup show ops a user's contest entry and consent (`0054:59-101`); this rule does not reach them; (4) more figures read hidden than before: the platform's practice on a day when 1 to 9 children practised outside the shown schools, the platform's outcomes answered in a block likewise, and the all-schools totals of a school figure while any school has fewer than 10 students.
- **R3** (corrected in the fix pass) Child figures, hidden by R2: per-school activation, hand-ins and sign-ins, whose group is the school's active students; every learning figure (outcomes answered, misconceptions, practice) at the platform and per school, whose group is the children who answered; the funnel's cohorts, whose group is the entrants. Learners per day, minutes on task, classes served, spend, calls, reports and flags are the platform's use and cost, not child figures, and are never hidden; Today shows some of them live (students in the last 10 minutes, meter units, new reports, contest entries today), not per day. Cost: on a day with fewer than 10 learners these figures describe those few children's use together (on a day with one learner, that child's minutes on task, classes and AI spend, with no identity attached), and spend per school does the same for a school with few active children. Hiding them would hide the ceiling and Rs per student-hour on quiet days; counsel question 9 asks.
- **R4** India days for everything except the meter's units and the ceiling, which are UTC days because the ceiling resets at UTC midnight (`0015:62`, `0048:12-13`); the run for India day D writes UTC day D − 1. Cost: those two lines end a day earlier than the others; the page says so.
- **R5** A past day's ceiling is read from the audit log (`ceiling-set`, `ceiling-reverted`). Cost: a ceiling changed by hand in SQL (an "unmanaged change") is not seen.
- **R6** The nightly run is at 18:50 UTC (00:20 India time), ten minutes after `billing-states` (18:40) so two nightly jobs do not start together (the health card's payment signal is computed live, `0058:143-149`, so the order does not change it); it rolls up yesterday with its snapshots and recomputes the six days before (sittings close and devices sync late). Cost: a day's figures can still rise for six days.
- **R7** Snapshots (health, students, seats, activation, sign-ins, classes by status, the bank) are written only by the nightly run and never recomputed. Cost: a missed night is a permanent hole in those lines, shown grey.
- **R8** Recompute is the owner's, with a fresh code, a reason and the environment, at most 92 days ending yesterday, and counts the records as they are now. Cost: recomputing an old range can lower figures (erased children, purged signature failures, sittings removed by `purge-old-ledger`); the runbook says so.
- **R9** Page roles: Overview, Schools, Learning, Content, Reliability, Funnel: owner and ops; Money: owner, ops and finance (the billing reads' roles, `0060:174`); Safety: owner and safety (plan 5's R28). Ops sees these because each figure is already in front of ops today (Today's spend, units and report counts; every school's health card with its hand-in and activation percentages; the System page; the Classes page; the billing pages): the charts add time, not a new kind of data, and no chart shows ops a child's words or identity. Safety sees only Safety, per the spec's division of work. Cost: the backup safety reviewer reads spend on Today, not in a chart.
- **R10** Minutes on task and Rs per student-hour count closed sittings with measured time, by the day the server received them, exactly as `public.cost_per_student_hour` does (`0008:176-211`). Cost: LMS practice (no `active_ms`, `0031:593-596`) adds no minutes.
- **R11** A learner is anyone with a sitting or an answer the server received that India day. Cost: a homework hand-in alone does not make a learner here (it is on the Schools page).
- **R12** Calls are sorted into answered (2xx-3xx), refused upstream (4xx), failed (5xx) and no visible outcome (0, a stream the host carried, `0008:30-32`); the failure rate is 5xx over all calls. The System page's 5-minute count treats 0 as a failure (`0055:214`); the Reliability page says so. Cost: two definitions on two pages, both written out.
- **R13** Not captured, grey, with a reason: the gate's refusals by reason (`claim_relay` keeps no record), latency (no duration column), the alarm's history (only the last check is kept), sign-ins where the database has no sign-in time, distress flags before capture. Capturing refusals or latency needs a relay change, which this branch must not deploy. Cost: those charts stay grey until a later plan changes the relay on the live branches.
- **R14** Sign-ins per school: the nightly run counts each school's students whose last sign-in (`auth.users.last_sign_in_at`) fell on that India day. Cost: two sign-ins in a day count once; a sign-in between midnight and 00:20 India time moves the student to the next day; a student who stays signed in is not counted; summing days counts a student once a day.
- **R15** Margin per school = the invoiced fee (taxable value, GST excluded; void invoices and cancelled subscriptions excluded; unpaid invoices included) spread evenly over its subscription's days, minus the AI spend attributed to the school (`usage_event.org_id`), "at least" when unpriced. Cost: hosting, storage, messages and people are not in the cost; the page says "AI spend only".
- **R16** Renewals ahead: 13 weeks of non-pilot licences ending, valued at the school's latest subscription's seats × seat price (taxable). Cost: a renewal at a new price shows the old one.
- **R17** Cost per prepared class = live-bucket spend with a preparation id ÷ the preparations that day; pictures = images × the `image` price. Cost: live calls without a preparation id are only in spend by bucket.
- **R18** (corrected in the fix pass) Learning: outcomes answered and misconceptions in fixed, back-to-back 30-day blocks (from 2026-01-01; `admin.metric_block_end`), written on a block's last day and returned for the latest block that has ended, whatever the frame, so no two windows share a day (R2 (d)); outcomes from tutor and practice answers and homework MCQ answers, by class and subject; misconceptions from library questions only (a school's own labels are its teacher's words and stay out of a platform view); practice per day. Cost: the two block figures change once every 30 days and can be up to 30 days old; a figure about a school's own questions' misconceptions is not charted.
- **R19** (corrected in the fix pass) The funnel is cohorts by entry day, returned only per complete India week (Monday to Sunday, every day of it rolled up): the latest week for 7 days, the latest four for 30, each hidden under 10 entrants, never as a total over weeks and never as a single day, so neither the two frames nor the views of two days in a row can be subtracted to single out a day (R2 (d)). Cohorts are rewritten a whole week at a time (a recompute rewrites the week of each day it covers; the nightly run the current week and the four before it), so a shown week's figures change only as all its entrants are counted again. Contest entries per day stay a daily count (not a child figure: a count of entries, with no step). Verified = any consent record; first class = a class sitting; second day = sittings on two India days. Cost: no daily conversion line; the current week is not shown until it ends; a week with fewer than 10 entrants is hidden however large its neighbours.
- **R20** Open reports at a day's end are rebuilt from `seen_at`, `actioned_at` and `closed_at`; a report closed before 0067 (no `closed_at`) counts as closed on every day. Cost: those few old reports are missing from past open counts.
- **R21** Distress flags are charted only on and after the capture day and only for the platform (counsel question 5 of plan 5 asks whether a per-school count is allowed).
- **R22** Classes by status and the question bank are platform snapshots; the most reported and costliest classes reuse plan 5's internals, to date. Cost: those two lists are not windowed.
- **R23** `admin.metric_daily` is kept indefinitely (aggregates only; nothing in it is a child's); plan 5's `admin.retention_truth` is not replaced to list it. Cost: the Privacy page's table does not mention it; the runbook does.
- **R24** Recharts is added to `apps/admin` at the teacher app's range (`^3.8.1`); the teacher app's chart frame and tile are copied, not imported. Cost: a fix to the teacher app's copies does not reach the console.
- **R25** Rs per student-hour carries a "Rs 5 target" line (the ceiling named in `apps/classroom/src/lib/liveClass.ts:440`). Cost: none known; it is a reference line, not a control.
- **R26** Margin lives on the Money chart page, not on plan 3's Billing overview. Cost: two places to look for money.

## Fix pass (after review, 2026-10-11)

Two adversarial reviewers found the small-group rule could be beaten by subtraction: the 30-day funnel total minus the 7-day one, or one day's 7-day total minus the next day's, gave one entrant's steps; the platform's practice line minus one school's gave one direct child's daily practice count; and a school figure's all-schools total minus the shown schools gave a hidden school's figure. The fix pass found the same in the learning windows: two 30-day windows a day apart gave one day's misconception answers. The fix (rulings R2, R3, R18 and R19 above, rewritten) adds `rest_children` to `admin.metric_daily`, `admin.metric_min_group()` and `admin.metric_block_end()` to 0071, a new `block` kind, whole-week cohort rewrites in 0073, and `supabase/tests/admin-metrics-small-groups.test.ts`, which runs each attack against the database. These task texts above are superseded by it: Task 2 test 5 (a total now hides when any row it adds is hidden) and the cohort test (per complete week, no total); Task 6 tests 1 to 3 (outcomes answered and misconceptions on a block's last day) and 7 and 8 (the funnel per week, rewritten a whole week at a time); Task 12's Funnel page (a table of weeks, not totals) and Learning page (the block's dates); the global constraint's "a learning figure for fewer than 10 children" (now any figure that would describe fewer than 10, alone or combined).

## Self-review

**Spec coverage.** Section 7 plan-6 row: `admin.metric_daily` (Task 2). Section 4 and 11 pipeline: nightly rollups by pg_cron just after midnight India time and recomputable (Task 3); live numbers from the same functions as Today (Tasks 11, 12 tiles). Section 11 rows: Overview (Tasks 3, 7, 11), Money (Tasks 3, 4, 11), Schools (Task 5, 12), Learning (Task 6, 12), Content (Tasks 3, 7, 12), Reliability (Tasks 2, 3, 4, 12), Funnel (Task 6, 12), Safety (Task 7, 11). Section 8 rows: Relay and AI cost (meter units, Rs per student-hour with its unpriced share: Tasks 3, 11); Student app sign-ins per school (Task 5, R14); Billing cost to serve and margin per school (Task 4, R15). Section 3 roles (R9, Task 2 test 2, Task 10 nav). Section 6 never shown and DPDP (Review Focus 1-2, Task 8). Section 12 "grey not captured, never a green zero" (R13, Tasks 2, 10). Section 14 plan 6 row.

**Placeholders.** The store, the read, the dispatcher, the nightly job and the non-obvious queries (learners, outstanding at a day's end, the ceiling of a past day) are given as code; the families' plain counts are given as exact rules with their sources cited. Every test file lists its tests and their assertions.

**Type consistency.** The JSON of `admin.metric_series` (Task 2) is `ChartSeries` (Task 9); `money_view` (Task 4) is `MoneyView`; `content_view` (Task 7) is `ContentView`, reusing plan 5's `ClassReports` and `ClassCost`; the metric keys of Tasks 3 to 7 are the ones the pages of Tasks 11 and 12 read; `CHART_PAGES`' roles (Task 10) are `admin.chart_roles`' (Task 2).

**Not verified:** the list under UNVERIFIED.
