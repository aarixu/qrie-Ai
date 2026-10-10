# Qrie control, Plan 5: Safety, classes and privacy. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before a pilot school's children use Qrie, the platform knows when a child may be in distress even if the app is closed (a flag with a category, a time and a school, never the words); a child's reports are triaged by age and status without any note in a list, and a report's words are opened only one at a time, inside a case, with a typed reason, a fresh authenticator code, a daily quota and an insert-only read log; a class can be published (owner), retracted or rejected (owner or ops) with its files really removed from Storage; the owner erases one child across every table that holds them, through one guarded path; each school carries a data-protection decision that blocks its import while undecided; the console shows what is kept, for how long and which job enforces it; the student app gets a report button and the helplines.

**Architecture:** New tables in the `admin` schema (`safety_event`, `case`, `read_log`, `school_privacy`, `class_review`, `erasure_request`), reached only through SECURITY DEFINER functions that begin with `admin.require_staff`. Distress flags reach the database through a new relay route (`/api/flag`, admitted like a report: above the kill switch, zero units) and a service-role-only function that resolves the child's school and never stores who they are. Storage deletions (a class's files, a child's homework photos) need the Storage API and the service role, so they go through two new routes of the existing `admin-api` Edge Function, which asks the database as the caller first (the plan 2 pattern) and reports back through service-role-only functions. The console gets three pages (Safety, Classes, Privacy) on plan 2's write dialog and load hook. The student app files a report through a new `lms.report_problem` function.

**Tech Stack:** Postgres (migrations 0065 to 0069) tested on PGlite through `supabase/tests/harness.ts`; TypeScript (relay route, `admin-api` routes, admin client, the classroom's capture module, the student app's report sheet); React 19, Vite, TanStack Router, Tailwind 4 and the console's copied UI kit; vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-super-admin-panel-design.md` (sections 2 counsel rows, 3, 6, 7 plan-5 row, 8 rows Classes, Safety and privacy, Student app, Landing and contest, 11 Safety row, 14). It lives in the main checkout (`C:/Users/Ashish Sharma/curie`); read it there, never edit it. Format exemplars: plan 1 (main checkout, `docs/superpowers/plans/2026-10-06-super-admin-foundation.md`), plans 2 and 3 (this branch, `docs/superpowers/plans/2026-10-07-super-admin-{schools,billing}.md`).

**Status of this document:** written 2026-10-08 on branch `admin-safety` (cut from `admin@ade281c`). Nothing in it is built. Every fact about the repository below was read or run on 2026-10-08 and cites its file and line; everything else is marked UNVERIFIED.

**THE TUTOR CODE ON THIS BRANCH IS OLDER THAN THE LIVE TUTOR.** `apps/classroom`, `packages/relay` and `supabase/functions/relay` here predate the live relay (branches `phase3-completion` and `voice-stt-tts`; the live relay includes commits `743c05a`, `1dcfcfe` and `18733af`, which this branch does not have). This plan's changes there are one new module per folder plus a few marked hook-in lines, so they port cleanly. **Nothing in `apps/classroom` or the relay may be deployed from this branch until it is merged with those branches** (Task 15 writes this into the runbook).

---

## What exists, read 2026-10-08

**Distress is detected only on the device.**
- `packages/safety/src/screen.ts` decides; its `support` verdict is distress (`screen.ts:56-60`, patterns `:117-203`). It is pure and local.
- `apps/classroom/src/lib/safety.ts:42` and `:70` call `recordFlag({ kind: 'distress', ... })` for a child's words (`fromStudent`) and for the tutor's own line (`toStudent`); `apps/classroom/src/screens/LiveClass.tsx:311-314` records the same kind for a refused live-class question.
- `recordFlag` writes a local, never-synced log of at most 50 flags holding kind, time and lesson, never the words (`apps/classroom/src/stores/flags.ts:20-31, 152-163`). Nothing leaves the phone. `admin.today()` says so: `'capture', {'distress': 'not-captured', 'lastPurge': 'not-captured'}` (`supabase/migrations/0049_admin_today.sql:77`), and `supabase/tests/admin-today.test.ts:61` pins it.
- The relay never sees a distress verdict: `fromStudent` returns `text: null` for `support`, so the words never reach `/api/llm` (`safety.ts:40-43`). The relay screens only prepared-class files (`packages/relay/src/relays.ts:514`).
- Routes beside the relays are matched by `routeFor` (`packages/relay/src/handler.ts:262-275`); `handleRelay` dispatches `report` above the kill switch (`handler.ts:331-332`). `admitFree(req, route, gate)` admits a `FreeRoute` (`'report' | 'prep' | 'enroll'`, `packages/relay/src/gate.ts:37`) at zero units and exempts only `report` from `halted`, `capped` and `budget` (`gate.ts:330-345`). A host wires stores into `HandlerDeps` (`handler.ts:48-208`): the Edge Function in `supabase/functions/relay/index.ts`, the dev server in `apps/classroom/vite.config.ts:113-124`.
- The test pattern for a route: `packages/relay/tests/report.test.ts:1-70` (a `Verifier`, a `Gate` with a fake ledger, `post()`, `deps()`).

**Reports (0019).** `public.student_report` (`supabase/migrations/0019_report_and_consent.sql:37-74`): `user_id` (cascade), `org_id` (filled by `fill_org_id` from the earliest membership, `0019:94-97`, `0018:98-115`), `kind` (`wrong|rude|unsafe|other`), `note` (the child's words, at most 2000), `lesson_id`, `topic_ref`, `beat_id`, `spoken_line`, `session_id`, `release`, `platform`, `at`, `received_at`, `status` (`new|seen|actioned|dismissed`, constraint `student_report_status_check`, measured), `actioned_at`, `action_note`. RLS on, revoked from `anon` and `authenticated`. Written only by `public.keep_student_report(...)` (service role, `0019:115-155`), idempotent on `(user_id, lesson_id, coalesce(beat_id,''), at)`. Readers of `status = 'new'`: `admin.today()` (`0049:35-38`), `public.alert_snapshot` (`0051:75-78`), `admin.school_health_for` (`0052:250-264`). `apps/classroom/tests/migrations.test.ts:1035` pins 0019's file text, not the live constraint.
- The classroom's report sheet: four reasons (`apps/classroom/src/ui/ReportSheet.tsx:57-65`); `noteThatMayTravel` scrubs with `screen` then `redact` and files a `support` note as `unsafe` (`:198-232`); honest copy for sent, kept and refused (`:345-400`); the helpline line (`:397-400`); `HELPLINES = { telemanas: '14416', childline: '1098' }` (`packages/safety/src/screen.ts:73-76`).
- `apps/student` has no report button and no helpline (searched `apps/student/src` for `report`, `HELPLINES`, `helpline`: none). It calls only `lms.*` functions through `@ai-tutor/lms-client` (`apps/student/src/lib/backend.ts:7`; `packages/lms-client/src/transport.ts:36-60`), resolved by a Vite alias and a tsconfig path (`apps/student/vite.config.ts:16-20`, `apps/student/tsconfig.app.json:21-29`). Its header is `apps/student/src/components/shell.tsx:42-72`; `me.kind` is `student` or `parent` (`apps/student/src/stores/auth-store.ts:23`).

**Classes (0004, 0018).** `public.prepared_class` (`0004:19-31`; `0018:308-322` adds `review_status` `pending|published|retracted` default `published`, `published_at`, `review_note`, `version`, `retracted_at`). Select policy "anyone may read prepared classes" `using (true)` (`0004:44-47`, measured). Files in the public bucket `classes` at `<id>/<path>` (`0004:58-60`; `packages/relay/src/classStore.ts:26, 33-34, 78`). The relay keeps a class by uploading files, then inserting the row with `prefer: resolution=ignore-duplicates` (`classStore.ts:98-117`); `topic_ref` is unique (`0004:27`). The classroom catalogue reads every row with no status filter (`apps/classroom/src/lib/content.ts:112`); the relay's prep-state route reads only `review_status=eq.published` (`packages/relay/src/prep.ts:298`). No foreign key points at `prepared_class` (searched). Today nothing writes `pending`.
- Cost: `public.usage_cost` (view, service role only, `0018:233-283`) has `inr`, `unpriced`, `bucket`, `session_id`, `prep_id` (measured). `public.learning_session` has `topic_ref` (`0006:26-44`); `usage_event.session_id` is the sitting.

**People and erasure.** Deleting `auth.users` cascades through 31 foreign keys and sets 12 to null; one restricts (`admin.platform_staff`): 44 in all. Measured list (`pg_constraint`, PGlite, every migration, rule after the colon): `admin.platform_staff.user_id:r admin.user_block.user_id:c concept_state.user_id:c consent_record.user_id:c contest_signup.user_id:c learner.auth_user_id:c learner_model.user_id:c learning_session.user_id:c ledger_event.user_id:c lms.account.user_id:c lms.assignment.created_by:n lms.assignment_student.student_user_id:c lms.attendance.marked_by:n lms.attendance.student_user_id:c lms.audit_event.actor:n lms.enrolment.student_user_id:c lms.event.created_by:n lms.guardian.parent_user_id:c lms.guardian.student_user_id:c lms.item.created_by:n lms.item_approval.approved_by:n lms.item_draft.created_by:c lms.mark.marked_by:n lms.mark_history.changed_by:n lms.notice.created_by:n lms.notice_read.user_id:c lms.report_remark.student_user_id:c lms.report_remark.written_by:n lms.submission.student_user_id:c lms.task_done.student_user_id:c lms.teaching_assignment.teacher_user_id:c lms.test_answer.student_user_id:c lms.test_start.student_user_id:c lms.work_comment.student_user_id:c lms.work_comment.written_by:n lms.work_status.set_by:n lms.work_status.student_user_id:c membership.user_id:c otp_send.user_id:c prep_lock.user_id:c relay_usage.user_id:c student_report.user_id:c student_state.user_id:c usage_event.user_id:c`.
- What survives a user delete: homework photos in the private bucket `lms-work` at `<org>/<assignment>/<student user id>/<file>` (`0025:4-6, 29-34`; Storage objects are not rows the cascade reaches); the child's login ID inside `lms.audit_event.target` and `details` (`0034:35-48`, written by `lms.audit(org, action, login_id ...)`, for example `0034:268, 302`; `lms.audit_event` has no immutability trigger, searched); `admin.audit_event` rows naming a login ID (insert-only, `0047:80-112`).
- The LMS lane has no erase. Its school admin marks a person as left (`lms.mark_left`, `0034:246-276`) and brings them back (`lms.restore_account`, `0041:178-211`); both keep every record. Plan 2's `admin.school_person_disable` does what `mark_left` does (`0053:549-600`). `public.delete_own_account()` deletes `auth.users` from a definer function (`0002:9-23`). Plan 2's `admin.is_direct(user)` (`0054:37-49`) tells a direct user.
- `lms.account (user_id pk, org_id, login_id ^[A-Z0-9-]{3,40}$, kind, display_name, left_at)` (`0022:101-110`, `0034:29`).

**Retention, read from the code.** `public.purge_old_ledger(90)` deletes `ledger_event` rows only for a user whose `learner_model.purge_safe_before` is set, which nothing sets yet (`0021:141-161`), so it deletes no event; it then deletes `learning_session` rows older than 90 days that have no event (`0007`, as replaced by `0021`), scheduled `purge-old-ledger` at `30 19 * * *` (`0009:39-43`). `billing.webhook_event` signature failures go after 90 days in `billing-states` (`0060:148, 154`). Nothing sweeps `otp_send` (`0019:322-328`), `usage_event`, `relay_usage`, `student_report`, `consent_record`, `contest_signup`, `student_state`, `concept_state`, `learner_model` or any `lms.*` table (searched every `delete from` and `cron.schedule` in `supabase/migrations`). Cron jobs today: `admin-revert-caps`, `billing-states`, `lms-finalize-tests`, `purge-old-ledger` (measured). `landing/app/privacy/page.tsx:80` says "Class and usage records are deleted automatically after 90 days"; neither class and answer events (above) nor `usage_event` have a window (a question for Aarav and counsel, not changed here).
- `public.contest_signup` holds a child's name, phone, address, city, school, and a parent's name and phone as typed (`0020:34-64`).

**The admin lane this builds on.** `admin.require_staff(roles)` (owner always passes; refusal `not allowed` 42501), `require_fresh_mfa(10)`, `check_environment`, `environment()`, `audit(staff, action, kind, id, reason, details)`, `audit_service(...)`, `audit_immutable()` (trigger function), `tripwire()` (`0047:115-197`); `admin.setting` key `^[a-z][a-z_]{1,40}$` (`0047:42-46`, no tripwire); `admin.require_reason` (`say why, in a few words`), `admin.school_org(code)`, `admin.like_escape`, `admin.count_of` (`0052:50-115`); `admin.api_gate` (`0054:327-391`); the alarm's `public.alert_snapshot(token)` returns exactly ten keys, pinned by `supabase/tests/admin-alarm.test.ts:17-20, 45`, and is defined only in `0051:48-100`; `tools/admin-alert/src/evaluate.ts` turns it into Telegram messages (`:45-104`). `admin.setting`'s environment is `UNSET` on a fresh database (measured); plan 1's bootstrap sets it.
- `admin-api`: logic in `tools/admin-api/src/handle.ts` (`ROUTES`, `CALLER_FUNCTIONS`, `AdminApiDeps`, `refusal`, `handleAdminApi`, `:33-155`), the Deno entry `supabase/functions/admin-api/index.ts` (`asCaller` with `content-profile: admin`, `supabaseRest` with the service role), the test world `tools/admin-api/tests/deps.ts` (`apiWorld(db)`, named tokens). `supabaseRest(url, key)(path, {method, profile, body})` (`tools/lms-import/src/supabaseStore.ts:25-45`).
- Console: `components/write-dialog.tsx` (`WriteDialog`: blast line, reason, typed environment, `checkWrite`, `useGuarded`), `lib/use-load.ts` (`useLoad(load, deps)`), `components/load-view.tsx` (`LoadView`), `lib/roles.ts`, `components/layout/types.ts` (`BaseNavItem` has no `roles`), `components/layout/data/sidebar-data.ts`, `src/router.tsx` (code routes), `lib/client.ts`. Admin client: `packages/admin-client/src/{read.ts (guard, str, num...), schools.ts (Write {reason, env}, :169-172), admin-api.ts (AdminApiCaller, replyCaller), transport.ts (pgliteAdminTransport; names ^[a-z][a-z_]{0,62}$, args ^p_[a-z_]{1,60}$, :61-70)}`; `Me.role` is `'owner' | 'ops' | 'safety' | 'finance'` (`api.ts:5-9`).
- Test tools: `freshDatabase`, `asClaims`, `asService`, `createUser` (`supabase/tests/harness.ts`; storage shim `storage.buckets`, `storage.objects (bucket_id, name, owner, ...)`, `:72-103`); `makeStaff`, `aal2`, `fresh`, `anonymousChild`, `setEnvironment` (`admin-fixtures.ts`); `buildSchool(db, code)` returns `{org, kid8a, kid8b, admin, teacherA, ...}` with `lms.account` rows and memberships (`fixtures.ts:26-60`); `tutorSession`, `fileReport` (`admin-school-fixtures.ts:74-100`); `rpc`, `serviceRpc`, `makeFinance` (`billing-fixtures.ts:7-39`); `addHostedStandIns` (`admin-standins.ts`); lms-client `pgliteTransport(db, userId)` (`packages/lms-client/src/transport.ts:92`).
- Measured on PGlite 2026-10-08: `create table admin.case` and `from admin.case c` work; an unqualified `case` is a syntax error; a plpgsql variable of type `admin.case` works. lucide-react 1.39.0 (root `node_modules`) exports `ShieldAlert`, `BookOpen`, `Lock`, `LifeBuoy`, `Phone`, `Flag`.

## Global Constraints

- Work only in `C:/Users/Ashish Sharma/curie/.claude/worktrees/admin-safety` on branch `admin-safety`. Never touch the main checkout's working tree or any other worktree. Never push, deploy, run `supabase db push`, call a hosted service, or put a real secret anywhere.
- Migrations **0065 to 0069 only** (T1). Never edit 0001 to 0061. Plan 4 builds 0062 to 0064 at the same time; gaps are fine.
- Every `admin.*` function: `SECURITY DEFINER`, `set search_path` to the schemas it uses, begins with `admin.require_staff(...)` for the roles of spec section 3, refuses with exactly `not allowed` (42501). Guarded actions (publish, retract and reject (their files are deleted for good), erase, a school's privacy decision, the contest purge date, opening a case) also call `admin.require_fresh_mfa(10)`. Every write takes `p_env` (`admin.check_environment`) and `p_reason` (`admin.require_reason`), sets `admin.session`, and writes `admin.audit` with ids, statuses, counts and hashes only: never a note, a name, a phone or an address.
- Explicit `revoke all ... from public, anon, authenticated` (and `service_role` for tables), then explicit grants. `supabase/tests/admin-invariants.test.ts` pins the exact `authenticated` list; keep it updated in each task.
- Always write `admin.case` schema-qualified (an unqualified `case` is a syntax error, measured).
- The browser never reads a table. Console writes go through `WriteDialog` (plan 2's) and send `EXPECTED_ENV`; guarded ones are retried by `useGuarded` inside it. App text is English, sentence case.
- Spec section 6, never shown: no report note, spoken line or session id in any list, tile, alert or audit row; a child's words only from `admin.case_report`, one record, inside an open case held by the reader; no child's name, login ID or other data in the Safety pages; no ranked or "at risk" list of children; no per-child trail (`admin.safety_event` holds no child id at all). The panel never builds a view that tracks a child (DPDP s.9(3), counsel to confirm).
- "A day" is an Asia/Kolkata day (`lms.india_today()`; a day's start is `lms.india_today()::timestamp at time zone 'Asia/Kolkata'`).
- COMMENTS ARE CLAIMS: every comment, doc line, test name and UI sentence states only what the code does. Anything not run is UNVERIFIED.
- TDD: write the failing test, run it, see it fail for the stated reason, implement, see it pass. Database tests carry `// @vitest-environment node`.
- Windows, PowerShell 5.1: write files without a BOM; commit with a message file (helper below). End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

```powershell
# Run once per shell, from the worktree root.
function Commit([string]$msg) {
  $f = Join-Path $env:TEMP 'qrie-safety-commit.txt'
  [System.IO.File]::WriteAllText($f, "$msg`n`nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`n")
  git commit -F $f
}
```

## Seams with plan 4 (built at the same time; plan 4 merges first)

| Seam | This plan |
|---|---|
| T1 | Migrations 0065 to 0069 only. |
| T2 | 0066 creates `admin.privacy_import_refusal(p_org uuid) returns text` with `create or replace`, internal (revoked from `public, anon, authenticated, service_role`, as plan 4's stub is), `search_path` fixed: NULL when the school may import, else one English sentence, while the school's fiduciary or disclosure recipient is undecided (on HOSTED and STAGING databases: ruling R13). Its own tests call it directly. It does not create or change `admin.import_refusal` or `admin.api_gate`. |
| T3 | `public.claim_relay` is not touched. |
| T4 | `public.app_config` is not touched. |
| T5 | Relay TypeScript: new `packages/relay/src/safetyFlag.ts`; hook-ins in `handler.ts` (route name, dep, one dispatch line), `gate.ts` (`FreeRoute` gains `'flag'`, the spend exemption covers it), `index.ts` (exports), `supabase/functions/relay/index.ts` (one dep). |
| T6 | `apps/student`: new `src/lib/report.ts`, `src/features/help/help-sheet.tsx`; hook-ins: a Help button in `src/components/shell.tsx`, the `@ai-tutor/safety` alias in `vite.config.ts` and `tsconfig.app.json`. `apps/classroom`: new `src/lib/distressCapture.ts`; hook-ins: `Flag.direction?` in `src/stores/flags.ts`, `direction: 'to-student'` at `src/lib/safety.ts:70`, one `useEffect` in `src/App.tsx`, one store line in `vite.config.ts`. |
| T7 | Declares `roles?: Me['role'][]` on `BaseNavItem` in `apps/admin/src/components/layout/types.ts` (identical optional field; the merge keeps one declaration) and sets `roles` on its three nav items. It does not filter the sidebar (plan 4 does). |
| T8 | Union at merge: `admin-invariants.test.ts`, `router.tsx`, `sidebar-data.ts`, `admin-client/src/index.ts`, `apps/admin/src/lib/client.ts`, `docs/ops/admin-console.md` (this plan appends `## 8. Safety, classes and privacy (plan 5)`; plan 4's section 7 is absent on this branch). |
| T9 | Owns the contest purge date (`admin.setting` key `contest_purge_on`, the daily purge) and the retention truth. Does not touch the contest's daily limit or `contest.entries_open`. |
| T10 | Adds no `flag_def` row. |
| T11 | Does not recreate `admin.flag_set`, `admin.set_halt` or `public.app_config`. |

**Files this plan changes outside T6 and T8, each needed by its own scope:** `public.alert_snapshot` (0065, replaced to add one count: the distress alarm; plan 4 does not touch it, merge note 3); `supabase/tests/admin-alarm.test.ts` (its `SIGNALS` list gains that key); `tools/admin-alert/src/evaluate.ts` and its test (the distress rule); `admin.school_health_for`'s grey safety sentence (0067, a literal replaced in place, merge note 5); `tools/admin-api/src/handle.ts`, `tools/admin-api/tests/deps.ts`, `supabase/functions/admin-api/index.ts` (two routes and their Storage dependency); `packages/lms-client/src/{report.ts (new), api.ts (one method), index.ts (one export)}` (the student app reaches the database only through lms-client; an LMS-lane file, merge note 7); `apps/admin/README.md` (one paragraph).

## Review Focus

1. **A child's words leave the database only through `admin.case_report`**, one report, inside an open case held by the caller, opened with a fresh code and a reason, logged in `admin.read_log`, within 30 reads a day. Every list, tile, overview, alarm and audit row is free of the note and the spoken line (Task 6 tests 1 and 14 assert a sentinel note never appears in any other function's JSON).
2. **A distress flag carries no words and no child id**: the route refuses any body key outside six named ones, the table has no user column, the school is resolved inside Postgres from a school membership only (Tasks 1 to 3).
3. **Erasure is complete and has one door**: the owner with a fresh code, a verified request, the child marked as left, photos removed from Storage before the rows go, every foreign key to `auth.users` pinned by a test so a new table forces review, the login ID scrubbed from the school's activity log, one `child-erased` audit row (Tasks 9, 10).
4. **A removed class is hidden at once and its files are really gone** before its catalogue row is deleted; a Storage failure leaves it hidden and retryable (Tasks 8, 10).
5. **Who may do what** is pinned: the `authenticated` list, each function's roles (safety reads reports and cases; ops retracts classes (with a fresh code) and works erasure requests; only the owner publishes, erases, decides a school's privacy or sets the purge date), finance and children refused everywhere here.
6. **The import gate (T2)** refuses an undecided school on HOSTED and STAGING and answers NULL elsewhere (Task 5).

## Interfaces (what this plan produces and consumes)

**Consumes:** plan 1 (`require_staff`, `require_fresh_mfa`, `check_environment`, `environment`, `audit`, `audit_service`, `audit_immutable`, `tripwire`, `admin.setting`, `admin.platform_staff`, `admin.audit_event`, `public.alert_snapshot`'s body, the console shell); plan 2 (`require_reason`, `school_org`, `like_escape`, `is_direct`, `school_health_for`, `admin-api`'s handler, test world and Deno entry, `WriteDialog`, `useLoad`, `LoadView`, `Write`, `AdminApiCaller`, `replyCaller`); the LMS lane (`lms.school`, `lms.account`, `lms.audit_event`, `lms.india_today`, `public.keep_student_report`, `public.membership`, `public.student_report`, `public.prepared_class`, `public.usage_cost`, `public.learning_session`, `public.contest_signup`, buckets `classes` and `lms-work`); `@ai-tutor/safety` (`screen`, `redact`, `HELPLINES`); the relay's `admitFree`, `fail`, `isUuid`, `HandlerDeps`.

**Produces, SQL, browser-callable (`authenticated`; each checks staff itself):**
`admin.safety_capture_set(p_on date, p_reason, p_env)`;
`admin.school_privacy_list()`, `admin.school_privacy_set(p_code, p_fiduciary, p_recipient, p_basis, p_reason, p_env)`;
`admin.safety_overview()`, `admin.safety_reports(p_status default null, p_kind default null, p_school default null, p_limit default 100)`, `admin.report_mark(p_report uuid, p_status, p_reason, p_env)`, `admin.case_open(p_report uuid, p_reason, p_env)`, `admin.case_report(p_case uuid)`, `admin.case_context(p_case uuid, p_reason)`, `admin.case_close(p_case uuid, p_outcome, p_reason, p_env)`, `admin.cases(p_open_only boolean default true)`, `admin.case_detail(p_case uuid)`, `admin.read_log_list(p_limit integer default 200)`;
`admin.classes(p_status default null)`, `admin.class_detail(p_class text)`, `admin.class_publish(p_class, p_reason, p_env)`, `admin.class_remove_prepare(p_class, p_action, p_reason, p_env)`;
`admin.erasure_requests(p_open_only boolean default true)`, `admin.erasure_request(p_request uuid)`, `admin.erasure_intake(p_channel, p_requester, p_reference, p_code, p_login, p_user uuid, p_received_on date, p_reason, p_env)`, `admin.erasure_verify(p_request, p_how, p_reason, p_env)`, `admin.erasure_refuse(p_request, p_reason, p_env)`, `admin.erasure_prepare(p_request, p_reason, p_env)`, `admin.retention_truth()`, `admin.contest_purge_set(p_on date, p_reason, p_env)`.
All return `jsonb` or `void`. `lms.report_problem(p_kind, p_note, p_where, p_item uuid, p_platform, p_release, p_at timestamptz) returns uuid` (students, `authenticated`).

**Produces, SQL, service role only:** `public.keep_safety_event(p_user uuid, p_id uuid, p_category text, p_direction text, p_platform text, p_release text, p_at timestamptz) returns boolean`, `admin.class_files_removed(p_class text, p_removed integer)`, `admin.erasure_complete(p_request uuid, p_objects_removed integer)`, `admin.privacy_daily()`.

**Produces, SQL, internal (no API grant):** `admin.distress_capture()`, `admin.privacy_import_refusal(p_org uuid)` (T2), `admin.reads_today(p_staff uuid)`, `admin.class_cost_for(p_topic text)`, `admin.erasure_counts(p_user uuid)`, `admin.scrub_login(p_text text, p_login text)`, `admin.contest_purge_due()`. Tables `admin.safety_event`, `admin.school_privacy`, `admin.case`, `admin.read_log`, `admin.class_review`, `admin.erasure_request`. Columns `public.student_report.seen_at`, `closed_at`; statuses `new|seen|triaged|closed`. Policy "anyone may read published classes" on `public.prepared_class`. Cron job `admin-privacy-daily` at `45 19 * * *` (01:15 IST). Settings keys `distress_capture_since`, `contest_purge_on`, `contest_purged_at`. `public.alert_snapshot` gains `distressFlags15m`.

**Produces, TypeScript:** `packages/relay/src/safetyFlag.ts` (`SafetyFlag`, `SafetyEventStore`, `MAX_FLAG_BYTES`, `readSafetyFlag`, `handleSafetyFlag`, `createMemorySafetyEventStore`, `createSupabaseSafetyEventStore`); relay route `POST /api/flag` (`/relay/flag` deployed); `apps/classroom/src/lib/distressCapture.ts` (`startDistressCapture`, `drainDistress`, `captureStore`); `tools/admin-api/src/privacy.ts` (`classRemoveRoute`, `eraseRoute`) and `admin-api` routes `POST …/class-remove {classId, action, reason, env}` → `{classId, removed}` and `POST …/erase {requestId, reason, env}` → `{requestId, rows, photos, activityLogLines}`; `packages/admin-client/src/{safety,classes,privacy}.ts` (`createSafetyClient(t)`, `createClassesClient(t, api)`, `createPrivacyClient(t, api)` and their types); console pages under `apps/admin/src/features/{safety,classes,privacy}/`; `packages/lms-client/src/report.ts` (`ProblemReport`, `reportProblem`); `apps/student/src/lib/report.ts`, `apps/student/src/features/help/help-sheet.tsx`; `tools/admin-alert` rule `distress-flag`.

## File structure

| Path | Responsibility | Task |
|---|---|---|
| `supabase/migrations/0065_admin_safety_capture.sql` | `admin.safety_event`, `public.keep_safety_event`, `admin.distress_capture`, `admin.safety_capture_set`, `public.alert_snapshot` + one count | 1 |
| `supabase/tests/safety-fixtures.ts` | `keepFlag`, `report`, `photo`, `classRow`, `populateChild` | 1, 6, 8, 9 |
| `supabase/tests/admin-safety-capture.test.ts`; `admin-alarm.test.ts` (modify) | capture | 1 |
| `packages/relay/src/safetyFlag.ts` + `handler.ts`, `gate.ts`, `index.ts`, `supabase/functions/relay/index.ts`, `apps/classroom/vite.config.ts` (hook-ins) + `packages/relay/tests/safetyFlag.test.ts` | the route | 2 |
| `apps/classroom/src/lib/distressCapture.ts` + `stores/flags.ts`, `lib/safety.ts`, `App.tsx` (hook-ins) + `apps/classroom/tests/distressCapture.test.ts` | the app sends flags | 3 |
| `tools/admin-alert/src/evaluate.ts` + `tests/evaluate.test.ts` | the safety chat hears of a flag | 4 |
| `supabase/migrations/0066_admin_school_privacy.sql` + `supabase/tests/admin-school-privacy.test.ts` | per-school decision, T2 | 5 |
| `supabase/migrations/0067_admin_safety_cases.sql` + `supabase/tests/admin-safety-cases.test.ts` | statuses, triage, cases, read log, quota | 6 |
| `0067` (append) + `packages/lms-client/src/report.ts`, `api.ts`, `index.ts` + `packages/lms-client/tests/report.test.ts` | `lms.report_problem`; the health sentence | 7 |
| `supabase/migrations/0068_admin_classes.sql` + `supabase/tests/admin-classes.test.ts` | classes | 8 |
| `supabase/migrations/0069_admin_privacy.sql` + `supabase/tests/admin-privacy.test.ts` | erasure, retention truth, contest purge, daily job | 9 |
| `tools/admin-api/src/privacy.ts` + `handle.ts`, `tests/deps.ts`, `supabase/functions/admin-api/index.ts` + `tools/admin-api/tests/privacy.test.ts` | Storage-side removal | 10 |
| `packages/admin-client/src/{safety,classes,privacy}.ts`, `index.ts` + `tests/safety-classes-privacy.test.ts` | typed client | 11 |
| `apps/admin/src/features/{safety,classes,privacy}/model.ts`, `components/layout/types.ts` + `apps/admin/tests/{safety,classes,privacy}-model.test.ts` | pure console helpers, nav field | 12 |
| `apps/admin/src/features/safety/{index,case-page,reason-dialog}.tsx`, `features/classes/{index,class-page}.tsx`, `features/privacy/{index,request-page}.tsx`, `router.tsx`, `sidebar-data.ts`, `lib/client.ts` | the pages | 13 |
| `apps/student/src/lib/report.ts`, `src/features/help/help-sheet.tsx`, `src/components/shell.tsx`, `vite.config.ts`, `tsconfig.app.json` + `apps/student/tests/report.test.ts` | report button and helplines | 14 |
| `docs/ops/admin-console.md` (section 8), `apps/admin/README.md` | runbook, counsel questions | 15 |

---

### Task 1: Distress flags captured on the server (0065)

**Files:**
- Create: `supabase/migrations/0065_admin_safety_capture.sql`, `supabase/tests/safety-fixtures.ts`, `supabase/tests/admin-safety-capture.test.ts`
- Modify: `supabase/tests/admin-alarm.test.ts` (`SIGNALS` gains `'distressFlags15m'`), `supabase/tests/admin-invariants.test.ts`

**Interfaces:**
- Produces: the table, `public.keep_safety_event`, `admin.distress_capture()` → `{state: 'not-captured' | 'captured', since: 'YYYY-MM-DD' | null, last24h: number | null, last7d: number | null}`, `admin.safety_capture_set`, `alert_snapshot.distressFlags15m`.
- Fixture: `keepFlag(db, user: string, over?: Partial<{id: string; direction: 'from-student' | 'to-student'; at: string}>) => Promise<boolean | null>` (calls `public.keep_safety_event` through `asService`).

- [ ] **Step 1: Write the failing tests**

`supabase/tests/admin-safety-capture.test.ts` (`beforeAll`: `freshDatabase()`, `setEnvironment`, owner, ops, safety, `buildSchool(db, 'CAP')`, a direct user `createUser(db)`; set the alarm token with `admin.alert_token_set` as `admin-alarm.test.ts` does). Tests:
1. `a flag is kept with its category, direction, school and two times, and with nothing that names the child`: `keepFlag(db, school.kid8a)` → `true`; the row's `org_id` = `school.org`, `category = 'distress'`, `direction = 'from-student'`; `select column_name from information_schema.columns where table_schema = 'admin' and table_name = 'safety_event' order by 1` = `['at','category','direction','id','org_id','platform','received_at','release']`.
2. `a retry with the same id keeps one row and answers false`.
3. `a direct user's flag has no school`: `org_id` null.
4. `a flag that is not distress, has no id, user, time or direction is refused`: each of `p_category 'redirect'`, `p_id null`, `p_user null`, `p_at null`, `p_direction null`, `p_direction 'sideways'` rejects `a flag needs a user, an id, a time, the category distress and a direction`.
5. `only the service role may keep a flag, and no API role can read the table`: `has_function_privilege` false for `anon`, `authenticated`, true for `service_role`; `has_table_privilege(role, 'admin.safety_event', 'select,insert,update,delete')` false for all three.
6. `the thousand-and-first flag in an hour is refused with null and not kept`: insert 1000 rows directly (`set_config('admin.session','on',true)` first, random ids, `received_at now()`), then `keepFlag` → `null`; count stays 1000 + the earlier rows.
7. `capture reads not captured until the first flag arrives, then captured since that India day`: on a second `freshDatabase()`: `admin.distress_capture()` = `{state:'not-captured', since:null, last24h:null, last7d:null}`; after one `keepFlag` → `state 'captured'`, `since` = `lms.india_today()` as text, `last24h 1`, `last7d 1`.
8. `the owner records the day capture went live; ops and safety cannot; a future or older-than-a-year day is refused`: as `aal2(owner)` with `p_on => today - 3` → setting `distress_capture_since` = that day and an audit row `distress-capture-since-set`; ops and safety → `not allowed`; tomorrow and today − 400 → `the day capture went live is in the last year, not in the future`; a child (`anonymousChild`) → `not allowed`.
9. `the alarm counts distress flags of the last 15 minutes, and nothing else about them`: one flag now and one with `received_at` set 20 minutes back (update with session on) → `alert_snapshot(TOKEN) ->> 'distressFlags15m'` = `1`.

In `admin-alarm.test.ts`, add `'distressFlags15m'` to `SIGNALS` (`:17-20`).

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run supabase/tests/admin-safety-capture.test.ts supabase/tests/admin-alarm.test.ts`
Expected: FAIL (`relation "admin.safety_event" does not exist`; the alarm's key list lacks `distressFlags15m`).

- [ ] **Step 3: Write the migration**

`supabase/migrations/0065_admin_safety_capture.sql`:

```sql
-- DISTRESS FLAGS, CAPTURED ON THE SERVER (spec sections 7 and 11, plan 5).
--
-- The tutor's screen (packages/safety) recognises a child in distress on the
-- device and, until now, wrote that only to a local log. The relay's /api/flag
-- route sends each flag here through keep_safety_event. A flag holds what
-- happened (distress), whose words matched (the child's, or the tutor's own
-- line), the child's school when the child belongs to one, the build, and two
-- times. It holds no user id, no session, no lesson and no words: the user id
-- is used once, inside keep_safety_event, to find the school, and is not kept.

create table if not exists admin.safety_event (
  id uuid primary key,
  category text not null check (category in ('distress')),
  direction text not null check (direction in ('from-student', 'to-student')),
  org_id uuid references lms.school on delete set null,
  platform text check (platform in ('web', 'android')),
  release text check (char_length(release) <= 100),
  at timestamptz not null,
  received_at timestamptz not null default now()
);
create index if not exists safety_event_received on admin.safety_event (received_at desc);
revoke all on admin.safety_event from public, anon, authenticated, service_role;
alter table admin.safety_event enable row level security;
drop trigger if exists safety_event_tripwire on admin.safety_event;
create trigger safety_event_tripwire after insert or update or delete on admin.safety_event
  for each row execute function admin.tripwire();

-- The relay's door, service role only. true: kept now; false: already kept (a
-- retry); null: more than 1000 flags arrived in the last hour, so this one is
-- refused and the app keeps it to send again (ruling R5).
create or replace function public.keep_safety_event(
  p_user uuid, p_id uuid, p_category text, p_direction text, p_platform text, p_release text, p_at timestamptz
)
returns boolean
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  school uuid;
  kept uuid;
  last_hour integer;
begin
  if p_user is null or p_id is null or p_at is null
     or p_category is distinct from 'distress'
     or coalesce(p_direction, '') not in ('from-student', 'to-student') then
    raise exception 'a flag needs a user, an id, a time, the category distress and a direction';
  end if;
  if exists (select 1 from admin.safety_event e where e.id = p_id) then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtext('admin.safety_event'));
  select count(*)::int into last_hour from admin.safety_event e where e.received_at > now() - interval '1 hour';
  if last_hour >= 1000 then
    return null;
  end if;
  -- A school only: a direct user's solo organisation would name the child.
  select m.org_id into school
    from public.membership m
    join lms.school s on s.org_id = m.org_id
   where m.user_id = p_user
   order by m.created_at
   limit 1;
  perform set_config('admin.session', 'on', true);
  insert into admin.safety_event (id, category, direction, org_id, platform, release, at)
  values (p_id, 'distress', p_direction, school,
          case when p_platform in ('web', 'android') then p_platform end,
          nullif(left(btrim(coalesce(p_release, '')), 100), ''), p_at)
  on conflict (id) do nothing
  returning id into kept;
  if kept is null then
    return false;
  end if;
  insert into admin.setting (key, value)
  values ('distress_capture_since', to_jsonb(to_char(lms.india_today(), 'YYYY-MM-DD')))
  on conflict (key) do nothing;
  return true;
end;
$$;
revoke all on function public.keep_safety_event(uuid, uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.keep_safety_event(uuid, uuid, text, text, text, text, timestamptz) to service_role;

-- What the console says about capture: "not captured" until a flag has arrived
-- or the owner has recorded the day capture went live, never a bare zero.
create or replace function admin.distress_capture()
returns jsonb
language sql stable security definer
set search_path = admin, public
as $$
  select case
    when s.since is null then
      jsonb_build_object('state', 'not-captured', 'since', null, 'last24h', null, 'last7d', null)
    else jsonb_build_object(
      'state', 'captured', 'since', s.since,
      'last24h', (select count(*)::int from admin.safety_event e where e.received_at > now() - interval '24 hours'),
      'last7d', (select count(*)::int from admin.safety_event e where e.received_at > now() - interval '7 days'))
  end
  from (select (select st.value #>> '{}' from admin.setting st where st.key = 'distress_capture_since') as since) s
$$;
revoke all on function admin.distress_capture() from public, anon, authenticated;
```

`admin.safety_capture_set(p_on date, p_reason text, p_env text) returns void`, plpgsql volatile definer, `search_path = admin, lms, public`, rules in order: `me := admin.require_staff(array[]::text[])` (owner); `check_environment(p_env)`; `require_reason(p_reason)`; `p_on` null, after `lms.india_today()` or before `lms.india_today() - 365` → `the day capture went live is in the last year, not in the future`; `set_config('admin.session','on',true)`; upsert `admin.setting ('distress_capture_since', to_jsonb(to_char(p_on,'YYYY-MM-DD')))`; `admin.audit(me, 'distress-capture-since-set', 'setting', 'distress_capture_since', p_reason, jsonb_build_object('on', to_char(p_on, 'YYYY-MM-DD')))`. Revoke from `public, anon`; grant `authenticated`.

Then replace `public.alert_snapshot(p_token text)`: copy its whole body from `0051_admin_alarm.sql:48-100` unchanged, add one key to the returned object, `'distressFlags15m', (select count(*)::int from admin.safety_event e where e.received_at > now() - interval '15 minutes')`, and restate `0051:102-105`'s revoke and grant. The body's header comment states that the snapshot carries counts only.

- [ ] **Step 4: Update the invariants list**

In `admin-invariants.test.ts`, add `'admin.safety_capture_set'` (between `'admin.restore_drill_set'` and `'admin.school_activity'`; C collation, plan 3's note). The final list is in Task 9.

- [ ] **Step 5: Run and see them pass**

Run: `npx vitest run supabase/tests/admin-safety-capture.test.ts supabase/tests/admin-alarm.test.ts supabase/tests/admin-invariants.test.ts supabase/tests/admin-today.test.ts`
Expected: PASS (9 new tests; `admin-today` still reads `capture.distress` = `'not-captured'`, because `admin.today()` is not changed: ruling R27).

- [ ] **Step 6: Commit**

```powershell
git add supabase/migrations/0065_admin_safety_capture.sql supabase/tests/safety-fixtures.ts supabase/tests/admin-safety-capture.test.ts supabase/tests/admin-alarm.test.ts supabase/tests/admin-invariants.test.ts
Commit "feat: distress flags kept on the server with a school and no child id, counted by the alarm"
```

---

### Task 2: The relay's flag route (`/api/flag`)

**Files:**
- Create: `packages/relay/src/safetyFlag.ts`, `packages/relay/tests/safetyFlag.test.ts`
- Modify (hook-ins only): `packages/relay/src/handler.ts`, `packages/relay/src/gate.ts`, `packages/relay/src/index.ts`, `supabase/functions/relay/index.ts`, `apps/classroom/vite.config.ts`

**Interfaces:**

```ts
// safetyFlag.ts
export interface SafetyFlag {
  id: string;                                   // a uuid the app mints once; the retry key
  category: 'distress';
  direction: 'from-student' | 'to-student';
  at: string;                                   // ISO, when the screen flagged it
  platform?: 'web' | 'android';
  release?: string;                             // at most 100 characters
}
export interface SafetyEventStore {
  /** {fresh} when kept (fresh false for a retry); null when it could not be kept now. */
  keep(userId: string, flag: SafetyFlag): Promise<{ fresh: boolean } | null>;
}
export const MAX_FLAG_BYTES = 1024;
export function readSafetyFlag(body: Uint8Array): { ok: true; value: SafetyFlag } | { ok: false; response: RelayResponse };
export async function handleSafetyFlag(req: RelayRequest, deps: HandlerDeps): Promise<RelayResponse>;
export function createMemorySafetyEventStore(): SafetyEventStore & { kept: { userId: string; flag: SafetyFlag }[] };
export function createSupabaseSafetyEventStore(supabaseUrl: string, serviceRoleKey: string, fetchImpl?: typeof fetch): SafetyEventStore;
```

Hook-ins: `HandlerDeps` gains `safetyEvents?: SafetyEventStore` (with a docblock saying absent means 501); `RouteName` gains `'flag'`; `routeFor` returns `'flag'` when the last segment is `flag`; `handleRelay` gains `if (early === 'flag') return handleSafetyFlag(req, deps);` beside the `report` line (`handler.ts:332`), above the kill switch; `FreeRoute` gains `'flag'`; `admitFree`'s exemption becomes `(route === 'report' || route === 'flag') && spendOnly`, and its docblock says both; `index.ts` exports the module's names; the Edge Function adds `safetyEvents: createSupabaseSafetyEventStore(SUPABASE_URL, SERVICE_ROLE_KEY)`; the dev server adds `safetyEvents: createMemorySafetyEventStore()` beside `reports:` (`apps/classroom/vite.config.ts:119`).

Rules of `readSafetyFlag`, in order, each a 400: not JSON → `that is not JSON`; not an object → `a flag is an object`; any key outside `id, category, direction, at, platform, release` → `a flag carries no words: only id, category, direction, at, platform and release`; `id` not a uuid (`isUuid`) → `a flag has a uuid`; `category !== 'distress'` → `a flag's category is distress`; `direction` not one of the two → `a flag's direction is from-student or to-student`; `at` not a parseable string → `a flag carries the time it was made, as ISO text`; `platform` present and not web/android → `platform is "web" or "android"`; `release` present and not text of 1 to 100 characters → `release must be short text`.

`handleSafetyFlag`: `POST` only (405); `deps.safetyEvents` absent → 501 `this host cannot take a flag`; `req.body.byteLength > MAX_FLAG_BYTES` → 413; `admitFree(req, 'flag', deps.gate)`; `readSafetyFlag`; `keep` → null → 503 `the flag was not kept this second; the app keeps it and sends it again`; else 202 `{ kept: fresh }`. No ops webhook (the outside alarm tells the safety chat, Task 4).

`createSupabaseSafetyEventStore`: `POST ${url}/rest/v1/rpc/keep_safety_event` with `apikey` and `authorization: Bearer <service role>`, body `{p_user, p_id, p_category, p_direction, p_platform: flag.platform ?? null, p_release: flag.release ?? null, p_at}`; not ok or a thrown fetch → null; body JSON `true` → `{fresh: true}`, `false` → `{fresh: false}`, `null` → null.

- [ ] **Step 1: Write the failing tests** (`packages/relay/tests/safetyFlag.test.ts`, the scaffolding of `report.test.ts:1-70`: `USER`, `yes` verifier, `gate()`, `post()` with url `/api/flag`, `deps()` with `safetyEvents: createMemorySafetyEventStore()`)
1. `routeFor names the flag route from either host prefix`: `/api/flag` and `/relay/flag` → `'flag'`.
2. `a flag is kept for the verified user and answered 202`: the store's `kept[0]` = `{userId: USER, flag: {...}}`; body `{kept: true}`.
3. `a body carrying any other key is refused, so no words can ride along`: with `note: 'x'`, with `text: 'x'`, with `lessonId: 'L1'` → 400, the store is empty.
4. `refuses a category other than distress, a wrong direction, a non-uuid id and a bad time` → 400 each with its message.
5. `a retry answers 202 with kept false`.
6. `the kill switch and a halted or capped meter do not stop a flag; a rate refusal does`: `disabled: true` → 202; ledger answering `halted` and `capped` → 202; `rate` → 429.
7. `without a store it is 501; without a sign-in 401; too large 413; GET 405`.
8. `when the store cannot keep it, 503 says the app keeps it`.
9. `the deployed store calls keep_safety_event with the service role and reads true, false and null`: a fake fetch records url, headers and body and answers each.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run packages/relay/tests/safetyFlag.test.ts`
Expected: FAIL (cannot resolve `../src/safetyFlag`).

- [ ] **Step 3: Write `safetyFlag.ts` and the hook-ins.** The module's header says what a flag carries, what it never carries, that it is admitted like a report (above the kill switch, zero units, exempt from halted, capped and budget), and that the relay sends no webhook for it.

- [ ] **Step 4: Run and see them pass, then the relay's other suites**

Run: `npx vitest run packages/relay`
Expected: PASS (9 new; `report.test.ts`, `gate.test.ts`, `prep.test.ts`, `enroll.test.ts` unchanged in behaviour).
Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```powershell
git add packages/relay/src/safetyFlag.ts packages/relay/tests/safetyFlag.test.ts packages/relay/src/handler.ts packages/relay/src/gate.ts packages/relay/src/index.ts supabase/functions/relay/index.ts apps/classroom/vite.config.ts
Commit "feat: the relay takes a distress flag with no words, above the kill switch, like a report"
```

---

### Task 3: The classroom sends each distress flag

**Files:**
- Create: `apps/classroom/src/lib/distressCapture.ts`, `apps/classroom/tests/distressCapture.test.ts`
- Modify (hook-ins only): `apps/classroom/src/stores/flags.ts` (`Flag` gains `direction?: 'to-student'`, documented as "set only when the tutor's own line was flagged; absent means the child's words"), `apps/classroom/src/lib/safety.ts:70` (adds `direction: 'to-student'`), `apps/classroom/src/App.tsx` (one line beside `useReportReplay();` at `:595`: `useEffect(() => startDistressCapture(), []);`)

**Interfaces:**

```ts
// distressCapture.ts
import type { WhoIsHere } from './supabase';
export interface Waiting { flag: SafetyFlagBody; owner: string | null }   // owner: the user id from the stored session, null for nobody, 'unknown'
export interface SafetyFlagBody { id: string; category: 'distress'; direction: 'from-student' | 'to-student'; at: string; platform: 'web' | 'android'; release: string }
export const captureStore: Store<{ waiting: Waiting[] }>;   // createLocalStore('distress-capture', { waiting: [] }, { neverSync: true }); at most 20 kept
export type SendOutcome = 'sent' | 'kept' | 'refused';
export async function sendDistress(flag: SafetyFlagBody, fetchImpl?: typeof relayFetch): Promise<SendOutcome>; // 2xx sent; 400, 405, 413 refused; anything else or a throw kept
export async function drainDistress(owner: WhoIsHere, send?: typeof sendDistress): Promise<{ sent: number; discarded: number }>;
export interface CaptureDeps {
  send?: typeof sendDistress;
  whoIsHere?: () => Promise<WhoIsHere>;   // default accountFromStoredSession
  mayPersist?: () => boolean;             // default lib/workspace mayPersist
  newId?: () => string;                   // default crypto.randomUUID
  platform?: () => 'web' | 'android';     // default isNative() ? 'android' : 'web'
  release?: string;                       // default VITE_RELEASE or 'dev', as ReportSheet.tsx:89
}
/** Subscribes to flagStore; returns the unsubscribe. Flags already in the log when it starts are not sent. */
export function startDistressCapture(deps?: CaptureDeps): () => void;
```

Behaviour: on start, remember the `at` of every flag already in `flagStore`; on each store change, every `distress` flag not seen before becomes a `SafetyFlagBody` (direction `flag.direction ?? 'from-student'`, a new id) queued with the owner from `whoIsHere()` (`unknown` when not known), then `drainDistress`. Nothing is queued when `mayPersist()` is false (a trial: ruling R4). `drainDistress` follows `replayUnsent`'s owner rules (`stores/flags.ts:271-310`): an `unknown` owner waits; another child's flag is discarded; `kept` waits; `sent` and `refused` leave the queue. On start it also drains once (a flag queued while offline). The queue never holds words: `SafetyFlagBody` has no text field.

- [ ] **Step 1: Write the failing tests** (jsdom; inject every dep; `flagStore.set({flags: []})` and `captureStore.set({waiting: []})` in `beforeEach`)
1. `a distress flag recorded on the device is sent once, with no words, and leaves the queue`: start; `recordFlag({kind:'distress', at})`; `send` called once; `Object.keys(body).sort()` = `['at','category','direction','id','platform','release']`; `direction 'from-student'`; queue empty.
2. `the tutor's own flagged line is sent as to-student`: `recordFlag({kind:'distress', direction:'to-student', at})`.
3. `redirect, cleaned and reported flags are not sent`.
4. `a send that did not land waits and goes on the next drain; a refused one is dropped`.
5. `a waiting flag of another child is discarded; one whose owner is unknown waits`.
6. `nothing is sent or queued during a trial`.
7. `flags already on the device when the app opens are not sent again`.
8. `at most 20 flags wait`.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run apps/classroom/tests/distressCapture.test.ts`
Expected: FAIL (cannot resolve `../src/lib/distressCapture`).

- [ ] **Step 3: Implement the module and the three hook-ins.**

- [ ] **Step 4: Run and see them pass, then the classroom's flag and report suites**

Run: `npx vitest run apps/classroom/tests/distressCapture.test.ts apps/classroom/tests/reportSend.test.tsx apps/classroom/tests/safety-wiring.test.tsx apps/classroom/tests/reportReplay.test.ts`
Expected: PASS (8 new; the three existing files unchanged; the known flake `apps/classroom/tests/reportReplay.test.ts` may time out under load: rerun it alone and report both runs).
Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```powershell
git add apps/classroom/src/lib/distressCapture.ts apps/classroom/tests/distressCapture.test.ts apps/classroom/src/stores/flags.ts apps/classroom/src/lib/safety.ts apps/classroom/src/App.tsx
Commit "feat: the tutor sends each distress flag to the server, never the words, and not during a trial"
```

---

### Task 4: The safety chat hears of a flag

**Files:** Modify `tools/admin-alert/src/evaluate.ts`, `tools/admin-alert/tests/evaluate.test.ts`

`Snapshot` gains `distressFlags15m?: number` (optional: a database before 0065 does not send it). New rule after the report rules: when `(answer.distressFlags15m ?? 0) > 0`, push `{channel: 'safety', key: 'distress-flag', text: 'Qrie safety: <n> distress flag(s) in the last 15 minutes. No words are kept. Open the Safety page.'}` on every run (no window: the count falls to zero 15 minutes later, so one flag speaks on at most three runs, which the header comment says).

- [ ] **Step 1: Write the failing tests**: (1) `speaks to the safety chat while a distress flag is under 15 minutes old, and to nobody else`; (2) `is quiet when the database does not send the count` (an older snapshot without the key). Extend the existing `never names a school, a lesson, a child or a note` test's snapshot with `distressFlags15m: 2`.
- [ ] **Step 2: Run** `npx vitest run tools/admin-alert` → FAIL (no `distress-flag` alert).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run tools/admin-alert` → PASS.
- [ ] **Step 5: Commit**

```powershell
git add tools/admin-alert/src/evaluate.ts tools/admin-alert/tests/evaluate.test.ts
Commit "feat: the alarm tells the safety chat when a distress flag arrives, with a count and nothing else"
```

---

### Task 5: Each school's data-protection decision, and the import gate (0066, T2)

**Files:** Create `supabase/migrations/0066_admin_school_privacy.sql`, `supabase/tests/admin-school-privacy.test.ts`; modify `admin-invariants.test.ts`

```sql
-- WHO IS RESPONSIBLE FOR A SCHOOL'S CHILDREN'S DATA, AND WHO IS TOLD (spec section 2).
-- Counsel decides both; the owner records what counsel decided, per school.
-- While either is undecided, nobody can be added to the school (T2), on the
-- databases that hold real children (HOSTED and STAGING: ruling R13).

create table if not exists admin.school_privacy (
  org_id uuid primary key references lms.school on delete cascade,
  fiduciary text not null default 'undecided' check (fiduciary in ('undecided', 'school', 'qrie')),
  recipient text not null default 'undecided' check (recipient in ('undecided', 'school', 'parent', 'school-and-parent')),
  basis text check (basis is null or char_length(basis) between 3 and 200),
  decided_by uuid,
  decided_at timestamptz
);
revoke all on admin.school_privacy from public, anon, authenticated, service_role;
alter table admin.school_privacy enable row level security;
drop trigger if exists school_privacy_tripwire on admin.school_privacy;
create trigger school_privacy_tripwire after insert or update or delete on admin.school_privacy
  for each row execute function admin.tripwire();

-- T2: internal. NULL when the school may import people; else the sentence the
-- person importing is shown. Plan 4's admin.import_refusal calls this.
create or replace function admin.privacy_import_refusal(p_org uuid)
returns text
language sql stable security definer
set search_path = admin, public
as $$
  select case
    when admin.environment() not in ('HOSTED', 'STAGING') then null
    when exists (select 1 from admin.school_privacy p
                  where p.org_id = p_org and p.fiduciary <> 'undecided' and p.recipient <> 'undecided') then null
    else 'Qrie has not yet recorded who is responsible for this school''s children''s data and who is told if a child may be at risk. '
         || 'The owner records both on the Privacy page; until then nobody can be added to this school.'
  end
$$;
revoke all on function admin.privacy_import_refusal(uuid) from public, anon, authenticated, service_role;
```

`admin.school_privacy_list() returns jsonb` (owner, ops, safety: `require_staff(array['ops','safety'])`): every `lms.school` ordered by code, left-joined: `{code, name, fiduciary ('undecided' when no row), recipient, basis, decidedAt, decidedByName (from platform_staff), importBlocked: admin.privacy_import_refusal(org) is not null}`.

`admin.school_privacy_set(p_code, p_fiduciary, p_recipient, p_basis, p_reason, p_env) returns void`: owner (`array[]::text[]`), `require_fresh_mfa(10)`, `check_environment`, `require_reason`; `org := admin.school_org(p_code)`; fiduciary not in the three → `the data fiduciary is school, qrie or undecided`; recipient not in the four → `who is told is school, parent, school-and-parent or undecided`; when either is decided and `btrim(p_basis)` is not 3 to 200 characters → `say what the decision rests on, in a few words (for example: counsel's letter of 2026-11-02)`; session on; upsert with `decided_by = me.user_id, decided_at = now()`; audit `school-privacy-set`, kind `school`, id the code, details `{from: {fiduciary, recipient}, to: {fiduciary, recipient}}` (no basis text). Both granted to `authenticated` only.

- [ ] **Step 1: Write the failing tests** (`setEnvironment(db, 'HOSTED')` in `beforeAll`; schools `PRA`, `PRB`)
1. `a school with no decision is refused on HOSTED with the sentence the importer sees`: `admin.privacy_import_refusal(org)` (as the database owner) = the exact sentence.
2. `a fiduciary without a recipient, or a recipient without a fiduciary, is still refused`.
3. `once both are decided the school may import`: → NULL.
4. `on TEST, DEMO and UNSET databases the gate answers NULL`: `select admin.set_environment('TEST', true)`, then `('DEMO', true)` (a set environment changes only with `p_force`, `0047:309-318`), then a second `freshDatabase()` left `UNSET`; set `HOSTED` back with `p_force` afterwards. Writes in this file pass `p_env => 'HOSTED'`.
5. `nobody but the owner with a fresh code records a decision`: ops, safety, finance (`makeFinance`), a child → `not allowed`; a stale owner → `confirm with your authenticator code first`.
6. `a decision needs a basis and known values`: the three messages.
7. `the list shows every school, its decision and whether its import is blocked, to owner, ops and safety`: `PRA` decided → `importBlocked false`; `PRB` → `'undecided'`, `true`; finance → `not allowed`.
8. `each decision is audited without its basis`: the audit row's `details::text` does not contain the basis string.
9. `the gate cannot be called from a browser or the service role`: `has_function_privilege(role, 'admin.privacy_import_refusal(uuid)', 'execute')` false for `anon`, `authenticated` and `service_role` (the LMS lane reaches it only through plan 4's `lms.import_refusal`, a definer function).

- [ ] **Step 2: Run** `npx vitest run supabase/tests/admin-school-privacy.test.ts` → FAIL (`relation "admin.school_privacy" does not exist`).
- [ ] **Step 3: Write the migration; add `'admin.school_privacy_list'`, `'admin.school_privacy_set'` to the invariants list (after `'admin.school_person_disable'`).**
- [ ] **Step 4: Run** `npx vitest run supabase/tests/admin-school-privacy.test.ts supabase/tests/admin-invariants.test.ts` → PASS (9 new).
- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/0066_admin_school_privacy.sql supabase/tests/admin-school-privacy.test.ts supabase/tests/admin-invariants.test.ts
Commit "feat: each school's fiduciary and disclosure recipient, and the import gate while either is undecided"
```

---

### Task 6: Report triage, cases and the read log (0067)

**Files:** Create `supabase/migrations/0067_admin_safety_cases.sql`, `supabase/tests/admin-safety-cases.test.ts`; modify `supabase/tests/safety-fixtures.ts` (`report(db, user, over?: Partial<{kind; note; lessonId; topicRef; beatId; spokenLine; receivedMinutesAgo: number}>) => Promise<string>` inserting through `public.keep_student_report` as the service role, then backdating `received_at` with the session on), `admin-invariants.test.ts`

**Statuses (ruling R7).** `new` (Unread) → `seen` (Read, the first look) → `triaged` (a case is open on it, or someone marked it so) → `closed`. 0019's `actioned` becomes `triaged` and `dismissed` becomes `closed`. `new` and `seen` keep their names, so `admin.today()`, `alert_snapshot` and the health card, which read `status = 'new'`, are unchanged.

```sql
-- 1. Report statuses, as the console names them.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.student_report'::regclass and conname = 'student_report_status_check') then
    raise exception '0067: no check named student_report_status_check on public.student_report; find the live name and replace that one';
  end if;
end
$$;
alter table public.student_report drop constraint student_report_status_check;
update public.student_report set status = 'triaged' where status = 'actioned';
update public.student_report set status = 'closed' where status = 'dismissed';
alter table public.student_report add constraint student_report_status_check
  check (status in ('new', 'seen', 'triaged', 'closed'));
alter table public.student_report add column if not exists seen_at timestamptz;   -- the first look
alter table public.student_report add column if not exists closed_at timestamptz;
-- 0019's actioned_at is the time a report became triaged.
drop trigger if exists student_report_tripwire on public.student_report;
create trigger student_report_tripwire after update on public.student_report
  for each row execute function admin.tripwire();

-- 2. A case: one report, opened by one member of staff with a reason.
create table if not exists admin.case (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.student_report on delete set null,
  org_id uuid,
  opened_by uuid not null,
  opened_at timestamptz not null default now(),
  reason text not null check (char_length(reason) between 3 and 500),
  status text not null default 'open' check (status in ('open', 'closed')),
  outcome text check (outcome in ('no-action', 'content-fixed', 'disclosed', 'referred', 'other')),
  closed_by uuid,
  closed_at timestamptz,
  close_reason text check (char_length(close_reason) <= 500),
  check ((status = 'closed') = (closed_at is not null))
);
create unique index if not exists case_one_open_per_report on admin.case (report_id) where status = 'open';
create unique index if not exists case_one_open_per_person on admin.case (opened_by) where status = 'open';
revoke all on admin.case from public, anon, authenticated, service_role;
alter table admin.case enable row level security;
drop trigger if exists case_tripwire on admin.case;
create trigger case_tripwire after insert or update or delete on admin.case
  for each row execute function admin.tripwire();

-- 3. Every opening of a child's words or their context, insert-only.
create table if not exists admin.read_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default clock_timestamp(),
  staff uuid not null,
  staff_role text not null,
  case_id uuid not null,
  report_id uuid,
  what text not null check (what in ('report', 'context')),
  reason text not null check (char_length(reason) between 3 and 500)
);
revoke all on admin.read_log from public, anon, authenticated, service_role;
alter table admin.read_log enable row level security;
drop trigger if exists read_log_no_change on admin.read_log;
create trigger read_log_no_change before update or delete on admin.read_log
  for each row execute function admin.audit_immutable();
drop trigger if exists read_log_no_truncate on admin.read_log;
create trigger read_log_no_truncate before truncate on admin.read_log
  for each statement execute function admin.audit_immutable();

-- Reads by one member of staff since midnight in India.
create or replace function admin.reads_today(p_staff uuid)
returns integer
language sql stable security definer
set search_path = admin, lms, public
as $$
  select count(*)::int from admin.read_log r
   where r.staff = p_staff and r.at >= (lms.india_today()::timestamp at time zone 'Asia/Kolkata')
$$;
revoke all on function admin.reads_today(uuid) from public, anon, authenticated;
```

The quota is 30 reads a day (ruling R10), written once as a constant inside `case_report` and `case_context` (`reads_per_day constant integer := 30;`) and repeated in `safety_overview`'s `quota.perDay`; a test pins all three.

`admin.case_open` in full (the shape the other writes follow):

```sql
create or replace function admin.case_open(p_report uuid, p_reason text, p_env text)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, lms, public
as $$
declare
  me admin.platform_staff := admin.require_staff(array['safety']);
  r public.student_report;
  new_id uuid;
  sc text;
begin
  perform admin.require_fresh_mfa(10);
  perform admin.check_environment(p_env);
  perform admin.require_reason(p_reason);
  select * into r from public.student_report where id = p_report for update;
  if r.id is null then
    raise exception 'there is no such report';
  end if;
  if r.status = 'closed' then
    raise exception 'this report is closed';
  end if;
  if exists (select 1 from admin.case c where c.report_id = r.id and c.status = 'open') then
    raise exception 'this report already has an open case';
  end if;
  if exists (select 1 from admin.case c where c.opened_by = me.user_id and c.status = 'open') then
    raise exception 'close your open case first: one report at a time';
  end if;
  perform set_config('admin.session', 'on', true);
  insert into admin.case (report_id, org_id, opened_by, reason)
  values (r.id, r.org_id, me.user_id, btrim(p_reason))
  returning id into new_id;
  update public.student_report
     set seen_at = coalesce(seen_at, now()),
         actioned_at = coalesce(actioned_at, now()),
         status = case when status in ('new', 'seen') then 'triaged' else status end
   where id = r.id;
  select s.code into sc from lms.school s where s.org_id = r.org_id;
  perform admin.audit(me, 'case-opened', 'case', new_id::text, p_reason,
    jsonb_build_object('reportId', r.id, 'kind', r.kind, 'school', sc));
  return jsonb_build_object('caseId', new_id);
end;
$$;
```

The others, as ordered rules (each `security definer`, `search_path = admin, lms, public`, granted to `authenticated` only):

- `admin.safety_overview() returns jsonb` (owner, safety): `{generatedAt, counts: {unread, read, triaged, closed}, unreadByKind: {wrong, rude, unsafe, other}, unreadAges: {underHour, underDay, underWeek, older}` (by `received_at`), `firstLook: {reports30d, looked30d, medianMinutes, maxMinutes}` (reports received in 30 days; `seen_at - received_at` of those with `seen_at`; `percentile_cont(0.5)` floored; nulls when none), `cases: {open, mineOpen}`, `capture: admin.distress_capture()`, `quota: {readsToday: admin.reads_today(me), perDay: 30}`}`. Counts only.
- `admin.safety_reports(p_status text default null, p_kind text default null, p_school text default null, p_limit integer default 100) returns jsonb` (owner, safety): `p_status` null or one of the four (else `a status is new, seen, triaged or closed`); `p_kind` null or one of the four kinds; `p_school` a code (`admin.school_org`) or `'direct'` (org not a school) or null; limit clamped 1..500. Order: unread first, oldest first; then the rest newest first. Answer `{rows: [...], more: boolean}`, each row exactly `{id, kind, status, receivedAt, ageMinutes, seenAt, firstLookMinutes, school: {code, name} | null, lessonId, platform, openCaseId}`. Never `note`, `spoken_line`, `session_id`, `beat_id`, `topic_ref`, `user_id`, `release`.
- `admin.report_mark(p_report uuid, p_status text, p_reason text, p_env text) returns void` (owner, safety): env, reason; report missing → `there is no such report`; `p_status` not `seen|triaged|closed` → `a report is marked read, triaged or closed`; rank `new 0, seen 1, triaged 2, closed 3`, target rank not above current → `a report only moves forward: unread, read, triaged, closed`; an open case on it → `this report has an open case; close the case instead`; set `seen_at` (when null), `actioned_at` (target ≥ triaged, when null), `closed_at` (closed); audit `report-marked` `{reportId, from, to}`.
- `admin.case_report(p_case uuid) returns jsonb` (owner, safety): case missing → `there is no such case`; closed → `this case is closed`; `opened_by <> me` → `only the person who opened this case can read it`; `admin.reads_today(me) >= 30` → `you have opened 30 records today, the most in one day`; report gone → `this report no longer exists`; insert `read_log (staff, staff_role, case_id, report_id, 'report', case.reason)`; return `{caseId, report: {id, kind, status, note, lessonId, topicRef, beatId, spokenLine, platform, release, at, receivedAt, school: {code, name} | null}, readsLeftToday}`. This is the only function that returns `note` or `spoken_line`.
- `admin.case_context(p_case uuid, p_reason text) returns jsonb` (owner, safety): the same checks plus `admin.require_reason(p_reason)`; `read_log (..., 'context', p_reason)`; return `{caseId, class: {id, title, status, version} | null` (the `prepared_class` whose `id = lesson_id` or `topic_ref = topic_ref`), `sitting: {source, startedAt, endedAt, activeMinutes} | null` (the `learning_session` whose id is the report's `session_id`), `sameLesson: {reports, unsafe}` (counts of reports with the same `lesson_id`), `readsLeftToday}`. Nothing else about the child.
- `admin.case_close(p_case uuid, p_outcome text, p_reason text, p_env text) returns void` (owner, safety): env, reason; case missing/closed as above; neither its opener nor the owner → `only the person who opened this case, or the owner, can close it`; outcome not in the five → `an outcome is no-action, content-fixed, disclosed, referred or other`; outcome `disclosed`: the case's `org_id` is not a school → `this child came on their own; who is told about them is not decided yet`; the school's `admin.school_privacy.recipient` is missing or `undecided` → `who is told at this school is not decided yet; the owner records it on the Privacy page`; set the case closed; the report `status 'closed', closed_at now()` (when it still exists); audit `case-closed` `{caseId, reportId, outcome}`.
- `admin.cases(p_open_only boolean default true) returns jsonb` (owner, safety): rows `{id, reportId, kind, school: {code, name} | null, openedByName, openedAt, status, outcome, closedAt}`, newest first, at most 500. No reasons.
- `admin.case_detail(p_case uuid) returns jsonb` (owner, safety): the case with `reason`, `closeReason`, `openedByName`, `closedByName`, the report's `kind`, `status`, `receivedAt` (no note), and its `reads: [{at, staffName, what, reason}]`.
- `admin.read_log_list(p_limit integer default 200) returns jsonb` (owner only): newest first `{at, staffName, staffRole, caseId, reportId, what, reason}`, limit clamped 1..1000.

- [ ] **Step 1: Write the failing tests** (`beforeAll`: database, `setEnvironment`, owner, ops, safety, a second safety member, finance, child; `buildSchool(db, 'SAF')`; `SENTINEL = 'SENTINEL child words 7f3a'`; reports through the fixture, one with `note: SENTINEL, spokenLine: 'SENTINEL tutor line 7f3a'`)
1. `no list, overview, case list or case detail ever carries a note or a spoken line`: as owner and safety, `JSON.stringify` of `safety_overview()`, `safety_reports()` (every filter), `cases(false)`, `case_detail(c)`, `read_log_list()`, and of every `admin.audit_event.details` and `reason` row, contains neither sentinel.
2. `0019's statuses become read, triaged and closed, and unread stays new`: on a database built `through: '0066'`, insert rows with `actioned` and `dismissed`, `applyAfter(db, '0066')`, read `triaged` and `closed`; the constraint refuses `actioned`.
3. `the list orders unread reports oldest first, then the rest newest first, and filters by status, kind and school`.
4. `ops, finance and a child cannot see the list`: each → `not allowed`.
5. `a report only moves forward, and a report with an open case is closed through its case`.
6. `opening a case needs a fresh code and a reason, marks the report triaged, and stamps the first look`: stale → `confirm with your authenticator code first`; `seen_at` set; status `triaged`; audit `case-opened` without the note.
7. `one open case per report and one per person`: the two messages.
8. `only the case's opener reads the report, inside the open case, and each read is logged`: the other safety member → `only the person who opened this case can read it`; the opener gets the sentinel note; `read_log` has one `report` row with the case's reason.
9. `the context read needs its own reason, is logged, and carries the class, the sitting and counts only`: keys of the answer exactly `['caseId','class','readsLeftToday','sameLesson','sitting']`.
10. `the thirty-first read of the day is refused, for the owner too`: 30 reads (alternating `case_report` and `case_context`) then → `you have opened 30 records today, the most in one day`; `readsLeftToday` falls 29..0; the overview says `quota.perDay = 30`.
11. `the read log cannot be changed or emptied`: `update`, `delete`, `truncate` on `admin.read_log` as the database owner → `the audit log is insert-only`.
12. `closing with disclosed needs the school's recipient; a direct child cannot be disclosed`: undecided → refused; after `school_privacy_set(..., 'school', 'school', basis)` as `fresh(owner)` → accepted; a report by `createUser` (direct) → `this child came on their own; who is told about them is not decided yet`.
13. `closing a case closes its report; only the opener or the owner closes it`.
14. `an erased child's report leaves its case standing with no report`: `delete from auth.users where id = kid` (session on) → `case.report_id` null; `case_detail` still answers; `case_report` → `this report no longer exists`.

- [ ] **Step 2: Run** `npx vitest run supabase/tests/admin-safety-cases.test.ts` → FAIL (`function admin.safety_overview() does not exist`).
- [ ] **Step 3: Write the migration; add to the invariants list `'admin.case_close'`, `'admin.case_context'`, `'admin.case_detail'`, `'admin.case_open'`, `'admin.case_report'`, `'admin.cases'` (after `'admin.billing_webhook_log'`), `'admin.read_log_list'` (before `'admin.relay_status'`), `'admin.report_mark'` (after `'admin.relay_status'`), `'admin.safety_overview'`, `'admin.safety_reports'` (after `'admin.safety_capture_set'`).**
- [ ] **Step 4: Run** `npx vitest run supabase/tests/admin-safety-cases.test.ts supabase/tests/admin-invariants.test.ts supabase/tests/admin-today.test.ts supabase/tests/admin-alarm.test.ts supabase/tests/admin-school-health.test.ts` → PASS (14 new; the readers of `status = 'new'` unchanged).
- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/0067_admin_safety_cases.sql supabase/tests/admin-safety-cases.test.ts supabase/tests/safety-fixtures.ts supabase/tests/admin-invariants.test.ts
Commit "feat: reports triaged without their words; one report at a time inside a case, with a reason, a fresh code, a quota and a read log"
```

---

### Task 7: The student app's report reaches the queue (0067, appended)

**Files:** Modify `supabase/migrations/0067_admin_safety_cases.sql` (append; this branch's own unmerged file); create `packages/lms-client/src/report.ts`, `packages/lms-client/tests/report.test.ts`; modify `packages/lms-client/src/api.ts` (one method), `packages/lms-client/src/index.ts` (one export); `supabase/tests/admin-school-health.test.ts` (its test at `:226` expects the old grey sentence; it changes to the new one).

```ts
// packages/lms-client/src/report.ts
import type { Transport } from './transport.ts';
export type ProblemKind = 'wrong' | 'rude' | 'unsafe' | 'other';
export type ProblemPlace = 'home' | 'work' | 'homework' | 'learn' | 'practice' | 'progress' | 'notices';
export interface ProblemReport {
  kind: ProblemKind;
  /** Already scrubbed on the device (apps/student/src/lib/report.ts); at most 500 characters; may be empty. */
  note: string;
  where: ProblemPlace;
  /** The homework's id when the report is about one; otherwise null. */
  itemId: string | null;
  platform: 'web' | 'android';
  release: string | null;
  /** ISO, stamped once when the child pressed Send; a retry sends the same value. */
  at: string;
}
export async function reportProblem(t: Transport, r: ProblemReport): Promise<string> {
  return String(await t.value('report_problem', {
    p_kind: r.kind, p_note: r.note, p_where: r.where, p_item: r.itemId, p_platform: r.platform, p_release: r.release, p_at: r.at,
  }));
}
```

In `createLmsClient` (`api.ts:805-812`), under "anyone signed in": `reportProblem: (r: ProblemReport) => reportProblem(t, r),`.

`lms.report_problem(p_kind text, p_note text, p_where text, p_item uuid, p_platform text, p_release text, p_at timestamptz) returns uuid`, plpgsql volatile definer, `search_path = public, lms`, rules in order: the caller's `lms.account` with `left_at is null` and `kind = 'student'` → else `only a student can send a report from here`; kind not in the four → `a report is wrong, rude, unsafe or other`; `p_where` not in the seven places → `say where in the app this happened`; `char_length(coalesce(p_note,'')) > 500` → `a report is at most 500 characters`; `p_platform` not web/android → `say whether this is the web app or the Android app`; 10 or more of this student's reports with `lesson_id like 'student-app/%'` received since India midnight → `You have sent 10 reports today. Please tell a teacher, or call Childline on 1098 if you need help now.`; then `select k.report_id from public.keep_student_report(me.user_id, p_kind, coalesce(p_note, ''), 'student-app/' || p_where, null, p_item::text, null, null, nullif(left(btrim(coalesce(p_release, '')), 100), ''), p_platform, coalesce(p_at, now())) k` and return it. `revoke all ... from public, anon; grant execute ... to authenticated`. Header comment: the homework id travels in `beat_id`, the place in `lesson_id`; a retry with the same `at` is the same report (0019's key).

Then the health card's grey safety sentence (`0052:262`, "Nobody at this school has used the tutor, where the report button is.") stops being true once the student app has a report button. Append a DO block in the pattern of plan 3's 0056 (`0056_admin_finance_role.sql`, the block that edits `staff_set`): for `admin.school_health_for(uuid)`, read `pg_get_functiondef`, replace that literal with `No unread reports, and nobody at this school has used the tutor yet.`, `execute` it; when the body has neither the old nor the new literal, `raise exception 'admin.school_health_for no longer says what 0067 expects: change its grey safety sentence by hand'`. `create or replace` with the same signature keeps its grants.

- [ ] **Step 1: Write the failing tests** (`packages/lms-client/tests/report.test.ts`, `// @vitest-environment node`; `buildSchool(db, 'REP')`; clients `pgliteTransport(db, school.kid8a)` for the child and `school.teacherA` for a teacher)
1. `a student's report reaches the queue with its place and homework, and a retry is the same report`: `reportProblem` → uuid; the row: `lesson_id 'student-app/homework'`, `beat_id` = the item id, `org_id` = the school; the same `at` again → the same id, one row.
2. `a teacher, a parent and a student who has left cannot send one`: each → `only a student can send a report from here`.
3. `the kind, the place, the platform and the note's length are checked`: the four messages.
4. `the eleventh report of the day is refused with the helpline`.
5. `nobody signed out can call it`: `has_function_privilege('anon', 'lms.report_problem(text, text, text, uuid, text, text, timestamptz)', 'execute')` false.
6. `the health card's grey safety sentence no longer says the tutor is where the report button is`: `admin.school_health(code)` as `aal2(owner)` for a school with no tutor use and no reports → safety signal reason `No unread reports, and nobody at this school has used the tutor yet.`
- [ ] **Step 2: Run** `npx vitest run packages/lms-client/tests/report.test.ts` → FAIL (`reportProblem` is not exported).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run packages/lms-client supabase/tests/lms-invariants.test.ts supabase/tests/admin-school-health.test.ts` → PASS (6 new; `lms-invariants` still passes: `report_problem` is not callable by `anon`).
- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/0067_admin_safety_cases.sql packages/lms-client/src/report.ts packages/lms-client/src/api.ts packages/lms-client/src/index.ts packages/lms-client/tests/report.test.ts supabase/tests/admin-school-health.test.ts
Commit "feat: a student's report from the student app reaches the same queue; the health card stops saying the tutor holds the only report button"
```

---

### Task 8: Classes: pending, publish, retract, reject, reports and cost (0068)

**Files:** Create `supabase/migrations/0068_admin_classes.sql`, `supabase/tests/admin-classes.test.ts`; modify `safety-fixtures.ts` (`classRow(db, id, over?: Partial<{status; topicRef; files: string[]}>)` inserting `prepared_class` and `storage.objects` rows in bucket `classes` named `<id>/<file>`), `admin-invariants.test.ts`

```sql
-- 1. The catalogue shows only published classes (ruling R16). Every row is
-- 'published' by default (0018), so nothing a student sees today changes.
drop policy if exists "anyone may read prepared classes" on public.prepared_class;
drop policy if exists "anyone may read published classes" on public.prepared_class;
create policy "anyone may read published classes" on public.prepared_class
  for select using (review_status = 'published');
drop trigger if exists prepared_class_tripwire on public.prepared_class;
create trigger prepared_class_tripwire after update or delete on public.prepared_class
  for each row execute function admin.tripwire();

-- 2. What staff did to each class, kept after the class is gone.
create table if not exists admin.class_review (
  id bigint generated always as identity primary key,
  class_id text not null,
  topic_ref text not null,
  title text not null,
  version integer,
  action text not null check (action in ('published', 'retracted', 'rejected', 'files-removed')),
  actor uuid,
  actor_name text not null,
  at timestamptz not null default now(),
  reason text not null default '' check (char_length(reason) <= 500),
  files integer
);
revoke all on admin.class_review from public, anon, authenticated, service_role;
alter table admin.class_review enable row level security;
drop trigger if exists class_review_tripwire on admin.class_review;
create trigger class_review_tripwire after insert or update or delete on admin.class_review
  for each row execute function admin.tripwire();

-- 3. What a class cost: usage rows of sittings on its topic, and rows that
-- share a preparation id with them. A floor when any row is unpriced.
create or replace function admin.class_cost_for(p_topic text)
returns jsonb
language sql stable security definer
set search_path = admin, public
as $$
  with s as (select ls.id from public.learning_session ls where ls.topic_ref = p_topic),
       p as (select distinct u.prep_id from public.usage_event u
              where u.session_id in (select id from s) and u.prep_id is not null),
       rows as (select u.inr, u.unpriced, u.bucket from public.usage_cost u
                 where u.session_id in (select id from s) or u.prep_id in (select prep_id from p))
  select jsonb_build_object(
    'inr', round(coalesce(sum(inr), 0), 2),
    'liveInr', round(coalesce(sum(inr) filter (where bucket = 'live'), 0), 2),
    'warmInr', round(coalesce(sum(inr) filter (where bucket = 'warm'), 0), 2),
    'unpriced', coalesce(bool_or(unpriced), false),
    'calls', count(*)::int,
    'sittings', (select count(*)::int from s))
  from rows
$$;
revoke all on function admin.class_cost_for(text) from public, anon, authenticated;
```

Functions (definer, `search_path = admin, lms, public, storage` where Storage is read):

- `admin.classes(p_status text default null) returns jsonb` (owner, ops, safety: `require_staff(array['ops','safety'])`): `p_status` null (every row in `prepared_class`) or `pending|published|retracted` (rows with it) or `removed` (the latest `files-removed` row per `class_id` in `class_review`); else `a class status is pending, published, retracted or removed`. Live rows: `{id, topicRef, title, subtitle, klass, subject, status, createdAt, publishedAt, version, reports: {total, open, unsafe}, cost: admin.class_cost_for(topic_ref), lastAction: {action, byName, at} | null}`; removed rows: `{id, topicRef, title, removedAt, byName, reason, reports: {...}}`. `reports` counts `student_report` rows with `lesson_id = id or topic_ref = <topic>` (ruling R17); `open` = not closed.
- `admin.class_detail(p_class text) returns jsonb` (owner, ops, safety): the live row or, when gone, its last review rows; missing everywhere → `there is no class with the ID %`; plus `reportsByKind: {wrong, rude, unsafe, other}`, `reportsByStatus: {new, seen, triaged, closed}`, `history: [{action, byName, at, reason, files}]`, `filesInStorage` (count of `storage.objects` in bucket `classes` named `like admin.like_escape(id) || '/%'`). No report note.
- `admin.class_publish(p_class text, p_reason text, p_env text) returns void` (owner, `require_fresh_mfa(10)`): env, reason; missing → `there is no class with the ID %`; status not `pending` → `only a class waiting for review can be published`; session on; `review_status 'published', published_at now()`; `class_review` row `published`; audit `class-published` `{classId, topicRef, version}`.
- `admin.class_remove_prepare(p_class text, p_action text, p_reason text, p_env text) returns jsonb` (owner, ops: `require_staff(array['ops'])`; `require_fresh_mfa(10)`, because the files it lists are then deleted for good: ruling R15): env, reason; action not `retract|reject` → `say retract or reject`; missing → `there is no class with the ID %`; `retract` and status not in `published, retracted` → `only a published class can be retracted`; `reject` and status not in `pending, retracted` → `only a class waiting for review can be rejected`; when not already `retracted`: session on, `review_status 'retracted', retracted_at now()`, `class_review` row `retracted` or `rejected`, audit `class-retracted` or `class-rejected` `{classId, topicRef, version}`; return `{classId, bucket: 'classes', objects: [names of storage.objects in bucket 'classes' under '<id>/']}`. Granted to `authenticated`; `admin-api` is its only caller.
- `admin.class_files_removed(p_class text, p_removed integer) returns jsonb` (service role only): the class row must exist with status `retracted` → else `this class is not being removed`; any `storage.objects` left under its prefix → `% files of this class are still in storage`; the actor is the latest `retracted`/`rejected` `class_review` row's actor; session on; `class_review` row `files-removed` with `files = p_removed`; `delete from public.prepared_class where id = p_class`; `admin.audit(<that staff row>, 'class-files-removed', 'class', p_class, '', {files, topicRef})`; return `{classId, removed}`.

- [ ] **Step 1: Write the failing tests** (`classRow` makes `CLS-A` published with two files, `CLS-P` pending with one, `CLS-B` published; one usage row priced and one unpriced on a sitting with `topic_ref` of `CLS-A`, using `public.model_price` rows the test inserts; two reports on `CLS-A`)
1. `a browser sees only published classes`: as `anon` (`set local role anon`), `select id from public.prepared_class` → `CLS-A`, `CLS-B` only.
2. `owner, ops and safety list classes by status with report counts and cost; finance and a child cannot`.
3. `cost is a floor when a call is unpriced, and counts the preparation's calls`: `unpriced true`; `inr` equals the priced row's rupees; a row sharing `prep_id` with no session is counted.
4. `only the owner with a fresh code publishes, and only a pending class`: ops → `not allowed`; stale owner → fresh-code message; `CLS-A` → `only a class waiting for review can be published`; `CLS-P` → published, review row and audit row.
5. `ops retracts a published class with a fresh code: hidden from the catalogue at once, its files listed for removal`: `class_remove_prepare('CLS-B','retract',...)` as `aal2(ops)` (stale) → `confirm with your authenticator code first` and `CLS-B` still `published`; as `fresh(ops)` → `objects` = its two names; `anon` no longer sees it; `review_status 'retracted'`.
6. `the owner rejects a pending class with a fresh code; safety and finance cannot remove one`.
7. `the row goes only once its files are gone`: as the service role, `class_files_removed('CLS-B', 2)` while the objects remain → `2 files of this class are still in storage`; after deleting them from `storage.objects` → the row is gone, `class_review` has `files-removed` with `files 2`, the audit row's actor is the ops member.
8. `a removed class is listed under removed with its reports`: `classes('removed')` has `CLS-B`; `class_detail('CLS-B')` answers its history.
9. `a later preparation of the same topic can be kept again`: insert a new `prepared_class` row with `CLS-B`'s topic as the service role → succeeds and is `published`.
10. `the service-role function is not callable from a browser`.

- [ ] **Step 2: Run** `npx vitest run supabase/tests/admin-classes.test.ts` → FAIL (`function admin.classes(text) does not exist`).
- [ ] **Step 3: Write the migration; add `'admin.class_detail'`, `'admin.class_publish'`, `'admin.class_remove_prepare'`, `'admin.classes'` (after `'admin.cases'`) to the invariants list and `'admin.class_files_removed'` to its service-role list and its "not signed in" loop.**
- [ ] **Step 4: Run** `npx vitest run supabase/tests/admin-classes.test.ts supabase/tests/admin-invariants.test.ts supabase/tests/admin-today.test.ts packages/relay/tests/prep.test.ts` → PASS (10 new).
- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/0068_admin_classes.sql supabase/tests/admin-classes.test.ts supabase/tests/safety-fixtures.ts supabase/tests/admin-invariants.test.ts
Commit "feat: classes published by the owner, retracted or rejected by ops, hidden at once, with reports and cost per class"
```

---

### Task 9: Erasure, the retention truth and the contest purge (0069)

**Files:** Create `supabase/migrations/0069_admin_privacy.sql`, `supabase/tests/admin-privacy.test.ts`; modify `safety-fixtures.ts` (`photo(db, org, assignment, student)` adds an `lms-work` object; `populateChild(db, school, kid)` writes one row in each child table it can reach: a `learning_session` and `ledger_event`, a `usage_event`, a `student_state` row, a `student_report`, a `consent_record`, a `contest_signup`, an `lms.submission`, an attendance mark, a work comment, a notice read, a guardian link to a new parent, a photo, an `lms.audit_event` naming the login ID), `admin-invariants.test.ts`

```sql
create table if not exists admin.erasure_request (
  id uuid primary key default gen_random_uuid(),
  received_on date not null,
  due_on date not null,
  channel text not null check (channel in ('email', 'phone', 'letter', 'school', 'in-app')),
  requester text not null check (requester in ('parent', 'student', 'school', 'other')),
  reference text not null check (reference ~ '^[A-Za-z0-9#/_ -]{3,60}$' and reference !~ '[0-9]{10}'),
  subject_kind text not null check (subject_kind in ('school-student', 'direct')),
  org_id uuid references lms.school on delete set null,
  login_id text,
  user_id uuid not null,
  status text not null default 'received' check (status in ('received', 'verified', 'erasing', 'erased', 'refused')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  verified_how text check (verified_how in ('school-confirmed', 'parent-callback', 'in-person', 'account-signed-in')),
  verified_by uuid,
  verified_at timestamptz,
  refused_by uuid,
  refused_at timestamptz,
  refused_reason text check (char_length(refused_reason) <= 500),
  erasing_by uuid,
  erasing_at timestamptz,
  erase_reason text check (char_length(erase_reason) <= 500),
  erased_at timestamptz,
  tallies jsonb
);
create unique index if not exists erasure_one_open_per_child on admin.erasure_request (user_id)
  where status in ('received', 'verified', 'erasing');
-- revoke from all API roles, RLS on, tripwire, as the other tables.
```

`user_id` has no foreign key on purpose: the row outlives the account it names.

```sql
-- Rows that point at one user, per foreign key to auth.users, counted. The
-- list is read from the catalogue at the moment of asking, so a table added
-- later is counted without a change here (and the test that pins the list
-- fails until someone has looked at it).
create or replace function admin.erasure_counts(p_user uuid)
returns jsonb
language plpgsql stable security definer
set search_path = admin, lms, public
as $$
declare
  fk record;
  n bigint;
  out jsonb := '{}'::jsonb;
begin
  for fk in
    select c.conrelid::regclass::text as tbl, a.attname::text as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.confrelid = 'auth.users'::regclass and c.contype = 'f' and c.confdeltype in ('c', 'n')
     order by 1, 2
  loop
    execute format('select count(*) from %s where %I = $1', fk.tbl, fk.col) into n using p_user;
    if n > 0 then
      out := out || jsonb_build_object(fk.tbl || '.' || fk.col, n);
    end if;
  end loop;
  return out;
end;
$$;

-- A login ID in free text, replaced where it stands alone.
create or replace function admin.scrub_login(p_text text, p_login text)
returns text
language sql immutable
as $$
  select regexp_replace(coalesce(p_text, ''), '(^|[^A-Z0-9-])' || p_login || '($|[^A-Z0-9-])', '\1[erased]\2', 'g')
$$;

create or replace function admin.erasure_complete(p_request uuid, p_objects_removed integer)
returns jsonb
language plpgsql volatile security definer
set search_path = admin, lms, public, storage
as $$
declare
  r admin.erasure_request;
  who admin.platform_staff;
  left_over integer;
  rows_found jsonb;
  log_lines integer := 0;
  solo_orgs uuid[];
begin
  select * into r from admin.erasure_request where id = p_request for update;
  if r.id is null or r.status <> 'erasing' then
    raise exception 'this request is not being erased';
  end if;
  select count(*)::int into left_over
    from storage.objects o
   where o.bucket_id = 'lms-work' and split_part(o.name, '/', 3) = r.user_id::text;
  if left_over > 0 then
    raise exception '% photos of this child are still in storage', left_over;
  end if;
  rows_found := admin.erasure_counts(r.user_id);
  -- A direct user's private solo organisation (0005: every signup gets one;
  -- deleting the user removes the membership, not the organisation). Kept
  -- aside before the user goes, deleted after; a school is never in it.
  select coalesce(array_agg(m.org_id), '{}') into solo_orgs
    from public.membership m
    join public.organization o on o.id = m.org_id and o.kind = 'solo'
   where m.user_id = r.user_id
     and not exists (select 1 from public.membership m2 where m2.org_id = m.org_id and m2.user_id <> r.user_id);
  perform set_config('admin.session', 'on', true);
  if r.login_id is not null and r.org_id is not null then
    update lms.audit_event e
       set target = admin.scrub_login(e.target, r.login_id),
           details = admin.scrub_login(e.details::text, r.login_id)::jsonb
     where e.org_id = r.org_id
       and (position(r.login_id in e.target) > 0 or position(r.login_id in e.details::text) > 0);
    get diagnostics log_lines = row_count;
  end if;
  delete from auth.users u where u.id = r.user_id;
  delete from public.organization o where o.id = any(solo_orgs) and o.kind = 'solo';
  update admin.erasure_request
     set status = 'erased', erased_at = now(), login_id = null,
         tallies = jsonb_build_object('rows', rows_found, 'photos', p_objects_removed, 'activityLogLines', log_lines)
   where id = r.id;
  select * into who from admin.platform_staff s where s.user_id = r.erasing_by;
  perform admin.audit(who, 'child-erased', 'erasure', r.id::text, coalesce(r.erase_reason, ''),
    jsonb_build_object('rows', rows_found, 'photos', p_objects_removed, 'activityLogLines', log_lines));
  return jsonb_build_object('requestId', r.id, 'rows', rows_found, 'photos', p_objects_removed, 'activityLogLines', log_lines);
end;
$$;
revoke all on function admin.erasure_complete(uuid, integer) from public, anon, authenticated;
grant execute on function admin.erasure_complete(uuid, integer) to service_role;
```

Browser functions (each `security definer`, `search_path = admin, lms, public` plus `storage` where read):

- `admin.erasure_intake(p_channel, p_requester, p_reference, p_code, p_login, p_user uuid, p_received_on date, p_reason, p_env) returns jsonb` (owner, ops): env, reason; channel → `a request came by email, phone, letter, school or in-app`; requester → `the request is from a parent, the student, the school or someone else`; reference → `a reference is 3 to 60 letters, digits, spaces, #, /, _ or -, and never an email address or a phone number`; `p_received_on` null, future or older than a year → `the day it was received is in the last year, not in the future`; subject: `p_code` and `p_login` → the `lms.account` (`there is no one at this school with the ID %`), kind not `student` → `only a student's account is erased from here`; else `p_user` → in `admin.platform_staff` → `a member of staff is not erased from here`, not `admin.is_direct(p_user)` → `that user is not a direct user`; neither → `name the child: a school code and login ID, or a direct user's ID`; an open request for the user → `this child already has an open request`; insert with `due_on = p_received_on + 30` (ruling R22); audit `erasure-requested` `{requestId, subjectKind, school}` (no login ID). Returns `{requestId}`.
- `admin.erasure_requests(p_open_only boolean default true) returns jsonb` (owner, ops): oldest due first, `{id, receivedOn, dueOn, daysLeft, channel, requester, reference, subjectKind, school: {code} | null, loginId, status}`. No names.
- `admin.erasure_request(p_request uuid) returns jsonb` (owner, ops): one record: the list fields plus `displayName` (school students), `left: boolean` (school students), `verifiedHow`, `verifiedByName`, `refusedReason`, `tallies`, and `preview: {rows: admin.erasure_counts(user), photos: <count of lms-work objects for the user>, activityLogLines: <count>}` while the account exists.
- `admin.erasure_verify(p_request, p_how, p_reason, p_env) returns void` (owner, ops): env, reason; how → `say how the request was verified: school-confirmed, parent-callback, in-person or account-signed-in`; status not `received` → `only a received request is verified`; a school student whose `left_at` is null → `mark this child as left first (the school admin, or Disable on their card)` (ruling R19); set verified; audit `erasure-verified` `{requestId, how}`.
- `admin.erasure_refuse(p_request, p_reason, p_env) returns void` (owner): env, reason; status not `received|verified` → `only an open request is refused`; set refused with `refused_reason = btrim(p_reason)`; audit `erasure-refused`.
- `admin.erasure_prepare(p_request, p_reason, p_env) returns jsonb` (owner, `require_fresh_mfa(10)`): env, reason; status not `verified|erasing` → `only a verified request is erased`; session on; status `erasing`, `erasing_by`, `erasing_at`, `erase_reason`; audit `erasure-started` `{requestId}`; return `{requestId, userId, bucket: 'lms-work', objects: [names where split_part(name,'/',3) = user]}`. `admin-api` is its only caller.
- `admin.retention_truth() returns jsonb` (owner, ops, safety): `{rows: [...], contest: {purgeOn, purgedAt}, distressCapture: admin.distress_capture()}`. Each row `{what, tables, holds, kept, enforcedBy, job: {name, schedule, lastStatus} | null}`, `job` read from `cron.job` (and `cron.job_run_details` through `to_regclass`, as `admin.system_health` does, `0055:217-235`). The rows, verified on 2026-10-08 (see "What exists"):

| what | tables | kept | enforcedBy |
|---|---|---|---|
| The tutor's record of classes and answers | `public.ledger_event`, `public.learning_session` | until the account is erased (a sitting with no events goes after 90 days) | nothing yet: job `purge-old-ledger` deletes no event until the server fold sets `purge_safe_before`, and nothing sets it (0021) (corrected in the fix pass; the first draft said 90 days) |
| A child's reports, with their words | `public.student_report` | until the account is erased | nothing |
| Distress flags (no child id, no words) | `admin.safety_event` | 365 days | job `admin-privacy-daily` (0069) |
| A parent's consent: name, phone, time | `public.consent_record` | until the account is erased | nothing |
| Contest entries: child's name, phone, address, city, school; parent's name and phone as typed | `public.contest_signup` | until the purge date clears them, else until the account is erased | job `admin-privacy-daily` (0069) |
| Phone numbers a code was sent to | `public.otp_send` | no window | nothing (0019 says nothing sweeps it) |
| What each tutor call cost, with the user id | `public.usage_event`, `public.relay_usage` | until the account is erased | nothing |
| Progress and the learner model | `public.student_state`, `public.concept_state`, `public.learner_model` | until the account is erased | nothing |
| School records: homework, answers, marks, attendance, comments, remarks, photos (`lms-work`) | `lms.*` | until the child is erased; leaving keeps them | nothing |
| Staff actions, reads of a child's words | `admin.audit_event`, `admin.read_log`, `admin.case` | forever, insert-only (ids and reasons) | nothing |
| Cashfree signature failures | `billing.webhook_event` | 90 days | job `billing-states` (0060) |

- `admin.contest_purge_set(p_on date, p_reason, p_env) returns void` (owner, `require_fresh_mfa(10)`): env, reason; `p_on` null, before tomorrow or after `lms.india_today() + 730` → `a purge date is from tomorrow to two years ahead`; upsert `contest_purge_on`; audit `contest-purge-set` `{on}`.
- `admin.contest_purge_due() returns integer` (internal): when `contest_purge_on` is set and `lms.india_today() >=` it, update every `contest_signup` created before that India day that still holds any of them: `student_name = '', student_phone = null, address = null, parent_name_unverified = null, parent_phone_unverified = null, school_name = null, city = null` (ruling R23; `klass`, `takes_tuition`, `campaign`, `created_at`, `user_id` stay); when any row changed, upsert `contest_purged_at` and `admin.audit_service('contest-purged', 'contest', <day>, '', {entries})`; return the count.
- `admin.privacy_daily() returns jsonb` (service role; the cron's): session on; `admin.contest_purge_due()`; `delete from admin.safety_event where received_at < now() - interval '365 days'`; return `{contestEntriesCleared, flagsDeleted}`. `select cron.schedule('admin-privacy-daily', '45 19 * * *', $job$ select admin.privacy_daily(); $job$);`

- [ ] **Step 1: Write the failing tests** (`setEnvironment`; owner, ops, safety, finance; `buildSchool(db, 'ERA')`; `populateChild(db, school, school.kid8a)`; `school.kid8a` marked left with `admin.school_person_disable` as `aal2(ops)`; a direct user)
1. `every foreign key to auth.users is one this plan has looked at`: the measured 44 `table.column:rule` strings ("What exists") equal the catalogue's list. A new one fails here until someone decides how erasure treats it.
2. `ops records a request with a reference that is never an email or a phone number, for a school student or a direct user`: the reference messages; `a@b.co` and `9876543210` refused; a teacher → `only a student's account is erased from here`; a staff member → `a member of staff is not erased from here`; a second open request → `this child already has an open request`; safety, finance, a child → `not allowed`.
3. `the list shows the due day and no names; one request shows the name and what would be erased`: `due_on = received + 30`; list JSON lacks the display name; `erasure_request` shows it and a preview whose `rows` names at least `lms.account.user_id`, `public.student_report`… (each table `populateChild` wrote) and `photos 1`.
4. `a school student must have left before the request is verified`: kid8b (not left) → the message.
5. `only the owner with a fresh code starts an erasure, and only a verified one`: ops → `not allowed`; stale owner → fresh-code message; a received request → `only a verified request is erased`; the answer lists the child's one photo.
6. `nothing is erased while a photo remains, and the request stays erasing`: `erasure_complete` as the service role → `1 photos of this child are still in storage`; rows intact.
7. `once the photos are gone, every row about the child goes, the login ID leaves the school's activity log, and one child-erased row is written`: delete the object; `erasure_complete(req, 1)` → for every foreign key in the catalogue `count(*) where col = kid` is 0; `auth.users` has no row; `lms.audit_event` has no row containing the login ID and has `[erased]` where it was; the request is `erased` with `login_id` null and `tallies`; exactly one `admin.audit_event` row with `action = 'child-erased'` for the request, actor the owner; the parent's `auth.users` row still exists.
8. `the request is refused by the owner with a reason, and a closed request cannot be erased`.
9. `a direct user is erased the same way and their solo organisation goes with them`: before, `select count(*) from public.organization o join public.membership m on m.org_id = o.id where m.user_id = <direct> and o.kind = 'solo'` is 1; after `erasure_complete`, that organisation's id is absent from `public.organization`; the school organisation of test 7 still exists.
10. `the retention truth names every job it claims, and lists the tables it says it covers`: for every row whose `enforcedBy` names a job, that job is in `cron.job`; the union of `tables` includes `public.usage_event`, `public.otp_send`, `public.contest_signup`, `admin.safety_event`; roles owner, ops, safety; finance → `not allowed`.
11. `the contest purge clears personal fields of entries made before its day and keeps the counts`: `contest_purge_set` as `fresh(owner)` with tomorrow; set the setting to yesterday directly (session on) to simulate the day passing; `admin.privacy_daily()` as the service role → the earlier entry has `student_name ''` and null phone, address, parent fields, school, city; `klass`, `campaign`, `created_at` kept; an entry created today keeps its fields; `contest_purged_at` set; an audit row `contest-purged` `{entries: 1}`.
12. `the purge date is the owner's, with a fresh code, from tomorrow to two years ahead`.
13. `distress flags older than a year are deleted by the daily job, newer ones stay`.
14. `the daily job is scheduled at 01:15 India time`: `cron.job` has `admin-privacy-daily` with `45 19 * * *`.

- [ ] **Step 2: Run** `npx vitest run supabase/tests/admin-privacy.test.ts` → FAIL (`relation "admin.erasure_request" does not exist`).
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: The final `authenticated` list** in `admin-invariants.test.ts`, C collation (`_` before letters):

```ts
[
  'admin.api_gate', 'admin.audit_list',
  'admin.billing_account_set', 'admin.billing_accounts', 'admin.billing_grace_set', 'admin.billing_invoice',
  'admin.billing_invoice_raise', 'admin.billing_invoice_void', 'admin.billing_invoices', 'admin.billing_link_prepare',
  'admin.billing_overview', 'admin.billing_payment_record', 'admin.billing_payment_reverse', 'admin.billing_payments',
  'admin.billing_plan_set', 'admin.billing_plans', 'admin.billing_refund_prepare', 'admin.billing_school',
  'admin.billing_settings', 'admin.billing_settings_set', 'admin.billing_subscription_create',
  'admin.billing_subscriptions', 'admin.billing_webhook_log',
  'admin.case_close', 'admin.case_context', 'admin.case_detail', 'admin.case_open', 'admin.case_report', 'admin.cases',
  'admin.class_detail', 'admin.class_publish', 'admin.class_remove_prepare', 'admin.classes',
  'admin.contest_purge_set',
  'admin.direct_user', 'admin.direct_user_block', 'admin.direct_user_find', 'admin.direct_users_summary',
  'admin.erasure_intake', 'admin.erasure_prepare', 'admin.erasure_refuse', 'admin.erasure_request',
  'admin.erasure_requests', 'admin.erasure_verify',
  'admin.flag_list', 'admin.flag_set', 'admin.me',
  'admin.read_log_list', 'admin.relay_status', 'admin.report_mark', 'admin.restore_drill_set', 'admin.retention_truth',
  'admin.safety_capture_set', 'admin.safety_overview', 'admin.safety_reports',
  'admin.school_activity', 'admin.school_contact_remove', 'admin.school_contact_set', 'admin.school_create',
  'admin.school_detail', 'admin.school_export', 'admin.school_health', 'admin.school_index', 'admin.school_list',
  'admin.school_note_add', 'admin.school_notes', 'admin.school_offboard', 'admin.school_people', 'admin.school_person',
  'admin.school_person_disable', 'admin.school_privacy_list', 'admin.school_privacy_set', 'admin.school_quiet_set',
  'admin.school_set_licence', 'admin.school_weekly',
  'admin.set_caps', 'admin.set_halt',
  'admin.staff_invite', 'admin.staff_list', 'admin.staff_roster', 'admin.staff_set',
  'admin.system_health', 'admin.today',
]
```

Service-role list and its "not signed in" loop gain `'admin.class_files_removed'`, `'admin.erasure_complete'`, `'admin.privacy_daily'`. A new test in `admin-invariants.test.ts`: `keeps the plan-5 internals and the flag door away from browsers` asserts `authenticated` cannot execute `admin.distress_capture`, `admin.privacy_import_refusal`, `admin.reads_today`, `admin.class_cost_for`, `admin.erasure_counts`, `admin.scrub_login`, `admin.contest_purge_due`, `public.keep_safety_event`, and that `anon` cannot execute `lms.report_problem`. (After the merge, plan 4's `admin.stop_status` joins the `authenticated` list and its internals stay out of it: merge note 8.)

- [ ] **Step 5: Run** `npx vitest run supabase/tests/admin-privacy.test.ts supabase/tests/admin-invariants.test.ts` → PASS (14 new + 1).
- [ ] **Step 6: Commit**

```powershell
git add supabase/migrations/0069_admin_privacy.sql supabase/tests/admin-privacy.test.ts supabase/tests/safety-fixtures.ts supabase/tests/admin-invariants.test.ts
Commit "feat: erasure requests and the owner's erasure of one child, what is kept and which job keeps it, and the contest purge date"
```

---

### Task 10: `admin-api` removes the files: class-remove and erase

**Files:** Create `tools/admin-api/src/privacy.ts`, `tools/admin-api/tests/privacy.test.ts`; modify (hook-ins) `tools/admin-api/src/handle.ts`, `tools/admin-api/tests/deps.ts`, `supabase/functions/admin-api/index.ts`

**Interfaces:**

```ts
// handle.ts additions
export const CALLER_FUNCTIONS = ['api_gate', 'staff_invite', 'direct_user_block', 'class_remove_prepare', 'erasure_prepare'] as const;
// ROUTES gains 'class-remove', 'erase'; the dispatch gains two lines calling privacy.ts.
export interface AdminApiDeps {
  // ...plan 2's fields unchanged
  /** The Storage API with the service role (plan 5). Absent: the two routes answer 503 before anything changes. */
  files?: { remove(bucket: 'classes' | 'lms-work', names: string[]): Promise<number> };
  /** A service-role-only admin function (plan 5). */
  serviceAdmin?(fn: 'class_files_removed' | 'erasure_complete', args: Record<string, unknown>): Promise<unknown>;
}

// privacy.ts
export async function classRemoveRoute(deps: AdminApiDeps, auth: string, b: Record<string, unknown>): Promise<{ classId: string; removed: number }>;
export async function eraseRoute(deps: AdminApiDeps, auth: string, b: Record<string, unknown>): Promise<unknown>;
```

`classRemoveRoute`: `deps.files` or `deps.serviceAdmin` missing → `Refused(503, 'This server cannot remove files yet.')`; `classId` text 1..200 and `action` `retract|reject` else `Refused(400, ...)`; `asCaller(auth, 'class_remove_prepare', {p_class, p_action, p_reason, p_env})` → `{objects}`; `files.remove('classes', objects)` in batches of 100 (a throw → `Refused(502, 'The class is hidden, but Storage did not remove its files. Press again; it is safe to repeat.')`); `serviceAdmin('class_files_removed', {p_class, p_removed})`. `eraseRoute`: the same shape with `erasure_prepare`, bucket `lms-work`, `erasure_complete`, and the 502 sentence `Nothing was erased: Storage did not remove the child's photos. Press again; it is safe to repeat.`

Deno entry: `files.remove` sends `DELETE ${SUPABASE_URL}/storage/v1/object/${bucket}` with JSON `{prefixes: names}` through `rest` (service role) and returns the length of the array it answers (UNVERIFIED on hosted: the shape supabase-js's `remove()` uses); `serviceAdmin` is `rest('/rest/v1/rpc/' + fn, {method: 'POST', profile: 'admin', body: args})`. The file's header lists the two new routes.

Test world (`deps.ts`): `files.remove` deletes matching `storage.objects` rows (as the Storage API would) and returns the count; `failNextRemove()` makes the next call throw; `serviceAdmin` runs `admin.<fn>(...)` through `asService`.

- [ ] **Step 1: Write the failing tests** (`tools/admin-api/tests/privacy.test.ts`; tokens `owner`, `owner-fresh`, `ops`, `ops-fresh`, `safety`)
1. `ops retracts a published class with a fresh code (token ops-fresh): hidden at once, files removed, then the row` (token `ops` → 403 `needs-mfa`, nothing changes): answer `{classId, removed: 2}`; no `storage.objects` under the prefix; no `prepared_class` row.
2. `the owner rejects a pending class the same way; safety is refused (403 not-allowed) and nothing changes`.
3. `when Storage fails the class stays hidden and retracted, and pressing again finishes it`: 502 with the sentence; `review_status 'retracted'`; the second call → 200.
4. `the owner erases a verified request with a fresh code`: 200, the child's rows gone, one `child-erased` audit row.
5. `ops and a stale owner cannot erase`: 403 `not-allowed`, 403 `needs-mfa`.
6. `when a photo will not delete, nothing is erased and pressing again finishes it`.
7. `a server without Storage answers 503 and changes nothing`: deps without `files` → 503; the class is still `published`, the request still `verified`.
8. `a bad body is a 400 before the database is asked`.
- [ ] **Step 2: Run** `npx vitest run tools/admin-api` → FAIL (route 404).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run tools/admin-api packages/admin-client` → PASS (8 new; plan 2's admin-api and client tests unchanged).
- [ ] **Step 5: Commit**

```powershell
git add tools/admin-api supabase/functions/admin-api/index.ts
Commit "feat: admin-api removes a class's files and a child's photos through Storage, after the database says yes"
```

---

### Task 11: The typed client: safety, classes, privacy

**Files:** Create `packages/admin-client/src/{safety,classes,privacy}.ts`, `packages/admin-client/tests/safety-classes-privacy.test.ts`; modify `packages/admin-client/src/index.ts` (three `export *` lines)

```ts
// safety.ts
export type ReportStatus = 'new' | 'seen' | 'triaged' | 'closed';
export type ReportKind = 'wrong' | 'rude' | 'unsafe' | 'other';
export type CaseOutcome = 'no-action' | 'content-fixed' | 'disclosed' | 'referred' | 'other';
export interface Capture { state: 'not-captured' | 'captured'; since: string | null; last24h: number | null; last7d: number | null }
export interface SafetyOverview {
  generatedAt: string;
  counts: Record<'unread' | 'read' | 'triaged' | 'closed', number>;
  unreadByKind: Record<ReportKind, number>;
  unreadAges: { underHour: number; underDay: number; underWeek: number; older: number };
  firstLook: { reports30d: number; looked30d: number; medianMinutes: number | null; maxMinutes: number | null };
  cases: { open: number; mineOpen: number };
  capture: Capture;
  quota: { readsToday: number; perDay: number };
}
export interface ReportRow { id: string; kind: ReportKind; status: ReportStatus; receivedAt: string; ageMinutes: number; seenAt: string | null; firstLookMinutes: number | null; school: { code: string; name: string } | null; lessonId: string; platform: string | null; openCaseId: string | null }
export interface CaseRow { id: string; reportId: string | null; kind: ReportKind | null; school: { code: string; name: string } | null; openedByName: string; openedAt: string; status: 'open' | 'closed'; outcome: CaseOutcome | null; closedAt: string | null }
export interface CaseDetail extends CaseRow { reason: string; closeReason: string | null; closedByName: string | null; reportStatus: ReportStatus | null; receivedAt: string | null; reads: { at: string; staffName: string; what: 'report' | 'context'; reason: string }[] }
export interface CaseReport { caseId: string; readsLeftToday: number; report: { id: string; kind: ReportKind; status: ReportStatus; note: string; lessonId: string; topicRef: string | null; beatId: string | null; spokenLine: string | null; platform: string | null; release: string | null; at: string; receivedAt: string; school: { code: string; name: string } | null } }
export interface CaseContext { caseId: string; readsLeftToday: number; class: { id: string; title: string; status: string; version: number } | null; sitting: { source: string; startedAt: string; endedAt: string | null; activeMinutes: number | null } | null; sameLesson: { reports: number; unsafe: number } }
export interface ReadLogRow { at: string; staffName: string; staffRole: string; caseId: string; reportId: string | null; what: 'report' | 'context'; reason: string }
export interface SafetyClient {
  overview(): Promise<SafetyOverview>;
  reports(f?: { status?: ReportStatus; kind?: ReportKind; school?: string; limit?: number }): Promise<{ rows: ReportRow[]; more: boolean }>;
  mark(i: { reportId: string; status: 'seen' | 'triaged' | 'closed' } & Write): Promise<void>;
  openCase(i: { reportId: string } & Write): Promise<{ caseId: string }>;
  caseReport(caseId: string): Promise<CaseReport>;
  caseContext(caseId: string, reason: string): Promise<CaseContext>;
  closeCase(i: { caseId: string; outcome: CaseOutcome } & Write): Promise<void>;
  cases(openOnly?: boolean): Promise<CaseRow[]>;
  caseDetail(caseId: string): Promise<CaseDetail>;
  readLog(limit?: number): Promise<ReadLogRow[]>;
  setCaptureSince(i: { on: string } & Write): Promise<void>;
}
export function createSafetyClient(t: AdminTransport): SafetyClient;

// classes.ts
export type ClassStatus = 'pending' | 'published' | 'retracted';
export interface ClassCost { inr: number; liveInr: number; warmInr: number; unpriced: boolean; calls: number; sittings: number }
export interface ClassReports { total: number; open: number; unsafe: number }
export interface ClassRow { id: string; topicRef: string; title: string; subtitle: string | null; klass: number; subject: string; status: ClassStatus; createdAt: string; publishedAt: string | null; version: number; reports: ClassReports; cost: ClassCost; lastAction: { action: string; byName: string; at: string } | null }
export interface RemovedClassRow { id: string; topicRef: string; title: string; removedAt: string; byName: string; reason: string; reports: ClassReports }
export interface ClassDetail { live: ClassRow | null; removed: RemovedClassRow | null; reportsByKind: Record<'wrong' | 'rude' | 'unsafe' | 'other', number>; reportsByStatus: Record<'new' | 'seen' | 'triaged' | 'closed', number>; history: { action: string; byName: string; at: string; reason: string; files: number | null }[]; filesInStorage: number }
export interface ClassesClient {
  list(status?: ClassStatus): Promise<ClassRow[]>;
  removed(): Promise<RemovedClassRow[]>;
  detail(id: string): Promise<ClassDetail>;
  publish(i: { classId: string } & Write): Promise<void>;
  remove(i: { classId: string; action: 'retract' | 'reject' } & Write): Promise<{ classId: string; removed: number }>;   // admin-api 'class-remove'
}
export function createClassesClient(t: AdminTransport, api: AdminApiCaller): ClassesClient;

// privacy.ts
export type Fiduciary = 'undecided' | 'school' | 'qrie';
export type Recipient = 'undecided' | 'school' | 'parent' | 'school-and-parent';
export interface SchoolPrivacyRow { code: string; name: string; fiduciary: Fiduciary; recipient: Recipient; basis: string | null; decidedAt: string | null; decidedByName: string | null; importBlocked: boolean }
export type RequestStatus = 'received' | 'verified' | 'erasing' | 'erased' | 'refused';
export interface ErasureRow { id: string; receivedOn: string; dueOn: string; daysLeft: number; channel: string; requester: string; reference: string; subjectKind: 'school-student' | 'direct'; school: { code: string } | null; loginId: string | null; status: RequestStatus }
export interface ErasureDetail extends ErasureRow { displayName: string | null; left: boolean | null; verifiedHow: string | null; verifiedByName: string | null; refusedReason: string | null; tallies: unknown; preview: { rows: Record<string, number>; photos: number; activityLogLines: number } | null }
export interface RetentionRow { what: string; tables: string[]; holds: string; kept: string; enforcedBy: string; job: { name: string; schedule: string; lastStatus: string } | null }
export interface RetentionTruth { rows: RetentionRow[]; contest: { purgeOn: string | null; purgedAt: string | null }; distressCapture: Capture }
export interface PrivacyClient {
  schools(): Promise<SchoolPrivacyRow[]>;
  setSchool(i: { code: string; fiduciary: Fiduciary; recipient: Recipient; basis: string } & Write): Promise<void>;
  requests(openOnly?: boolean): Promise<ErasureRow[]>;
  request(id: string): Promise<ErasureDetail>;
  intake(i: { channel: string; requester: string; reference: string; receivedOn: string; code?: string; loginId?: string; userId?: string } & Write): Promise<{ requestId: string }>;
  verify(i: { requestId: string; how: string } & Write): Promise<void>;
  refuse(i: { requestId: string } & Write): Promise<void>;
  erase(i: { requestId: string } & Write): Promise<{ requestId: string; rows: Record<string, number>; photos: number; activityLogLines: number }>;   // admin-api 'erase'
  retention(): Promise<RetentionTruth>;
  setContestPurge(i: { on: string } & Write): Promise<void>;
}
export function createPrivacyClient(t: AdminTransport, api: AdminApiCaller): PrivacyClient;
```

Every call goes through `guard` (`read.ts`); dates through `day`, numbers through `num`.

- [ ] **Step 1: Write the failing tests** (end to end as `schools.test.ts:1-40` does: `pgliteAdminTransport(db, claims)` and `replyCaller(handleAdminApi(... apiWorld ...))`): (1) `safety: the overview, the list without notes, a case opened, read once and closed`; (2) `a refusal is a typed AdminError: a stale owner opening a case is needs-mfa; ops reading the list is not-allowed`; (3) `classes: list, publish, retract through admin-api`; (4) `privacy: a school's decision, an intake, a verify and an erasure through admin-api`; (5) `the retention truth is typed and its jobs are named`.
- [ ] **Step 2: Run** `npx vitest run packages/admin-client/tests/safety-classes-privacy.test.ts` → FAIL (exports missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run packages/admin-client` → PASS. `npm run typecheck` → no errors (no name in the three modules collides with another module's export; `ReportKind` is not exported elsewhere in `admin-client`: checked with `git grep -n "ReportKind" packages/admin-client`).
- [ ] **Step 5: Commit**

```powershell
git add packages/admin-client
Commit "feat: a typed client for the safety, classes and privacy functions and admin-api's two routes"
```

---

### Task 12: Console helpers and the nav field (T7)

**Files:** Create `apps/admin/src/features/safety/model.ts`, `features/classes/model.ts`, `features/privacy/model.ts`, `apps/admin/tests/{safety,classes,privacy}-model.test.ts` (relative imports only; the root `@` alias points at `apps/lms/src`); modify `apps/admin/src/components/layout/types.ts` (`BaseNavItem` gains `roles?: Me['role'][]`, `import type { Me } from '@ai-tutor/admin-client'`, with the comment "Which staff roles see this item; absent means every role. Plan 4 filters the sidebar by it.").

```ts
// safety/model.ts
export const STATUS_LABEL: Record<ReportStatus, string>;          // new 'Unread', seen 'Read', triaged 'Triaged', closed 'Closed'
export const KIND_LABEL: Record<ReportKind, string>;              // 'Something wrong', 'Upsetting', 'Unsafe', 'Other'
export const OUTCOME_LABEL: Record<CaseOutcome, string>;          // 'No action needed', 'Content fixed', 'Disclosed to the agreed person', 'Referred onward', 'Other'
export interface SafetyRights { readList: boolean; openCase: boolean; mark: boolean; closeCase: boolean; captureSince: boolean; readLog: boolean }
export function safetyRights(role: Me['role']): SafetyRights;     // owner all; safety all but captureSince and readLog; ops and finance none
export function ageText(minutes: number): string;                 // '12 min', '3 h', '2 days'
export function captureText(c: Capture): { tone: 'grey' | 'ok'; text: string }; // not-captured → grey 'Not captured'; captured → ok '<n> in 7 days, captured since <date>'
export function nextStatuses(s: ReportStatus): ('seen' | 'triaged' | 'closed')[];
export function blastOpenCase(r: ReportRow): string;
export function blastCloseCase(outcome: CaseOutcome, schoolCode: string | null): string;

// classes/model.ts
export interface ClassRights { read: boolean; publish: boolean; retract: boolean; reject: boolean }
export function classRights(role: Me['role']): ClassRights;       // owner all; ops read, retract, reject; safety read; finance none
export function costText(c: ClassCost): { tone: 'grey' | 'ok'; text: string };   // no calls → grey 'No sittings recorded'; unpriced → 'At least ₹x'; else '₹x'
export function blastPublish(c: ClassRow): string;
export function blastRemove(c: ClassRow, action: 'retract' | 'reject'): string;

// privacy/model.ts
export interface PrivacyRights { requests: boolean; intake: boolean; verify: boolean; refuse: boolean; erase: boolean; decideSchool: boolean; retention: boolean; contestPurge: boolean }
export function privacyRights(role: Me['role']): PrivacyRights;   // owner all; ops requests, intake, verify, retention; safety retention; finance none
export const FIDUCIARY_LABEL: Record<Fiduciary, string>;          // 'Not decided', 'The school', 'Qrie'
export const RECIPIENT_LABEL: Record<Recipient, string>;          // 'Not decided', 'The school', 'The parent', 'The school and the parent'
export function dueTone(daysLeft: number, status: RequestStatus): 'grey' | 'ok' | 'warn' | 'bad'; // closed grey; >7 ok; 0..7 warn; <0 bad
export function blastErase(d: ErasureDetail): string;
export function blastSchoolPrivacy(code: string, f: Fiduciary, r: Recipient): string;
export function blastContestPurge(on: string): string;
```

Blast lines (exact): open case: `You will see this child's words. The opening is recorded with your reason, and counts against today's 30 reads. Close your case when you are done: you can hold one at a time.`; close: `The case and its report are closed.` plus, for `disclosed`, ` Record here only that the agreed person at <code> was told; their name and number stay in the school's contacts.`; publish: `<title> becomes visible to every student who opens <topicRef>. Who published it and why is kept.`; retract: `<title> disappears from the catalogue now and its files are deleted from Storage. A student who opens this topic next prepares it again, and that new class is shared when it is kept. Its reports stay.`; reject: `<title> is never shown. Its files are deleted from Storage.`; erase: `Every record of <displayName or 'this user'> is deleted for good: <n> rows in <m> tables, <p> photos, and their login ID in <s> lines of the school's activity log. Staff logs keep the request and its ids. This cannot be undone.`; school privacy: `<code>'s decision is recorded. <'People can be added to this school.' | 'Nobody can be added to this school until both are decided.'>`; contest purge: `On <on>, the names, phone numbers, addresses, cities and schools in every contest entry made before that day are cleared for good. Class, campaign and the date stay, for counts.`

- [ ] **Step 1: Write the failing tests**: per model file, rights by role (4 roles), labels for every enum value, `captureText` never answers a bare zero for not captured, `costText`'s three states, `dueTone`'s four, each blast line's exact text for one example.
- [ ] **Step 2: Run** `npx vitest run apps/admin/tests/safety-model.test.ts apps/admin/tests/classes-model.test.ts apps/admin/tests/privacy-model.test.ts` → FAIL (modules missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run apps/admin` → PASS; `npx tsc -p apps/admin/tsconfig.json --noEmit` → no output.
- [ ] **Step 5: Commit**

```powershell
git add apps/admin/src/features/safety/model.ts apps/admin/src/features/classes/model.ts apps/admin/src/features/privacy/model.ts apps/admin/src/components/layout/types.ts apps/admin/tests/safety-model.test.ts apps/admin/tests/classes-model.test.ts apps/admin/tests/privacy-model.test.ts
Commit "feat: console helpers for safety, classes and privacy: labels, rights by role, blast lines; nav items can name their roles"
```

---

### Task 13: The Safety, Classes and Privacy pages

**Files:** Create `apps/admin/src/features/safety/{index,case-page,reason-dialog}.tsx`, `features/classes/{index,class-page}.tsx`, `features/privacy/{index,request-page}.tsx`; modify `apps/admin/src/router.tsx`, `apps/admin/src/components/layout/data/sidebar-data.ts`, `apps/admin/src/lib/client.ts`

`lib/client.ts` gains `export const safety = createSafetyClient(rpc); export const classes = createClassesClient(rpc, api); export const privacy = createPrivacyClient(rpc, api);`. Routes: `/safety`, `/safety/cases/$caseId`, `/classes`, `/classes/$classId`, `/privacy`, `/privacy/requests/$requestId`. Sidebar group `Safety and privacy` after `Platform` and before `Billing`: `{ title: 'Safety', url: '/safety', icon: ShieldAlert, roles: ['owner', 'safety'] }`, `{ title: 'Classes', url: '/classes', icon: BookOpen, roles: ['owner', 'ops', 'safety'] }`, `{ title: 'Privacy', url: '/privacy', icon: Lock, roles: ['owner', 'ops'] }` (icons measured in lucide-react 1.39.0).

Every page is `<AdminPage title=...>`, loads through `useLoad` and `LoadView` (loading skeletons; refused: "Your role cannot see this."; error with Try again; ready). Buttons a role may not use are not rendered (the model's rights); the database refuses anyway. Every write is a `WriteDialog` (reason, typed environment, blast line, `guarded` where the function needs a fresh code).

| Page | Shows | Actions (rights) | Empty |
|---|---|---|---|
| Safety `/safety` | Tiles: Unread (red when any unsafe unread), Oldest unread (`ageText`), Time to first look (median and slowest, 30 days), Open cases, Distress flags (`captureText`; grey "Not captured" with "Capture is not live yet, or no flag has arrived." beneath), Reads today (n of 30). Reports table: kind, status (`STATUS_LABEL`), received, age, first look, school code or "Direct", lesson, case. No note column exists. Filters: status, kind. Cases table (open first): kind, school, opened by, opened, status, outcome. Owner only: Read log table (when, who, role, case, what, reason). | Mark read / triaged / closed (mark: `nextStatuses`); Open case (openCase; guarded; `blastOpenCase`; on success go to the case page); Record the day capture went live (captureSince: date field) | `No reports yet.` / `No cases yet.` |
| Case `/safety/cases/$caseId` | The case (opened by, when, its reason, status). **Read the report** button: each press calls `caseReport` once and shows the words in a bordered box with the tutor's line, lesson, beat, platform, build and times, and "This reading was recorded. <n> reads left today."; the words are kept only in the page's state and cleared when leaving. **Look at the context** opens `reason-dialog.tsx` (a reason, then `caseContext`). The case's reads (when, who, what, reason). | Close the case (closeCase: outcome select with `OUTCOME_LABEL`; `blastCloseCase`; the database refuses `disclosed` until the school's recipient is decided, and the page says why) | n/a |
| Classes `/classes` | Tabs Waiting for review, Published, Removed: title, class and subject, created, published, version, reports (open / unsafe; red when unsafe open), cost (`costText`), last action | Publish (publish: owner; guarded; `blastPublish`); Retract (retract; guarded; `blastRemove`); Reject (reject; guarded; `blastRemove`) | `Nothing is waiting for review. A class is shared as soon as it is kept, until the review-first setting exists.` / `No classes kept yet.` / `No class has been removed.` |
| Class `/classes/$classId` | The class, its cost (total, preparing, serving, sittings, "at least" when unpriced), reports by kind and by status (counts only), files in Storage, history (action, who, when, reason, files) | the same actions as its row | n/a |
| Privacy `/privacy` | Section **Erasure requests**: table (received, due with `dueTone`, channel, from, reference, school or Direct, login ID, status) with an "Open only" switch. Section **Schools**: every school's fiduciary, recipient, basis, decided by and when, and "Import blocked" (red) or "Import open". Section **What is kept**: the retention truth table (what, where, holds, kept, enforced by, job's last run) and "Contest purge: <date or 'not set'>; last cleared <when>". | New request (intake: owner, ops: channel, from, reference, received date, and either school code + login ID or a direct user's ID); Record a decision (decideSchool: owner; guarded; fiduciary, recipient, basis; `blastSchoolPrivacy`); Set the purge date (contestPurge: owner; guarded; `blastContestPurge`) | `No erasure requests.` |
| Request `/privacy/requests/$requestId` | The request; the child's name for a school student and whether they have left; what would be erased (`preview` rows by table, photos, activity-log lines), or what was erased (`tallies`) | Verify (verify: how select); Refuse (refuse: owner); **Erase** (erase: owner; guarded; destructive; `blastErase`; an extra field "Type the login ID (or the user ID) to confirm" that must match before Confirm is enabled) | n/a |

The Erase button exists on this page only; no other page has a delete or erase control.

- [ ] **Step 1: Routes, sidebar group and client lines.**
- [ ] **Step 2: The pages, as the table says.**
- [ ] **Step 3: Typecheck and build**

```powershell
npx tsc -p apps/admin/tsconfig.json --noEmit
$env:VITE_SUPABASE_URL='http://127.0.0.1:54321'; $env:VITE_SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlc2lnbmF0dXJl'; $env:VITE_ADMIN_ENV='TEST'
npm run admin:build
Remove-Item -Recurse -Force apps/admin/dist
```

Expected: no type errors; Vite builds; the scan ends `No secret found in N built files.`

- [ ] **Step 4: Browser check (needs a Supabase project with 0001 to 0069, the `admin` schema exposed, an owner and a safety member; UNVERIFIED until then):** as safety, Safety lists a seeded report with no words; Open case asks for a fresh code; Read the report shows the words once and the counter falls; Close; as ops, Safety shows "Your role cannot see this." and Classes offers Retract only; as owner, Privacy records a school's decision and erases a seeded child.
- [ ] **Step 5: Commit**

```powershell
git add apps/admin/src
Commit "feat: console pages for safety (reports, cases, read log), classes (review, retract, reject) and privacy (erasure, schools, what is kept)"
```

---

### Task 14: The student app: a report button and the helplines

**Files:** Create `apps/student/src/lib/report.ts`, `apps/student/src/features/help/help-sheet.tsx`, `apps/student/tests/report.test.ts`; modify `apps/student/src/components/shell.tsx` (a `LifeBuoy` button with `aria-label='Help'` in the header beside Sign out, opening `HelpSheet`), `apps/student/vite.config.ts` and `apps/student/tsconfig.app.json` (an `@ai-tutor/safety` alias and path to `../../packages/safety/src/index.ts`, beside `lms-client`'s)

```ts
// apps/student/src/lib/report.ts (pure; tested)
import { HELPLINES, redact, screen } from '@ai-tutor/safety';
import type { ProblemKind, ProblemPlace, ProblemReport } from '@ai-tutor/lms-client';
export const MAX_NOTE = 500;
export const REASONS: { id: ProblemKind; label: string }[];   // wrong 'Something here is wrong', rude 'Something here upset me', unsafe 'Something here does not feel safe', other 'Something else'
export const HELPLINE_LINES: { name: string; number: string; what: string }[]; // Tele-MANAS HELPLINES.telemanas 'free, any time, someone will listen'; Childline HELPLINES.childline 'if someone is hurting you'
export function placeOf(pathname: string): { where: ProblemPlace; itemId: string | null }; // '/' home; '/work' work; '/homework/<uuid>' homework + id; '/learn/practice' practice; '/learn' learn; '/progress' progress; '/notices…' notices; anything else home
export function prepareReport(i: { reason: ProblemKind; note: string; pathname: string; now: Date; release: string | null; platform: 'web' | 'android' }): { report: ProblemReport; why: 'support' | 'redirect' | null };
```

`prepareReport`: the note is `screen(note, 'from-student', {limit: MAX_NOTE})`; `allow`/`clean` → its text; `support`/`redirect` → `redact(note, 'from-student', {limit: MAX_NOTE}).text` (the classroom's `noteThatMayTravel`, `ReportSheet.tsx:198-209`); `kind` is `unsafe` when `why === 'support'`, else the reason; `at = now.toISOString()`, stamped once per Send so a retry from the same open sheet sends the same `at`.

`HelpSheet({ open, onOpenChange, canReport })` (AlertDialog): the helplines first, always, as `tel:` links; then, when `canReport` (`me.kind === 'student'`), "Tell us about a problem": the four reasons (radio), an optional note (`<textarea maxLength={500}>`, "Phone numbers and email addresses are taken out before it is sent."), Send. Outcomes: sent → "Sent to the people who look after this app. Somebody will read it." (plus, when `why === 'support'`, "Somebody reading this is not the same as somebody helping you. Please tell an adult you trust today." first); failed → the server's message when it is one of `lms.report_problem`'s sentences, else "This did not send, and nothing was kept on this phone. Try again, or tell a teacher." with Try again (same `at`). The note lives only in the sheet's state and is cleared when the sheet closes (ruling R25). Platform: `'android'` when `(globalThis as { Capacitor?: { isNativePlatform?(): boolean } }).Capacitor?.isNativePlatform?.()` is true, else `'web'` (UNVERIFIED on the Android build); release `import.meta.env.VITE_RELEASE ?? null`. Sending calls `api.reportProblem(report)`.

- [ ] **Step 1: Write the failing tests** (`apps/student/tests/report.test.ts`, relative imports): (1) `places: home, work, a homework with its id, practice, learn, progress, notices, and anything else is home`; (2) `a phone number and an email address are taken out of the note`; (3) `a note the screen reads as distress is still scrubbed and travels, filed as unsafe`; (4) `a redirect keeps the child's reason and scrubs the note`; (5) `the note is cut to 500 characters`; (6) `the helplines are Tele-MANAS 14416 and Childline 1098, from the safety package`.
- [ ] **Step 2: Run** `npx vitest run apps/student/tests/report.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement the module, the sheet and the header button.**
- [ ] **Step 4: Run** `npx vitest run apps/student` → PASS (6 new + the existing). `npx tsc -p apps/student/tsconfig.app.json --noEmit` → no output. Build: `npm run build --workspace @ai-tutor/student`, then `Remove-Item -Recurse -Force apps/student/dist` → builds.
- [ ] **Step 5: Commit**

```powershell
git add apps/student/src/lib/report.ts apps/student/src/features/help/help-sheet.tsx apps/student/src/components/shell.tsx apps/student/vite.config.ts apps/student/tsconfig.app.json apps/student/tests/report.test.ts
Commit "feat: the student app's Help: the helplines, and a report that is scrubbed on the phone and kept nowhere on it"
```

---

### Task 15: Runbook, counsel questions, README, and the whole gate

**Files:** Modify `docs/ops/admin-console.md` (append `## 8. Safety, classes and privacy (plan 5)`; plan 4 appends section 7 on its branch and merges first), `apps/admin/README.md` (one paragraph: the three pages, the case page, the request page, that the Erase button exists only there)

- [ ] **Step 1: Write section 8** with: **Who may do what** (spec section 3 as built: safety reads the report list and opens one report at a time with a case; ops retracts and rejects classes (with a fresh code) and works erasure requests but never sees a child's words; the owner publishes, erases, records a school's decision and sets the purge date; finance none of it); **Setup, once (Aarav's steps)** exactly as "Aarav's steps" below, with the line **"Nothing in `apps/classroom`, `packages/relay` or `supabase/functions/relay` may be deployed from this branch until it is merged with `phase3-completion` and `voice-stt-tts` (the live relay has 743c05a, 1dcfcfe and 18733af, which this branch does not)."**; **Day to day** (the Safety page every morning; an unsafe unread report or a distress alert in the safety chat means open the page now; work one case at a time; record a disclosure as `disclosed` only after telling the agreed person; erasure requests by due date); **If something goes wrong** (a class that must vanish now: Retract, then check "files in Storage" reads 0; if Retract answers that Storage did not remove the files, press again; cached copies may be served by Storage's CDN for up to its cache lifetime (UNVERIFIED); an erasure that stops with photos left: press Erase again; the read quota reached on a busy day: the next India day resets it, or change the constant in a reviewed migration; a contest entrant who corrects their entry after the purge day puts their details back until the next night's purge clears them again); **What the panel will never do** (show a child's words in a list or an alert; keep a child's id with a distress flag; export reports; erase from any page but a verified request; delete a class's row before its files); **Questions for counsel** (the list below).
- [ ] **Step 2: The whole gate**

```powershell
npm run typecheck
$env:VITE_SUPABASE_URL='http://127.0.0.1:54321'; $env:VITE_SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlc2lnbmF0dXJl'; $env:VITE_ADMIN_ENV='TEST'
npm run admin:build
Remove-Item -Recurse -Force apps/admin/dist
npm run build --workspace @ai-tutor/student
Remove-Item -Recurse -Force apps/student/dist
$env:VITE_SUPABASE_ANON_KEY='test-anon'
npx vitest run --exclude "tools/measure/**" --exclude "**/node_modules/**" *> "$env:TEMP\qrie-safety-suite.txt"
Get-Content "$env:TEMP\qrie-safety-suite.txt" -Tail 40
```

Expected: typecheck clean; both builds pass (the console's ends with the secret scan); the suite (12 to 20 minutes) ends with every file passing. Known flakes, not this plan's: `tools/lms-demo/tests/brain.test.ts` and `apps/classroom/tests/reportReplay.test.ts`; if one fails, rerun it alone and report both runs. `Select-String -Path "$env:TEMP\qrie-safety-suite.txt" -Pattern 'safety|case|classes|privacy|erasure|flag'` shows only passes.

- [ ] **Step 3: Scan for words where they must not be**

Run: `git grep -n -I -E "\bnote\b" -- apps/admin/src/features/safety/index.tsx apps/admin/src/features/classes apps/admin/src/features/privacy`
Expected: no match (the note appears only in `case-page.tsx`).

- [ ] **Step 4: Commit, then finish the branch**

```powershell
git add docs/ops/admin-console.md apps/admin/README.md
Commit "ops: safety, classes and privacy runbook, the deploy hold on the tutor code, and the questions for counsel"
```

Then use superpowers:finishing-a-development-branch. Pushing, `supabase db push` and deploying are Aarav's steps.

---

## Merge notes (plan 4 merges first, then this branch)

Checked on 2026-10-08 against plan 4's document (`.claude/worktrees/admin-wiring/docs/superpowers/plans/2026-10-08-super-admin-app-wiring.md`, as corrected by the wave-2 cross-check). Each note says what the merge does; none needs a decision.

1. **Migrations and T2.** Order: plan 4's 0062, 0063, 0064, then 0065 to 0069, then the merge's own **0070** (note 4). Plan 4's **0063** creates `admin.privacy_import_refusal(p_org uuid)` as a stub returning NULL, revoked from `public, anon, authenticated, service_role`, and calls it last from `admin.import_refusal` (after offboarded, then suspended or ended). 0066 replaces it with `create or replace`, same signature; `create or replace` keeps the ACL, and 0066's own revoke names the same four roles. After the merge add one test to `supabase/tests/admin-school-privacy.test.ts` (it runs on HOSTED): for an undecided school, `admin.import_refusal(org)` returns 0066's sentence and `admin.api_gate('people-import', <code>, '', 'term starts', 'HOSTED')` as `fresh(owner)` rejects with it; once both decisions are recorded, `admin.import_refusal(org)` is NULL. Every LMS-lane path asks `lms.import_refusal` (plan 4 Task 4: `importForSchool`, `importForAdmin`, and the founder's CLI through `applyPlan`'s `store.mayImport`, plan 4's R24), so the privacy gate covers all of them with no change here.
2. **Import tests after the merge.** The gate answers NULL unless the environment is HOSTED or STAGING (R13). Every existing import test runs on `setEnvironment`'s default `TEST` or an UNSET database (searched 2026-10-08: the only `HOSTED` mentions in `supabase/tests`, `tools/*/tests` and `packages/*/tests` are wrong-environment refusals), so plan 2's, plan 4's and the LMS lane's import tests are unaffected.
3. **`public.alert_snapshot`.** Plan 4 does not touch it (its Interfaces list says so). 0065's body (0051's plus `distressFlags15m`) stands after the merge.
4. **`admin.today()`: the merge writes 0070.** Plan 4's 0062 replaces `admin.today()` (the contest from `admin.contest_rules()`, `contest.entriesOpen`); this branch does not touch it, so after the merge Today still says `capture.distress = 'not-captured'` even once flags arrive, which is untrue (spec section 12's "grey 'not captured', never a green zero" cuts both ways). `supabase/migrations/0070_admin_wave2_merge.sql` (the next free number, as 0061 was for wave 1): `create or replace function admin.today()` copied line for line from **0062's** body (not 0049's: it must keep plan 4's contest lines), with only the capture object changed to `'capture', jsonb_build_object('distress', admin.distress_capture() ->> 'state', 'lastPurge', 'not-captured')` (`lastPurge` stays `'not-captured'`: no job records a purge time yet; the header says so), and the same revoke and grant. Test first, in `supabase/tests/admin-wave2-merge.test.ts`: `today().capture.distress` is `'not-captured'` on a fresh database and `'captured'` after one `keepFlag`; `today().contest` still carries `entriesOpen` and the switch's `dailyCap`. `admin-today.test.ts:61` stays as it is (a fresh database is still not captured).
5. **`admin.school_health_for`.** Plan 4 does not touch it; 0067's DO block finds 0052's literal and replaces it.
6. **`public.claim_relay` and the free routes: resolved, no fix needed.** Plan 4's 0064 refuses a learner whose school has the tutor off (or is suspended, or the platform's switch is off) with reason `'halted'` and `retry_after` 300, for every `p_relay` and every `p_units`, including `report` and `flag` at zero units, inserted right after the halted arm and before the per-minute window. `admitFree` exempts `halted` for `report` and, after Task 2, `flag`, so reports and distress flags from such a school are still kept. The one consequence is the one the global halt already has (`gate.ts:322-328`): those two routes skip the per-minute window for that school's children. A `flag` claim needs no SQL change (`claim_relay` does not check `p_relay`; `relay_usage` is per user).
7. **`packages/lms-client`: both plans edit it.** Plan 4 adds `src/app-config.ts`, one `export * from './app-config.ts';` in `index.ts`, `schoolBilling` in `api.ts` (beside `schoolLicence`), `appConfig` in `backend.ts` and `schema('lms' | 'public')` in `transport.ts`; this branch adds `src/report.ts`, one export line and `reportProblem` in `createLmsClient`. Keep both sides of `index.ts` and `api.ts`. The LMS lane edits the same package on its own branch: at the next merge with `lms`, keep all three.
8. **Shared files (T8) and the other files both plans touch.**
   - `supabase/tests/admin-invariants.test.ts`: the `authenticated` list is Task 9's list plus plan 4's `'admin.stop_status'` between `'admin.staff_set'` and `'admin.system_health'` (C collation: `sta` < `sto` < `sy`); the public-schema test is plan 4's (`alert_snapshot, app_config, audit_head, my_app_config`, "four functions"); the service-role list and the new internals test are this branch's. `supabase/tests/lms-invariants.test.ts`: plan 4 adds `'import_refusal(p_org uuid)'` to `internal`; this branch adds nothing there (`lms.report_problem` is meant for `authenticated` and is revoked from `anon`).
   - `apps/admin/src/components/layout/types.ts`: one `roles?: Me['role'][]` with plan 4's comment; drop this branch's duplicate. `sidebar-data.ts`: plan 4's roles on every item and its Apps item, plus this branch's `Safety and privacy` group between Platform and Billing. `router.tsx`: both sides' routes. `apps/admin/tests/nav.test.ts` (plan 4's) changes with the group: ops also sees Classes and Privacy; safety sees exactly `['Today', 'Schools', 'Switches', 'Apps', 'System', 'Your account', 'Safety', 'Classes']`; finance and owner unchanged.
   - `packages/admin-client/src/index.ts` (this branch's three lines; plan 4 leaves it), `apps/admin/src/lib/client.ts` (this branch's three lines; plan 4 leaves it), `apps/admin/README.md` (both paragraphs), `docs/ops/admin-console.md` (plan 4's corrected sections 2 and 5 step 8 and its section 7, then this branch's section 8).
   - `apps/classroom/src/App.tsx`: plan 4 adds `useAppConfig();` and wraps `<Gate>` in `<AppConfigGate>`; this branch adds `useEffect(() => startDistressCapture(), []);` beside `useReportReplay();`. Keep both; the capture effect stays in `App()`, above the gate, so flags are still sent while plan 4's pause or update card is shown.
   - `apps/student`: plan 4 changes `src/routes/__root.tsx` (its `AppGate`) and `package.json` (0.1.0); this branch changes `src/components/shell.tsx` (the Help button), `vite.config.ts` and `tsconfig.app.json` (the `@ai-tutor/safety` alias). No file is changed by both. Plan 4's update screen (`src/components/app-notices.tsx`) replaces every screen, Help included: at the merge, add this branch's `HELPLINE_LINES` (`src/lib/report.ts`) under its Reload button, as plan 4's R25 does for the tutor, with one assertion in plan 4's `apps/student/tests/app-notices.test.tsx` test 5 (`tel:14416`, `tel:1098`).
   - `tools/admin-api`: plan 4 changes `tools/lms-import/src/admin.ts`, `apply.ts` and `supabaseStore.ts` and adds a test to `tools/admin-api/tests/handle.test.ts`; it does not change `handle.ts`, `deps.ts` or `supabase/functions/admin-api/index.ts`, which are this branch's.
9. **The contest (T9).** Plan 4's `record_contest_signup` lets an entrant who is already in correct their entry even when entries are closed or the day is full (its R10). After the purge day, such a correction writes personal fields back into a cleared row; the next run of `admin-privacy-daily` clears it again (the purge re-clears every entry created before the purge day that holds any of them). Runbook section 8 says so; nothing else changes.
10. **The tutor code.** Before any deploy of the relay or `apps/classroom`, merge this branch's `packages/relay/src/safetyFlag.ts`, its hook-ins, and `apps/classroom/src/lib/distressCapture.ts` with its hook-ins into the live branches (which carry 743c05a, 1dcfcfe, 18733af), together with plan 4's classroom files, and run `npx vitest run packages/relay apps/classroom` there.
11. After merging, run the whole gate (Task 15 Step 2) on the merged branch, then plan 4's Task 14 Step 3 `git grep` check.

## Aarav's steps (only he can do these)

1. **Name the backup safety reviewer** and add them on Staff and audit with the role `safety` (plan 2's invitation flow). Without one, reports wait for you alone.
2. **Ask counsel** the questions below. Until the answers come, every school's decision stays "Not decided" and, on the hosted database, nobody can be added to a school.
3. **Apply the migrations** (after plan 4's): `npx supabase db push` applies 0065 to 0069 with the rest. Nothing new to expose: the functions are in `admin` (already exposed) and `lms.report_problem` in `lms`.
4. **Redeploy `admin-api`** for its two new routes: `npx supabase functions deploy admin-api --no-verify-jwt`. No new secret.
5. **Do not deploy the relay or the tutor app from this branch.** After this branch is merged with `phase3-completion` and `voice-stt-tts` (merge note 9), deploy the relay with `npm run relay:deploy` and the tutor app as usual; then, on the Safety page, **record the day capture went live** (until a flag arrives or you record it, the page says "Not captured").
6. **Record each school's decision** on the Privacy page once counsel answers (fiduciary, who is told, and what it rests on, for example "counsel's letter of <date>").
7. **Set the contest purge date** on the Privacy page once prizes are posted.
8. **Decide (no build needed now):** whether a trial child's distress is captured (ruling R4: now it is not, because the trial page promises nothing leaves); whether new classes wait for review before anyone sees them (ruling R15: now they are shared when kept); the privacy page's line "Class and usage records are deleted automatically after 90 days" (`landing/app/privacy/page.tsx:80`), which the What is kept table shows is not true: class and answer records and usage rows are kept until the account is erased (the nightly purge deletes no class or answer event until the server fold sets `purge_safe_before`, 0021).

**Questions for counsel** (also in the runbook):
1. For a school's children, is the school the data fiduciary or Qrie (or both, for different purposes)?
2. Who receives a distress disclosure: the school's designated person, the parent, both, someone else? May Qrie tell them which child, and how do we verify them?
3. May any child's words be kept (a report's note), for how long, and may Qrie's safety reviewer read them? The same for the tutor's line saved beside a report.
4. Retention windows for each row of "What is kept", in particular reports, usage rows that carry a user id, the phone numbers codes were sent to, consent records and contest entries.
5. Is a distress flag with a school and a time but no child id "tracking or behavioural monitoring" under DPDP s.9(3)? Is a count per school allowed?
6. Erasure: the timeline, the verification a parent's request needs, whether staff logs (which keep ids and login IDs) must be scrubbed too, and what happens to a school's data when its licence ends.
7. May a trial child's distress be captured even though the trial page says nothing about them is kept?
8. May a parent file a report on a child's behalf? When a child is erased, does the parent's own sign-in stay?

## UNVERIFIED

- Everything on a hosted project: none of 0065 to 0069 has been applied there; `pg_cron` running `admin-privacy-daily` at 19:45 UTC (the harness records the schedule only).
- The Storage API call `DELETE /storage/v1/object/{bucket}` with `{prefixes}` and its answer (the shape supabase-js's `remove()` uses); whether Supabase's CDN keeps serving a public class file after it is deleted, and for how long; whether the hosted `storage.objects` lets a definer function read it (0025's `lms.submit_photos` does the same, also not run on hosted).
- Deleting `auth.users` from a definer function on the hosted project (0002's `delete_own_account` does the same, not run there by this plan), and what hosted Auth tables cascade with it.
- That a report's `lesson_id` equals the kept class's `id` (ruling R17); reports made outside a kept class match nothing.
- That the classroom's distress hook works in this older tutor code once ported to the live branches; nothing in `apps/classroom` or the relay has been run against a deployed relay.
- The student app's Android detection (`window.Capacitor`); the help sheet in a phone browser.
- The console pages in a real browser (fresh-code prompt on Open case and Erase, the words cleared on leaving the case page).
- `percentile_cont` on hosted Postgres (it runs on PGlite).
- The tests' `Expected` counts are this document's numbered tests; nothing here has been run.

## Rulings (decisions the spec did not settle, each with its cost if wrong)

- **R1** A distress flag holds category, direction (the child's words or the tutor's line), the school (school organisations only), platform, build and two times; no user id, session, lesson or words. Cost: nobody can be told which child, only that a child at a school (or a direct user) may be in distress; if counsel allows a link, a column and a case path are added later.
- **R2** Only `distress` is captured; redirect and cleaned flags stay on the device. Cost: no server view of off-limits questions or masked details.
- **R3** Flags travel by a new relay route admitted like a report (above the kill switch; exempt from halted, capped and budget; still rate-limited and signed in); no ops webhook; the outside alarm tells the safety chat within one run. Cost: up to five minutes (plus scheduler drift) before a person hears; one flag speaks on up to three runs.
- **R4** A trial child (`/try`) is not captured, keeping the trial page's promise. Cost: a trial child's distress reaches no server; the on-screen helpline still appears. Aarav decides.
- **R5** At most 1000 flags an hour project-wide; beyond, refused and kept on the phone to resend. Cost: a flood delays real flags by up to an hour.
- **R6** Capture reads "not captured" until the first flag arrives or the owner records the day it went live. Cost: if neither happens, it reads not captured (the safe direction).
- **R7** Statuses: `new` (Unread), `seen` (Read), `triaged`, `closed`; 0019's `actioned` and `dismissed` become `triaged` and `closed`. Cost: none known: the relay never writes a status and every reader uses `new`.
- **R8** A case is bound to one report; one open case per report and per person; only its opener reads it. Cost: a reviewer works reports one after another; the owner opens his own case to read.
- **R9** Opening a case needs a fresh authenticator code. Cost: one code per case.
- **R10** 30 case reads (report and context) per person per India day, the owner included. Cost: a heavy day waits for midnight or a reviewed constant change.
- **R11** No identity reveal: a case shows the report, its class, the sitting's times and counts, never the child's name, login ID or other records. Cost: a disclosure that needs the child's identity waits for counsel; until then only the Supabase dashboard (the emergency tool) can find it.
- **R12** `disclosed` is accepted only when the school's recipient is decided; a direct child cannot be marked disclosed. Cost: a disclosure made before counsel answers is recorded as `referred` or `other`.
- **R13** The import gate applies only on HOSTED and STAGING databases and needs both decisions. Cost: a hosted project whose environment was never set (plan 1's bootstrap sets it) would import unblocked; tests, demo and TEST projects stay open.
- **R14** A school's decision is the owner's, with a fresh code and a basis of 3 to 200 characters. Cost: none known.
- **R15** Retract and reject are the owner's or ops' (spec section 3 gives ops retract) with a fresh code, because the class's files are then deleted for good (spec section 3: anything that cannot be undone wants a code from the last 10 minutes; the wave's convention lists anything irreversible as guarded; the cross-check of 2026-10-08 changed this from "no fresh code"). A fresh code costs seconds (the write dialog asks and retries once) and needs no second person, so stopping harm still does not wait on anyone; publish is the owner's with a fresh code. Removing a class removes its files, then its catalogue row, so the topic can be prepared and kept again; the review-first default is not flipped. Cost: a retracted topic can come back as a new, unreviewed preparation.
- **R16** The catalogue's select policy shows only published classes. Cost: none for today's rows (all published); a future pending class is hidden until published.
- **R17** Reports per class are matched by `lesson_id = id` or `topic_ref = topic_ref`. Cost: undercounts if lesson ids differ from class ids (UNVERIFIED).
- **R18** Cost per class is usage rows of sittings on the topic plus rows sharing a preparation id with them; unpriced reads "at least". Cost: calls with neither are not counted.
- **R19** Erasure covers school students who have left and direct users, not teachers, school admins, parents or staff. Cost: those go through the dashboard; a parent's own sign-in stays, its link to the child goes.
- **R20** Erasure deletes the auth user (31 cascades, 12 set-null, all 44 foreign keys pinned by a test), removes the child's `lms-work` photos first, scrubs the login ID from the school's activity log and from the request, and keeps ids in staff logs (insert-only). Cost: counsel may want staff logs scrubbed.
- **R21** A request stores no requester details, only a reference that is never an email or a ten-digit number. Cost: replies go through the original channel.
- **R22** A request is due 30 days after it was received (a working figure). Cost: counsel's figure replaces it.
- **R23** The contest purge clears names, phones, address, city and school of entries made before the date and keeps class, tuition flag, campaign and date for counts. Cost: if counsel wants rows deleted, the job changes.
- **R24** Distress flags are kept 365 days. Counsel decides.
- **R25** The student app's report: students only; seven places; a note of at most 500 characters scrubbed on the phone; 10 a day; kept nowhere on the phone; the place in `lesson_id`, the homework id in `beat_id`. Cost: a parent cannot report; a report that fails to send is gone if the child closes the sheet (the sheet says so).
- **R26** The two Storage routes join `admin-api` instead of a new function. Cost: `admin-api` is redeployed.
- **R27** `admin.today()` is not touched (plan 4 replaces it); its distress tile reads "not captured" until the merge's 0070 (merge note 4). Cost: Today understates capture until then; the Safety page is right.
- **R28** The report list and cases are for the owner and safety; Classes for owner, ops and safety; Privacy for owner and ops. Cost: ops sees report counts only on Today and the health card.
- **R29** No contest address reveal here: no screen lists contest entries. Cost: posting a prize uses the dashboard until a winners list exists.

## Self-review

**Spec coverage.** Section 7 plan-5 row: `safety_event` (Task 1), `case` and `read_log` (Task 6), `erasure_request` (Task 9), `school_privacy` (Task 5). Section 8: Classes row (Task 8: pending list, publish with who and why, retract with files removed, reject, reports and cost per class; Task 10 for the files); Safety and privacy row (Tasks 6, 9: triage, evidence with a reason, per-school recipient, erasure, fiduciary per school, retention truth); Student app row (Task 14: report button and helpline); Landing and contest row (Task 9: purge date; the limit and entries are plan 4's). Section 6 rows: opening a child's words without a reason (Task 6: case, reason, one record, masked lists, quota) and the never-shown list (Review Focus 1, Task 6 test 1, Task 13's columns). Section 3 roles (Tasks 5 to 9, 12; R28). Section 2 counsel rows (Task 5, the counsel questions). Section 11 Safety numbers (Task 6's overview: reports by age and status, time to first look, capture never a bare zero). Section 14: plan 5's row in full.

**Seams.** T1 to T11 each map to the seam table; files beyond T6 and T8 are named with their reason.

**Placeholders.** Function bodies that are plain checks are given as ordered rules with exact messages; the non-obvious ones (the flag door, the import gate, the status change, case_open, the read log and quota, the cost query, the erasure count and completion) are given as code. Every test file lists its tests and their assertions; the Expected counts are this document's numbered tests.

**Type consistency.** The jsonb shapes in Tasks 6 to 9 are the interfaces of Task 11; `SafetyFlag` (Task 2) and `SafetyFlagBody` (Task 3) carry the same six fields that `readSafetyFlag` allows and `keep_safety_event` takes; `ProblemReport` (Task 7) is what `lms.report_problem` takes and Task 14 builds.

**Not verified:** the list under UNVERIFIED.
