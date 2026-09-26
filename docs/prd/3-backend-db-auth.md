# 3. Backend, database, auth and security

> **Not the current plan.** Since 2026-09-26 the one final plan and the living
> status are [`docs/handoff/2026-09-26-state-of-play.md`](../handoff/2026-09-26-state-of-play.md). Where this file
> disagrees with it, that file wins. Kept as a record.

This is the part of Qrie that decides who a student is, what it is allowed to spend on
them, where the record of what they did is kept, and who else is ever permitted to see
it. It is also the only place that can answer four questions the rest of the product asks
constantly and cannot answer for itself: has anybody had this class before, may this call
be made at all, is this person a child whose school is answerable for them or a child
whose parent is, and, when a child says something that needs an adult, which adult hears
it. Today it answers the first two well, has never been asked the third, and answers the
fourth by writing to a log on the child's own phone. Everything below is in service of one
sentence: a stranger with a script must not be able to turn a free account into a bill, a
teacher must be able to see her own class and nobody else's, and a sentence that matters
must reach a person.

Everything this area produces that a person reads, the privacy policy, the terms, the DPDP
notice, the grievance line, the PIN slip, the refusal messages the relay returns, is
**English**. The tutor's own voice is Hinglish or English, per student; that is a lesson
setting carried in the student's profile row and rendered by PRD 4, and it never reaches
the chrome.

## Where it stands today

### What ships

The relay is the strongest thing in the repo and deserves to be said plainly.

- **One router, two hosts.** `handleRelay` (`packages/relay/src/handler.ts:199`) serves
  both the deployed Edge Function (`supabase/functions/relay/index.ts:170`) and the vite
  dev middleware (`apps/classroom/vite.config.ts:130,137`). **With one qualification that
  matters:** the dev loop covers exactly `['/api/llm', '/api/speech', '/api/hear',
  '/api/ticket']` (`vite.config.ts:130`). `/api/class` is served in dev by a separate
  `classWriter()` plugin (`vite.config.ts:225,231`) and `/api/icons` by a third
  middleware (`vite.config.ts:180`). Neither passes through `handleRelay`, `admit()`,
  `claim_relay` or `checkSavedClass`. So the one relay carrying the content gates is the
  one the dev server never exercises.
- **Auth before money, always.** Nothing reaches a vendor before `admit()` has a verified
  Supabase user or a valid signed ticket, and before `claim_relay` has allowed the spend
  (`handler.ts:244`; `gate.ts:240-261`). Refusals that cost nothing come before the meter
  (`handler.ts:230-241`), which is the right order.
- **There is a ceiling on OUR spending now, and it is claimed atomically.**
  `UNITS_PER_DAY_PROJECT = 50_000` (`gate.ts:151`), one unit being one paisa, so Rs 500 of
  vendor spend in a UTC day across every caller. `supabase/migrations/0015_project_spend_cap.sql`
  adds `relay_budget_day (day, units, updated_at)` with RLS on and not one policy, revoked
  from `anon` and `authenticated` (`0015:30-42`), and claims the day inside `claim_relay`
  as the `where` of an upsert (`0015:134-140`). If no row comes back the day is spent and
  **nothing was taken**, so a project-level refusal costs the student none of their own
  budget, which matters because it was not their doing. The refusal carries its own reason,
  `capped`, and a 503 rather than a 429, because this is our capacity and not their rate
  (`gate.ts:157,202-205`; `0015:130,143`). `apps/classroom/tests/migrations.test.ts:505-514`
  asserts the plpgsql constant and the TypeScript one are the same number.
- **The client is told the truth about why.** `createSupabaseLedger` reads the reason
  against the known set and falls back to `rate` only for something it has never heard of
  (`gate.ts:441`). The version before it mapped every unfamiliar reason to "you are asking
  too fast", so adding a reason in SQL would have shipped the wrong sentence to a student.
- **There is an off switch that needs no deploy.** `RELAY_DISABLED` is read by both hosts
  (`apps/classroom/vite.config.ts:105`; `supabase/functions/relay/index.ts:126`) and handed
  in as `deps.disabled`. `handleRelay` checks it **before everything, including the ticket**
  (`handler.ts:203-216`), because a ticket outlives the switch by its whole ten minutes and
  minting one during an incident hands out access that survives the fix.
- **The per-user meter is atomic, by a row lock rather than by one statement.** The
  per-user half of `claim_relay` is an upsert that reads (`0015:85-102`) and a separate
  increment that writes (`0015:147-150`), both inside one transaction; what makes it safe is
  that the unconditional `on conflict ... do update` takes an exclusive lock on the caller's
  `relay_usage` row and holds it to commit, so two Edge instances cannot both read 119 and
  both write 120. The project half above is a genuinely single statement and the two are not
  the same construction, which is worth knowing when either is changed. It is revoked from
  `public`, `anon` and `authenticated` and granted to `service_role` alone (`0015:159-160`).
- **Units are pegged to money.** One unit is one paisa of vendor spend (`gate.ts:33`);
  speech is priced per character and hear per second, read off the actual request before
  dispatch (`gate.ts:93-97,117-131`).
- **The books know the model by the name they store it under.** `handler.ts:283` records
  `bareModel(...)` rather than the OpenRouter-style `google/gemini-3.7-flash` the browser
  asks for (`vertex.ts:86`). Before that fix `price_at` missed every row and every LLM call
  priced at Rs 0, which read as success.
- **The ledger is append-only by absence.** `ledger_event` and `learning_session` have a
  select policy and an insert policy and deliberately no update or delete policy; the
  insert pins both `auth.uid() = user_id` and `is_member(org_id)`
  (`supabase/migrations/0006_ledger.sql:143-160`). The one legitimate mutation, closing a
  session, is a function that can run once (`0011_close_session_once.sql`).
- **Two clocks, and the honest one is the server's.** `ledger_event.at` is the device's and
  is explicitly untrusted; `received_at` is Postgres's and is what any billing, rate or
  audit question must use (`0006:69-75`). That distinction is the only thing standing
  between a contest prize and a client-written scoreboard.
- **Tenancy is provisioned by Postgres, not app code.** A trigger on `auth.users` mints a
  solo organization and a membership before the first ledger write can race it
  (`0005_tenancy.sql:88-110`), and `is_member` is `SECURITY DEFINER` to dodge the RLS
  recursion trap the file documents at `:56-64`.
- **The privileged surface is genuinely closed.** `claim_relay`, `record_usage` and
  `purge_old_ledger` are service_role only (`0015:159-160`; `0008_usage.sql:92-95`;
  `0007_retention.sql:95-98`). `close_learning_session` is the one deliberate exception: it is
  revoked from `public` and `anon` and **granted to `authenticated`** (`0011:93-95`), because
  the browser is what closes a sitting, and its guard is `user_id = auth.uid()` inside the
  update (`0011:74-79`) rather than the grant. `concept_state` / `learner_model` are read-only
  to students with `anon` revoked outright (`0013_learner_model.sql:108-124`).
- **The evidence columns are applied, not merely written.** Migrations 0014 and 0015 are on
  the live project and verified: `concept_state.answer_observations` and
  `concept_state.doubt_count` return HTTP 200 to a student token rather than 42703,
  `relay_budget_day` is closed to `anon`, and `model:verify` passes 11 of 11.
- **The markup gate is server-side.** Script, `foreignObject`, embedding tags,
  `javascript:`, `<style>`, `@import` and external `href`/`src`/`url()` are rejected, not
  sanitised, on every utf8 file in a POSTed class (`packages/relay/src/markup.ts:26-55`),
  and class file paths are an allow-list with `.svg` deliberately excluded because the
  bucket serves it as `image/svg+xml` (`markup.ts:70-72`).
- **The service account never touches a browser.** Signed with Web Crypto inside the
  function, token cached at module scope (`packages/relay/src/googleAuth.ts`), pushed via
  a temp env file that is deleted (`tools/bin/relay-secrets.mjs`), and CI greps the
  production bundle for both key shapes and the PEM
  (`tools/bin/check-bundle-secrets.mjs:38-52`).
- **The speech ticket is a real piece of design.** An `<audio src>` cannot send a header,
  so `/api/ticket` mints an HMAC-SHA256 pass carrying a user id and a deadline and nothing
  else, compared in constant time (`packages/relay/src/ticket.ts:60-105`;
  `handler.ts:174-189`).

### What is half-built

- **The deployed relay is behind the repo.** The Edge Function has not been redeployed
  since the ceiling, the kill switch and `bareModel` landed, so the function serving the
  internet still carries the old reason mapping and would read `capped` as `rate`. One
  `npm run relay:deploy`. Until it runs, every statement above about the deployed
  behaviour describes the source and not the service.
- **The ceiling is a constant, not a value.** `units_per_day_project` is a plpgsql
  `constant` (`0015:60`) mirrored by an exported constant (`gate.ts:151`). Raising it means
  a migration and a deploy, and requirement 2 says it has to be raised before the pilot
  opens. Requirement 1 finishes the job.
- **The dev ledger does not carry the project ceiling.** `createMemoryLedger`
  (`gate.ts:328-373`) enforces `REQUESTS_PER_MINUTE` and `UNITS_PER_DAY` and knows nothing
  about `UNITS_PER_DAY_PROJECT`, so the dev server and Postgres now refuse differently.
  `0003:15-19` promises they do not.
- **`model_price` is empty on the deployed project.** `tools/sql/model_price.sql:3-5` says
  it is deliberately applied by no script. The consequence is that `usage_cost.inr` is 0 on
  every row with `unpriced = true`, and `cost_per_student_hour`, which `0008_usage.sql`
  calls the headline number, returns Rs 0. `bareModel` fixed the name; the prices still have
  to be pasted. *Finish by:* PRD 6 requirements 1 to 3, which own the whole cost apparatus.
- **The own-voice speech switch is wired and unpointed.** `HandlerDeps.speechUrl` and
  `CURIE_SPEECH_URL` go end to end (`handler.ts:63`; `relays.ts:164-179`;
  `supabase/functions/relay/index.ts:128`) and no box is deployed. *Finish by:* the Piper
  VPS, which is PRD 6's line item; my half is already done apart from requirement 31, the
  behaviour when the box queues.
- **`concept_state` and `learner_model` are a schema nobody can fill.** Tables, indexes,
  GIN index and RLS all live (`0013:17-124`); no writer exists, `supabase/functions/`
  contains only `relay`. *Finish by:* the server-side fold, which is PRD 4's; my half is
  the host, the schedule and the service_role door.
- **The llm meter is a ceiling, not an invoice.** A flat 85 units because nothing in a
  request predicts output tokens, overcharging a judge call sixfold and undercharging a
  prep call by 2.7x (`gate.ts:66-77`). Harmless while nothing is billed; it becomes a
  fraud channel the day a credit is priced.
- **The Edge Function's stated drift guard does not work.** `index.ts:110-117` says the
  `const deps: HandlerDeps` annotation lets the Supabase CLI catch drift, but line 1 is
  `@ts-nocheck` and the file is outside `tsconfig`, so `npm run typecheck` never sees it.
  A change to `HandlerDeps` surfaces as a 500 in production. *Finish by:* requirement 25.
- **Four verifier binaries exist and nothing runs them.** `ledger-live-test.mjs`,
  `usage-live-test.mjs`, `meter-test.mjs` and `cost-report.mjs` have no npm script
  (`package.json` scripts block). Worse, every wired verification script mints a throwaway
  anonymous account: `live-test.mjs:31` runs under `relay:verify` and
  `model-metric.mjs:67` under `model:metric`, which is exactly the reason
  `keepalive.yml:13-14` gives for not running `verify-deploy`.

### What is missing entirely

- **An alarm, a per-IP limit and an account-creation limit.** The ceiling stops the month;
  nothing warns before it fires. `gate.ts` meters per `user_id` only
  (`REQUESTS_PER_MINUTE = 120` at `:277`, `UNITS_PER_DAY = 12_000` at `:318`). There is no
  per-IP limit and no captcha: anonymous sign-up is a POST of a bare `{}`
  (`tools/bin/verify-deploy.mjs:89-96`), every new identity is provisioned an org by the
  `0005` trigger, and each one carries a fresh Rs 120/day of metered headroom against the
  project's Rs 500. `gate.ts:10-11` says the first sign of abuse would be a class that will
  not prepare, and at the per-student level that is still literally true.
- **A second, unmetered spend channel nobody has named.** `claim_relay` runs only inside
  `admit()`, which runs only inside `handleRelay`. The client writes `student_state`,
  `learning_session` and `ledger_event` straight to PostgREST with its own JWT
  (`apps/classroom/src/lib/supabase.ts:83-91`;
  `apps/classroom/src/lib/ledgerSync.ts:296-301`). Those writes are unmetered, absent from
  `usage_event` and unbounded by either ceiling. `student_state`'s policy is `for all`
  with `using` and `with check` on `auth.uid()` alone (`0001_student_state.sql:21-25`), with
  no constraint on key, value size or row count. One free identity can write arbitrary
  jsonb into a free-tier Postgres indefinitely.
- **Any concurrency control.** Grep for semaphore, mutex, advisory lock or admission control
  across `packages/`, `apps/classroom/src/` and `supabase/` returns nothing; `queue` returns
  only the ledger outbox (`packages/ledger/src/outbox.ts`) and the audio buffer
  (`packages/voice/src/audio.ts`), neither of which bounds anything that spends.
  Prep runs in the student's own browser, roughly 40 relay calls fanned out in
  parallel over about 96 seconds. N students opening one cold topic each pay full prep and
  N-1 results are discarded, because `topic_ref` is unique and the first writer wins
  (`classStore.ts:89-105`).
- **A server-side personal-data gate on `/api/class`.** `0004_prepared_class.sql:41-43`
  asserts as fact that nothing in the row is personal because `saveable()` refuses it.
  `namesInSpine`, `remembersASession` and `saveable` live in
  `packages/class-prep/src/save.ts:129`, `:217` and `:235` respectively, and only `saveable` is
  ever called, from the browser alone
  (`apps/classroom/src/screens/LiveClass.tsx:135`; `apps/classroom/prep5.ts:113`); the other
  two run only inside it. `checkSavedClass` (`packages/relay/src/relays.ts:383-471`) checks
  id, entry fields, file count, byte total, path allow-list, encoding and markup, and calls
  neither. The bucket is created `public = true` (`0004:60-62`) and its storage select policy
  has no `to` clause, so it applies to `public` including `anon` (`0004:68-70`): the whole
  bucket is enumerable, not merely readable by known URL.
- **Any moderation, overwrite or delete path for a kept class.** `prepared_class` has a
  select policy and no write policies, the bucket has a select policy and no write policy,
  `keepClass` treats a 409 as success, and no tool in `tools/bin` can remove a row or an
  object. Combined with `topic_ref` being unique and `resolution=ignore-duplicates`, one
  bad class permanently occupies a topic: a wrong-but-valid one is taught to every later
  student, and one that fails `validateLesson` gives each of them "not available right now"
  (`apps/classroom/src/lib/content.ts:201`), forever.
- **`org_id` on `student_state` (0001), `relay_usage` (0003), `usage_event` (0008) and
  `prepared_class` (0004).** `0013:18-24` already names this as the pattern and lists
  these four among the tables that skipped it (its fifth, `model_price`, is prices and has no
  tenant to carry). All of them hold zero or near-zero rows today, which is the only moment
  this is cheap.
- **Every column five other PRDs are already writing against.** `usage_event.prep_id`,
  `usage_event.bucket`, `learning_session.prep_id`, the widening of `usage_event.provider`
  to admit `'self'`, `fixed_cost`, `billing_mandate`, `membership.tier` and a table for
  `PrewarmIntent` are all required by PRD 5 and PRD 6 and exist in no migration. Requirement
  9 lands them.
- **Any backup or restore.** Grep for `pg_dump`, `PITR`, `backup` or `point-in-time`
  across `supabase/`, `tools/`, `.github/` and the plans returns nothing. Meanwhile
  `pg_cron` runs `purge_old_ledger(90)` nightly at 19:30 UTC
  (`0009_retention_schedule.sql:39-43`) and `0006`'s own header says this data cannot be
  backfilled. There is an automated deleter and no automated copier, on a free tier.
- **Retention for anything except the ledger.** `purge_old_ledger` touches only
  `ledger_event` and `learning_session` (`0007:79-87`). `student_state` holds the
  student's name, class, notes, doubts, quiz history and a roughly 195 KB belief blob, but
  **not** the safety-flag log, which is `neverSync` and is actively deleted from the cloud on
  every connect (`apps/classroom/src/stores/flags.ts:65`;
  `apps/classroom/src/lib/sync.ts:125-127`). `usage_event` holds user id, session id and
  per-call timing forever.
- **Any consent, age or guardian record.** A case-insensitive grep of
  `supabase/migrations` for `consent|guardian|dob|date_of_birth|\bage\b` returns exactly one
  hit, the phrase "age a row" in a comment at `0007_retention.sql:78`. There is no column
  recording who consented, when, or on what basis, and no age gate anywhere in the auth
  path. The contest form's OTP-verified parent number covers the students who arrive through
  the contest and nobody else; the try-before-you-enrol door, which is the top of the funnel,
  models and tracks a minor with no consent record and no parent anywhere.
- **Any route by which a child's report reaches a human, and any route by which a
  disclosure does.** A grep for `mailto:`, `support@` or `grievance` across `apps/`,
  `packages/`, `supabase/`, `tools/` and `content/` returns nothing at all. `ReportSheet`
  calls `recordFlag`, which writes to localStorage and is marked `neverSync`. The safety
  screen is the sharper case: `packages/safety/src/screen.ts:250` returns a `support`
  verdict with Tele-MANAS 14416 and Childline 1098 (`:71-72`), the class stops, and
  `apps/classroom/src/lib/safety.ts:41-43` records a `distress` flag into the same local log.
  A child telling Qrie they are being hurt currently reaches nobody at all.
- **School auth in every part, including the teacher.** `organization.kind` already permits
  `'school'` and `membership.role` already permits `'teacher'` and `'admin'` (`0005:36,46`),
  and only `'solo'` and `'student'` have ever been written. There is no roster, no invite,
  no claim flow, and nothing that creates a school organization at all, so the "admin or
  teacher token" that roster import requires cannot be minted by any flow in the product.
  Every select policy on a student's own rows is `auth.uid() = user_id`, on `student_state`,
  `learning_session`, `ledger_event`, `usage_event`, `concept_state` and `learner_model`.
  The only others are three `using (true)` catalogue reads and the two `is_member(org_id)`
  tenancy reads on `organization` and `membership`. That last one is the only policy in the
  schema shaped to cross users at all, and it returns nothing extra today because every
  organization has exactly one member.

## What we are building

### The spend wall

MVP-1 does not ship without requirements 1 to 5. They are one thing said four ways: the
project must have a number it cannot spend past, a switch that stops it, an alarm before
either fires, and a floor under the number of identities that can each carry a budget. The
number and the switch are in; the rest is not.

**1. Make the ceiling a value, and make the dev server obey it.** The hard half shipped, as
described above. Three things finish it.

```sql
create table public.relay_control (
  id boolean primary key default true check (id),
  halted boolean not null default false,
  halted_reason text,
  global_units_per_day integer not null default 50000,
  max_concurrent_preps integer not null default 8,
  halt_on_ceiling boolean not null default true,
  speech_fallback_to_vendor boolean not null default false,
  updated_at timestamptz not null default now()
);
```

(a) `claim_relay` reads the one row first and uses `global_units_per_day` where it now uses
the `units_per_day_project` constant, and returns `capped` with `halted_reason` when
`halted` is true. Raising the ceiling becomes one `update` with no migration and no deploy,
which requirement 2 requires. The mirrored-constant test at `migrations.test.ts:505-514`
becomes an assertion that the table's **default** equals `UNITS_PER_DAY_PROJECT`, so the two
still cannot drift silently while the live value is free to move.
(b) `createMemoryLedger` (`gate.ts:328`) gains the project ceiling, because a dev server that
refuses differently from Postgres is the promise `0003:15-19` makes and does not keep.
(c) `npm run relay:deploy`, so the deployed function stops mapping `capped` to `rate`.

`relay_control.halted` does not replace `RELAY_DISABLED` and the two are deliberately
different switches. `RELAY_DISABLED` is an environment variable read by the host, so it
works when Postgres does not and it is the one to reach for at two in the morning;
`relay_control.halted` is inside the database, which is what lets requirement 4's alarm set
it without a human and without a credential held anywhere else.
*Why.* A cap that needs a migration to raise is a cap that gets removed under pressure at
the worst possible moment, which is the day the pilot opens.
*MVP-1.*
*Known when:* `update relay_control set global_units_per_day = 200000` changes what the
deployed relay allows within one request and no deploy; `update relay_control set halted =
true` returns 503 on every relay in under a second; and `packages/relay/tests/gate.test.ts`
asserts the memory ledger refuses with `capped` at the same total Postgres does.

**2. The ceiling is set from what Aarav can afford to lose in a day, and it must be raised
before the pilot.** Rs 500 a UTC day is the right number for self-serve MVP-1 and it is
deliberately, uncomfortably tight: at MVP-1's Rs 26.15 to 30.62 per student-hour it buys about
nineteen student-hours a day, or about sixteen cold topic preparations at PRD 6's planning
Rs 30 a topic. **It halts the school pilot on day one.** 500 students at roughly ten minutes
a day is about 83 student-hours a day, which at MVP-1 rates is roughly Rs 2,158 a day, more
than four times the ceiling. The number must be re-derived and raised before the pilot or the
contest opens, and the derivation must be written down; **PRD 6 owns that derivation** and
carries it in its runbook as a pre-contest checklist item. This PRD owns only making the
number raisable, which is requirement 1.

Two gates, stated here because they are the same decision: the contest may not open until
the ceiling has been raised to the cohort's derived figure **and** the Piper VPS has landed,
and the pilot may not open until the same is true of 500 bound students.
*Why.* A cap nobody can raise gets removed; a cap with no stated derivation gets raised
carelessly; a cap left at its MVP-1 default on pilot day stops 500 children's lessons at
about eleven in the morning.
*MVP-1.*
*Known when:* `relay_control.global_units_per_day` and one docblock carry the number and its
derivation, and the first time it fires it fires because the product grew, not because
somebody attacked it.

**3. Sign-up costs something, and a tier decides what it may spend.**
Turn on Supabase Auth's CAPTCHA protection (Turnstile) for sign-up and anonymous sign-in;
lower the anonymous sign-in rate limit in Auth > Rate Limits to a per-hour-per-IP figure
that a classroom can live with (30 is generous for a shared school NAT and murder for a
script); and add the column the gate needs to know who is paying:

```sql
alter table public.membership
  add column tier text not null default 'trial'
  check (tier in ('trial','paid','school','lapsed','staff'));
```

`'trial'`, not `'full'`. **PRD 6 owns the five values and their budgets**
(`UNITS_PER_DAY_BY_TIER`); this PRD owns the column, the check constraint, the resolution
of the tier inside `admit()` from the membership row it already touches, and
`claim_relay`'s fourth argument `p_tier text`. The three-argument form is kept for one
release so a deploy and a migration can cross.
*Why.* Requirement 1 bounds total spend; this bounds how fast an attacker reaches it and
keeps a real student from being refused because somebody else exhausted the day. A default
outside the union would have resolved every row created before a tier was assigned to no
budget at all.
*MVP-1.*
*Known when:* `tools/bin/verify-deploy.mjs:89-96` and `live-test.mjs:31` stop working,
which is the point, and are rewritten to use a service_role-minted fixture user that is
deleted at the end of the run rather than a fresh anonymous account per invocation; and a
membership row with no tier written cannot exist.

**4. An alarm, inside Postgres.** `pg_net` plus `pg_cron`, matching the argument
`0009_retention_schedule.sql:12-19` already makes for keeping the retention job in the
database: a scheduler outside the database means a service_role key held by a third party
to run one statement. An hourly job reads `relay_budget_day.units` for today and, on each of
the 50%, 80% and 100% crossings exactly once per day, posts to a webhook URL held in a
one-row `ops_webhook` table. Crossing 100% also sets `relay_control.halted = true` if
`halt_on_ceiling` is on, which it is by default.

Only the ceiling alarm lives here. **The daily cost report and its thresholds are PRD 6's**
(`cost.yml`, `docs/ops/cost-log.md`); this PRD does not post a second daily message about
`cost_per_student_hour` and does not own a second webhook.
*Why.* Rs 500 a day unnoticed for a month is Rs 15,000. The cap without the alarm means the
first thing anybody hears is a student saying the class will not start, which is the exact
failure `gate.ts:10-11` describes.
*MVP-1.*
*Known when:* forcing `relay_budget_day.units` past 50% produces a message on Aarav's phone
within the hour, and the message names the number.

**5. Bound the direct PostgREST write surface.** `student_state` today is unmetered,
unbounded jsonb behind a `for all` policy. Three changes: a `check` constraint capping
`pg_column_size(value)` at 512 KB, which is comfortably above the measured 195 KB belief
blob; a `key` allow-list constraint naming the stores that legitimately sync, so a caller
cannot invent a thousand keys; and a per-user row cap enforced by a `before insert` trigger
at 64 rows. `ledger_event` gets a row-count-per-day-per-user ceiling in the same trigger
shape, high enough that a real class never touches it (a measured class produces order 200
events; set it at 20,000 a day).
*Why.* The relay meter is presented, in `gate.ts` and in 0003, as the project's answer to
denial of wallet. It only covers calls that go through the relay. This is the other half,
and it is a free-tier Postgres.
*MVP-1.*
*Known when:* a test posting 600 KB of jsonb to `student_state` with a valid student JWT is
refused by the database, not by the client.

### Concurrency, which is what breaks first at 100 students

**6. A per-topic prep lock, admission control, and a read that takes no lock.**

```sql
create table public.prep_lock (
  topic_ref text primary key,
  user_id uuid not null references auth.users on delete cascade,
  org_id uuid not null references public.organization on delete cascade,
  taken_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create or replace function public.take_prep_lock(
  p_topic text, p_user uuid, p_org uuid, p_ttl_seconds integer default 180
) returns table (granted boolean, reason text, holder uuid, expires_at timestamptz, running integer)
```

`take_prep_lock` deletes expired rows, counts the unexpired ones, refuses with
`reason = 'busy'` when that count is at or above `relay_control.max_concurrent_preps`,
otherwise inserts `on conflict (topic_ref) do nothing` and reports whether it won. A new
relay route `POST /api/prep/lock` (0 units, rate limited by the existing per-minute window)
is the only caller, so the client never touches the table. A matching
`release_prep_lock(p_topic, p_user)` runs on success and on failure; the TTL is what covers
a browser that closed mid-prep.

**The key is `topic_ref`, of the form `<syllabus>/<chapter>/<topic>`, everywhere and in
every PRD.** Never the derived class id: two students reaching one topic by different
derivations must take one lock, which is the entire point of the lock.

Painting a badge is not taking a lock, so there is a second route that only reads:
`GET /api/prep/state?topicRefs=a,b,c` answers ready, preparing or absent for a screen's
worth of topics in one round trip, joining `prepared_class` (published rows only) against
the unexpired `prep_lock` rows. PRD 1 renders it on every topic affordance on Home,
Syllabus, Chapter, Search and AskBox; PRD 4 supplies `nearestReady`.

*Why.* 16.55 is CLASSES PER STUDENT-HOUR, not relay calls: the measured class is 3.6 minutes
on task, so a student-hour is 16.55 of them. Prep contributes `16.55 x Rs 30 / S` to the
student-hour, which is Rs 496.5 divided by S, the number of students sharing a topic. **At
S = 1 that is Rs 496.5 per student-hour, ninety-nine times the ceiling**, and it is the
default state of a self-serve student on a cold topic today. Without a lock, S students on a
cold topic produce S preparations and S-1 discarded results, which is the arithmetic running
backwards. It is also the thing that breaks first: 40 parallel relay calls per student, no
queue anywhere, and a project ceiling that a burst of sixteen simultaneous cold preps
exhausts by itself.
*MVP-1.*
*Known when:* a test firing ten concurrent `/api/prep/lock` calls for one topic grants
exactly one; firing twenty for twenty different topics grants eight and refuses twelve
with `reason: 'busy'` and a retry hint; and `GET /api/prep/state` for thirty topic refs
returns in one round trip and takes no lock, proven by the table being empty afterwards.

**7. Keep is asynchronous, and publication requires a server-side pass.** This PRD owns the
columns, the policy and the operator tool. **PRD 4 owns the reviewer prompt and its verdict
content**, and runs it in-pipeline for live prep, so a student is never taught an unreviewed
class, and server-side for the pre-warm runner, which prepares classes with no student in
front of them.

One migration, folded into 0017, adds to `prepared_class`: `review_status text not null
default 'pending' check (review_status in ('pending','published','retired'))`,
`published_at timestamptz`, `review_note text`, `review_verdict jsonb`,
`reviewed_at timestamptz`, `retracted_at timestamptz` and `version integer not null
default 1`. The `unique (topic_ref)` constraint becomes `unique (topic_ref, version)`, so a
corrected class supersedes rather than fights a 409. The catalogue select policy becomes
`using (review_status = 'published' and retracted_at is null)`, and **the catalogue read at
`apps/classroom/src/lib/content.ts:96` does change**: it filters `retracted_at is null` and
takes the greatest `version` per `topic_ref`.

`retract_prepared_class(p_topic text, p_version integer, p_reason text)`, service_role only,
sets `retracted_at` and records the reason; `tools/bin/retract-class.mjs` is the one operator
tool and removes the storage objects in the same operation. One tool, one name.
*Why.* A wrong class is kept permanently today because `topic_ref` is unique and `keepClass`
treats a 409 as success, and there is no operator action short of hand-editing the database.
PRD 6's pre-warm runner writes `review_status = 'pending'` and never publishes directly, and
calls this gate non-negotiable.
*MVP-1.*
*Known when:* `npm run class:retract -- <topicRef>` removes a class from the catalogue and
from the bucket, the same topic can then be prepared afresh at version 2, and a class whose
review fails never appears in `fetchKeptClasses` (`content.ts:96`).

### The migrations that must land while the tables hold zero rows

**8. 0014 is applied. Keep the test honest.** `concept_state.answer_observations` and
`concept_state.doubt_count` return HTTP 200 to a student token on the deployed project.
What is left is the reason it went unnoticed for so long: `apps/classroom/tests/migrations.test.ts`
asserts the file's text and never the database, so no test could have caught it and none can
catch the next one. Add a live assertion to `relay:verify` that selects each column added by
the last applied migration and fails on 42703.
*Why.* `0014`'s own header: without these columns a `ConceptState` round-tripping through
`concept_state` loses the evidence gate and the measured 0.46 defect walks back in. It is
applied; the next one will not be, unless something looks.
*MVP-1.*
*Known when:* `relay:verify` fails against a project missing a column that the newest
migration adds.

**9. Two migrations, both of which must land before the first real student.** 0015 is taken
by the spend cap, so these are 0016 and 0017.

`0016_org_id_everywhere.sql`:

```sql
create or replace function public.org_of(p_user uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select m.org_id from public.membership m where m.user_id = p_user
   order by m.created_at limit 1
$$;
revoke all on function public.org_of(uuid) from public, anon, authenticated;
grant execute on function public.org_of(uuid) to service_role;

alter table public.student_state  add column org_id uuid not null references public.organization on delete cascade;
alter table public.relay_usage    add column org_id uuid not null references public.organization on delete cascade;
alter table public.usage_event    add column org_id uuid not null references public.organization on delete cascade;
alter table public.prepared_class add column org_id uuid references public.organization on delete set null;
create index on public.usage_event (org_id, at desc);
create index on public.student_state (org_id);
```

`student_state`'s policy becomes
`using (auth.uid() = user_id and public.is_member(org_id)) with check (same)`, and
`createSupabaseBackend` (`apps/classroom/src/lib/supabase.ts:83-91`) sends `org_id` using
the same `resolveOrg` the ledger drain already has (`ledgerSync.ts:103-117`).
`claim_relay` and `record_usage` fill theirs from `org_of(p_user)` inside their own
inserts, so neither `packages/relay/src/gate.ts` nor `usage.ts` changes at all.
`prepared_class.org_id` is nullable and records who prepared it, which is what makes a
school able to answer "which of these classes came from our students".

`0017_metering_and_entitlement.sql` carries every object another PRD is already writing
against, plus requirement 7's columns:

```sql
alter table public.usage_event      add column prep_id uuid;
alter table public.usage_event      add column bucket text not null default 'live'
  check (bucket in ('live','warm'));
alter table public.usage_event      drop constraint usage_event_provider_check,
  add constraint usage_event_provider_check
  check (provider in ('vertex','openrouter','storage','self'));
alter table public.learning_session add column prep_id uuid;
create index on public.usage_event (prep_id);

create table public.fixed_cost (
  id uuid primary key default gen_random_uuid(),
  label text not null, inr_per_month numeric not null,
  from_date date not null, to_date date
);

create table public.prewarm_intent (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization on delete cascade,
  topic_ref text not null,
  klass integer,
  expected_students integer not null,
  not_before timestamptz not null,
  due_at timestamptz,
  source text not null check (source in ('assignment','institute_syllabus')),
  created_at timestamptz not null default now(),
  unique (org_id, topic_ref, not_before)
);
```

`billing_mandate` lands in the same migration in the shape PRD 6 requirement 15 writes, and
`fixed_cost_per_student_hour(p_days)` beside `cost_per_student_hour`. PRD 5 writes
`prewarm_intent` rows through a service-role endpoint; PRD 6's runner reads them ahead of its
own file manifest. Without the table the teacher's assignment button, which is the single
largest lever on S, writes to nothing.
*Why.* `0013:18-24` already names the `org_id` pattern and lists those four tables as the
ones that skipped it. Adding it later means a migration across a table of children's synced
state plus an RLS rewrite on a live product. Five of the objects in 0017 are hard
dependencies of PRD 6's cost apparatus and PRD 5's assignment flow, and both PRDs state that
this PRD writes them.
*MVP-1, and both must land before the school pilot writes a row.*
*Known when:* all four tables have `org_id` with a `not null` where stated; `select prep_id,
bucket from usage_event limit 0` returns 200; a `usage_event` row with `provider = 'self'`
inserts; and `relay:verify` asserts all of it.

**10. `resolveOrg` must stop guessing.** `ledgerSync.ts:103-117` does
`.select('org_id').eq('user_id', userId).limit(1).maybeSingle()`. Today every user has
exactly one membership so this is correct by accident. The moment a student can be in a
school and also hold a solo org, it picks arbitrarily and a child's ledger events land in
the wrong tenant. Fix it at the source: `provision_solo_org` (`0005:88-110`) skips minting a
solo org when `new.raw_app_meta_data ->> 'org_id'` is present, and inserts the membership
into that org with the role and tier from `raw_app_meta_data` instead. `app_metadata` is
writable only by service_role, so a student cannot forge it. Then a school student has
exactly one membership and `resolveOrg` stays correct by construction rather than by luck.
*Why.* It is the cheapest possible fix for the worst possible bug class, and it is also the
only thing that writes the `app_metadata` every teacher-facing policy later depends on.
*MVP-1, in the zero-row window, ahead of the school routes that need it.*
*Known when:* a service_role-created user carrying `app_metadata.org_id` has exactly one
`membership` row, in that org, with that role and that tier.

### The class store and the public bucket

**11. The personal-data gate moves to the server.** `checkSavedClass`
(`packages/relay/src/relays.ts:383-471`) gains calls to `namesInSpine` and
`remembersASession`, which means `packages/class-prep/src/save.ts:129,217` either moves into
`packages/relay` or into a small shared package both can import. `namesInSpine` needs the
student's names to check against; the server does not have them and must not, so the
server-side form checks the structural half that does not need a name list (a second-person
recollection of a previous session, a proper-noun vocative in a beat) and the relay refuses
on it. The migration comment at `0004:41-43` is then rewritten to say what is actually
enforced.
*Why.* This is the identical defect class that caused the markup gate to be moved
server-side, and `packages/relay/src/markup.ts` spells out the reasoning verbatim. The
personal-data half was left behind, the bucket is `public = true` and world-enumerable, and
a free anonymous account can hand-POST a lesson containing a child's name into a permanently
public file keyed to a real topic.
*MVP-1.*
*Known when:* a POST of a lesson whose spine says "when we talked last time, Aditi" is
refused by the deployed relay, and the test lives in `packages/relay/tests/`.

**12. The dev class writer goes through the same door, and the allow-list learns about
languages.** `classWriter()` (`apps/classroom/vite.config.ts:225-270`) parses the body
itself, casts it, checks the id slug, and runs only `isAllowedClassPath` and `unsafeMarkup`.
It never calls `checkSavedClass`, so entry fields, file count, byte total, encoding, the
three-segment `topicRef` and `entry.id === saved.id` go unchecked, and it writes into
`content/`, which is committed and served to every student. Replace its two inline checks
with one `checkSavedClass` call. Do the same for `/api/icons` (`vite.config.ts:180`) or
delete the route, since `handleRelay` returns 501 for icons unconditionally
(`handler.ts:230-231`). While there: `UNITS.icons` (`gate.ts:97`) is charged by nothing
because the 501 is fourteen lines before `admit`, yet the icons line is inside the per-class
weight table that derives `UNITS_PER_DAY = 12_000`. Remove the price, remove the `RelayName`
member, and leave the `usage_event` check constraint alone because it costs nothing and a
migration does.

In the same pass, `isAllowedClassPath` (`markup.ts:70-72`) admits narration audio under a
language segment, `generated/<lang>/<name>.(mp3|wav)` with `lang` in `('hinglish','en')`.
A class is planned once, language-neutral, and narrated per language: **one `prepared_class`
row per `topic_ref` regardless of language**, with N audio renders beneath the same class
key. PRD 4 owns the lesson-format change that makes the plan language-neutral; this
requirement owns only the storage shape, which must not be per-language rows because the
catalogue, the lock and S all key on the topic.
*Why.* The weaker validator guards the more durable artefact. A lesson written into
`content/` is committed and permanent. And a per-language class row would halve S, which is
the denominator the entire cost argument divides by.
*MVP-1.*
*Known when:* the dev writer refuses a class with 40 files; one test asserts that the dev
and deployed paths refuse the same eight malformed inputs; and a POST carrying
`generated/en/beat-3.mp3` and `generated/hinglish/beat-3.mp3` under one class id is accepted
and produces exactly one catalogue row.

**13. Fences on the OpenRouter fallback.** The Vertex model allow-list, the 256 KB request
cap and the 24k output clamp all sit inside `if (deps.vertex)` (`handler.ts:265-269`;
`vertex.ts:42-47,187-189,359`). When `GOOGLE_SERVICE_ACCOUNT_JSON` is absent or unparseable
the Edge Function logs and continues without vertex
(`supabase/functions/relay/index.ts:73-79`) and `handler.ts:291` falls through to
`llmRelay`, which checks method and key presence and forwards the body verbatim
(`relays.ts:86-103`); `capMaxTokens` returns the body unchanged when the caller already set
`max_tokens` (`relays.ts:73-78`). Move the byte cap and a model allow-list above the
`if (deps.vertex)` branch so both paths carry them, and make `capMaxTokens` clamp rather
than defer: `parsed.max_tokens = Math.min(parsed.max_tokens ?? CAP, CAP)`.
*Why.* The fences are described as the thing that stops a free identity naming an expensive
model or pasting a megabyte of billed input, and they disappear exactly when a
misconfiguration removes them, which is the moment nobody is watching.
*MVP-1.*
*Known when:* a request naming `openai/gpt-5` or `max_tokens: 1000000` is refused with
`deps.vertex` undefined.

**14. Price the public bucket before it has anything in it.** The classes bucket is the
content moat and an unpriced egress bill. Two things: put the storage origin behind
Cloudflare (or Supabase's own CDN on Pro) so repeat reads are cache hits rather than billed
egress, and keep a `bucket_egress` daily row written by a `pg_cron` job reading Supabase's
usage API, so the number exists before it is a surprise. Remove the world-listability: the
select policy at `0004:68-70` has no `to` clause, so it applies to `public` including `anon`
and its predicate is the bucket id alone. Replace the list permission with read-by-known-key
only; the catalogue row is what tells a browser the key, and a browser has no reason to
enumerate.
*Why.* Every class must stay free to fetch, because that is what makes preparation CAPEX
rather than COGS. Enumerable is a different property from public, and it is the one that
turns the moat into a scrape.
*MVP-1 for the policy, MVP-2 for the CDN and the measurement.*
*Known when:* an anon-key `POST /storage/v1/object/list/classes` returns 400 or an empty
list, while `GET .../classes/<id>/lesson.json` still returns 200 with no Authorization
header.

### School auth, in full

This is the biggest new build in this PRD and the thing the MVP-2 demo cannot happen
without. The shape is forced by two facts: the students are minors, so no email and no
password; and the school holds the relationship, so the school is the data fiduciary under
DPDP and Qrie is the processor, which is what removes the per-child verifiable-consent
burden from us. **Teachers and school admins are the opposite case: they are adults, they
sign in with email and password, and requirement 27 is the door that lets them exist at
all.**

**15. The school tenancy tables.** One migration, `0018_school.sql`.

```sql
-- organization.kind = 'school' and membership.role in ('admin','teacher') are
-- already legal (0005:36 and 0005:46). Nothing about 0005 changes.

create table public.school_class (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization on delete cascade,
  label text not null,                    -- '9-A'
  klass integer not null check (klass between 6 and 12),
  join_requires_pin boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, label)
);

create table public.roster_student (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization on delete cascade,
  class_id uuid not null references public.school_class on delete cascade,
  display_name text not null,             -- as the school wrote it; shown on the picker
  roll_no text,
  -- The school's own stable key for this child, when it has one. What survives a
  -- re-import and a section change: the identity is matched on this, never on the
  -- row id, so a re-import moves a claimed seat rather than orphaning a ledger.
  school_ref text,
  pin_hash text not null,                 -- bcrypt of a 6-digit PIN; the PIN itself is
                                          -- shown once at import and never stored
  -- THE SIGN-IN SECRET, PER ROW. 32 random bytes minted when the seat is created and
  -- never derived from anything. Readable by service_role only, never returned by any
  -- route, rotatable one child at a time. See requirement 17.
  auth_secret text not null default encode(gen_random_bytes(32), 'base64'),
  auth_secret_rotated_at timestamptz,
  claimed_by uuid references auth.users on delete set null,
  claimed_at timestamptz,
  attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  unique (class_id, roll_no),
  unique (org_id, school_ref)
);
create unique index roster_student_claimed on public.roster_student (claimed_by)
  where claimed_by is not null;

create table public.staff_invite (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization on delete cascade,
  email text not null,
  role text not null check (role in ('admin','teacher')),
  token_hash text not null,
  invited_by uuid references auth.users on delete set null,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  unique (org_id, email)
);

create table public.class_teacher (
  class_id uuid not null references public.school_class on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  primary key (class_id, user_id)
);
```

All four are service_role write only. `school_class` gets a select policy
`using (public.is_member(org_id))`; `class_teacher` carries no `org_id` of its own, so its
select policy reaches the org through its class,
`using (exists (select 1 from public.school_class sc where sc.id = class_id and
public.is_member(sc.org_id)))`. No student-readable policy at all on
`roster_student` (the picker is served by the relay, which returns display names and
nothing else) or `staff_invite`.
*Why.* `membership` has no `id` column, its primary key is `(org_id, user_id)`, and that is
fine: a roster row is not a membership, it is a seat waiting to be claimed, and it needs an
id of its own because a PIN slip has to name something.
*MVP-1 for the tables, against zero rows, because that window closes for good; MVP-2 for
everything that fills them.*
*Known when:* a school org, two classes, sixty roster rows and two teachers exist on the
deployed project and `is_member` answers correctly for each.

**16. Roster import, and a re-import that does not orphan a child.** `POST /api/roster`
(admin or teacher token, org taken from the token's membership and never from the body)
accepts `{ classLabel, klass, students: [{ displayName, rollNo?, schoolRef? }] }` from a CSV
the school already has. The relay mints a 6-digit PIN per student, stores only its bcrypt
hash, and returns the PINs once, in a printable payload the teacher prints and cuts into
slips. Re-importing is an upsert matched on `school_ref` first and `(class_id, roll_no)`
second; it never regenerates a PIN or an `auth_secret` for a claimed row and never reveals
an existing one. A lost PIN is reset individually through `POST /api/roster/reset`.

**A claimed seat moves, it is never re-minted.** A student promoted from 9-A to 10-A, or
re-imported with a new roll number, keeps the same `roster_student.id`, the same
`claimed_by` and therefore the same `user_id`, `org_id` and ledger; only `class_id` and
`roll_no` change. Section changes are routine in Indian schools, so an identity that breaks
on one breaks in the first term of normal use.
*Why.* 500 students at the pilot school, entered by a school clerk from a spreadsheet they
already maintain. Anything that needs a per-child email or a per-child parent action will
not happen, and that is the whole reason this channel is different from the contest funnel.
*MVP-2.*
*Known when:* a 500-row CSV imports in one request under ten seconds and returns 500 PINs
exactly once; a second import of the same file returns zero new PINs; and a third import
that moves thirty students to a new section leaves all thirty `claimed_by` values and every
one of their `ledger_event` rows exactly where they were.

**17. The claim flow: a student joins by picking themselves, and no single secret stands
behind 500 children.** Three routes, all in `packages/relay` behind the same `handleRelay`
seam so they are metered and rate limited like everything else.

- `GET /api/join/:joinCode` returns `{ school, classes: [{ id, label }] }`. The join code is
  a short per-org string the teacher writes on the board. No auth.
- `GET /api/join/:joinCode/:classId` returns
  `{ pickerToken, students: [{ handle, displayName, rollNo, claimed }] }`. **`handle` is an
  opaque per-session value, not the roster row id**: `HMAC-SHA256(pickerSecret, pickerToken ||
  rosterStudentId)` truncated, valid for the life of that picker token (ten minutes) and
  meaningless afterwards. A `roster_student.id` is never returned by an unauthenticated
  route. Display names only, rate limited per IP at 30 a minute, because this is the one
  unauthenticated read that lists children's first names and it must not be scrapeable at
  speed.
- `POST /api/join` with `{ pickerToken, handle, pin }`. The relay resolves the handle back to
  a roster row, checks the PIN against `pin_hash`, and on success, as service_role: creates
  an `auth.users` row with a synthetic non-routable email
  (`<rosterStudentId>@roster.curie.invalid`), `email_confirm: true`, and **the row's own
  `auth_secret` as the password**; sets `app_metadata: { org_id, role: 'student', tier:
  'school', roster_student_id }`, which the trigger from requirement 10 reads to write the
  school membership instead of a solo org; then exchanges that secret for a session
  server-side and returns `{ access_token, refresh_token, expires_in }` for the browser to
  hand to `supabase.auth.setSession()`. The secret never reaches the child, the device or a
  log. Five wrong PINs locks that roster row for fifteen minutes (`attempts`,
  `locked_until`), and the per-IP limit covers the rest.

**Rotation, written down because a secret with no rotation procedure is a secret that is
never rotated.** `auth_secret` is per row, so rotating one child is
`update roster_student set auth_secret = encode(gen_random_bytes(32),'base64'),
auth_secret_rotated_at = now() where id = $1`, followed by the Admin API password update for
that user; nobody else is affected and nothing else is invalidated. Rotating a whole class or
a whole org is the same statement with a wider `where`, run by `tools/bin/rotate-roster.mjs`,
which reports how many rows it touched and re-signs each user. `CURIE_ROSTER_SECRET` does not
exist and must never be introduced.
*Why.* No email, no password, no phone for a minor. The school's own list is the identity,
the PIN slip is the credential, and the school already knows which child is which, which is
precisely the thing we must not know independently. A credential derived from one env var
would have made that env var the entire security of 500 children's accounts, with the id half
served to anyone holding a join code and no recovery path, because no child has an email or
phone to reset with.
*MVP-2.*
*Known when:* a student on a shared tablet joins, teaches, signs out, and rejoins to the
same `user_id` and the same `org_id`; a wrong PIN five times returns 429 with a stated wait;
no response body from any unauthenticated route contains a `roster_student.id`; and
`npm run roster:rotate -- --class 9-A` lets all thirty students sign in afterwards and
nobody else notices.

**18. Teacher RLS: read your own students and nobody else.** The existing "read your own"
policies stay exactly as they are; this is purely additive.

```sql
create or replace function public.my_student_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct r.claimed_by), '{}')
    from public.membership me
    join public.school_class sc on sc.org_id = me.org_id
    join public.roster_student r on r.class_id = sc.id
   where me.user_id = auth.uid()
     and me.role in ('admin','teacher')
     and r.claimed_by is not null
     and (me.role = 'admin'
          or exists (select 1 from public.class_teacher ct
                      where ct.class_id = sc.id and ct.user_id = auth.uid()))
$$;
revoke all on function public.my_student_ids() from public, anon;
grant execute on function public.my_student_ids() to authenticated;

create policy "a teacher reads their students' sessions" on public.learning_session
  for select using (user_id = any (public.my_student_ids()));
-- and the same four words on ledger_event, concept_state and learner_model.
```

It is a no-argument `STABLE` function on purpose: a per-row `teaches(user_id)` predicate
cannot be hoisted and would be a function call per ledger row, which at a term's worth of
evidence is a scan nobody wants. `= any(array)` is evaluated once per statement.
`SECURITY DEFINER` for the same reason `0005:56-64` gives: reading `membership` from inside
a policy that touches `membership` recurses.

**Not `student_state`.** Those rows hold the child's name, their notes, their doubts and their
raw belief blob, and a teacher does not need any of it. Not the safety-flag log either: that
one never reaches the cloud at all, and requirement 28 is deliberate about where a disclosure
does go. The progress card is built from `concept_state` and `ledger_event`, which are
derived, outcome-level and exactly what a teacher should see. This is a deliberate line and it
should stay drawn.
*Why.* MVP-2's demo is a teacher looking at her own class. Every select policy on a student's
own rows today is `auth.uid() = user_id`, and the only policy shaped to cross users at all is
`membership`'s `is_member(org_id)`, which returns nothing extra while every org has one member.
So without this there is nothing to show her, and with the wrong version of this there is
everything to show her.
*MVP-2.*
*Known when:* teacher A of 9-A reads 30 students' concept states and 0 of 9-B's; a student
reads their own and nobody else's; `anon` reads none; and the query plan for a teacher's
class-wide read calls `my_student_ids` once.

**27. A school, and a teacher who can sign in to it.** Nothing in the product creates a
school organization, and `staff_invite` is a table nothing writes. So the roster import in
requirement 16 asks for an "admin or teacher token" that no flow can mint, and MVP-2's demo,
which is one teacher looking at her own class, has no teacher. Three pieces.

- **Provisioning**, by us, not self-serve: `tools/bin/provision-school.mjs` creates the
  `organization` with `kind = 'school'`, a join code, `membership.tier = 'school'` for every
  member it later gains, and the first `staff_invite` for the head teacher, and prints the
  invite link. A school is a signed pilot agreement, so its creation is an operator action
  with a contract behind it and not a form.
- **`POST /api/staff/invite`** `{ email, role: 'admin' | 'teacher', classLabels?: string[] }`,
  admin token only, org from the token. Writes `staff_invite` with a bcrypt `token_hash`, a
  7-day expiry and `invited_by`, and sends the link to that address. An admin may invite;
  a teacher may not.
- **`POST /api/staff/claim`** `{ token, email, password }`. Verifies the token against its
  hash and its expiry, creates the `auth.users` row as service_role with
  `app_metadata: { org_id, role, tier: 'school' }` so requirement 10's trigger writes the
  membership into the school rather than minting a solo org, writes `class_teacher` rows for
  any `classLabels` on the invite, sets `claimed_at`, and returns a session. **Email and
  password, chosen by the adult, at least 12 characters, and a password reset that works,**
  because unlike a student a teacher has an inbox.

PRD 2 builds the sign-in and claim screens; PRD 5 states which role each teacher-facing
surface requires. Students never see any of this: they pick themselves off a roster.
*Why.* This is the hole that spans three PRDs, which is exactly why each assumed another
owned it. The school cannot be set up, the roster cannot be imported, `class_teacher` is
never written, and `my_student_ids()` returns an empty array for everyone, so the whole of
requirement 18 is unreachable.
*MVP-2, and before requirement 16, which depends on a token it mints.*
*Known when:* a fresh school org, one invite email, one claim, and the head teacher imports
a 500-row roster in the same sitting without anybody touching the SQL editor; a teacher's
token is refused by `POST /api/staff/invite`; and an expired or already-claimed token is
refused with a message that says which.

### DPDP, consent, retention and the grievance route

**19. A consent record that exists, and a door that cannot be walked through without one.**

```sql
create table public.consent_record (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization on delete cascade,
  student_user_id uuid references auth.users on delete cascade,
  basis text not null check (basis in ('parent_otp','school_fiduciary')),
  parent_name text,
  parent_phone text,                       -- E.164, only for basis = 'parent_otp'
  phone_verified_at timestamptz,
  consent_text_version text not null,      -- 'dpdp-2026-09-a'
  consented_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  source text not null check (source in ('contest_form','self_serve','roster_import'))
);
```

Service_role only, no select policy for `authenticated` at all. Two bases, because there are
two channels. The contest funnel writes `parent_otp` with the OTP-verified parent number
from the enrolment form, which is the artifact DPDP needs for verifiable parental consent
and is the same number the progress card and the RBI pre-debit notification travel down.
The school channel writes `school_fiduciary` once per organization at pilot signing, with the
written agreement naming the school as fiduciary and Qrie as processor, and every roster
student inherits it. The consent text is versioned because a wording change must not
retroactively claim people agreed to something they did not see.

**The self-serve door, stated plainly.** Try-before-you-enrol stays open, because it is the
top of the funnel, but it is a **pre-consent** state and not a tier of its own. Before a
parent has verified a phone number, an anonymous minor **may**: browse the catalogue, play an
already-prepared class, ask the tutor inside it, and have their answers judged, with
everything kept on their own device. They **may not** have, because nothing writes it: a
`ledger_event` or `learning_session` row, a `concept_state` or `learner_model` row, a synced
`student_state` row, a name typed anywhere, a class kept under their id, a PostHog or Sentry
event carrying any identifier, or a doubt-tutor turn. The only server-side rows a pre-consent
student produces are `relay_usage` and `usage_event`, which are our meter and our bill and
carry no words they wrote. The account and those rows are deleted seven days after creation if
no consent record has arrived, by the same nightly job. `source = 'self_serve'` is what
`POST /api/enroll` writes when a student who started this way converts, and their device
drains its held ledger at that moment and not before.

*Why.* There is no column recording who consented, when, or on what basis anywhere in the
schema today, the product teaches minors, and the contest form covers only the students who
arrive through the contest. Consent before modelling is also what makes the assertion below
unqualified rather than riddled with exemptions.
*MVP-1 for `parent_otp` and the pre-consent rules; MVP-2 for `school_fiduciary`.*
*Known when:* no `ledger_event` row can exist for a `user_id` with no `consent_record`, a
nightly job asserts exactly that and shouts if it is false, and an eight-day-old anonymous
account with no consent record is gone.

**20. `/api/enroll` and `/api/enroll/otp`, and the number they travel down.** Built in
`packages/relay` behind `handleRelay`. `POST /api/enroll/otp` takes `{ parentPhone }` and
sends a code. `POST /api/enroll` takes the shape already published to Aarav in
`docs/prd/0-website-integration-contract.md` plus `{ otp }`; it verifies the code, creates
the student's `auth.users` row as service_role with `app_metadata.org_id` unset (so the
solo-org trigger runs as it does today), writes the `consent_record`, writes the
`student_state` row at key `ai-tutor:profile` **including its `org_id`, because the column is
`not null` and a client cannot know which organization it belongs to**, and returns
`{ ok: true, next: '/app/diagnostic' }`. The server decides `next`, always. The parent's
number lives on `consent_record` and nowhere else; it is never copied onto the student row,
never put in telemetry and never in a URL.

**The OTP vendor is a multi-week external dependency and this PRD picks it.** India's TRAI
DLT regime requires the sending entity, the sender header and every template to be registered
before a transactional SMS can be delivered, which takes weeks and is not ours to accelerate.
One vendor serves both the OTP and the progress card's delivery so there is one registration,
one header and one template set, not two. Registration starts the same week the entity exists,
because nothing downstream of the contest form happens until an OTP arrives: no account, no
consent record, no diagnostic, no card.
*Why.* One form doing three jobs is the design decision already made and communicated; this
is the half of it that lives here. And a dependency with a weeks-long external approval that
appears in no plan is the kind of thing discovered the week the contest is booked.
*MVP-1.*
*Known when:* a submission with an unverified OTP creates nothing; a verified one produces
exactly one user, one org, one membership, one consent record and one profile row carrying
`org_id`, in one transaction or none; and the DLT registration has a date and a ticket number
written down before the contest has a date.

**21. Retention that covers what is actually stored, and deletion that actually deletes.**
`purge_old_ledger` (`0007:65-92`) handles `ledger_event` and `learning_session` and nothing
else. Add `purge_old_usage(p_days integer default 400)` for `usage_event` (kept longer
because it is the cost record and holds no words a child wrote, and 400 days lets a
year-on-year comparison exist), and `purge_dormant_state(p_days integer default 540)` for
`student_state` and `relay_usage`, which clears a child's name and notes on an account that
has not been touched in eighteen months. Schedule both in the same `pg_cron` block as
`0009`. Extend `delete_own_account` (`0002`) to delete the `consent_record`, the
`prep_lock`, and to null the `roster_student.claimed_by` so the seat can be reclaimed.

**Deletion of a school-tenant minor is guarded, not self-serve.** A child on a roster cannot
delete their own account, because the account is the school's seat and a tap would end their
term's record; the request goes to `request_erasure`, which records it, notifies the school
admin and Aarav, and is executed by an operator. A parent or a school asking under DPDP uses
the same path. Deleting a school org cascades `roster_student`, so the export in PRD 5
happens first and the delete refuses if no export exists in the last 30 days.
*Why.* A retention policy that names only the table it was written for is worse than none,
and `0009`'s own header makes exactly that argument about `0007`. `student_state` holds the
student's name; `usage_event` holds user id, session id and timing forever; and "what happens
when a school leaves" is a question a principal asks before signing.
*MVP-1 for the jobs, MVP-2 for the erasure path and the export gate.*
*Known when:* a row written 541 days ago is gone the next morning and a test proves it
against a clock, not a comment; and a `delete from organization` for a school with no recent
export raises.

**22. A child's report reaches a human.**

```sql
create table public.child_report (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  session_id uuid,
  at timestamptz not null default now(),          -- the device's, as sent
  received_at timestamptz not null default now(), -- ours
  kind text not null check (kind in ('wrong','rude','unsafe','other')),
  note text not null,
  lesson_id text,
  topic_ref text,
  beat_id text,
  spoken_line text,
  release text,
  platform text check (platform in ('web','android')),
  status text not null default 'new' check (status in ('new','seen','actioned','dismissed')),
  actioned_at timestamptz,
  action_note text,
  unique (lesson_id, beat_id, at, user_id)
);
```

`POST /api/report` takes the agreed `ReportSubmission` in the Contracts section, writes it as
service_role, costs 0 units, is covered by the per-minute window and returns `202 { id }`.
The unique constraint is what makes the sheet's offline queue safe to retry. An hourly
`pg_net` job posts new rows to the ops webhook, and the published address receives the same
thing. For a school org a report becomes visible to that school's admins through the same
`my_student_ids()` predicate, **except** a report whose `kind` is `unsafe` and which the
safety screen also flagged as a disclosure, which goes only where requirement 28 sends it.
PRD 1 owns the sheet, its state vocabulary and its words; PRD 2 registers the route; PRD 6
publishes the address, triages what arrives and owns the 24-hour clock; **this PRD owns the
endpoint, the store, the copy of the legal and grievance text, and the named grievance
officer.** All of that copy is English.
*Why.* Google Play's generative-AI policy requires in-app reporting that reaches the
developer, and today `ReportSheet` writes to localStorage under a `neverSync` store and a grep
for `mailto:`, `support@` or `grievance` across the whole of `apps/`, `packages/`, `supabase/`
and `tools/` returns nothing at all. This is also the DPDP grievance route, which must be a
named person at a real address.
*MVP-1.*
*Known when:* a report filed in the app on the deployed project produces a message on
Aarav's phone and an email, the row is readable by no student but its author, and the same
report retried from the offline queue three times produces one row.

**28. A child who discloses harm reaches Aarav within minutes.** The detection is already
right and nothing about it changes: `packages/safety/src/screen.ts:250` returns a `support`
verdict, its reply carries Tele-MANAS 14416 and Childline 1098 (`:71-72`), and
`apps/classroom/src/lib/safety.ts:41-43` drops the model's own words in favour of it and
stops the class. What is missing is everything after that: `recordFlag` writes to
`flagStore`, which is `neverSync` (`apps/classroom/src/stores/flags.ts:65`) and is actively
deleted from the cloud on every connect (`apps/classroom/src/lib/sync.ts:125-127`), so the
sentence reaches nobody.

`POST /api/flag`, 0 units, ahead of the per-minute window rather than behind it, writing:

```sql
create table public.safety_flag (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  at timestamptz not null default now(),
  verdict text not null check (verdict in ('distress','redirect','cleaned')),
  lesson_id text,
  seen_at timestamptz,
  seen_by uuid references auth.users on delete set null,
  action_note text
);
```

**No transcript. Not the child's words, not the tutor's, not the matched phrase.** The row
carries a flag id, the student id, the org, the time and the verdict, which is the minimum
that lets somebody act, and nothing that turns a disclosure into a record a third party can
read. On a `distress` verdict a `pg_net` trigger sends Aarav an email and an SMS carrying
those five fields and a link, within minutes and not on an hourly cron.

**It does not go to the school, by default or otherwise, at MVP-1.** A disclosure is
sometimes about an adult at that school, so routing it there by the same predicate that
routes reports would be the worst possible default. Aarav decides what happens next, case by
case, until there is a written policy that says otherwise. `safety_flag` has no select policy
for `authenticated` at all; the local flag log stays exactly as it is, because the child's
own copy is theirs.
*Why.* This is the one sentence the product will receive that matters more than every other
line of code. Six documents cover spend caps in four places and none of them said who finds
out or how fast.
*MVP-1. This ships with the first real student or there is no first real student.*
*Known when:* a `distress` verdict on the deployed project produces an SMS and an email
within five minutes carrying the flag id, the student id, the org and the time and no words;
a school admin querying `safety_flag` gets zero rows; and no transcript exists anywhere to
be subpoenaed, leaked or read by us.

**29. A breach has a clock, and a school that leaves takes its data with it.** DPDP obliges
a fiduciary to notify the Board and every affected principal of a personal data breach, and
the whole school design rests on Qrie being a processor under the school's instructions,
which requires a contract with breach terms that does not exist yet. Three pieces, all of
them cheap and none of them optional before a pilot agreement is signed.

- **The DPA clauses**, in the pilot agreement: the school is fiduciary and Qrie is
  processor; the purposes Qrie may process for and no others; sub-processors named
  (Supabase, Google Cloud, the SMS vendor, Cloudflare); a breach notification obligation to
  the school within 24 hours of detection; deletion or return on termination; and an exit
  clause naming the export format and the window.
- **Detection queries**, so the clock can start: a nightly job that asserts every invariant a
  breach would violate. `anon` reads zero rows from each of the nine tables that hold
  personal data; `my_student_ids()` returns the empty array for a user with no staff
  membership; the classes bucket is not listable; no `student_state` row has an `org_id` its
  owner is not a member of; and the count of rows readable by each role has not changed
  shape. Each failure is a page, not a log line.
- **The clock itself** lives in PRD 6's runbook as a tenth failure mode beside the nine it
  already enumerates, because that is where somebody looks at two in the morning.
*Why.* The exposure is not hypothetical: the bucket is world-enumerable today, `is_member` and
`delete_own_account` answer the anon key today, and nothing anywhere would notice either.
*MVP-2, and before the pilot agreement is signed.*
*Known when:* the pilot agreement contains the six clauses, and deliberately breaking one
invariant on a scratch project pages within the hour.

### Durability and operations

**23. Backup and restore for `ledger_event`, and a rehearsal.** A GitHub Actions job,
nightly and offset from the 19:30 UTC purge, runs `pg_dump --data-only` restricted to
`ledger_event`, `learning_session`, `concept_state`, `learner_model`, `consent_record`,
`roster_student` and `prepared_class`, gzips it, and writes it to Cloudflare R2 in a different
account from Supabase. Thirty daily, twelve monthly. The service_role credential this needs is
the one thing `0009`'s argument does not cover, because a copy has to leave the database to be
a backup; use a dedicated read-only role with select on those seven tables and nothing else,
not `service_role`. Then rehearse it once, restoring into a scratch project and counting rows,
before the first real student.
*Why.* `0006:17-21` says this data cannot be backfilled, there is an automated deleter and
no automated copier, and the project is on a free tier. A bad `p_days`, a dropped table, a
paused project or a region incident permanently destroys the only asset the learner model is
derived from, and nothing would notice.
*MVP-1. This is not negotiable and it costs an afternoon.*
*Known when:* a restore rehearsal is written up with a row count and a date, and the
runbook says who runs it and how long it takes.

**24. The cost apparatus is PRD 6's.** Pasting `tools/sql/model_price.sql`, attributing prep
spend by `prep_id`, extending `verify-deploy.mjs` to assert `model_price` has rows, and the
`ledger:verify` / `usage:verify` / `cost:report` scripts are PRD 6 requirements 1 to 3. This
PRD ships only the migration those four things need, which is requirement 9's 0017, and
`bareModel`, which is already in. There is no `x-session-id` on a prep call and there cannot
be: `currentSessionId()` is deliberately null outside an open session, and `openSession` is
not called until the lesson exists. `prep_id` is the carrier.

**25. Close the loose grants and the drift guard.** `is_member` (`0005:76`) and
`delete_own_account` (`0002:25`) revoke from `public` and grant to `authenticated`, and
neither revokes from `anon`; `0011:86-92` explains why that does not close the door and
fixes it for one function only. Verified live: `rpc/is_member` returns 200 `false` and
`rpc/delete_own_account` returns P0001 "not signed in" to the anon key, meaning the body
executed. Impact today is nil because `auth.uid()` is null; the distance from nil is one
edit. Revoke both from `anon`. Separately, drop `@ts-nocheck` from
`supabase/functions/relay/index.ts:1` and add a `deno check` step, because the file's own
comment at `:110-117` claims a drift guard that line 1 suppresses. **`ci.yml` is PRD 6's**;
this is one step contributed to it, and it costs about fifteen seconds a run.
*Why.* Both are the same failure: a protection documented as working that is not.
*MVP-1.*
*Known when:* the anon key gets 42501 from both RPCs, and a deliberate breaking change to
`HandlerDeps` fails CI instead of producing a 500.

**26. Two smaller holes, fixed before they are worth exploiting.** (a) Cross-tenant ledger
denial of service: `ledger_event.session_id` has no foreign key and no check that the session
belongs to the inserting user (`0006:62`), while `ledger_event_session_seq` is a global
unique index (`0006:115-116`). A row inserted under an attacker's own `user_id` at a
victim's `(session_id, seq)` makes the victim's real event a 23505, which
`ledgerSync.ts:101` classifies as poison and `forgetRefused` (`:255-261`) discards permanently.
Session ids are client-minted and ride in the `x-session-id` header and in `?session=` on
every speech URL (`handler.ts:138-142`), so they are in edge logs. Fix: make the unique
index `(user_id, session_id, seq)` and add a policy predicate requiring the session to be the
caller's own. (b) Usage attribution is entirely client-controlled: `record_usage` inserts
`session_id` with no check that it belongs to `p_user` (`0008:83-89`), and `session_cost` and
`cost_per_student_hour` are computed off that column. Fix: put the session id inside the
signed speech ticket (`ticket.ts:22-25` gains `sessionId`) and have `record_usage` reject a
session that `org_of(p_user)` does not match.
*Why.* (a) is silent permanent data loss on a victim's device. (b) is harmless while nobody
is billed and is a direct fraud channel the day a credit is priced per learning minute.
*(a) MVP-2, (b) MVP-2.*
*Known when:* a forged `(session_id, seq)` collision under a second user is accepted rather
than poisoning the first, and a usage row naming another org's session is refused.

**30. The prize is recomputed on the server, from rows the student cannot write.** A prize
turns the ledger into a target, and `active_ms` is the student's own word about how long they
were paying attention. This PRD owns the job; **PRD 4 owns the metric itself and the anomaly
detector.**

- A `pg_cron` job under the service key recomputes every entrant's ranking metric from
  `ledger_event` and `learning_session` and writes it to `contest_standing (user_id, org_id,
  metric, computed_at, flags jsonb)`. **Never from `student_state`**, which the student
  writes, and never from a client-supplied total.
- The `active_ms` constraint, which is this PRD's half of the anti-gaming work: for any
  session, `active_ms` may not exceed `max(received_at) - min(received_at)` over that
  session's `ledger_event` rows plus a 120-second tolerance, and the sum of `active_ms` over
  a UTC day may not exceed 16 hours. `received_at` is Postgres's clock (`0006:69-75`); `at`
  is the phone's and is not admissible here. A session that violates either is written with a
  flag and excluded from the standing, not silently corrected.
- Daily, not at the end, so a pattern is visible while the contest is running and the
  shortlist is not the first time anybody looks.

The ranking metric is unassisted mastery gain per learning minute at assistance rung 0,
normalised by starting mastery and bracketed by class, and a panel reviews the shortlist. It
is **not** the Test 1 to Test 2 delta, which would reward failing Test 1 and would corrupt
the diagnostic the progress card rests on.
*Why.* `ledger_event` is client-written by design and defended by RLS and a unique id, not by
plausibility. Nothing in the six documents defended the number a prize is awarded on.
*MVP-1, with the contest, not after it.*
*Known when:* a fixture session claiming 90 minutes of `active_ms` inside 12 minutes of wall
clock is flagged and excluded; and the standing recomputed from `ledger_event` alone matches
a hand-computed figure for a real student.

**31. What the relay does when the voice queues.** The Piper box is one machine and a school
timetable is bursty. **PRD 6 owns the concurrency target, the load test, the queue and the
second box**; this owns what the relay says while a student waits.

`speechRelay` (`relays.ts:125-179`) hands the browser a stream from the box without reading
its status first, so a saturated box becomes a broken audio element. Three changes. (a) Read
the box's response status before streaming: a 429 or a 503 carrying `retry-after` is a
**queue**, not a failure, and is returned to the client as
`{ error: { message, reason: 'queued' }, retryAfterSeconds }` with a 503, which PRD 2 renders
as a wait with a number rather than as an error. (b) The vendor fallback fires only on a
connection failure or a 5xx with no `retry-after`, and is **off by default**, behind
`relay_control.speech_fallback_to_vendor`. The designed failure mode today is backwards: it
sends the bill back to Rs 141 per student-hour at exactly the moment the most students are on
the box. (c) Speech tickets are minted with the session id already inside them (requirement
26b), so a queued request that is retried does not re-mint and does not extend its own life.
*Why.* A student hearing the browser's robot voice is the one failure the box was built to be
indistinguishable from the vendor on, and a bill that spikes at peak is the opposite of a
lever.
*MVP-1 for (a) and (b), alongside the box itself.*
*Known when:* a box returning 503 with `retry-after: 20` produces a student-visible wait of
twenty seconds and no vendor call, and turning the fallback on in `relay_control` produces a
vendor call with no deploy.

**32. The relay serves the card and the teacher's board, including one page with no app and
no login.** PRD 5 specifies six endpoints and says this PRD mounts them behind `handleRelay`,
which is right because the relay already owns `/api/*` on the same origin. It also owns one
thing PRD 2 cannot supply: `/card/:token` must be **server-rendered HTML**, printable, on a
Rs 6,000 phone on 3G with nothing installed and nobody signed in, and PRD 2 is a Vite SPA with
no SSR anywhere. The Edge Function renders it from `progress_card.body` with inline critical
CSS, no JavaScript needed to read it, and a print stylesheet. PRD 1 supplies the Riso Pop
design of that page; PRD 2 adds the path to the origin map.

The token is PRD 5's `parent_link`: hashed at rest, bound to one `user_id`, 30 days, and every
read writes a `card_view` row. `POST /api/card/:token/verify` takes the last four digits of
the parent's number for a card richer than `thin`. `/api/teacher/*` requires a teacher or
admin token and scopes through `my_student_ids()`; a student token gets 403 from all of them.
*Why.* Six endpoints assigned to this PRD and absent from it, and a page the whole parent
channel depends on assigned to a client that cannot render it.
*MVP-2, with the card.*
*Known when:* `/card/<token>` renders readable, printable HTML with JavaScript disabled;
an expired token returns 410 with the sentence PRD 5 wrote; and a teacher's token reaches her
own class's board and 403 on another's.

## Contracts

What other PRDs consume from this one. These are the actual shapes, and where another PRD
owns a shape this document does not define a second one.

**`ClaimResult`, in `packages/relay/src/gate.ts:153-159`** (PRD 2 renders the refusal, PRD 6
reads the reason). This is what shipped, not a proposal:

```ts
export type ClaimResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'rate' | 'budget' | 'capped' | 'unavailable';
      retryAfterSeconds: number;
    };
```

`'capped'` is the project's day, not the student's, and carries **503** where `'rate'` and
`'budget'` carry 429, because it is our capacity and not their rate (`gate.ts:202-205`). The
kill switch is not a claim reason: `RELAY_DISABLED` short-circuits ahead of everything and
returns 503 with `{ error: { message, reason: 'disabled' } }` and `retry-after: 900`
(`handler.ts:203-216`). Requirement 31 adds `'queued'` on the speech path in the same
envelope. Every refusal is `{ error: { message, reason } }` with a `retry-after` header, and
PRD 2 renders `budget`, `capped`, `disabled` and `queued` as four different sentences,
because they are four different situations and only one of them is the student's doing.

`claim_relay` gains a fourth argument, `p_tier text`; the three-argument form is kept for one
release so a deploy and a migration can cross.

**Tier and its budgets are PRD 6's**, in `packages/relay/src/gate.ts`. This PRD stores the
column and resolves it in `admit()`:

```ts
export type Tier = 'trial' | 'paid' | 'school' | 'lapsed' | 'staff';

export const UNITS_PER_DAY_BY_TIER: Record<Tier, number> = {
  trial: 2_500, paid: 5_000, school: 3_000, lapsed: 300, staff: 20_000,
};

/** What a refusal means, so the client can degrade instead of stopping. */
export type Degrade = 'none' | 'no-new-topics' | 'recorded-voice-only' | 'read-only';
```

`membership.tier text not null default 'trial' check (tier in
('trial','paid','school','lapsed','staff'))`. The default is a member of the union, so no row
can exist with no budget.

**The prep lock and the prep read** (PRD 2 calls them, PRD 4 depends on the lock for the prep
sequence, PRD 1 renders the read). **The key is `topic_ref` everywhere, never the derived
class id.**

```ts
// request
POST /api/prep/lock   { topicRef: string }        // "<syllabus>/<chapter>/<topic>"
// response 200
{ granted: true;  expiresAt: number }
{ granted: false; reason: 'held' | 'busy'; retryAfterSeconds: number; aheadOfYou?: number }
// then, on either success or failure:
POST /api/prep/release { topicRef: string }
```

```ts
// apps/classroom/src/lib/content.ts : the catalogue-first ask.
// Fed by: GET /api/prep/state?topicRefs= (a read, never a lock).
// nearestReady produced by: PRD 4, as a pure function over the outcome map.
export type PreparedState =
  | { status: 'ready'; topicRef: string; preparedAt: string }
  | { status: 'preparing'; topicRef: string; startedAt: string } // join, never start a second
  | { status: 'absent'; topicRef: string; nearestReady?: string };
export function preparedState(topicRef: string): PreparedState;
```

**The enrolment hand-off is one row, not three payloads.** There is exactly one carrier
between the marketing site, the relay and the app: the `student_state` row at key
`ai-tutor:profile`, whose `value` is a `StudentWorkspace`. `/api/enroll` writes it
server-side and supplies `org_id`, because `student_state.org_id` is `NOT NULL` and a client
cannot know which organization it belongs to. Both onboarding paths write the identical
shape. There is no separate contest type and no second profile shape.

```ts
// apps/classroom/src/lib/workspace.ts : the agreed enrolment hand-off.
// Written by: POST /api/enroll (site door), Onboarding.tsx (self-serve door),
//             the roster claim (school door). All three write this and nothing else.
// Carried as: student_state { user_id, org_id, key: 'ai-tutor:profile', value, updated_at }
// Consumed by: PRD 4 (learner model seeding, narration language), PRD 5 (roster and
//              teacher scoping, the progress card's header), PRD 3 (the row shape).
export type StudentWorkspace = {
  studentId: string;          // supabase auth uid, or the roster row id for a school pick
  orgId: string;              // organization.id; the solo org for a self-serve student.
                              // Supplied by the server, never by the client.
  orgKind: 'solo' | 'school'; // mirrors organization.kind, migration 0005
  name: string;               // first name only; never typed by a minor on the school path
  klass: 6|7|8|9|10|11|12;
  board: 'ncert';             // PRD 0's required field. More later; see PRD 4.
  subjects: string[];         // from subjectsAvailable(klass); never empty
  tutorLanguage: 'hinglish' | 'en'; // the ear, chosen at onboarding. NOT the UI language:
                              // the UI is English in both cases and has no setting.
  source: 'self' | 'contest' | 'roster';
  campaign?: string;          // present only when source === 'contest'
};
```

`POST /api/enroll` and `POST /api/enroll/otp` are otherwise exactly as published in
`docs/prd/0-website-integration-contract.md` sections 2 and 3. The server owns `next`,
always. `EnrollRequest` carries no `tutorLanguage`; the server writes the default and PRD 1's
onboarding language step is what confirms or changes it before the first class.

**The report payload** (PRD 1 sends it, PRD 2 routes it, this PRD receives and stores it,
PRD 6 triages it):

```ts
// apps/classroom/src/ui/ReportSheet.tsx : the agreed report payload.
// POST /api/report -> 202 { id: string }. Idempotent on (lessonId, beatId, at).
// Sent by: PRD 1 (the sheet). Routed by: PRD 2. Received and stored by: PRD 3.
// Triaged by: PRD 6 (the address, the incident path, the 24-hour clock).
export type ReportSubmission = {
  kind: 'wrong' | 'rude' | 'unsafe' | 'other'; // the four ids at ReportSheet.tsx:29-34.
                              // The wire carries the id; the sheet shows the label.
  note: string;               // the child's own words, PII-scrubbed client side, <= 500 chars
  lessonId: string;
  topicRef: string | null;    // <syllabus>/<chapter>/<topic>, so a report can be traced
                              // to a prepared_class without a lesson-id lookup
  beatId: string | null;
  spokenLine: string | null;  // the exact narration line on screen when reported
  sessionId: string | null;   // null when reported outside an open session
  release: string;            // the git-sha release stamp PRD 6 sets
  platform: 'web' | 'android';
  at: string;                 // ISO 8601
};
```

**The safety flag carries no words.** `POST /api/flag` takes
`{ verdict: 'distress' | 'redirect' | 'cleaned'; lessonId?: string; at: string }` and returns
`202 { id }`. There is no transcript field, on purpose. The alert Aarav receives carries the
flag id, the student id, the org, the time and the verdict, and nothing else.

**The school doors** (PRD 2 builds the screens, PRD 5 builds the teacher surfaces):

```ts
GET  /api/join/:joinCode            -> { school: string; classes: { id: string; label: string }[] }
GET  /api/join/:joinCode/:classId   -> { pickerToken: string;
                                         students: { handle: string; displayName: string;
                                                     rollNo: string | null; claimed: boolean }[] }
     // `handle` is opaque and valid only for that pickerToken. A roster_student.id is
     // never returned by an unauthenticated route.
POST /api/join  { pickerToken: string; handle: string; pin: string }
     -> 200 { access_token: string; refresh_token: string; expires_in: number }
     -> 401 { error: { message: 'that PIN does not match' } }
     -> 429 { error: { message: string }, retryAfterSeconds: number }
POST /api/roster  { classLabel: string; klass: number;
                    students: { displayName: string; rollNo?: string; schoolRef?: string }[] }
     -> 200 { classId: string; slips: { rosterStudentId: string; displayName: string;
                                        rollNo: string | null; pin: string }[] }
POST /api/roster/reset  { rosterStudentId: string } -> 200 { pin: string }
POST /api/staff/invite  { email: string; role: 'admin' | 'teacher'; classLabels?: string[] }
     -> 202 { inviteId: string; expiresAt: string }        // admin token only
POST /api/staff/claim   { token: string; email: string; password: string }
     -> 200 { access_token: string; refresh_token: string; expires_in: number }
     -> 410 { error: { message: 'that invitation has expired' } }
```

`slips[].pin` is returned exactly once, on the import that created the row, to a teacher's
token. Teachers and admins sign in with email and password; students never do.

**The card and the teacher's board** are PRD 5's shapes, mounted here (requirement 32):

```ts
GET  /api/card/:token          -> 200 { card: ProgressCard; school: string | null }
                               -> 410 { error: { message: 'this link has expired' } }
POST /api/card/:token/verify   { last4: string } -> 200 { ok: true } | 401
POST /api/card/send            { userId: string; cardId: string }   // service_role, PRD 6 calls it
                               -> 202 { queued: true } | 409 { reason: 'thin' | 'too_soon' }
GET  /api/teacher/class/:classId/board -> ClassBoard     // teacher or admin token
GET  /api/teacher/student/:userId/card -> ProgressCard   // via my_student_ids()
GET  /card/:token                      -> text/html, server-rendered, printable, no login
```

`ProgressCard` is PRD 5's: an immutable stored artefact in a `progress_card` table, written
by a service-role builder and never recomputed. This PRD declares no interface of that name
and serves the stored body.

**Tenancy predicates** (PRD 5 writes every teacher-facing query against these):

```sql
public.is_member(p_org uuid)   returns boolean  -- exists, 0005
public.org_of(p_user uuid)     returns uuid     -- new, service_role only
public.my_student_ids()        returns uuid[]   -- new, authenticated
```

Any table PRD 5 adds for homework, assignments, quizzes or events carries
`org_id uuid not null references public.organization on delete cascade`, a select policy
`using (public.is_member(org_id))`, and no insert or update policy for `authenticated`.

**Columns other PRDs read.** `prepared_class` gains `review_status text
('pending'|'published'|'retired')`, `published_at`, `review_note`, `review_verdict jsonb`,
`reviewed_at`, `retracted_at`, `version integer not null default 1` and `org_id uuid null`,
and its uniqueness moves from `(topic_ref)` to `(topic_ref, version)`. The catalogue read at
`apps/classroom/src/lib/content.ts:96` filters `retracted_at is null` and takes the greatest
version. `student_state`, `relay_usage`, `usage_event` gain `org_id uuid not null`.
`usage_event` gains `prep_id uuid null` and `bucket text not null default 'live'`, and its
`provider` check widens to admit `'self'`. `learning_session` gains `prep_id uuid null`.
`membership` gains `tier`. New tables: `relay_control`, `ops_webhook`, `prep_lock`,
`fixed_cost`, `billing_mandate`, `prewarm_intent`, `consent_record`, `child_report`,
`safety_flag`, `contest_standing`, `school_class`, `roster_student`, `staff_invite`,
`class_teacher` and `bucket_egress`.

**`PrewarmIntent`** is PRD 5's shape and this PRD's table (`prewarm_intent`, requirement 9).
PRD 5 writes rows through a service-role endpoint; PRD 6's runner reads them ahead of its own
file manifest.

**Class storage and language.** A class is one `prepared_class` row per `topic_ref` and
`version`, whatever language it is narrated in. Narration audio lives beneath the class key at
`generated/<lang>/<name>.(mp3|wav)` with `lang` in `('hinglish','en')`, admitted by
`isAllowedClassPath`. One preparation, N renders. The lesson format that makes the plan
language-neutral is PRD 4's; the arithmetic for what N costs in CAPEX and storage is PRD 6's.

**Operator switches**, all one `update` away with no deploy:
`relay_control.halted`, `relay_control.halted_reason`,
`relay_control.global_units_per_day`, `relay_control.max_concurrent_preps`,
`relay_control.halt_on_ceiling`, `relay_control.speech_fallback_to_vendor`. And one
environment variable that needs no database at all: `RELAY_DISABLED`.

## What this costs

This area does not spend money on teaching. It spends money on being able to keep teaching,
and on being able to measure what teaching costs, and the second of those is the reason the
Rs 5 number can exist at all.

**Where this area sits in the rollup.** All six documents divide by one denominator, the
pilot's 2,500 student-hours a month (500 students at 5 h), and the fixed lines total **Rs 2.48
per student-hour**: Supabase Pro Rs 0.96 (this PRD), the Piper VPS Rs 0.80 (PRD 6), Vercel Pro
Rs 0.72 (PRD 2), R2 backups Rs 0.0016 (this PRD). On top of that, MVP-1 is **Rs 26.15 to 30.62
per student-hour** and breaks, five to six times over, and it breaks on the judge,
which is Rs 18.70 per student-hour on its own. MVP-2 is **Rs 3.49** and clears. MVP-3 is
**Rs 4.32** at pilot scale and **Rs 1.34** at 25,000 student-hours. What buys MVP-2 is one
change: the whyProbe format, prompt and validator land in MVP-1 and the ClassRoom playback
change that takes the judge off the class path lands in MVP-2. Staging it the other way, with
the class path deferred, leaves MVP-2 at Rs 22.19, because the placement and quiz paths
already make no LLM calls and deferring them buys nothing. That single staging decision is the
difference between Rs 3.49 and Rs 22.19, and it is the only thing in six documents that puts
the product under Rs 5.

**Cash is not cost, and the two must never be quoted as the same number.** About Rs 23.70 of
MVP-1's Rs 26.15 is Vertex drawn on Google Cloud credits, leaving roughly Rs 2.50 of actual
cash. So "under Rs 5 of **cash** from day one" is true and "the Rs 5 ceiling is met" is not.
Every figure below says which one it is.

**What this area adds, per student-hour.**

- **Supabase Pro, USD 25 a month, Rs 2,390 at 95.6. Cash.** Unavoidable: the free tier pauses
  after a week of quiet (which is the entire reason `keepalive.yml` exists), caps egress at
  5 GB, and has no point-in-time recovery. At the pilot's 2,500 student-hours that is
  **Rs 0.96 per student-hour**, 19% of the ceiling on fixed infrastructure alone. At 5,000
  students it is Rs 0.10. At the MVP-1 contest cohort of perhaps 100 students it is Rs 4.78,
  which is almost the whole ceiling, and that is worth saying out loud: the first hundred
  students are not economic under any arrangement, and the pilot's 500 are where the fixed
  cost becomes ignorable. **Taken from the day the contest funnel opens**, because that is the
  first day losing the ledger costs something irreplaceable.
- **Backups to Cloudflare R2. Cash.** A ledger event row is order 400 bytes; 500 students at
  roughly 800 events a month is about 160 MB a month of new rows. Thirty daily gzipped
  snapshots plus twelve monthly is under 3 GB at USD 0.015 per GB-month, and R2 charges
  nothing for egress. **About Rs 4 a month**, or Rs 0.0016 per student-hour. This is the
  cheapest insurance in the entire product.
- **Bucket egress.** A kept class is a `lesson.json` plus pictures, realistically about 2 MB,
  and narration audio per language on top of it. 500 students at 20 classes a month is 20 GB,
  inside Pro's 250 GB allowance, so **Rs 0**. At 10,000 students it is 400 GB, so 150 GB over
  at USD 0.09, which is Rs 1,290 a month against 50,000 student-hours: **Rs 0.026 per
  student-hour**. The risk is not the honest case, it is the scrape: a world-enumerable bucket
  at USD 0.09 per GB means one terabyte pulled overnight is Rs 8,600, which is what
  requirement 14 exists to stop.
- **`pg_net` and `pg_cron` jobs.** Included in Pro. Rs 0. The SMS and email the alarm and
  requirement 28 send are PRD 6's vendor line.
- **The project ceiling itself costs nothing and caps everything.** 50,000 units a day is
  Rs 500 a day, Rs 15,000 a month, which is the maximum this backend can lose regardless of
  what anybody does to it, and most of that is credits rather than cash. Against the previous
  unbounded exposure (Rs 120 of metered headroom per free identity, times however many
  identities a script mints) that is the single largest reduction in expected cost anywhere in
  the six PRDs, and it is arithmetic on a liability rather than on a bill.

**Net from this area: Rs 0.96 per student-hour at pilot scale, falling to about Rs 0.10 at
5,000 students.** That comes out of the Rs 5 and the teaching side has to be built knowing it.

**What it reveals, which is not the same as what it saves.** Requirement 6 is the only
genuinely cost-positive item here: a per-topic lock is what makes the denominator in
`16.55 x Rs 30 / S` actually be S. With ten students arriving at a cold topic together, today
that is ten preparations at Rs 30 and nine thrown away, Rs 300 spent to produce Rs 30 of
value; with the lock it is one. At S = 1 prep alone is Rs 496.5 per student-hour, ninety-nine
times the ceiling, and that is the default state of a self-serve student on a cold topic
today. That is the mechanism the whole pre-warming strategy depends on, and without the lock
the strategy is a hope about timing.

**The 2027-01-01 cliff applies here too.** Every Vertex figure in `tools/sql/model_price.sql`
is an introductory rate drawn from Google Cloud credits, and the file says both halves itself
(`:12` and `:45-47` for the intro rate that doubles, `:37-39` for the spend being credits
rather than cash). After the doubling the product needs **S of roughly 250 or better on every
topic**, which is exactly what PRD 5's teacher assignment button and PRD 6's pre-warm runner
are for; neither is an optional feature. The project ceiling buys half as much that week, and
it is a rupee number, so it has to be re-derived that week and not that quarter.

**One number is missing from every rollup, including this one.** The doubt tutor appears in no
PRD's arithmetic; PRD 4's unverified estimate is Rs 28 per student-hour, larger than everything
else combined. Measuring it (PRD 4 requirement 7) is the cheapest way to find out whether any
of the arithmetic above means anything.

## Risks

Ranked by what would actually stop the product.

1. **The ceiling halts the pilot on its first morning.** 500 students at ten minutes a day
   is about Rs 2,158 of spend and the ceiling is Rs 500, so the day stops about a quarter of
   the way through it, and the number is a plpgsql constant until requirement 1 lands. If requirement 1 slips and requirement 2's derivation is not done, the
   school demo stops mid-period on day one and the first person to notice is a teacher in
   front of thirty children. Mitigation: requirement 1 is MVP-1, the alarm at 50% is what buys
   the warning, and PRD 6's derivation is a checklist item on opening the funnel rather than a
   note.
2. **School auth is the biggest new build in the six PRDs and it lands in MVP-2, which is
   the demo.** Provisioning, invite, claim, roster import, the picker, the PIN, the per-row
   secret, four new tables, a rewritten provisioning trigger and a new RLS predicate, all with
   zero prior art in this repo and a school waiting. If any piece slips, the demo has no
   students or no teacher. Mitigation: requirement 15's tables and requirement 10's trigger
   change land in MVP-1 against zero rows, which leaves the routes and the screens for MVP-2.
3. **`my_student_ids()` is the one place a mistake exposes another school's children.** It is
   `SECURITY DEFINER`, it returns an array of user ids, and every teacher-facing policy
   trusts it. A missing `and me.role in ('admin','teacher')` or a wrong join makes every
   teacher a reader of every student in the deployed project. Mitigation: it gets its own
   test file with a fixture of two schools, and the test asserts the cross-school read
   returns zero rows rather than asserting the same-school read returns thirty.
4. **The deployed relay is not the relay in this document.** The Edge Function has not been
   redeployed since the ceiling, the switch and `bareModel` landed, and there is no CI step
   that would say so. Every live statement here describes source. Mitigation: requirement 25's
   `deno check` plus a `relay:verify` assertion that the deployed function returns `capped`
   rather than `rate` when the day is spent.
5. **The single-row `relay_budget_day` counter is a serialisation point.** Every relay call
   updates one row. At 500 students and 120 requests a minute each, the theoretical worst case
   is 1,000 updates a second on one tuple. Postgres will do it for a short single-statement
   transaction, but it is a hot row and it will be the first thing to show up as latency.
   Mitigation, when it bites: shard to `(day, bucket)` with `bucket = hashtext(user)::int % 8`
   and sum eight rows, which changes the function and nothing else.
6. **Moving `namesInSpine` server-side is not the same check.** The browser version has the
   student's names to compare against; the server does not and must not, so the server-side
   form is strictly weaker and catches only the structural cases. A class that says
   "well done, Priya" with no other marker gets through. Mitigation: state this honestly in
   the migration comment rather than repeating `0004:41-43`'s claim, and let the review pass
   in requirement 7 carry the rest.
7. **The backup's read-only role is a new credential outside the database**, which is the
   thing `0009` argued against. It is unavoidable (a copy that cannot leave is not a backup)
   but it is a real widening of the blast radius, and it lives in a GitHub Actions secret.
   Mitigation: it is select-only on seven tables, it can write nothing, and it is rotatable
   without a deploy.
8. **The asynchronous publish in requirement 7 adds a window in which a topic is prepared
   and invisible.** A second student arriving inside that window either re-prepares or waits.
   Mitigation: the prep lock makes the common case a wait, and PRD 4's reviewer runs
   in-pipeline for live prep so the window exists only for the pre-warm runner.
9. **Nothing here has ever been deployed under load.** `npx vercel deploy --prod` has never
   been run, `ci.yml` has never run, and every live figure in this document comes from probes
   against a project with zero real students. Every number about latency and contention above
   is a projection.

## Open questions

Only the ones that are Aarav's.

1. **What is Qrie's position on mandatory reporting under POCSO when a disclosure names an
   adult?** Requirement 28 routes a disclosure to one person, you, and stops there, which is
   the right default and is not a policy. POCSO places a reporting obligation on a person who
   has knowledge of an offence against a child, and the product is now a channel through which
   you will have that knowledge. What the obligation means for a one-person supplier, what is
   reported, to whom, in what time, and what the child is told, needs a lawyer who does child
   protection, not a PRD. **This is not resolved in this document and must not be treated as
   resolved by any other one.** Until it is, the answer is: it reaches you within five minutes,
   with no transcript, and you decide.
2. **Does a roster student need a PIN at all?** In a supervised classroom the teacher is the
   authentication: the child picks their own name off the board's list and that is that. A
   PIN is one more thing to print, lose and reset, and it protects against a classmate
   impersonating a classmate, which is a real but low-stakes attack. `school_class.join_requires_pin`
   defaults to on and the pilot school can turn it off. I have designed the PIN in; I would
   rather you decide whether the pilot uses it.
3. **What is the grievance address, and whose name is on it?** DPDP wants a named grievance
   officer and Google Play wants reports to reach the developer. Requirement 22 needs a real
   mailbox on the real domain and a human name to publish next to it. That is a decision
   about you, not about code.
4. **Is the school the data fiduciary, in writing, with breach terms?** The entire school-auth
   design, and the fact that we do not collect a parent phone number for 500 children, rests
   on the pilot agreement saying the school holds the relationship and Qrie processes on its
   instructions. Requirement 29 lists the six clauses that have to be in it. If that clause is
   not there then every roster student needs individual parental consent and the channel
   changes shape completely. This is the single highest-leverage sentence in the pilot
   agreement.
5. **Which legal entity signs it?** A processing agreement, a DLT registration for the OTP
   sender, and a payment gateway all need a registered business with a PAN and a bank account,
   and the repo has no LICENSE and a package still named `ai-tutor`. That is the same decision
   three times and it gates requirement 20's SMS vendor as hard as it gates anything else.
