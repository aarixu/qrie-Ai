# Qrie control, Plan 2: Schools, users and health. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner the schools and the people: every school in one sortable list with a health card of nine named signals; one school's page in tabs (overview, people, activity, billing seam, switches, notes) with its actions (create, import people, new PIN, licence, pause, export, offboard, disable a person); the users directory with two doors (school people, and DIRECT users who came on their own); the System page (relay, scheduled jobs, alarm heartbeat, migration level, restore drill, the ceiling screen deferred from plan 1); the Staff and audit page (invite, authenticator, activate by phone, roles, the log viewer); and a tamper-evident copy of the audit log kept off the platform.

**Architecture:** Four migrations (0052 to 0055) add SECURITY DEFINER functions in the `admin` schema; each begins with `admin.require_staff`, writes check the environment, take a reason and write `admin.audit`. Anything that needs the service role (a new sign-in, a new PIN, a ban, a staff account) goes through ONE new edge function, `admin-api`, which first asks the database **as the caller** (`admin.api_gate`, `admin.staff_invite`, `admin.direct_user_block`, called with the caller's own token) and only then acts with the service role, reusing the LMS lane's import and PIN code (`tools/lms-import/src/admin.ts`, factored, not copied). The console gains client modules (`schools.ts`, `users.ts`, `staff.ts`, `system.ts`, `admin-api.ts`) and pages. The audit log becomes a hash chain whose hashes (never its rows) are checked hourly from outside by a second scheduled job that keeps known heads in the Actions cache and posts the head to the ops chat once a day.

**Tech Stack:** Postgres on PGlite through `supabase/tests/harness.ts`; TypeScript; React 19, Vite 8, TanStack Router (code-based) and TanStack Table, Tailwind 4, the teacher app's UI kit (shadcn-admin, MIT); Deno for the edge adapter; Node 22 type stripping for the checker; vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-super-admin-panel-design.md` (sections 3, 5.7, 6, 7, 8, 9, 12, 13). **Plan 1** (format, conventions, deferred M2 and M4): `docs/superpowers/plans/2026-10-06-super-admin-foundation.md`. Both are read from the main checkout (`C:/Users/Ashish Sharma/curie`); they are not in this worktree.

**Where to work:** worktree `C:/Users/Ashish Sharma/curie/.claude/worktrees/admin-schools`, branch `admin-schools`, cut from `admin` at `eb17436`. Every command below runs from that worktree's root. Plan 3 (billing) is built at the same time on its own branch from `admin`; the seams S1 to S9 below are the contract between the two.

**Measured while writing this plan (2026-10-07, this worktree at `eb17436`).** The four migrations below were extracted from this document, applied on top of 0001 to 0051 in PGlite, and exercised by a throw-away test (deleted afterwards): the health card returned its nine signals and the label "Needs attention: no homework published in 14 days" for a school whose last homework was 15 days old; people search escaped `%`; disabling from the console left the same rows as `lms.mark_left` and the school admin's `restore_account` undid it; the school's own log named the actor "Qrie staff"; the gate, staff invite, role refusal, direct-user block and audit-log filters behaved as written; the chain verified intact and broke at the edited entry; `public.audit_head` gave exactly its eight keys to `anon`; `admin.system_health` read "not-captured" for the hosted-only tables. With the four files placed in `supabase/migrations`, `npx vitest run supabase/tests packages/lms-client tools/lms-import packages/admin-client` gave 54 files, 571 passed and 6 failed, the 6 being exactly the ones this plan changes on purpose (five `staff_set` tests of `admin-foundation.test.ts`, M2, and the grant list); with M2's `'TEST'` argument added, `admin-foundation.test.ts` passed 20 of 20. Everything was then removed: this branch holds only this document. **Added after that run, by the wave's cross-check (2026-10-07):** the `cashfree` part of `admin.system_health` (0055) and the service-row actor in `admin.school_activity` (0053). The `cashfree` block was run alone on PGlite against a stand-in `billing.webhook_event` and gave the values in Task 5's test 7; the whole 0055 and 0053 with these lines have not been re-run (UNVERIFIED until Tasks 3 and 5). The tests in this plan are not those throw-away checks; they are written first, in the tasks.

---

## Global Constraints

- **Migrations 0052 to 0055 only.** Never edit 0001 to 0051. Plan 3 owns 0056 to 0060. A migration of this plan may be edited only before this branch is merged (none is pushed).
- Every admin function is `SECURITY DEFINER`, `set search_path = admin, lms, public` (or a subset it needs), and its first statement is `admin.require_staff(...)` with the roles the spec allows. Its refusal is exactly `not allowed` (errcode 42501). **No other check, lookup or validation runs before it** (plan 1's M1: a stranger must learn nothing).
- Roles: `require_staff()` = owner, ops, safety; `require_staff(array['ops'])` = owner, ops; `require_staff(array[]::text[])` = owner only (owner always passes).
- Guarded (spec section 3: makes money flow, moves money out, cannot be undone, moves the ceiling, changes a licence, adds or removes staff) also calls `admin.require_fresh_mfa(10)`. This plan adds two rulings to that list: a **new PIN** (it hands out a credential to a child's account) and the **school export** (names leave the platform). See "Rulings".
- Every write: `p_env` checked by `admin.check_environment(p_env)`; `p_reason` of at least 3 characters (`admin.require_reason`, 0052); `perform set_config('admin.session', 'on', true)` before its first table write; one `admin.audit(...)` row with ids, reasons and hashes only. **Never** a child's words, a phone number, an address, a PIN, a note's body or a contact's details in `admin.audit_event`.
- Grants: every new function is `revoke all ... from public, anon` (internal helpers also `from authenticated`), then explicit `grant execute`. `supabase/tests/admin-invariants.test.ts` pins the exact lists; each task updates it.
- Days that mean "a day" are India's (`lms.india_today()`, 0036:32; `at time zone 'Asia/Kolkata'`). Money is `bigint` paise (this plan holds no money).
- **Spec section 6, never shown and never exported:** raw PINs (a new PIN is shown once, to the person who made it, at that moment, and is never stored), secrets, a child's words or answers, a report's note, full phone numbers and parent names in lists, home addresses, photos, any ranked or "at risk" list of children, any per-child behavioural trail, card or bank details. Health is counts only; no child is ranked.
- The browser never reads a table: functions only, through `packages/admin-client`. Every console write goes through `checkWrite` (`apps/admin/src/lib/confirm.ts`) and sends `EXPECTED_ENV`; a guarded write goes through `useGuarded`. App text is English, sentence case. Destructive or money actions show a blast-radius line and need the typed environment (every write here does, as on the switches page).
- **Comments are claims.** Prose in comments, docs and test names states only what the code does. Anything not run is marked UNVERIFIED.
- **TDD.** Each step that adds code is preceded by a test that is run and seen to fail for the stated reason.
- Database tests carry `// @vitest-environment node` and use the harness. Console tests (`apps/admin/tests`) import with **relative paths only**: the root vitest `@` alias points at `apps/lms/src` (plan 1's M14), so a console module under test must not import `@/...`.
- `node --experimental-strip-types` files (`tools/admin-alert/**`, `tools/admin-api/src/password.ts`) use erasable TypeScript only: no enums, no parameter properties, explicit `.ts` import paths.
- Windows. Commit with a message file (PowerShell 5.1 mangles quotes in native args). Write files without a BOM. Never touch other worktrees or the main checkout's working tree. Never push, deploy, `supabase db push`, call a hosted service, or put a real secret anywhere. No service-role key in browser code.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. In every new PowerShell session define:

```powershell
function Commit([string]$subject) {
  $f = Join-Path $env:TEMP 'qrie-plan2-commit.txt'
  [IO.File]::WriteAllText($f, "$subject`n`nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`n")
  git commit -F $f
}
```

## Seams with plan 3 (binding; quoted from the wave's contract)

| Seam | What this plan does |
|---|---|
| **S1** | 0052's **first** statement creates `admin.school_payment_signal(p_org uuid) returns jsonb`, SECURITY DEFINER, internal (revoked from public, anon, authenticated; no grant), returning `{"level":"grey","reason":"No billing account yet."}`. `admin.school_health_for` calls it for the Payment signal and `admin.school_list` for the payment column. Plan 3 replaces it with `create or replace` (same signature, same grants). |
| **S2** | `apps/admin/src/features/billing/school-billing-tab.tsx` is created as a stub: `export function SchoolBillingTab(props: { orgId: string; code: string })` rendering "Payments arrive with billing." The school page's Billing tab renders `<SchoolBillingTab orgId={detail.orgId} code={detail.code} />`. The merge takes plan 3's file. |
| **S3** | New client calls live in NEW modules `packages/admin-client/src/{schools,users,staff,system,admin-api}.ts`, built on the existing `AdminTransport`; `index.ts` only gains `export *` lines; `apps/admin/src/lib/client.ts` gains construction lines only. |
| **S4** | Routes `/schools`, `/schools/$code`, `/users`, `/system`, `/staff`, `/account` and their sidebar entries are added; plan 1's routing is not restructured. |
| **S5** | `public.app_config` is not touched. (Pausing a school and offboarding write `admin.app_flag` rows of the existing `tutor.enabled` key, which `app_config` already reads.) |
| **S6** | The console's staff role list is ONE constant, `STAFF_ROLES` in `apps/admin/src/features/staff/roles.ts` (`['owner','ops','safety']`). In SQL, `staff_set` and `staff_invite` take the allowed roles from `platform_staff`'s own check constraint (they catch `check_violation`), so plan 3's migration that widens that constraint to `finance` needs no change here. **Plan 3 must not recreate the old 5-argument `admin.staff_set`** (0054 drops it for the 6-argument one with `p_env`). |
| **S7** | The manual licence change is `admin.school_set_licence` (owner, fresh code, reason, env) wrapping `lms.set_licence` (0041:70). 0041 is not edited. |
| **S8** | 0052 to 0055 only. |
| **S9** | Plan 1 files are edited only where allowed: `admin-invariants.test.ts`, `router.tsx`, `sidebar-data.ts`, `admin-client/src/index.ts`, `lib/client.ts`, `docs/ops/admin-console.md`, `apps/admin/README.md`. Three further edits, each a named plan-1 follow-up with its test: **M2** (`staff_set` takes `p_env`, accepts only staff-made accounts: `admin-client/src/api.ts`, `admin-foundation.test.ts`, `api.test.ts`), **M4** (the ceiling screen, on the new System page, using plan 1's existing `setCaps`), and `components/command-menu.tsx` (Ctrl+K "jump to a school", which plan 1's own comment reserves for this plan). Also `apps/admin/package.json` and `package-lock.json` (Task 10: five dependencies the copied kit files need; plan 3 adds none) and the LMS lane's `tools/lms-import/src/admin.ts` (Task 6, factored while its own test file stays unedited). |

## Review Focus

Each item has a test named in the task that owns it.

1. **A child's session, aal1, a stranger, or the wrong role** calling any new function is refused with `not allowed`, before any other message (Tasks 2 to 5; the invariants list).
2. **Health thresholds are exactly spec section 9's**, each boundary tested on both sides; the label is the worst signal written out ("Needs attention: no homework published in 14 days") (Task 2).
3. **Counts only.** No list, health card, activity row, audit row or alert carries a child's name, login ID in a list of children, a report's note, a phone, a PIN, or a parent's name; parent names are masked in people search (Tasks 2, 3, 4, 5, 9).
4. **Disable is `lms.mark_left`'s semantics exactly**: a parity test runs both on two identical people and compares the rows, and the school admin's `lms.restore_account` brings a console-disabled child back (Task 3).
5. **The edge function never acts before the database said yes as the caller**: a child's token, an old code, the wrong environment or a missing reason creates no sign-in, sets no password, bans nobody (Task 7).
6. **One implementation of import and PIN**: `tools/lms-import/tests/admin.test.ts` passes unchanged after the factoring, and `admin-api` calls the same exported functions (Tasks 6, 7).
7. **The audit chain** detects an edited row, a deleted row and chain rewrites against the heads kept outside; the off-platform copy holds hashes and counts only (Tasks 5, 9).
8. **M2:** `staff_set` refuses an account not made for staff and a mismatched environment; activation needs a verified authenticator where the platform records factors (Task 4).

---

## Interfaces

**Consumes (verified in this worktree, with file:line):**

- Plan 1: `admin.require_staff(text[])` 0047:160, `admin.require_fresh_mfa(integer)` 0047:182, `admin.check_environment(text)` 0047:199, `admin.audit(admin.platform_staff, text, text, text, text, jsonb)` 0047:115, `admin.audit_service(...)` 0047:128, `admin.tripwire()` 0047:141, `admin.audit_immutable()` 0047:97, `admin.environment()` 0047:52, tables `admin.setting` 0047:42, `admin.platform_staff` 0047:64 (role check `owner|ops|safety` 0047:66), `admin.audit_event` 0047:80; `admin.flag_set` 0050:92 (scope `school`, guarded `tutor.enabled`), `admin.app_flag` 0050:32 (`scope_id ~ '^[A-Z0-9]{3,12}$'`, audit target `'<key> @ <CODE>'` 0050:133); `admin.alert_token` 0051:178, `admin.alert_miss` 0051:186, `admin.setting` key `alert_last_seen` 0051:243; `admin.relay_status()` 0048:60, `admin.set_caps(integer,text,text)` 0048:129; cron job names `purge-old-ledger` 0009:39, `lms-finalize-tests` 0030:345, `admin-revert-caps` 0048:195.
- LMS lane: `lms.school` 0022:46 (org_id pk, code `^[A-Z0-9]{3,12}$`, display_name 1..120, board CBSE|ICSE|STATE|OTHER, created_at), `lms.academic_year` 0022:62, `lms.section` 0022:86, `lms.account` 0022:101 (+ `left_at` 0034:29; kind adds `parent` 0045:22), `lms.teaching_assignment` 0022:111, `lms.enrolment` 0022:123 (`left_on`, `joined_on`), `lms.assignment` 0023:68 (`published_at`, `due_at`, `created_by`), `lms.submission` 0024:25 (`submitted_at`, `student_user_id`), `lms.attendance` 0036:15 (`marked_at`, `marked_by`, `on_date`, `section_id`), `lms.guardian` 0045:24, `lms.licence` 0041:35, `lms.audit_event` 0034:35, `lms.audit(uuid,text,text,jsonb)` 0034:50 (actor = `auth.uid()`), `lms.audit_log(integer)` 0034:59, `lms.mark_left(text)` 0034:246, `lms.restore_account(text)` 0041:178, `lms.current_year(uuid)` 0037:20, `lms.india_today()` 0036:32, `lms.seats_used(uuid)` 0041:52, `lms.set_licence(text,text,integer,date)` 0041:70, `lms.founder_schools()` 0041:127, `lms.end_sessions(uuid)` 0046:102, `lms.import_snapshot`, `lms.admin_school`, `lms.account_by_login`, `lms.audit_by` 0046:28-100; `handleAdmin` and its helpers `tools/lms-import/src/admin.ts:71-187`; `newPin` `tools/lms-import/src/pin.ts:41`; `supabaseRest`, `supabaseStore` `tools/lms-import/src/supabaseStore.ts:25,48`; `pgliteStore` `tools/lms-import/src/pgliteStore.ts:11`; the lms-admin adapter `supabase/functions/lms-admin/index.ts`.
- Tutor tables: `public.organization` 0005:31 (kind solo|school), `public.membership` 0005:41, `public.learning_session` 0006:26 (source widened 0021:63), `public.ledger_event` 0006:52 (`received_at`), `public.usage_event` 0008:19 (`status`, `at`), `public.student_report` 0019:36 (`org_id` filled by trigger 0019:93; `status` new|seen|actioned|dismissed; `kind` incl. `unsafe`), `public.consent_record` 0019:180, `public.contest_signup` 0020:33, `public.relay_control` 0016:29.
- Harness: `freshDatabase`, `applyAfter`, `asClaims`, `asService`, `asUser`, `createUser`, `createSchool`, `enrol` (`supabase/tests/harness.ts`); `buildSchool`, `seat` (`supabase/tests/fixtures.ts`); `makeStaff`, `aal2`, `fresh`, `staleAmr`, `anonymousChild`, `setEnvironment` (`supabase/tests/admin-fixtures.ts`). The harness has **no** `cron.job_run_details`, `auth.mfa_factors`, `supabase_migrations.schema_migrations`, `auth.sessions` or `auth.users.banned_until`; this plan's functions look for the first three with `to_regclass` at call time, and tests create stand-ins (`supabase/tests/admin-standins.ts`, Task 4).
- Console: `createAdminClient`, `AdminTransport`, `supabaseAdminTransport`, `pgliteAdminTransport` (named args; `p_value` is the only jsonb argument), `AdminError` and `toAdminError`; `checkWrite`, `describeFlagChange` (`lib/confirm.ts`), `useGuarded` (`lib/stepup.tsx`), `useMe` (`lib/me.tsx`), `EXPECTED_ENV` (`lib/supabase.ts`), `AdminPage`, `StopControl`, `sidebarData`, `router`.

**Produces:**

- **SQL, granted to `authenticated` (each checks staff itself):**
  - 0052: `admin.school_index() returns table(code text, name text)` [all staff]; `admin.school_list() returns table(org_id uuid, code text, name text, plan text, seats integer, seats_used integer, valid_until text, days_left integer, payment_level text, payment_reason text, health_level text, health_label text, last_active text, students integer, teachers integer, offboarded boolean)` [all staff]; `admin.school_health(p_code text) returns jsonb` [all staff].
  - 0053: `admin.school_detail(p_code text) returns jsonb` [all staff]; `admin.school_weekly(p_code text, p_weeks integer default 8) returns table(week_start date, published integer, handed_in integer, attendance_marked integer)` [all staff]; `admin.school_people(p_code text, p_query text, p_limit integer default 20) returns table(login_id text, kind text, display_name text, class_name text, left_school boolean)` [owner, ops]; `admin.school_person(p_code text, p_login text) returns jsonb` [owner, ops]; `admin.school_activity(p_code text, p_before timestamptz default null, p_limit integer default 50) returns table(at timestamptz, source text, actor text, action text, target text, reason text)` [owner, ops]; `admin.school_notes(p_code text) returns jsonb` [owner, ops]; writes `admin.school_create(p_code, p_name, p_board, p_year_label text, p_starts_on date, p_ends_on date, p_reason, p_env) returns uuid` [owner, ops]; `admin.school_set_licence(p_code text, p_plan text, p_seats integer, p_until date, p_reason text, p_env text)` [owner + fresh]; `admin.school_quiet_set(p_code text, p_until date, p_reason text, p_env text)` [owner, ops]; `admin.school_offboard(p_code text, p_offboard boolean, p_reason text, p_env text)` [owner + fresh]; `admin.school_export(p_code text, p_reason text, p_env text) returns jsonb` [owner + fresh]; `admin.school_person_disable(p_code text, p_login text, p_reason text, p_env text)` [owner, ops]; `admin.school_contact_set(p_code text, p_id uuid, p_name text, p_role text, p_phone text, p_email text, p_reason text, p_env text) returns uuid` [owner, ops]; `admin.school_contact_remove(p_code text, p_id uuid, p_reason text, p_env text)` [owner, ops]; `admin.school_note_add(p_code text, p_kind text, p_body text, p_reason text, p_env text) returns uuid` [owner, ops].
  - 0054: `admin.direct_users_summary() returns jsonb` [owner, ops]; `admin.direct_user_find(p_ref text) returns jsonb` (array) [owner, ops]; `admin.direct_user(p_user uuid) returns jsonb` [owner, ops]; `admin.direct_user_block(p_user uuid, p_blocked boolean, p_reason text, p_env text)` [owner, ops]; `admin.staff_set(p_user uuid, p_role text, p_name text, p_active boolean, p_reason text, p_env text)` [owner + fresh] (replaces the 5-argument one); `admin.staff_invite(p_user uuid, p_role text, p_name text, p_reason text, p_env text)` [owner + fresh]; `admin.staff_roster() returns table(user_id uuid, email text, role text, display_name text, status text, factor text, created_at timestamptz, deactivated_at timestamptz)` [owner]; `admin.audit_list(p_actor uuid default null, p_action text default null, p_from date default null, p_to date default null, p_before bigint default null, p_limit integer default 100) returns table(id bigint, at timestamptz, actor uuid, actor_name text, actor_role text, action text, target_kind text, target_id text, reason text, details jsonb, environment text)` [owner]; `admin.api_gate(p_action text, p_code text, p_target text, p_reason text, p_env text) returns jsonb {actor, orgId}` [per action, below].
  - 0055: `admin.system_health() returns jsonb` [all staff]; `admin.restore_drill_set(p_on date, p_reason text, p_env text)` [owner, ops].
- **SQL, granted to `anon` (token-guarded):** `public.audit_head(p_token text, p_seqs bigint[] default '{}') returns jsonb` (0055).
- **SQL, internal (no grant):** `admin.school_payment_signal(uuid)` (S1), `admin.school_org(text)`, `admin.require_reason(text)`, `admin.signal(text,text,text)`, `admin.count_of(integer,text)`, `admin.in_days(integer)`, `admin.pct(integer,integer)`, `admin.like_escape(text)`, `admin.school_health_for(uuid)` (0052); `admin.is_direct(uuid)`, `admin.direct_user_json(uuid)`, `admin.factor_state(uuid)` (0054); `admin.audit_row_hash(text, admin.audit_event)`, `admin.audit_chain_append()` (trigger), `admin.audit_verify()`, `admin.alert_token_matches(text)` (0055). Replaced (same signature and grants): `lms.audit_log(integer)` (0053: a staff actor reads "Qrie staff").
- **Tables:** `admin.school_profile` (0052), `admin.school_contact`, `admin.school_note` (0053), `admin.user_block` (0054), `admin.audit_chain`, `admin.audit_chain_head` (0055). Settings keys `restore_drill_on`, `audit_copy_last_seen`.
- **TypeScript:** `importForSchool`, `resetPinForSchool`, `Refused` exported from `tools/lms-import/src/admin.ts`; `handleAdminApi(req, deps)`, `CallerError`, `CALLER_FUNCTIONS` (`tools/admin-api/src/handle.ts`); `newStaffPassword()` (`tools/admin-api/src/password.ts`); `supabase/functions/admin-api/index.ts`; client: `createSchoolsClient(t, api)`, `createUsersClient(t, api)`, `createStaffClient(t, api)`, `createSystemClient(t)`, `fetchAdminApi(baseUrl, token, fetchImpl?)`, `replyCaller(send)`, `readReply(status, body)`, `adminApiUrl(supabaseUrl)` and their types; `api.ts` `StaffSetInput.env` (M2); checker `tools/admin-alert/src/audit-copy.ts` (`problemsWith`, `keepHeads`, `dayLine`, `fetchAuditHead`, `runAuditCopy`) and `.github/workflows/admin-audit-copy.yml`; console pages and pure helpers listed in the file table.

## File structure

| Path | Responsibility | Task |
|---|---|---|
| `supabase/migrations/0052_admin_schools_health.sql` | S1 stub; school profile; helpers; `school_health_for`, `school_health`, `school_list`, `school_index` | 2 |
| `supabase/tests/admin-school-fixtures.ts` | `bareSchool`, `addStudents`, `ageStudents`, `publish`, `handIn`, `markAttendance`, `tutorSession`, `fileReport`, `ledgerEvent`, `setLicence`, `healthOf` | 2 |
| `supabase/tests/admin-school-health.test.ts` | thresholds, label, list, seam S1 | 2 |
| `supabase/migrations/0053_admin_school_page.sql` | contacts, notes; detail, people, person, activity, weekly, notes; create, licence, quiet, offboard, export, disable; `lms.audit_log` says "Qrie staff" | 3 |
| `supabase/tests/admin-school-page.test.ts` | the school page and its actions; `mark_left` parity | 3 |
| `supabase/migrations/0054_admin_users_staff.sql` | direct users, `user_block`; M2 `staff_set`; `staff_invite`, `staff_roster`; `api_gate`; `audit_list` | 4 |
| `supabase/tests/admin-users-staff.test.ts` | door 2, staff, the gate, the log viewer | 4 |
| `supabase/tests/admin-standins.ts` | hosted-only tables as test stand-ins | 4 |
| `supabase/migrations/0055_admin_audit_chain_system.sql` | the chain, `audit_verify`, `public.audit_head`, `system_health`, `restore_drill_set` | 5 |
| `supabase/tests/admin-audit-chain.test.ts`, `admin-system.test.ts` | chain and System page | 5 |
| `supabase/tests/admin-invariants.test.ts` (modify) | grant lists | 2 to 5 |
| `supabase/tests/admin-foundation.test.ts` (modify, M2) | `staff_set` calls gain `'TEST'` | 4 |
| `tools/lms-import/src/admin.ts` (modify) | export `importForSchool`, `resetPinForSchool`, `Refused`; `handleAdmin` unchanged in behaviour | 6 |
| `tools/lms-import/tests/admin-shared.test.ts` | the exported pieces | 6 |
| `tools/admin-api/src/{handle,password}.ts`, `tools/admin-api/tests/{handle,password}.test.ts` | the staff service's decisions | 7 |
| `supabase/functions/admin-api/index.ts` | the Deno adapter | 7 |
| `packages/admin-client/src/{admin-api,schools,users,staff,system}.ts`, `index.ts` (exports), `api.ts` (M2) | typed client | 8 |
| `packages/admin-client/tests/{admin-api,schools,users-staff-system}.test.ts`, `api.test.ts` (M2) | client tests | 8 |
| `tools/admin-alert/src/audit-copy.ts`, `tools/admin-alert/tests/audit-copy.test.ts`, `.github/workflows/admin-audit-copy.yml` | the off-platform copy | 9 |
| `apps/admin/package.json`, `src/components/data-table/*`, `src/components/ui/{tabs,popover,checkbox,textarea}.tsx`, `src/tanstack-table.d.ts` | kit additions copied from `apps/lms` | 10 |
| `apps/admin/src/lib/{health,school-filters,csv,blast,load-state}.ts`, `src/lib/use-load.ts`, `src/components/write-dialog.tsx` | pure helpers (tested), the load hook, the one write dialog | 10 |
| `apps/admin/tests/{health,school-filters,csv,blast,load-state}.test.ts` | their tests | 10 |
| `apps/admin/src/lib/client.ts`, `src/router.tsx`, `src/components/layout/data/sidebar-data.ts`, `src/components/command-menu.tsx` (modify) | wiring | 10 |
| `apps/admin/src/features/schools/**`, `src/features/billing/school-billing-tab.tsx` | Schools list, school page, actions, S2 stub | 11 |
| `apps/admin/src/features/{users,system,staff,account}/**` | Users, System (with the ceiling), Staff and audit, Your account | 12 |
| `docs/ops/admin-console.md`, `apps/admin/README.md` (modify) | Aarav's steps for plan 2; kit file list | 13 |

---

### Task 1: Baseline

**Files:** none.

- [ ] **Step 1: Confirm the branch and that dependencies are installed**

```powershell
git status --short; git log --oneline -1
Test-Path node_modules, apps/admin/node_modules
```

Expected: a clean tree on `admin-schools` (only this plan's document once committed), `eb17436` or this plan's commit on top; both paths `True`. If `node_modules` is missing: `$env:ONNXRUNTIME_NODE_INSTALL = 'skip'; npm ci`.

- [ ] **Step 2: Baseline of everything this plan touches**

Run: `npx vitest run supabase/tests/admin- packages/admin-client tools/lms-import/tests/admin.test.ts tools/admin-alert apps/admin`
Expected: PASS (plan 1's admin files, the client, the LMS admin handler, the checker, the console's tests). Write down the file and test counts: later steps compare against them.

---

### Task 2: The schools list and the health card (0052)

**Files:**
- Create: `supabase/migrations/0052_admin_schools_health.sql`
- Create: `supabase/tests/admin-school-fixtures.ts`
- Test: `supabase/tests/admin-school-health.test.ts`
- Modify: `supabase/tests/admin-invariants.test.ts`

**Interfaces:**
- Consumes: plan 1's checks; `lms.*` and `public.*` tables listed above; `lms.seats_used`, `lms.current_year`, `lms.india_today`, `lms.founder_schools`.
- Produces: S1 `admin.school_payment_signal(uuid)`; table `admin.school_profile (org_id uuid pk -> lms.school on delete cascade, quiet_until date, offboarded_at timestamptz, offboarded_by uuid, updated_at timestamptz)` with a tripwire; helpers `admin.school_org(text) returns uuid` (raises `there is no school with the code X`), `admin.require_reason(text)` (raises `say why, in a few words`), `admin.signal(key, level, reason) returns jsonb`, `admin.count_of`, `admin.in_days`, `admin.pct`, `admin.like_escape(text)`; `admin.school_health_for(uuid) returns jsonb {level, label, quietUntil, lastActiveOn, students, signals:[{key, level, reason}] x9}` with keys in this order: `licence, payment, seats, activation, teaching, learning, attendance, safety, lastActive`; `admin.school_health(text)` = the same plus `code`; `admin.school_list()`; `admin.school_index()`.

**The thresholds (spec section 9), exactly as `admin.school_health_for` implements them.** `today` is `lms.india_today()`. "Students" are `lms.account` rows of kind `student` with `left_at is null`.

| Signal | green | amber | red | grey |
|---|---|---|---|---|
| licence (`lms.licence`) | more than 30 days left: "N days of licence left." | 8 to 30 days: "The licence ends in N days." | 0 to 7 days: "The licence ends in N days." / "...ends today."; ended: "The licence ended on YYYY-MM-DD." | none: "No licence is set." |
| payment (S1) | per plan 3 | per plan 3 | per plan 3 | stub: "No billing account yet." |
| seats (`lms.seats_used`) | used x 10 < seats x 9: "U of S seats used." | 90% or more, not over: "U of S seats used." | used > seats: "U of S seats used: more than bought." | no licence: "No licence, so no seats are counted." |
| activation | 60% or more of students have a submission or a ledger event at this school: "P of students have done something." | 30% to under 60% | under 30% | no students: "No students yet."; fewer than 14 days since the first student account was created: "Fewer than 14 days since the first students were added." |
| teaching | a homework published in the last 7 days (`published_at > now() - 7 days`): "Homework was published in the last 7 days." | latest published 7 to 14 days ago: "No homework published in 7 days." | latest older than 14 days: "No homework published in 14 days."; never: "No homework has been published yet." | no teaching assignment in this year's sections: "No classes are set up yet." |
| learning | 30% or more of students handed in work in the last 7 days: "P of students handed in work in the last 7 days." | 10% to under 30% | under 10% | no published assignment due in the last 7 days, or no students: "Nothing was due in the last 7 days." |
| attendance (`lms.attendance.marked_at`, IST date) | last mark 0 to 2 days ago: "Attendance was marked on YYYY-MM-DD." | 3 to 6 days: "Attendance not marked in N days." | 7 days or more: same wording | never: "Attendance is not used at this school." |
| safety (`student_report` by `org_id`, status `new`) | none unread and the tutor was used: "No unread reports." | unread, none unsafe: "N unread report(s)." | an unread `unsafe`: "N unread unsafe report(s)." | none unread and no tutor session (`learning_session.source` in class, quiz, diagnostic, doubt) at this school: "Nobody at this school has used the tutor, where the report button is." |
| last active (attendance, hand-in, publish, ledger; IST date; the same four sources as `lms.founder_schools`) | within 3 days: "Last active on YYYY-MM-DD." | 4 to 14 days: "Last active N days ago." | more than 14 days: "Not active for N days." | none: "No activity yet." |

On holiday (`school_profile.quiet_until >= today`): teaching, learning, attendance and last active are grey "On holiday until YYYY-MM-DD; not counted." (checked after their own "no data" grey). The label: the first red, else the first amber, in the priority order **safety, licence, payment, seats, teaching, learning, attendance, activation, lastActive**, written "Needs attention: " (red) or "Watch: " (amber) plus the reason with its first letter lowered and its full stop removed; else "Healthy" when any signal is green; else "Not enough to tell yet". Its `level` is that signal's colour (green or grey for the last two).

- [ ] **Step 1: Write the fixtures**

Create `supabase/tests/admin-school-fixtures.ts`:

```ts
import type { PGlite } from '@electric-sql/pglite';
import type { JwtClaims } from './harness.ts';
import { asClaims, asService, createSchool } from './harness.ts';
import { seat, type School } from './fixtures.ts';

/**
 * Activity at a school, dated in the past, the way the LMS writes it, for the
 * health thresholds. Written as the database owner, as a migration would.
 */

export const ago = (days: number) => `now() - make_interval(days => ${Math.trunc(days)})`;

/** A school with a year and nothing else: no classes, no people. */
export async function bareSchool(db: PGlite, code: string): Promise<string> {
  const org = await createSchool(db, `${code} School`);
  await db.query(`insert into lms.school (org_id, code, display_name, board) values ($1, $2, $3, 'CBSE')`, [org, code, `${code} Public School`]);
  await db.query(
    `insert into lms.academic_year (org_id, label, starts_on, ends_on) values ($1, '2026-27', '2026-04-01', '2027-03-31')`,
    [org],
  );
  return org;
}

/**
 * n more students in 8A, with login IDs CODE-<first>, CODE-<first+1>, ... named
 * "Child <first-200+i>", rolls from <first-190> (so two calls with different
 * `first` never collide).
 */
export async function addStudents(db: PGlite, s: School, code: string, n: number, first = 200): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = await seat(db, s.org, 'student', `${code}-${first + i}`, `Child ${first - 200 + i}`);
    await db.query(
      `insert into lms.enrolment (org_id, academic_year_id, section_id, student_user_id, roll_number) values ($1, $2, $3, $4, $5)`,
      [s.org, s.year, s.s8a, id, String(first - 190 + i)],
    );
    ids.push(id);
  }
  return ids;
}

/** Every student account of the school was created `days` ago. */
export async function ageStudents(db: PGlite, org: string, days: number): Promise<void> {
  await db.query(`update lms.account set created_at = ${ago(days)} where org_id = $1 and kind = 'student'`, [org]);
}

/** A homework in 8A Maths, published and due the given number of days ago (negative = in the future). */
export async function publish(db: PGlite, s: School, publishedDaysAgo: number, dueDaysAgo = publishedDaysAgo - 3): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into lms.assignment (org_id, section_id, subject_id, created_by, kind, title, due_at, answer_types, published_at)
     values ($1, $2, $3, $4, 'homework', 'Fractions', ${ago(dueDaysAgo)}, '{photo}', ${ago(publishedDaysAgo)}) returning id`,
    [s.org, s.s8a, s.maths, s.teacherA],
  );
  return rows[0].id;
}

export async function handIn(db: PGlite, org: string, assignment: string, student: string, daysAgo = 1): Promise<void> {
  await db.query(
    `insert into lms.submission (org_id, assignment_id, student_user_id, kind, attempt, submitted_at, late)
     values ($1, $2, $3, 'photo', 1, ${ago(daysAgo)}, false)`,
    [org, assignment, student],
  );
}

export async function markAttendance(db: PGlite, s: School, student: string, daysAgo: number): Promise<void> {
  await db.query(
    `insert into lms.attendance (student_user_id, on_date, org_id, section_id, status, marked_by, marked_at)
     values ($1, lms.india_today() - $2::int, $3, $4, 'present', $5, ${ago(daysAgo)})`,
    [student, daysAgo, s.org, s.s8a, s.teacherA],
  );
}

/** A tutor sitting at this school (the report button lives in the tutor). */
export async function tutorSession(db: PGlite, org: string, user: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.query(
    `insert into public.learning_session (id, org_id, user_id, source, started_at) values ($1, $2, $3, 'class', now())`,
    [id, org, user],
  );
  return id;
}

/** A ledger event received `daysAgo` days back (the column list of school-safe-tenancy.test.ts). */
export async function ledgerEvent(db: PGlite, org: string, user: string, daysAgo = 1): Promise<void> {
  const session = await tutorSession(db, org, user);
  await db.query(
    `insert into public.ledger_event (id, org_id, user_id, session_id, seq, at, received_at, kind, source, surface)
     values ($1, $2, $3, $4, 0, ${ago(daysAgo)}, ${ago(daysAgo)}, 'answered', 'class', 'tap')`,
    [crypto.randomUUID(), org, user, session],
  );
}

/** A child's report; its org is filled by 0019's trigger. The note must never come back out. */
export async function fileReport(db: PGlite, user: string, kind: 'wrong' | 'unsafe' = 'wrong'): Promise<void> {
  await db.query(
    `insert into public.student_report (user_id, kind, note, lesson_id, at) values ($1, $2, 'a private note', 'L1', now())`,
    [user, kind],
  );
}

export async function setLicence(db: PGlite, code: string, seats: number, daysFromToday: number): Promise<void> {
  await asService(db, (tx) =>
    tx.query(`select lms.set_licence($1, 'pilot', $2, lms.india_today() + $3::int)`, [code, seats, daysFromToday]),
  );
}

export interface Signal { key: string; level: 'green' | 'amber' | 'red' | 'grey'; reason: string }
export interface Health { code: string; level: string; label: string; quietUntil: string | null; lastActiveOn: string | null; signals: Signal[] }

export const healthOf = (db: PGlite, claims: JwtClaims, code: string) =>
  asClaims(db, claims, async (tx) => (await tx.query<{ h: Health }>(`select admin.school_health($1) as h`, [code])).rows[0].h);

export const signalOf = (h: Health, key: string): Signal => {
  const s = h.signals.find((x) => x.key === key);
  if (!s) throw new Error(`no signal ${key}`);
  return s;
};
```

- [ ] **Step 2: Write the failing tests**

Create `supabase/tests/admin-school-health.test.ts`. Header comment: what the file pins (the nine signals, their thresholds, the label, the list, seam S1, counts only), "Written first." Setup:

```ts
// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, anonymousChild, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import {
  addStudents, ageStudents, bareSchool, fileReport, handIn, healthOf, ledgerEvent, markAttendance, publish, setLicence,
  signalOf, tutorSession,
} from './admin-school-fixtures.ts';
import { buildSchool } from './fixtures.ts';
import { asClaims, asService, createUser, freshDatabase } from './harness.ts';

let db: PGlite;
let owner: Staff;
let ops: Staff;
let safety: Staff;
beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  safety = await makeStaff(db, 'safety', 'Safety person');
});
afterAll(async () => { await db.close(); });
const h = (code: string) => healthOf(db, aal2(ops), code);
```

The tests, in this order (23). Each builds its own school(s) with a unique code, so they are independent of each other's data:

1. `who may read` / **"is for active staff at aal2, the safety reviewer included; a child, a stranger and aal1 are refused"**: `buildSchool(db,'WHO')`; `healthOf` as `aal2(safety)` resolves; as `{sub: await anonymousChild(db), aal: 'aal2'}`, `{sub: await createUser(db), aal: 'aal2'}` and `{sub: ops.id, aal: 'aal1'}` each rejects `/not allowed/`. Also `admin.school_health('NOPE')` as ops rejects `/no school with the code NOPE/`, and the same call as a child rejects `/not allowed/` (the staff check comes first).
2. `the payment signal (seam S1)` / **"is internal, takes (p_org uuid) and returns jsonb, and says grey 'No billing account yet.' for now"**: query `pg_proc` for `admin.school_payment_signal`: `pg_get_function_identity_arguments(oid) = 'p_org uuid'`, `pg_get_function_result(oid) = 'jsonb'`, `prosecdef = true`, and `has_function_privilege` false for `anon` and `authenticated`; `select admin.school_payment_signal(org)` (as the owner of the database) equals `{level:'grey', reason:'No billing account yet.'}`; `signalOf(await h('WHO'),'payment')` equals `{key:'payment', level:'grey', reason:'No billing account yet.'}`.
3. `licence` / **"grey with no licence; green with 31 days left; amber at 30 and at 8; red at 7; red once ended"**: schools `LIC0` (none), `LIC31`, `LIC30`, `LIC8`, `LIC7`, `LICX` (`-1`) via `buildSchool` + `setLicence(db, code, 100, n)`. Expect levels grey, green, amber, amber, red, red; reasons `'No licence is set.'`, `'31 days of licence left.'`, `'The licence ends in 30 days.'`, `'The licence ends in 8 days.'`, `'The licence ends in 7 days.'`, and `/^The licence ended on \d{4}-\d{2}-\d{2}\.$/`.
4. `seats` / **"grey without a licence; green under 90%; amber at 90% or more; red above what was bought"**: `buildSchool` has 2 students this year. `SEAT0` no licence (grey, `'No licence, so no seats are counted.'`), `SEAT3` seats 3 (green, `'2 of 3 seats used.'`), `SEAT2` seats 2 (amber, `'2 of 2 seats used.'`), `SEAT1` seats 1 (red, `'2 of 1 seats used: more than bought.'`).
5. `activation` / **"grey with no students, and for 14 days after the first students are added"**: `bareSchool(db,'ACT0')` grey `'No students yet.'`; `buildSchool(db,'ACTNEW')` (accounts created now) grey `'Fewer than 14 days since the first students were added.'`.
6. `activation` / **"then green at 60% of students having done something, amber at 30%, red under 30%"**: three schools `ACTG`, `ACTA`, `ACTR`: `buildSchool` + `addStudents(…, 8)` (10 students, 9 in 8A) + `ageStudents(org, 20)` + one `publish(s, 2, 1)`; hand-ins by 6, 3 and 2 students of 8A (kid8a and the added ones). Expect green `'60% of students have done something.'`, amber `'30% ...'`, red `'20% ...'`.
7. `activation` / **"a ledger event counts as doing something"**: `ACTL`: `buildSchool` + `ageStudents(org, 20)`; `ledgerEvent(db, org, kid8a)` and `ledgerEvent(db, org, kid8b)`: 2 of 2, green.
8. `teaching` / **"grey with no classes this year; red when nothing was ever published"**: `bareSchool('TCH0')` grey `'No classes are set up yet.'`; `buildSchool('TCHN')` red `'No homework has been published yet.'`.
9. `teaching` / **"green when published in the last 7 days, amber after 7, red after 14"**: `TCH6` (`publish(s, 6)`) green `'Homework was published in the last 7 days.'`; `TCH8` amber `'No homework published in 7 days.'`; `TCH15` red `'No homework published in 14 days.'`.
10. `learning` / **"grey when nothing was due in the last 7 days"**: `LRN0`: `buildSchool` + `publish(s, 20, 10)` (due 10 days ago) → grey `'Nothing was due in the last 7 days.'`.
11. `learning` / **"green at 30% of students handing in, amber at 10%, red under 10%"**: `LRNG`, `LRNA`, `LRNR`: `buildSchool` + `addStudents(…, 8)`; `publish(s, 3, 1)`; hand-ins (1 day ago) by 3, 1 and 0 students. Expect green `'30% of students handed in work in the last 7 days.'`, amber `'10% ...'`, red `'0% ...'`.
12. `attendance` / **"grey when never used; green within 2 days; amber from 3; red from 7"**: `ATT0` grey `'Attendance is not used at this school.'`; `ATT2` `markAttendance(s, kid8a, 2)` green `/^Attendance was marked on \d{4}-\d{2}-\d{2}\.$/`; `ATT3` amber `'Attendance not marked in 3 days.'`; `ATT6` amber `'Attendance not marked in 6 days.'`; `ATT7` red `'Attendance not marked in 7 days.'`.
13. `safety` / **"grey when nobody at the school has used the tutor; green with no unread report"**: `SAF0` grey `'Nobody at this school has used the tutor, where the report button is.'`; `SAFG`: `tutorSession(db, org, kid8a)` → green `'No unread reports.'`.
14. `safety` / **"amber for an unread report, red for an unread unsafe one, and never the note"**: `SAFA`: `tutorSession` + `fileReport(kid8a,'wrong')` → amber `'1 unread report.'`; `SAFR`: + `fileReport(kid8a,'unsafe')` and `fileReport(kid8b,'wrong')` → red `'1 unread unsafe report.'`; `JSON.stringify` of both healths does not contain `'a private note'`. A report marked `seen` (`update public.student_report set status = 'seen'`) no longer counts: SAFA turns green.
15. `last active` / **"grey with no activity; green within 3 days; amber up to 14; red after 14"**: `LAST0` grey `'No activity yet.'`; `LAST3` (`markAttendance(…, 3)`) green `/^Last active on /`; `LAST4` amber `'Last active 4 days ago.'`; `LAST14` amber `'Last active 14 days ago.'`; `LAST15` red `'Not active for 15 days.'`.
16. `last active` / **"matches lms.founder_schools for the same school"**: for `LAST4` and `LAST15`, `h.lastActiveOn` equals `founder_schools().last_active` of that code (read with `asService`).
17. `on holiday` / **"teaching, learning, attendance and last active read grey with the date; licence, seats and safety do not"**: `QUIET`: `buildSchool` + `setLicence(code, 1, 5)` + `publish(s, 15, 3)` (due 3 days ago, so learning has something due) + `markAttendance(s, kid8a, 9)` + `tutorSession` + `fileReport(kid8a,'unsafe')`; insert `admin.school_profile (org_id, quiet_until) values (org, lms.india_today() + 10)`. Expect teaching, learning, attendance, lastActive grey with reason `/^On holiday until \d{4}-\d{2}-\d{2}; not counted\.$/`; licence red, seats red, safety red; `h.quietUntil` is that date. With `quiet_until = lms.india_today() - 1` the four are no longer grey.
18. `the label` / **"is the worst signal written out"**: `buildSchool('LBL')` + `publish(s, 15, 14)` → `h.level = 'red'`, `h.label = 'Needs attention: no homework published in 14 days'` (teaching outranks last active, both red).
19. `the label` / **"an unread unsafe report outranks other reds; all green reads Healthy; all grey reads Not enough to tell yet"**: LBL + `tutorSession` + `fileReport(kid8a,'unsafe')` → `'Needs attention: 1 unread unsafe report'`. `HEALTHY`: `buildSchool` + `addStudents(…, 2)` + `ageStudents(org, 30)` + `setLicence(code, 100, 200)` + `publish(s, 2, 1)` + hand-ins by kid8a and both added + `ledgerEvent` for kid8b + `markAttendance(s, kid8a, 0)` + `tutorSession` → every signal but payment green; `level 'green'`, `label 'Healthy'`. `bareSchool('ALLGREY')` → `level 'grey'`, `label 'Not enough to tell yet'`.
20. `the schools list` / **"lists every school with plan, seats, licence end, payment, health, last active, students and teachers"**: `select * from admin.school_list()` as ops; the `HEALTHY` row equals `{code:'HEALTHY', name:'HEALTHY Public School', plan:'pilot', seats:100, seats_used:4, days_left:200, payment_level:'grey', payment_reason:'No billing account yet.', health_level:'green', health_label:'Healthy', students:4, teachers:2, offboarded:false}` (plus `org_id`, `valid_until`, `last_active` as YYYY-MM-DD); rows are ordered by code.
21. `the schools list` / **"the index gives code and name only"**: `admin.school_index()` rows have exactly the keys `code, name` and include `{code:'HEALTHY', name:'HEALTHY Public School'}`.
22. `the schools list` / **"carries counts only: no child's name, login ID or report note"**: `JSON.stringify` of the list and of `h('SAFR')` contains none of `'Riya'`, `'Arjun'`, `'Child 0'`, `'-101'`, `'-200'`, `'a private note'`.
23. `the schools list` / **"is readable by the safety reviewer; a child is refused"**.

Then update `supabase/tests/admin-invariants.test.ts`: in the `authenticated` list add `'admin.school_health'`, `'admin.school_index'`, `'admin.school_list'` in alphabetical order (after `'admin.relay_status'`).

- [ ] **Step 3: Run and see them fail**

Run: `npx vitest run supabase/tests/admin-school-health.test.ts supabase/tests/admin-invariants.test.ts`
Expected: FAIL. Every health test fails with `function admin.school_health(...) does not exist` (or `admin.school_payment_signal`/`school_list`/`school_index`); the invariants test fails on the three missing names.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/0052_admin_schools_health.sql`:

```sql
-- SCHOOLS AT A GLANCE: THE LIST, AND EACH SCHOOL'S HEALTH CARD.
--
-- The console reads the LMS lane's tables and the tutor's through SECURITY
-- DEFINER functions, like every admin function (0047). Every function a
-- browser may call begins with admin.require_staff.
--
-- THE HEALTH CARD is nine signals, each green, amber, red or grey ("cannot
-- tell yet") with a one-sentence reason. Every threshold is in
-- admin.school_health_for and nowhere else. The school's label is its worst
-- signal written out; at the same colour, safety comes first, then licence,
-- payment, seats, teaching, learning, attendance, activation, last active.
-- Counts only: no child is named, listed or ranked.
--
-- PAYMENT comes from admin.school_payment_signal. Until billing replaces it
-- in place (same signature, same grants) it says grey: "No billing account
-- yet."
--
-- ON HOLIDAY: admin.school_profile.quiet_until turns the teaching, learning,
-- attendance and last-active signals grey until that day, because there is
-- no school calendar in the schema.

-- The payment signal: internal, called only by other definer functions.
create or replace function admin.school_payment_signal(p_org uuid)
returns jsonb
language sql stable security definer
set search_path = admin, public
as $$
  select jsonb_build_object('level', 'grey', 'reason', 'No billing account yet.')
$$;

create table if not exists admin.school_profile (
  org_id uuid primary key references lms.school on delete cascade,
  quiet_until date,
  offboarded_at timestamptz,
  offboarded_by uuid,
  updated_at timestamptz not null default now()
);
revoke all on admin.school_profile from public, anon, authenticated;
alter table admin.school_profile enable row level security;

drop trigger if exists school_profile_tripwire on admin.school_profile;
create trigger school_profile_tripwire
  after insert or update or delete on admin.school_profile
  for each row execute function admin.tripwire();

-- ---------------------------------------------------------------------------
-- Helpers. Internal.
-- ---------------------------------------------------------------------------

create or replace function admin.school_org(p_code text)
returns uuid
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  org uuid;
begin
  select s.org_id into org from lms.school s where s.code = upper(btrim(coalesce(p_code, '')));
  if org is null then
    raise exception 'there is no school with the code %', upper(btrim(coalesce(p_code, '(none)')));
  end if;
  return org;
end;
$$;

create or replace function admin.require_reason(p_reason text)
returns void
language plpgsql immutable
as $$
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'say why, in a few words';
  end if;
end;
$$;

create or replace function admin.signal(p_key text, p_level text, p_reason text)
returns jsonb
language sql immutable
as $$
  select jsonb_build_object('key', p_key, 'level', p_level, 'reason', p_reason)
$$;

-- '1 unread report', '3 unread reports'.
create or replace function admin.count_of(p_n integer, p_thing text)
returns text
language sql immutable
as $$
  select p_n || ' ' || p_thing || case when p_n = 1 then '' else 's' end
$$;

-- 'today', 'in 1 day', 'in 9 days'.
create or replace function admin.in_days(p_n integer)
returns text
language sql immutable
as $$
  select case when p_n = 0 then 'today' when p_n = 1 then 'in 1 day' else 'in ' || p_n || ' days' end
$$;

-- '60%', rounded down; '0%' of nothing.
create or replace function admin.pct(p_part integer, p_whole integer)
returns text
language sql immutable
as $$
  select case when coalesce(p_whole, 0) = 0 then '0%' else (p_part * 100 / p_whole) || '%' end
$$;

-- A typed search term, made safe for LIKE (backslash is LIKE's default escape).
create or replace function admin.like_escape(p_text text)
returns text
language sql immutable
as $$
  select replace(replace(replace(coalesce(p_text, ''), '\', '\\'), '%', '\%'), '_', '\_')
$$;

-- ---------------------------------------------------------------------------
-- The health card. Internal; every threshold of the card is here.
-- ---------------------------------------------------------------------------

create or replace function admin.school_health_for(p_org uuid)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  today date := lms.india_today();
  quiet_day date;
  quiet boolean;
  quiet_reason text;
  lic lms.licence;
  days_left integer;
  used integer;
  students integer;
  first_added date;
  did_something integer;
  has_classes boolean;
  last_pub timestamptz;
  due_recently boolean;
  handed integer;
  last_mark date;
  tutor_used boolean;
  unread integer;
  unread_unsafe integer;
  last_active date;
  pay jsonb := admin.school_payment_signal(p_org);
  s_licence jsonb;
  s_payment jsonb;
  s_seats jsonb;
  s_activation jsonb;
  s_teaching jsonb;
  s_learning jsonb;
  s_attendance jsonb;
  s_safety jsonb;
  s_last jsonb;
  worst jsonb;
  out_level text;
  out_label text;
begin
  select p.quiet_until into quiet_day from admin.school_profile p where p.org_id = p_org;
  quiet := quiet_day is not null and quiet_day >= today;
  quiet_reason := 'On holiday until ' || to_char(quiet_day, 'YYYY-MM-DD') || '; not counted.';

  -- Licence (0041).
  select l.* into lic from lms.licence l where l.org_id = p_org;
  days_left := lic.valid_until - today;
  s_licence := case
    when lic.org_id is null then admin.signal('licence', 'grey', 'No licence is set.')
    when days_left < 0 then admin.signal('licence', 'red', 'The licence ended on ' || to_char(lic.valid_until, 'YYYY-MM-DD') || '.')
    when days_left <= 7 then admin.signal('licence', 'red', 'The licence ends ' || admin.in_days(days_left) || '.')
    when days_left <= 30 then admin.signal('licence', 'amber', 'The licence ends ' || admin.in_days(days_left) || '.')
    else admin.signal('licence', 'green', days_left || ' days of licence left.')
  end;

  -- Payment (billing; a stub until plan 3).
  s_payment := admin.signal('payment', pay ->> 'level', pay ->> 'reason');

  -- Seats (0041).
  used := lms.seats_used(p_org);
  s_seats := case
    when lic.org_id is null then admin.signal('seats', 'grey', 'No licence, so no seats are counted.')
    when used > lic.seats then admin.signal('seats', 'red', used || ' of ' || lic.seats || ' seats used: more than bought.')
    when used * 10 >= lic.seats * 9 then admin.signal('seats', 'amber', used || ' of ' || lic.seats || ' seats used.')
    else admin.signal('seats', 'green', used || ' of ' || lic.seats || ' seats used.')
  end;

  -- Activation: students who have handed in work or have a ledger event here.
  select count(*) filter (where a.left_at is null)::int,
         min((a.created_at at time zone 'Asia/Kolkata')::date)
    into students, first_added
    from lms.account a
   where a.org_id = p_org and a.kind = 'student';
  select count(*)::int into did_something
    from lms.account a
   where a.org_id = p_org and a.kind = 'student' and a.left_at is null
     and (exists (select 1 from lms.submission s where s.org_id = p_org and s.student_user_id = a.user_id)
          or exists (select 1 from public.ledger_event e where e.org_id = p_org and e.user_id = a.user_id));
  s_activation := case
    when students = 0 then admin.signal('activation', 'grey', 'No students yet.')
    when today - first_added < 14 then admin.signal('activation', 'grey', 'Fewer than 14 days since the first students were added.')
    when did_something * 100 >= students * 60 then admin.signal('activation', 'green', admin.pct(did_something, students) || ' of students have done something.')
    when did_something * 100 >= students * 30 then admin.signal('activation', 'amber', admin.pct(did_something, students) || ' of students have done something.')
    else admin.signal('activation', 'red', admin.pct(did_something, students) || ' of students have done something.')
  end;

  -- Teaching: homework published (0023).
  select exists (
    select 1 from lms.teaching_assignment ta
      join lms.section sec on sec.id = ta.section_id
     where ta.org_id = p_org and sec.academic_year_id = lms.current_year(p_org)
  ) into has_classes;
  select max(a.published_at) into last_pub from lms.assignment a where a.org_id = p_org and a.published_at is not null;
  s_teaching := case
    when not has_classes then admin.signal('teaching', 'grey', 'No classes are set up yet.')
    when quiet then admin.signal('teaching', 'grey', quiet_reason)
    when last_pub > now() - interval '7 days' then admin.signal('teaching', 'green', 'Homework was published in the last 7 days.')
    when last_pub > now() - interval '14 days' then admin.signal('teaching', 'amber', 'No homework published in 7 days.')
    when last_pub is null then admin.signal('teaching', 'red', 'No homework has been published yet.')
    else admin.signal('teaching', 'red', 'No homework published in 14 days.')
  end;

  -- Learning: students who handed in work in the last 7 days, when something was due.
  select exists (
    select 1 from lms.assignment a
     where a.org_id = p_org and a.published_at is not null
       and a.due_at > now() - interval '7 days' and a.due_at <= now()
  ) into due_recently;
  select count(distinct s.student_user_id)::int into handed
    from lms.submission s
    join lms.account a on a.user_id = s.student_user_id and a.left_at is null
   where s.org_id = p_org and s.submitted_at > now() - interval '7 days';
  s_learning := case
    when students = 0 or not due_recently then admin.signal('learning', 'grey', 'Nothing was due in the last 7 days.')
    when quiet then admin.signal('learning', 'grey', quiet_reason)
    when handed * 100 >= students * 30 then admin.signal('learning', 'green', admin.pct(handed, students) || ' of students handed in work in the last 7 days.')
    when handed * 100 >= students * 10 then admin.signal('learning', 'amber', admin.pct(handed, students) || ' of students handed in work in the last 7 days.')
    else admin.signal('learning', 'red', admin.pct(handed, students) || ' of students handed in work in the last 7 days.')
  end;

  -- Attendance (0036), by the day it was marked.
  select max((at.marked_at at time zone 'Asia/Kolkata')::date) into last_mark from lms.attendance at where at.org_id = p_org;
  s_attendance := case
    when last_mark is null then admin.signal('attendance', 'grey', 'Attendance is not used at this school.')
    when quiet then admin.signal('attendance', 'grey', quiet_reason)
    when today - last_mark <= 2 then admin.signal('attendance', 'green', 'Attendance was marked on ' || to_char(last_mark, 'YYYY-MM-DD') || '.')
    when today - last_mark < 7 then admin.signal('attendance', 'amber', 'Attendance not marked in ' || (today - last_mark) || ' days.')
    else admin.signal('attendance', 'red', 'Attendance not marked in ' || (today - last_mark) || ' days.')
  end;

  -- Safety (0019): unread reports by this school's children. Counts only.
  select count(*) filter (where r.status = 'new')::int,
         count(*) filter (where r.status = 'new' and r.kind = 'unsafe')::int
    into unread, unread_unsafe
    from public.student_report r
   where r.org_id = p_org;
  select exists (
    select 1 from public.learning_session ls
     where ls.org_id = p_org and ls.source in ('class', 'quiz', 'diagnostic', 'doubt')
  ) into tutor_used;
  s_safety := case
    when unread_unsafe > 0 then admin.signal('safety', 'red', admin.count_of(unread_unsafe, 'unread unsafe report') || '.')
    when unread > 0 then admin.signal('safety', 'amber', admin.count_of(unread, 'unread report') || '.')
    when not tutor_used then admin.signal('safety', 'grey', 'Nobody at this school has used the tutor, where the report button is.')
    else admin.signal('safety', 'green', 'No unread reports.')
  end;

  -- Last active: the four sources lms.founder_schools reads (0041:135-143).
  select (greatest(
            (select max(at.marked_at) from lms.attendance at where at.org_id = p_org),
            (select max(sub.submitted_at) from lms.submission sub where sub.org_id = p_org),
            (select max(a.published_at) from lms.assignment a where a.org_id = p_org),
            (select max(le.received_at) from public.ledger_event le where le.org_id = p_org)
          ) at time zone 'Asia/Kolkata')::date
    into last_active;
  s_last := case
    when last_active is null then admin.signal('lastActive', 'grey', 'No activity yet.')
    when quiet then admin.signal('lastActive', 'grey', quiet_reason)
    when today - last_active <= 3 then admin.signal('lastActive', 'green', 'Last active on ' || to_char(last_active, 'YYYY-MM-DD') || '.')
    when today - last_active <= 14 then admin.signal('lastActive', 'amber', 'Last active ' || (today - last_active) || ' days ago.')
    else admin.signal('lastActive', 'red', 'Not active for ' || (today - last_active) || ' days.')
  end;

  -- The label: the first red, else the first amber, in priority order.
  select t.x into worst
    from jsonb_array_elements(jsonb_build_array(
           s_safety, s_licence, s_payment, s_seats, s_teaching, s_learning, s_attendance, s_activation, s_last
         )) with ordinality as t(x, n)
   where t.x ->> 'level' in ('red', 'amber')
   order by case t.x ->> 'level' when 'red' then 0 else 1 end, t.n
   limit 1;
  if worst is not null then
    out_level := worst ->> 'level';
    out_label := case out_level when 'red' then 'Needs attention: ' else 'Watch: ' end
              || lower(left(worst ->> 'reason', 1)) || rtrim(substr(worst ->> 'reason', 2), '.');
  elsif 'green' in (s_licence ->> 'level', s_payment ->> 'level', s_seats ->> 'level', s_activation ->> 'level',
                    s_teaching ->> 'level', s_learning ->> 'level', s_attendance ->> 'level', s_safety ->> 'level',
                    s_last ->> 'level') then
    out_level := 'green';
    out_label := 'Healthy';
  else
    out_level := 'grey';
    out_label := 'Not enough to tell yet';
  end if;

  return jsonb_build_object(
    'level', out_level,
    'label', out_label,
    'quietUntil', case when quiet then to_char(quiet_day, 'YYYY-MM-DD') end,
    'lastActiveOn', to_char(last_active, 'YYYY-MM-DD'),
    'students', students,
    'signals', jsonb_build_array(s_licence, s_payment, s_seats, s_activation, s_teaching, s_learning, s_attendance, s_safety, s_last)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- What the console calls.
-- ---------------------------------------------------------------------------

create or replace function admin.school_health(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff();
  org uuid;
begin
  org := admin.school_org(p_code);
  return admin.school_health_for(org) || jsonb_build_object('code', (select s.code from lms.school s where s.org_id = org));
end;
$$;

create or replace function admin.school_index()
returns table (code text, name text)
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
#variable_conflict use_column
declare
  me admin.platform_staff := admin.require_staff();
begin
  return query select s.code, s.display_name from lms.school s order by s.display_name;
end;
$$;

create or replace function admin.school_list()
returns table (
  org_id uuid, code text, name text, plan text, seats integer, seats_used integer, valid_until text, days_left integer,
  payment_level text, payment_reason text, health_level text, health_label text, last_active text,
  students integer, teachers integer, offboarded boolean
)
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
#variable_conflict use_column
declare
  me admin.platform_staff := admin.require_staff();
begin
  return query
    select s.org_id, s.code, s.display_name, l.plan, l.seats, lms.seats_used(s.org_id),
           to_char(l.valid_until, 'YYYY-MM-DD'), (l.valid_until - lms.india_today())::int,
           x.pay ->> 'level', x.pay ->> 'reason', x.h ->> 'level', x.h ->> 'label', x.h ->> 'lastActiveOn',
           (x.h ->> 'students')::int,
           (select count(*)::int from lms.account a where a.org_id = s.org_id and a.kind = 'teacher' and a.left_at is null),
           p.offboarded_at is not null
      from lms.school s
      left join lms.licence l on l.org_id = s.org_id
      left join admin.school_profile p on p.org_id = s.org_id
      cross join lateral (select admin.school_health_for(s.org_id) as h, admin.school_payment_signal(s.org_id) as pay) x
     order by s.code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------

revoke all on function admin.school_payment_signal(uuid) from public, anon, authenticated;
revoke all on function admin.school_org(text) from public, anon, authenticated;
revoke all on function admin.require_reason(text) from public, anon, authenticated;
revoke all on function admin.signal(text, text, text) from public, anon, authenticated;
revoke all on function admin.count_of(integer, text) from public, anon, authenticated;
revoke all on function admin.in_days(integer) from public, anon, authenticated;
revoke all on function admin.pct(integer, integer) from public, anon, authenticated;
revoke all on function admin.like_escape(text) from public, anon, authenticated;
revoke all on function admin.school_health_for(uuid) from public, anon, authenticated;
revoke all on function admin.school_health(text) from public, anon;
revoke all on function admin.school_index() from public, anon;
revoke all on function admin.school_list() from public, anon;

grant execute on function admin.school_health(text) to authenticated;
grant execute on function admin.school_index() to authenticated;
grant execute on function admin.school_list() to authenticated;
```

Note on `admin.like_escape`: `'\'` is one backslash because `standard_conforming_strings` is on (the Postgres default; checked on this repo's PGlite on 2026-10-07, where `like_escape('50%_x')` gave `50\%\_x` and matched only that literal text).

- [ ] **Step 5: Run and see them pass**

Run: `npx vitest run supabase/tests/admin-school-health.test.ts supabase/tests/admin-invariants.test.ts`
Expected: PASS, 23 + 4 tests. If one threshold test fails, fix the SQL, not the test: the tests are spec section 9.

- [ ] **Step 6: Nothing else moved**

Run: `npx vitest run supabase/tests packages/lms-client/tests/licence.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add supabase/migrations/0052_admin_schools_health.sql supabase/tests/admin-school-fixtures.ts supabase/tests/admin-school-health.test.ts supabase/tests/admin-invariants.test.ts
Commit "feat: every school in one list with a health card of nine named signals"
```

---

### Task 3: One school's page and its actions (0053)

**Files:**
- Create: `supabase/migrations/0053_admin_school_page.sql`
- Test: `supabase/tests/admin-school-page.test.ts`
- Modify: `supabase/tests/admin-invariants.test.ts`

**Interfaces:**
- Consumes: Task 2's helpers and `admin.school_health_for`; `lms.set_licence` (S7), `lms.audit`, `lms.end_sessions`, `lms.current_year`, `lms.seats_used`; `admin.app_flag` (for offboarding's pause); `lms.mark_left` and `lms.restore_account` (parity tests only).
- Produces: tables `admin.school_contact`, `admin.school_note`; the 15 functions listed under Interfaces for 0053; `lms.audit_log(integer)` replaced so an actor who is Qrie staff reads `Qrie staff` (spec section 13). JSON shapes:
  - `school_detail`: `{orgId, code, name, shortName, board, createdOn, year: {label, startsOn, endsOn} | null, licence: {plan, seats, seatsUsed, validUntil, daysLeft} | null, counts: {students, teachers, admins, parents, left, studentsEverUsed, teachersEverUsed}, quietUntil, offboardedAt, health}`.
  - `school_person`: `{loginId, kind, displayName, className, roll, createdOn, leftOn, lastActiveOn, teaches, children, parents}` (the last three are null unless teacher, parent, student respectively).
  - `school_notes`: `{quietUntil, offboardedAt, contacts: [{id, name, role, phone, email}], notes: [{id, at, kind, authorName, body}]}` (latest 100 notes).
  - `school_export`: `{school: {code, name, board}, exportedAt, people: [{loginId, kind, displayName, className, roll, leftOn}] (students, teachers, admins), parents: [{loginId, children: [loginId]}], work: [{title, kind, className, subject, publishedOn, dueOn, handedIn}]}`.

**Rules this migration implements** (each has a test):
- People search (`school_people`) needs at least 2 characters, matches a login-ID prefix or a name substring (`LIKE` metacharacters escaped), returns at most 20 rows, and shows a parent's name as its first letter and "…". There is no "list everyone" call.
- `school_person_disable` does what `lms.mark_left` (0034:246-277) does, statement for statement, with Qrie staff as the actor through `lms.audit` (whose actor is `auth.uid()`, the staff member): `left_at = now()`, membership deleted, a student's open enrolments get `left_on = current_date` (the same `current_date` mark_left uses, which `restore_account` matches with `left_at::date`), a teacher's teaching assignments are deleted with the classes logged. It then signs the person out (`lms.end_sessions`). It refuses the school's only remaining admin. Already left: nothing happens.
- Offboarding sets `school_profile.offboarded_at`, sets the school's `tutor.enabled` to `false` in `admin.app_flag` (audited as a `flag-set`, like `flag_set` does), and changes nothing else; bringing a school back clears `offboarded_at` and leaves the tutor switch as it is. There is no delete.
- A holiday ends between today and 90 days from now (`school_quiet_set`), or is cleared with `null`.
- Contacts are adults at the school: a name, a role, and a phone in `+E.164` (spaces and hyphens removed) or an email. The audit row holds the contact's id only. Notes are a `call` or a `note`, 1 to 2000 characters, never edited or deleted from the console, and never copied into the audit.

- [ ] **Step 1: Write the failing tests**

Create `supabase/tests/admin-school-page.test.ts`. Setup:

```ts
// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { addStudents, handIn, markAttendance, publish } from './admin-school-fixtures.ts';
import { buildSchool, seat, type School } from './fixtures.ts';
import { asClaims, asUser, freshDatabase, type JwtClaims } from './harness.ts';

let db: PGlite;
let owner: Staff;
let ops: Staff;
let safety: Staff;
let s: School;
let parent: string;
beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  safety = await makeStaff(db, 'safety', 'Safety person');
  s = await buildSchool(db, 'PAGE');
  parent = await seat(db, s.org, 'parent', 'PAGE-P1', 'Sunita Sharma');
  await db.query(`insert into lms.guardian (parent_user_id, student_user_id, org_id) values ($1, $2, $3)`, [parent, s.kid8a, s.org]);
});
afterAll(async () => { await db.close(); });

const call = <T = unknown>(claims: JwtClaims, sql: string, params: unknown[] = []) =>
  asClaims(db, claims, async (tx) => (await tx.query<{ v: T }>(`select ${sql} as v`, params)).rows[0].v);
const rows = <T = Record<string, unknown>>(claims: JwtClaims, sql: string, params: unknown[] = []) =>
  asClaims(db, claims, async (tx) => (await tx.query<T>(`select * from ${sql}`, params)).rows);
```

The tests, in this order (19):

`school actions`
1. **"create a school: code, name, board and its first year; a duplicate code is refused; the school's own log starts with it"**: as `aal2(ops)`, `admin.school_create('new1','New School','CBSE','2026-27','2026-04-01','2027-03-31','first pilot','TEST')` returns a uuid; `lms.school` has code `NEW1` and that org; one `lms.academic_year`; an `admin.school_profile` row; `lms.audit_event` has action `school-created`, actor `ops.id`; `admin.audit_event` has action `school-created`, target `school`/`NEW1`, reason `first pilot`. The same call again rejects `/already a school with the code NEW1/`; code `'x!'` rejects `/3 to 12 capital letters or digits/`; board `'IB'` rejects `/CBSE, ICSE, STATE or OTHER/`; ends before starts rejects `/end after it starts/`; as `aal2(safety)` rejects `/not allowed/`.
2. **"set the licence: the owner with a fresh code; ops are refused; before and after are in the audit; the school admin sees it"**: `fresh(ops)` rejects `/not allowed/`; `aal2(owner)` rejects `/authenticator code/`; `fresh(owner)` `admin.school_set_licence('PAGE','standard',50, lms.india_today() + 100,'signed for a year','TEST')` resolves; the latest `licence-set` audit row's `details` equals `{before: null, after: {plan:'standard', seats:50, validUntil: <that date>}}`; `asUser(db, s.admin, …select * from lms.school_licence())` gives plan `standard`, seats 50. A second change records a non-null `before`.
3. **"offboarding pauses the tutor for that school only; bringing it back leaves the tutor paused"**: `buildSchool(db,'OFF1')`; `fresh(owner)` `admin.school_offboard('OFF1', true, 'contract ended', 'TEST')`; `public.app_config('OFF1') ->> 'tutor.enabled'` is `false`, `public.app_config('PAGE')` is `true`; `admin.school_profile.offboarded_at` set; audit rows `flag-set` with target `tutor.enabled @ OFF1` and `school-offboarded`; `admin.school_list()` row `OFF1` has `offboarded = true`. Then `school_offboard('OFF1', false, …)`: `offboarded_at` null, `app_config('OFF1')` still `false`, audit `school-brought-back`. `aal2(owner)` rejects `/authenticator code/`; `fresh(ops)` rejects `/not allowed/`.
4. **"the export is the owner's with a fresh code: people with IDs and classes, parents by ID with their children's IDs, work with hand-in counts; never a PIN, an answer or a parent's name"**: `publish(db, s, 1, -1)` and `handIn(db, s.org, a, s.kid8a)` first; `fresh(owner)` `admin.school_export('PAGE','school asked for its register','TEST')`; `people` contains `{loginId:'PAGE-101', kind:'student', displayName:'Riya', className:'8A', roll:'1', leftOn:null}` and no entry of kind `parent`; `parents` equals `[{loginId:'PAGE-P1', children:['PAGE-101']}]`; `work[0]` has `title 'Fractions'`, `className '8A'`, `subject 'Mathematics'`, `handedIn 1`; `JSON.stringify` of the export does not contain `'Sunita'`; the `school-exported` audit row's details JSON contains no `'Riya'`. `fresh(ops)` rejects `/not allowed/`.
5. **"every write refuses the wrong environment and a missing reason"**: for each of `school_create`, `school_quiet_set`, `school_person_disable`, `school_contact_set`, `school_note_add`, called as `aal2(ops)` with valid other arguments: `p_env 'HOSTED'` rejects `/this console is TEST, not HOSTED/`; `p_reason ''` rejects `/say why/`.

`disable a person, as lms.mark_left does`
6. **"a student disabled from the console ends up exactly as one marked left by the school admin"**: `const [x, y] = await addStudents(db, s, 'PAGE', 2)` (PAGE-200, PAGE-201); `asUser(db, s.admin, tx => tx.query("select lms.mark_left('PAGE-200')"))`; `aal2(ops)` `admin.school_person_disable('PAGE','PAGE-201','left the school','TEST')`. With this helper:

```ts
const state = async (user: string) => ({
  left: (await db.query<{ l: boolean }>(`select left_at is not null as l from lms.account where user_id = $1`, [user])).rows[0].l,
  memberships: (await db.query<{ n: number }>(`select count(*)::int as n from public.membership where user_id = $1`, [user])).rows[0].n,
  enrolments: (await db.query<{ d: string | null }>(`select left_on::text as d from lms.enrolment where student_user_id = $1 order by id`, [user])).rows.map((r) => r.d),
  logged: (await db.query<{ n: number }>(
    `select count(*)::int as n from lms.audit_event where action = 'left' and target = (select login_id from lms.account where user_id = $1)`, [user],
  )).rows[0].n,
});
```

`expect(await state(y)).toEqual(await state(x))` and `(await state(x)).left` is `true`. The admin audit row `person-disabled` has `details = {loginId:'PAGE-201', kind:'student'}`.
7. **"a teacher loses their classes, as with mark_left"**: disable `PAGE-T2`; `lms.teaching_assignment` rows for `s.teacherB`: 0; the `left` row in `lms.audit_event` for `PAGE-T2` has `details.classes` equal to `['8B Science']`.
8. **"the school admin brings them back with restore_account"**: `asUser(db, s.admin, … lms.restore_account('PAGE-201'))`; `state(y)` shows `left false`, `memberships 1`, enrolment `left_on` null.
9. **"the school's only admin cannot be disabled; an unknown ID is refused; disabling twice is harmless"**: `PAGE-A1` rejects `/only admin/`; `PAGE-999` rejects `/no one at this school with the ID PAGE-999/`; disabling `PAGE-200` (already left) resolves and adds no `person-disabled` audit row.
10. **"the school's own activity log says Qrie staff for a staff action"**: `asUser(db, s.admin, … select * from lms.audit_log(50))`: the `left` row for `PAGE-201` has `actor_name 'Qrie staff'`; the `left` row for `PAGE-200` has `actor_name 'Admin'`.

`notes, contacts and holidays`
11. **"a contact needs a phone with its country code or an email; it can be changed and removed; the audit holds its id, never the number"**: `admin.school_contact_set('PAGE', null, 'Mrs Rao', 'Principal', '+91 98765-43210', null, 'new principal', 'TEST')` returns an id; `school_notes('PAGE').contacts[0].phone` is `'+919876543210'`; phone `'98765'` rejects `/country code/`; neither phone nor email rejects `/a phone number or an email/`; email `'not-an-email'` rejects `/not an email address/`; an update by id changes the role; `school_contact_remove` removes it; a remove of an unknown id rejects `/no such contact/`; `JSON.stringify` of every `school-contact-*` audit row contains neither `'9876543210'` nor `'Mrs Rao'`.
12. **"a note is a call or a note of up to 2000 characters, kept as written, never copied into the audit"**: `admin.school_note_add('PAGE','call','Spoke to the principal about the holidays','call log','TEST')` returns an id; `school_notes('PAGE').notes[0]` has that body, `kind 'call'`, `authorName 'Ops person'`; kind `'memo'` rejects `/a call or a note/`; 2001 characters rejects `/2000/`; the `school-note-added` audit row's JSON does not contain `'Spoke to'`.
13. **"on holiday until a day between today and 90 days ahead; clearing it works; outside the window is refused"**: `school_quiet_set('PAGE', lms.india_today() + 10, …)` then `school_detail('PAGE').quietUntil` is that date and the health card's teaching signal reason starts `On holiday until`; `+ 91` and `- 1` reject `/between today and 90 days/`; `null` clears it.

`reading one school`
14. **"detail gives the year, licence, counts with 'ever used', and the health card; the safety reviewer may read it"**: as `aal2(safety)`: `year.label '2026-27'`, `licence.plan 'standard'`, `counts.parents 1`, `counts.admins 1`, `counts.studentsEverUsed >= 1` (kid8a handed in, test 4), `health.signals` has 9 entries, `orgId` equals `s.org`.
15. **"people search needs 2 letters, finds by ID prefix or by name, returns at most 20, and masks a parent's name"**: `'R'` rejects `/at least 2 letters/`; `'page-10'` returns `PAGE-101` and `PAGE-102`; `'riya'` returns one row `{login_id:'PAGE-101', kind:'student', display_name:'Riya', class_name:'8A', left_school:false}`; `'sunita'` returns `{login_id:'PAGE-P1', kind:'parent', display_name:'S…'}`; after `addStudents(db, s, 'PAGE', 25, 300)`, `'Child'` returns exactly 20 rows; `'%%'` returns no row.
16. **"a person's card: class, roll, dates, last active, and counts of classes, children or parents; a parent's full name only here"**: `school_person('PAGE','PAGE-101')`: `className '8A'`, `roll '1'`, `parents 1`, `children null`, `lastActiveOn` not null (test 4's hand-in, a day ago); `PAGE-P1`: `displayName 'Sunita Sharma'`, `children 1`; `PAGE-T1`: `teaches 1`.
17. **"people and the card are refused to the safety reviewer"**.
18. **"activity merges the school's log and the platform's, newest first, with names for staff and no child named"**: `school_activity('PAGE')` as ops contains a row `{source:'qrie', action:'licence-set', reason:'signed for a year'}`, a row `{source:'school', action:'left', target:'PAGE-201', actor:'Qrie staff: Ops person'}`, a row `{source:'school', action:'left', target:'PAGE-200', actor:'Admin'}`; `at` is non-increasing; no `actor` is `'Riya'` or starts with `'Child'`; `school_activity('PAGE', <the third row's at>)` returns only rows older than it.
19. **"weekly counts homework published, work handed in and class-days of attendance per IST week, 8 weeks by default"**: `const w = await buildSchool(db, 'WEEK')`; `const [k] = await addStudents(db, w, 'WEEK', 1)`; `publish(db, w, 0, -2)` (id `a`) and `publish(db, w, 8, 5)`; `handIn(db, w.org, a, w.kid8a, 0)`; `markAttendance(db, w, w.kid8a, 0)`, `markAttendance(db, w, k, 0)`. `admin.school_weekly('WEEK')` as `aal2(safety)`: 8 rows ascending by `week_start`, each a Monday (`extract(isodow from week_start) = 1`, checked in SQL or by `new Date(d).getUTCDay() === 1`); sums over the rows: `published 2`, `handed_in 1`, `attendance_marked 1` (two children marked in one class on one day are one class-day); the last row's `published >= 1`. `school_weekly('WEEK', 30)` returns 26 rows.

Then add to the `authenticated` list in `admin-invariants.test.ts`, keeping alphabetical order: `admin.school_activity`, `admin.school_contact_remove`, `admin.school_contact_set`, `admin.school_create`, `admin.school_detail`, `admin.school_export`, `admin.school_note_add`, `admin.school_notes`, `admin.school_offboard`, `admin.school_people`, `admin.school_person`, `admin.school_person_disable`, `admin.school_quiet_set`, `admin.school_set_licence`, `admin.school_weekly`.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run supabase/tests/admin-school-page.test.ts supabase/tests/admin-invariants.test.ts`
Expected: FAIL: `function admin.school_create(...) does not exist` and the like in every test; the invariants list is short of 15 names.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0053_admin_school_page.sql`:

```sql
-- ONE SCHOOL'S PAGE, AND WHAT QRIE STAFF MAY DO TO A SCHOOL.
--
-- Reading: the school's detail and health (any staff member), people search
-- and one person's card, the merged activity timeline, weekly counts, and the
-- school's contacts and call notes. People are found by a search of at least
-- two characters, twenty at most; a parent's name is masked in results and
-- shown only on that parent's own card.
--
-- Doing: create a school, set its licence (owner, fresh code; lms.set_licence
-- does the writing), a holiday, offboarding (never a delete: the tutor is
-- paused for the school and nothing is removed), an export of its register,
-- contacts and notes, and disabling one person exactly as the school admin's
-- lms.mark_left does (0034), so the school admin's lms.restore_account brings
-- them back.
--
-- Every write checks the environment, takes a reason, and writes one audit
-- row with ids only. Actions on a school's own data also land in the school's
-- activity log, where lms.audit_log now names a staff actor "Qrie staff".

create table if not exists admin.school_contact (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references lms.school on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  role text not null check (char_length(role) between 1 and 60),
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  email text check (email is null or char_length(email) <= 120),
  updated_at timestamptz not null default now(),
  check (phone is not null or email is not null)
);
revoke all on admin.school_contact from public, anon, authenticated;
alter table admin.school_contact enable row level security;

create table if not exists admin.school_note (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references lms.school on delete cascade,
  kind text not null check (kind in ('call', 'note')),
  body text not null check (char_length(body) between 1 and 2000),
  author uuid,
  author_name text not null,
  at timestamptz not null default now()
);
create index if not exists school_note_time on admin.school_note (org_id, at desc);
revoke all on admin.school_note from public, anon, authenticated;
alter table admin.school_note enable row level security;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

create or replace function admin.school_detail(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff();
  org uuid;
  sch lms.school;
  yr lms.academic_year;
  lic lms.licence;
  prof admin.school_profile;
  counts jsonb;
begin
  org := admin.school_org(p_code);
  select s.* into sch from lms.school s where s.org_id = org;
  select y.* into yr from lms.academic_year y where y.id = lms.current_year(org);
  select l.* into lic from lms.licence l where l.org_id = org;
  select p.* into prof from admin.school_profile p where p.org_id = org;
  select jsonb_build_object(
           'students', count(*) filter (where t.kind = 'student' and t.here),
           'teachers', count(*) filter (where t.kind = 'teacher' and t.here),
           'admins', count(*) filter (where t.kind = 'admin' and t.here),
           'parents', count(*) filter (where t.kind = 'parent' and t.here),
           'left', count(*) filter (where not t.here),
           'studentsEverUsed', count(*) filter (where t.kind = 'student' and t.here and t.used),
           'teachersEverUsed', count(*) filter (where t.kind = 'teacher' and t.here and t.used))
    into counts
    from (
      select a.kind, a.left_at is null as here,
             case a.kind
               when 'student' then
                 exists (select 1 from lms.submission s where s.org_id = org and s.student_user_id = a.user_id)
                 or exists (select 1 from public.ledger_event e where e.org_id = org and e.user_id = a.user_id)
               when 'teacher' then
                 exists (select 1 from lms.assignment w where w.org_id = org and w.created_by = a.user_id and w.published_at is not null)
                 or exists (select 1 from lms.attendance m where m.org_id = org and m.marked_by = a.user_id)
               else false
             end as used
        from lms.account a
       where a.org_id = org
    ) t;
  return jsonb_build_object(
    'orgId', org,
    'code', sch.code,
    'name', sch.display_name,
    'shortName', sch.short_name,
    'board', sch.board,
    'createdOn', to_char((sch.created_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD'),
    'year', case when yr.id is null then null else jsonb_build_object(
              'label', yr.label, 'startsOn', to_char(yr.starts_on, 'YYYY-MM-DD'), 'endsOn', to_char(yr.ends_on, 'YYYY-MM-DD')) end,
    'licence', case when lic.org_id is null then null else jsonb_build_object(
              'plan', lic.plan, 'seats', lic.seats, 'seatsUsed', lms.seats_used(org),
              'validUntil', to_char(lic.valid_until, 'YYYY-MM-DD'), 'daysLeft', lic.valid_until - lms.india_today()) end,
    'counts', counts,
    'quietUntil', to_char(prof.quiet_until, 'YYYY-MM-DD'),
    'offboardedAt', prof.offboarded_at,
    'health', admin.school_health_for(org)
  );
end;
$$;

create or replace function admin.school_weekly(p_code text, p_weeks integer default 8)
returns table (week_start date, published integer, handed_in integer, attendance_marked integer)
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
#variable_conflict use_column
declare
  me admin.platform_staff := admin.require_staff();
  org uuid;
  n integer := least(greatest(coalesce(p_weeks, 8), 1), 26);
  this_week date := date_trunc('week', lms.india_today()::timestamp)::date;
begin
  org := admin.school_org(p_code);
  return query
    select w.d,
           (select count(*)::int from lms.assignment a
             where a.org_id = org and a.published_at is not null
               and (a.published_at at time zone 'Asia/Kolkata')::date between w.d and w.d + 6),
           (select count(*)::int from lms.submission s
             where s.org_id = org and (s.submitted_at at time zone 'Asia/Kolkata')::date between w.d and w.d + 6),
           (select count(*)::int from (
              select distinct m.section_id, m.on_date from lms.attendance m
               where m.org_id = org and m.on_date between w.d and w.d + 6) x)
      from (select (this_week - 7 * g)::date as d from generate_series(0, n - 1) g) w
     order by w.d;
end;
$$;

create or replace function admin.school_people(p_code text, p_query text, p_limit integer default 20)
returns table (login_id text, kind text, display_name text, class_name text, left_school boolean)
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
#variable_conflict use_column
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  org uuid;
  q text := btrim(coalesce(p_query, ''));
begin
  org := admin.school_org(p_code);
  if char_length(q) < 2 then
    raise exception 'type at least 2 letters of a name or an ID';
  end if;
  return query
    select a.login_id, a.kind,
           case when a.kind = 'parent' then left(a.display_name, 1) || '…' else a.display_name end,
           en.class_name, a.left_at is not null
      from lms.account a
      left join lateral (
        select sec.grade || sec.name as class_name
          from lms.enrolment e join lms.section sec on sec.id = e.section_id
         where e.student_user_id = a.user_id and e.academic_year_id = lms.current_year(org) and e.left_on is null
         limit 1
      ) en on true
     where a.org_id = org
       and (a.login_id like admin.like_escape(upper(q)) || '%'
            or a.display_name ilike '%' || admin.like_escape(q) || '%')
     order by a.left_at is not null, a.kind, a.display_name
     limit least(greatest(coalesce(p_limit, 20), 1), 20);
end;
$$;

create or replace function admin.school_person(p_code text, p_login text)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  org uuid;
  who lms.account;
  cls text;
  roll text;
  last_at timestamptz;
begin
  org := admin.school_org(p_code);
  select a.* into who from lms.account a where a.org_id = org and a.login_id = upper(btrim(coalesce(p_login, '')));
  if who.user_id is null then
    raise exception 'there is no one at this school with the ID %', upper(btrim(coalesce(p_login, '(none)')));
  end if;
  select sec.grade || sec.name, e.roll_number into cls, roll
    from lms.enrolment e join lms.section sec on sec.id = e.section_id
   where e.student_user_id = who.user_id and e.academic_year_id = lms.current_year(org) and e.left_on is null
   limit 1;
  last_at := case
    when who.kind = 'student' then greatest(
      (select max(s.submitted_at) from lms.submission s where s.org_id = org and s.student_user_id = who.user_id),
      (select max(e.received_at) from public.ledger_event e where e.org_id = org and e.user_id = who.user_id))
    when who.kind in ('teacher', 'admin') then greatest(
      (select max(w.published_at) from lms.assignment w where w.org_id = org and w.created_by = who.user_id),
      (select max(m.marked_at) from lms.attendance m where m.org_id = org and m.marked_by = who.user_id))
  end;
  return jsonb_build_object(
    'loginId', who.login_id,
    'kind', who.kind,
    'displayName', who.display_name,
    'className', cls,
    'roll', roll,
    'createdOn', to_char((who.created_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD'),
    'leftOn', to_char((who.left_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD'),
    'lastActiveOn', to_char((last_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD'),
    'teaches', case when who.kind = 'teacher' then (
      select count(*)::int from lms.teaching_assignment ta join lms.section sec on sec.id = ta.section_id
       where ta.teacher_user_id = who.user_id and sec.academic_year_id = lms.current_year(org)) end,
    'children', case when who.kind = 'parent' then (
      select count(*)::int from lms.guardian g where g.parent_user_id = who.user_id) end,
    'parents', case when who.kind = 'student' then (
      select count(*)::int from lms.guardian g where g.student_user_id = who.user_id) end
  );
end;
$$;

create or replace function admin.school_activity(p_code text, p_before timestamptz default null, p_limit integer default 50)
returns table (at timestamptz, source text, actor text, action text, target text, reason text)
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
#variable_conflict use_column
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  org uuid;
  sc text;
  n integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  org := admin.school_org(p_code);
  select s.code into sc from lms.school s where s.org_id = org;
  return query
    select t.at, t.source, t.actor, t.action, t.target, t.reason
      from (
        select e.at, 'school'::text as source,
               coalesce(case when ps.user_id is not null then 'Qrie staff: ' || ps.display_name end,
                        case a.kind when 'student' then 'A student' when 'parent' then 'A parent' else a.display_name end,
                        'The system') as actor,
               e.action, e.target, ''::text as reason
          from lms.audit_event e
          left join lms.account a on a.user_id = e.actor
          left join admin.platform_staff ps on ps.user_id = e.actor
         where e.org_id = org and (p_before is null or e.at < p_before)
        union all
        select e.at, 'qrie'::text,
               -- A service row (plan 1's audit_service; plan 3's "Cashfree") has no actor.
               case when e.actor is null then e.actor_name else 'Qrie staff: ' || e.actor_name end,
               e.action, e.target_id, e.reason
          from admin.audit_event e
         where ((e.target_kind = 'school' and e.target_id = sc)
                or (e.target_kind = 'flag' and e.target_id like '% @ ' || sc))
           and (p_before is null or e.at < p_before)
      ) t
     order by t.at desc
     limit n;
end;
$$;

create or replace function admin.school_notes(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  org uuid;
  prof admin.school_profile;
begin
  org := admin.school_org(p_code);
  select p.* into prof from admin.school_profile p where p.org_id = org;
  return jsonb_build_object(
    'quietUntil', to_char(prof.quiet_until, 'YYYY-MM-DD'),
    'offboardedAt', prof.offboarded_at,
    'contacts', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'role', c.role, 'phone', c.phone, 'email', c.email)
                       order by c.name)
        from admin.school_contact c where c.org_id = org), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'at', x.at, 'kind', x.kind, 'authorName', x.author_name, 'body', x.body)
                       order by x.at desc)
        from (select n.* from admin.school_note n where n.org_id = org order by n.at desc limit 100) x), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Doing
-- ---------------------------------------------------------------------------

create or replace function admin.school_create(
  p_code text, p_name text, p_board text, p_year_label text, p_starts_on date, p_ends_on date, p_reason text, p_env text
)
returns uuid
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  sc text := upper(btrim(coalesce(p_code, '')));
  org uuid;
begin
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  if sc !~ '^[A-Z0-9]{3,12}$' then
    raise exception 'a school code is 3 to 12 capital letters or digits';
  end if;
  if exists (select 1 from lms.school s where s.code = sc) then
    raise exception 'there is already a school with the code %', sc;
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 120 then
    raise exception 'give the school a name of up to 120 characters';
  end if;
  if p_board is null or p_board not in ('CBSE', 'ICSE', 'STATE', 'OTHER') then
    raise exception 'a board is CBSE, ICSE, STATE or OTHER';
  end if;
  if char_length(btrim(coalesce(p_year_label, ''))) not between 1 and 20 then
    raise exception 'name the year, like 2026-27';
  end if;
  if p_starts_on is null or p_ends_on is null or p_ends_on <= p_starts_on then
    raise exception 'the year must end after it starts';
  end if;
  perform set_config('admin.session', 'on', true);
  insert into public.organization (kind, name) values ('school', btrim(p_name)) returning id into org;
  insert into lms.school (org_id, code, display_name, board) values (org, sc, btrim(p_name), p_board);
  insert into lms.academic_year (org_id, label, starts_on, ends_on) values (org, btrim(p_year_label), p_starts_on, p_ends_on);
  insert into admin.school_profile (org_id) values (org);
  perform lms.audit(org, 'school-created', sc);
  perform admin.audit(me, 'school-created', 'school', sc, p_reason, jsonb_build_object('orgId', org, 'board', p_board));
  return org;
end;
$$;

create or replace function admin.school_set_licence(p_code text, p_plan text, p_seats integer, p_until date, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
  org uuid;
  sc text;
  was lms.licence;
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  org := admin.school_org(p_code);
  select s.code into sc from lms.school s where s.org_id = org;
  select l.* into was from lms.licence l where l.org_id = org;
  perform set_config('admin.session', 'on', true);
  perform lms.set_licence(sc, p_plan, p_seats, p_until);
  perform admin.audit(me, 'licence-set', 'school', sc, p_reason, jsonb_build_object(
    'before', case when was.org_id is null then null else jsonb_build_object(
                'plan', was.plan, 'seats', was.seats, 'validUntil', to_char(was.valid_until, 'YYYY-MM-DD')) end,
    'after', (select jsonb_build_object('plan', l.plan, 'seats', l.seats, 'validUntil', to_char(l.valid_until, 'YYYY-MM-DD'))
                from lms.licence l where l.org_id = org)));
end;
$$;

create or replace function admin.school_quiet_set(p_code text, p_until date, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  org uuid;
  sc text;
  was date;
begin
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  org := admin.school_org(p_code);
  select s.code into sc from lms.school s where s.org_id = org;
  if p_until is not null and (p_until < lms.india_today() or p_until > lms.india_today() + 90) then
    raise exception 'a holiday ends between today and 90 days from now';
  end if;
  select p.quiet_until into was from admin.school_profile p where p.org_id = org;
  perform set_config('admin.session', 'on', true);
  insert into admin.school_profile (org_id, quiet_until) values (org, p_until)
  on conflict (org_id) do update set quiet_until = excluded.quiet_until, updated_at = now();
  perform admin.audit(me, 'school-quiet-set', 'school', sc, p_reason,
    jsonb_build_object('before', to_char(was, 'YYYY-MM-DD'), 'until', to_char(p_until, 'YYYY-MM-DD')));
end;
$$;

create or replace function admin.school_offboard(p_code text, p_offboard boolean, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
  org uuid;
  sc text;
  was jsonb;
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  if p_offboard is null then
    raise exception 'say whether to offboard the school or bring it back';
  end if;
  org := admin.school_org(p_code);
  select s.code into sc from lms.school s where s.org_id = org;
  perform set_config('admin.session', 'on', true);
  insert into admin.school_profile (org_id, offboarded_at, offboarded_by)
  values (org, case when p_offboard then now() end, case when p_offboard then me.user_id end)
  on conflict (org_id) do update
    set offboarded_at = case when p_offboard then coalesce(admin.school_profile.offboarded_at, now()) end,
        offboarded_by = case when p_offboard then coalesce(admin.school_profile.offboarded_by, me.user_id) end,
        updated_at = now();
  if p_offboard then
    select v.value into was from admin.app_flag v where v.key = 'tutor.enabled' and v.scope = 'school' and v.scope_id = sc;
    insert into admin.app_flag (key, scope, scope_id, value, updated_by)
    values ('tutor.enabled', 'school', sc, 'false'::jsonb, me.user_id)
    on conflict (key, scope, scope_id) do update
      set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
    perform admin.audit(me, 'flag-set', 'flag', 'tutor.enabled @ ' || sc, p_reason,
      jsonb_build_object('before', was, 'after', false));
  end if;
  perform admin.audit(me, case when p_offboard then 'school-offboarded' else 'school-brought-back' end,
    'school', sc, p_reason, '{}'::jsonb);
end;
$$;

create or replace function admin.school_export(p_code text, p_reason text, p_env text)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
  org uuid;
  sch lms.school;
  people jsonb;
  parents jsonb;
  work jsonb;
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  org := admin.school_org(p_code);
  select s.* into sch from lms.school s where s.org_id = org;
  select coalesce(jsonb_agg(jsonb_build_object(
           'loginId', a.login_id, 'kind', a.kind, 'displayName', a.display_name,
           'className', en.class_name, 'roll', en.roll,
           'leftOn', to_char((a.left_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD'))
         order by a.kind, a.login_id), '[]'::jsonb)
    into people
    from lms.account a
    left join lateral (
      select sec.grade || sec.name as class_name, e.roll_number as roll
        from lms.enrolment e join lms.section sec on sec.id = e.section_id
       where e.student_user_id = a.user_id and e.academic_year_id = lms.current_year(org) and e.left_on is null
       limit 1
    ) en on true
   where a.org_id = org and a.kind in ('student', 'teacher', 'admin');
  select coalesce(jsonb_agg(jsonb_build_object(
           'loginId', p.login_id,
           'children', (select coalesce(jsonb_agg(c.login_id order by c.login_id), '[]'::jsonb)
                          from lms.guardian g join lms.account c on c.user_id = g.student_user_id
                         where g.parent_user_id = p.user_id))
         order by p.login_id), '[]'::jsonb)
    into parents
    from lms.account p
   where p.org_id = org and p.kind = 'parent';
  select coalesce(jsonb_agg(jsonb_build_object(
           'title', w.title, 'kind', w.kind, 'className', sec.grade || sec.name, 'subject', sub.name,
           'publishedOn', to_char((w.published_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD'),
           'dueOn', to_char((w.due_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD'),
           'handedIn', (select count(distinct s.student_user_id)::int from lms.submission s where s.assignment_id = w.id))
         order by w.published_at), '[]'::jsonb)
    into work
    from lms.assignment w
    join lms.section sec on sec.id = w.section_id
    join lms.subject sub on sub.id = w.subject_id
   where w.org_id = org and w.published_at is not null;
  perform admin.audit(me, 'school-exported', 'school', sch.code, p_reason, jsonb_build_object(
    'people', jsonb_array_length(people), 'parents', jsonb_array_length(parents), 'work', jsonb_array_length(work)));
  return jsonb_build_object(
    'school', jsonb_build_object('code', sch.code, 'name', sch.display_name, 'board', sch.board),
    'exportedAt', now(), 'people', people, 'parents', parents, 'work', work);
end;
$$;

create or replace function admin.school_person_disable(p_code text, p_login text, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  org uuid;
  sc text;
  who lms.account;
  classes jsonb;
begin
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  org := admin.school_org(p_code);
  select s.code into sc from lms.school s where s.org_id = org;
  select a.* into who from lms.account a where a.org_id = org and a.login_id = upper(btrim(coalesce(p_login, '')));
  if who.user_id is null then
    raise exception 'there is no one at this school with the ID %', upper(btrim(coalesce(p_login, '(none)')));
  end if;
  if who.left_at is not null then
    return;
  end if;
  if who.kind = 'admin' and not exists (
    select 1 from lms.account a
     where a.org_id = org and a.kind = 'admin' and a.left_at is null and a.user_id <> who.user_id
  ) then
    raise exception 'this is the school''s only admin; add another admin first';
  end if;
  perform set_config('admin.session', 'on', true);
  -- What lms.mark_left (0034) does, statement for statement; lms.audit's actor
  -- is auth.uid(), here the member of staff.
  update lms.account set left_at = now() where user_id = who.user_id;
  delete from public.membership where org_id = org and user_id = who.user_id;
  if who.kind = 'student' then
    update lms.enrolment set left_on = current_date where student_user_id = who.user_id and left_on is null;
    perform lms.audit(org, 'left', who.login_id);
  else
    select coalesce(jsonb_agg(sec.grade || sec.name || ' ' || sub.name), '[]'::jsonb) into classes
      from lms.teaching_assignment ta
      join lms.section sec on sec.id = ta.section_id
      join lms.subject sub on sub.id = ta.subject_id
     where ta.teacher_user_id = who.user_id;
    delete from lms.teaching_assignment where teacher_user_id = who.user_id and org_id = org;
    perform lms.audit(org, 'left', who.login_id, jsonb_build_object('classes', classes));
  end if;
  -- Then signed out everywhere (0046).
  perform lms.end_sessions(who.user_id);
  perform admin.audit(me, 'person-disabled', 'school', sc, p_reason,
    jsonb_build_object('loginId', who.login_id, 'kind', who.kind));
end;
$$;

create or replace function admin.school_contact_set(
  p_code text, p_id uuid, p_name text, p_role text, p_phone text, p_email text, p_reason text, p_env text
)
returns uuid
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  org uuid;
  sc text;
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[[:space:]-]', '', 'g'), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  out_id uuid;
begin
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  org := admin.school_org(p_code);
  select s.code into sc from lms.school s where s.org_id = org;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'give the contact a name of up to 80 characters';
  end if;
  if char_length(btrim(coalesce(p_role, ''))) not between 1 and 60 then
    raise exception 'say who they are, such as Principal, in up to 60 characters';
  end if;
  if v_phone is null and v_email is null then
    raise exception 'give a phone number or an email';
  end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'write the phone number with its country code, like +919876543210';
  end if;
  if v_email is not null and (char_length(v_email) > 120 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'that is not an email address';
  end if;
  perform set_config('admin.session', 'on', true);
  if p_id is null then
    insert into admin.school_contact (org_id, name, role, phone, email)
    values (org, btrim(p_name), btrim(p_role), v_phone, v_email)
    returning id into out_id;
  else
    update admin.school_contact c
       set name = btrim(p_name), role = btrim(p_role), phone = v_phone, email = v_email, updated_at = now()
     where c.id = p_id and c.org_id = org
    returning c.id into out_id;
    if out_id is null then
      raise exception 'there is no such contact at this school';
    end if;
  end if;
  perform admin.audit(me, 'school-contact-set', 'school', sc, p_reason, jsonb_build_object('contactId', out_id));
  return out_id;
end;
$$;

create or replace function admin.school_contact_remove(p_code text, p_id uuid, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  org uuid;
  sc text;
begin
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  org := admin.school_org(p_code);
  select s.code into sc from lms.school s where s.org_id = org;
  perform set_config('admin.session', 'on', true);
  delete from admin.school_contact c where c.id = p_id and c.org_id = org;
  if not found then
    raise exception 'there is no such contact at this school';
  end if;
  perform admin.audit(me, 'school-contact-removed', 'school', sc, p_reason, jsonb_build_object('contactId', p_id));
end;
$$;

create or replace function admin.school_note_add(p_code text, p_kind text, p_body text, p_reason text, p_env text)
returns uuid
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  org uuid;
  sc text;
  out_id uuid;
begin
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  org := admin.school_org(p_code);
  select s.code into sc from lms.school s where s.org_id = org;
  if p_kind is null or p_kind not in ('call', 'note') then
    raise exception 'a note is a call or a note';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 2000 then
    raise exception 'write the note in 1 to 2000 characters';
  end if;
  perform set_config('admin.session', 'on', true);
  insert into admin.school_note (org_id, kind, body, author, author_name)
  values (org, p_kind, btrim(p_body), me.user_id, me.display_name)
  returning id into out_id;
  perform admin.audit(me, 'school-note-added', 'school', sc, p_reason, jsonb_build_object('noteId', out_id, 'kind', p_kind));
  return out_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- The school's own activity log (0034), unchanged except that an actor who is
-- Qrie staff reads "Qrie staff" (spec section 13).
-- ---------------------------------------------------------------------------

create or replace function lms.audit_log(p_limit integer default 100)
returns table (at timestamptz, actor_name text, action text, target text, details jsonb)
language plpgsql stable security definer
set search_path = public, lms
as $$
declare
  org uuid := lms.require_admin();
begin
  return query
    select e.at,
           coalesce(a.display_name,
                    case when exists (select 1 from admin.platform_staff ps where ps.user_id = e.actor) then 'Qrie staff' end),
           e.action, e.target, e.details
      from lms.audit_event e
      left join lms.account a on a.user_id = e.actor
     where e.org_id = org
     order by e.at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. (create or replace keeps lms.audit_log's own grants from 0034.)
-- ---------------------------------------------------------------------------

revoke all on function admin.school_detail(text) from public, anon;
revoke all on function admin.school_weekly(text, integer) from public, anon;
revoke all on function admin.school_people(text, text, integer) from public, anon;
revoke all on function admin.school_person(text, text) from public, anon;
revoke all on function admin.school_activity(text, timestamptz, integer) from public, anon;
revoke all on function admin.school_notes(text) from public, anon;
revoke all on function admin.school_create(text, text, text, text, date, date, text, text) from public, anon;
revoke all on function admin.school_set_licence(text, text, integer, date, text, text) from public, anon;
revoke all on function admin.school_quiet_set(text, date, text, text) from public, anon;
revoke all on function admin.school_offboard(text, boolean, text, text) from public, anon;
revoke all on function admin.school_export(text, text, text) from public, anon;
revoke all on function admin.school_person_disable(text, text, text, text) from public, anon;
revoke all on function admin.school_contact_set(text, uuid, text, text, text, text, text, text) from public, anon;
revoke all on function admin.school_contact_remove(text, uuid, text, text) from public, anon;
revoke all on function admin.school_note_add(text, text, text, text, text) from public, anon;

grant execute on function admin.school_detail(text) to authenticated;
grant execute on function admin.school_weekly(text, integer) to authenticated;
grant execute on function admin.school_people(text, text, integer) to authenticated;
grant execute on function admin.school_person(text, text) to authenticated;
grant execute on function admin.school_activity(text, timestamptz, integer) to authenticated;
grant execute on function admin.school_notes(text) to authenticated;
grant execute on function admin.school_create(text, text, text, text, date, date, text, text) to authenticated;
grant execute on function admin.school_set_licence(text, text, integer, date, text, text) to authenticated;
grant execute on function admin.school_quiet_set(text, date, text, text) to authenticated;
grant execute on function admin.school_offboard(text, boolean, text, text) to authenticated;
grant execute on function admin.school_export(text, text, text) to authenticated;
grant execute on function admin.school_person_disable(text, text, text, text) to authenticated;
grant execute on function admin.school_contact_set(text, uuid, text, text, text, text, text, text) to authenticated;
grant execute on function admin.school_contact_remove(text, uuid, text, text) to authenticated;
grant execute on function admin.school_note_add(text, text, text, text, text) to authenticated;
```

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run supabase/tests/admin-school-page.test.ts supabase/tests/admin-invariants.test.ts`
Expected: PASS, 19 + 4 tests.

- [ ] **Step 5: The LMS lane's own tests still hold (lms.audit_log was replaced)**

Run: `npx vitest run supabase/tests packages/lms-client tools/lms-import`
Expected: PASS. A failure in an LMS test that reads `audit_log` means the replacement changed more than the staff name: diff it against 0034:59-77.

- [ ] **Step 6: Commit**

```powershell
git add supabase/migrations/0053_admin_school_page.sql supabase/tests/admin-school-page.test.ts supabase/tests/admin-invariants.test.ts
Commit "feat: one school's page: people, activity, notes, and the actions on a school, disabling a person as the school admin would"
```

---

### Task 4: Direct users, staff (M2), the gate, the log viewer (0054)

**Files:**
- Create: `supabase/migrations/0054_admin_users_staff.sql`
- Create: `supabase/tests/admin-standins.ts`
- Test: `supabase/tests/admin-users-staff.test.ts`
- Modify: `supabase/tests/admin-invariants.test.ts`, `supabase/tests/admin-foundation.test.ts` (M2: the five `admin.staff_set(...)` calls at lines 66, 85, 89, 97, 103 gain a sixth argument `'TEST'`)

**Interfaces:**
- Consumes: Task 2's helpers; `lms.end_sessions` (0046:102); `auth.users` (`is_anonymous`, `raw_app_meta_data`, `email`, `created_at`); `public.usage_event`, `learning_session`, `ledger_event`, `contest_signup`, `consent_record`, `membership`.
- Produces: table `admin.user_block (user_id uuid pk -> auth.users on delete cascade, blocked_at, blocked_by)` with a tripwire; the functions listed under Interfaces for 0054. JSON of a direct user (`admin.direct_user`, each element of `admin.direct_user_find`): `{userId, ref, createdOn, anonymous, lastActiveOn, sessions, schoolCode, contestEntry, consent, blocked}` (`ref` is the first 8 characters of the user ID). `admin.direct_users_summary()`: `{total, anonymous, permanent, createdLast7Days, activeLast7Days, withContestEntry, withConsent, blocked}`. `admin.staff_roster().status` is `active | invited | off | account-only`; `.factor` is `verified | none | not-captured`. `admin.api_gate` actions:

| `p_action` | Who | Fresh code | Env and reason | School | Writes |
|---|---|---|---|---|---|
| `people-preview` | owner, ops | no | no | must exist | nothing |
| `people-import` | owner, ops | no | yes | must exist, not offboarded | audit `people-import-requested` |
| `pin-reset` | owner, ops | yes | yes | must exist | audit `pin-reset-requested`, details `{loginId}` |
| `staff-invite` | owner | yes | yes | none (`orgId` null) | audit `staff-invite-requested`, details `{emailSha256}` of the lower-cased address |
| anything else | (staff check first) | | | | raises `there is no such action` |

- [ ] **Step 1: Write the stand-ins**

Create `supabase/tests/admin-standins.ts`:

```ts
import type { PGlite } from '@electric-sql/pglite';

/**
 * Three tables the hosted project has and the harness does not: pg_cron's run
 * history, Supabase Auth's authenticator factors, and the Supabase CLI's list
 * of applied migrations. The admin functions look for each with to_regclass
 * when they are called, so a test adds them to see what the console reads on
 * a hosted project. Only the columns those functions read are here. Their
 * hosted shapes are UNVERIFIED until the first check against a real project.
 */
export async function addHostedStandIns(db: PGlite): Promise<void> {
  await db.exec(`
    create table if not exists cron.job_run_details (
      jobid bigint, runid bigserial primary key, job_pid integer, database text, username text, command text,
      status text, return_message text, start_time timestamptz, end_time timestamptz
    );
    create table if not exists auth.mfa_factors (
      id uuid primary key default gen_random_uuid(), user_id uuid not null, friendly_name text,
      factor_type text not null, status text not null,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (version text primary key, name text);
  `);
}
```

- [ ] **Step 2: Write the failing tests**

Create `supabase/tests/admin-users-staff.test.ts`. Setup: `db`, `setEnvironment`, `owner = makeStaff(db,'owner','Aarav')`, `ops`, `safety`; `child = await anonymousChild(db)` (a direct anonymous user: the sign-up trigger gives it a solo organisation); `permanent = await createUser(db)` (a direct permanent user); `s = await buildSchool(db,'USR')`; `staffMade = await createUser(db, { appMeta: { provisioned_by: 'staff' } })`. Before test 1: `insert into public.contest_signup (user_id, student_name, klass) values (child, 'A child', 8)`; `insert into public.consent_record (user_id, parent_name, parent_phone, source, otp_verified_at) values (permanent, 'A parent', '+919999999999', 'contest', now())`; `insert into public.learning_session (id, org_id, user_id, source, started_at) values (gen_random_uuid(), public.org_of(child), child, 'class', now())`.

The tests, in this order (15):

`direct users (door 2)`
1. **"counts anonymous and permanent, created and active in 7 days, contest entries, consents and blocks; school and staff accounts are not counted"**: `admin.direct_users_summary()` as `aal2(ops)` equals `{total:2, anonymous:1, permanent:1, createdLast7Days:2, activeLast7Days:1, withContestEntry:1, withConsent:1, blocked:0}`.
2. **"finds a user by at least 8 characters of their user ID, at most 5, with no name, phone or address"**: `admin.direct_user_find(left(child, 8))` is one element whose `userId` is `child` and `ref` its first 8 characters; `'abc'` rejects `/at least the first 8 characters/`; the first 8 characters of `s.kid8a` give `[]` (a school account is not a direct user); `JSON.stringify` of the answers contains neither `'A child'` nor `'+919999999999'` nor `'A parent'`.
3. **"a card: created, last active, sessions, school or none, contest entry and consent as yes or no"**: `admin.direct_user(child)` matches `{anonymous:true, sessions:1, schoolCode:null, contestEntry:true, consent:false, blocked:false}` and `lastActiveOn` is today's IST date (`select to_char(lms.india_today(),'YYYY-MM-DD')`); `admin.direct_user(s.kid8a)` rejects `/not a direct user/`.
4. **"blocking records it, signs them out and is audited; unblocking removes it; a school or staff account is refused"**: `admin.direct_user_block(child, true, 'scripted abuse', 'TEST')`; a row in `admin.user_block`; an audit row `user-blocked`, `target_kind 'user'`, `target_id = child`; the summary says `blocked: 1`, the card `blocked: true`; `admin.direct_user_block(child, false, 'appeal', 'TEST')` removes it (audit `user-unblocked`); `s.kid8a` rejects `/belongs to a school/`; `ops.id` rejects `/staff page/`; `p_env 'HOSTED'` rejects `/this console is TEST/`; `p_reason ''` rejects `/say why/`.
5. **"the safety reviewer cannot read or block direct users"**: summary, find, card and block as `aal2(safety)` each reject `/not allowed/`.

`staff (M2)`
6. **"staff_set takes the environment and refuses an account not made for staff"**: `fresh(owner)`: `admin.staff_set(permanent,'ops','Someone',true,'new ops','TEST')` rejects `/only an account made for staff/`; `admin.staff_set(staffMade,'ops','New',true,'new ops','HOSTED')` rejects `/this console is TEST/`; the old five-argument call `admin.staff_set($1,'ops','New',true,'new ops')` rejects `/does not exist/`.
7. **"an invitation adds an inactive row for an account made for staff: the owner's, with a fresh code"**: `fresh(owner)` `admin.staff_invite(staffMade,'safety','Reviewer','backup reviewer','TEST')`; the row has `active false`, `deactivated_at null`; `admin.me()` as `aal2({id: staffMade})` rejects `/not allowed/`; `aal2(owner)` rejects `/authenticator code/`; `fresh(ops)` rejects `/not allowed/`; inviting again rejects `/already on the staff list/`; role `'boss'` (for another staff-made account) rejects `/no staff role called boss/`; `permanent` rejects `/only an account made for staff/`.
8. **"activation needs a verified authenticator where the platform records factors"**: `await addHostedStandIns(db)`; `fresh(owner)` `admin.staff_set(staffMade,'safety','Reviewer',true,'confirmed by phone','TEST')` rejects `/not set up an authenticator/`; with an `auth.mfa_factors` row `(user_id staffMade, factor_type 'totp', status 'unverified')` it still rejects; after `update auth.mfa_factors set status = 'verified'` it resolves, and `admin.me()` as `aal2({id: staffMade})` gives role `safety`.
9. **"the roster shows active, invited, switched-off and made-but-never-added accounts, and each authenticator's state"**: make `leaver = makeStaff(db,'ops','Leaver')` then `fresh(owner)` `staff_set(leaver,'ops','Leaver',false,'left','TEST')`; `invitee = createUser(db,{appMeta:{provisioned_by:'staff'}})` invited and not activated; `orphan = createUser(db,{appMeta:{provisioned_by:'staff'}})`. `select * from admin.staff_roster()` as `aal2(owner)`: `staffMade` is `active`/`verified`; `ops.id` is `active`/`none`; `leaver` `off`; `invitee` `invited`; `orphan` `account-only` with `role null`. As `aal2(ops)` it rejects `/not allowed/`.

`the gate admin-api asks first`
10. **"people-preview: ops or owner, no reason, nothing written"**: `admin.api_gate('people-preview','usr','','','')` as `aal2(ops)` equals `{actor: ops.id, orgId: s.org}`; the count of `admin.audit_event` rows is unchanged; as `aal2(safety)` and as a child it rejects `/not allowed/`; `'NOPE'` rejects `/no school with the code NOPE/`.
11. **"people-import: a reason and the environment, logged as requested, and refused for an offboarded school"**: `api_gate('people-import','USR','','term starts','TEST')` writes `people-import-requested` with target `school`/`USR`; `''` reason rejects `/say why/`; `'HOSTED'` rejects `/this console is TEST/`; `const o = await buildSchool(db,'USR2')` with `insert into admin.school_profile (org_id, offboarded_at) values (o.org, now())` rejects `/offboarded/`.
12. **"pin-reset: a fresh code, and the ID in the audit details"**: `aal2(ops)` rejects `/authenticator code/`; `fresh(ops)` `api_gate('pin-reset','USR','usr-101','parent called','TEST')` resolves; the audit row `pin-reset-requested` has `details {loginId:'USR-101'}`.
13. **"staff-invite: the owner with a fresh code; the email only as a hash"**: `fresh(ops)` rejects `/not allowed/`; `fresh(owner)` `api_gate('staff-invite','','New.Person@Example.com','hire','TEST')` gives `orgId: null`; the audit row's `details.emailSha256` equals `createHash('sha256').update('new.person@example.com').digest('hex')` (`node:crypto`); its JSON does not contain `'example.com'`.
14. **"an unknown action is refused, after the staff check"**: `aal2(ops)` `api_gate('drop-tables',…)` rejects `/no such action/`; the same as a child rejects `/not allowed/`.

`the audit log viewer`
15. **"owner only; filters by actor, action prefix and India dates; pages by id"**: as `aal2(owner)`: `select * from admin.audit_list(p_actor => $1)` with `ops.id` gives only rows whose `actor` is `ops.id`; `p_action => 'user-'` gives only `user-blocked` and `user-unblocked`; `p_from => today, p_to => today` (IST) includes every row written in this file; `p_from => today + 1` gives none; `p_before => <id of the third row of an unfiltered call>` gives only smaller ids, newest first; `p_limit => 2` gives 2; `p_action => '%'` gives none. As `aal2(ops)` it rejects `/not allowed/`.

Then: add to the `authenticated` list in `admin-invariants.test.ts`, alphabetically: `admin.api_gate`, `admin.audit_list`, `admin.direct_user`, `admin.direct_user_block`, `admin.direct_user_find`, `admin.direct_users_summary`, `admin.staff_invite`, `admin.staff_roster` (`admin.staff_set` stays). And in `admin-foundation.test.ts` add `, 'TEST'` as the last argument of each `admin.staff_set(` call (M2; nothing else in that file changes).

- [ ] **Step 3: Run and see them fail**

Run: `npx vitest run supabase/tests/admin-users-staff.test.ts supabase/tests/admin-invariants.test.ts supabase/tests/admin-foundation.test.ts`
Expected: FAIL: the new functions do not exist; `admin-foundation.test.ts` fails in its five `staff_set` tests with `function admin.staff_set(..., unknown) does not exist`; the invariants list is short.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/0054_admin_users_staff.sql`:

```sql
-- USERS AND STAFF: THE SECOND DOOR, STAFF INVITATIONS, THE GATE THE admin-api
-- FUNCTION ASKS FIRST, AND THE AUDIT LOG'S VIEWER.
--
-- DIRECT USERS came on their own (the tutor's anonymous and permanent
-- sign-ins): an auth.users row that is not a school account (lms.account),
-- not staff (admin.platform_staff), and not made by a school or for staff
-- (app_metadata.provisioned_by). The console counts them, finds one by at
-- least 8 characters of its user ID, and shows a card with no name, phone or
-- address. The one action is a block: recorded here, then applied to the
-- sign-in service by admin-api with the service role.
--
-- STAFF: staff_set takes the environment and accepts only an account made for
-- staff (plan 1's deferred M2). An invitation adds an INACTIVE row; turning it
-- on needs a verified authenticator wherever the platform records factors
-- (auth.mfa_factors). Which roles exist is platform_staff's own check
-- constraint; these functions turn its refusal into a sentence.
--
-- THE GATE: admin-api calls admin.api_gate with the caller's own token before
-- it does anything with the service role, so who may act is decided here.

create table if not exists admin.user_block (
  user_id uuid primary key references auth.users on delete cascade,
  blocked_at timestamptz not null default now(),
  blocked_by uuid
);
revoke all on admin.user_block from public, anon, authenticated;
alter table admin.user_block enable row level security;
drop trigger if exists user_block_tripwire on admin.user_block;
create trigger user_block_tripwire
  after insert or update or delete on admin.user_block
  for each row execute function admin.tripwire();

-- ---------------------------------------------------------------------------
-- Direct users
-- ---------------------------------------------------------------------------

create or replace function admin.is_direct(p_user uuid)
returns boolean
language sql stable security definer
set search_path = admin, lms, public
as $$
  select exists (
    select 1 from auth.users u
     where u.id = p_user
       and coalesce(u.raw_app_meta_data ->> 'provisioned_by', '') not in ('school', 'staff')
       and not exists (select 1 from lms.account a where a.user_id = u.id)
       and not exists (select 1 from admin.platform_staff s where s.user_id = u.id)
  )
$$;

create or replace function admin.direct_user_json(p_user uuid)
returns jsonb
language sql stable security definer
set search_path = admin, lms, public
as $$
  select jsonb_build_object(
    'userId', u.id,
    'ref', left(u.id::text, 8),
    'createdOn', to_char((u.created_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD'),
    'anonymous', u.is_anonymous,
    'lastActiveOn', to_char((greatest(
        (select max(e.at) from public.usage_event e where e.user_id = u.id),
        (select max(ls.received_at) from public.learning_session ls where ls.user_id = u.id),
        (select max(le.received_at) from public.ledger_event le where le.user_id = u.id)
      ) at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD'),
    'sessions', (select count(*)::int from public.learning_session ls where ls.user_id = u.id),
    'schoolCode', (select s.code from public.membership m join lms.school s on s.org_id = m.org_id
                    where m.user_id = u.id order by m.created_at limit 1),
    'contestEntry', exists (select 1 from public.contest_signup c where c.user_id = u.id),
    'consent', exists (select 1 from public.consent_record r where r.user_id = u.id),
    'blocked', exists (select 1 from admin.user_block b where b.user_id = u.id))
    from auth.users u
   where u.id = p_user
$$;

create or replace function admin.direct_users_summary()
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  answer jsonb;
begin
  with direct as (
    select u.id, u.is_anonymous, u.created_at
      from auth.users u
     where coalesce(u.raw_app_meta_data ->> 'provisioned_by', '') not in ('school', 'staff')
       and not exists (select 1 from lms.account a where a.user_id = u.id)
       and not exists (select 1 from admin.platform_staff s where s.user_id = u.id)
  )
  select jsonb_build_object(
           'total', count(*),
           'anonymous', count(*) filter (where d.is_anonymous),
           'permanent', count(*) filter (where not d.is_anonymous),
           'createdLast7Days', count(*) filter (where d.created_at > now() - interval '7 days'),
           'activeLast7Days', count(*) filter (where
              exists (select 1 from public.usage_event e where e.user_id = d.id and e.at > now() - interval '7 days')
              or exists (select 1 from public.learning_session ls where ls.user_id = d.id and ls.received_at > now() - interval '7 days')),
           'withContestEntry', count(*) filter (where exists (select 1 from public.contest_signup c where c.user_id = d.id)),
           'withConsent', count(*) filter (where exists (select 1 from public.consent_record r where r.user_id = d.id)),
           'blocked', count(*) filter (where exists (select 1 from admin.user_block b where b.user_id = d.id)))
    into answer
    from direct d;
  return answer;
end;
$$;

create or replace function admin.direct_user_find(p_ref text)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
  ref text := lower(btrim(coalesce(p_ref, '')));
begin
  if ref !~ '^[0-9a-f-]{8,36}$' then
    raise exception 'type at least the first 8 characters of the user ID';
  end if;
  return coalesce((
    select jsonb_agg(admin.direct_user_json(f.id) order by f.created_at)
      from (select u.id, u.created_at from auth.users u
             where u.id::text like ref || '%' and admin.is_direct(u.id)
             order by u.created_at
             limit 5) f), '[]'::jsonb);
end;
$$;

create or replace function admin.direct_user(p_user uuid)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
begin
  if not admin.is_direct(p_user) then
    raise exception 'this is not a direct user';
  end if;
  return admin.direct_user_json(p_user);
end;
$$;

create or replace function admin.direct_user_block(p_user uuid, p_blocked boolean, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
begin
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  if p_blocked is null then
    raise exception 'say whether to block or unblock';
  end if;
  if exists (select 1 from lms.account a where a.user_id = p_user) then
    raise exception 'this account belongs to a school; disable it from the school''s page';
  end if;
  if exists (select 1 from admin.platform_staff s where s.user_id = p_user) then
    raise exception 'staff are changed on the staff page';
  end if;
  if not admin.is_direct(p_user) then
    raise exception 'this is not a direct user';
  end if;
  perform set_config('admin.session', 'on', true);
  if p_blocked then
    insert into admin.user_block (user_id, blocked_by) values (p_user, me.user_id) on conflict (user_id) do nothing;
    perform lms.end_sessions(p_user);
  else
    delete from admin.user_block b where b.user_id = p_user;
  end if;
  perform admin.audit(me, case when p_blocked then 'user-blocked' else 'user-unblocked' end,
    'user', p_user::text, p_reason, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------

-- 'verified' or 'none' from Supabase Auth's factor table; 'not-captured'
-- where there is no such table (the test harness).
create or replace function admin.factor_state(p_user uuid)
returns text
language plpgsql stable security definer
set search_path = admin, public
as $$
declare
  ok boolean;
begin
  if to_regclass('auth.mfa_factors') is null then
    return 'not-captured';
  end if;
  execute 'select exists (select 1 from auth.mfa_factors f where f.user_id = $1
             and f.factor_type::text = ''totp'' and f.status::text = ''verified'')'
     into ok using p_user;
  return case when ok then 'verified' else 'none' end;
end;
$$;

drop function if exists admin.staff_set(uuid, text, text, boolean, text);

create or replace function admin.staff_set(p_user uuid, p_role text, p_name text, p_active boolean, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
  anon boolean;
  made_by text;
  was_active boolean;
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'give the person a name of up to 80 characters';
  end if;
  perform admin.require_reason(p_reason);
  if p_user = me.user_id and (p_role is distinct from 'owner' or not coalesce(p_active, true)) then
    raise exception 'you cannot demote or deactivate yourself';
  end if;
  select u.is_anonymous, coalesce(u.raw_app_meta_data ->> 'provisioned_by', '') into anon, made_by
    from auth.users u where u.id = p_user;
  if not found then
    raise exception 'there is no such account';
  end if;
  if anon then
    raise exception 'an anonymous account cannot be staff';
  end if;
  if made_by <> 'staff' then
    raise exception 'only an account made for staff can be staff';
  end if;
  select s.active into was_active from admin.platform_staff s where s.user_id = p_user;
  if coalesce(p_active, true) and not coalesce(was_active, false) and admin.factor_state(p_user) = 'none' then
    raise exception 'this person has not set up an authenticator yet';
  end if;
  perform set_config('admin.session', 'on', true);
  begin
    insert into admin.platform_staff (user_id, role, display_name, active, created_by, deactivated_at)
    values (p_user, p_role, btrim(p_name), coalesce(p_active, true), me.user_id,
            case when coalesce(p_active, true) then null else now() end)
    on conflict (user_id) do update
      set role = excluded.role, display_name = excluded.display_name, active = excluded.active,
          deactivated_at = case when excluded.active then null
                                else coalesce(admin.platform_staff.deactivated_at, now()) end;
  exception when check_violation or not_null_violation then
    raise exception 'there is no staff role called %', coalesce(p_role, '(none)');
  end;
  perform admin.audit(me, 'staff-set', 'staff', p_user::text, p_reason,
    jsonb_build_object('role', p_role, 'active', coalesce(p_active, true)));
end;
$$;

create or replace function admin.staff_invite(p_user uuid, p_role text, p_name text, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
  anon boolean;
  made_by text;
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'give the person a name of up to 80 characters';
  end if;
  perform admin.require_reason(p_reason);
  select u.is_anonymous, coalesce(u.raw_app_meta_data ->> 'provisioned_by', '') into anon, made_by
    from auth.users u where u.id = p_user;
  if not found then
    raise exception 'there is no such account';
  end if;
  if anon then
    raise exception 'an anonymous account cannot be staff';
  end if;
  if made_by <> 'staff' then
    raise exception 'only an account made for staff can be staff';
  end if;
  if exists (select 1 from admin.platform_staff s where s.user_id = p_user) then
    raise exception 'this person is already on the staff list';
  end if;
  perform set_config('admin.session', 'on', true);
  begin
    insert into admin.platform_staff (user_id, role, display_name, active, created_by)
    values (p_user, p_role, btrim(p_name), false, me.user_id);
  exception when check_violation or not_null_violation then
    raise exception 'there is no staff role called %', coalesce(p_role, '(none)');
  end;
  perform admin.audit(me, 'staff-invited', 'staff', p_user::text, p_reason, jsonb_build_object('role', p_role));
end;
$$;

create or replace function admin.staff_roster()
returns table (user_id uuid, email text, role text, display_name text, status text, factor text,
               created_at timestamptz, deactivated_at timestamptz)
language plpgsql stable security definer
set search_path = admin, public
as $$
#variable_conflict use_column
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
begin
  return query
    select s.user_id, u.email::text, s.role, s.display_name,
           case when s.active then 'active' when s.deactivated_at is null then 'invited' else 'off' end,
           admin.factor_state(s.user_id), s.created_at, s.deactivated_at
      from admin.platform_staff s
      join auth.users u on u.id = s.user_id
    union all
    select u.id, u.email::text, null::text, null::text, 'account-only', admin.factor_state(u.id), u.created_at, null::timestamptz
      from auth.users u
     where u.raw_app_meta_data ->> 'provisioned_by' = 'staff'
       and not exists (select 1 from admin.platform_staff s2 where s2.user_id = u.id)
    order by 7;
end;
$$;

-- ---------------------------------------------------------------------------
-- The gate admin-api asks, as the caller, before it acts with the service role
-- ---------------------------------------------------------------------------

create or replace function admin.api_gate(p_action text, p_code text, p_target text, p_reason text, p_env text)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff;
  org uuid;
  sc text;
begin
  if p_action in ('people-preview', 'people-import', 'pin-reset') then
    me := admin.require_staff(array['ops']);
  elsif p_action = 'staff-invite' then
    me := admin.require_staff(array[]::text[]);
  else
    -- The staff check first, so a stranger learns nothing about the actions.
    me := admin.require_staff();
    raise exception 'there is no such action';
  end if;
  if p_action in ('pin-reset', 'staff-invite') then
    perform admin.require_fresh_mfa(10);
  end if;
  if p_action <> 'people-preview' then
    perform admin.check_environment(p_env);
    perform admin.require_reason(p_reason);
  end if;
  if p_action <> 'staff-invite' then
    org := admin.school_org(p_code);
    select s.code into sc from lms.school s where s.org_id = org;
    if p_action = 'people-import'
       and exists (select 1 from admin.school_profile p where p.org_id = org and p.offboarded_at is not null) then
      raise exception 'this school is offboarded; bring it back before adding people';
    end if;
  end if;
  if p_action = 'people-import' then
    perform admin.audit(me, 'people-import-requested', 'school', sc, p_reason, '{}'::jsonb);
  elsif p_action = 'pin-reset' then
    perform admin.audit(me, 'pin-reset-requested', 'school', sc, p_reason,
      jsonb_build_object('loginId', upper(btrim(coalesce(p_target, '')))));
  elsif p_action = 'staff-invite' then
    perform admin.audit(me, 'staff-invite-requested', 'staff', '', p_reason,
      jsonb_build_object('emailSha256', encode(sha256(convert_to(lower(btrim(coalesce(p_target, ''))), 'utf8')), 'hex')));
  end if;
  return jsonb_build_object('actor', me.user_id, 'orgId', org);
end;
$$;

-- ---------------------------------------------------------------------------
-- The audit log's viewer
-- ---------------------------------------------------------------------------

create or replace function admin.audit_list(
  p_actor uuid default null, p_action text default null, p_from date default null, p_to date default null,
  p_before bigint default null, p_limit integer default 100
)
returns table (id bigint, at timestamptz, actor uuid, actor_name text, actor_role text, action text,
               target_kind text, target_id text, reason text, details jsonb, environment text)
language plpgsql stable security definer
set search_path = admin, public
as $$
#variable_conflict use_column
declare
  me admin.platform_staff := admin.require_staff(array[]::text[]);
begin
  return query
    select e.id, e.at, e.actor, e.actor_name, e.actor_role, e.action, e.target_kind, e.target_id, e.reason, e.details, e.environment
      from admin.audit_event e
     where (p_actor is null or e.actor = p_actor)
       and (p_action is null or btrim(p_action) = '' or e.action like admin.like_escape(lower(btrim(p_action))) || '%')
       and (p_from is null or e.at >= (p_from::timestamp at time zone 'Asia/Kolkata'))
       and (p_to is null or e.at < ((p_to + 1)::timestamp at time zone 'Asia/Kolkata'))
       and (p_before is null or e.id < p_before)
     order by e.id desc
     limit least(greatest(coalesce(p_limit, 100), 1), 1000);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function admin.is_direct(uuid) from public, anon, authenticated;
revoke all on function admin.direct_user_json(uuid) from public, anon, authenticated;
revoke all on function admin.factor_state(uuid) from public, anon, authenticated;
revoke all on function admin.direct_users_summary() from public, anon;
revoke all on function admin.direct_user_find(text) from public, anon;
revoke all on function admin.direct_user(uuid) from public, anon;
revoke all on function admin.direct_user_block(uuid, boolean, text, text) from public, anon;
revoke all on function admin.staff_set(uuid, text, text, boolean, text, text) from public, anon;
revoke all on function admin.staff_invite(uuid, text, text, text, text) from public, anon;
revoke all on function admin.staff_roster() from public, anon;
revoke all on function admin.api_gate(text, text, text, text, text) from public, anon;
revoke all on function admin.audit_list(uuid, text, date, date, bigint, integer) from public, anon;

grant execute on function admin.direct_users_summary() to authenticated;
grant execute on function admin.direct_user_find(text) to authenticated;
grant execute on function admin.direct_user(uuid) to authenticated;
grant execute on function admin.direct_user_block(uuid, boolean, text, text) to authenticated;
grant execute on function admin.staff_set(uuid, text, text, boolean, text, text) to authenticated;
grant execute on function admin.staff_invite(uuid, text, text, text, text) to authenticated;
grant execute on function admin.staff_roster() to authenticated;
grant execute on function admin.api_gate(text, text, text, text, text) to authenticated;
grant execute on function admin.audit_list(uuid, text, date, date, bigint, integer) to authenticated;
```

- [ ] **Step 5: Run and see them pass**

Run: `npx vitest run supabase/tests/admin-users-staff.test.ts supabase/tests/admin-invariants.test.ts supabase/tests/admin-foundation.test.ts`
Expected: PASS, 15 + 4 + 20 tests.

- [ ] **Step 6: Nothing else moved**

Run: `npx vitest run supabase/tests packages/admin-client`
Expected: PASS, except `packages/admin-client/tests/api.test.ts` if it calls `staffSet` with five arguments (it does not on `eb17436`: it calls `staffList` only), in which case Task 8 fixes it.

- [ ] **Step 7: Commit**

```powershell
git add supabase/migrations/0054_admin_users_staff.sql supabase/tests/admin-standins.ts supabase/tests/admin-users-staff.test.ts supabase/tests/admin-invariants.test.ts supabase/tests/admin-foundation.test.ts
Commit "feat: the second door to users, staff invitations with the authenticator first, the gate for the staff service, and the log viewer (fixes M2)"
```

---

### Task 5: The audit chain, its outside head, and the System page's function (0055)

**Files:**
- Create: `supabase/migrations/0055_admin_audit_chain_system.sql`
- Test: `supabase/tests/admin-audit-chain.test.ts`, `supabase/tests/admin-system.test.ts`
- Modify: `supabase/tests/admin-invariants.test.ts`

**Interfaces:**
- Consumes: `admin.audit_event`, `admin.audit_immutable`, `admin.alert_token`, `admin.alert_miss`, `admin.setting`, `public.relay_control`, `public.usage_event`, `cron.job` (harness and hosted), `cron.job_run_details` and `supabase_migrations.schema_migrations` (hosted; looked up with `to_regclass`).
- Produces: `admin.audit_chain (seq bigint identity pk, event_id bigint unique -> admin.audit_event, prev_hash, hash, chained_at)`, insert-only like the log; `admin.audit_chain_head` (one row, locked by each append); trigger `audit_chain_append` after insert on `admin.audit_event`; `admin.audit_row_hash(prev, row)` = hex SHA-256 of `prev|id|at (UTC, microseconds)|actor|actor_role|actor_name|action|target_kind|target_id|reason|details::text|environment`, the first `prev` being 64 zeros; `admin.audit_verify() returns jsonb {entries, headSeq, headHash, intact, firstBreakSeq, unchained}`; `public.audit_head(p_token text, p_seqs bigint[] default '{}') returns jsonb` with exactly the keys `at, entries, headSeq, headHash, intact, firstBreakSeq, unchained, known` (`known` = `[{seq, hash|null}]` for at most 200 asked-for entries) or `{error:'not-allowed'}`; it records `admin.setting.audit_copy_last_seen`. `admin.system_health() returns jsonb {environment, generatedAt, relay: {halted, haltedReason, events5m, failures5m}, jobs: [{name, schedule, active, lastStatus, lastStartedAt, lastEndedAt}], alarm: {lastCheckMinutesAgo}, auditCopy: {lastCheckMinutesAgo}, migrations: {level}, restoreDrill: {on, daysAgo}, auditChain: {entries, intact, firstBreakSeq, unchained, head}, cashfree: {captured, lastWebhookMinutesAgo, signatureFailures24h, unprocessed, reconciledMinutesAgo}}` (`head` = first 12 hex characters; `cashfree` is spec section 9's Cashfree row, read from plan 3's `billing.webhook_event` (`received_at`, `signature_ok`, `status = 'stored'` for not yet processed) and `admin.setting` `billing_reconciled_at` once they exist, found with `to_regclass`, and `captured: false` with nulls before then; `lastStatus` is pg_cron's status text, `never-run`, or `not-captured`; `level` is the highest applied version or `not-captured`; a missing `relay_control` row reads `halted: true`, as the relay's own claim treats it). `admin.restore_drill_set(p_on date, p_reason, p_env)`.

- [ ] **Step 1: Write the failing tests**

`supabase/tests/admin-audit-chain.test.ts` (8 tests). Each test that damages the log opens its own `freshDatabase()`. Write audit rows with `select admin.audit_service('test-row', 'test', $1, 'a reason', '{}'::jsonb)` as the database owner (`db.query`), which is how migrations call it.

1. **"every new audit row gets the next chain entry, whose hash covers the one before"**: after `setEnvironment` and three `audit_service` rows: `count(audit_chain) = count(audit_event)`; ordered by `seq`, each `prev_hash` equals the previous `hash` and the first is `'0'.repeat(64)`; `select bool_and(c.hash = admin.audit_row_hash(c.prev_hash, e)) from admin.audit_chain c join admin.audit_event e on e.id = c.event_id` is true; `admin.audit_verify()` has `intact true`, `unchained 0`, `entries` = that count.
2. **"rows written before 0055 are chained by the migration"**: `const old = await freshDatabase({ through: '0054' })`; `setEnvironment(old)` and two `audit_service` rows; `await applyAfter(old, '0054')`; `admin.audit_verify()` is `{entries: 3, intact: true, unchained: 0, firstBreakSeq: null, ...}`.
3. **"the chain cannot be edited, even by the service role"**: `asService`: `update admin.audit_chain set hash = 'x'`, `delete from admin.audit_chain`, `truncate admin.audit_chain` each reject `/permission denied|insert-only/`; as the database owner, `update admin.audit_chain set hash = 'x'` rejects `/insert-only/`.
4. **"a row changed behind the trigger's back breaks the chain at that entry"**: own database; four rows; as owner: `alter table admin.audit_event disable trigger audit_no_change; update admin.audit_event set reason = 'edited' where id = <second row's id>; alter table admin.audit_event enable trigger audit_no_change;` then `audit_verify()` has `intact false` and `firstBreakSeq` = that row's `seq`.
5. **"a row and its chain entry deleted together break the chain at the next entry"**: own database; four rows; as owner disable `audit_chain_no_change` and `audit_no_change`, delete the second row's chain entry then the row, enable both; `firstBreakSeq` = the third row's `seq`.
6. **"rows from the tripwire are chained too"**: `update public.relay_control set halted = halted where id` as the database owner (no `admin.session`) writes an `unmanaged-change` row; it has a chain entry and `audit_verify().intact` is still true.
7. **"audit_head answers a wrong or missing token like the alarm does, and counts the miss"**: `select admin.alert_token_set($1)` with a 40-character token (as owner); as `anon` (`set local role anon` in a transaction), `public.audit_head('wrong')` and `public.audit_head(null)` each give `{error:'not-allowed'}`; `admin.alert_miss` gained 2 rows.
8. **"audit_head gives exactly the head, the counts, whether the chain holds, and the hashes asked for, with no row content, to a caller with no sign-in"**: as `anon`, `select public.audit_head($1, '{1,2,999}'::bigint[])`: `Object.keys(a).sort()` equals `['at','entries','firstBreakSeq','headHash','headSeq','intact','known','unchained']`; `known` equals `[{seq:1, hash:<chain seq 1 hash>}, {seq:2, hash:<…>}, {seq:999, hash:null}]`; `JSON.stringify(a)` does not contain `'a reason'` nor `'test-row'`; `admin.setting` has `audit_copy_last_seen`.

`supabase/tests/admin-system.test.ts` (7 tests): setup `db`, `setEnvironment`, `owner`, `ops`, `safety`, `child = anonymousChild(db)`.

1. **"is for staff; reads the relay and its failures in 5 minutes, and 'not-captured' where the platform tables are missing"**: a child and `aal1` reject `/not allowed/`; insert three `public.usage_event` rows for `child` (`relay 'llm', provider 'vertex'`, statuses 200, 503, 0); `admin.system_health()` as `aal2(safety)`: `relay` matches `{halted:false, events5m:3, failures5m:2}`; every `jobs[i].lastStatus` is `'not-captured'` and the names include `admin-revert-caps`, `lms-finalize-tests`, `purge-old-ledger`; `migrations.level` is `'not-captured'`; `restoreDrill.on` is null.
2. **"reads each scheduled job's last run from cron.job_run_details when it exists"**: `addHostedStandIns(db)`; two runs for `admin-revert-caps`'s `jobid` (`select jobid from cron.job where jobname = 'admin-revert-caps'`), the later with status `'failed'`; that job reads `lastStatus 'failed'` with the later `lastStartedAt`; another job reads `'never-run'`.
3. **"reads the migration level from supabase_migrations when it exists"**: insert versions `'0051'`, `'0055'`; `migrations.level` is `'0055'`.
4. **"shows when the alarm and the audit copy last checked"**: set `admin.setting` `alert_last_seen` to `(now() - interval '7 minutes')::text`; set an alarm token and call `public.audit_head(<token>)` as anon; `alarm.lastCheckMinutesAgo` is 7 and `auditCopy.lastCheckMinutesAgo` is 0.
5. **"a restore drill date: owner or ops, with a reason, not in the future and not over a year ago"**: `aal2(ops)` `admin.restore_drill_set(lms.india_today() - 3, 'restored into a scratch project', 'TEST')`; `restoreDrill` equals `{on: <that date>, daysAgo: 3}`; tomorrow and `- 366` reject `/in the last year/`; `aal2(safety)` rejects `/not allowed/`; `'HOSTED'` rejects `/this console is TEST/`; an audit row `restore-drill-recorded` exists.
6. **"shows the audit chain's state"**: `auditChain.intact` true, `entries > 0`, `head` has 12 hex characters.
7. **"reads Cashfree's webhook health from billing's log once it exists, and says not captured before"** (spec section 9): in its own `const early = await freshDatabase({ through: '0055' })` (so the answer is the same before and after plan 3's 0057 is merged), `setEnvironment(early)`, an owner; `admin.system_health() -> 'cashfree'` as `aal2(owner)` equals `{captured:false, lastWebhookMinutesAgo:null, signatureFailures24h:null, unprocessed:null, reconciledMinutesAgo:null}`. Then, as the database owner, a stand-in with only the columns this function reads, named as plan 3's 0057 names them: `create schema if not exists billing; create table billing.webhook_event (id bigint generated always as identity primary key, received_at timestamptz not null, signature_ok boolean not null, status text not null)`; rows `(now() - interval '30 minutes', true, 'processed')`, `(now() - interval '5 minutes', true, 'stored')`, `(now() - interval '2 hours', false, 'signature_failed')`, `(now() - interval '30 hours', false, 'signature_failed')`; `admin.setting` `billing_reconciled_at` = `to_jsonb((now() - interval '70 minutes')::text)`. Now `cashfree` equals `{captured:true, lastWebhookMinutesAgo:5, signatureFailures24h:1, unprocessed:1, reconciledMinutesAgo:70}`. `early.close()`.

`admin-invariants.test.ts`: add `admin.restore_drill_set` and `admin.system_health` to the `authenticated` list; in the last test change the name list to `('app_config', 'alert_snapshot', 'audit_head')`, the expectation to `['alert_snapshot', 'app_config', 'audit_head']`, and its title to "exposes only three functions to the public schema for the apps and the outside checkers".

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run supabase/tests/admin-audit-chain.test.ts supabase/tests/admin-system.test.ts supabase/tests/admin-invariants.test.ts`
Expected: FAIL: `relation "admin.audit_chain" does not exist`, `function admin.system_health() does not exist`, the lists are short.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0055_admin_audit_chain_system.sql`:

```sql
-- THE AUDIT LOG, CHAINED; ITS HEAD FOR THE COPY KEPT OUTSIDE; AND THE
-- PLATFORM'S OWN HEALTH.
--
-- A database superuser can switch off the audit log's triggers (0047). So
-- each audit row also gets an entry in admin.audit_chain whose hash covers the
-- row and the entry before it, and admin.audit_verify recomputes the chain: a
-- row changed or deleted behind the triggers breaks it at that entry. A
-- superuser who rewrites the whole chain consistently is caught from outside:
-- the copy checker (tools/admin-alert/src/audit-copy.ts) keeps the hashes of
-- entries it has seen and asks public.audit_head for them again each hour.
-- Only sequence numbers, hashes and counts leave the database that way.
--
-- admin.system_health is the System page: the relay, each scheduled job's
-- last run (pg_cron's cron.job_run_details, where it exists), when the alarm
-- and the audit copy last checked, the migration level (the Supabase CLI's
-- supabase_migrations.schema_migrations, where it exists), the last restore
-- drill (a date a person types), the chain's state, and Cashfree's webhook
-- health from billing's log once plan 3 has made it. What cannot be read
-- says 'not-captured' (for Cashfree: captured false).

create table if not exists admin.audit_chain (
  seq bigint generated always as identity primary key,
  event_id bigint not null unique references admin.audit_event (id),
  prev_hash text not null,
  hash text not null,
  chained_at timestamptz not null default clock_timestamp()
);
revoke all on admin.audit_chain from public, anon, authenticated, service_role;
alter table admin.audit_chain enable row level security;

drop trigger if exists audit_chain_no_change on admin.audit_chain;
create trigger audit_chain_no_change
  before update or delete on admin.audit_chain
  for each row execute function admin.audit_immutable();
drop trigger if exists audit_chain_no_truncate on admin.audit_chain;
create trigger audit_chain_no_truncate
  before truncate on admin.audit_chain
  for each statement execute function admin.audit_immutable();

-- The newest entry. Each append locks this row first, so appends from
-- concurrent transactions queue instead of both chaining onto the same entry.
create table if not exists admin.audit_chain_head (
  id boolean primary key default true check (id),
  seq bigint not null,
  hash text not null
);
revoke all on admin.audit_chain_head from public, anon, authenticated, service_role;
alter table admin.audit_chain_head enable row level security;

create or replace function admin.audit_row_hash(p_prev text, e admin.audit_event)
returns text
language sql stable
set search_path = admin, public
as $$
  select encode(sha256(convert_to(concat_ws('|',
    p_prev, e.id::text, to_char(e.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    coalesce(e.actor::text, ''), e.actor_role, e.actor_name, e.action, e.target_kind, e.target_id, e.reason,
    e.details::text, e.environment), 'utf8')), 'hex')
$$;

-- Chain what is already in the log, oldest first.
insert into admin.audit_chain_head (id, seq, hash) values (true, 0, repeat('0', 64)) on conflict (id) do nothing;
do $$
declare
  e admin.audit_event;
  prev text := repeat('0', 64);
  last_seq bigint := 0;
begin
  if exists (select 1 from admin.audit_chain) then
    return;
  end if;
  for e in select * from admin.audit_event order by id loop
    insert into admin.audit_chain (event_id, prev_hash, hash)
    values (e.id, prev, admin.audit_row_hash(prev, e))
    returning hash, seq into prev, last_seq;
  end loop;
  update admin.audit_chain_head set seq = last_seq, hash = prev where id;
end
$$;

create or replace function admin.audit_chain_append()
returns trigger
language plpgsql security definer
set search_path = admin, public
as $$
declare
  head admin.audit_chain_head;
  new_hash text;
  new_seq bigint;
begin
  select h.* into head from admin.audit_chain_head h where h.id for update;
  new_hash := admin.audit_row_hash(head.hash, new);
  insert into admin.audit_chain (event_id, prev_hash, hash) values (new.id, head.hash, new_hash)
  returning seq into new_seq;
  update admin.audit_chain_head set seq = new_seq, hash = new_hash where id;
  return null;
end;
$$;

drop trigger if exists audit_chain_append on admin.audit_event;
create trigger audit_chain_append
  after insert on admin.audit_event
  for each row execute function admin.audit_chain_append();

create or replace function admin.audit_verify()
returns jsonb
language plpgsql stable security definer
set search_path = admin, public
as $$
declare
  r record;
  ev admin.audit_event;
  prev text := repeat('0', 64);
  first_break bigint;
  unchained bigint;
begin
  for r in select c.seq, c.event_id, c.prev_hash, c.hash from admin.audit_chain c order by c.seq loop
    select e.* into ev from admin.audit_event e where e.id = r.event_id;
    if ev.id is null or r.prev_hash <> prev or r.hash <> admin.audit_row_hash(prev, ev) then
      first_break := r.seq;
      exit;
    end if;
    prev := r.hash;
  end loop;
  select count(*) into unchained
    from admin.audit_event e
   where not exists (select 1 from admin.audit_chain c where c.event_id = e.id);
  return jsonb_build_object(
    'entries', (select count(*) from admin.audit_chain),
    'headSeq', (select max(c.seq) from admin.audit_chain c),
    'headHash', (select c.hash from admin.audit_chain c order by c.seq desc limit 1),
    'intact', first_break is null and unchained = 0,
    'firstBreakSeq', first_break,
    'unchained', unchained
  );
end;
$$;

create or replace function admin.alert_token_matches(p_token text)
returns boolean
language sql stable security definer
set search_path = admin, public
as $$
  select p_token is not null
     and exists (select 1 from admin.alert_token t
                  where t.id and t.token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex'))
$$;

-- What the copy checker asks, with the alarm's token. Hashes and counts only.
create or replace function public.audit_head(p_token text, p_seqs bigint[] default '{}'::bigint[])
returns jsonb
language plpgsql volatile security definer
set search_path = admin, public
as $$
declare
  v jsonb;
begin
  -- A wrong token is answered and counted, as public.alert_snapshot does (0051).
  if not admin.alert_token_matches(p_token) then
    insert into admin.alert_miss default values;
    delete from admin.alert_miss m where m.at < now() - interval '1 hour';
    return jsonb_build_object('error', 'not-allowed');
  end if;
  v := admin.audit_verify();
  insert into admin.setting (key, value) values ('audit_copy_last_seen', to_jsonb(now()::text))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object(
    'at', now(),
    'entries', v -> 'entries',
    'headSeq', v -> 'headSeq',
    'headHash', v -> 'headHash',
    'intact', v -> 'intact',
    'firstBreakSeq', v -> 'firstBreakSeq',
    'unchained', v -> 'unchained',
    'known', coalesce((
      select jsonb_agg(jsonb_build_object('seq', k.seq, 'hash', c.hash) order by k.seq)
        from (select distinct x as seq from unnest((coalesce(p_seqs, '{}'::bigint[]))[1:200]) x) k
        left join admin.audit_chain c on c.seq = k.seq), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- The System page
-- ---------------------------------------------------------------------------

create or replace function admin.system_health()
returns jsonb
language plpgsql stable security definer
set search_path = admin, public
as $$
declare
  me admin.platform_staff := admin.require_staff();
  rc record;
  recent integer;
  failed integer;
  jobs jsonb;
  level text;
  drill date;
  alarm_seen text;
  copy_seen text;
  reconciled_seen text;
  cashfree jsonb;
  chain jsonb := admin.audit_verify();
begin
  select c.halted, c.halted_reason into rc from public.relay_control c where c.id;
  select count(*)::int, count(*) filter (where e.status = 0 or e.status >= 500)::int
    into recent, failed
    from public.usage_event e where e.at > now() - interval '5 minutes';
  if to_regclass('cron.job_run_details') is null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
             'lastStatus', 'not-captured', 'lastStartedAt', null, 'lastEndedAt', null) order by j.jobname), '[]'::jsonb)
      into jobs from cron.job j;
  else
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
               'lastStatus', coalesce(d.status, 'never-run'), 'lastStartedAt', d.start_time, 'lastEndedAt', d.end_time)
             order by j.jobname), '[]'::jsonb)
        from cron.job j
        left join lateral (
          select r.status::text as status, r.start_time, r.end_time
            from cron.job_run_details r
           where r.jobid = j.jobid
           order by r.start_time desc nulls last
           limit 1
        ) d on true
    $q$ into jobs;
  end if;
  if to_regclass('supabase_migrations.schema_migrations') is null then
    level := 'not-captured';
  else
    execute 'select max(version)::text from supabase_migrations.schema_migrations' into level;
  end if;
  select (s.value #>> '{}')::date into drill from admin.setting s where s.key = 'restore_drill_on';
  select s.value #>> '{}' into alarm_seen from admin.setting s where s.key = 'alert_last_seen';
  select s.value #>> '{}' into copy_seen from admin.setting s where s.key = 'audit_copy_last_seen';
  select s.value #>> '{}' into reconciled_seen from admin.setting s where s.key = 'billing_reconciled_at';
  -- Cashfree (spec section 9): plan 3's webhook log, once its migration has
  -- made it. Counts and minutes only; never a payload.
  if to_regclass('billing.webhook_event') is null then
    cashfree := jsonb_build_object('captured', false, 'lastWebhookMinutesAgo', null,
                                   'signatureFailures24h', null, 'unprocessed', null);
  else
    execute $q$
      select jsonb_build_object(
        'captured', true,
        'lastWebhookMinutesAgo', (select floor(extract(epoch from now() - max(w.received_at)) / 60)::int
                                    from billing.webhook_event w where w.signature_ok),
        'signatureFailures24h', (select count(*)::int from billing.webhook_event w
                                  where not w.signature_ok and w.received_at > now() - interval '24 hours'),
        'unprocessed', (select count(*)::int from billing.webhook_event w where w.status = 'stored'))
    $q$ into cashfree;
  end if;
  cashfree := cashfree || jsonb_build_object('reconciledMinutesAgo',
    case when reconciled_seen is null then null else floor(extract(epoch from now() - reconciled_seen::timestamptz) / 60)::int end);
  return jsonb_build_object(
    'environment', admin.environment(),
    'generatedAt', now(),
    -- No control row reads as stopped, as the relay's own claim treats it.
    'relay', jsonb_build_object('halted', coalesce(rc.halted, true), 'haltedReason', rc.halted_reason,
                                'events5m', recent, 'failures5m', failed),
    'jobs', jobs,
    'alarm', jsonb_build_object('lastCheckMinutesAgo',
      case when alarm_seen is null then null else floor(extract(epoch from now() - alarm_seen::timestamptz) / 60)::int end),
    'auditCopy', jsonb_build_object('lastCheckMinutesAgo',
      case when copy_seen is null then null else floor(extract(epoch from now() - copy_seen::timestamptz) / 60)::int end),
    'migrations', jsonb_build_object('level', level),
    'restoreDrill', jsonb_build_object('on', to_char(drill, 'YYYY-MM-DD'), 'daysAgo', lms.india_today() - drill),
    'auditChain', jsonb_build_object('entries', chain -> 'entries', 'intact', chain -> 'intact',
                                     'firstBreakSeq', chain -> 'firstBreakSeq', 'unchained', chain -> 'unchained',
                                     'head', left(chain ->> 'headHash', 12)),
    'cashfree', cashfree
  );
end;
$$;

create or replace function admin.restore_drill_set(p_on date, p_reason text, p_env text)
returns void
language plpgsql volatile security definer
set search_path = admin, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['ops']);
begin
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  if p_on is null or p_on > lms.india_today() or p_on < lms.india_today() - 365 then
    raise exception 'a restore drill date is in the last year, not in the future';
  end if;
  perform set_config('admin.session', 'on', true);
  insert into admin.setting (key, value) values ('restore_drill_on', to_jsonb(to_char(p_on, 'YYYY-MM-DD')))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform admin.audit(me, 'restore-drill-recorded', 'setting', 'restore_drill_on', p_reason,
    jsonb_build_object('on', to_char(p_on, 'YYYY-MM-DD')));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function admin.audit_row_hash(text, admin.audit_event) from public, anon, authenticated;
revoke all on function admin.audit_chain_append() from public, anon, authenticated;
revoke all on function admin.audit_verify() from public, anon, authenticated;
revoke all on function admin.alert_token_matches(text) from public, anon, authenticated;
revoke all on function public.audit_head(text, bigint[]) from public;
revoke all on function admin.system_health() from public, anon;
revoke all on function admin.restore_drill_set(date, text, text) from public, anon;

grant execute on function public.audit_head(text, bigint[]) to anon, authenticated, service_role;
grant execute on function admin.system_health() to authenticated;
grant execute on function admin.restore_drill_set(date, text, text) to authenticated;
```

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run supabase/tests/admin-audit-chain.test.ts supabase/tests/admin-system.test.ts supabase/tests/admin-invariants.test.ts`
Expected: PASS, 8 + 7 + 4 tests. If `select ... for update` on `audit_chain_head` is refused inside the trigger on PGlite, say so in the report and use `pg_advisory_xact_lock(hashtext('admin.audit_chain'))` followed by a fresh read of the newest `audit_chain` row instead: the tests are the same.

- [ ] **Step 5: All admin database files, and the LMS ones**

Run: `npx vitest run supabase/tests packages/lms-client tools/lms-import`
Expected: PASS. (Every audit row written by any test now also writes a chain row; nothing should notice.)

- [ ] **Step 6: Commit**

```powershell
git add supabase/migrations/0055_admin_audit_chain_system.sql supabase/tests/admin-audit-chain.test.ts supabase/tests/admin-system.test.ts supabase/tests/admin-invariants.test.ts
Commit "feat: the audit log as a hash chain with its head readable from outside, and the platform's health as one function"
```

---

### Task 6: One implementation of import and new PINs, shared with the console

The state of play says plan 2 should reuse the LMS lane's `lms-admin` code rather than write a second one. This task factors the decision-bearing parts of `handleAdmin` into exported functions that take the school and the actor as arguments; `handleAdmin` keeps calling them after its own "is this the school's admin" check, so the school admin's path does not change (its test file passes untouched). Task 7's `admin-api` calls the same functions after the database's staff gate.

**Files:**
- Modify: `tools/lms-import/src/admin.ts`
- Test: `tools/lms-import/tests/admin-shared.test.ts`

**Interfaces:**
- Produces: `export class Refused extends Error { readonly status: number }` (was module-private); `export async function importForSchool(deps: Pick<AdminDeps, 'rpc' | 'store'>, org: string, actor: string, req: Record<string, unknown>): Promise<ImportResponse>` (checks the sheets, previews, and with `commit: true` creates sign-ins and writes `people-added` to the school's log with `actor`); `export async function resetPinForSchool(deps: Pick<AdminDeps, 'rpc' | 'auth'>, org: string, actor: string, loginId: unknown): Promise<{ loginId: string; displayName: string; pin: string }>` (404 `Refused` for an unknown ID; sets the password, ends sessions, writes `pin-reset` with `actor`).

- [ ] **Step 1: Write the failing tests**

Create `tools/lms-import/tests/admin-shared.test.ts`. Copy the `deps()` builder of `tools/lms-import/tests/admin.test.ts` (lines 26-58: `rpc` through `asService` on `lms.<fn>`, `pgliteStore` with the password capture, `auth.setPassword` capture). `beforeAll`: `db = await freshDatabase()`, `one = await buildSchool(db, 'SHR')`, `actor = await createUser(db, { appMeta: { provisioned_by: 'staff' } })`. Three tests:

1. **"importForSchool previews, then commits for the school and actor it is given"**: `importForSchool(deps(), one.org, actor, { students: 'grade,section,roll,name\n8,A,5,Asha Rao\n' })` resolves with `committed: false`, `errors: []`, no password captured; with `commit: true, acceptWarnings: true` it resolves with one `created` entry `{loginId: 'SHR-8A-5', className: '8A'}` whose `pin` matches `/^[1-9]\d{5}$/` and equals the captured password; `lms.audit_event` has `{actor, action: 'people-added', target: '1 people'}`.
2. **"resetPinForSchool gives a new PIN, signs the holder out and logs the actor; an unknown ID is a 404"**: `resetPinForSchool(deps(), one.org, actor, 'shr-8a-5')` resolves `{loginId: 'SHR-8A-5', displayName: 'Asha Rao'}` with a `pin` equal to the captured password; the rpc calls include `end_sessions`; `lms.audit_event` has `{actor, action: 'pin-reset', target: 'SHR-8A-5'}`; `'NOPE-1'` rejects with a `Refused` whose `status` is 404.
3. **"importForSchool refuses a sheet that is not text, with a 400"**: `{ students: 42 }` rejects with `Refused` status 400.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run tools/lms-import/tests/admin-shared.test.ts`
Expected: FAIL: `importForSchool` / `resetPinForSchool` / `Refused` are not exported.

- [ ] **Step 3: Factor `tools/lms-import/src/admin.ts`**

Change only these parts; everything else (the header, `AdminDeps`, `AdminRequest`, `AdminReply`, `ROUTES`, `objectOf`, `adminSchool`, `addParent`, `handleAdmin`) stays as it is.

```ts
// No parameter properties: node runs these files by stripping types only.
export class Refused extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function checkSheets(req: Record<string, unknown>): void {
  for (const k of ['students', 'teachers'] as const) {
    if (req[k] !== undefined && typeof req[k] !== 'string') throw new Refused(400, `${k} must be the text of a CSV.`);
  }
}

/**
 * Adds people from the sheets to one school, with `actor` as the one who did
 * it in the school's activity log. The school admin's calls (handleAdmin,
 * below) and Qrie staff's (tools/admin-api) both come here once their own
 * check has named the school.
 */
export async function importForSchool(
  deps: Pick<AdminDeps, 'rpc' | 'store'>,
  org: string,
  actor: string,
  req: Record<string, unknown>,
): Promise<ImportResponse> {
  checkSheets(req);
  const snapshot = (await deps.rpc('import_snapshot', { p_org: org })) as SchoolSnapshot | null;
  // ... the body of the old importPeople from this line on, unchanged, with
  // `caller` renamed `actor` in the audit_by call.
}

async function importPeople(deps: AdminDeps, caller: string, req: Record<string, unknown>): Promise<ImportResponse> {
  checkSheets(req);
  const org = await adminSchool(deps, caller, 'add people');
  return importForSchool(deps, org, caller, req);
}

/** A new PIN for one person of one school; the old one stops and its holder is signed out everywhere. */
export async function resetPinForSchool(
  deps: Pick<AdminDeps, 'rpc' | 'auth'>,
  org: string,
  actor: string,
  loginId: unknown,
): Promise<{ loginId: string; displayName: string; pin: string }> {
  const id = typeof loginId === 'string' ? loginId.trim().toUpperCase() : '';
  // ... the body of the old resetPin from `const who = ...` on, unchanged, with
  // `caller` renamed `actor` in the audit_by call.
}

async function resetPin(deps: AdminDeps, caller: string, req: Record<string, unknown>) {
  const org = await adminSchool(deps, caller, 'give out new PINs');
  return resetPinForSchool(deps, org, caller, req.loginId);
}
```

(`checkSheets` runs in `importPeople` before `adminSchool`, so a malformed body is still a 400 before the 403, as `admin.test.ts` "asks for the warnings…" expects, and again inside `importForSchool` for the staff path.)

- [ ] **Step 4: Run both test files**

Run: `npx vitest run tools/lms-import/tests/admin-shared.test.ts tools/lms-import/tests/admin.test.ts`
Expected: PASS, 3 + 6 tests. **`admin.test.ts` is not edited**: it is the proof that the school admin's path is unchanged.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no output.

```powershell
git add tools/lms-import/src/admin.ts tools/lms-import/tests/admin-shared.test.ts
Commit "refactor: the school portal's import and new-PIN code takes the school and the actor, so the staff console can run the same code"
```

---

### Task 7: The `admin-api` edge function

**Files:**
- Create: `tools/admin-api/src/handle.ts`, `tools/admin-api/src/password.ts`
- Create: `supabase/functions/admin-api/index.ts`
- Test: `tools/admin-api/tests/handle.test.ts`, `tools/admin-api/tests/password.test.ts`

**Interfaces:**
- Consumes: Task 4's `admin.api_gate`, `admin.staff_invite`, `admin.direct_user_block`; Task 6's `importForSchool`, `resetPinForSchool`, `Refused`; `supabaseRest`, `supabaseStore`.
- Produces: `handleAdminApi(req: ApiRequest, deps: AdminApiDeps): Promise<ApiReply>`; routes `import`, `reset-pin`, `staff-invite`, `user-block` (POST); replies `{status, body}` where a refusal body is `{error: string, code: 'needs-mfa' | 'not-allowed' | 'wrong-environment' | 'other'}`; `class CallerError { message; sqlstate }`; `CALLER_FUNCTIONS = ['api_gate', 'staff_invite', 'direct_user_block']`; `newStaffPassword(length = 20, random?)` from the alphabet `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789` (57 characters, no I, O, l, 0 or 1), unbiased by rejection above 228.

**How a refusal maps** (`refusal(e)` in `handle.ts`):

| Error | Status | Body |
|---|---|---|
| no `Authorization: Bearer …` header | 401 | `{error:'Please sign in again.', code:'not-allowed'}` |
| `CallerError` with `sqlstate` starting `PGRST3` (PostgREST could not use the token) | 401 | same |
| `CallerError` 42501 and message matching `/authenticator code/i` | 403 | `{error:'Confirm with your authenticator code to continue.', code:'needs-mfa'}` |
| `CallerError` 42501 otherwise | 403 | `{error:'You do not have access to this.', code:'not-allowed'}` |
| `CallerError` whose message starts `this console is ` | 409 | `{error: message, code:'wrong-environment'}` |
| `CallerError` P0001 (a sentence the function raised) | 400 | `{error: message, code:'other'}` |
| `Refused` | its status | `{error: message, code:'other'}` |
| anything else | 500 | `{error: SERVER_FAILED, code:'other'}`; the error goes to `console.error` only |

- [ ] **Step 1: Write the failing tests**

`tools/admin-api/tests/password.test.ts` (3): **"20 characters from the alphabet without look-alikes"**; **"two draws differ"**; **"every character of the alphabet appears over many draws, and no other"** (2000 draws joined; its `Set` equals the alphabet's).

`tools/admin-api/tests/handle.test.ts` (14). Setup over the real migrations:

```ts
// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { aal2, anonymousChild, fresh, makeStaff, setEnvironment, type Staff } from '../../../supabase/tests/admin-fixtures.ts';
import { buildSchool, type School } from '../../../supabase/tests/fixtures.ts';
import { asClaims, asService, freshDatabase, type JwtClaims } from '../../../supabase/tests/harness.ts';
import { Refused } from '../../lms-import/src/admin.ts';
import { pgliteStore } from '../../lms-import/src/pgliteStore.ts';
import { CallerError, handleAdminApi, type AdminApiDeps } from '../src/handle.ts';

let db: PGlite;
let owner: Staff; let ops: Staff; let safety: Staff; let child: string; let s: School;
const tokens: Record<string, () => JwtClaims> = {};
const passwords = new Map<string, string>();
const bans = new Map<string, boolean>();
const rpcCalls: string[] = [];
let banFailsOnce = false;

function deps(): AdminApiDeps {
  const base = pgliteStore(db);
  return {
    async asCaller(authorization, fn, args) {
      const claims = tokens[authorization.replace(/^Bearer /, '')];
      if (!claims) throw new CallerError('JWSError JWSInvalidSignature', 'PGRST301');
      const names = Object.keys(args);
      try {
        return await asClaims(db, claims(), async (tx) =>
          (await tx.query<{ v: unknown }>(
            `select admin.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as v`,
            names.map((n) => args[n]),
          )).rows[0]?.v ?? null);
      } catch (e) {
        throw new CallerError((e as Error).message, String((e as { code?: string }).code ?? ''));
      }
    },
    lms: {
      rpc: async (fn, args) => {
        rpcCalls.push(fn);
        const names = Object.keys(args);
        return asService(db, async (tx) =>
          (await tx.query<{ v: unknown }>(
            `select lms.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as v`,
            names.map((n) => args[n]),
          )).rows[0]?.v ?? null);
      },
      store: { ...base, async createAccount(a) { passwords.set(a.loginId, a.password); return base.createAccount(a); } },
      auth: {
        async setPassword(userId, password) {
          const row = (await db.query<{ login_id: string }>(`select login_id from lms.account where user_id = $1`, [userId])).rows[0];
          passwords.set(row.login_id, password);
        },
      },
    },
    authAdmin: {
      async createStaffUser(email, password) {
        if ((await db.query(`select 1 from auth.users where email = $1`, [email])).rows.length) {
          throw new Refused(409, 'An account with that email already exists.');
        }
        const { rows } = await db.query<{ id: string }>(
          `insert into auth.users (email, raw_app_meta_data) values ($1, '{"provisioned_by":"staff"}') returning id`, [email]);
        passwords.set(email, password);
        return rows[0].id;
      },
      async setBanned(userId, banned) {
        if (banFailsOnce) { banFailsOnce = false; throw new Error('auth service 500'); }
        bans.set(userId, banned);
      },
    },
  };
}

const post = (route: string, body: unknown, token?: string) =>
  handleAdminApi({ method: 'POST', path: `/functions/v1/admin-api/${route}`, authorization: token ? `Bearer ${token}` : undefined, body }, deps());

beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav'); ops = await makeStaff(db, 'ops', 'Ops person'); safety = await makeStaff(db, 'safety', 'Safety person');
  child = await anonymousChild(db);
  s = await buildSchool(db, 'API');
  tokens['owner'] = () => aal2(owner); tokens['owner-fresh'] = () => fresh(owner);
  tokens['ops'] = () => aal2(ops); tokens['ops-fresh'] = () => fresh(ops);
  tokens['safety-fresh'] = () => fresh(safety); tokens['child'] = () => ({ sub: child, aal: 'aal2', is_anonymous: true });
});
afterAll(async () => { await db.close(); });
```

The tests, in this order:

1. **"refuses no sign-in, a forged token and a child before anything is created, reset or banned"**: `post('import', {code:'API'})` → 401 `not-allowed`; token `'forged'` → 401; `'child'` → 403 `not-allowed` for each route (`import` with a commit, `reset-pin`, `staff-invite`, `user-block`); afterwards `passwords.size === 0`, `bans.size === 0`, and no `auth.users` row has an email.
2. **"refuses a GET and a route that does not exist"**: GET → 405; `post('nowhere', …)` → 404.
3. **"ops preview, then add people to a school; the school's log names the member of staff"**: preview `{code:'API', students:'grade,section,roll,name\n8,A,5,Asha Rao\n'}` with `'ops'` → 200, `committed false`, no password; commit with `commit:true, acceptWarnings:true, reason:'term starts', env:'TEST'` → 200, `created[0]` `{loginId:'API-8A-5'}` with a 6-digit `pin` equal to the captured password; `lms.audit_event` has `people-added` with `actor = ops.id`; `admin.audit_event` has `people-import-requested`.
4. **"a commit without a reason, or for the wrong environment, creates nobody"**: reason `''` → 400 `{code:'other'}` matching `/say why/`; env `'HOSTED'` → 409 `wrong-environment`; the count of `lms.account` rows is unchanged.
5. **"an offboarded school takes no new people"**: `insert into admin.school_profile (org_id, offboarded_at) values (s2.org, now())` for `s2 = buildSchool(db,'API2')`; commit → 400 `/offboarded/`.
6. **"a new PIN needs a code from the last 10 minutes; then the old PIN stops and its holder is signed out"**: `'ops'` → 403 `needs-mfa`, the captured password for `API-8A-5` unchanged; `'ops-fresh'` `{code:'API', loginId:'api-8a-5', reason:'parent called', env:'TEST'}` → 200 `{loginId:'API-8A-5', displayName:'Asha Rao'}` with a new `pin` equal to the captured one; `rpcCalls` includes `end_sessions`; `lms.audit_event` `pin-reset` has `actor = ops.id`; `admin.audit_event` has `pin-reset-requested`.
7. **"a new PIN for an unknown ID is a 404, and the request is in the platform's log"**: `loginId 'API-999'` → 404; an `admin.audit_event` row `pin-reset-requested` with `details.loginId 'API-999'`.
8. **"the safety reviewer can do none of it"**: `'safety-fresh'` → 403 `not-allowed` on `import` (preview), `reset-pin`, `user-block`, `staff-invite`.
9. **"a staff invite is the owner's with a fresh code: an inactive account made for staff, and its temporary password once"**: `'owner-fresh'` `{email:'New.Person@example.com', displayName:'New Person', role:'ops', reason:'hire', env:'TEST'}` → 200 `{userId, email:'new.person@example.com', temporaryPassword}` (20 characters, equal to the captured one); `auth.users.raw_app_meta_data ->> 'provisioned_by'` is `staff`; `admin.platform_staff` row `active false`; audit rows `staff-invite-requested` and `staff-invited`.
10. **"ops cannot invite; a bad address or one already in use is refused"**: `'ops-fresh'` → 403; `email 'not-an-email'` with `'owner-fresh'` → 400 and no new audit row; the same address as test 9 → 409 `/already exists/`.
11. **"blocking a direct user records it, then bans the sign-in; unblocking reverses both"**: `'ops'` `{userId: child, blocked: true, reason:'scripted abuse', env:'TEST'}` → 200 `{userId: child, blocked: true}`; `admin.user_block` has the row; `bans.get(child) === true`; `blocked: false` → 200, the row is gone, `bans.get(child) === false`.
12. **"a school account cannot be blocked here, and nothing is banned"**: `{userId: s.kid8a, blocked: true, …}` → 400 `/belongs to a school/`; `bans.has(s.kid8a)` false. A `userId` that is not a UUID → 400 before any database call.
13. **"a ban that fails after the record says so, and pressing again is safe"**: `banFailsOnce = true`; block → 502 `/Recorded, but the sign-in service did not confirm it/`; the row exists; block again → 200; two `user-blocked` audit rows.
14. **"an unexpected database failure shows a plain message and logs the details"**: a deps whose `asCaller` throws `new CallerError('relation "x" does not exist', '42P01')`: `import` → 500 with `body.error` equal to `SERVER_FAILED` and not containing `relation`; `vi.spyOn(console, 'error')` was called.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run tools/admin-api`
Expected: FAIL: `../src/handle.ts` and `../src/password.ts` cannot be resolved.

- [ ] **Step 3: Write `tools/admin-api/src/password.ts`**

```ts
/**
 * A temporary password for a new member of staff: shown once to the owner
 * who invited them, given over by phone, never stored by Qrie. No letters or
 * digits that look alike, and every character equally likely.
 */
export const STAFF_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

const LIMIT = 256 - (256 % STAFF_PASSWORD_ALPHABET.length);

export function newStaffPassword(
  length = 20,
  random: (n: number) => Uint8Array = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)),
): string {
  let out = '';
  while (out.length < length) {
    for (const b of random(length)) {
      if (b < LIMIT && out.length < length) out += STAFF_PASSWORD_ALPHABET[b % STAFF_PASSWORD_ALPHABET.length];
    }
  }
  return out;
}
```

- [ ] **Step 4: Write `tools/admin-api/src/handle.ts`**

```ts
import { importForSchool, Refused, resetPinForSchool, type AdminDeps } from '../../lms-import/src/admin.ts';
import { newStaffPassword } from './password.ts';

/**
 * THE STAFF CONSOLE'S SERVICE CALLS, as the admin-api edge function serves
 * them (supabase/functions/admin-api):
 *
 *   POST …/import        {code, students?, teachers?, commit?, acceptWarnings?, reason?, env?} → the import's answer
 *   POST …/reset-pin     {code, loginId, reason, env}            → {loginId, displayName, pin}
 *   POST …/staff-invite  {email, displayName, role, reason, env} → {userId, email, temporaryPassword}
 *   POST …/user-block    {userId, blocked, reason, env}          → {userId, blocked}
 *
 * Each call first asks the database AS THE CALLER, with their own token:
 * admin.api_gate, admin.staff_invite or admin.direct_user_block decide who may
 * act (staff, role, a recent authenticator code, the environment, a reason).
 * Only then does anything happen with the service role. Adding people and new
 * PINs run the LMS lane's own code (tools/lms-import/src/admin.ts) for the
 * school the gate named, with the member of staff as the actor.
 *
 * A refusal answers {error, code}; code is what the console's AdminError
 * branches on.
 */

/** A refusal from the database through PostgREST: its message and SQLSTATE. */
export class CallerError extends Error {
  readonly sqlstate: string;
  constructor(message: string, sqlstate: string) {
    super(message);
    this.sqlstate = sqlstate;
  }
}

export const CALLER_FUNCTIONS = ['api_gate', 'staff_invite', 'direct_user_block'] as const;
export type CallerFunction = (typeof CALLER_FUNCTIONS)[number];

export interface AdminApiDeps {
  /** One admin function, run as the caller (their Authorization header). */
  asCaller(authorization: string, fn: CallerFunction, args: Record<string, unknown>): Promise<unknown>;
  /** The LMS lane's service-role calls (the same shape lms-admin uses). */
  lms: Pick<AdminDeps, 'rpc' | 'store' | 'auth'>;
  /** The auth admin API, with the service role. */
  authAdmin: {
    createStaffUser(email: string, password: string): Promise<string>;
    setBanned(userId: string, banned: boolean): Promise<void>;
  };
  password?: () => string;
}

export interface ApiRequest { method: string; path: string; authorization?: string; body: unknown }
export interface ApiReply { status: number; body: unknown }

const ROUTES = ['import', 'reset-pin', 'staff-invite', 'user-block'] as const;
type Route = (typeof ROUTES)[number];

const EMAIL = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const objectOf = (v: unknown): Record<string, unknown> => {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  throw new Refused(400, 'The request was not a JSON object.');
};

interface Gate { actor: string; orgId: string | null }

const gate = async (deps: AdminApiDeps, auth: string, action: string, b: Record<string, unknown>, target = ''): Promise<Gate> =>
  (await deps.asCaller(auth, 'api_gate', {
    p_action: action, p_code: text(b.code), p_target: target, p_reason: text(b.reason), p_env: text(b.env),
  })) as Gate;

async function importRoute(deps: AdminApiDeps, auth: string, b: Record<string, unknown>) {
  const commit = b.commit === true;
  const g = await gate(deps, auth, commit ? 'people-import' : 'people-preview', b);
  return importForSchool(deps.lms, g.orgId as string, g.actor, {
    students: b.students, teachers: b.teachers, commit, acceptWarnings: b.acceptWarnings === true,
  });
}

async function resetPinRoute(deps: AdminApiDeps, auth: string, b: Record<string, unknown>) {
  const g = await gate(deps, auth, 'pin-reset', b, text(b.loginId));
  return resetPinForSchool(deps.lms, g.orgId as string, g.actor, b.loginId);
}

async function staffInviteRoute(deps: AdminApiDeps, auth: string, b: Record<string, unknown>) {
  const email = text(b.email).toLowerCase();
  if (!EMAIL.test(email)) throw new Refused(400, 'Write an email address.');
  await gate(deps, auth, 'staff-invite', b, email);
  const password = (deps.password ?? newStaffPassword)();
  const userId = await deps.authAdmin.createStaffUser(email, password);
  await deps.asCaller(auth, 'staff_invite', {
    p_user: userId, p_role: text(b.role), p_name: text(b.displayName), p_reason: text(b.reason), p_env: text(b.env),
  });
  return { userId, email, temporaryPassword: password };
}

async function userBlockRoute(deps: AdminApiDeps, auth: string, b: Record<string, unknown>) {
  const userId = text(b.userId);
  if (!UUID.test(userId)) throw new Refused(400, 'That is not a user ID.');
  if (typeof b.blocked !== 'boolean') throw new Refused(400, 'Say whether to block or unblock.');
  await deps.asCaller(auth, 'direct_user_block', {
    p_user: userId, p_blocked: b.blocked, p_reason: text(b.reason), p_env: text(b.env),
  });
  try {
    await deps.authAdmin.setBanned(userId, b.blocked);
  } catch (e) {
    console.error('admin-api', 'ban', e);
    throw new Refused(502, 'Recorded, but the sign-in service did not confirm it. Press again; it is safe to repeat.');
  }
  return { userId, blocked: b.blocked };
}

const SIGN_IN_AGAIN = { status: 401, body: { error: 'Please sign in again.', code: 'not-allowed' } };
export const SERVER_FAILED = 'Something went wrong on the server. Try again in a moment; the details are in the function log.';

function refusal(route: Route, e: unknown): ApiReply {
  if (e instanceof CallerError) {
    if (e.sqlstate.startsWith('PGRST3')) return SIGN_IN_AGAIN;
    if (e.sqlstate === '42501') {
      return /authenticator code/i.test(e.message)
        ? { status: 403, body: { error: 'Confirm with your authenticator code to continue.', code: 'needs-mfa' } }
        : { status: 403, body: { error: 'You do not have access to this.', code: 'not-allowed' } };
    }
    if (/^this console is /i.test(e.message)) return { status: 409, body: { error: e.message, code: 'wrong-environment' } };
    if (e.sqlstate === 'P0001') return { status: 400, body: { error: e.message, code: 'other' } };
  }
  if (e instanceof Refused) return { status: e.status, body: { error: e.message, code: 'other' } };
  // The database's or the server's own words go to the log, not to the screen.
  console.error('admin-api', route, e);
  return { status: 500, body: { error: SERVER_FAILED, code: 'other' } };
}

export async function handleAdminApi(req: ApiRequest, deps: AdminApiDeps): Promise<ApiReply> {
  const route = req.path.replace(/\/+$/, '').split('/').pop() as Route;
  if (!ROUTES.includes(route)) return { status: 404, body: { error: 'There is no such call.', code: 'other' } };
  if (req.method !== 'POST') return { status: 405, body: { error: 'POST only.', code: 'other' } };
  const auth = req.authorization ?? '';
  if (!/^Bearer \S+$/.test(auth)) return SIGN_IN_AGAIN;
  try {
    const b = objectOf(req.body);
    const answer =
      route === 'import' ? await importRoute(deps, auth, b)
      : route === 'reset-pin' ? await resetPinRoute(deps, auth, b)
      : route === 'staff-invite' ? await staffInviteRoute(deps, auth, b)
      : await userBlockRoute(deps, auth, b);
    return { status: 200, body: answer };
  } catch (e) {
    return refusal(route, e);
  }
}
```

- [ ] **Step 5: Run and see them pass**

Run: `npx vitest run tools/admin-api`
Expected: PASS, 3 + 14 tests.

- [ ] **Step 6: Write the Deno adapter**

Create `supabase/functions/admin-api/index.ts`:

```ts
// @ts-nocheck — Deno, not the app's TypeScript project.
//
// THE STAFF CONSOLE'S SERVICE (tools/admin-api/src/handle.ts), as a Supabase
// Edge Function. Everything with a decision in it is in handleAdminApi and is
// covered by tools/admin-api/tests/handle.test.ts over the real migrations.
// This file reads the environment and hands each request over with the real
// services: the caller's own PostgREST calls (their token, the admin schema),
// the service role's REST calls (tools/lms-import supabaseRest/supabaseStore)
// and the auth admin API. It has not run against a deployed project.
//
// Deploy after `supabase db push` has applied 0052 to 0055:
//   supabase functions deploy admin-api --no-verify-jwt
//   supabase secrets set ADMIN_ORIGIN=https://<the console's own address>
// --no-verify-jwt as for lms-admin: the database checks every call as the
// caller. Supabase supplies SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY itself. The console reaches it at
// <SUPABASE_URL>/functions/v1/admin-api.

import { CallerError, CALLER_FUNCTIONS, handleAdminApi } from '../../../tools/admin-api/src/handle.ts';
import { Refused } from '../../../tools/lms-import/src/admin.ts';
import { supabaseRest, supabaseStore } from '../../../tools/lms-import/src/supabaseStore.ts';

const env = (name) => Deno.env.get(name) ?? '';
const SUPABASE_URL = env('SUPABASE_URL');
const ANON_KEY = env('SUPABASE_ANON_KEY');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const ADMIN_ORIGIN = env('ADMIN_ORIGIN');

const CORS = {
  'access-control-allow-origin': ADMIN_ORIGIN,
  vary: 'origin',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
};

const rest = supabaseRest(SUPABASE_URL, SERVICE_ROLE_KEY);

const deps = {
  async asCaller(authorization, fn, args) {
    if (!CALLER_FUNCTIONS.includes(fn)) throw new Error(`not a caller function: ${fn}`);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, authorization, 'content-type': 'application/json', 'content-profile': 'admin' },
      body: JSON.stringify(args),
    });
    const body = await res.text();
    if (!res.ok) {
      let e = {};
      try { e = JSON.parse(body); } catch { /* not JSON */ }
      throw new CallerError(String(e.message ?? `the database answered ${res.status}`), String(e.code ?? `HTTP${res.status}`));
    }
    return body ? JSON.parse(body) : null;
  },
  lms: {
    rpc: (fn, args) => rest(`/rest/v1/rpc/${fn}`, { method: 'POST', profile: 'lms', body: args }),
    store: supabaseStore(SUPABASE_URL, SERVICE_ROLE_KEY),
    auth: {
      async setPassword(userId, password) {
        await rest(`/auth/v1/admin/users/${userId}`, { method: 'PUT', body: { password } });
      },
    },
  },
  authAdmin: {
    async createStaffUser(email, password) {
      let user;
      try {
        user = await rest('/auth/v1/admin/users', {
          method: 'POST',
          body: { email, password, email_confirm: true, app_metadata: { provisioned_by: 'staff' } },
        });
      } catch (e) {
        if (/ 422 /.test(String(e?.message))) throw new Refused(409, 'An account with that email already exists.');
        throw e;
      }
      if (typeof user?.id !== 'string') throw new Error('the auth service made the account but returned no id');
      return user.id;
    },
    async setBanned(userId, banned) {
      await rest(`/auth/v1/admin/users/${userId}`, { method: 'PUT', body: { ban_duration: banned ? '876000h' : 'none' } });
    },
  },
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const missing = [
    ['SUPABASE_URL', SUPABASE_URL],
    ['SUPABASE_ANON_KEY', ANON_KEY],
    ['SUPABASE_SERVICE_ROLE_KEY', SERVICE_ROLE_KEY],
    ['ADMIN_ORIGIN', ADMIN_ORIGIN],
  ].filter(([, v]) => !v).map(([n]) => n);
  if (missing.length > 0) {
    return new Response(JSON.stringify({ error: `admin-api is missing: ${missing.join(', ')}`, code: 'other' }), {
      status: 503, headers: { 'content-type': 'application/json', ...CORS },
    });
  }
  const body = request.method === 'POST' ? await request.json().catch(() => null) : null;
  const out = await handleAdminApi(
    { method: request.method, path: new URL(request.url).pathname, authorization: request.headers.get('authorization') ?? undefined, body },
    deps,
  );
  return new Response(JSON.stringify(out.body), { status: out.status, headers: { 'content-type': 'application/json', ...CORS } });
});
```

Expected: nothing runs it here (no Deno in this repo's toolchain; UNVERIFIED until Aarav deploys). Read it once against `supabase/functions/lms-admin/index.ts` for the same import style.

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no output.

```powershell
git add tools/admin-api supabase/functions/admin-api
Commit "feat: the staff service: people, new PINs, staff invitations and blocks, each after the database said yes as the caller"
```

---

### Task 8: The client modules (S3) and M2 in the client

**Files:**
- Create: `packages/admin-client/src/{admin-api,schools,users,staff,system}.ts`
- Modify: `packages/admin-client/src/index.ts` (five `export *` lines), `packages/admin-client/src/api.ts` (M2: `StaffSetInput.env`, `staffSet` sends `p_env`)
- Test: `packages/admin-client/tests/{admin-api,schools,users-staff-system}.test.ts`

**Interfaces:**
- Produces:
  - `admin-api.ts`: `interface AdminApiCaller { post(route: string, body: Record<string, unknown>): Promise<unknown> }`; `readReply(status: number, body: unknown): unknown` (2xx returns the body; otherwise throws `AdminError(body.error or 'The admin service did not answer properly.', body.code if one of the four, else 'not-allowed' for 401 and 403, else 'other')`); `adminApiUrl(supabaseUrl) = <url without trailing slashes>/functions/v1/admin-api`; `fetchAdminApi(baseUrl, token: () => Promise<string | null>, fetchImpl = fetch): AdminApiCaller` (no token: throws `not-allowed` without fetching; a network failure: `AdminError('Could not reach the admin service.', 'other')`); `replyCaller(send: (route, body) => Promise<{status, body}>): AdminApiCaller`.
  - `schools.ts`: types `Level`, `SignalKey`, `Signal`, `Health`, `SchoolRow`, `SchoolDetail`, `PersonKind`, `PersonHit`, `PersonCard`, `ActivityRow`, `WeekRow`, `Contact`, `Note`, `SchoolNotes`, `SchoolExport`, `ImportResult`, `Write = {reason: string; env: string}`; `createSchoolsClient(t: AdminTransport, api: AdminApiCaller): SchoolsClient` with `index()`, `list()`, `health(code)`, `detail(code)`, `weekly(code, weeks?)`, `people(code, query)`, `person(code, loginId)`, `activity(code, before?)`, `notes(code)`, `create({code, name, board, yearLabel, startsOn, endsOn} & Write): Promise<string>`, `setLicence({code, plan, seats, validUntil} & Write)`, `setQuiet({code, until: string | null} & Write)`, `offboard({code, offboard: boolean} & Write)`, `exportSchool({code} & Write): Promise<SchoolExport>`, `disablePerson({code, loginId} & Write)`, `setContact({code, id?, name, role, phone?, email?} & Write): Promise<string>`, `removeContact({code, id} & Write)`, `addNote({code, kind, body} & Write): Promise<string>`, `importPeople({code, students?, teachers?, commit, acceptWarnings?, reason?, env?}): Promise<ImportResult>` (via `api.post('import', …)`), `resetPin({code, loginId} & Write): Promise<{loginId, displayName, pin}>` (via `api.post('reset-pin', …)`).
  - `users.ts`: `DirectSummary`, `DirectUser`; `createUsersClient(t, api): UsersClient` with `summary()`, `find(ref)`, `user(userId)`, `setBlocked({userId, blocked} & Write)` (via `api.post('user-block', …)`).
  - `staff.ts`: `StaffStatus`, `FactorState`, `RosterRow` (its `role` is `string | null`: the database's role constraint is the authority (seam S6), so plan 3's `finance` needs no change here), `AuditRow` (`id: number`), `AuditFilter {actor?, action?, from?, to?, before?, limit?}`, `Invitation {userId, email, temporaryPassword}`; `createStaffClient(t, api): StaffClient` with `roster()`, `invite({email, displayName, role} & Write)` (via `api.post('staff-invite', …)`), `addExisting({userId, role, displayName} & Write)` (`admin.staff_invite` directly, for an `account-only` row), `auditList(filter)`.
  - `system.ts`: `SystemHealth`, `JobRun`; `createSystemClient(t): SystemClient` with `health()`, `setRestoreDrill({on} & Write)`.
- Conventions every module keeps: every call is wrapped so any failure becomes `toAdminError(e)` (as `api.ts` does); rows are mapped to camelCase; a `date` column is read as `String(v).slice(0, 10)` (PostgREST sends `2026-10-05`, the PGlite transport `2026-10-05T00:00:00.000Z`); a `bigint` id is `Number(v)`; an argument left `undefined` is omitted (the transport drops it, so the SQL default applies).

- [ ] **Step 1: Write the failing tests**

`packages/admin-client/tests/admin-api.test.ts` (6, no database): **"readReply returns the body of a 2xx"**; **"readReply turns {error, code} into a typed AdminError"** (each of the four codes); **"readReply says not-allowed for 401 or 403 without a code, and other for the rest"**; **"readReply has a plain message when the body is not what it should be"**; **"fetchAdminApi posts JSON to <base>/<route> with the bearer token, and asks nothing without one"** (a fake `fetchImpl` records the URL, headers and body; `token` returning `null` throws `not-allowed` and the fake was not called; a fake that throws gives `other` with `'Could not reach the admin service.'`); **"adminApiUrl trims trailing slashes"**.

First move Task 7's test world (the `tokens`, `passwords`, `bans`, `rpcCalls` maps and `deps()`) into `tools/admin-api/tests/deps.ts`, exported as `apiWorld(db: PGlite)` returning `{ deps, tokens, passwords, bans, rpcCalls, failNextBan() }`, and import it in `handle.test.ts` (which must still pass unchanged in behaviour). Then:

`packages/admin-client/tests/schools.test.ts` (6) over `freshDatabase()`, `pgliteAdminTransport` and `replyCaller((route, body) => handleAdminApi({method:'POST', path:'/x/' + route, authorization:'Bearer ' + who, body}, world.deps()))`:

1. **"list, index and health come back typed, with the payment signal"**: after `buildSchool(db,'CLI')` and a licence, `list()[0]` has `{code:'CLI', paymentLevel:'grey', paymentReason:'No billing account yet.', seatsUsed: 2, offboarded: false}`; `index()` is `[{code:'CLI', name:'CLI Public School'}]`; `health('cli').signals` has 9 entries with `key` among the nine names.
2. **"detail, people, person, activity, weekly and notes come back typed"**: `weekly('CLI')` has 8 entries each with `weekStart` matching `/^\d{4}-\d{2}-\d{2}$/` and numeric counts; `people('CLI','riya')[0]` is `{loginId:'CLI-101', kind:'student', displayName:'Riya', className:'8A', leftSchool:false}`; `person('CLI','CLI-101').className` is `'8A'`; `notes('CLI')` is `{quietUntil:null, offboardedAt:null, contacts:[], notes:[]}`.
3. **"the writes send the environment and the reason; a wrong environment is a typed wrong-environment"**: `create({code:'cli2', …, reason:'pilot', env:'TEST'})` returns a uuid; `setQuiet({code:'CLI', until:null, reason:'r', env:'HOSTED'})` rejects with `AdminError` `code 'wrong-environment'`; `addNote` and `setContact` return ids.
4. **"a guarded write with an old code is a typed needs-mfa"**: `setLicence` as `aal2(owner)` rejects `code 'needs-mfa'`; as `fresh(owner)` resolves.
5. **"importPeople and resetPin go through admin-api"**: preview → `committed false`; commit with `acceptWarnings` → `created[0].pin` is 6 digits; `resetPin` as the fresh ops token → a new `pin`; as the stale ops token → `needs-mfa`.
6. **"a child is a typed not-allowed everywhere"**: `list`, `detail`, `people`, `importPeople` each reject `code 'not-allowed'`.

`packages/admin-client/tests/users-staff-system.test.ts` (5):

1. **"summary, find and user come back typed"** (one anonymous child with a learning session: `summary().total === 1`, `find(<first 8>)[0].anonymous === true`, `user(id).sessions === 1`).
2. **"setBlocked goes through admin-api, and the card then says blocked"**.
3. **"roster and auditList come back typed, ids as numbers; invite goes through admin-api and returns the temporary password"** (`typeof auditList({})[0].id === 'number'`; `invite(...)` as fresh owner returns 20 characters; the roster then has an `invited` row).
4. **"health comes back typed and setRestoreDrill records a date"** (`health().jobs` is an array; after `setRestoreDrill({on: <today - 1>, …})`, `health().restoreDrill.daysAgo === 1`).
5. **"staffSet sends the environment (M2)"**: `createAdminClient(...).staffSet({userId: <staff-made account>, role:'ops', displayName:'X', active:true, reason:'r', env:'HOSTED'})` as fresh owner rejects `wrong-environment`; with `env:'TEST'` resolves.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run packages/admin-client`
Expected: FAIL: the five new modules cannot be resolved; `StaffSetInput` has no `env`.

- [ ] **Step 3: Write the modules**

`packages/admin-client/src/admin-api.ts`:

```ts
import { AdminError, type AdminErrorCode } from './errors.ts';

/**
 * Calls to the admin-api edge function (supabase/functions/admin-api): what
 * needs the service role, after the database has said yes as the caller.
 * Every reply goes through readReply, so a screen gets the same typed
 * AdminError it gets from a database function.
 */
export interface AdminApiCaller {
  post(route: string, body: Record<string, unknown>): Promise<unknown>;
}

const CODES: readonly AdminErrorCode[] = ['needs-mfa', 'not-allowed', 'wrong-environment', 'other'];

export function readReply(status: number, body: unknown): unknown {
  if (status >= 200 && status < 300) return body;
  const b = (body && typeof body === 'object' ? body : {}) as { error?: unknown; code?: unknown };
  const code: AdminErrorCode = CODES.includes(b.code as AdminErrorCode)
    ? (b.code as AdminErrorCode)
    : status === 401 || status === 403 ? 'not-allowed' : 'other';
  const message = typeof b.error === 'string' && b.error ? b.error : 'The admin service did not answer properly.';
  throw new AdminError(message, code);
}

export const adminApiUrl = (supabaseUrl: string): string => `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/admin-api`;

export function fetchAdminApi(
  baseUrl: string,
  token: () => Promise<string | null>,
  fetchImpl: typeof fetch = fetch,
): AdminApiCaller {
  return {
    async post(route, body) {
      const t = await token();
      if (!t) throw new AdminError('Please sign in again.', 'not-allowed');
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl}/${route}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch {
        throw new AdminError('Could not reach the admin service.', 'other');
      }
      return readReply(res.status, await res.json().catch(() => null));
    },
  };
}

/** The same reading over any handler's reply: the tests, and an in-process demo. */
export function replyCaller(send: (route: string, body: Record<string, unknown>) => Promise<{ status: number; body: unknown }>): AdminApiCaller {
  return {
    async post(route, body) {
      const r = await send(route, body);
      return readReply(r.status, r.body);
    },
  };
}
```

`schools.ts`, `users.ts`, `staff.ts`, `system.ts`: one factory each, in the style of `api.ts` (`guard`, `str`, `iso`, and a local `day = (v: unknown) => v == null ? null : String(v).slice(0, 10)`), mapping each SQL function of Tasks 2 to 5 to the method named above with its arguments by name (`p_code`, `p_query`, `p_login`, `p_before`, `p_weeks`, `p_name`, `p_board`, `p_year_label`, `p_starts_on`, `p_ends_on`, `p_plan`, `p_seats`, `p_until`, `p_offboard`, `p_id`, `p_role`, `p_phone`, `p_email`, `p_kind`, `p_body`, `p_reason`, `p_env`, `p_ref`, `p_user`, `p_blocked`, `p_actor`, `p_action`, `p_from`, `p_to`, `p_limit`, `p_on`). `rows()` for the functions that return tables (`school_index`, `school_list`, `school_weekly`, `school_people`, `school_activity`, `staff_roster`, `audit_list`), `value()` for the rest. The API calls send camelCase bodies exactly as Task 7's routes read them (`{code, students, teachers, commit, acceptWarnings, reason, env}`, `{code, loginId, reason, env}`, `{email, displayName, role, reason, env}`, `{userId, blocked, reason, env}`).

`index.ts` gains:

```ts
export * from './admin-api.ts';
export * from './schools.ts';
export * from './staff.ts';
export * from './system.ts';
export * from './users.ts';
```

`api.ts` (M2): `StaffSetInput` gains `env: string;` and `staffSet` sends `p_env: i.env` after `p_reason`.

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run packages/admin-client tools/admin-api`
Expected: PASS: plan 1's 4 files plus 6 + 6 + 5 new tests; `tools/admin-api` still 17.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no output.

```powershell
git add packages/admin-client tools/admin-api/tests
Commit "feat: typed client calls for schools, users, staff, the system page and the staff service; staffSet sends the environment (M2)"
```

---

### Task 9: The audit copy kept off the platform

**Files:**
- Create: `tools/admin-alert/src/audit-copy.ts`, `.github/workflows/admin-audit-copy.yml`
- Test: `tools/admin-alert/tests/audit-copy.test.ts`

**Interfaces:**
- Consumes: `public.audit_head` (Task 5); `sendTelegram` (`tools/admin-alert/src/run.ts:39`, imported, not edited); the same six GitHub secrets as the alarm; the variable `ADMIN_ALERT_ENABLED`.
- Produces: `HeadAnswer`, `KnownHead {seq, hash, seenOn}` (`seenOn` = India date); `istDate(now: Date): string`; `problemsWith(known, answer): string[]`; `keepHeads(known, answer, now): KnownHead[]` (the newest 24 plus the first of each India day for the latest 120 days; a seq already known keeps its first-seen hash); `dayLine(known, answer, now): string | null`; `fetchAuditHead(env, seqs, fetchImpl?)`; `runAuditCopy(env, now, store: {read(): Promise<string | null>; write(text: string): Promise<void>}, fetchImpl?)`; CLI: `node --experimental-strip-types tools/admin-alert/src/audit-copy.ts` reads and writes `AUDIT_HEADS_FILE` (default `audit-heads.json`).

**What it does each hour.** It reads the heads it kept (the Actions cache restores the file), asks `public.audit_head` for the current head and the hashes of every kept entry (at most 200), and then: if the chain is broken or a kept entry's hash changed or vanished, it tells **both** chats, with sequence numbers and counts only; once per India day it tells the ops chat the day's head (`Audit log on 2026-10-07: 1234 entries, chain intact, head 1234 3f2a9c1b7d4e5f60.`); it writes the kept heads back (the cache saves them). If it cannot read the database it sends nothing and leaves the file as it was: the five-minute alarm already reports a blind checker. Nothing else is copied: no row, reason, name or ID leaves the database this way (spec section 6; ruling R12).

- [ ] **Step 1: Write the failing tests**

`tools/admin-alert/tests/audit-copy.test.ts` (9), with a fake `fetchImpl` that answers `…/rpc/audit_head` from a variable and records Telegram sends, and an in-memory store:

1. **"a first run keeps the head and posts the day's line to the ops chat"**.
2. **"a later run the same India day keeps the new head and posts nothing"**.
3. **"an entry whose hash changed is reported to both chats, by count, and its first-seen hash is kept"** (the stored file still has the old hash after the run).
4. **"a broken chain is reported to both chats with the entry number"**.
5. **"a blind or refused read sends nothing and leaves the file as it was"** (`fetch` rejects; then `{error:'not-allowed'}`).
6. **"keeps the newest 24 heads and the first head of each India day for 120 days"** (`keepHeads` over 200 synthetic days of hourly heads).
7. **"asks the database for the hashes of every head it keeps, at most 200"** (the request body's `p_seqs`).
8. **"a damaged heads file starts over instead of failing"**.
9. **"no message carries anything but numbers, the words of the template and a 16-character hash prefix"** (every sent text matches `/^[A-Za-z0-9 .,:;()'-]+$/` and contains no `@` and no 64-character hex run).

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run tools/admin-alert/tests/audit-copy.test.ts`
Expected: FAIL: `../src/audit-copy.ts` cannot be resolved.

- [ ] **Step 3: Write `tools/admin-alert/src/audit-copy.ts`**

```ts
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { sendTelegram, type Env } from './run.ts';

/**
 * THE AUDIT LOG'S COPY KEPT OFF THE PLATFORM. Once an hour, from outside the
 * project (.github/workflows/admin-audit-copy.yml), it reads the audit chain's
 * head through public.audit_head with the alarm's token, compares the hashes
 * of entries it saw before with what the database says now, and keeps the new
 * head. A changed, missing or broken entry is told to both chats; once a day
 * the head is told to the ops chat, so the chat history is a second copy.
 *
 * Only sequence numbers, hashes and counts are kept or sent. It holds the
 * public anon key and the alarm's token, no service-role key.
 */

export interface HeadAnswer {
  at: string;
  entries: number;
  headSeq: number | null;
  headHash: string | null;
  intact: boolean;
  firstBreakSeq: number | null;
  unchained: number;
  known: { seq: number; hash: string | null }[];
}

export interface KnownHead {
  seq: number;
  hash: string;
  /** The India date it was first seen, YYYY-MM-DD. */
  seenOn: string;
}

export const istDate = (now: Date): string => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

export function problemsWith(known: KnownHead[], a: HeadAnswer): string[] {
  const out: string[] = [];
  if (!a.intact) {
    out.push(
      a.firstBreakSeq !== null
        ? `The audit log's chain is broken at entry ${a.firstBreakSeq}.`
        : `The audit log has ${a.unchained} entries outside its chain.`,
    );
  }
  const now = new Map(a.known.map((k) => [k.seq, k.hash]));
  const changed = known.filter((k) => now.get(k.seq) !== k.hash).length;
  if (changed > 0) {
    out.push(`${changed} audit log ${changed === 1 ? 'entry no longer matches' : 'entries no longer match'} the copy kept outside. Look before anything else.`);
  }
  return out;
}

export function keepHeads(known: KnownHead[], a: HeadAnswer, now: Date): KnownHead[] {
  const all = [...known];
  if (a.headSeq !== null && a.headHash !== null && !all.some((k) => k.seq === a.headSeq)) {
    all.push({ seq: a.headSeq, hash: a.headHash, seenOn: istDate(now) });
  }
  all.sort((x, y) => x.seq - y.seq);
  const newest = all.slice(-24);
  const firstOfDay = new Map<string, KnownHead>();
  for (const k of all) if (!firstOfDay.has(k.seenOn)) firstOfDay.set(k.seenOn, k);
  const days = [...firstOfDay.values()].slice(-120);
  const keep = new Map<number, KnownHead>();
  for (const k of [...days, ...newest]) keep.set(k.seq, k);
  return [...keep.values()].sort((x, y) => x.seq - y.seq);
}

export function dayLine(known: KnownHead[], a: HeadAnswer, now: Date): string | null {
  const today = istDate(now);
  if (known.some((k) => k.seenOn === today) || a.headSeq === null || a.headHash === null) return null;
  return `Audit log on ${today}: ${a.entries} entries, chain ${a.intact ? 'intact' : 'broken'}, head ${a.headSeq} ${a.headHash.slice(0, 16)}.`;
}

export async function fetchAuditHead(env: Env, seqs: number[], fetchImpl: typeof fetch = fetch): Promise<HeadAnswer | null> {
  try {
    const res = await fetchImpl(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/audit_head`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_token: env.ALERT_TOKEN, p_seqs: seqs.slice(-200) }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as HeadAnswer | { error: string };
    return 'error' in body ? null : body;
  } catch {
    return null;
  }
}

const parse = (text: string | null): KnownHead[] => {
  try {
    const v = JSON.parse(text ?? '[]') as unknown;
    return Array.isArray(v)
      ? v.filter((k): k is KnownHead => typeof k?.seq === 'number' && typeof k?.hash === 'string' && typeof k?.seenOn === 'string')
      : [];
  } catch {
    return [];
  }
};

export async function runAuditCopy(
  env: Env,
  now: Date,
  store: { read(): Promise<string | null>; write(text: string): Promise<void> },
  fetchImpl: typeof fetch = fetch,
): Promise<{ sent: string[]; blind: boolean }> {
  const known = parse(await store.read());
  const answer = await fetchAuditHead(env, known.map((k) => k.seq), fetchImpl);
  if (!answer) return { sent: [], blind: true };
  const sent: string[] = [];
  for (const p of problemsWith(known, answer)) {
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_OPS, p, fetchImpl);
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_SAFETY, p, fetchImpl);
    sent.push(p);
  }
  const line = dayLine(known, answer, now);
  if (line) {
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_OPS, line, fetchImpl);
    sent.push(line);
  }
  await store.write(JSON.stringify(keepHeads(known, answer, now)));
  return { sent, blind: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const get = (k: keyof Env): string => {
    const v = process.env[k];
    if (!v) throw new Error(`${k} is not set`);
    return v;
  };
  const env: Env = {
    SUPABASE_URL: get('SUPABASE_URL'), SUPABASE_ANON_KEY: get('SUPABASE_ANON_KEY'), ALERT_TOKEN: get('ALERT_TOKEN'),
    TELEGRAM_BOT_TOKEN: get('TELEGRAM_BOT_TOKEN'), TELEGRAM_CHAT_OPS: get('TELEGRAM_CHAT_OPS'), TELEGRAM_CHAT_SAFETY: get('TELEGRAM_CHAT_SAFETY'),
  };
  const file = process.env.AUDIT_HEADS_FILE || 'audit-heads.json';
  const store = {
    read: () => fs.readFile(file, 'utf8').catch(() => null),
    write: (text: string) => fs.writeFile(file, text, 'utf8'),
  };
  const r = await runAuditCopy(env, new Date(), store);
  console.log(r.blind ? 'could not read the audit head; nothing kept' : r.sent.length ? `sent ${r.sent.length}` : 'nothing to send');
}
```

(`run.ts` already exports `Env` and `sendTelegram`. Importing `run.ts` does not run its CLI block: that block runs only when `run.ts` itself is the script.)

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run tools/admin-alert`
Expected: PASS: plan 1's 2 files plus 9 tests.

- [ ] **Step 5: The workflow**

Create `.github/workflows/admin-audit-copy.yml`:

```yaml
# THE AUDIT LOG'S COPY KEPT OUTSIDE.
#
# Once an hour, from outside the Supabase project, it asks public.audit_head
# (migration 0055) for the audit chain's head and the hashes of entries it saw
# before, and tells both Telegram chats if any changed. Once a day it posts
# the head to the ops chat. The heads it keeps are a small JSON file carried
# from run to run in the Actions cache (tools/admin-alert/src/audit-copy.ts).
# Only sequence numbers, hashes and counts: no row of the log leaves.
#
# The same secrets as admin-alert.yml, and switched off the same way until the
# repository variable ADMIN_ALERT_ENABLED is 'true'. COST: 24 runs a day, about
# 720 job-minutes a month on a private repository. GitHub evicts a cache entry
# not used for 7 days (UNVERIFIED here, from GitHub's documentation); a lost
# cache starts the kept heads afresh, and the daily lines stay in the chat.
name: Admin audit copy

permissions:
  contents: read

on:
  schedule:
    - cron: '17 * * * *'
  workflow_dispatch:

concurrency:
  group: admin-audit-copy
  cancel-in-progress: false

jobs:
  copy:
    if: ${{ vars.ADMIN_ALERT_ENABLED == 'true' }}
    runs-on: ubuntu-latest
    timeout-minutes: 3
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
          sparse-checkout: tools/admin-alert
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - uses: actions/cache/restore@v4
        with:
          path: audit-heads.json
          key: audit-heads-${{ github.run_id }}
          restore-keys: audit-heads-
      - name: Compare and keep
        run: node --experimental-strip-types tools/admin-alert/src/audit-copy.ts
        env:
          AUDIT_HEADS_FILE: audit-heads.json
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
          ALERT_TOKEN: ${{ secrets.ALERT_TOKEN }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_OPS: ${{ secrets.TELEGRAM_CHAT_OPS }}
          TELEGRAM_CHAT_SAFETY: ${{ secrets.TELEGRAM_CHAT_SAFETY }}
      - uses: actions/cache/save@v4
        if: always() && hashFiles('audit-heads.json') != ''
        with:
          path: audit-heads.json
          key: audit-heads-${{ github.run_id }}
```

- [ ] **Step 6: The CLI runs under type stripping and refuses missing config by name**

Run: `node --experimental-strip-types tools/admin-alert/src/audit-copy.ts`
Expected: throws `SUPABASE_URL is not set`.

- [ ] **Step 7: Commit**

```powershell
git add tools/admin-alert/src/audit-copy.ts tools/admin-alert/tests/audit-copy.test.ts .github/workflows/admin-audit-copy.yml
Commit "feat: the audit log's hashes are checked from outside every hour and its head posted daily"
```

---

### Task 10: The console's plumbing: kit additions, wiring, pure helpers

**Files:**
- Modify: `apps/admin/package.json` (dependencies, versions as `apps/lms/package.json` has them: `@tanstack/react-table ^8.21.3`, `@radix-ui/react-icons ^1.3.2`, `@radix-ui/react-popover ^1.1.15`, `@radix-ui/react-tabs ^1.1.13`, `@radix-ui/react-checkbox ^1.3.3`), `package-lock.json` (by `npm install`)
- Copy from `apps/lms/src` unchanged: `components/data-table/{column-header,faceted-filter,pagination,toolbar,view-options}.tsx`, `components/ui/{tabs,popover,checkbox,textarea}.tsx`, `tanstack-table.d.ts`
- Create: `apps/admin/src/components/data-table/index.ts` (the teacher app's, without the `bulk-actions` line), `src/lib/{health,school-filters,csv,blast,load-state}.ts`, `src/lib/use-load.ts`, `src/components/write-dialog.tsx`
- Modify: `src/lib/client.ts`, `src/router.tsx`, `src/components/layout/data/sidebar-data.ts`, `src/components/command-menu.tsx`
- Test: `apps/admin/tests/{health,school-filters,csv,blast,load-state}.test.ts`

**Interfaces:**
- Consumes: Task 8's client; plan 1's `checkWrite`, `useGuarded`, `useMe`, `EXPECTED_ENV`, `Tone` (`src/lib/tiles.ts`).
- Produces (pure, each importing only relative paths and `@ai-tutor/admin-client`):
  - `health.ts`: `LEVEL_TONE: Record<Level, Tone>` (`green→ok, amber→warn, red→bad, grey→grey`), `LEVEL_RANK` (`red 3, amber 2, grey 1, green 0`), `bySeverity(a, b)` (rank descending, then name), `SIGNAL_TITLE: Record<SignalKey, string>` (`Licence, Payment, Seats, Activation, Teaching, Learning, Attendance, Safety, Last active`).
  - `school-filters.ts`: `interface SchoolFilter { text: string; health: Level[]; payment: Level[]; offboarded: 'show' | 'hide' | 'only' }`, `filterSchools(rows, f)`, `matchSchool(query, index)` (code prefix matches first, then name contains, case-insensitive, at most 8).
  - `csv.ts`: `toCsv(header: string[], rows: (string | number | boolean | null | undefined)[][]): string` (CRLF lines; a field with a comma, quote or line break is quoted with quotes doubled; a **string** starting with `=`, `+`, `-`, `@`, tab or carriage return gets a leading `'` so a spreadsheet does not run it); `csvName(what, env, isoDate)` = `qrie-${what}-${env}-${isoDate}.csv`; `downloadCsv(name, text)` (a Blob and a temporary link; not unit-tested).
  - `blast.ts`: one function per action returning its blast-radius line (listed in Task 11 and 12 with each dialog).
  - `load-state.ts`: `type Loaded<T> = {state:'loading'} | {state:'ready', data: T} | {state:'refused'} | {state:'error', message: string}`; `failed(e): Loaded<never>` (`AdminError` `not-allowed` → `refused`, anything else → `error` with its message).
  - `use-load.ts`: `useLoad<T>(load: () => Promise<T>, deps: unknown[]): { view: Loaded<T>; reload(): void }` (a failed reload keeps showing the last good data, with the error beside it, as Today does).
  - `write-dialog.tsx`: `<WriteDialog open onOpenChange title blast guarded? confirmLabel onConfirm={(w: {reason, env}) => Promise<void>} onDone?>{extra fields}</WriteDialog>`: an `AlertDialog` in the style of the switches page's `ConfirmChange`: the blast line, the extra fields, a reason box, "Type <ENV> to confirm", the error line; on confirm it runs `checkWrite({expectedEnv: EXPECTED_ENV, databaseEnv: me.environment, typed, reason})` and then `guarded(() => onConfirm(verdict))`; a guarded action says "This needs a fresh authenticator code." under the blast line. **Every write of Tasks 11 and 12 goes through it.**
- Wiring: `client.ts` builds `rpc = supabaseAdminTransport(...)` and `api = fetchAdminApi(adminApiUrl(import.meta.env.VITE_SUPABASE_URL ?? ''), async () => (await supabase.auth.getSession()).data.session?.access_token ?? null)` and exports `admin` (unchanged behaviour), `schools`, `users`, `staff`, `system`. Routes `/schools` (`Schools`), `/schools/$code` (`SchoolPage`, `validateSearch` → `{ tab: 'overview' | 'people' | 'activity' | 'billing' | 'switches' | 'notes' }`, default `overview`), `/users`, `/system`, `/staff`, `/account`. Sidebar groups, added without moving plan 1's: `Schools and people` (Schools `/schools`, Users `/users`) after `Overview`; `Platform` (System `/system`, Staff and audit `/staff`, Your account `/account`) after `Control`. Ctrl+K: a "Schools" group that loads `schools.index()` the first time the menu opens and lists every school as an item whose `value` is `"<code> <name>"` (cmdk filters on it) and whose selection navigates to `/schools/$code`.

- [ ] **Step 1: Write the failing tests**

`apps/admin/tests/health.test.ts` (4): **"each level has a tone and grey is never the healthy tone"**; **"bySeverity puts red first, then amber, grey, green, and then by name"**; **"every signal key has a title"** (the nine keys of `SignalKey`); **"LEVEL_RANK orders the four levels"**.
`apps/admin/tests/school-filters.test.ts` (4): **"text matches a code prefix or a name, any case"**; **"health and payment filters keep only the levels asked for; an empty list keeps all"**; **"offboarded schools can be hidden, shown or shown alone"**; **"matchSchool lists code matches before name matches, at most 8"**.
`apps/admin/tests/csv.test.ts` (3): **"quotes a field with a comma, a quote or a line break, and doubles quotes"**; **"a text cell that a spreadsheet would run as a formula starts with an apostrophe; a negative number does not"**; **"empty for null and undefined, CRLF between lines, and the name says what, where and when"**.
`apps/admin/tests/blast.test.ts` (4): **"the licence line names the school, the plan, the seats and the last day, and warns when fewer seats than are in use"**; **"offboarding says the tutor pauses and nothing is deleted; bringing back says the tutor stays paused"**; **"a new PIN says the old one stops at once and to ask the school admin first"**; **"a ceiling raise says it reverts at midnight UTC; a cut below today's spend says the tutor stops taking new work"**.
`apps/admin/tests/load-state.test.ts` (3): **"not-allowed is refused"**; **"any other AdminError is an error with its message"**; **"a plain Error is an error with its message"**.

Each test imports with a relative path, for example `import { toCsv } from '../src/lib/csv.ts';`.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run apps/admin`
Expected: FAIL: the five modules cannot be resolved (plan 1's five test files still pass).

- [ ] **Step 3: Write the five pure modules**

Write `health.ts`, `school-filters.ts`, `csv.ts`, `blast.ts` and `load-state.ts` to the Interfaces above. `blast.ts` exports `blastLicence(code, plan, seats, until, seatsUsed)`, `blastOffboard(code, offboard)`, `blastPause(code, enabled)`, `blastDisable(code, loginId, kind)`, `blastResetPin(code, loginId)`, `blastExport(code)`, `blastImport(code, people)`, `blastCreate(code, yearLabel)`, `blastQuiet(code, until)`, `blastContact(code)`, `blastNote(code)`, `blastBlock(blocked)`, `blastInvite(name, role)`, `blastStaff(name, role, active, wasActive)`, `blastCeiling(units, current, spentToday)`, `blastRestoreDrill(on)`; the wording is in Tasks 11 and 12.

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run apps/admin`
Expected: PASS: plan 1's files plus 18 tests.

- [ ] **Step 5: Kit, dependencies, wiring**

```powershell
foreach ($f in 'column-header','faceted-filter','pagination','toolbar','view-options') { Copy-Item "apps/lms/src/components/data-table/$f.tsx" "apps/admin/src/components/data-table/$f.tsx" -Force }
foreach ($f in 'tabs','popover','checkbox','textarea') { Copy-Item "apps/lms/src/components/ui/$f.tsx" "apps/admin/src/components/ui/$f.tsx" -Force }
Copy-Item apps/lms/src/tanstack-table.d.ts apps/admin/src/tanstack-table.d.ts -Force
```

(Create `apps/admin/src/components/data-table` first if it does not exist.) Add the five dependencies to `apps/admin/package.json`, then `$env:ONNXRUNTIME_NODE_INSTALL = 'skip'; npm install`. Write `index.ts`, `use-load.ts`, `write-dialog.tsx`; change `client.ts`, `router.tsx` (with placeholder components `() => null` for the six pages until Tasks 11 and 12 replace them), `sidebar-data.ts` (icons from `lucide-react`: `School`, `Users`, `Activity`, `ShieldCheck`, `KeyRound`; if one is not in this version, the typecheck names it: take the nearest), and `command-menu.tsx` (replace its header comment's "Later plans add…" with what it now does). In `router.tsx` import TanStack's `useSearch` as `useRouteSearch` where needed: the console's own `useSearch` is the Ctrl+K context.

- [ ] **Step 6: Typecheck and build**

```powershell
npx tsc -p apps/admin/tsconfig.json --noEmit
$env:VITE_SUPABASE_URL = 'http://127.0.0.1:54321'; $env:VITE_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlc2lnbmF0dXJl'; $env:VITE_ADMIN_ENV = 'TEST'
npm run admin:build
Remove-Item -Recurse -Force apps/admin/dist
```

Expected: no type errors; the build ends with `No secret found in N built files.`

- [ ] **Step 7: Commit**

```powershell
git add apps/admin package-lock.json
Commit "feat: the console's data table, tabs and write dialog, the new client wired in, pages routed, and Ctrl+K finds a school"
```

---

### Task 11: The Schools pages

**Files:**
- Create: `apps/admin/src/features/schools/index.tsx` (list), `school-page.tsx`, `tabs/{overview,people,activity,switches,notes}.tsx`, `actions/{create-school,set-licence,offboard,export,import-people,reset-pin,disable-person,quiet,contact,note,pause}.tsx`, `health-card.tsx`
- Create: `apps/admin/src/features/billing/school-billing-tab.tsx` (S2 stub)
- Modify: `src/router.tsx` (the two placeholders become `Schools` and `SchoolPage`)

**Interfaces:** consumes `schools`, `admin.flagList`/`admin.flagSet` (Task 8, plan 1), `WriteDialog`, `useLoad`, `blast.ts`, `health.ts`, `school-filters.ts`, `csv.ts`. Produces `Schools`, `SchoolPage`, and the S2 stub:

```tsx
/** Billing for one school arrives with plan 3, which replaces this file (seam S2). */
export function SchoolBillingTab(props: { orgId: string; code: string }) {
  return (
    <p className='text-sm text-muted-foreground' data-school={props.code}>
      Payments arrive with billing.
    </p>
  );
}
```

**Every screen has four states** (`useLoad`): loading (the teacher app's `Skeleton`s), ready, refused ("Your role cannot see this.", no retry), error (a destructive `Alert` with the message and a "Try again" button). Write buttons are shown only to the roles that may use them (`useMe().role`); the database refuses anyway.

- [ ] **Step 1: The list (`/schools`)**

A `Card` with the teacher app's data table (`useReactTable` with sorting, filtering and pagination; `DataTableToolbar` with a text filter and faceted filters "Health", "Payment" and "Offboarded"; `DataTableColumnHeader` on every column; `DataTablePagination`). Columns: School (name, and the code in `font-mono` below), Plan, Seats ("used of bought", or "No licence"), Licence ends (date and "N days", red at 7 or fewer), Payment (a `Badge` coloured by `LEVEL_TONE`, its reason in a `Tooltip`), Health (a badge with the label, e.g. "Needs attention: no homework published in 14 days"), Last active, Students, Teachers. Default sort `bySeverity`. A row click opens `/schools/$code`. Empty: "No schools yet." with "Create a school" for owner and ops. Header action "Create a school" (owner, ops) opens `create-school.tsx`: code, name, board (Select: CBSE, ICSE, STATE, OTHER), year label, first and last day, through `WriteDialog` with `blastCreate(code, yearLabel)` = "A new, empty school CODE is created with the year LABEL. Nobody can sign in to it until people are added." On success, navigate to the new school.

- [ ] **Step 2: The school page (`/schools/$code`)**

`AdminPage` titled with the school's name, the code and an "Offboarded" badge when it is. Header actions by role: "Add people" (owner, ops), "Pause the tutor" / "Turn the tutor back on" (owner, ops; `pause.tsx`: `admin.flagSet({key:'tutor.enabled', scope:'school', scopeId: code, value, …})` through `WriteDialog` with `guarded` and `blastPause(code, enabled)` = "The tutor pauses for every child at CODE. Homework, marks and the teacher app carry on." / "The tutor is offered again at CODE."), "Set the licence" (owner), "Export" (owner), "Offboard" / "Bring back" (owner). `Tabs` bound to the `tab` search parameter:

- **Overview** (`tabs/overview.tsx`): `health-card.tsx`: the label at the top in its colour, then nine rows (title from `SIGNAL_TITLE`, a coloured dot, the reason), grey rows reading as grey, never as fine; "On holiday until DATE" when set. Beside it: Licence (plan, seats used of bought, last day, days left; "No licence is set" otherwise), the year, counts (students, teachers, admins, parents, left, "ever used": students and teachers), and the contacts (from `schools.notes`, for owner and ops).
- **People** (`tabs/people.tsx`): the counts; a search box ("Name or login ID, at least 2 letters", 300 ms debounce, no request below 2 characters); results (login ID, kind, name, class, "Left" badge; a parent's name arrives masked); a row opens a `Sheet` with `schools.person`: kind, name (a parent's full name appears only here), class and roll, created, left, last active, classes taught / children / parents. Actions in the sheet (owner, ops): "Give a new PIN" (`reset-pin.tsx`: `WriteDialog` `guarded`, `blastResetPin(code, loginId)` = "LOGIN's old PIN stops working at once and they are signed out everywhere. Ask the school admin first: they can do this in the teacher app."; on success the PIN is shown once in a large monospace box with "Shown once. Give it to the person or the school admin now; it is not kept anywhere." and a "Done" button that clears it), "Mark as left" (`disable-person.tsx`: `blastDisable(code, loginId, kind)` = "LOGIN leaves CODE now: signed out and taken out of their classes. The school admin can bring them back from Leavers in the teacher app."). There is no "list everyone" view.
- **Activity** (`tabs/activity.tsx`): the 8-week table (`schools.weekly`: week of, homework published, work handed in, class-days of attendance), then the timeline (`schools.activity`: time in IST, "School" or "Qrie" badge, who, what, target, reason) with "Show older" passing the last row's `at`.
- **Billing**: `<SchoolBillingTab orgId={detail.orgId} code={detail.code} />` imported from `@/features/billing/school-billing-tab`.
- **Switches** (`tabs/switches.tsx`): from `admin.flagList()`, the keys whose `schoolScoped` is true: the switch, the global value (or the safe default), this school's value (or "Not set: the global value applies"), and a control that proposes this school's value through `WriteDialog` (`guarded` when the flag is), with the blast line `blastPause` for `tutor.enabled` and "Every app at CODE follows the new value" otherwise.
- **Notes** (`tabs/notes.tsx`): "On holiday until" (a date between today and 90 days ahead, or "Clear"; `quiet.tsx`, `blastQuiet(code, until)` = "Teaching, learning, attendance and last-active signals read grey until DATE."); contacts (add, edit, remove; name, role, phone with country code or email; `contact.tsx`, `blastContact(code)` = "Saved in Qrie's notes on CODE. The school does not see them."); notes, newest first (add a call or a note of up to 2000 characters; the hint under the box: "Never write a child's name or words here."; `note.tsx`, `blastNote(code)`, same sentence).

- [ ] **Step 3: The actions that are the owner's**

- `set-licence.tsx`: plan (one word), seats, last day; `WriteDialog` `guarded`, `blastLicence(code, plan, seats, until, seatsUsed)` = "CODE's licence becomes PLAN, SEATS seats, until DATE. The school admin sees it at once." plus, when `seats < seatsUsed`, " SEATS_USED seats are in use: the school cannot add students until some leave."
- `offboard.tsx`: `WriteDialog` `guarded`, `blastOffboard(code, true)` = "CODE is offboarded: the tutor pauses for its children and no one can be added. Nothing is deleted: homework, marks and sign-ins stay." / `blastOffboard(code, false)` = "CODE is no longer offboarded. Its tutor switch stays off until someone turns it on."
- `export.tsx`: `WriteDialog` `guarded`, `blastExport(code)` = "A file with the names and IDs of everyone at CODE is saved to this computer. Keep it as you would the school's register." On success three CSV files are downloaded through `toCsv` and `downloadCsv`: `qrie-CODE-people-ENV-DATE.csv` (login ID, kind, name, class, roll, left on), `…-parents-…` (login ID, children's login IDs), `…-work-…` (title, kind, class, subject, published, due, handed in).
- `import-people.tsx` (owner, ops): two file inputs (students sheet, teachers sheet, CSV, read as text in the browser), "Check" → `schools.importPeople({code, students, teachers, commit:false})` → the errors list, the warnings list, the people count, the seats line; "Add N people" (disabled while there are errors; needs "I have read the warnings" ticked when there are warnings) → `WriteDialog` with `blastImport(code, n)` = "N new sign-ins are made at CODE. Their PINs are shown once, on the next screen." → `importPeople({…, commit:true, acceptWarnings, reason, env})` → the created people with their PINs in a table under "Shown once", with "Print" (`window.print()`; the rest of the page is hidden in print by a `print:hidden` class on the layout) and "Done", which clears them.

- [ ] **Step 4: Typecheck, build, look**

```powershell
npx tsc -p apps/admin/tsconfig.json --noEmit
npm run admin:build
Remove-Item -Recurse -Force apps/admin/dist
```

Expected: no errors; `No secret found`. A browser look needs a real project (Task 13, Step 4, UNVERIFIED until then).

- [ ] **Step 5: Commit**

```powershell
git add apps/admin/src
Commit "feat: the schools list and each school's page: health, people, activity, switches, notes, and the actions on a school"
```

---

### Task 12: Users, System, Staff and audit, Your account

**Files:**
- Create: `apps/admin/src/features/users/index.tsx`, `features/system/index.tsx`, `features/system/ceiling.tsx`, `features/staff/index.tsx`, `features/staff/roles.ts`, `features/staff/audit-log.tsx`, `features/account/index.tsx`
- Modify: `src/router.tsx` (the four placeholders become pages)

**Interfaces:** consumes `users`, `system`, `staff`, `admin.relayStatus`, `admin.setCaps`, `admin.staffSet`, `StopControl`, `WriteDialog`, `useLoad`, `toCsv`, `downloadCsv`; produces `STAFF_ROLES = ['owner', 'ops', 'safety'] as const` (`features/staff/roles.ts`; the only list of roles in the console, seam S6) and the four pages.

- [ ] **Step 1: Users (`/users`, owner and ops)**

Two cards. **People in a school** (door 1): a `Select` of `schools.index()`; choosing one goes to `/schools/$code?tab=people`. **People who came on their own** (door 2): tiles from `users.summary()` (total, anonymous, permanent, new in 7 days, active in 7 days, with a contest entry, with a consent record, blocked); a search box "First 8 or more characters of the user ID" → `users.find(ref)` → rows (reference, created, anonymous or permanent, last active, sessions, school or "None", contest entry yes/no, consent yes/no, blocked); a row opens a card with the same fields and "Block sign-in" / "Unblock" (`WriteDialog`, `blastBlock(true)` = "This account cannot sign in or use the tutor until it is unblocked. Its data stays." / `blastBlock(false)` = "This account can sign in again."). The page says, under the search: "No names, phone numbers or addresses are shown here."

- [ ] **Step 2: System (`/system`, every staff role; the writes as noted)**

`AdminPage` with `StopControl` in its actions (plan 1's). Cards from `system.health()` and `admin.relayStatus()` (two independent reads, as Today does):
- **Relay**: running or stopped (with the reason), events and failures in the last 5 minutes. **Daily ceiling** (M4): the ceiling, today's units and their share, a raise's revert day (`capOverride`), and "Change the ceiling" for the owner (`ceiling.tsx`: a number from 1,000 to 1,000,000; `WriteDialog` `guarded`, `blastCeiling(units, current, spentToday)` = for a raise "Up to UNITS units today. The raise goes back to CURRENT at midnight UTC by itself."; for a cut "The ceiling becomes UNITS units." and, when `units <= spentToday`, "Today's spend is already SPENT: stop the tutor first."; it calls `admin.setCaps`).
- **Scheduled jobs**: a table of name, schedule, active, last result (green "succeeded", red "failed", grey "never run" or "not captured"), last start.
- **Alarm** and **Audit copy**: "last checked N minutes ago", red over 15 (alarm) or 90 (copy) minutes, grey "never" when null.
- **Audit log**: "Intact, N entries, head ABCDEF123456" or, red, "Broken at entry N" / "N entries outside the chain".
- **Migrations**: the level, or grey "not captured".
- **Cashfree** (spec section 9): last webhook N minutes ago, signature failures in 24 hours (red when any), events not yet processed (amber when any), last reconciliation N minutes ago (red over 120); grey "Not captured: billing is not installed" when `captured` is false; grey "never" for a null time.
- **Restore drill**: the date and "N days ago" (amber after 90 days, grey when never) and "Record a restore drill" for owner and ops (a date; `WriteDialog`, `blastRestoreDrill(on)` = "Records that a backup was restored and checked on DATE.").

- [ ] **Step 3: Staff and audit (`/staff`, owner only)**

`Tabs`: **Staff** and **Audit log**.
- **Staff**: `staff.roster()` in a table: name (or "No name yet"), email, role, status (Active; Invited, waiting; Switched off; "Account made, not on the list"), authenticator (Set up; Not yet; Not captured), since. "Invite a person": email, name, role (`Select` over `STAFF_ROLES`); `WriteDialog` `guarded`, `blastInvite(name, role)` = "NAME gets a sign-in for Qrie control as ROLE. It stays switched off until you turn it on after they set up an authenticator."; on success a panel shows the email and the temporary password once, with the steps: "1. Tell them the password by phone. 2. They sign in at this address and set up an authenticator app. 3. Call them, check it is them, then press Turn on. 4. They change the password under Your account." Row actions: "Turn on" (enabled when the authenticator is set up or not captured; `WriteDialog` `guarded`, `blastStaff(name, role, true, false)` = "NAME can use Qrie control as ROLE from their next click. Only do this after you have spoken to them."), "Change role", "Switch off" (`blastStaff(…, false, true)` = "NAME loses access on their next click."), and, for an "Account made, not on the list" row, "Add to the list" (`staff.addExisting`). Each goes through `admin.staffSet({…, env})` or `staff.addExisting`.
- **Audit log** (`audit-log.tsx`): filters: person (`Select` of the roster), action (text, matched as a prefix), from and to (dates, India). The table: time (IST), who, role, action, target, reason, details (collapsed JSON). "Show older" passes the smallest id as `before`. "Download as CSV" (owner): pages of 1000 through `staff.auditList` up to 5000 rows, then `toCsv` and `downloadCsv('audit', env, today)`.

- [ ] **Step 4: Your account (`/account`, any staff role)**

Name, role and environment from `useMe()`; "Change your password": new password twice, at least 12 characters, then `supabase.auth.updateUser({ password })` (imported from `@/lib/supabase`); "Your password was changed." or the error. (A person's own password is not an admin-function write, so it does not go through `checkWrite`; it needs no reason or environment.)

- [ ] **Step 5: Typecheck, build, commit**

```powershell
npx tsc -p apps/admin/tsconfig.json --noEmit
npm run admin:build
Remove-Item -Recurse -Force apps/admin/dist
git add apps/admin/src
Commit "feat: the users directory's two doors, the system page with the ceiling (M4), staff with invitations and the audit log, and your own password"
```

Expected: no errors; `No secret found`.

---

### Task 13: Aarav's runbook section, the README, and the whole gate

**Files:**
- Modify: `docs/ops/admin-console.md` (a new section 5), `apps/admin/README.md` (the kit file list gains the copied files of Task 10)

- [ ] **Step 1: The runbook section**

Append to `docs/ops/admin-console.md`:

```markdown
## 5. Schools, users and the audit copy (plan 2): Aarav's steps

Nothing in this section has been run against the hosted project yet.

1. **Migrations 0052 to 0055.** After plan 1's, `npx supabase db push` applies
   them. 0053 replaces `lms.audit_log` so a Qrie staff action shows as "Qrie
   staff" in a school's activity log; 0055 chains every audit row written
   before it.
2. **Deploy the staff service.** `npx supabase functions deploy admin-api
   --no-verify-jwt`, then `npx supabase secrets set
   ADMIN_ORIGIN=https://<the console's address>`. Supabase gives the function
   its URL and keys itself. Until it is deployed, adding people, new PINs,
   staff invitations and blocks answer "Could not reach the admin service";
   everything else works.
3. **Rebuild the console** with the same three values as before and publish it.
4. **The audit copy.** It uses the alarm's secrets and the same
   `ADMIN_ALERT_ENABLED` variable. Run the "Admin audit copy" workflow once by
   hand: the ops chat gets "Audit log on DATE: N entries, chain intact, head …".
   On a private repository it costs about 720 job-minutes a month. If the
   alarm runs from a server instead, run
   `node --experimental-strip-types tools/admin-alert/src/audit-copy.ts`
   from the same cron every hour, with `AUDIT_HEADS_FILE` set to a file that
   survives between runs.
5. **A restore drill.** Restore the latest backup into a scratch Supabase
   project, open a table to see it is there, delete the scratch project, then
   on System press "Record a restore drill" with that day's date.
   (UNVERIFIED: what the dashboard offers on your plan.)
6. **Your backup safety reviewer.** Staff and audit, "Invite a person", role
   safety. Phone them the temporary password; they sign in and set up an
   authenticator; call them back, check it is them, press "Turn on". They then
   change their password under "Your account".
7. **The first check in a browser** (each was only tested on an in-process
   database): open a school, search a person, give a test account a new PIN
   (you will be asked for a fresh code), block and unblock a test direct user,
   invite and turn on a test staff member, and look at System: jobs should say
   "succeeded" or "never run", not "not captured"; the migration level should be
   0055.
```

- [ ] **Step 2: README**

In `apps/admin/README.md`, add to the list of files from the teacher app: `src/components/data-table/*`, `src/components/ui/{tabs,popover,checkbox,textarea}.tsx`, `src/tanstack-table.d.ts`.

- [ ] **Step 3: The whole gate**

```powershell
npm run typecheck
$env:VITE_SUPABASE_URL = 'http://127.0.0.1:54321'; $env:VITE_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlc2lnbmF0dXJl'; $env:VITE_ADMIN_ENV = 'TEST'
npm run admin:build
Remove-Item -Recurse -Force apps/admin/dist
$env:VITE_SUPABASE_ANON_KEY = 'test-anon'
npx vitest run --exclude "tools/measure/**" --exclude "**/node_modules/**" *> "$env:TEMP\qrie-plan2-suite.txt"
Get-Content "$env:TEMP\qrie-plan2-suite.txt" -Tail 40
```

Expected: typecheck clean; the build ends `No secret found in N built files.`; the full suite (7 to 15 minutes) passes with plan 1's 4,292 plus this plan's 136 new tests, and the same skips as before. A failure outside the files this plan touched: compare with Task 1's baseline before changing anything.

- [ ] **Step 4: Browser check (UNVERIFIED until a real project exists)**

Not possible on this machine without a Supabase project. List it in the report as UNVERIFIED and leave it to the runbook's step 7.

- [ ] **Step 5: Commit**

```powershell
git add docs/ops/admin-console.md apps/admin/README.md
Commit "ops: plan 2's steps for Aarav: migrations, the staff service, the audit copy, a restore drill, the first staff invite"
```

Then use superpowers:finishing-a-development-branch. Pushing, deploying and `supabase db push` are Aarav's.

---

## Aarav's steps

Only he can do these; the runbook section (Task 13) has the commands.

1. **Decide four things this plan assumed** (Rulings R3, R5, R8, R9): a new PIN needs a fresh authenticator code; a PIN made by staff is shown once to that staff member; schools work Monday to Saturday (attendance counts as "on time" when marked within 2 days); the safety reviewer may see the schools list and health but not people, users or the audit log.
2. Merge, then `npx supabase db push` (0052 to 0055, after plan 1's 0047 to 0051).
3. `npx supabase functions deploy admin-api --no-verify-jwt` and `npx supabase secrets set ADMIN_ORIGIN=https://<console address>`.
4. Rebuild and publish the console.
5. Run the "Admin audit copy" workflow once by hand (private repository: about 720 job-minutes a month; or run it from a server's cron).
6. Do a restore drill into a scratch project and type its date on System.
7. Invite the backup safety reviewer and turn them on after a phone call.
8. The first browser check (runbook section 5, step 7).

## UNVERIFIED

- **Anything on the hosted project**: the `admin-api` deployment, CORS with `ADMIN_ORIGIN`, whether `--no-verify-jwt` is needed (copied from `lms-admin`'s reasoning), PostgREST's error bodies (`code` 42501 with HTTP 403, P0001 with 400, `PGRST3xx` for an unusable token) and `content-profile: admin`.
- **Supabase Auth admin API**: `ban_duration` values `'876000h'` and `'none'`; the 422 answer for an existing email; `app_metadata.provisioned_by` being present when the sign-up trigger runs (the LMS import relies on the same); whether a ban stops an access token that is still valid (refresh tokens are deleted by `lms.end_sessions`; the access token's own lifetime is the gap).
- **Hosted tables read by `to_regclass`**: `auth.mfa_factors` (`factor_type`, `status` read as text), `cron.job_run_details` (columns and the function owner's right to read it), `supabase_migrations.schema_migrations` (`version` like `0055`). The stand-ins have the columns these functions read and nothing more. If `auth.mfa_factors` is absent on hosted, activation would not wait for an authenticator (R14): the browser check must show "Not yet" for a fresh invitee.
- **The chain under concurrent writers**: the `for update` on `admin.audit_chain_head` is meant to queue appends; PGlite has one connection, so no test exercises two at once.
- **GitHub**: the Actions cache across scheduled runs (eviction after 7 days unused), scheduler delays, Telegram delivery.
- **Deno**: the adapter has not run; it imports `tools/` files from `supabase/functions/` as `lms-admin` does, which is also not yet deployed.
- **The console in a browser**: the data table, tabs, sheets, CSV downloads under the CSP, print of the PIN table, `supabase.auth.updateUser` for a password with MFA on (it may ask for reauthentication).
- **The thresholds' fit**: no real school exists; R8 lists the interpretations.

## Rulings (decisions the spec did not settle; each with its cost if wrong)

- **R1. A new `admin-api` function that runs the LMS lane's own import and PIN code** (factored in Task 6), not a second copy and not new routes inside `lms-admin`. Keeps school admins' and Qrie staff's callers, CORS and authorisation apart. *If wrong:* one extra function to deploy; the same handler can be mounted inside `lms-admin`'s adapter in an hour.
- **R2. The edge function authorises by calling admin SQL functions with the caller's own token** (`api_gate`, `staff_invite`, `direct_user_block`), so "who may do what" stays in SQL, tested on PGlite. *If wrong:* one extra round trip per call.
- **R3. A new PIN needs a fresh authenticator code** (it hands out a credential to a child's account; spec 6's stolen-session threat). *If wrong:* one extra code prompt; drop one line from `api_gate`.
- **R4. The export is the owner's with a fresh code** and holds the register (IDs, names, classes, rolls, left dates), parents by ID with their children's IDs, and a work summary with hand-in counts; no marks, answers, PINs or parent names. *If wrong:* a school wanting marks exports them from the teacher app, or a later plan adds them.
- **R5. A PIN made by staff is shown once to that staff member and never stored**, as the teacher app does for its admin; spec 6's "raw PINs never shown" is read as "no stored PIN is ever shown". *If wrong (a strict reading):* staff could not give PINs at all and the school admin would have to; the reset would need a redesign.
- **R6. "Disable" repeats `lms.mark_left`'s statements inside `admin.school_person_disable`** (a parity test pins them equal; the school admin's `restore_account` undoes it) instead of redefining the LMS lane's function; it also signs the person out and refuses the school's last admin; restoring stays the school admin's. *If wrong:* if the LMS lane changes `mark_left`, the parity test fails, which is the point.
- **R7. `lms.audit_log` is replaced in 0053** so a staff actor reads "Qrie staff" (spec 13). *If wrong:* it touches an LMS lane function; a later LMS redefinition would drop it and a test here would fail.
- **R8. Health interpretations:** "marked on the last school day" is "marked within 2 days" (no calendar; a Monday-to-Saturday week); last active 8 to 14 days is amber (the spec leaves it open); "never published" is red; learning and activation divide by all active students; activation counts a hand-in or a ledger event at this school; safety is grey until someone at the school has used the tutor (the report button is only there); a holiday quiets teaching, learning, attendance and last active, for at most 90 days; among equal colours, safety leads the label. *If wrong:* one function to tune (`admin.school_health_for`) and its tests.
- **R9. Who reads what:** list, health, detail, weekly and System for every staff role; people, a person's card, activity, notes and direct users for owner and ops; the staff roster and audit log for the owner only. *If wrong:* one `require_staff` argument each.
- **R10. A direct user** is an `auth.users` row with no school account, no staff row, and not made by a school or for staff; it is found by at least 8 characters of its user ID (not personal data). *If wrong:* the search is of little use until an app shows the ID (plan 4).
- **R11. The only action at door 2 is block and unblock** (a record here, then the sign-in service's ban through `admin-api`). Direct users have no PIN; erasure is plan 5; there is no impersonation. *If wrong:* none expected.
- **R12. The copy off the platform holds hashes, not rows**: a hash chain in the database, an hourly outside check of kept heads (Actions cache), and a daily head line in the ops chat; the full log leaves only through the owner's own CSV download. Staff-typed reasons could name a child, so they do not go to GitHub or Telegram. *If wrong:* after a total loss of the database the log's content comes only from backups and those downloads.
- **R13. A staff invitation creates the sign-in with a one-time temporary password** shown to the owner, conveyed by phone, changed by the person under "Your account"; an account made but not added (a half-finished invite) is listed and can be finished. *If wrong:* an email invitation flow needs SMTP and a set-password screen.
- **R14. Turning staff on needs a verified TOTP factor where `auth.mfa_factors` exists**; where it does not (the harness), it is allowed and shown as "not captured". *If wrong:* on a project without that table the check would pass silently; the first browser check catches it.
- **R15. Roles are read from `platform_staff`'s own check constraint** by `staff_set` and `staff_invite` (seam S6), and the old five-argument `staff_set` is dropped (M2). *If wrong:* plan 3 must not recreate the old signature (flagged in the seams).
- **R16. Offboarding is a mark plus the school's tutor switch off**, reversible, deleting nothing; it refuses new imports and still allows new PINs. *If wrong:* none expected; plan 3's "ended" state may later subsume it.
- **R17. Notes are append-only; contacts are editable; both take a reason**, like every write. *If wrong:* a little friction.
- **R18. The list computes every school's health on each call**, with no cache. *If wrong:* slow past a few hundred schools; plan 6's nightly rollups fix it.
- **R19. Ctrl+K edits plan 1's `command-menu.tsx`**, which is outside S9's list but which plan 1's comment reserves for this plan. *If wrong:* a small merge conflict if plan 3 touches the menu.
- **R20. The System page reads a missing relay control row as stopped**, as the relay's own claim does, while plan 1's `relay_status` reads it as running (M12). *If wrong:* the two pages disagree only in that broken state.
- **R21. A scheduled job's last result is its status and times**, never pg_cron's `return_message` (it can carry values). *If wrong:* an error's text is read in Supabase instead.

## Self-review

**Spec coverage.** Section 9: the list (Task 2, 11), the page and its six tabs (Tasks 3, 11), the health card with all nine signals and the spec's thresholds (Task 2), the System page (Tasks 5, 12; its Cashfree row reads plan 3's `billing.webhook_event` and `billing_reconciled_at` with `to_regclass`, so it shows "not captured" until plan 3 is merged). Section 8 rows "Schools and the LMS" (create, import, licence, per-school switches, pause, export, offboard; no delete: Tasks 3, 7, 11), "Users" (two doors, a person's card, PIN reset with the school admin first, disable as `mark_left`: Tasks 3, 4, 7, 11, 12), "Staff" (who, when, what they did; add and remove; roles: Tasks 4, 7, 12). Section 5.7 (invited inactive, authenticator, phone, activation: Tasks 4, 7, 12). Section 6 (the log copied off the platform: Tasks 5, 9; never shown or exported: the tests named in Review Focus 3). Section 7's plan-2 objects (`school_list`, `school_detail`, `school_health`, `school_note` (as `school_note`, `school_contact` and `school_profile.quiet_until`), `system_health`). Section 12 navigation (Task 10). Section 13 (licence in the teacher app via `lms.set_licence`; "Qrie staff" in the school's log; seat counts through the shared import). Plan 1's deferrals M2 (Task 4, 8) and M4 (Task 12).

**Seams.** S1 first in 0052, internal, tested for signature and grants (Task 2 test 2). S2 stub file with the exact export and props (Task 11). S3 new modules only, `index.ts` export lines, `client.ts` construction lines (Tasks 8, 10). S4 own routes and nav only (Task 10). S5 `app_config` untouched. S6 one constant; SQL reads roles from the constraint (Tasks 4, 12). S7 `school_set_licence` over `lms.set_licence`; 0041 untouched. S8 0052 to 0055. S9 the allowed files, plus M2, M4 and the command menu, each named.

**Placeholders.** Every migration is written out; the server TypeScript is written out; the console's screens are specified by their data, states, actions, roles and exact wording, with their pure logic tested. Task 8's four client factories are specified by method, SQL function and argument names rather than written out, because they are mechanical mappings in `api.ts`'s style and their tests pin every shape.

**Type consistency.** Signal keys (`licence, payment, seats, activation, teaching, learning, attendance, safety, lastActive`), levels, the `admin-api` routes and bodies, `AdminError` codes, and the role list are the same in SQL, the handler, the client and the console; the client's tests run against the real migrations and the real handler.
