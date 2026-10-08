# Qrie control, Plan 4: The apps obey the console. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The switches the console already stores start to mean something. The tutor, the student app, the teacher app and the contest form each read `public.app_config` at start, on return to the screen and every five minutes, with a built-in safe default whenever the read fails; and where an app cannot be trusted the database enforces the switch itself: the tutor's admission (`public.claim_relay`) refuses a class when the learner's school has the tutor off or is suspended, the contest signup refuses when entries are closed or the day's limit (now a row) is reached, and both import paths refuse an offboarded, suspended or ended school with a sentence the person sees. The minimum build is made safe (M13), the console's lines become true, the sidebar follows the signed-in role, and a finance member gets a stop button and lands on Billing.

**Architecture:** Three migrations (0062 to 0064) put the enforcement in SQL, next to the switches: new flag kinds `version` and `count`, a registered `contest.daily_limit`, one internal `admin.contest_rules()` read by both the signup and `admin.today()`, one internal `admin.import_refusal()` asked by `admin.api_gate` and (through a service-role door `lms.import_refusal`) by the LMS lane's import code, one internal `admin.tutor_enabled_for()` asked by `claim_relay`, and three reads: `public.my_app_config()` (the caller's own school's config, for the tutor app, which does not know its school), `lms.school_billing()` (the school admin's licence and invoice notice) and `admin.stop_status()` (the stop state every staff role may read). Each app gets one small new config module (store or hook, parse, safe defaults, version compare) plus a gate component, hooked in with a few lines; the tutor's compile-time `PROTOTYPE_ONLY_PREPARED` becomes a live binding set from the switch, so no tutor screen changes. No relay TypeScript changes (seam T5): the admission refusal reuses the relay's existing `halted` reason.

**Tech Stack:** Postgres migrations tested on PGlite through `supabase/tests/harness.ts`; React 19 in the four apps (the tutor on React Router and Tailwind 3, the student and teacher apps on TanStack Router, TanStack Query and Tailwind 4, the contest site on Next.js 16), the console's copied UI kit; vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-super-admin-panel-design.md` (sections 4 "the apps depend on the panel only through `public.app_config`", 8 rows Tutor, Student app, Landing and contest, 13, 14 plan-4 row). It lives in the main checkout on `phase3-completion`; read it there, never edit it. Format exemplars: plan 1 `docs/superpowers/plans/2026-10-06-super-admin-foundation.md` (main checkout), plans 2 and 3 in this branch's `docs/superpowers/plans/`.

**Status of this document:** written 2026-10-08 on branch `admin-wiring` (cut from `admin@ade281c`). Nothing in it is built. Every fact about the repository below was read on 2026-10-08 in this worktree and cites its file and line; everything else is marked UNVERIFIED.

---

## Where it builds on plans 1 to 3 and the apps (read 2026-10-08)

**Switches and their reader.**
- `admin.flag_def (key, kind check in ('bool','text','tone'), safe_default jsonb, school_scoped, guarded, description)` (`supabase/migrations/0050_admin_flags.sql:21-28`). The nine rows (`0050:50-60`): `banner.message` text `""`, `banner.tone` tone `"info"`, `tutor.enabled` bool `true` (school-scoped, guarded), `tutor.only_prepared` bool `false` (guarded), `tutor.compose_live_classes` bool `false` (guarded), `contest.entries_open` bool `true` (guarded), `app.min_version.classroom|student|lms` **text** `"0.0.0"` (not guarded). M13 is this: a min_version is free text up to 280 characters (`0050:68`).
- `admin.flag_valid(p_kind, p_value)` is `language sql immutable`, no search_path, revoked from public, anon, authenticated (`0050:62-72, 153`). `admin.flag_set` calls `admin.flag_valid(def.kind, p_value)`; its current body is plan 2's, with R23 (`tutor.enabled = true` is the owner's) (`supabase/migrations/0053_admin_school_page.sql:440-487`). This plan does not recreate `flag_set` (T11).
- `public.app_config(p_school text default null)`: every flag's school value over the global one over the safe default, plus plan 3's `billing.state` (`ok|grace|suspended`), `billing.grace_until` and `tutor.enabled = false` for a suspended school (`supabase/migrations/0060_billing_states.sql:56-83`); granted to anon, authenticated, service_role. It aggregates every `flag_def` row, so a new row appears in it with no change to the function. This plan does not change it (T4).
- `billing.state_for(p_org uuid, p_day date) returns table (state text, grace_until date)`, states `none|trial|active|grace|suspended|ended` (`0060:31-50`), revoked from every API role (`0060:283`). `lms.india_today()` (`supabase/migrations/0036_*.sql:32`).
- Tests that pin the switches: `supabase/tests/admin-flags.test.ts` (defaults, types, guarded); `supabase/tests/billing-states.test.ts` "app_config with no school says ok and keeps every plan-1 key" uses `toEqual` on the whole object (`billing-states.test.ts:148-162`), so a new flag row must be added there.

**The contest.**
- `public.record_contest_signup(8 args) returns void`, SECURITY DEFINER, `set search_path = public`, granted to `authenticated` only (`supabase/migrations/0020_contest_signup_and_otp_attempts.sql:98-184`). Its daily limit is `day_project constant integer := 2000` over a **UTC** day (`0020:131-133`), counted only for a new entry, under `pg_advisory_xact_lock(hashtext('contest_signup_day'))`, refused with errcode `53400` (`0020:148-158`). It reads no switch.
- `admin.today()` repeats 2000 and counts entries from the UTC day start (`supabase/migrations/0049_admin_today.sql:20, 44, 66`); `supabase/tests/admin-today.test.ts:91-102` pins the constant in 0020's text and `dailyCap: 2000`. No migration after 0049 replaces `admin.today` (checked: `grep "function admin.today" supabase/migrations`).
- The form: `landing/lib/contest.ts:64-118` (`saveEntry`, maps `53400` to "Entries are full for today", its comment says the cap lifts "until midnight UTC", `contest.ts:106-108`); the page `landing/app/challenge-register/page.tsx:28-64` (four states). `landing/` is not an npm workspace (root `package.json` `workspaces`), is not in vitest's `include` (`vitest.config.ts:58-63`), has its own `package-lock.json`, and has no `node_modules` in this worktree (measured 2026-10-08). `tools/bin/build-site.mjs` builds the **classroom** into `landing/public/app` and then builds `landing`, so a landing deploy ships the classroom of the same branch.

**Imports.**
- Plan 2's gate refuses `people-import` for an offboarded school with `'this school is offboarded; bring it back before adding people'` (`supabase/migrations/0054_admin_users_staff.sql:359-362`), raised as P0001; `tools/admin-api/src/handle.ts` turns P0001 into `400 {error: message}` (`handle.ts` `refusal()`); tests match `/offboarded/` (`supabase/tests/admin-users-staff.test.ts:206-216`, `tools/admin-api/tests/handle.test.ts:117-127`). The gate's grants: `0054:434, 444`.
- One shared import, `importForSchool(deps, org, actor, req)` (`tools/lms-import/src/admin.ts:89-139`), is called by the school admin's hosted path (`handleAdmin` through `importPeople`, `admin.ts:141-145`, served by `supabase/functions/lms-admin/index.ts`) and by staff (`tools/admin-api/src/handle.ts` `importRoute`). Its `deps.rpc(fn, args)` runs `lms.<fn>` with the service role (`lms-admin/index.ts` `rpc`, `profile: 'lms'`; tests bind it to PGlite, `tools/lms-import/tests/admin.test.ts:33-44`, `tools/admin-api/tests/deps.ts`). The demo school's admin import is separate code, `importForAdmin(db, caller, request)` (`tools/lms-demo/src/import.ts:55-110`), over the same SQL (`lms.admin_school`, `lms.import_snapshot`). No SQL function writes the people: the store does (`tools/lms-import/src/apply.ts`), so the refusal is asked before the snapshot.
- **A third path writes people to the hosted project: the founder's laptop CLI** (`tools/lms-import/src/cli.ts:42-112`, `--apply` with `SUPABASE_SERVICE_ROLE_KEY`), which calls `applyPlan(plan, supabaseStore(url, key))` directly (`cli.ts:90`) and creates the school itself when it is new (`supabaseStore.ts:70-82` `ensureSchool`). It goes through neither `importForSchool` nor `api_gate`. `applyPlan` (`apply.ts:70-140`) is shared by all three hosted paths (lms-admin and admin-api reach it through `importForSchool` with `supabaseStore`, `lms-admin/index.ts:45`, `admin-api/index.ts:57`); `ImportStore` is `apply.ts:35-48`. The cross-check of 2026-10-08 found this path; Task 4 closes it (ruling R24).
- `lms.admin_school`, `lms.import_snapshot` and the other 0046 helpers are service-role only (`supabase/migrations/0046_lms_admin_service.sql:148-162`); `supabase/tests/lms-invariants.test.ts:59-97` lists the lms functions that must stay closed to `authenticated`.

**The tutor's admission.**
- `public.claim_relay(p_user uuid, p_relay text, p_units integer) returns table (allowed, reason, retry_after)`, last replaced in `supabase/migrations/0016_relay_control.sql:50-179`: missing control row and `halted` return first (`0016:86-98`), then the per-minute window, the student's day, the project's day; service_role only (`0016:178-179`). Its tests: `supabase/tests/admin-relay.test.ts:56-63`, and the text checks in `apps/classroom/tests/migrations.test.ts` read 0016's file by name (`migrations.test.ts:19`), not the latest definition.
- The relay maps a reason to a sentence; **"Anything else is read as a rate limit"** (`packages/relay/src/gate.ts:234-235`), and a report is let through only `halted`, `capped` and `budget` (`gate.ts:338-342`, tested `packages/relay/tests/gate.test.ts:209`). So a new reason string from SQL would reach a child as "That is a lot of asking at once" and would **block reports**, on this branch and on the live relay (which runs from `phase3-completion` and `voice-stt-tts`). Ruling R1.
- The learner's school: `public.org_of(p_user)` prefers a school membership (`supabase/migrations/0021_school_safe_tenancy.sql:74-90`, service_role only); imported school accounts get a school membership (`tools/lms-import/src/supabaseStore.ts:125`, `pgliteStore.ts:64`). `lms.school (org_id, code)` (`supabase/migrations/0022_lms_school_structure.sql:46-60`).

**The apps today.**
- Tutor (`apps/classroom`, version `0.0.1`): `PROTOTYPE_ONLY_PREPARED = true` on this branch (`apps/classroom/src/lib/prototype.ts:23`), `false` on `phase3-completion` and `voice-stt-tts` (their `prototype.ts:29`, read with `git show`); read by eight screens and `isFrozen` (`prototype.ts:59`; `Chapter.tsx:71,134`, `Home.tsx:200,230,233`, `LiveClass.tsx:499`, `Search.tsx:111,116`, `StudyPlan.tsx:185`, `Syllabus.tsx:499-506`, `AskBox.tsx:59`) and pinned by `apps/classroom/tests/prototypeGate.test.tsx:108-112`. `COMPOSE_LIVE_CLASSES` exists only on branch `board-composer` (`apps/classroom/src/lib/liveClass.ts:52, 449` there); no screen on this branch or the live branches reads a composer switch. Supabase client: `apps/classroom/src/lib/supabase.ts:31-40` (null when unconfigured). Start-up side effects live in `main.tsx:114-165`; routes in `App.tsx:593-650`. The tutor does not know its learner's school.
- Student app (`apps/student`, `0.0.1`) and teacher app (`apps/lms`, `2.2.1`) talk to the database only through `packages/lms-client` `Backend` (`packages/lms-client/src/backend.ts:18-53`), today the demo server (`apps/student/src/lib/backend.ts:7`, `apps/lms/src/lib/backend.ts`), later `supabaseBackend`. `Me.schoolCode` is known after sign-in (`packages/lms-client/src/api.ts:22-34`). `RpcClient.schema` accepts only `'lms'` (`packages/lms-client/src/transport.ts:26-33`). Root routes: `apps/student/src/routes/__root.tsx`, `apps/lms/src/routes/__root.tsx` (both render `<Outlet />` inside `QueryClientProvider`). The teacher app's licence banner, admin only: `apps/lms/src/features/school/licence.tsx:42-65` with `licenceWarnings` (`api.ts:610-619`), whose "ended" text says "Everyone can still sign in and use Qrie" (`licence.tsx:22`). Root vitest maps `@` to `apps/lms/src` (`vitest.config.ts:44`), so the student app's tests import by relative path (`apps/student/tests/mastery-info.test.tsx:4`).
- The demo server's unsigned route for the sign-in screen runs as `anon`: `GET /public/school-brand/<code>` (`tools/lms-demo/src/server.ts:176-186`).

**The console.**
- `describeFlagChange` and `SWITCH_NOT_READ` ("No app reads this switch yet (plan 4)") (`apps/admin/src/lib/confirm.ts:34-60`); the school blasts that repeat it (`apps/admin/src/lib/blast.ts:13-36`); their tests (`apps/admin/tests/confirm.test.ts:30-50`, `blast.test.ts:17-34`); the Switches page's editor knows `bool`, `tone` and text (`apps/admin/src/features/switches/index.tsx:207-232`) and its comment says no app reads the switches (`index.tsx:41-49`); runbook lines that say the same (`docs/ops/admin-console.md:76-78, 146-151`).
- Sidebar: `NavItem` types (`apps/admin/src/components/layout/types.ts:3-30`), `sidebarData` (`components/layout/data/sidebar-data.ts`), rendered unfiltered by `app-sidebar.tsx:37` and the Ctrl+K menu (`components/command-menu.tsx:50`). `useMe()` is available inside the router (`App.tsx:59-63`).
- Which roles each page's read admits (`admin.require_staff`; the owner always passes, `0047:160-177`): `today`, `school_list`, `flag_list`, `system_health`, `relay_status` default (owner, ops, safety); `direct_users_summary` ops; `staff_roster`, `audit_list` owner only; every `billing_*` read ops and finance; `me` every role (`0056:41`). Measured with grep on 2026-10-08.
- The stop button: `StopControl({status: RelayStatus, onChanged})` (`apps/admin/src/components/stop-control.tsx:29`), shown only on Today and System (`features/today/index.tsx:46`, `features/system/index.tsx:64`). 0061 opened the stop to finance (`supabase/migrations/0061_admin_wave1_merge.sql:31-33`), whose header says finance "has no button for it in the console yet" (`0061:12-17`).
- The Today tile for the contest: `apps/admin/src/lib/tiles.ts:72-78` ("the form closes for the day at the limit").
- Pinned callable lists: `supabase/tests/admin-invariants.test.ts:39-99` (authenticated, C collation order) and `:143-150` (the public functions anon may call).

---

## Global Constraints

- Work only in `C:/Users/Ashish Sharma/curie/.claude/worktrees/admin-wiring` on branch `admin-wiring`. Never touch the main checkout's working tree or any other worktree (`.claude/worktrees/admin`, `admin-safety`, `lms`, `canvas`, `lam-*`, `voice-stt-tts`). Never push, deploy, run `supabase db push`, call any hosted service (Supabase, Vercel, npm registry included: no `npm ci` in `landing/`), or put a real secret anywhere.
- Migrations **0062 to 0064 only** (T1). Never edit 0001 to 0061.
- Every new `admin.*` function: `SECURITY DEFINER`, `set search_path` fixed, begins with `admin.require_staff(...)` when a browser may call it; refusal is exactly `not allowed` (42501). Internal helpers (`contest_rules`, `import_refusal`, `privacy_import_refusal`, `tutor_enabled_for`) are revoked from public, anon, authenticated **and** service_role. Explicit revoke then explicit grants everywhere. This plan adds no console write: its one new staff function (`admin.stop_status`) reads; the stop itself is plan 1's `admin.set_halt` through `StopControl` (env, reason, audit unchanged).
- `supabase/tests/admin-invariants.test.ts` and `supabase/tests/lms-invariants.test.ts` are updated in the same task as the function they pin.
- A failed read never turns a feature on (spec section 4). Each app's safe default is written in its config module beside the reason, and tested.
- Nothing about a child leaves an app for this: the config read carries a school code (student and teacher apps), or nothing but the session token (tutor); nothing is logged; `app_config` stays coarse (plan 3's R5). No new view lists, ranks or tracks a child.
- Tutor code (`apps/classroom`) and the relay are **older here than the live tutor** (`phase3-completion`, `voice-stt-tts`; the live relay has `743c05a`, `1dcfcfe`, `18733af`). Changes to `apps/classroom` are new files plus the hook-ins named in Task 7 (`prototype.ts`, `App.tsx`, `main.tsx`, `package.json`). No change at all to `packages/relay` or `supabase/functions/relay` (T5).
- App text is English, sentence case. COMMENTS ARE CLAIMS: no comment, test name, doc line or screen text asserts what the code does not do; anything not run is UNVERIFIED.
- TDD: write the failing test, run it, see it fail for the stated reason, implement, see it pass. Database tests carry `// @vitest-environment node`.
- Windows, PowerShell 5.1: write files without a BOM (`landing/app/**/page.tsx` already start with one; keep it as it is when editing); commit with a message file:

```powershell
# Run once per shell, from the worktree root.
function Commit([string]$msg) {
  $f = Join-Path $env:TEMP 'qrie-wiring-commit.txt'
  [System.IO.File]::WriteAllText($f, "$msg`n`nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`n")
  git commit -F $f
}
```

## Seams with plan 5 (binding; the wave's contract T1 to T11)

| Seam | This plan |
|---|---|
| T1 | 0062, 0063, 0064. |
| T2 | Creates `admin.import_refusal(p_org uuid) returns text` (internal) and the stub `admin.privacy_import_refusal(p_org uuid) returns text` returning NULL (internal, `set search_path = admin, public`), in 0063. `admin.api_gate('people-import')` and every LMS-lane import path (`importForSchool` for lms-admin and admin-api, `importForAdmin` for the demo, and the founder's CLI through `applyPlan`'s new `store.mayImport` check, R24) ask it; the sentence is shown. |
| T3 | The only plan that changes `public.claim_relay` (0064). |
| T4 | Does not change `public.app_config`. Adds `public.my_app_config()`, which calls it. |
| T5 | No relay TypeScript. The refusal reuses `halted` (R1); a distinct reason is merge note 6. |
| T6 | One config module and a gate per app, hook-ins only where Tasks 7 to 10 name them. `apps/student` changes are `src/lib/build.ts`, `src/lib/app-config.tsx`, `src/components/app-notices.tsx`, `src/routes/__root.tsx` (two lines), `package.json` (version). |
| T7 | Adds the route and nav item **Apps**. Declares `roles?: Me['role'][]` on `BaseNavItem` and filters the sidebar and the Ctrl+K menu by role (Task 13, exact declaration under Interfaces). |
| T8 | Shared files changed: `admin-invariants.test.ts`, `router.tsx`, `sidebar-data.ts`, `packages/admin-client/src/api.ts` (no new client module, so `index.ts` is unchanged), `apps/admin/src/lib/client.ts` (unchanged), `docs/ops/admin-console.md` (new section 7; sections 2 and 5 step 8 corrected where they say no app reads the switches). |
| T9 | `contest.daily_limit` is a registered switch; `admin.contest_rules()` is read by `record_contest_signup` and `admin.today()`; `contest.entries_open` is enforced in `record_contest_signup`. |
| T10 | New flag key: `contest.daily_limit` only. |
| T11 | Recreates none of `admin.flag_set`, `admin.set_halt`, `public.app_config`. Recreates `admin.api_gate` (0054's body with one block replaced), `admin.today` (0049's body with the contest lines replaced), `public.record_contest_signup` and `public.claim_relay`, each from its latest definition, line for line except the named change. |

## Review Focus

1. **A failed read never turns a feature on.** Each app's built-in defaults (table in Task 7, 8, 9, 10) and "keep the last good value" are tested; the tutor's `only_prepared` default is `true` (only prepared classes) although the database's safe default is `false`, because "unreadable" must not mean "prepare and spend" (R4). (Tasks 7 to 10.)
2. **What a client could skip, the database refuses.** `claim_relay` refuses a class at a school whose effective `tutor.enabled` is false or that is suspended, and spends nothing; `record_contest_signup` refuses a new entry when entries are closed or the India day's limit is reached, under the existing lock; both import paths refuse an offboarded, suspended or ended school before reading a sheet. (Tasks 2, 3, 4, 5.)
3. **The live tutor keeps working when 0064 is pushed before the classroom is merged.** The refusal's reason is `halted`, which the deployed relay already maps to its 503 sentence and lets reports through; nothing in `packages/relay` changes. (Task 5, R1.)
4. **The minimum build cannot lock anyone out by a typo.** `flag_valid` takes only `N.N.N`; every app's comparison returns "not below" for a malformed or missing value or build. (Tasks 2, 6, 7.)
5. **Every console line is true** and names which apps obey and whether the database enforces it; no "(plan 4)" placeholder survives. (Task 12.)
6. **Who sees what.** The sidebar mirrors each page's database role list (the database still refuses), finance gets a stop button that works for it and lands on Billing, `admin.stop_status` gives every role exactly halted, reason and since. (Tasks 5, 13.)
7. **The school admin's notice and the student's notice say only what is so**: grace with its last day, suspended with what stops and what stays, an invoice due or overdue with its amount; a student or parent sees only "suspended" (R14); a teacher who is not the admin sees no billing. (Tasks 5, 8, 9.)

## Interfaces (what this plan produces and consumes)

**Consumes:** plan 1 `admin.require_staff`, `admin.flag_def`, `admin.app_flag`, `admin.flag_valid` (replaced), `admin.flag_set` (unchanged), `admin.set_halt` (unchanged, 0061), `public.relay_control`; plan 2 `admin.api_gate` (replaced), `admin.school_profile.offboarded_at`, `admin.school_org`, `admin.require_reason`; plan 3 `billing.state_for`, `billing.invoice (org_id, status, total_paise, paid_paise, due_on)`, `public.app_config`; the LMS lane `lms.school`, `lms.require_admin`, `lms.india_today`, `public.org_of`, `public.current_org_id`, `importForSchool`, `importForAdmin`, `Backend`, `createLmsClient`; harness and fixtures (`freshDatabase`, `asClaims`, `asService`, `asUser`, `makeStaff`, `aal2`, `fresh`, `anonymousChild`, `setEnvironment`, `buildSchool`, `setLicence` from `admin-school-fixtures.ts:101-105`, `makeFinance`, `readySeller`, `billedSchool`, `rpc` from `billing-fixtures.ts`).

**Produces, SQL (browser-callable):**
- `public.my_app_config() returns jsonb` — `app_config` for the caller's school (from `auth.uid()`), or the global one; anon, authenticated, service_role.
- `lms.school_billing() returns jsonb` — the school admin's `{state: 'ok'|'grace'|'suspended', graceUntil: 'YYYY-MM-DD'|null, openInvoices: int, duePaise: int, earliestDueOn: 'YYYY-MM-DD'|null}`; authenticated (refuses anyone but the school's admin with `only the school admin can see this`).
- `admin.stop_status() returns jsonb` — `{halted, haltedReason, haltedAt}`; owner, ops, safety, finance; authenticated.

**Produces, SQL (service role only):** `lms.import_refusal(p_org uuid) returns text`.

**Produces, SQL (internal, no API role):** `admin.contest_rules() returns table (entries_open boolean, daily_limit integer, day_start timestamptz)`; `admin.import_refusal(p_org uuid) returns text`; `admin.privacy_import_refusal(p_org uuid) returns text` (stub, NULL; plan 5 replaces it, T2); `admin.tutor_enabled_for(p_user uuid) returns boolean`.

**Replaces (same signature, same grants):** `admin.flag_valid(text, jsonb)` (kinds `version`, `count`), `admin.today()` (contest from `contest_rules`, adds `contest.entriesOpen`), `public.record_contest_signup(text, integer, text, text, boolean, text, text, text)`, `admin.api_gate(text, text, text, text, text)`, `public.claim_relay(uuid, text, integer)`.

**Data:** `admin.flag_def.kind` admits `version`, `count`; the three `app.min_version.*` rows become `version`; new row `contest.daily_limit` (`count`, safe default `2000`, global, guarded).

**Produces, TypeScript:**
- `packages/lms-client/src/app-config.ts`: `VERSION`, `parseVersion`, `isBelowMinimum`, `SchoolAppConfig`, `SCHOOL_APP_DEFAULTS`, `parseSchoolAppConfig(raw, app: 'student'|'lms')`, `SchoolBilling`, `billingNotices(b, today)`; `Backend.appConfig(code: string | null): Promise<unknown>`; `LmsClient.schoolBilling(): Promise<SchoolBilling>`; `RpcClient.schema(name: 'lms' | 'public')`.
- Demo server `GET /public/app-config` and `GET /public/app-config/<CODE>` → `{config}`, run as anon.
- Tutor: `apps/classroom/src/lib/appConfig.ts` (`CLASSROOM_BUILD`, `ClassroomConfig`, `CLASSROOM_DEFAULTS`, `parseClassroomConfig`, `getAppConfig`, `subscribeAppConfig`, `useAppConfig`, `applyAppConfig`, `refreshAppConfig`, `startAppConfig`, `parseVersion`, `isBelowMinimum`), `src/lib/appConfigRead.ts` (`readMyAppConfig`), `src/ui/AppConfigGate.tsx`; `prototype.ts` gains `setOnlyPrepared(on: boolean)` and `PROTOTYPE_ONLY_PREPARED` becomes `export let`.
- Student: `src/lib/build.ts` (`STUDENT_BUILD`), `src/lib/app-config.tsx` (`useStudentAppConfig`, `AppGate`), `src/components/app-notices.tsx` (`AppNotices`).
- Teacher: `src/lib/build.ts` (`LMS_BUILD`), `src/lib/app-config.tsx` (`useLmsAppConfig`, `AppGate`), `src/components/app-notices.tsx` (`AppNotices`), `src/features/school/billing-notice.tsx` (`useSchoolBilling`, `BillingNotice`).
- Landing: `landing/lib/contest-config.ts` (`entriesOpenFrom`, `problemForCode`), `landing/lib/use-entries.ts` (`useEntriesOpen`).
- Imports: `tools/lms-import/src/apply.ts` `ImportStore.mayImport?(orgId): Promise<string | null>` (asked by `applyPlan` after `ensureSchool`), implemented by `supabaseStore` (R24).
- Console: `packages/admin-client/src/api.ts` (`StopStatus`, `AdminClient.stopStatus()`, `FlagRow.kind` gains `'version' | 'count'`, `Today.contest.entriesOpen`); `apps/admin/src/lib/nav.ts` (`navFor`, `homeFor`, `showsHeaderStop`); `apps/admin/src/lib/app-readers.ts` (`FIRST_BUILD`, `APP_READERS`); `apps/admin/src/lib/flag-values.ts` (`flagValueProblem`); `apps/admin/src/components/header-stop.tsx` (`HeaderStop`); `apps/admin/src/features/apps/index.tsx` (`AppsPage`, route `/apps`).
- The nav type (T7), exactly:

```ts
// apps/admin/src/components/layout/types.ts
import type { Me } from '@ai-tutor/admin-client'

type BaseNavItem = {
  title: string
  badge?: string
  icon?: React.ElementType
  /** Staff roles that see this item; absent = every staff role. The owner sees every item (as admin.require_staff lets the owner through). */
  roles?: Me['role'][]
}
```

## File structure

| Path | Responsibility | Task |
|---|---|---|
| `supabase/migrations/0062_app_switches_contest.sql` | flag kinds `version` and `count` (M13), `contest.daily_limit`, `admin.contest_rules`, `record_contest_signup`, `admin.today` | 2 |
| `supabase/tests/app-switches.test.ts`, `supabase/tests/app-contest.test.ts` | the above | 2 |
| `supabase/tests/admin-today.test.ts`, `billing-states.test.ts` (modify) | the pin moves from 0020's text to the row; the new key | 2 |
| `supabase/migrations/0063_app_imports.sql` | `privacy_import_refusal` stub, `import_refusal`, `lms.import_refusal`, `api_gate` | 3 |
| `supabase/tests/app-imports.test.ts`; `lms-invariants.test.ts` (modify) | the above | 3 |
| `tools/lms-import/src/admin.ts`, `tools/lms-import/src/apply.ts`, `tools/lms-import/src/supabaseStore.ts`, `tools/lms-demo/src/import.ts` (modify) + `tools/lms-import/tests/admin.test.ts`, `tools/lms-import/tests/apply.test.ts`, `tools/lms-import/tests/supabaseStore.test.ts`, `tools/admin-api/tests/handle.test.ts`, `tools/lms-demo/tests/app-wiring.test.ts` | every import path asks first (the CLI through `applyPlan`) | 4 |
| `supabase/migrations/0064_app_admission_reads.sql` | `tutor_enabled_for`, `claim_relay`, `my_app_config`, `lms.school_billing`, `admin.stop_status` | 5 |
| `supabase/tests/app-tutor.test.ts`, `supabase/tests/app-reads.test.ts`; `admin-invariants.test.ts` (modify) | the above | 5 |
| `packages/lms-client/src/app-config.ts`, `index.ts`, `api.ts`, `backend.ts`, `transport.ts` (modify); `tools/lms-demo/src/server.ts` (modify) + `packages/lms-client/tests/app-config.test.ts`, `backend-hosted.test.ts` (modify), `tools/lms-demo/tests/app-wiring.test.ts` | the shared reader for the school apps | 6 |
| `apps/classroom/src/lib/appConfig.ts`, `appConfigRead.ts`, `src/ui/AppConfigGate.tsx` (new); `prototype.ts`, `App.tsx`, `main.tsx`, `package.json` (modify) + `apps/classroom/tests/appConfig.test.ts`, `appConfigGate.test.tsx`; `package-lock.json` (one version line) | the tutor | 7 |
| `apps/student/src/lib/build.ts`, `src/lib/app-config.tsx`, `src/components/app-notices.tsx` (new); `src/routes/__root.tsx`, `package.json` (modify) + `apps/student/tests/app-notices.test.tsx`; `package-lock.json` | the student app | 8 |
| `apps/lms/src/lib/build.ts`, `src/lib/app-config.tsx`, `src/components/app-notices.tsx`, `src/features/school/billing-notice.tsx` (new); `src/routes/__root.tsx`, `src/features/school/licence.tsx`, `package.json` (modify) + `apps/lms/tests/app-notices.test.tsx`; `package-lock.json` | the teacher app | 9 |
| `landing/lib/contest-config.ts`, `landing/lib/use-entries.ts` (new); `landing/lib/contest.ts`, `landing/app/challenge-register/page.tsx`, `vitest.config.ts` (modify) + `landing/tests/contest-config.test.ts` | the contest form | 10 |
| `packages/admin-client/src/api.ts` (modify) + `packages/admin-client/tests/api.test.ts` (modify) | the console's client | 11 |
| `apps/admin/src/lib/confirm.ts`, `blast.ts`, `tiles.ts`, `features/switches/index.tsx` (modify); `lib/app-readers.ts`, `lib/flag-values.ts`, `features/apps/index.tsx` (new) + `apps/admin/tests/{confirm,blast,tiles}.test.ts` (modify), `app-readers.test.ts`, `flag-values.test.ts` (new) | true lines, safe editors, the Apps page | 12 |
| `apps/admin/src/components/layout/{types.ts,app-sidebar.tsx,data/sidebar-data.ts}`, `components/command-menu.tsx`, `components/admin-page.tsx`, `components/stop-control.tsx`, `features/today/index.tsx`, `router.tsx` (modify); `lib/nav.ts`, `components/header-stop.tsx` (new) + `apps/admin/tests/nav.test.ts` | role sidebar, finance stop and landing | 13 |
| `docs/ops/admin-console.md`, `apps/admin/README.md` | runbook section 7, corrections | 14 |

---

### Task 1: Baseline

**Files:** none.

- [ ] **Step 1: Confirm the branch and dependencies**

```powershell
git status --short; git log --oneline -1
Test-Path node_modules, apps/admin/node_modules, apps/lms/node_modules, apps/student/node_modules, landing/node_modules
```

Expected: a clean tree on `admin-wiring` (this plan's commit on top of `ade281c`); the first four `True`, `landing/node_modules` `False` (measured 2026-10-08; it stays absent: no install in `landing/`).

- [ ] **Step 2: Baseline of everything this plan touches**

Run: `npx vitest run supabase/tests/admin- supabase/tests/billing-states.test.ts supabase/tests/lms-invariants.test.ts tools/lms-import/tests/admin.test.ts tools/admin-api packages/admin-client packages/lms-client/tests/backend-hosted.test.ts packages/lms-client/tests/licence.test.ts apps/admin apps/classroom/tests/prototypeGate.test.tsx apps/classroom/tests/migrations.test.ts packages/relay/tests/gate.test.ts`
Expected: PASS. Write down the file and test counts; later steps compare against them.

---

### Task 2: Switches you can trust, and the contest obeys them (0062)

**Files:**
- Create: `supabase/migrations/0062_app_switches_contest.sql`
- Test: `supabase/tests/app-switches.test.ts`, `supabase/tests/app-contest.test.ts`; modify `supabase/tests/admin-today.test.ts`, `supabase/tests/billing-states.test.ts`

**Interfaces:**
- Consumes: 0050's flags, 0053's `flag_set`, 0060's `app_config`, 0020's `record_contest_signup`, 0049's `admin.today`.
- Produces: kinds `version`, `count`; `contest.daily_limit`; `admin.contest_rules()`; the replaced `flag_valid`, `record_contest_signup`, `admin.today`.

- [ ] **Step 1: Write the failing tests**

`supabase/tests/app-switches.test.ts` (fixtures: `owner`, `ops` via `makeStaff`, `setEnvironment`; `setFlag(claims, key, value)` = `admin.flag_set(key, 'global', '', value::jsonb, 'a reason', 'TEST')` as in `admin-flags.test.ts:36-39`):
1. `the minimum builds are versions, and only a well-formed one can be set (M13)`: `select key, kind from admin.flag_def where key like 'app.min_version.%' order by 1` → three rows, each `version`; as `aal2(ops)`: `'0.1.0'`, `'2.3.0'`, `'10.0.12'` are accepted (read back through `public.app_config(null)`); `'0.1'`, `'1.0.0-beta'`, `' 0.1.0'`, `'v1.2.3'`, `'1.2.3.4'`, `'12345.0.0'`, `''`, `1` (a number) each reject with `/does not suit this switch \(version\)/`.
2. `the contest's daily limit is a guarded count, 2000 until someone sets it`: `public.app_config(null) -> 'contest.daily_limit'` is `2000`; `flag_def` row is `count`, `guarded`, not school-scoped; `aal2(ops)` setting `500` → `/authenticator code/`; `fresh(ops)` setting `500` works and reads back `500`; `0`, `100001`, `2.5`, `"500"` (a string) each → `/does not suit this switch \(count\)/`; then set back to `2000`.
3. `the other kinds still behave as before`: `banner.tone` `'loud'` refused, `banner.message` `42` refused, `tutor.only_prepared` `true` accepted with `fresh(owner)` (and set back to `false`).
4. `flag_valid stays internal`: `has_function_privilege(role, 'admin.flag_valid(text, jsonb)', 'execute')` is false for `anon` and `authenticated`.

`supabase/tests/app-contest.test.ts` (fixtures: `owner`, `ops`; `entrant()` = `anonymousChild(db)`; `sign(user, name = 'A child')` = `asClaims(db, { sub: user, is_anonymous: true }, tx => tx.query("select public.record_contest_signup($1, 8, null, '12 Road', true, 'A parent', '+919876543210', 'test')", [name]))`; `beforeEach` deletes `public.contest_signup` rows as the database owner and sets `contest.daily_limit` to `2000` and `contest.entries_open` to `true` with `fresh(owner)`):
1. `takes entries up to the day's limit read from the switch, and refuses the next new one with 53400`: set `contest.daily_limit` to `3` (`fresh(ops)`); three new entrants sign → OK; the fourth → rejects, error `code` `'53400'`, message `entries are closed for today`; `select count(*) from public.contest_signup` is 3.
2. `an entrant already in can still correct their entry when the day is full`: with the limit reached, `sign(first, 'A corrected name')` resolves; the row's `student_name` is `'A corrected name'`; count still 3.
3. `counts the day as India's day`: insert as the database owner one entry with `created_at = (lms.india_today())::timestamp at time zone 'Asia/Kolkata' - interval '1 minute'` (yesterday in India) and limit `1` → a new entrant is accepted (yesterday's row is not counted); a second → `53400`.
4. `refuses every new entry while entries are closed, with 55000, and still lets an entrant correct theirs`: set `contest.entries_open` `false` (`fresh(ops)`); a new entrant → error `code` `'55000'`, message `the contest is not taking entries`; an existing entrant's correction resolves; set it back to `true`.
5. `still refuses a caller with no session`: in a transaction with `set local role authenticated` and no claims set (so `auth.uid()` is null) → error `code` `'28000'`.
6. `the signup is still for signed-in callers only`: `has_function_privilege('anon', 'public.record_contest_signup(text, integer, text, text, boolean, text, text, text)', 'execute')` false; `authenticated` true.
7. `admin.contest_rules is internal`: not executable by `anon`, `authenticated`, `service_role`.

`supabase/tests/admin-today.test.ts` (modify): replace `"repeats the contest's daily ceiling, and a drift from 0020 fails here"` (`:91-97`) with
`"reads the contest's limit and whether entries are open from the switches the signup obeys"`: set `contest.daily_limit` to `750` with `fresh(owner)` (add `owner` to its `beforeAll`), `today().contest` → `{ entriesToday: 0, dailyCap: 750, entriesOpen: true }`; set back to `2000`. Change `"reports the contest ceiling and today's entries"` (`:99-102`) to expect `{ entriesToday: 0, dailyCap: 2000, entriesOpen: true }`, and the `Today` interface's `contest` to `{ entriesToday: number; dailyCap: number; entriesOpen: boolean }`.

`supabase/tests/billing-states.test.ts` (modify `:148-162`): add `'contest.daily_limit': 2000,` after `'contest.entries_open': true,`.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run supabase/tests/app-switches.test.ts supabase/tests/app-contest.test.ts supabase/tests/admin-today.test.ts supabase/tests/billing-states.test.ts`
Expected: FAIL: the min_version rows read `text`; `contest.daily_limit` is absent (app_config has no such key); `'0.1'` is accepted; the fourth entrant is accepted (limit 2000); `admin.today().contest` has no `entriesOpen`; `billing-states` test 5 fails on the extra expected key.

- [ ] **Step 3: Write the migration**

`supabase/migrations/0062_app_switches_contest.sql`, header comment stating: M13 (a minimum build is three whole numbers, so a typo cannot lock an app out; each app also ignores a malformed value), the contest's limit becomes a switch read in one place by both the signup and the home page, entries open is enforced in the signup, and the contest's day becomes India's (R9). Body:

```sql
-- 1. Two more kinds.
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'admin.flag_def'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table admin.flag_def drop constraint %I', c);
  end loop;
end
$$;
alter table admin.flag_def add constraint flag_def_kind_check
  check (kind in ('bool', 'text', 'tone', 'version', 'count'));

update admin.flag_def
   set kind = 'version',
       description = case key
         when 'app.min_version.classroom' then 'Oldest tutor build allowed to run, as three numbers such as 0.1.0; 0.0.0 for none.'
         when 'app.min_version.student' then 'Oldest student-app build allowed to run, as three numbers such as 0.1.0; 0.0.0 for none.'
         else 'Oldest teacher-app build allowed to run, as three numbers such as 2.3.0; 0.0.0 for none.'
       end
 where key in ('app.min_version.classroom', 'app.min_version.student', 'app.min_version.lms');

insert into admin.flag_def (key, kind, safe_default, school_scoped, guarded, description) values
  ('contest.daily_limit', 'count', '2000', false, true,
   'New contest entries taken in one India day; the next new one that day is refused.')
on conflict (key) do nothing;

-- CASE, not AND: Postgres does not promise to evaluate AND left to right, and
-- the cast must never see a value the pattern refused.
create or replace function admin.flag_valid(p_kind text, p_value jsonb)
returns boolean
language sql immutable
as $$
  select case p_kind
    when 'bool' then jsonb_typeof(p_value) = 'boolean'
    when 'text' then jsonb_typeof(p_value) = 'string' and char_length(p_value #>> '{}') <= 280
    when 'tone' then jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') in ('info', 'warning')
    when 'version' then jsonb_typeof(p_value) = 'string'
                        and (p_value #>> '{}') ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'
    when 'count' then case when jsonb_typeof(p_value) = 'number' and (p_value #>> '{}') ~ '^[0-9]{1,6}$'
                           then (p_value #>> '{}')::integer between 1 and 100000
                           else false end
    else false
  end
$$;
revoke all on function admin.flag_valid(text, jsonb) from public, anon, authenticated;

-- 2. The contest's rules, in one place.
create or replace function admin.contest_rules()
returns table (entries_open boolean, daily_limit integer, day_start timestamptz)
language sql stable security definer
set search_path = admin, lms, public
as $$
  select coalesce((c.v ->> 'contest.entries_open')::boolean, false),
         coalesce((c.v ->> 'contest.daily_limit')::integer, 2000),
         (lms.india_today())::timestamp at time zone 'Asia/Kolkata'
    from (select public.app_config(null) as v) c
$$;
revoke all on function admin.contest_rules() from public, anon, authenticated, service_role;
```

Then `public.record_contest_signup`: copy 0020's function (`0020:98-178`) line for line, keeping its signature, `security definer` and `set search_path = public`, with these changes only, and with a comment above it saying so:
- In `declare`: remove `day_project constant integer := 2000;` and `day_start ...`; add `rules record;`.
- First statement after the `caller is null` check: `select * into rules from admin.contest_rules();`
- Inside `if existing is null then`, before the advisory lock:
  ```sql
  if not rules.entries_open then
    raise exception 'the contest is not taking entries' using errcode = '55000';
  end if;
  ```
- The count reads `where created_at >= rules.day_start`, the comparison `if today >= rules.daily_limit then` (same message and errcode `53400`).
- Restate `revoke all on function public.record_contest_signup(text, integer, text, text, boolean, text, text, text) from public, anon;` and `grant execute ... to authenticated;` (0020:183-184).

Then `admin.today()`: copy 0049's function (`0049:12-76`) line for line with these changes only, and a comment saying so: in `declare` remove `day_start` and add `rules record;`; before the entries count, `select * into rules from admin.contest_rules();`; the count reads `where s.created_at >= rules.day_start`; the contest object is `jsonb_build_object('entriesToday', entries, 'dailyCap', rules.daily_limit, 'entriesOpen', rules.entries_open)`. Restate `revoke all on function admin.today() from public, anon; grant execute on function admin.today() to authenticated;`. (`utc_day` stays: it is the relay's day, `relay_budget_day`.)

- [ ] **Step 4: Run and see them pass, then every database file**

Run: `npx vitest run supabase/tests/app-switches.test.ts supabase/tests/app-contest.test.ts supabase/tests/admin-today.test.ts supabase/tests/billing-states.test.ts`
Expected: PASS: 4 + 7 + the existing counts of the two modified files.
Run: `npx vitest run supabase/tests packages/admin-client`
Expected: PASS (plan 1's `admin-flags.test.ts` reads keys it names, not the whole object).

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/0062_app_switches_contest.sql supabase/tests/app-switches.test.ts supabase/tests/app-contest.test.ts supabase/tests/admin-today.test.ts supabase/tests/billing-states.test.ts
Commit "feat: a minimum build is a version, the contest's limit is a switch, and the signup obeys it and the open switch on India's day"
```

---

### Task 3: Imports refused for an offboarded, suspended or ended school (0063)

**Files:**
- Create: `supabase/migrations/0063_app_imports.sql`
- Test: `supabase/tests/app-imports.test.ts`; modify `supabase/tests/lms-invariants.test.ts`

**Interfaces:**
- Consumes: `admin.school_profile`, `billing.state_for`, `lms.india_today`, 0054's `api_gate`.
- Produces: `admin.privacy_import_refusal(uuid)` (stub), `admin.import_refusal(uuid)`, `lms.import_refusal(uuid)` (service role), the replaced `admin.api_gate`.

The two sentences (used by every path; tests pin them):
- `OFFBOARDED = 'This school is offboarded from Qrie, so no new people can be added.'`
- `LAPSED = "This school's licence has ended and its grace period is over, so no new people can be added until it is renewed."`

- [ ] **Step 1: Write the failing tests**

`supabase/tests/app-imports.test.ts` (fixtures: `owner`, `ops`, `setEnvironment`; `refusal(org)` = `select admin.import_refusal($1) as r` as the database owner; `gate(claims, action, code)` = `admin.api_gate(action, code, '', 'term starts', 'TEST')` through `asClaims`):
1. `a school in good standing may import`: `buildSchool(db, 'IMOK')` with no licence → `null`; with `setLicence(db, 'IMOK', 100, 30)` → `null`; in grace (`setLicence(..., -3)`) → `null`.
2. `an offboarded school may not, and is told why`: `insert into admin.school_profile (org_id, offboarded_at) values ($1, now())` → exactly `OFFBOARDED`.
3. `a suspended or ended school may not, and is told why`: `setLicence(db, 'IMSU', 100, -20)` → exactly `LAPSED`; `setLicence(db, 'IMEN', 100, -100)` → exactly `LAPSED`.
4. `the privacy decision is asked last, through its own function (seam T2)`: `admin.privacy_import_refusal(org)` → `null`; then, as the database owner, `create or replace function admin.privacy_import_refusal(p_org uuid) returns text language sql stable security definer set search_path = admin, public as $$ select 'privacy undecided'::text $$` → `import_refusal(org)` for a good school → `'privacy undecided'`, and for an offboarded one still `OFFBOARDED`; recreate the stub (`select null::text`) at the end of the test.
5. `the gate refuses staff an import for such a school with the same sentence, and still lets them check a sheet`: `gate(fresh(ops), 'people-import', 'IMSU')` rejects with exactly `LAPSED`; offboarded school → exactly `OFFBOARDED` (still matches plan 2's `/offboarded/`); `gate(aal2(ops), 'people-preview', 'IMSU')` resolves to `{actor, orgId}`; no `people-import-requested` audit row is added for the refused calls.
6. `the school admin's import code reaches it through one service-role door`: `select lms.import_refusal($1)` as service → `LAPSED` for IMSU; `has_function_privilege('authenticated'|'anon', 'lms.import_refusal(uuid)', 'execute')` false; `service_role` true.
7. `the admin helpers are internal`: `admin.import_refusal(uuid)` and `admin.privacy_import_refusal(uuid)` not executable by `anon`, `authenticated` or `service_role`.

`supabase/tests/lms-invariants.test.ts` (modify `:60-90`): add `'import_refusal(p_org uuid)',` to `internal` after `'import_snapshot(p_org uuid)',`.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run supabase/tests/app-imports.test.ts supabase/tests/lms-invariants.test.ts supabase/tests/admin-users-staff.test.ts`
Expected: FAIL: `function admin.import_refusal(uuid) does not exist`; `lms-invariants` still passes (a missing function is not open); `admin-users-staff` passes.

- [ ] **Step 3: Write the migration**

`supabase/migrations/0063_app_imports.sql`, header comment: spec section 10 ("new imports stop" when suspended), plan 3's merge note 10, seam T2 (plan 5 replaces the privacy stub with its data-protection decision). Body:

```sql
-- Plan 5 replaces this (same signature, internal): it refuses while the
-- school's data-protection decision is undecided. Until then it refuses nothing.
create or replace function admin.privacy_import_refusal(p_org uuid)
returns text
language sql stable security definer
set search_path = admin, public
as $$
  select null::text
$$;

create or replace function admin.import_refusal(p_org uuid)
returns text
language plpgsql stable security definer
set search_path = admin, billing, lms, public
as $$
declare
  st text;
begin
  if exists (select 1 from admin.school_profile p where p.org_id = p_org and p.offboarded_at is not null) then
    return 'This school is offboarded from Qrie, so no new people can be added.';
  end if;
  select f.state into st from billing.state_for(p_org, lms.india_today()) f;
  if st in ('suspended', 'ended') then
    return 'This school''s licence has ended and its grace period is over, so no new people can be added until it is renewed.';
  end if;
  return admin.privacy_import_refusal(p_org);
end;
$$;

-- The LMS lane's service-role door to the same answer (lms-admin and the demo
-- server call lms.* functions only).
create or replace function lms.import_refusal(p_org uuid)
returns text
language sql stable security definer
set search_path = public, lms
as $$
  select admin.import_refusal(p_org)
$$;

revoke all on function admin.privacy_import_refusal(uuid) from public, anon, authenticated, service_role;
revoke all on function admin.import_refusal(uuid) from public, anon, authenticated, service_role;
revoke all on function lms.import_refusal(uuid) from public, anon, authenticated;
grant execute on function lms.import_refusal(uuid) to service_role;
```

Then `admin.api_gate`: copy 0054's function (`0054:327-388`) line for line; in `declare` add `refusal text;`; replace the block

```sql
    if p_action = 'people-import'
       and exists (select 1 from admin.school_profile p where p.org_id = org and p.offboarded_at is not null) then
      raise exception 'this school is offboarded; bring it back before adding people';
    end if;
```

with

```sql
    if p_action = 'people-import' then
      refusal := admin.import_refusal(org);
      if refusal is not null then
        raise exception '%', refusal;
      end if;
    end if;
```

and nothing else. Restate 0054's revoke and grant for `api_gate(text, text, text, text, text)` (`0054:434, 444`).

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run supabase/tests/app-imports.test.ts supabase/tests/lms-invariants.test.ts supabase/tests/admin-users-staff.test.ts supabase/tests/admin-invariants.test.ts`
Expected: PASS: 7, and the existing counts (the gate's `/offboarded/` test still passes; the authenticated list is unchanged).

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/0063_app_imports.sql supabase/tests/app-imports.test.ts supabase/tests/lms-invariants.test.ts
Commit "feat: no new people for an offboarded, suspended or ended school, one sentence for why, and a seam for the privacy decision"
```

---

### Task 4: Every import path asks first

**Files:**
- Modify: `tools/lms-import/src/admin.ts`, `tools/lms-import/src/apply.ts` (`ImportStore.mayImport?`, one check in `applyPlan`), `tools/lms-import/src/supabaseStore.ts` (`mayImport`), `tools/lms-demo/src/import.ts`
- Test: `tools/lms-import/tests/admin.test.ts`, `tools/lms-import/tests/apply.test.ts`, `tools/lms-import/tests/supabaseStore.test.ts`, `tools/admin-api/tests/handle.test.ts`; create `tools/lms-demo/tests/app-wiring.test.ts`

- [ ] **Step 1: Write the failing tests**

`tools/lms-import/tests/admin.test.ts`, a new `describe('a school that may not import')`:
1. `the admin of a suspended school is told why when checking a sheet, and nobody is made`: `buildSchool(db, 'HSU')` (its admin's token `'hsu-admin'` in `tokens`), `setLicence(db, 'HSU', 100, -20)` (import from `../../../supabase/tests/admin-school-fixtures.ts`); `call('/import', { students: SHEET }, 'hsu-admin')` → `{ status: 409, body: { error: LAPSED } }`; with `commit: true, acceptWarnings: true` → the same; `select count(*) from lms.account where org_id = $1` unchanged; `rpcCalls` contains `import_refusal` and not `import_snapshot` after it was reset.
2. `the admin of an offboarded school is told why`: → `{ status: 409, body: { error: OFFBOARDED } }`.

`tools/admin-api/tests/handle.test.ts`, add after `'an offboarded school takes no new people'`:
3. `a suspended school takes no new people from staff either, and checking a sheet is refused with the same sentence`: `buildSchool(db, 'API3')`, `setLicence(db, 'API3', 100, -20)`; commit (`'ops-fresh'`) → `status 400`, `body.error` exactly `LAPSED`; preview (no commit, token `'ops'`, as the file's preview at `handle.test.ts:82`) → `status 409`, `body.error` exactly `LAPSED`.

`tools/lms-demo/tests/app-wiring.test.ts` (new, `// @vitest-environment node`; `db = await openDemoDatabase()` from `../src/database.ts`, `buildSchool` from `../../../supabase/tests/fixtures.ts`):
4. `the demo admin of a suspended school is refused before anything is read`: `setLicence(db, 'DSU', 100, -20)`; `importForAdmin(db, school.admin, { students: SHEET })` rejects with an `ImportRefused` whose `status` is 409 and `message` is `LAPSED`.

`tools/lms-import/tests/apply.test.ts` (the founder's CLI path, R24), a new `describe('a store that says the school may not import')`:
5. `applyPlan stops after naming the school and before anyone is made`: `store = { ...pgliteStore(db), mayImport: async () => LAPSED }`; `applyPlan(plan(), store)` rejects with exactly `LAPSED`; `count('lms.account where org_id = <the DPS org>')` is unchanged and no `auth.users` row was added; with `mayImport: async () => null` the same plan applies as before.
6. `a store without mayImport imports as before` (the demo seed and the PGlite tests): `applyPlan(plan(), pgliteStore(db))` resolves (the existing tests in this file already pass through it).

`tools/lms-import/tests/supabaseStore.test.ts`, a new `describe('supabaseStore.mayImport')`:
7. `asks lms.import_refusal with the service role and answers its sentence or null`: with `fakeFetch` answering `json(LAPSED)`: the one call is `POST https://x.supabase.co/rest/v1/rpc/import_refusal`, headers `content-profile: lms`, `apikey` and `authorization: Bearer <KEY>`, body `{"p_org":"org-1"}`, and the answer is `LAPSED`; answering `json(null)` → `null`; answering status 500 → rejects (the import stops rather than going on unasked).

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run tools/lms-import/tests/admin.test.ts tools/lms-import/tests/apply.test.ts tools/lms-import/tests/supabaseStore.test.ts tools/admin-api/tests/handle.test.ts tools/lms-demo/tests/app-wiring.test.ts`
Expected: FAIL: the hosted admin's check returns 200 with a preview; staff preview returns 200; the demo import resolves; `applyPlan` with a refusing store creates the accounts (test 5); `store.mayImport is not a function` (test 7).

- [ ] **Step 3: Implement**

`tools/lms-import/src/admin.ts`, at the top of `importForSchool`, after `checkSheets(req)` and before `import_snapshot`:

```ts
  // Offboarded, suspended or ended, and later the school's privacy decision
  // (0063, admin.import_refusal): asked before anything is read, for the
  // school admin's calls and staff's alike.
  const refusal = await deps.rpc('import_refusal', { p_org: org });
  if (typeof refusal === 'string' && refusal) throw new Refused(409, refusal);
```

Extend the docblock of `importForSchool` with one sentence saying so.

`tools/lms-demo/src/import.ts`, in `importForAdmin`, right after the first `await adminOrg(db, caller, 'add people');` (before the kept-answer lookup), with `const org = await adminOrg(...)` capturing it:

```ts
  const refusal = (await db.query<{ r: string | null }>(`select lms.import_refusal($1) as r`, [org])).rows[0]?.r;
  if (refusal) throw new ImportRefused(409, refusal);
```

`tools/lms-import/src/apply.ts` (the founder's CLI, `cli.ts:90`, has no other door, R24): `ImportStore` gains

```ts
  /**
   * lms.import_refusal for this school (0063): null when people may be added,
   * else the sentence why not. Optional: only the hosted store (supabaseStore)
   * has it; the PGlite store, used by the demo seed and tests, does not.
   */
  mayImport?(orgId: string): Promise<string | null>;
```

and `applyPlan` asks it directly after `const org = await store.ensureSchool(plan.school);`, before the year, sections or any person:

```ts
  // Offboarded, suspended or ended, or the school's privacy decision not yet
  // made (0063, admin.import_refusal): stop before anyone is created. The
  // school row itself may already exist (ensureSchool), which holds no child.
  const refusal = store.mayImport ? await store.mayImport(org) : null;
  if (refusal) throw new Error(refusal);
```

`tools/lms-import/src/supabaseStore.ts`: `mayImport: async (orgId) => { const r = await call('/rest/v1/rpc/import_refusal', { method: 'POST', profile: 'lms', body: { p_org: orgId } }); return typeof r === 'string' && r ? r : null; }`. The CLI needs no change: its existing catch prints `Import stopped: <the sentence>` and exits 1 (`cli.ts:91-95`). On the hosted lms-admin and admin-api paths this is a second ask after `importForSchool`'s own (one more call per commit); it changes nothing there.

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run tools/lms-import tools/admin-api tools/lms-demo/tests/app-wiring.test.ts packages/admin-client`
Expected: PASS (2 + 3 + 1 + 1 new; the rest unchanged, `cli.test.ts` included).

- [ ] **Step 5: Commit**

```powershell
git add tools/lms-import/src/admin.ts tools/lms-import/src/apply.ts tools/lms-import/src/supabaseStore.ts tools/lms-demo/src/import.ts tools/lms-import/tests/admin.test.ts tools/lms-import/tests/apply.test.ts tools/lms-import/tests/supabaseStore.test.ts tools/admin-api/tests/handle.test.ts tools/lms-demo/tests/app-wiring.test.ts
Commit "feat: every import path asks whether the school may import (the school admin's, staff's, the demo's and the founder's CLI), and shows why not"
```

---

### Task 5: The tutor's admission obeys the switch; the reads the apps and finance need (0064)

**Files:**
- Create: `supabase/migrations/0064_app_admission_reads.sql`
- Test: `supabase/tests/app-tutor.test.ts`, `supabase/tests/app-reads.test.ts`; modify `supabase/tests/admin-invariants.test.ts`

**Interfaces:**
- Consumes: 0016's `claim_relay`, `public.org_of`, `public.app_config`, `billing.state_for`, `billing.invoice`, `lms.require_admin`, `public.relay_control`.
- Produces: `admin.tutor_enabled_for(uuid)`, the replaced `claim_relay`, `public.my_app_config()`, `lms.school_billing()`, `admin.stop_status()`.

- [ ] **Step 1: Write the failing tests**

`supabase/tests/app-tutor.test.ts` (fixtures: `owner`, `ops`, `setEnvironment`; `claim(user, relay = 'llm', units = 1)` = `select * from public.claim_relay($1, $2, $3)` through `asService`; `setSchool(code, value)` = `admin.flag_set('tutor.enabled','school',code,value,'a reason','TEST')` as `fresh(owner)`; `setGlobal(value)` likewise for global; `beforeEach` resets `relay_control` (`halted = false`, ceiling 50000) and deletes `relay_budget_day` as the database owner, as `admin-relay.test.ts:49-53` does):
1. `a child at a school whose tutor is switched off is refused as halted, and spends nothing`: `buildSchool(db, 'TOFF')`, `setSchool('TOFF', false)`; `claim(toff.kid8a)` → `{ allowed: false, reason: 'halted', retry_after: 300 }`; `select coalesce(sum(units), 0) from public.relay_budget_day` unchanged; `relay_usage.day_units` for that child is 0 or absent.
2. `a child at another school, and a child with no school, are not affected`: `buildSchool(db, 'TON')` kid → `allowed: true`; `anonymousChild(db)` → `allowed: true`.
3. `a suspended school's children are refused; a school in grace is not`: `setLicence(db, 'TSUS', 100, -20)` → `halted`/300; `setLicence(db, 'TGRA', 100, -3)` → allowed.
4. `the platform's switch off refuses everyone except a school switched on by itself`: `setGlobal(false)` → anonymous child `halted`; TON kid `halted`; `setSchool('TON', true)` → TON kid allowed; then `setGlobal(true)` and `setSchool('TON', true)` stays.
5. `a report gets the same halted answer, which the relay lets through (packages/relay/src/gate.ts:338-342)`: `claim(toff.kid8a, 'report', 0)` → `{ allowed: false, reason: 'halted' }`.
6. `the stop still comes first`: `update public.relay_control set halted = true` → TON kid `halted`, `retry_after` 300; reset.
7. `claim_relay is still the service role's only`: not executable by `anon`, `authenticated`; executable by `service_role`. `admin.tutor_enabled_for(uuid)` not executable by `anon`, `authenticated`, `service_role`.
8. `my_app_config is the caller's own school's config`: as `asUser(db, toff.kid8a, ...)` `select public.my_app_config()` deep-equals `public.app_config('TOFF')` (and its `tutor.enabled` is `false`); a TSUS child's has `billing.state` `suspended`; an anonymous child's (`asClaims({sub, is_anonymous: true})`) equals `app_config(null)`; as role `anon` with no claims, equals `app_config(null)`.

`supabase/tests/app-reads.test.ts` (fixtures: `owner`, `ops`, `safety` via `makeStaff`, `finance` via `makeFinance`, `readySeller(db, owner)`; `billingOf(user)` = `select lms.school_billing() as b` through `asUser`):
1. `the school admin reads ok, no invoices, when nothing is owed`: `billedSchool(db, owner, 'SBOK')`, its admin (`select user_id from lms.account where org_id = $1 and kind = 'admin'`) → `{ state: 'ok', graceUntil: null, openInvoices: 0, duePaise: 0, earliestDueOn: null }`.
2. `an open invoice is counted with what is still due and its due day; a void one is not`: `rpc(db, fresh(owner), 'billing_invoice_raise', { p_org, p_description: 'Term fee', p_amount_paise: 100000, p_due_days: 15, p_reason: 'term fee', p_env: 'TEST' })` → `openInvoices: 1`, `duePaise` equals that invoice's `total_paise` (read as the database owner), `earliestDueOn` equals its `due_on` as `YYYY-MM-DD`; after `admin.billing_invoice_void` (fresh owner, commit true) of a second one raised the same way, still 1.
3. `grace says its last day; suspended and ended say suspended`: `setLicence(db, 'SBOK', 100, -3)` → `state: 'grace'`, `graceUntil` = `(lms.india_today() - 3 + 14)` as text; `-20` → `suspended`, `graceUntil: null`; `-100` → `suspended`.
4. `only the school admin may read it`: the school's teacher and student → reject `/only the school admin can see this/`; `has_function_privilege('anon', 'lms.school_billing()', 'execute')` false.
5. `every staff role reads the stop's state, finance included, and nothing else`: as `aal2` of owner, ops, safety, finance: `admin.stop_status()` → exactly the keys `halted, haltedReason, haltedAt`, `halted: false`; after `admin.set_halt(true, 'vendor outage', 'TEST')` as `aal2(finance)` → `{ halted: true, haltedReason: 'vendor outage' }` and `haltedAt` not null; reset as the database owner.
6. `a child or a session without the second factor is refused`: anonymous child, and `{ sub: ops.id, aal: 'aal1' }` → `/not allowed/`.

`supabase/tests/admin-invariants.test.ts` (modify): add `'admin.stop_status',` between `'admin.staff_set',` and `'admin.system_health',` (C collation: `sta` < `sto` < `sy`); in the last test add `'my_app_config'` to the `in (...)` list and expect `['alert_snapshot', 'app_config', 'audit_head', 'my_app_config']`, renaming it `'exposes only four functions to the public schema for the apps and the outside checkers'`.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run supabase/tests/app-tutor.test.ts supabase/tests/app-reads.test.ts supabase/tests/admin-invariants.test.ts`
Expected: FAIL: test 1 of app-tutor gets `allowed: true`; `function public.my_app_config() does not exist`; `lms.school_billing` and `admin.stop_status` do not exist.

- [ ] **Step 3: Write the migration**

`supabase/migrations/0064_app_admission_reads.sql`, header comment: spec section 8 Tutor row and seam T3; why the refusal reads `halted` (R1: the deployed relay maps any other string to a rate limit and would stop reports, `packages/relay/src/gate.ts:234-235, 338-342`); `my_app_config` is for the tutor app, which does not know its learner's school; `school_billing` is spec section 13 for the school admin; `stop_status` gives finance (0061) a status it may read.

```sql
-- Whether the tutor is on for this learner: their school's effective
-- tutor.enabled (its own value, else the platform's, else the safe default,
-- and false while the school is suspended), exactly as public.app_config says
-- it to the apps. A learner with no school reads the platform's value.
create or replace function admin.tutor_enabled_for(p_user uuid)
returns boolean
language sql stable security definer
set search_path = admin, lms, public
as $$
  select (public.app_config((select s.code from lms.school s where s.org_id = public.org_of(p_user)))
          ->> 'tutor.enabled') is distinct from 'false'
$$;
revoke all on function admin.tutor_enabled_for(uuid) from public, anon, authenticated, service_role;
```

`public.claim_relay`: copy 0016's function (`0016:50-174`) line for line, and insert directly after the `if is_halted then ... end if;` block (`0016:93-98`):

```sql
  -- THE SCHOOL'S SWITCH (0064). Answered as 'halted' on purpose: the relay
  -- reads any reason it does not know as a rate limit and would then refuse a
  -- child's report (packages/relay/src/gate.ts), while 'halted' is shown as a
  -- pause and lets a report through. Before the window and the budgets, so a
  -- refusal here spends nothing.
  if not admin.tutor_enabled_for(p_user) then
    return query select false, 'halted'::text, 300;
    return;
  end if;
```

Restate `revoke all on function public.claim_relay(uuid, text, integer) from public, anon, authenticated; grant execute on function public.claim_relay(uuid, text, integer) to service_role;`.

```sql
create or replace function public.my_app_config()
returns jsonb
language sql stable security definer
set search_path = public, lms
as $$
  select public.app_config((select s.code from lms.school s where s.org_id = public.org_of(auth.uid())))
$$;
revoke all on function public.my_app_config() from public;
grant execute on function public.my_app_config() to anon, authenticated, service_role;

create or replace function lms.school_billing()
returns jsonb
language plpgsql stable security definer
set search_path = public, lms, billing
as $$
declare
  org uuid := lms.require_admin();
  st record;
begin
  select f.state, f.grace_until into st from billing.state_for(org, lms.india_today()) f;
  return jsonb_build_object(
    'state', case when st.state = 'grace' then 'grace'
                  when st.state in ('suspended', 'ended') then 'suspended' else 'ok' end,
    'graceUntil', case when st.state = 'grace' then to_char(st.grace_until, 'YYYY-MM-DD') end,
    'openInvoices', (select count(*)::int from billing.invoice i
                      where i.org_id = org and i.status in ('unpaid', 'partly_paid')),
    'duePaise', (select coalesce(sum(i.total_paise - i.paid_paise), 0) from billing.invoice i
                  where i.org_id = org and i.status in ('unpaid', 'partly_paid')),
    'earliestDueOn', (select to_char(min(i.due_on), 'YYYY-MM-DD') from billing.invoice i
                       where i.org_id = org and i.status in ('unpaid', 'partly_paid')));
end;
$$;
revoke all on function lms.school_billing() from public, anon;
grant execute on function lms.school_billing() to authenticated;

create or replace function admin.stop_status()
returns jsonb
language plpgsql stable security definer
set search_path = admin, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['owner', 'ops', 'safety', 'finance']);
  rc record;
begin
  select c.halted, c.halted_reason, c.halted_at into rc from public.relay_control c where c.id;
  return jsonb_build_object('halted', coalesce(rc.halted, false), 'haltedReason', rc.halted_reason, 'haltedAt', rc.halted_at);
end;
$$;
revoke all on function admin.stop_status() from public, anon;
grant execute on function admin.stop_status() to authenticated;
```

- [ ] **Step 4: Run and see them pass, then every database and relay file**

Run: `npx vitest run supabase/tests/app-tutor.test.ts supabase/tests/app-reads.test.ts supabase/tests/admin-invariants.test.ts`
Expected: PASS: 8 + 6 + 4.
Run: `npx vitest run supabase/tests apps/classroom/tests/migrations.test.ts packages/relay tools/lms-import tools/admin-api`
Expected: PASS (`admin-relay.test.ts`'s halted test and 0016's text checks unchanged).

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/0064_app_admission_reads.sql supabase/tests/app-tutor.test.ts supabase/tests/app-reads.test.ts supabase/tests/admin-invariants.test.ts
Commit "feat: the tutor's admission refuses a school whose tutor is off or suspended; the apps' own-school config, the school admin's billing notice and the stop state for every role"
```

---

### Task 6: One reader for the school apps (`packages/lms-client`) and the demo route

**Files:**
- Create: `packages/lms-client/src/app-config.ts`, `packages/lms-client/tests/app-config.test.ts`
- Modify: `packages/lms-client/src/index.ts` (one `export * from './app-config.ts';`), `transport.ts` (`schema(name: 'lms' | 'public')`), `backend.ts` (`appConfig`), `api.ts` (`schoolBilling`), `packages/lms-client/tests/backend-hosted.test.ts`, `tools/lms-demo/src/server.ts`, `tools/lms-demo/tests/app-wiring.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/lms-client/tests/app-config.test.ts` (pure):
1. `a version is three whole numbers of up to four digits`: `parseVersion('0.1.0')` → `[0,1,0]`; `'10.0.12'` → `[10,0,12]`; `null` for `'0.1'`, `'1.0.0-beta'`, `' 1.0.0'`, `''`, `undefined`, `1`, `'12345.0.0'`.
2. `a build is below the minimum only when both are well formed and it is older`: `isBelowMinimum('0.1.0','0.1.1')` true; `('2.3.0','10.0.0')` true (numbers, not text); `('0.1.0','0.1.0')`, `('0.1.0','0.0.0')`, `('0.2.0','0.1.9')` false; `('0.1.0','0.2')`, `('0.1.0','')`, `('0.1.0', null)`, `('0.1.0','v9.9.9')`, `('bad','9.9.9')` false.
3. `the safe defaults turn nothing on`: `SCHOOL_APP_DEFAULTS` equals `{ bannerMessage: '', bannerTone: 'info', minVersion: '0.0.0', billingState: 'ok', graceUntil: null }`.
4. `parsing takes each known key of the right type and the default for anything else`: `parseSchoolAppConfig({ 'banner.message': 'Back at 7', 'banner.tone': 'warning', 'app.min_version.student': '0.2.0', 'app.min_version.lms': '3.0.0', 'billing.state': 'grace', 'billing.grace_until': '2026-11-02' }, 'student')` → `{ bannerMessage: 'Back at 7', bannerTone: 'warning', minVersion: '0.2.0', billingState: 'grace', graceUntil: '2026-11-02' }`; with `'lms'` → `minVersion: '3.0.0'`; `parseSchoolAppConfig(null, 'student')`, `('nonsense')`, `({ 'banner.tone': 'loud', 'billing.state': 'ended', 'banner.message': 42 })` → the defaults; `'billing.grace_until': ''` → `null`.
5. `billing notices say what is so`: `billingNotices({ state: 'ok', graceUntil: null, openInvoices: 0, duePaise: 0, earliestDueOn: null }, '2026-10-08')` → `[]`; with one invoice of `1180000` due `'2026-10-20'` → `[{ kind: 'invoice-due', title: 'An invoice from Qrie is due', text: 'Rs 11,800.00 is due by 20 Oct 2026.' }]`; due `'2026-10-01'` → `[{ kind: 'invoice-overdue', title: 'An invoice from Qrie is overdue', text: 'Rs 11,800.00 was due on 1 Oct 2026.' }]`; two invoices → text begins `'Rs 11,800.00 on 2 invoices'`; grace `'2026-10-22'` → first notice `{ kind: 'grace', title: 'Your licence has ended', text: 'Qrie keeps working until 22 Oct 2026. After that the tutor switches off for your school and no new people can be added; homework, marks and exports stay. Ask Qrie to renew it.' }`; suspended → `{ kind: 'suspended', title: 'Your licence has ended and its grace period is over', text: 'The tutor is off for your school and no new people can be added. Homework, marks and exports still work. Ask Qrie to renew it.' }`. Rupees are `en-IN` with two decimals (`Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })`), dates `d MMM yyyy` written by hand (no date library in the package).

`packages/lms-client/tests/backend-hosted.test.ts` (modify its `fakeSupabase` so `schema(name)` records `name` and answers `rpc('app_config', { p_school })` with `{ data: { 'banner.message': 'x' }, error: null }`, and `rpc('school_billing')` with a fixed object):
6. `the hosted backend reads app_config in the public schema with the school's code, or none`: `await b.appConfig('HOS')` → `{ 'banner.message': 'x' }`, recorded `schema('public')`, args `{ p_school: 'HOS' }`; `appConfig(null)` → args `{ p_school: null }`; `appConfig('bad code')` rejects `/not a school code/` without a call.
7. `schoolBilling() is lms.school_billing as one value`: `b.api.schoolBilling()` resolves to the fixed object.

`tools/lms-demo/tests/app-wiring.test.ts` (extend; `server = await startDemoServer({ db, port: 0 })`, closed in `afterAll`):
8. `the demo answers app_config unsigned, for a school or for nobody`: `demoBackend(server.url).appConfig('DSU')` deep-equals `select public.app_config('DSU')` (with `billing.state` `suspended`, from Task 4's licence); `appConfig(null)` equals `app_config(null)`.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run packages/lms-client/tests/app-config.test.ts packages/lms-client/tests/backend-hosted.test.ts tools/lms-demo/tests/app-wiring.test.ts`
Expected: FAIL: `Cannot find module '../src/app-config.ts'`; `b.appConfig is not a function`; the demo route answers 404.

- [ ] **Step 3: Implement**

`packages/lms-client/src/app-config.ts` (no imports):

```ts
/**
 * WHAT THE STUDENT AND TEACHER APPS READ FROM QRIE CONTROL (public.app_config),
 * and what they assume when they cannot read it. Nothing here turns a feature
 * on: no banner, no notice and no minimum build are the defaults, and the
 * things a client could skip (the tutor, imports) are refused by the database.
 */
export const VERSION = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;

export function parseVersion(v: unknown): [number, number, number] | null {
  const m = typeof v === 'string' ? VERSION.exec(v) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True only when both are well formed and the build is older: a typo never locks anyone out. */
export function isBelowMinimum(build: string, minimum: unknown): boolean {
  const b = parseVersion(build);
  const m = parseVersion(minimum);
  if (!b || !m) return false;
  for (let i = 0; i < 3; i += 1) if (b[i] !== m[i]) return b[i] < m[i];
  return false;
}

export interface SchoolAppConfig {
  bannerMessage: string;
  bannerTone: 'info' | 'warning';
  minVersion: string;
  /** Coarse, as plan 3's app_config says it: anyone who guesses a school code can read it. */
  billingState: 'ok' | 'grace' | 'suspended';
  graceUntil: string | null;
}

export const SCHOOL_APP_DEFAULTS: SchoolAppConfig = {
  bannerMessage: '', bannerTone: 'info', minVersion: '0.0.0', billingState: 'ok', graceUntil: null,
};

export function parseSchoolAppConfig(raw: unknown, app: 'student' | 'lms'): SchoolAppConfig { /* per key, typed, else default */ }

export interface SchoolBilling {
  state: 'ok' | 'grace' | 'suspended';
  graceUntil: string | null;
  openInvoices: number;
  duePaise: number;
  earliestDueOn: string | null;
}
export interface BillingNotice { kind: 'grace' | 'suspended' | 'invoice-due' | 'invoice-overdue'; title: string; text: string }
/** `today` is India's day, YYYY-MM-DD. The state's notice first, then the invoice's. */
export function billingNotices(b: SchoolBilling, today: string): BillingNotice[] { /* texts as test 5 */ }
```

`transport.ts`: `schema(name: 'lms' | 'public')` in `RpcClient` (the transport itself still calls `'lms'`).
`backend.ts`: add to `Backend`:

```ts
  /** public.app_config for a school code, or for nobody (null): the switches the apps obey. Unsigned. */
  appConfig(code: string | null): Promise<unknown>;
```

`supabaseBackend`: `if (code !== null && !SCHOOL_CODE.test(code)) throw new Error('not a school code');` then `supabase.schema('public').rpc('app_config', { p_school: code })`, throwing `error.message`, returning `data`. `demoBackend`: the same check, then `GET ${base}/public/app-config${code ? `/${code}` : ''}` through `send`, returning `.config`.
`api.ts`: `schoolBilling(): Promise<SchoolBilling>` = `(await value('school_billing')) as SchoolBilling`, beside `schoolLicence` (`api.ts:1056-1060`), with the docblock "The school admin's licence and invoice state (lms.school_billing, 0064)."
`tools/lms-demo/src/server.ts`: beside the school-brand route (`server.ts:176-186`), and in its top docblock's route list:

```ts
    // What Qrie control tells the apps (public.app_config), unsigned like the
    // school's look: for one school, or for nobody.
    const configOf = /^\/public\/app-config(?:\/([A-Z0-9]{3,12}))?$/.exec(route);
    if (req.method === 'GET' && configOf) {
      const config = await db.transaction(async (tx) => {
        await tx.exec('set local role anon');
        return (await tx.query<{ c: unknown }>(`select public.app_config($1) as c`, [configOf[1] ?? null])).rows[0].c;
      });
      return send(res, 200, { config });
    }
```

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run packages/lms-client tools/lms-demo/tests/app-wiring.test.ts`
Expected: PASS (5 + 2 + 1 new; the rest unchanged). Then `npm run typecheck`. Expected: exit 0.

- [ ] **Step 5: Commit**

```powershell
git add packages/lms-client tools/lms-demo/src/server.ts tools/lms-demo/tests/app-wiring.test.ts
Commit "feat: the school apps read app_config through their backend, hosted or demo, with safe defaults and a version check that cannot lock anyone out"
```

---

### Task 7: The tutor app reads the console (`apps/classroom`)

**Files:**
- Create: `apps/classroom/src/lib/appConfig.ts`, `apps/classroom/src/lib/appConfigRead.ts`, `apps/classroom/src/ui/AppConfigGate.tsx`; tests `apps/classroom/tests/appConfig.test.ts`, `apps/classroom/tests/appConfigGate.test.tsx`
- Modify: `apps/classroom/src/lib/prototype.ts`, `apps/classroom/src/App.tsx`, `apps/classroom/src/main.tsx`, `apps/classroom/package.json` (`0.0.1` → `0.1.0`), `package-lock.json` (the `apps/classroom` entry's `version`, `package-lock.json:78`)

**The tutor's built-in safe defaults** (used before the first read and whenever no read has ever succeeded; after a good read, a failed one keeps the last good values):

| Key | Default | Why it is safe |
|---|---|---|
| `banner.message` / `banner.tone` | `''` / `info` | no notice |
| `tutor.enabled` | `true` | the app's belief turns nothing on: `claim_relay` refuses a class itself when the switch is off (Task 5); `false` here would show every child a pause whenever the read failed |
| `tutor.only_prepared` | `true` | "cannot read" must not mean "prepare new classes and spend" (R4) |
| `tutor.compose_live_classes` | `false` | no screen reads it on this branch (R7) |
| `app.min_version.classroom` | `0.0.0` | nobody is asked to update |

- [ ] **Step 1: Write the failing tests**

`apps/classroom/tests/appConfig.test.ts` (jsdom; `vi.useFakeTimers()` where timing matters; each test calls `__resetAppConfigForTests()`):
1. `the build is package.json's version`: `CLASSROOM_BUILD` equals `JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version`, and is `0.1.0`.
2. `the safe defaults are the table's`: `CLASSROOM_DEFAULTS` equals `{ bannerMessage: '', bannerTone: 'info', tutorEnabled: true, onlyPrepared: true, composeLiveClasses: false, minVersion: '0.0.0' }`; `getAppConfig()` equals it before any read.
3. `parsing takes each key of the right type, else its default`: `parseClassroomConfig({ 'banner.message': 'Back at 7', 'banner.tone': 'warning', 'tutor.enabled': false, 'tutor.only_prepared': false, 'tutor.compose_live_classes': true, 'app.min_version.classroom': '0.2.0', 'billing.state': 'ok' })` → all six taken; `({ 'tutor.enabled': 'false', 'tutor.only_prepared': 0 })` → defaults for both; `null` and `{ states: {} }` (what `prototypeGate.test.tsx` stubs for every non-catalogue fetch) → the defaults.
4. `tutor.only_prepared from the console sets the gate every screen reads`: `import { PROTOTYPE_ONLY_PREPARED } from '../src/lib/prototype'` reads `true`; `applyAppConfig({ 'tutor.only_prepared': false })` → the imported binding reads `false` and `isFrozen('not-yet')` is `false`; `applyAppConfig({})` → `true` again.
5. `a failed read keeps the last good values; with none, the safe defaults`: `refreshAppConfig(async () => { throw new Error('offline') })` → `getAppConfig()` is the defaults; after a good read with `'tutor.enabled': false`, a failing read leaves `tutorEnabled` `false`.
6. `a read that never answers counts as failed after 8 seconds`: `refreshAppConfig(() => new Promise(() => {}))` with fake timers advanced 8 000 ms resolves and leaves the config unchanged.
7. `it reads at start, every five minutes, when the app is shown again, and when the network comes back; and stops`: `const stop = startAppConfig(read)` → `read` called once; advance 300 000 ms → twice; `document.dispatchEvent(new Event('visibilitychange'))` with `document.visibilityState` stubbed `'visible'` → three; `window.dispatchEvent(new Event('online'))` → four; `stop()` then advance 300 000 → still four.
8. `subscribers hear a change and only a change`: `subscribeAppConfig(fn)`; applying the same raw twice calls `fn` once.
9. `the version check is the same rule as the school apps'`: the cases of Task 6 test 2, against this module's `isBelowMinimum`.
10. `importing the module starts nothing`: after a fresh `vi.resetModules()` and `await import('../src/lib/appConfig')`, a stubbed `fetch` was not called.

`apps/classroom/tests/appConfigGate.test.tsx` (render with `createRoot` as `prototypeGate.test.tsx:63-80` does):
1. `with the defaults it shows the app and nothing else`: children text present; no `[role="status"]`.
2. `a banner sits above the app, as plain text, in its tone`: `applyAppConfig({ 'banner.message': '<b>Back</b> at 7', 'banner.tone': 'warning' })` → a `[role="status"]` whose `textContent` is `'<b>Back</b> at 7'` (no `<b>` element) and `data-tone="warning"`; children still present.
3. `an older build is asked to update and shown nothing else but the helplines`: `applyAppConfig({ 'app.min_version.classroom': '9.0.0' })` → text `Time to update Qrie` and a button `Reload`; children absent; `a[href="tel:14416"]` and `a[href="tel:1098"]` present. `'9.0'` (malformed) → children present.
4. `the tutor switched off shows the pause notice, with the helplines, instead of the app`: `applyAppConfig({ 'tutor.enabled': false })` → text `The tutor is switched off for now`; children absent; the two `tel:` links of test 3 present (a child in distress who opens a paused app still reaches a person); with a banner set too, the banner shows above it.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run apps/classroom/tests/appConfig.test.ts apps/classroom/tests/appConfigGate.test.tsx`
Expected: FAIL: `Cannot find module '../src/lib/appConfig'`.

- [ ] **Step 3: Implement**

`apps/classroom/src/lib/prototype.ts`: change only the gate's declaration and its docblock; nothing else in the file.

```ts
/**
 * THE PROTOTYPE GATE: only a class that already exists may be opened.
 * (… keep the first two paragraphs of the existing docblock …)
 *
 * SET FROM QRIE CONTROL. The value is the console's `tutor.only_prepared`
 * switch, applied by lib/appConfig.ts when the app reads public.my_app_config.
 * It is `true` until a read succeeds, and stays at the last value read when a
 * later read fails, so an app that cannot reach the console never starts
 * preparing new classes on its own. Screens read it at render; App subscribes
 * to the config so they re-render when it changes.
 */
export let PROTOTYPE_ONLY_PREPARED = true;

/** Called by lib/appConfig.ts only. */
export function setOnlyPrepared(on: boolean): void {
  PROTOTYPE_ONLY_PREPARED = on;
}
```

`apps/classroom/src/lib/appConfig.ts`: `CLASSROOM_BUILD = '0.1.0'`; the `ClassroomConfig` type and `CLASSROOM_DEFAULTS` (the table above, its reasons as comments); `parseClassroomConfig(raw)`; `parseVersion` and `isBelowMinimum` (the same code as `packages/lms-client/src/app-config.ts`, copied so this module ports to the live tutor branch with no new dependency; its docblock says so); a module-level store (`let current = CLASSROOM_DEFAULTS`, a `Set` of listeners) with `getAppConfig`, `subscribeAppConfig(fn) => unsubscribe`, `useAppConfig()` (`useSyncExternalStore(subscribeAppConfig, getAppConfig)`), `applyAppConfig(raw)` (parse; if any field differs, replace `current`, call `setOnlyPrepared(current.onlyPrepared)`, notify), `refreshAppConfig(read, timeoutMs = 8000)` (race `read()` against a timeout; apply on success; swallow failure, keeping `current`), `startAppConfig(read, everyMs = 300_000)` (read now; `setInterval`; `visibilitychange` when `document.visibilityState === 'visible'`; `online`; returns a `stop` that removes all three), and `__resetAppConfigForTests()`. No side effect at import.

`apps/classroom/src/lib/appConfigRead.ts`:

```ts
import { supabase } from './supabase';

/**
 * The config for whoever this phone is signed in as (public.my_app_config):
 * their school's switches when they belong to one, else the platform's. It
 * works signed out too (the platform's). It sends nothing but the session the
 * Supabase client already holds.
 */
export async function readMyAppConfig(): Promise<unknown> {
  const db = supabase();
  if (!db) throw new Error('no project configured');
  const { data, error } = await db.rpc('my_app_config');
  if (error) throw new Error(error.message);
  return data;
}
```

`apps/classroom/src/ui/AppConfigGate.tsx`: `AppConfigGate({ children })` using `useAppConfig()`:
- below the minimum (`isBelowMinimum(CLASSROOM_BUILD, c.minVersion)`): a full-screen card, title `Time to update Qrie`, body `This version of the app is too old to use. Please update it, then open it again.`, a `Reload` button (`window.location.reload()`), and the helpline line (below); nothing else.
- the helpline line, on both full-screen cards: `If you need to talk to someone now:` then `tel:` links `Tele-MANAS {HELPLINES.telemanas}` and `Childline {HELPLINES.childline}`, with `HELPLINES` imported from `@ai-tutor/safety` exactly as `src/screens/Help.tsx:2, 69-74` does (no new dependency). The app's report replay (`useReportReplay`, `App.tsx:595`) stays above the gate, so a report already waiting on the phone is still sent while the card shows.
- otherwise a banner when `c.bannerMessage !== ''`: `<div role="status" data-tone={c.bannerTone}>{c.bannerMessage}</div>` (text only, never HTML), styled like `ui/RefusalNotice.tsx` (warning tone uses its amber colours, info its neutral ones);
- then, when `!c.tutorEnabled`, a full-screen card, title `The tutor is switched off for now`, body `Classes are paused at the moment. Please come back later; nothing you have done is lost.` instead of the children; else the children.

Hook-ins:
- `main.tsx`, beside `startAccountSync();` (`main.tsx:114`):
  ```ts
  import { startAppConfig } from './lib/appConfig';
  import { readMyAppConfig } from './lib/appConfigRead';
  // What Qrie control says (banner, tutor switches, minimum build): read now,
  // every five minutes, and on return to the app. A failed read keeps the
  // last good values, or the safe defaults (lib/appConfig.ts).
  startAppConfig(readMyAppConfig);
  ```
- `App.tsx`: `import { useAppConfig } from './lib/appConfig';` and `import { AppConfigGate } from './ui/AppConfigGate';`; in `App()` add `useAppConfig(); // so every screen re-renders when tutor.only_prepared changes (screens read PROTOTYPE_ONLY_PREPARED at render)`; wrap `<Gate>…</Gate>` as `<AppConfigGate><Gate>…</Gate></AppConfigGate>` (`App.tsx:600, 645`).
- `package.json` `"version": "0.1.0"`; the same in `package-lock.json`'s `apps/classroom` entry.

- [ ] **Step 4: Run and see them pass, then the tutor's suite**

Run: `npx vitest run apps/classroom/tests/appConfig.test.ts apps/classroom/tests/appConfigGate.test.tsx`
Expected: PASS: 10 + 4.
Run: `npx vitest run apps/classroom`
Expected: PASS, including `prototypeGate.test.tsx` (the gate is `true` until a test applies a config) and the screens that import `PROTOTYPE_ONLY_PREPARED`. A failure of `reportReplay.test.ts` alone is the known 30 s flake: rerun that file alone and record both runs.
Run: `npm run typecheck`
Expected: exit 0.
Run: `npm run build` then `Remove-Item -Recurse -Force apps/classroom/dist`
Expected: `vite build` succeeds. Then `Select-String -Path apps/classroom/dist/assets/*.js -Pattern 'my_app_config' -List` before deleting: at least one file (the reader is in the bundle).

- [ ] **Step 5: Commit**

```powershell
git add apps/classroom/src/lib/appConfig.ts apps/classroom/src/lib/appConfigRead.ts apps/classroom/src/ui/AppConfigGate.tsx apps/classroom/src/lib/prototype.ts apps/classroom/src/App.tsx apps/classroom/src/main.tsx apps/classroom/package.json apps/classroom/tests/appConfig.test.ts apps/classroom/tests/appConfigGate.test.tsx package-lock.json
Commit "feat: the tutor app reads Qrie control: banner, pause, only-prepared from the switch, and a minimum build, with safe defaults"
```

---

### Task 8: The student app reads the console (`apps/student`)

**Files:**
- Create: `apps/student/src/lib/build.ts`, `apps/student/src/lib/app-config.tsx`, `apps/student/src/components/app-notices.tsx`; test `apps/student/tests/app-notices.test.tsx`
- Modify: `apps/student/src/routes/__root.tsx`, `apps/student/package.json` (`0.0.1` → `0.1.0`), `package-lock.json` (`apps/student` entry)

**The student app's safe defaults:** `SCHOOL_APP_DEFAULTS` (no banner, no notice, no minimum). A grace state shows nothing to a student or parent (R14); suspended shows one notice.

- [ ] **Step 1: Write the failing test**

`apps/student/tests/app-notices.test.tsx` (relative imports only: root vitest maps `@` to the teacher app; `app-notices.tsx` and `build.ts` import nothing with `@`):
1. `the build is package.json's version`: `STUDENT_BUILD` (from `../src/lib/build`) equals `apps/student/package.json`'s version, `0.1.0`.
2. `with the defaults it shows the app and nothing else`: `<AppNotices config={SCHOOL_APP_DEFAULTS} build='0.1.0'>child</AppNotices>` → `child` present, no `[role="status"]`.
3. `a banner, as plain text, in its tone`: banner `'<i>Exams</i> moved'`, tone `warning` → `[role="status"][data-tone="warning"]` with that exact text and no `<i>` element.
4. `a suspended school shows one notice and the app; grace shows nothing`: `billingState: 'suspended'` → text `Qrie's tutor is switched off for your school for now. Your homework, marks and practice are all here as usual.` and `child`; `'grace'` → no notice.
5. `an older build is asked to update and shown nothing else`: `minVersion: '0.2.0'` → `Please update the app` and a `Reload` button, `child` absent; `minVersion: '0.2'` → `child` present.

- [ ] **Step 2: Run and see it fail**

Run: `npx vitest run apps/student/tests/app-notices.test.tsx`
Expected: FAIL: `Cannot find module '../src/components/app-notices'`.

- [ ] **Step 3: Implement**

- `src/lib/build.ts`: `export const STUDENT_BUILD = '0.1.0';` with a comment: the number Qrie control's `app.min_version.student` compares; keep it equal to `package.json` (a test checks).
- `src/components/app-notices.tsx`: `AppNotices({ config, build, children })`, pure, Tailwind classes only (no `@` imports); update screen title `Please update the app`, body `This copy of the app is too old to use. On a phone, update it from where you installed it; in a browser, reload the page.`, `Reload` button; banner as in Task 7; the suspended notice text of test 4, under the banner, above the children.
- `src/lib/app-config.tsx`:
  ```tsx
  import { useQuery } from '@tanstack/react-query'
  import { parseSchoolAppConfig, SCHOOL_APP_DEFAULTS, type SchoolAppConfig } from '@ai-tutor/lms-client'
  import { backend } from '@/lib/backend'
  import { useAuthStore } from '@/stores/auth-store'
  import { AppNotices } from '@/components/app-notices'
  import { STUDENT_BUILD } from '@/lib/build'

  /**
   * Qrie control's switches for this school, or the platform's before sign-in
   * (public.app_config through the backend). Read at start, every five minutes
   * and when the app is shown again (TanStack Query's focus refetch). A failed
   * read keeps the last good answer, or SCHOOL_APP_DEFAULTS: nothing turns on.
   */
  export function useStudentAppConfig(): SchoolAppConfig {
    const code = useAuthStore((s) => s.me?.schoolCode ?? null)
    const q = useQuery({
      queryKey: ['app-config', code ?? '-'],
      queryFn: () => backend.appConfig(code),
      refetchInterval: 300_000,
      refetchOnWindowFocus: true,
      retry: 1,
      placeholderData: (previous) => previous,
    })
    return q.data === undefined ? SCHOOL_APP_DEFAULTS : parseSchoolAppConfig(q.data, 'student')
  }

  export function AppGate({ children }: { children: React.ReactNode }) {
    return <AppNotices config={useStudentAppConfig()} build={STUDENT_BUILD}>{children}</AppNotices>
  }
  ```
- `src/routes/__root.tsx`: `import { AppGate } from '@/lib/app-config'` and `<AppGate><Outlet /></AppGate>` (the Toaster stays outside).
- `package.json` and `package-lock.json` (`apps/student` entry) `0.1.0`.

- [ ] **Step 4: Run and see it pass; typecheck and build**

Run: `npx vitest run apps/student`
Expected: PASS: 5 new + `mastery-info.test.tsx`.
Run: `npm run typecheck`; then `npm run build --workspace @ai-tutor/student` and `Remove-Item -Recurse -Force apps/student/dist`
Expected: exit 0; `tsc -b && vite build` succeeds.

- [ ] **Step 5: Commit**

```powershell
git add apps/student/src/lib/build.ts apps/student/src/lib/app-config.tsx apps/student/src/components/app-notices.tsx apps/student/src/routes/__root.tsx apps/student/package.json apps/student/tests/app-notices.test.tsx package-lock.json
Commit "feat: the student app reads Qrie control: banner, the school's suspension notice and a minimum build, with safe defaults"
```

---

### Task 9: The teacher app reads the console, and the school admin sees the licence and invoices (`apps/lms`)

**Files:**
- Create: `apps/lms/src/lib/build.ts`, `apps/lms/src/lib/app-config.tsx`, `apps/lms/src/components/app-notices.tsx`, `apps/lms/src/features/school/billing-notice.tsx`; test `apps/lms/tests/app-notices.test.tsx`
- Modify: `apps/lms/src/routes/__root.tsx`, `apps/lms/src/features/school/licence.tsx`, `apps/lms/package.json` (`2.2.1` → `2.3.0`), `package-lock.json` (`apps/lms` entry)

**Safe defaults:** `SCHOOL_APP_DEFAULTS` for the banner and minimum; the billing notice shows nothing until `lms.school_billing` answers, and nothing when it fails (the licence banner's own warnings stay).

- [ ] **Step 1: Write the failing test**

`apps/lms/tests/app-notices.test.tsx`:
1. `the build is package.json's version`: `LMS_BUILD` equals `apps/lms/package.json`'s version, `2.3.0`.
2. `with the defaults it shows the portal and nothing else`; 3. `a banner, as plain text, in its tone`; 4. `an older build is asked to update and shown nothing else` (title `This version of Qrie for teachers is too old`, body `Reload the page, or update the app, to go on.`, `Reload`; `minVersion: '3.0.0'` blocks `2.3.0`, `'3.0'` does not): as Task 8's 2, 3, 5 against `AppNotices`.
5. `the school admin's billing notice shows each notice billingNotices gives`: `<BillingNoticeView billing={{ state: 'suspended', … }} today='2026-10-08' />` renders the suspended title and text in a destructive alert; `{ state: 'grace', graceUntil: '2026-10-22', openInvoices: 1, duePaise: 1180000, earliestDueOn: '2026-10-01' }` renders the grace notice then the overdue one; `{ state: 'ok', openInvoices: 0, … }` renders nothing.
6. `the licence banner leaves out "has ended" when the billing notice already says so`: `licenceWarningsShown(['ended', 'full'], 'grace')` → `['full']`; `(['ended'], 'ok')` → `['ended']`; `(['ending'], 'suspended')` → `['ending']`.

- [ ] **Step 2: Run and see it fail**

Run: `npx vitest run apps/lms/tests/app-notices.test.tsx`
Expected: FAIL: missing modules.

- [ ] **Step 3: Implement**

- `src/lib/build.ts`: `export const LMS_BUILD = '2.3.0'` (comment as Task 8).
- `src/components/app-notices.tsx`: `AppNotices({ config, build, children })` with the kit's `Alert` for the banner (`role="status"`, `data-tone`), the update screen of test 4; teachers see no billing state here.
- `src/lib/app-config.tsx`: `useLmsAppConfig()` and `AppGate` exactly as Task 8's, with `'lms'` and `LMS_BUILD`.
- `src/features/school/billing-notice.tsx`:
  ```tsx
  /** The school admin's licence and invoice state (lms.school_billing, 0064): spec section 13. */
  export const useSchoolBilling = () =>
    useQuery({ queryKey: ['school', 'billing'], queryFn: api.schoolBilling, refetchInterval: 300_000 })
  /** India's day as YYYY-MM-DD, for billingNotices. */
  export const indiaToday = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
  export function BillingNoticeView({ billing, today }: { billing: SchoolBilling; today: string }) { /* one Alert per billingNotices(billing, today); destructive for suspended and overdue, amber (as licence.tsx:55) for grace and due */ }
  export function BillingNotice() { const b = useSchoolBilling(); return b.data ? <BillingNoticeView billing={b.data} today={indiaToday()} /> : null }
  /** The licence warnings to show beside the billing notice: "ended" is said by the notice in grace and suspension. */
  export function licenceWarningsShown(w: LicenceWarning[], state: SchoolBilling['state'] | undefined): LicenceWarning[]
  ```
- `src/features/school/licence.tsx` (`LicenceBanner`, `licence.tsx:42-65`): read `useSchoolBilling()`; render `<BillingNotice />` first; filter `warnings` through `licenceWarningsShown(warnings, billing.data?.state)`; the early `return null` happens only when both are empty. Its docblock gains: "With the school's billing notice (billing-notice.tsx) above the licence's own warnings." Nothing else in the file changes.
- `src/routes/__root.tsx`: `<AppGate><Outlet /></AppGate>` (`NavigationProgress`, `Toaster` and the devtools stay outside).
- `package.json` and `package-lock.json` (`apps/lms` entry) `2.3.0`.

- [ ] **Step 4: Run and see it pass; typecheck and build**

Run: `npx vitest run apps/lms packages/lms-client`
Expected: PASS: 6 new; the rest unchanged.
Run: `npm run typecheck`; then `npm run build --workspace @ai-tutor/lms` and `Remove-Item -Recurse -Force apps/lms/dist`
Expected: exit 0; the build succeeds.

- [ ] **Step 5: Commit**

```powershell
git add apps/lms/src/lib/build.ts apps/lms/src/lib/app-config.tsx apps/lms/src/components/app-notices.tsx apps/lms/src/features/school/billing-notice.tsx apps/lms/src/features/school/licence.tsx apps/lms/src/routes/__root.tsx apps/lms/package.json apps/lms/tests/app-notices.test.tsx package-lock.json
Commit "feat: the teacher app reads Qrie control, and the school admin sees grace, suspension and invoices due"
```

---

### Task 10: The contest form says whether entries are open (`landing`)

**Files:**
- Create: `landing/lib/contest-config.ts`, `landing/lib/use-entries.ts`; test `landing/tests/contest-config.test.ts`
- Modify: `landing/lib/contest.ts`, `landing/app/challenge-register/page.tsx`, `vitest.config.ts` (add `'landing/tests/**/*.test.ts',` to `include`, `vitest.config.ts:58-63`)

**Safe default:** a failed read shows "We could not check whether entries are open" with **Try again**, and no form (R11). The database refuses a closed or full contest whatever the page shows (Task 2).

- [ ] **Step 1: Write the failing test**

`landing/tests/contest-config.test.ts` (imports `../lib/contest-config` with no extension: landing's `tsconfig.json` has no `allowImportingTsExtensions`):
1. `entries are open only when the switch says true`: `entriesOpenFrom({ 'contest.entries_open': true })` → `'open'`; `false` → `'closed'`; `{}`, `null`, `'x'`, `{ 'contest.entries_open': 'true' }` → `'unknown'`.
2. `each refusal the database can give has its sentence`: `problemForCode('53400')` → `'Entries are full for today. Please come back after midnight (India time); nothing was saved.'`; `'55000'` → `'Entries are closed right now. Nothing was saved.'`; `'08006'`, `undefined` → `'We could not save that. Please try again in a moment.'`.

- [ ] **Step 2: Run and see it fail**

Run: `npx vitest run landing/tests/contest-config.test.ts`
Expected: FAIL: `No test files found` until the include line is added; after adding it, `Cannot find module '../lib/contest-config'`.

- [ ] **Step 3: Implement**

`landing/lib/contest-config.ts` (no imports):

```ts
/**
 * Whether the contest takes entries, as Qrie control's contest.entries_open
 * says through public.app_config, and what each refusal of
 * record_contest_signup means for the person at the form. The database
 * enforces both switches (migration 0062); this page only says so first.
 */
export type Entries = 'checking' | 'open' | 'closed' | 'unknown'
export function entriesOpenFrom(raw: unknown): Exclude<Entries, 'checking'> { … }
export function problemForCode(code: string | undefined): string { … }
```

`landing/lib/use-entries.ts`:

```ts
'use client'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { entriesOpenFrom, type Entries } from './contest-config'

/** Reads the switch when the form opens and on "Try again". A failed read is 'unknown', never 'open'. */
export function useEntriesOpen(): { entries: Entries; retry: () => void } { … db.rpc('app_config', { p_school: null }) … }
```

`landing/lib/contest.ts` (`contest.ts:102-116`): the error branch becomes `console.error(...)` then `return { ok: false, problem: problemForCode(error.code) }`; its comment says 53400 is the day's limit (it lifts at midnight India time, migration 0062) and 55000 is entries closed.

`landing/app/challenge-register/page.tsx`: `const { entries, retry } = useEntriesOpen()`; when `entries !== 'open'` and the state is not `saved`, render in place of the `<form>` a `div.register-form` with: `checking` → `Checking whether entries are open…`; `closed` → heading `Entries are closed right now` and `Please check back soon.`; `unknown` → `We could not check whether entries are open.` and a `button.pill.dark-pill` `Try again` calling `retry`. The intro column is unchanged.

- [ ] **Step 4: Run and see it pass**

Run: `npx vitest run landing/tests/contest-config.test.ts`
Expected: PASS: 2.
Landing's own typecheck and build need `landing/node_modules`, which this worktree does not have and this plan does not install: record them as UNVERIFIED. Read the page's diff once for an unbalanced JSX tag instead.

- [ ] **Step 5: Commit**

```powershell
git add landing/lib/contest-config.ts landing/lib/use-entries.ts landing/lib/contest.ts landing/app/challenge-register/page.tsx landing/tests/contest-config.test.ts vitest.config.ts
Commit "feat: the contest form reads whether entries are open, and says each refusal in plain words"
```

---

### Task 11: The console's client

**Files:**
- Modify: `packages/admin-client/src/api.ts`, `packages/admin-client/tests/api.test.ts`

- [ ] **Step 1: Write the failing tests** (in `api.test.ts`, over the real migrations as the file already does; add `finance` via `makeFinance` from `../../../supabase/tests/billing-fixtures.ts`):
1. `stopStatus() answers every staff role, finance included`: `as(aal2(finance)).stopStatus()` → `{ halted: false, haltedReason: null, haltedAt: null }`; a child → `AdminError` code `not-allowed`.
2. `today() carries whether contest entries are open`: `(await as(aal2(ops)).today()).contest` → `{ entriesToday: 0, dailyCap: 2000, entriesOpen: true }`.
3. `flagList() reads the minimum builds as versions and the contest limit as a count`: `kind` of `app.min_version.lms` is `'version'`, of `contest.daily_limit` `'count'` with `safeDefault` `2000`.

- [ ] **Step 2: Run and see them fail**: `npx vitest run packages/admin-client/tests/api.test.ts`. Expected: FAIL (`stopStatus is not a function`; types fail at typecheck).

- [ ] **Step 3: Implement** in `api.ts`: `export interface StopStatus { halted: boolean; haltedReason: string | null; haltedAt: string | null }`; `AdminClient.stopStatus(): Promise<StopStatus>` = `guard(async () => (await t.value('stop_status')) as StopStatus)`; `Today.contest` gains `entriesOpen: boolean`; `FlagRow.kind` is `'bool' | 'text' | 'tone' | 'version' | 'count'`.

- [ ] **Step 4: Run and see them pass**: `npx vitest run packages/admin-client` then `npm run typecheck`. Expected: PASS; exit 0 (any console file that switches on `FlagRow['kind']` still compiles: the Switches editor's last branch is the text input).

- [ ] **Step 5: Commit**

```powershell
git add packages/admin-client/src/api.ts packages/admin-client/tests/api.test.ts
Commit "feat: the console's client reads the stop's state for every role, the contest's open switch and the new switch kinds"
```

---

### Task 12: The console's lines become true; safe editors; the Apps page

**Files:**
- Create: `apps/admin/src/lib/app-readers.ts`, `apps/admin/src/lib/flag-values.ts`, `apps/admin/src/features/apps/index.tsx`; tests `apps/admin/tests/app-readers.test.ts`, `apps/admin/tests/flag-values.test.ts`
- Modify: `apps/admin/src/lib/confirm.ts`, `apps/admin/src/lib/blast.ts`, `apps/admin/src/lib/tiles.ts`, `apps/admin/src/features/switches/index.tsx`, `apps/admin/src/router.tsx` (route `/apps`), `apps/admin/tests/confirm.test.ts`, `blast.test.ts`, `tiles.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/admin/tests/confirm.test.ts`, replace the `'what a switch change will touch'` describe (`:30-50`) with exact lines (no "plan 4" anywhere):
1. `tutor.enabled`: `false` → `'The database refuses new tutor classes for every child, at a school or not, except at a school whose own switch is on; the tutor app shows them a pause notice with the helplines. A report already waiting on a phone is still delivered.'`; `true` → `'Children can take tutor classes again, except at a school whose own switch is off or whose licence is suspended.'`
2. `tutor.only_prepared`: `true` → `'The tutor app lets children open only classes that are already prepared, and prepares no new one. Only the app obeys this: the relay does not check it.'`; `false` → `'The tutor app lets children open any topic again, which prepares a new class when none exists (and costs money).'`
3. `tutor.compose_live_classes` (either) → `'Saved, but nothing changes for children: no screen in this build reads it until the board composer is merged.'`
4. `contest.entries_open`: `false` → `'The contest form says entries are closed, and the database refuses new entries. An entry already made can still be corrected.'`; `true` → `'The contest form takes new entries again, up to the daily limit.'`; `contest.daily_limit` `500` → `'The database takes at most 500 new contest entries in one India day; after that, the form says entries are full until midnight.'`
5. `banner.message`: `''` → `'The notice is removed from the tutor, student and teacher apps.'`; `'Back at 7 pm'` → `'The tutor, student and teacher apps show this notice at the top: "Back at 7 pm".'`; `banner.tone` `'warning'` → `'The notice, when there is one, is shown as a warning.'`, `'info'` → `'… shown as information.'`
6. `app.min_version.*`: `('app.min_version.student', '0.2.0')` → `'A student app older than 0.2.0 asks to be updated and opens nothing else. Builds older than 0.1.0 do not read this and are not stopped.'`; `('app.min_version.classroom', '0.3.0')` → `'A tutor app older than 0.3.0 … Builds older than 0.1.0 …'`; `('app.min_version.lms', '3.0.0')` → `'A teacher app older than 3.0.0 … Builds older than 2.3.0 …'`; `('app.min_version.lms', '0.0.0')` → `'No teacher app build is asked to update.'`
7. `a key no app reads says so`: `('x.unknown', 1)` → `'Saved. No app reads x.unknown.'`
8. `no line says no app reads the switches`: for every key above, the line does not match `/plan 4|No app reads this switch yet/`.

`apps/admin/tests/blast.test.ts` (replace `:17-34`):
9. `offboarding says the database now refuses the tutor and new people, and nothing is deleted`: `blastOffboard('KV22', true)` → `'KV22 is marked offboarded and its tutor switch is set off: the database refuses its children new tutor classes, and neither Qrie staff nor its school admin can add people to it. Nothing is deleted: homework, marks and sign-ins stay.'`; `false` → `'KV22 is no longer marked offboarded, so people can be added again unless its licence is suspended. Its tutor switch stays off until the owner turns it on.'`
10. `the school's tutor switch says what the database and the tutor app do`: `blastPause('KV22', false)` → `"KV22's tutor switch is set off: the database refuses new tutor classes for KV22's children and the tutor app shows them a pause notice. Homework, marks and the student and teacher apps carry on."`; `true` → `"KV22's tutor switch is set on: KV22's children can take tutor classes again, unless its licence is suspended."`; `blastSchoolSwitch('KV22')` → `"Saved for KV22: this value replaces the platform's for KV22 in every app and check that reads the switch."`

`apps/admin/tests/tiles.test.ts`: `base.contest` gains `entriesOpen: true`; new test `the contest tile says when entries are closed`: with `entriesOpen: false` the tile's `detail` is `'entries are closed (contest.entries_open)'` and `tone` `'ok'`; open, `detail` is `'new entries stop for the day at the limit'` (the amber and red thresholds unchanged).

`apps/admin/tests/flag-values.test.ts`:
11. `flagValueProblem` → `null` for (`version`, `'0.1.0'`), (`count`, `500`), (`text`, `'hi'`), (`tone`, `'info'`), (`bool`, `true`); `'Write three numbers, such as 0.1.0.'` for (`version`, `'0.1'`) and (`version`, `'1.0.0-beta'`); `'A whole number from 1 to 100000.'` for (`count`, `0`), (`count`, `2.5`), (`count`, `100001`); `'At most 280 characters.'` for a 281-character text.

`apps/admin/tests/app-readers.test.ts`:
12. `every registered switch is listed with who reads it`: the union of `APP_READERS[*].reads` equals the 11 keys `banner.message, banner.tone, tutor.enabled, tutor.only_prepared, tutor.compose_live_classes, contest.entries_open, contest.daily_limit, app.min_version.classroom, app.min_version.student, app.min_version.lms, billing.state`.
13. `each app's first reading build is not newer than its package.json`: for `classroom`, `student`, `lms`, `isBelowMinimum(pkg.version, FIRST_BUILD[app])` is false (read the three `package.json` with `fs`; `isBelowMinimum` imported from `../../../packages/lms-client/src/app-config.ts`).

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run apps/admin/tests/confirm.test.ts apps/admin/tests/blast.test.ts apps/admin/tests/tiles.test.ts apps/admin/tests/flag-values.test.ts apps/admin/tests/app-readers.test.ts`
Expected: FAIL: the old "No app reads this switch yet (plan 4)" lines; missing modules.

- [ ] **Step 3: Implement**

- `lib/app-readers.ts`: `export const FIRST_BUILD = { classroom: '0.1.0', student: '0.1.0', lms: '2.3.0' } as const;` and `APP_READERS: { name: string; reads: string[]; when: string; ifUnread: string }[]`:
  - `Tutor app (apps/classroom), from build 0.1.0`: reads banner.message, banner.tone, tutor.enabled, tutor.only_prepared, tutor.compose_live_classes, app.min_version.classroom; when `at start, every 5 minutes, on return to the app and when the network comes back`; if unread `the last values it read; before any: no banner, tutor on (the database still refuses classes when it is off), only prepared classes, no minimum. tutor.compose_live_classes is read but no screen obeys it yet.`
  - `Student app (apps/student), from build 0.1.0`: banner.message, banner.tone, app.min_version.student, billing.state; when `at start, every 5 minutes and on return to the app`; if unread `the last answer; before any: no banner, no notice, no minimum.`
  - `Teacher app (apps/lms), from build 2.3.0`: banner.message, banner.tone, app.min_version.lms (and, for the school admin, its licence and invoices from lms.school_billing); same when; same if unread.
  - `Contest form (landing)`: contest.entries_open; when `when the form opens, and on Try again`; if unread `no form, and "We could not check" with Try again.`
  - `The database itself`: tutor.enabled (and a suspended school) in the tutor's admission, claim_relay; contest.entries_open and contest.daily_limit in record_contest_signup; offboarded, suspended or ended schools in both imports; when `on every request`; if unread `refuses (the request fails).`
- `lib/confirm.ts`: delete `SWITCH_NOT_READ`; `describeFlagChange(key, value)` returns test 1 to 7's lines (app names and first builds from `FIRST_BUILD`); its docblock: "What changing a switch does, said before it is confirmed: which apps obey and whether the database enforces it (lib/app-readers.ts lists who reads what)."
- `lib/blast.ts`: the three lines of tests 9 and 10; its `blastOffboard` docblock rewritten to what 0053 and 0063 do; remove the `SWITCH_NOT_READ` import.
- `lib/tiles.ts`: the contest tile's `detail` and `tone` as the tiles test says.
- `lib/flag-values.ts`: `flagValueProblem(kind: FlagRow['kind'], value: unknown): string | null`, the same rules as `admin.flag_valid` (0062).
- `features/switches/index.tsx`: the docblock (`:41-49`) says the apps read these through `public.app_config` (see Apps) and the database enforces `tutor.enabled`, the contest switches and imports; `Editor` gains `version` (text input, `Save` disabled while `flagValueProblem` says no, the problem shown under the input) and `count` (`type='number'`, sends `Number(text)`, same check); the text branch also checks.
- `features/apps/index.tsx`: `AppsPage`: `AdminPage title='Apps'`, one sentence `What each app reads from these switches, and what it does when it cannot read them. An app obeys them only once a build that reads them is deployed (see the runbook, section 7).`, and a table (the kit's `Table`) of `APP_READERS`: App, Reads (keys in `font-mono`), When, If it cannot read.
- `router.tsx`: `const appsPage = createRoute({ getParentRoute: () => root, path: '/apps', component: AppsPage });` added to the tree after `switches`.

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run apps/admin`
Expected: PASS. Run `git grep -n "plan 4" -- apps/admin/src`. Expected: no output.

- [ ] **Step 5: Commit**

```powershell
git add apps/admin/src/lib/app-readers.ts apps/admin/src/lib/flag-values.ts apps/admin/src/features/apps/index.tsx apps/admin/src/lib/confirm.ts apps/admin/src/lib/blast.ts apps/admin/src/lib/tiles.ts apps/admin/src/features/switches/index.tsx apps/admin/src/router.tsx apps/admin/tests
Commit "feat: every switch line says what the apps and the database really do, the editors refuse a bad version or count, and an Apps page"
```

---

### Task 13: The sidebar follows the role; finance can stop the tutor and lands on Billing

**Files:**
- Create: `apps/admin/src/lib/nav.ts`, `apps/admin/src/components/header-stop.tsx`; test `apps/admin/tests/nav.test.ts`
- Modify: `apps/admin/src/components/layout/types.ts`, `components/layout/data/sidebar-data.ts`, `components/layout/app-sidebar.tsx`, `components/command-menu.tsx`, `components/admin-page.tsx`, `components/stop-control.tsx`, `features/today/index.tsx`

**Role lists** (each mirrors its page's database read, "Where it builds on"; the owner sees every item):

| Item | `roles` |
|---|---|
| Today, Schools, Switches, Apps, System | `['owner', 'ops', 'safety']` |
| Users | `['owner', 'ops']` |
| Staff and audit | `['owner']` |
| Your account | absent (every role) |
| Every Billing item | `['owner', 'ops', 'finance']` |

- [ ] **Step 1: Write the failing test**

`apps/admin/tests/nav.test.ts` (imports `../src/lib/nav.ts` and `../src/components/layout/data/sidebar-data.ts`; `titles(role)` = `navFor(role, sidebarData).flatMap(g => g.items.map(i => i.title))`):
1. `the owner sees every item`: `titles('owner')` equals every item title of `sidebarData` in order.
2. `ops sees everything but Staff and audit`.
3. `safety sees Today, Schools, Switches, Apps, System and Your account`: exactly `['Today', 'Schools', 'Switches', 'Apps', 'System', 'Your account']`.
4. `finance sees Your account and the Billing pages, and nothing about children or switches`: exactly `['Your account', 'Billing', 'Invoices', 'Subscriptions', 'Payments', 'Schools', 'Webhook log', 'Plans', 'Settings']`; a group left with no items is dropped (`navFor('finance', sidebarData).map(g => g.title)` equals `['Platform', 'Billing']`).
5. `an item without roles is for every role`: `navFor('safety', { navGroups: [{ title: 'G', items: [{ title: 'Open', url: '/x' }] }] })` keeps it.
6. `finance lands on Billing; everyone else on Today`: `homeFor('finance')` → `'/billing'`; owner, ops, safety → `'/'`.
7. `only finance needs the stop in the header` (Today and System carry it for the others): `showsHeaderStop` true for finance only.

- [ ] **Step 2: Run and see it fail**: `npx vitest run apps/admin/tests/nav.test.ts`. Expected: FAIL (`Cannot find module '../src/lib/nav.ts'`).

- [ ] **Step 3: Implement**

- `types.ts`: the declaration under Interfaces (T7).
- `sidebar-data.ts`: `roles` per the table; the Apps item (`MonitorSmartphone` from `lucide-react`, url `/apps`) after Switches in the Control group; docblock: "Each item names the staff roles whose database reads let them use the page (the database refuses the rest anyway); lib/nav.ts filters by the signed-in role."
- `lib/nav.ts`:
  ```ts
  export function navFor(role: Me['role'], data: SidebarData): NavGroup[] {
    const sees = (roles?: Me['role'][]) => role === 'owner' || !roles || roles.includes(role)
    return data.navGroups
      .map((g) => ({ ...g, items: g.items.filter((i) => sees(i.roles)).map((i) => (i.items ? { ...i, items: i.items.filter((s) => sees(s.roles)) } : i)) as NavItem[] }))
      .filter((g) => g.items.length > 0)
  }
  export const homeFor = (role: Me['role']): '/' | '/billing' => (role === 'finance' ? '/billing' : '/')
  /** Today and System carry the stop for the roles that can open them; finance (0061) can open neither. */
  export const showsHeaderStop = (role: Me['role']): boolean => role === 'finance'
  ```
- `app-sidebar.tsx` and `command-menu.tsx`: iterate `navFor(useMe().role, sidebarData)` instead of `sidebarData.navGroups`.
- `stop-control.tsx`: the prop type becomes `status: { halted: boolean; studentsNow?: number }` (a `RelayStatus` still fits; the dialog's "learning right now" clause appears only when it is a number above 0); nothing else.
- `header-stop.tsx`: `HeaderStop()` loads `admin.stopStatus()` on mount and every 30 s (a failed load keeps the last value; before any, it shows nothing), and renders `<StopControl status={s} onChanged={reload} />`; docblock: "Finance's stop (0061): admin.stop_status is the one status read finance may make."
- `admin-page.tsx`: in the header's right-hand group, `{showsHeaderStop(me.role) && <HeaderStop />}` before Search.
- `features/today/index.tsx`: rename the page component to `TodayPage`; `export function Today() { const me = useMe(); return homeFor(me.role) === '/' ? <TodayPage /> : <Navigate to={homeFor(me.role)} replace /> }` (`Navigate` from `@tanstack/react-router`), so finance never calls `admin.today`.

- [ ] **Step 4: Run and see it pass; typecheck; build the console**

Run: `npx vitest run apps/admin`
Expected: PASS: 7 new.
Run: `npm run typecheck`
Expected: exit 0.
Run:
```powershell
$env:VITE_SUPABASE_URL='http://127.0.0.1:54321'; $env:VITE_SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlc2lnbmF0dXJl'; $env:VITE_ADMIN_ENV='TEST'; npm run admin:build; Remove-Item -Recurse -Force apps/admin/dist
```
Expected: the build succeeds and the bundle scan prints no secret.

- [ ] **Step 5: Commit**

```powershell
git add apps/admin/src apps/admin/tests/nav.test.ts
Commit "feat: the console's sidebar follows the signed-in role, finance gets a stop button it can use and lands on Billing"
```

---

### Task 14: Runbook section 7, corrections, and the whole gate

**Files:**
- Modify: `docs/ops/admin-console.md` (append section 7; correct `:76-78` and `:146-151`), `apps/admin/README.md` (one line: the Apps page and `lib/app-readers.ts`)

- [ ] **Step 1: Correct the two places that say no app reads the switches**

Section 2's Switches bullet becomes: "**Switches** are what the apps obey (section 7 says which app reads which, and what the database enforces itself). A guarded one asks for a fresh code. A switch nobody has set uses its safe default." Section 5 step 8 becomes: "**What the switches do.** See section 7: once 0062 to 0064 are applied, the database refuses tutor classes at a school whose tutor switch is off or that is suspended, and refuses new people for an offboarded or suspended school; the apps show the rest only from the builds named there. Only you (the owner) can turn a tutor switch back on; a teacher's or a school admin's new PIN, and a teachers sheet, are yours too."

- [ ] **Step 2: Append section 7**

```markdown
## 7. The apps obey the console (plan 4)

What reads what is on the console's **Apps** page. In short: the tutor, student
and teacher apps show the banner and ask an old build to update; the tutor
shows a pause when its switch is off and follows "only prepared"; the student
app shows a suspended school's notice; the school admin sees grace, suspension
and invoices due; the contest form says when entries are closed. Three things
are refused by the database itself, whatever an app shows: a tutor class at a
school whose tutor switch is off or that is suspended (children see the relay's
"Qrie is having a rest" sentence until their app refreshes, and can still send
a report), a new contest entry when entries are closed or the day's limit
(India's day) is reached, and new people at an offboarded, suspended or ended
school (the school admin, staff and the founder's import tool are told why).

### What you do (Aarav's steps)

1. **Do not deploy the tutor or the relay from this branch.** `apps/classroom`,
   `packages/relay` and `supabase/functions/relay` here are older than the live
   tutor (`phase3-completion`, `voice-stt-tts`; the live relay has `743c05a`,
   `1dcfcfe`, `18733af`). The tutor's part of plan 4 goes live only after this
   branch is merged with those branches. The contest site is built together
   with the tutor (`npm run build:site`), so it waits for the same merge.
2. **Apply the migrations** with the rest of the console's, after plan 5's are
   merged: `npx supabase db push` applies 0062 to 0064 (and plan 5's 0065 to
   0069). The tutor's admission check works with the relay that is live today.
3. **Until the new contest site is live**, leave `contest.entries_open` on: the
   old form shows "We could not save that. Please try again in a moment." to a
   parent when entries are closed.
4. **Build and deploy the student and teacher apps as you do today.** They read
   the switches from the server they already use (the demo school today, the
   hosted project once it serves them).
5. **Set a minimum build only to a build that exists.** The first builds that
   read it are tutor 0.1.0, student 0.1.0, teacher 2.3.0; older builds ignore it.
6. **Try it on TEST:** set a banner and see it in each app within five minutes;
   switch the tutor off for a test school and start a class as one of its test
   children (refused, then the pause notice); close entries and open the
   contest form; set the daily limit to 1 and enter twice; suspend a test
   school's licence (end it more than 14 days ago) and try Add people as its
   school admin.

### If something goes wrong

- **An app shows a pause or an old-build screen it should not**: check the
  switch's value on Switches (a school's own value on its page). Set
  `app.min_version.*` back to `0.0.0` to release everyone.
- **A school's children cannot start a class**: its tutor switch is off, the
  platform's is off, or its licence is suspended (Billing, that school).
- **The console cannot be reached**: the apps keep their last values; nothing
  turns on by itself.
```

- [ ] **Step 3: The whole gate**

Run: `npm run typecheck`. Expected: exit 0.
Run the four builds of Tasks 7, 8, 9, 13 again, deleting each `dist`. Expected: each succeeds; the console's scan finds no secret.
Run (12 to 20 minutes):
```powershell
$env:VITE_SUPABASE_URL='http://127.0.0.1:54321'; $env:VITE_SUPABASE_ANON_KEY='test-anon'
npx vitest run --exclude "tools/measure/**" --exclude "**/node_modules/**" *> "$env:TEMP\qrie-wiring-suite.txt"
Get-Content "$env:TEMP\qrie-wiring-suite.txt" -Tail 40
```
Expected: every file passes. If `tools/lms-demo/tests/brain.test.ts` or `apps/classroom/tests/reportReplay.test.ts` fails, rerun that file alone and record both runs (known flakes, not this plan's).
Run: `git grep -n "plan 4" -- apps packages supabase/tests tools docs/ops`. Expected: only section 7's heading and plan-history mentions in `docs/ops/admin-console.md`; none in code.

- [ ] **Step 4: Commit**

```powershell
git add docs/ops/admin-console.md apps/admin/README.md
Commit "docs: runbook section 7, the apps obey the console; the switches' old lines corrected"
```

---

## Merge notes

1. **Order (wave 2):** this branch merges into `admin` first, then plan 5's `admin-safety`. Migrations run 0062 to 0064, then 0065 to 0069 (and the merge's own 0070, plan 5's merge note 4); plan 5's 0066 replaces this plan's 0063 stub `admin.privacy_import_refusal` with `create or replace` (same signature; the ACL, including this plan's revoke from `service_role`, is kept by `create or replace`), and `admin.import_refusal` then refuses an undecided school with no change here. Plan 5's gate answers NULL except on HOSTED and STAGING databases (its ruling R13), and every test here runs on `setEnvironment`'s `TEST`, so `app-imports.test.ts` (including test 4, which swaps the function and recreates the stub inside its own database) and Task 4's tests pass unchanged after the merge.
2. **Shared files (T8):** `admin-invariants.test.ts` takes the union of both lists in C collation order (this plan adds `admin.stop_status` and `my_app_config`); `router.tsx`, `sidebar-data.ts` keep both sides' routes and items (Apps under Control; plan 5's Safety, Classes, Privacy groups with their `roles`); `docs/ops/admin-console.md` keeps section 7 then plan 5's section 8.
3. **The nav type (T7):** keep one `roles?: Me['role'][]` declaration in `types.ts` (this plan's comment); plan 5's items need no other change, since `navFor` already filters. `apps/admin/tests/nav.test.ts` does change at the merge: plan 5's group `Safety and privacy` (Safety owner, safety; Classes owner, ops, safety; Privacy owner, ops) makes test 2 (ops) also see Classes and Privacy, and test 3 (safety) exactly `['Today', 'Schools', 'Switches', 'Apps', 'System', 'Your account', 'Safety', 'Classes']`; finance (test 4) is unchanged.
4. **With the live tutor branches (`phase3-completion`, `voice-stt-tts`):** `apps/classroom/src/lib/prototype.ts` conflicts on the gate's line: take this branch's `export let PROTOTYPE_ONLY_PREPARED = true;`, `setOnlyPrepared` and docblock, and drop the live branch's "OFF SINCE 2026-09-29" block (the console's `tutor.only_prepared`, safe default `false`, now says the same, and is what `app_config` returns when nothing is set). `App.tsx` and `main.tsx` take this branch's hook-in lines beside theirs. `package.json` takes `0.1.0`. No relay file changes in this plan. Deploy the relay only from the merged branch, with `743c05a`, `1dcfcfe`, `18733af`.
5. **With `board-composer`:** its `composed: ask.composed ?? COMPOSE_LIVE_CLASSES` (`apps/classroom/src/lib/liveClass.ts:449` there) becomes `?? getAppConfig().composeLiveClasses`, the constant is deleted, and `describeFlagChange('tutor.compose_live_classes', …)` and `APP_READERS` change to say what the composer does (same merge).
6. **A distinct refusal reason later:** when the relay can be changed with the live tutor merged, a `school-off` reason (its own sentence, report exemption) needs `packages/relay/src/gate.ts` `REFUSALS` and the exemption list, `apps/classroom/src/lib/refusal.ts`, and a new migration replacing `claim_relay`'s `'halted'` for this case. Not before: the deployed relay reads any unknown reason as a rate limit.
7. After merging, run the whole gate (Task 14 Step 3) on the merged branch.

## Aarav's steps (only he can do these)

1. Apply the migrations (runbook section 7 step 2), after plan 5 is merged.
2. Keep the tutor, the relay and the contest site on the live tutor branches until this branch is merged with them (section 7 step 1); then deploy them from the merged branch as today.
3. Deploy the student and teacher apps as today.
4. Leave `contest.entries_open` on until the new contest site is live.
5. Try each switch on TEST (section 7 step 6).
6. **Decide later (no build needed now):** whether a parent should also see "grace" (R14); whether the banner should show on the contest site (R21); whether "only prepared" should also be enforced by the relay (R4 notes it is the app's only).

## UNVERIFIED

- Nothing here has run against a hosted project, a deployed app, a phone or a browser. In particular: that the hosted PostgREST passes SQLSTATE `55000` and `53400` to supabase-js as `error.code` (it does for 53400 today per `landing/lib/contest.ts:109`, not run); that `supabase.schema('public').rpc('app_config')` and `rpc('my_app_config')` reach the hosted functions with the anon key and with a child's session.
- That Android's WebView fires `visibilitychange` when the Capacitor tutor and the student APK come back to the screen (the refresh on return depends on it; the five-minute timer does not).
- The banners' and notices' look in each app (no screenshot taken); the tutor's full-screen cards on a small phone.
- Landing's typecheck and build (`landing/node_modules` is absent; this plan does not install it). Only `landing/tests/contest-config.test.ts` runs.
- The production bundle's handling of `export let PROTOTYPE_ONLY_PREPARED` as a live binding (vitest's transform and the TypeScript check are what run; the bundle is built but its behaviour is not exercised).
- `pg_advisory_xact_lock` under truly concurrent signups on hosted Postgres (PGlite runs one transaction at a time; the lock is 0020's).
- `npm ci` with the three hand-edited workspace versions in `package-lock.json` (only `npm run typecheck`, the builds and the suite run).

## Rulings (decisions the spec did not settle, each with its cost if wrong)

- **R1** `claim_relay` refuses a switched-off or suspended school as `halted` with `retry_after` 300, not a new reason: the deployed relay maps unknown reasons to a rate limit and refuses reports for them (`gate.ts:234-235, 338-342`), and T5 keeps relay TypeScript out of this plan. Cost: a child whose class is refused this way sees "Qrie is having a rest. Classes are paused for a few minutes." until the tutor app's next config read (at most five minutes, or on return) replaces it with the pause notice; a distinct reason is merge note 6.
- **R2** The admission obeys the **effective** `tutor.enabled` for every learner: a school child's school value, else the platform's; a learner with no school, the platform's. So the global switch off refuses direct users too (a third stop beside `relay_control.halted` and `RELAY_DISABLED`); turning it on is the owner's (plan 2's R23). Cost: if the global switch was meant for school children only, direct users are paused by it too.
- **R3** The tutor app reads `public.my_app_config()` (its learner's school resolved from the session), because it does not know the school. Cost: one more anon-callable public function; it returns only the caller's own school's config or the global one.
- **R4** Failed-read defaults are per app and per key (Tasks 7 to 10). The tutor's `only_prepared` is `true` until a read succeeds, though the database's safe default is `false`. Cost: on start, and whenever the console has never been reached, cold topics are frozen; a local tutor with no Supabase configured runs with the gate on. "Only prepared" is enforced by the app only; the relay does not check it.
- **R5** The last good value is kept in memory for the session, not in storage. Cost: an app started offline uses the safe defaults until it reaches the console.
- **R6** `PROTOTYPE_ONLY_PREPARED` stays the one name eight screens read, now `export let` set by the config module; `App` subscribes so every screen re-renders on a change. Cost: a screen that read it and does not re-render keeps the old value until it does; no screen file changes, so the live-branch merge touches one line.
- **R7** `tutor.compose_live_classes` is parsed but obeyed by no screen until `board-composer` is merged; the console says so. Cost: the switch does nothing yet.
- **R8** New kinds `version` (three numbers of up to four digits) and `count` (1 to 100000); the three minimum builds become `version`; `contest.daily_limit` is a guarded `count`, safe default 2000 (0020's number), global only. Cost: `1.0` or `1.0.0-beta` cannot be set; the limit is readable through `app_config` (it was in the public repository's 0020 anyway).
- **R9** The contest's day is India's day (it was UTC in 0020 and 0049), per the repository's convention. Cost: the limit resets at 00:00 India time instead of 05:30; on the day 0062 is applied, the entries made between 00:00 and 05:30 India time count towards the new day.
- **R10** Closed entries refuse new entries only (errcode `55000`); an entrant can still correct their own entry, as 0020 already allows when the day is full. Cost: an entry can change after the contest closes.
- **R11** The contest form shows no form when it cannot read the switch ("We could not check", Try again). Cost: a visitor on a bad network sees no form until a retry succeeds, although the database might have taken the entry.
- **R12** Both import paths refuse at the check of a sheet as well as at the commit (409 with the sentence); staff's commit is still refused in `api_gate` (400, P0001, as plan 2's offboarded refusal). Cost: staff cannot preview a sheet for such a school.
- **R13** `admin.import_refusal` is internal; the LMS lane reaches it through `lms.import_refusal` (service role), as it reaches every 0046 helper. Cost: one more lms function.
- **R14** The student app shows only "suspended", never "grace": a student or parent cannot act on a lapsing licence. Cost: a parent learns of a lapse only when the tutor is already off.
- **R15** The school admin's licence and invoice notice comes from `lms.school_billing()` (admin only, finer than `app_config`): state, grace's last day, open invoices, amount due, earliest due day; teachers who are not the admin see no billing. Cost: one more lms function reading `billing.invoice`; a teacher is not told why the tutor is off.
- **R16** Each app's build number is a constant beside its config module, equal to `package.json` (a test checks), and this plan bumps the three apps (tutor 0.1.0, student 0.1.0, teacher 2.3.0) so the first builds that read a minimum can be named. Cost: three hand-edited version lines in `package-lock.json`; a later version bump must change the constant too (the test fails until it does).
- **R17** Config is read at start, every five minutes, on return to the screen and (tutor) when the network comes back; the database's checks are immediate. Cost: a banner or pause takes up to five minutes to appear in an app left open.
- **R18** The sidebar's role lists mirror each page's database read, with the owner seeing everything. Cost: if a page's database role list changes, its nav item must be changed by hand (no test ties the two).
- **R19** Finance's stop is a header button shown only to finance, fed by `admin.stop_status()` (halted, reason, since); others keep it on Today and System. Cost: finance's dialog does not say how many children are learning.
- **R20** Finance opening `/` is sent to `/billing`. Cost: none known.
- **R21** The banner shows in the tutor, student and teacher apps, not on the contest site. Cost: a visitor to the contest site does not see a platform notice.
- **R22** The console's switch lines and the Apps page come from one module (`lib/app-readers.ts` and `describeFlagChange`). Cost: a new reader or switch must be added there by hand; a test checks every registered key is listed.
- **R23** A minimum build stored before 0062 that is not a version stays as it is; every app ignores it. Cost: the Switches page shows the odd value until someone sets a proper one.
- **R24** The founder's CLI (`tools/lms-import/src/cli.ts --apply`) is a third import path with the service role; `applyPlan` asks the store's optional `mayImport` (hosted store only) right after naming the school, so it refuses an offboarded, suspended, ended or (with plan 5) privacy-undecided school before anyone is created. Cost: a brand-new school run through the CLI on a HOSTED database keeps its school row (no people) until its privacy decision is recorded and the CLI is run again; the PGlite store has no `mayImport`, so the demo seed and the PGlite tests are unchanged.
- **R25** The tutor app's two full-screen cards (old build, tutor off) carry the helplines from `@ai-tutor/safety`, because they replace every screen, Help included. Cost: none known.

## Self-review

**Spec coverage.** Section 4 ("the apps depend on the panel only through `public.app_config`, with a built-in default if it cannot be read; the panel being down never turns a feature on"): Tasks 6 to 10 (each app's defaults and last-good rule, tested), R3, R4. Section 8 Tutor row (banner and pause notice, `tutor.only_prepared` replacing the compile-time constant, `tutor.compose_live_classes`, minimum build): Task 7, R6, R7; "stop and resume, the ceiling" are plan 1's. Student app row (banner, minimum build, a school's suspension notice): Task 8; "a report button and helpline" are plan 5's. Landing and contest row (entries today and the daily limit; open or close entries; the limit as a row): Tasks 2, 10, 12 (Today's tile), R8 to R11; "purge date" is plan 5's. Section 10 "new imports stop" when suspended (and plan 3's merge note 10): Tasks 3, 4 (all four import paths, R24). Not delivered here: the Student app row's "See: sign-ins per school" (a count for the console; left to plan 6's visualiser, which reads the same tables). Section 13 ("licence ends on…", "invoice due", grace and suspension for the school admin): Tasks 5, 9 ("pay the link from inside the teacher app" is later, as the spec says). Section 14 plan-4 row (the four apps read `app_config`; the contest limit as a row; grace or suspension banner in the teacher and student apps): Tasks 2, 6 to 10, R14. The task's console follow-ups: true lines (Task 12), M13 (Tasks 2, 6, 7, 12), the role sidebar (Task 13, T7), finance's stop and landing (Tasks 5, 11, 13, R19, R20), the Apps page (Task 12). Runbook section 7 and the merge warning (Task 14, merge notes 4 to 6).

**Seams.** T1 to T11 each map to a task in the Seams table; T4 holds (no `app_config` change), T5 holds (no relay TypeScript), T11 holds (the four recreated functions are copied from their latest definitions, cited).

**Placeholders.** The non-obvious SQL (kinds, `flag_valid`, `contest_rules`, `import_refusal`, `tutor_enabled_for`, the `claim_relay` insertion, `my_app_config`, `school_billing`, `stop_status`) is given as code; the four recreated functions are given as "copy from file:lines, change exactly this"; the TypeScript is given as signatures, the non-obvious bodies as code, and every user-facing sentence exactly. Each test file's test names and assertions are listed; the counts in Expected lines are the numbered tests here.

**Type consistency.** The jsonb keys of `school_billing` (`state, graceUntil, openInvoices, duePaise, earliestDueOn`) are `SchoolBilling`'s; `stop_status`'s are `StopStatus`'s; `today().contest` gains `entriesOpen` in SQL, `Today` and the tiles test together; the version rule is one regular expression in SQL (`flag_valid`), `packages/lms-client`, the tutor's copy and the console's `flagValueProblem`; the import sentences are the same strings in SQL and every TypeScript test.

**Not verified:** the list under UNVERIFIED.
