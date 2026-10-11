# Qrie control, Plan 1: Foundation. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the staff-only console's foundation: who counts as staff, a log nobody can edit, the stop switch and the daily ceiling as audited actions, the Today page, the remote-switch registry the apps will read, an alarm that watches from outside, and the `apps/admin` shell with its login and authenticator flow.

**Architecture:** SECURITY DEFINER functions in a new `admin` schema are the only door; each begins with `admin.require_staff` (active row, not anonymous, aal2). A typed client package (`packages/admin-client`) reaches them through a transport that is either Supabase or in-process Postgres, so the same refusals happen in tests as in production. `apps/admin` is a small React app on its own origin. An outside checker (GitHub Actions) reads one token-guarded snapshot and tells people on Telegram.

**Tech Stack:** Postgres (migrations 0047 to 0051) tested on PGlite through the repo's harness; TypeScript; React 19, Vite, TanStack Router, Tailwind 4 and the teacher app's UI kit (shadcn-admin, MIT: Radix, cmdk, sonner, input-otp); `@supabase/supabase-js`; vitest; Node 22 type stripping for the two CLIs.

**Spec:** `docs/superpowers/specs/2026-10-06-super-admin-panel-design.md`. Decisions and status: `docs/handoff/2026-09-26-state-of-play.md`, section "the super admin panel".

## Where the code is

**Every file this plan creates already exists, written test-first and run**, in
`docs/superpowers/plans/2026-10-06-super-admin-foundation/files/`, at its final repo
path. The six tracked files it changes are four patches in `patches/`. **Copy them,
do not retype them.** On 2026-10-06 they were applied to a clean checkout of branch
`lms` at `2278f6d` and gave: **125 new tests in 16 files passing**, root typecheck
clean, `apps/admin` typecheck clean. **Built on 2026-10-06** on branch `admin`
(`lms@314612e` plus fourteen commits, `4e9bab5..eb17436`: the eleven tasks, then
the final review's fixes), with the migrations as 0047 to 0051. These documents live in the main checkout on `phase3-completion`
(uncommitted when this line was written), so the commands below read them from that
checkout:

```powershell
$PLAN = "C:/Users/Ashish Sharma/curie/docs/superpowers/plans/2026-10-06-super-admin-foundation"
function Take($rel) { New-Item -ItemType Directory -Force (Split-Path $rel) | Out-Null; Copy-Item "$PLAN/files/$rel" $rel -Force }
```

(Run those two lines again in every new shell; later tasks use `Take`.)

If `lms` has moved since `2278f6d`, a patch may need a manual merge or a migration
number may need to move up; the tests are what say whether it still holds.

## Global Constraints

- Work on a new branch `admin` cut from `lms` (`git worktree add .claude/worktrees/admin -b admin lms` from the repo root), in that worktree. Never commit to `lms` or `phase3-completion`. The LMS lane owns every migration from 0021 on (LMS decision 10); these are 0047 to 0051. **Built that way on 2026-10-06:** by then the LMS lane had committed 0043 to 0046 (AI drafts, hand-in once, parents, the `lms-admin` service; none touches what these touch), so the five were renumbered from the scratch run's 0043-0047 and built on `lms@314612e`. If the LMS lane moves again before this branch merges, take the next free numbers, keep the five in this order, and rename the files and the five `(migration 00NN)` comments in their tests to match.
- Every admin function is `SECURITY DEFINER`, `set search_path = admin, public`, begins with `admin.require_staff(...)`, and says explicitly who may call it: `revoke ... from public, anon` then `grant execute ... to authenticated` (or `service_role`). PostgreSQL gives EXECUTE to PUBLIC by default; `admin-invariants.test.ts` pins the exact list.
- Failure to be staff always raises exactly `not allowed` (errcode 42501).
- No service-role key in `apps/admin`, its build, or the alarm checker.
- App text is English, sentence case. Comments state only what the code does (this repo fails phases for prose that asserts what the code does not).
- Tests are vitest; database tests carry `// @vitest-environment node` and use the harness (`supabase/tests/harness.ts`). A test is run and seen to fail before the code that makes it pass.
- `apps/admin` is excluded from the root `tsconfig.json` and has its own, as `apps/lms` does.
- The two CLIs run with `node --experimental-strip-types`, so they use erasable TypeScript only (no enums, no parameter properties) and explicit `.ts` import paths.
- Windows shell; Node 22.

## Review Focus

The spec implies these, and each has a test pinned to the task that owns the code:

1. **A child's anonymous session, or a permanent account that is not staff, calling any admin function** is refused with `not allowed`. Even an owner whose token says `is_anonymous` or `aal1` is refused. (Task 2: `admin-foundation.test.ts` "who counts as staff"; Task 6: `admin-invariants.test.ts`.)
2. **A guarded action with an old or missing authenticator timestamp** raises "confirm with your authenticator code first", which the client types as `needs-mfa`, and the panel retries exactly once after a fresh code. (Task 3: `admin-relay.test.ts`; Task 7: `api.test.ts`; Task 10: browser check 3.)
3. **The alarm token:** a wrong or null token is answered (so it can be counted), a burst of wrong ones is refused even for the right token, the token is stored only hashed, and the snapshot has exactly ten whitelisted fields and no free text. (Task 6: `admin-alarm.test.ts`.)
4. **A switch value of the wrong type, an unknown key, or a school scope for a global-only switch** is refused; an unset switch reads as its safe default. (Task 5: `admin-flags.test.ts`.)
5. **A console pointed at the wrong environment never writes.** The function refuses on mismatch; the shell shows a red banner; the stop dialog makes the person type the environment. (Task 3: "wrong environment"; Task 10: browser check 4.)
6. Also pinned: a raised ceiling reverts at its day (Task 3); hand-written SQL on `relay_control` leaves an "unmanaged-change" row and the admin functions do not (Task 3); the audit log refuses update, delete and truncate even for the service role (Task 2); a build holding a service-role JWT fails the bundle guard while one holding only the anon key passes (Task 8).

## File structure

| Path (in the repo) | Responsibility | Task |
|---|---|---|
| `supabase/tests/harness.ts` (patched) | `auth.jwt()` stand-in and `asClaims` | 1 |
| `supabase/tests/harness-claims.test.ts` | pins the above | 1 |
| `supabase/tests/admin-fixtures.ts` | `makeStaff`, `aal2`, `fresh`, `anonymousChild`, `setEnvironment` | 2 |
| `supabase/migrations/0047_admin_foundation.sql` | staff, audit log, the three checks, staff identity functions, no solo org for staff | 2 |
| `supabase/migrations/0048_admin_relay_control.sql` | `relay_status`, `set_halt`, `set_caps`, `revert_caps`, ceiling bound, tripwire | 3 |
| `supabase/migrations/0049_admin_today.sql` | `admin.today()` | 4 |
| `supabase/migrations/0050_admin_flags.sql` | switch registry, `admin.flag_*`, `public.app_config` | 5 |
| `supabase/migrations/0051_admin_alarm.sql` | `alert_token_set`, `public.alert_snapshot` | 6 |
| `supabase/tests/admin-{foundation,relay,today,flags,alarm,invariants}.test.ts` | the database behaviour | 2 to 6 |
| `packages/admin-client/**` | transport, typed client, typed errors, `decideGate`, idle rule | 7 |
| `tsconfig.json`, `vitest.config.ts` (patched) | exclude `apps/admin`, alias the package | 7 |
| `tools/bin/check-bundle-secrets.mjs` (patched), `tools/bin/tests/check-bundle-secrets.test.ts` | scan any build, refuse a service-role JWT | 8 |
| `tools/admin-bootstrap/**` | make the first owner | 9 |
| `tools/admin-alert/**`, `.github/workflows/admin-alert.yml` | the outside checker | 9 |
| `apps/admin/**` | the panel shell, on the teacher app's UI kit (copied) | 10 |
| `package.json`, `.github/workflows/ci.yml` (patched), `docs/ops/admin-console.md` | scripts, CI, Aarav's setup and the runbook | 11 |

---

### Task 1: Branch, and the harness learns JWT claims

**Files:**
- Modify: `supabase/tests/harness.ts` (patch `01-harness.patch`)
- Test: `supabase/tests/harness-claims.test.ts`

**Interfaces:**
- Produces: `asClaims(db, claims: JwtClaims, fn)` and `interface JwtClaims { sub: string; aal?: 'aal1'|'aal2'; is_anonymous?: boolean; amr?: {method: string; timestamp: number}[] }`; the SQL function `auth.jwt() returns jsonb` (the whole claims object; `{}` when none are set).

- [ ] **Step 1: Make the branch and install**

```powershell
git worktree add .claude/worktrees/admin -b admin lms
cd .claude/worktrees/admin
$env:ONNXRUNTIME_NODE_INSTALL = 'skip'; npm ci
```

Expected: `npm ci` finishes with no error.

- [ ] **Step 2: Baseline**

Run: `npx vitest run supabase/tests`
Expected: PASS (every existing file).

- [ ] **Step 3: Write the failing test**

```powershell
$PLAN = "C:/Users/Ashish Sharma/curie/docs/superpowers/plans/2026-10-06-super-admin-foundation"
function Take($rel) { New-Item -ItemType Directory -Force (Split-Path $rel) | Out-Null; Copy-Item "$PLAN/files/$rel" $rel -Force }
Take "supabase/tests/harness-claims.test.ts"
```

- [ ] **Step 4: Run it and see it fail**

Run: `npx vitest run supabase/tests/harness-claims.test.ts`
Expected: FAIL, 4 of 4 (`asClaims` is not exported).

- [ ] **Step 5: Apply the patch**

```powershell
git apply "$PLAN/patches/01-harness.patch"
```

- [ ] **Step 6: Run it and see it pass, then the whole folder**

Run: `npx vitest run supabase/tests`
Expected: PASS, including `harness-claims.test.ts` (4 tests).

- [ ] **Step 7: Commit**

```powershell
git add supabase/tests/harness.ts supabase/tests/harness-claims.test.ts
git commit -m "test: the harness can speak for a JWT (auth.jwt and asClaims)"
```

---

### Task 2: Who is staff, and a log nobody can edit (0047)

**Files:**
- Create: `supabase/migrations/0047_admin_foundation.sql`
- Create: `supabase/tests/admin-fixtures.ts`
- Test: `supabase/tests/admin-foundation.test.ts`

**Interfaces:**
- Consumes: `asClaims`, `asService`, `createUser`, `freshDatabase` from the harness.
- Produces (SQL): `admin.require_staff(p_roles text[] default array['owner','ops','safety']) returns admin.platform_staff` (owner always passes; raises `not allowed`); `admin.require_fresh_mfa(p_minutes integer default 10)`; `admin.check_environment(p_env text)`; `admin.audit(p_who admin.platform_staff, p_action text, p_kind text, p_id text, p_reason text, p_details jsonb)`; `admin.audit_service(...)`; `admin.tripwire()` (a trigger function); `admin.me() returns jsonb {userId, role, displayName, environment}`; `admin.staff_list()`; `admin.staff_set(p_user uuid, p_role text, p_name text, p_active boolean, p_reason text)`; `admin.bootstrap_owner(p_user uuid, p_name text)` and `admin.set_environment(p_env text)` (service role only). Tables `admin.setting`, `admin.platform_staff`, `admin.audit_event`.
- Produces (TS, `admin-fixtures.ts`): `makeStaff(db, role, name?) => Promise<{id, role}>`, `aal2(who, over?) => JwtClaims` (old factor), `fresh(who) => JwtClaims` (factor verified now), `freshAmr()`, `staleAmr()`, `anonymousChild(db)`, `setEnvironment(db, env?)`.

- [ ] **Step 1: Write the failing tests**

```powershell
Take "supabase/tests/admin-fixtures.ts"
Take "supabase/tests/admin-foundation.test.ts"
```

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run supabase/tests/admin-foundation.test.ts`
Expected: FAIL in `beforeAll` with a Postgres error naming `admin` (the schema and `admin.set_environment` do not exist).

- [ ] **Step 3: Add the migration**

```powershell
Take "supabase/migrations/0047_admin_foundation.sql"
```

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run supabase/tests/admin-foundation.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Make sure nothing else moved**

Run: `npx vitest run supabase/tests packages/lms-client apps/classroom/tests/migrations.test.ts`
Expected: PASS. (0047 replaces the `on_auth_user_created` trigger so it also skips `provisioned_by = 'staff'`; the school cases must still hold.)

- [ ] **Step 6: Commit**

```powershell
git add supabase/migrations/0047_admin_foundation.sql supabase/tests/admin-fixtures.ts supabase/tests/admin-foundation.test.ts
git commit -m "feat: who counts as staff, and an audit log nobody can edit"
```

---

### Task 3: The stop switch and the ceiling (0048)

**Files:**
- Create: `supabase/migrations/0048_admin_relay_control.sql`
- Test: `supabase/tests/admin-relay.test.ts`

**Interfaces:**
- Consumes: `admin.require_staff`, `admin.require_fresh_mfa`, `admin.check_environment`, `admin.audit`, `admin.audit_service`, `admin.tripwire` (Task 2); `public.relay_control`, `public.relay_budget_day`, `public.usage_event` (0003, 0008, 0015, 0016).
- Produces: `admin.relay_status() returns jsonb {halted, haltedReason, haltedAt, ceilingUnits, unitsToday, maxConcurrentPreps, studentsNow, utcDay, capOverride: {previousUnits, revertOn}|null}`; `admin.set_halt(p_halted boolean, p_reason text, p_env text)` (stop: any staff; resume: owner plus a fresh code); `admin.set_caps(p_units integer, p_reason text, p_env text)` (owner plus a fresh code; 1000 to 1000000; a raise reverts at the next UTC day); `admin.revert_caps() returns integer` (service role; cron job `admin-revert-caps` at `5 0 * * *`); constraint `relay_control_ceiling_bounds` (NOT VALID); trigger `relay_control_tripwire`.

- [ ] **Step 1: Write the failing tests**

```powershell
Take "supabase/tests/admin-relay.test.ts"
```

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run supabase/tests/admin-relay.test.ts`
Expected: FAIL (`admin.relay_status` / `admin.set_halt` do not exist).

- [ ] **Step 3: Add the migration**

```powershell
Take "supabase/migrations/0048_admin_relay_control.sql"
```

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run supabase/tests/admin-relay.test.ts`
Expected: PASS. The tests include: one call from `ops` stops the tutor and `claim_relay` then answers `halted`; resume needs the owner and a fresh code; the wrong environment is refused; the ceiling is bounded; a raise reverts on its day; a hand `UPDATE` leaves an `unmanaged-change` row and the admin functions leave none.

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/0048_admin_relay_control.sql supabase/tests/admin-relay.test.ts
git commit -m "feat: stop the tutor and move the daily ceiling as audited actions"
```

---

### Task 4: The home page's one function (0049)

**Files:**
- Create: `supabase/migrations/0049_admin_today.sql`
- Test: `supabase/tests/admin-today.test.ts`

**Interfaces:**
- Consumes: Task 2's checks; `public.relay_control`, `relay_budget_day`, `usage_event`, `student_report` (0019), `prepared_class` (0004, 0018), `contest_signup` (0020), `model_price` (0008), `lms.founder_schools()` (0041), `admin.setting` key `alert_last_seen` (written by Task 6).
- Produces: `admin.today() returns jsonb {environment, generatedAt, relay{halted, haltedReason, ceilingUnits, unitsToday, studentsNow}, reports{newCount, unsafeNew, oldestNewMinutes}, classes{pendingCount, oldestPendingHours}, contest{entriesToday, dailyCap}, schools[{code, name, plan, seats, seatsUsed, daysLeft}], prices{modelPriceRows}, alarm{lastCheckMinutesAgo}, capture{distress, lastPurge}}`. `capture.*` is the string `not-captured` until a later plan captures it.

- [ ] **Step 1: Write the failing tests**

```powershell
Take "supabase/tests/admin-today.test.ts"
```

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run supabase/tests/admin-today.test.ts`
Expected: FAIL (`admin.today` does not exist).

- [ ] **Step 3: Add the migration**

```powershell
Take "supabase/migrations/0049_admin_today.sql"
```

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run supabase/tests/admin-today.test.ts`
Expected: PASS. Notably: the response never contains a report's note; a school whose licence ends in 9 days is listed; the contest ceiling `2000` is pinned to `day_project constant integer := 2000;` in migration 0020, so a drift fails here.

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/0049_admin_today.sql supabase/tests/admin-today.test.ts
git commit -m "feat: the home page as one function, with 'not captured' for what is not seen"
```

---

### Task 5: Remote switches for every app (0050)

**Files:**
- Create: `supabase/migrations/0050_admin_flags.sql`
- Test: `supabase/tests/admin-flags.test.ts`

**Interfaces:**
- Consumes: Task 2's checks and `admin.audit`; `lms.school` (0022) for the school scope; `buildSchool` from `supabase/tests/fixtures.ts`.
- Produces: tables `admin.flag_def (key, kind in bool|text|tone, safe_default jsonb, school_scoped, guarded, description)` and `admin.app_flag (key, scope in global|school, scope_id, value jsonb, ...)`; `admin.flag_list()`; `admin.flag_set(p_key text, p_scope text, p_scope_id text, p_value jsonb, p_reason text, p_env text)` (ops or owner; guarded keys need a fresh code); `public.app_config(p_school text default null) returns jsonb` (callable with no sign-in; a school's value overrides the global one; unset reads as the safe default). Registered keys: `banner.message`, `banner.tone`, `tutor.enabled`, `tutor.only_prepared`, `tutor.compose_live_classes`, `contest.entries_open`, `app.min_version.classroom|student|lms`.

- [ ] **Step 1: Write the failing tests**

```powershell
Take "supabase/tests/admin-flags.test.ts"
```

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run supabase/tests/admin-flags.test.ts`
Expected: FAIL (`public.app_config` does not exist).

- [ ] **Step 3: Add the migration**

```powershell
Take "supabase/migrations/0050_admin_flags.sql"
```

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run supabase/tests/admin-flags.test.ts`
Expected: PASS, including: `app_config` is readable as `anon` and the tables behind it are not; a safety reviewer cannot set a switch; a school code is accepted in lower case and matches.

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/0050_admin_flags.sql supabase/tests/admin-flags.test.ts
git commit -m "feat: a registry of remote switches the apps can read, with safe defaults"
```

---

### Task 6: The alarm's snapshot, and the grants pinned (0051)

**Files:**
- Create: `supabase/migrations/0051_admin_alarm.sql`
- Test: `supabase/tests/admin-alarm.test.ts`, `supabase/tests/admin-invariants.test.ts`

**Interfaces:**
- Consumes: Task 2 (`admin.audit_service`, `admin.setting`), Task 3's tables.
- Produces: `admin.alert_token_set(p_token text)` (service role; at least 32 characters; stores SHA-256 only); `public.alert_snapshot(p_token text) returns jsonb` (callable by `anon`; returns exactly `at, halted, ceilingUnits, unitsToday, newReports, unsafeNewReports, oldestNewReportMinutes, pendingClasses, relayEvents5m, relayFailures5m`, or `{"error": "not-allowed"}` / `{"error": "busy"}`; records `admin.setting` `alert_last_seen` on success).

- [ ] **Step 1: Write the failing tests**

```powershell
Take "supabase/tests/admin-alarm.test.ts"
Take "supabase/tests/admin-invariants.test.ts"
```

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run supabase/tests/admin-alarm.test.ts supabase/tests/admin-invariants.test.ts`
Expected: FAIL (`admin.alert_token_set` does not exist; the invariants list is missing a function).

- [ ] **Step 3: Add the migration**

```powershell
Take "supabase/migrations/0051_admin_alarm.sql"
```

- [ ] **Step 4: Run all six admin database files**

Run: `npx vitest run supabase/tests/admin-`
Expected: PASS, 6 files, 54 tests. `admin-invariants.test.ts` fails if any admin function is callable by `anon`, or if `authenticated` can call anything but `flag_list, flag_set, me, relay_status, set_caps, set_halt, staff_list, staff_set, today`.

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/0051_admin_alarm.sql supabase/tests/admin-alarm.test.ts supabase/tests/admin-invariants.test.ts
git commit -m "feat: a token-guarded snapshot for the outside alarm, and the grants pinned as a list"
```

---

### Task 7: The typed client

**Files:**
- Create: `packages/admin-client/package.json`, `src/{index,transport,api,errors,gate}.ts`
- Modify: `tsconfig.json`, `vitest.config.ts` (patch `02-alias.patch`)
- Test: `packages/admin-client/tests/{api,errors,gate,transport}.test.ts`

**Interfaces:**
- Consumes: the SQL functions of Tasks 2 to 5.
- Produces: `createAdminClient(t: AdminTransport): AdminClient` with `me()`, `relayStatus()`, `setHalt(halted, reason, env)`, `setCaps(units, reason, env)`, `today()`, `flagList()`, `flagSet({key, scope, scopeId?, value, reason, env})`, `staffList()`, `staffSet({userId, role, displayName, active, reason})`; `supabaseAdminTransport(client: AdminRpcClient)`, `pgliteAdminTransport(db, claims: AdminClaims)`; `class AdminError { code: 'needs-mfa'|'not-allowed'|'wrong-environment'|'other' }` and `toAdminError(e)`; `decideGate(i: GateInput): Gate` with `Gate = 'signed-out'|'enrol-factor'|'verify-factor'|'checking'|'not-staff'|'ready'`; `idleExpired(lastMs, nowMs, limitMinutes = 15)`; `IDLE_LIMIT_MINUTES = 15`. The one argument named `p_value` is sent to Postgres as a jsonb document.

- [ ] **Step 1: Write the failing tests**

```powershell
git apply "$PLAN/patches/02-alias.patch"
Take "packages/admin-client/package.json"
Take "packages/admin-client/tests/api.test.ts"
Take "packages/admin-client/tests/errors.test.ts"
Take "packages/admin-client/tests/gate.test.ts"
Take "packages/admin-client/tests/transport.test.ts"
```

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run packages/admin-client`
Expected: FAIL (the `../src/index.ts` import cannot be resolved).

- [ ] **Step 3: Add the source**

```powershell
foreach ($f in 'index','transport','api','errors','gate') { Take "packages/admin-client/src/$f.ts" }
```

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run packages/admin-client`
Expected: PASS, 4 files, 31 tests. The API tests run each call as a staff member would reach the database: a child gets `not-allowed`, an old authenticator code gets `needs-mfa`, the wrong environment gets `wrong-environment`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```powershell
git add tsconfig.json vitest.config.ts packages/admin-client
git commit -m "feat: a typed client for the admin functions, with typed refusals and the gate decision"
```

---

### Task 8: The bundle guard learns any build and refuses a service-role key

**Files:**
- Modify: `tools/bin/check-bundle-secrets.mjs` (patch `03-bundle-guard.patch`)
- Test: `tools/bin/tests/check-bundle-secrets.test.ts`

**Interfaces:**
- Produces: `node tools/bin/check-bundle-secrets.mjs [dist ...]` (no argument still means `apps/classroom/dist`); fails (exit 1, "a service-role key appears in <file>") on any JWT whose payload says `role: service_role`; never prints the token.

- [ ] **Step 1: Write the failing test**

```powershell
Take "tools/bin/tests/check-bundle-secrets.test.ts"
```

- [ ] **Step 2: Run and see it fail**

Run: `npx vitest run tools/bin/tests/check-bundle-secrets.test.ts`
Expected: FAIL (the leak test exits 0; the two-folder test exits 0).

- [ ] **Step 3: Apply the patch**

```powershell
git apply "$PLAN/patches/03-bundle-guard.patch"
node --check tools/bin/check-bundle-secrets.mjs
```

- [ ] **Step 4: Run and see it pass**

Run: `npx vitest run tools/bin/tests/check-bundle-secrets.test.ts`
Expected: PASS, 4 tests (a clean build passes; a build holding only the anon key passes; a service-role key fails without being printed; every folder given is checked; something JWT-shaped that is not a JWT is ignored).

- [ ] **Step 5: Commit**

```powershell
git add tools/bin
git commit -m "ops: the bundle scan takes any build and refuses a service-role key"
```

---

### Task 9: The first owner, and the outside alarm checker

**Files:**
- Create: `tools/admin-bootstrap/src/{provision,cli}.ts`, `tools/admin-alert/src/{evaluate,run}.ts`, `.github/workflows/admin-alert.yml`
- Test: `tools/admin-bootstrap/tests/provision.test.ts`, `tools/admin-alert/tests/{evaluate,run}.test.ts`

**Interfaces:**
- Produces: `provisionOwner({url, serviceKey, email, password, name, environment, fetchImpl?}): Promise<{userId}>` (creates a `provisioned_by: 'staff'` account, sets the environment, makes the owner; password at least 12 characters; neither key nor password in any error); `evaluate(answer: SnapshotAnswer | null, nowMinutes: number): Alert[]` with `Alert = {channel: 'safety'|'ops', key, text}` (an unread unsafe report speaks on every run on the safety channel; the rest are paced by the clock and carry only counts); `fetchSnapshot(env, fetchImpl?)`, `sendTelegram(botToken, chatId, text, fetchImpl?)`, `runOnce(env, nowMinutes, fetchImpl?)`.

- [ ] **Step 1: Write the failing tests**

```powershell
Take "tools/admin-bootstrap/tests/provision.test.ts"
Take "tools/admin-alert/tests/evaluate.test.ts"
Take "tools/admin-alert/tests/run.test.ts"
```

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run tools/admin-bootstrap tools/admin-alert`
Expected: FAIL (the `../src/...` imports cannot be resolved).

- [ ] **Step 3: Add the source and the workflow**

```powershell
Take "tools/admin-bootstrap/src/provision.ts"
Take "tools/admin-bootstrap/src/cli.ts"
Take "tools/admin-alert/src/evaluate.ts"
Take "tools/admin-alert/src/run.ts"
Take ".github/workflows/admin-alert.yml"
```

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run tools/admin-bootstrap tools/admin-alert`
Expected: PASS, 3 files, 21 tests. Notably: no message names a school, lesson, child or note whatever the numbers; a failed Telegram send throws so the scheduled job turns red, without the bot token in the error.

- [ ] **Step 5: The CLIs run under Node's type stripping and refuse missing config by name**

```powershell
node --experimental-strip-types tools/admin-bootstrap/src/cli.ts
node --experimental-strip-types tools/admin-alert/src/run.ts
```

Expected: the first prints `pass --env HOSTED | STAGING | DEMO | TEST`; the second throws `SUPABASE_URL is not set`.

- [ ] **Step 6: Commit**

```powershell
git add tools/admin-bootstrap tools/admin-alert .github/workflows/admin-alert.yml
git commit -m "feat: make the first owner from a laptop, and an alarm that watches from outside"
```

---

### Task 10: The panel shell (`apps/admin`)

**The look is the teacher app's.** `apps/admin` reuses `apps/lms`'s UI kit, which
started from `satnaing/shadcn-admin` (MIT): those files are **copied, not imported**
(listed in `apps/admin/README.md`, with the licence in `apps/admin/LICENSE`), so the
console has the same sidebar, header, cards, tables, dialogs, toasts, light and dark
theme and Ctrl+K search, and a change to the teacher app never changes it.

**Files:**
- Create: everything under `apps/admin/`:
  - from the teacher app, unchanged: `src/components/ui/*` (alert, alert-dialog, avatar, badge, button, card, collapsible, command, dialog, dropdown-menu, input, input-otp, label, scroll-area, select, separator, sheet, sidebar, skeleton, sonner, switch, table, tooltip), `src/components/layout/{header,main,nav-group,types,authenticated-layout}.tsx`, `src/context/{theme,layout,search}-provider.tsx`, `src/components/{theme-switch,skip-to-main,confirm-dialog}.tsx`, `src/hooks/{use-mobile,use-dialog-state}.tsx`, `src/lib/{utils,cookies}.ts`, `src/styles/{index,theme}.css`, `LICENSE`, `components.json`
  - the console's own: `src/components/layout/{app-sidebar,nav-user}.tsx`, `src/components/layout/data/sidebar-data.ts`, `src/components/{admin-page,stop-control,command-menu}.tsx`, `src/features/auth/{auth-card,sign-in,factor,not-staff}.tsx`, `src/features/today/index.tsx`, `src/features/switches/index.tsx`, `src/hooks/use-idle-sign-out.ts`, `src/lib/{supabase,client,mfa,session,stepup,me,tiles}`, `src/{App,main,router}.tsx`, `src/vite-env.d.ts`, `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `vercel.json`, `.env.example`, `README.md`
- Test: `apps/admin/tests/tiles.test.ts`

**Interfaces:**
- Consumes: `@ai-tutor/admin-client` (Task 7).
- Produces: `tilesFor(t: Today): Tile[]` and `schoolNotes(t: Today): SchoolNote[]` (pure; grey for what is not seen, never green or zero); `useGate()`; `useGuarded()` (runs an action, and on `needs-mfa` asks for one code, verifies it and retries once); `AdminPage` (every page's frame: environment badge, search, theme, the wrong-database warning); pages `/` (Today) and `/switches`; `sidebarData` (later plans add their groups there and their routes in `src/router.tsx`). Dev server on port 5182. The `@/` alias points at `apps/admin/src`, as in the teacher app.

- [ ] **Step 1: Write the failing test**

```powershell
Take "apps/admin/tests/tiles.test.ts"
```

- [ ] **Step 2: Run and see it fail**

Run: `npx vitest run apps/admin`
Expected: FAIL (`../src/lib/tiles.ts` cannot be resolved).

- [ ] **Step 3: Add the tile logic and see the test pass**

```powershell
Take "apps/admin/src/lib/tiles.ts"
npx vitest run apps/admin
```

Expected: PASS, 11 tests.

- [ ] **Step 4: Add the rest of the app**

```powershell
Copy-Item "$PLAN/files/apps/admin" "apps/" -Recurse -Force
npm install
```

Expected: `npm install` links the new workspace `@ai-tutor/admin` and nests Tailwind 4 in `apps/admin/node_modules` (the repo root holds Tailwind 3.4 for the tutor; `apps/lms` gets its v4 the same way); `package-lock.json` changes.

- [ ] **Step 5: Typecheck and build**

```powershell
npx tsc -p apps/admin/tsconfig.json --noEmit
npm run build --workspace @ai-tutor/admin
```

Expected: no type errors; Vite builds `apps/admin/dist` (measured in the scratch checkout: 2,098 modules, about 74 kB of CSS and 741 kB of JavaScript; Vite's chunk-size warning is expected and harmless). If Tailwind cannot be resolved, `apps/admin/node_modules/tailwindcss` is missing: re-run `npm install`; do not change the CSS imports, which are the teacher app's.

- [ ] **Step 6: Browser check against a real Supabase project**

This needs migrations 0026 to 0051 applied to a project (hosted, or `npx supabase start` if Docker is available), the `admin` schema exposed, TOTP enabled and an owner made: `docs/ops/admin-console.md`, steps 1 to 5 (Aarav's). Then `npm run dev --workspace @ai-tutor/admin` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_ADMIN_ENV` in `apps/admin/.env.local`, and in the browser pane:

1. Sign in as the owner. Expected: the "Set up your authenticator" screen shows a QR code and the secret; wrong details show only "Those details did not work."
2. Enter the 6-digit code. Expected: the Today page appears in the teacher app's layout (sidebar with Today and Switches, the environment badge in the header, the theme switch, Ctrl+K opens the page search); no console errors; no Content-Security-Policy violations (serve the built `dist` with `vercel.json`'s headers to see them; styles are allowed inline because the kit's toasts and scroll areas inject them, scripts are not).
3. As an owner with a code more than 10 minutes old, press "Stop the tutor", then "Resume the tutor". Expected: stopping works at once; resuming asks for one code, then succeeds. This is the check that Supabase's token carries `amr` timestamps the way the tests assume (UNVERIFIED until now); if it does not, stop here and change `admin.require_fresh_mfa`.
4. Build with `VITE_ADMIN_ENV=DEMO` against the project whose environment is `HOSTED`. Expected: the red mismatch banner across the top; the stop dialog refuses unless `HOSTED` is typed.
5. Sign in as a permanent account that is not staff. Expected: after the code, "This account does not have access to Qrie control."
6. Switches: set `banner.message` with a reason, then `select public.app_config(null)` as the anon role returns it.
7. Leave the tab for 15 minutes (or temporarily set `IDLE_LIMIT_MINUTES` to 1 in `packages/admin-client/src/gate.ts`, and put it back). Expected: signed out.

- [ ] **Step 7: Commit**

```powershell
git add apps/admin package-lock.json
git commit -m "feat: the admin console shell: sign-in with an authenticator, Today, stop and resume, switches"
```

---

### Task 11: Scripts, CI, and the runbook

**Files:**
- Modify: `package.json`, `.github/workflows/ci.yml` (patch `04-scripts-and-ci.patch`)
- Create: `docs/ops/admin-console.md`

**Interfaces:**
- Produces: `npm run admin`, `admin:build`, `admin:bootstrap`, `admin:alert`; `npm run typecheck` also checks `apps/admin`; CI builds the console and scans both bundles (`apps/classroom/dist apps/admin/dist`).

- [ ] **Step 1: Apply the patch and add the runbook**

```powershell
git apply "$PLAN/patches/04-scripts-and-ci.patch"
Take "docs/ops/admin-console.md"
node -e "console.log(Object.keys(require('./package.json').scripts).filter(k=>k.startsWith('admin')).join(', '))"
```

Expected: `admin, admin:build, admin:bootstrap, admin:alert`.

- [ ] **Step 2: The whole gate, as CI runs it**

```powershell
npm run typecheck
npm test
npm run build
npm run admin:build
node tools/bin/check-bundle-secrets.mjs apps/classroom/dist apps/admin/dist
```

Expected: typecheck clean; tests pass (the `tools/measure` suites that read an untracked `.env.local` skip or fail the same way they do on `lms`); both builds succeed; the scan prints `No secret found in N built files.`

- [ ] **Step 3: Commit, then finish the branch**

```powershell
git add package.json .github/workflows/ci.yml docs/ops/admin-console.md
git commit -m "ops: admin scripts, CI builds and scans the console, and the setup runbook"
```

Then use superpowers:finishing-a-development-branch. Pushing `admin` and applying 0047 to 0051 to the hosted project are Aarav's steps (`docs/ops/admin-console.md`, section 1).

---

## Self-review

**Spec coverage** (section numbers of the revised design). Section 4 (architecture): Tasks 2 to 7, 10. Section 5 (login and sessions): Tasks 2, 7, 9 (first owner), 10 (screens, step-up, idle); staff invitation and the audit copy off the platform are **plan 2** by design. Section 6 (security): staff check, audit, tripwire, grants list, bundle guard, alarm token, headers (`vercel.json`) are here; Cashfree's signature and keys are **plan 3**; purpose-bound reads and quotas **plan 5**. Section 7 (database): the `admin.*` objects marked plan 1 are all here. Section 8 (control per app): stop, ceiling, banner and switches here. Section 9 (schools and health): **plan 2**; Today's "schools that need attention" is plan 1's slice. Section 10 (Cashfree): **plan 3**. Section 11 (visualiser): **plan 6**; Today's tiles are plan 1's slice. Section 12 (look and structure): the teacher app's kit, Today and Switches, here. Section 14 (roadmap): plans 2 to 7 are their own documents, written when each starts.

**Placeholders.** None: every file is a verified file at a named path; the one test written inline in this plan's spirit (`harness-claims.test.ts`) is also a file.

**Type consistency.** `AdminError.code`'s four values, the `Gate` union, `Today` and `RelayStatus` shapes, the `p_value` convention, and the function names in `admin-invariants.test.ts` are the same in the SQL, the client, the tests and the app (the client's tests run against the real migrations, which would fail on a mismatch).

**Review Focus coverage.** Items 1 to 5 each name their test or browser check above; item 6's tests are named in their tasks.

**Not verified (carry into Task 10's browser check and Aarav's setup):** that hosted Supabase puts `amr` timestamps in the token as the tests assume; that the `admin` schema, once exposed, answers `.schema('admin').rpc`; the dashboard's wording for each setting; that closing email sign-up leaves anonymous sign-in working; the CSP in a real browser; the YAML of `admin-alert.yml` (no parser at hand); GitHub's scheduler and Telegram delivery. (The Tailwind build, listed here before, is now measured: see Task 10, Step 5.)

## After the build (2026-10-06)

A fresh whole-branch review found ten Important issues. All were fixed test-first in one pass (commits after `6a4b01c`, ending `eb17436`); full suite 4,292 passed, 2 skipped. The fifteen minor findings were deferred. They are listed here so they outlive the git-ignored ledger. Pick them up in the plan named:

- **M1** `set_halt(null)` raises its own message before the staff check, so a non-staff caller learns a different message.
- **M2 (plan 2, before the staff page)** `staff_set` takes no `p_env` and accepts any permanent account. It should require `provisioned_by = 'staff'`.
- **M3** Two owners demoting each other at the same moment can leave no owner (no row lock). `bootstrap_owner` recovers.
- **M4 (plan 2)** No screen calls `setCaps`, and `capOverride` is shown nowhere. The ceiling screen moves to plan 2.
- **M5** Six comments or test names overstate: transport 'demo', 0050 'public flags', README `hooks/*`, the runbook's 404 (really PGRST106), and two test names.
- **M6** A `harness.ts` comment carries a form feed and a bell from PowerShell backtick escapes.
- **M7** There is no automated test of the step-up retry-once rule, and no sweep of all nine authenticated functions with child, aal1 and anonymous tokens.
- **M8** React StrictMode runs the enrolment effect twice in dev, so two `mfa.enroll` calls can race.
- **M9** `runOnce` stops at the first failed send, so a broken safety chat also silences ops.
- **M10** `toAdminError` maps every 'permission denied' to not-allowed. That hides a missing grant inside a definer function.
- **M11** Fixed along with I9: the bundle guard now knows `sb_secret_` keys.
- **M12** A missing `relay_control` row shows 'Running' and 0%, while `claim_relay` treats it as halted.
- **M13 (plan 4)** `app.min_version.*` is free text. A typo could lock apps out once plan 4 wires it.
- **M14** `apps/admin/tests` is never typechecked, and the root vitest `@` alias points at `apps/lms/src`.
- **M15** If two guarded actions hit needs-mfa at once, the first promise never settles.

**For plan 3:** per-school billing states in `app_config` can be read by anyone who guesses a school code. Keep them coarse (grace and suspended only).