# Runbook

What to do when something is wrong, written before it is, by somebody who could
still check each claim against the tree. Every command here was read out of the
file it lives in; anything not checked says **NOT VERIFIED**.

The audience is one person on a phone, possibly at a school, possibly at three
in the morning. So the order is: stop the bleeding, then find out why.

---

## 0. The thirty-second triage

| what you are told | first thing to look at |
|---|---|
| "it says come back tomorrow" | §2 — a cap fired. Which one decides everything. |
| "it says Qrie is having a rest" | §1 — somebody or something halted the relay. |
| "nothing happens when I tap a class" | §3 — the relay, or the preparation, or the lock. |
| "the class started and stopped" | §4 — the ear, the judge, or speech. |
| "I never got the code" | §5 — there is no SMS vendor. This is expected. |
| a bill arrived that you did not expect | §2, then §6. |

**Before anything else, know which of two things is true:** the student is being
refused *correctly* (a cap, a limit, a halt — the system working) or *incorrectly*
(an outage). The relay says which, in words, and the words are deliberate:

- A **429** is the student's own rate or daily budget. Their limit, their wait.
- A **503** is **our** capacity or our outage. `gate.ts:198` words these so a
  child is never handed a fault they do not have.

---

## 1. Stopping it

**There are two stops and they are not duplicates** (`0016_relay_control.sql:18`).

### The one that needs nobody awake — `relay_control.halted`

A row in Postgres, read on the very next request. This is the one to use.

```sql
update public.relay_control set halted = true, halted_reason = 'why', updated_at = now();
```

Students immediately get *"Qrie is having a rest. Classes are paused for a few
minutes."* — 503, and the wording says **minutes**, so do not leave it set for a
day without changing the message.

To lift it:

```sql
update public.relay_control set halted = false, halted_reason = null, updated_at = now();
```

**Where you run that: the Supabase SQL editor.** `relay_control` has RLS on with
no policies (`0016:45`), so the only ways in are the service-role key or a definer
function, and **no definer function to set `halted` exists** — only `claim_relay`
reads it. There is no operator interface and no script. That is a real gap; it is
written down here rather than papered over with a command that does not exist.

**What halting does NOT stop:** `/api/report` is exempt from the halted and
capped arms (`handler.ts:296`). A child can always report something. That is
deliberate — a safety report is not a class.

### The one that needs a restart — `RELAY_DISABLED`

An environment variable on the host. It stops the relay *before* it verifies
anybody, so it costs nothing to check, and it needs a redeploy to set or unset.
Use it when the database itself is the problem, or when you want a stop that a
compromised database cannot lift.

---

## 2. The caps, and which one fired

Three different ceilings can produce a refusal. They mean different things.

| reason | what it means | where the number lives |
|---|---|---|
| `rate` | too many requests in a minute, one identity | `REQUESTS_PER_MINUTE = 120`, `gate.ts:357` |
| `budget` | one student used their day | `UNITS_PER_DAY = 12_000`, `gate.ts:398` |
| `capped` | **we** used our day, across everybody | `relay_control.global_units_per_day`, default 50,000 (`gate.ts:160` mirrors it) |
| `unavailable` | the meter itself is down | — |

`unavailable` is still a refusal, on purpose: a limit that disappears during an
outage is not a limit, and an outage is exactly when a runaway goes unnoticed.

**To give the project more room for one day** (e.g. a demo at a school):

```sql
update public.relay_control set global_units_per_day = 80000, updated_at = now();
```

The constant in `gate.ts` is the row's DEFAULT, not the authority — the database
decides (`0016:14`). `apps/classroom/tests/migrations.test.ts` asserts the default
still matches `UNITS_PER_DAY_PROJECT`, so changing the row does not break a test
but changing the migration's default without the constant will.

**Raising a cap is a spending decision.** At MVP-1 the product costs Rs 26.15 to
30.62 per student-hour against a Rs 5 ceiling, and most of that is Vertex credits
rather than cash. Know which you are spending before you raise anything: PRD 6
§"What this costs" has the split.

---

## 3. A class will not start

Work down this list. Each step is cheap and rules out the one below it.

1. **Is the relay up at all?**
   ```bash
   node tools/bin/verify-deploy.mjs
   ```
   Five probes, all on the PUBLIC anon key, so it is safe to run from anywhere
   and proves what a real student's phone would see. It exits non-zero on any
   failure. It was written because a deploy script once printed success and set
   nothing.

2. **Is it refusing, and why?** See §1 and §2. The student's own words are
   usually enough to tell you which.

3. **Is a preparation stuck behind a lock?** `0017` gives a topic one preparation
   at a time so N students on a cold topic pay for one, not N. The lock has a
   **180-second TTL** and the client renews it while preparing. A holder that
   dies leaves the lock standing for at most that TTL, and `waitForHolder` bounds
   the wait at 195 s before giving up.

   A lost lock does **not** abort a preparation already in flight — `prepareClass`
   has no cancellation. The twin-spend window is narrowed, not closed. Known, and
   recorded as a gap rather than hidden.

4. **Is the topic simply cold?** ~96 s and about Rs 30. That is the system
   working. The badge work in Wave 4 exists so a child can tell this apart from a
   fault.

---

## 4. A class started and then stopped

- **The safety screen halted it.** Not a fault. `lib/safety.ts` stops the turn
  when a line reads as distress and puts Tele-MANAS in front of the child. Nothing
  to fix; this is the product doing its job.
- **The judge failed.** The class swallows a failed judge on purpose — it "says
  nothing and leaves the chips standing". This is why a broken judge once went
  unnoticed in production for a whole model rename, and why it was found by
  measuring cost rather than by a test. **If answers stop being marked, suspect
  the judge silently, and check the model name against the relay's allow-list.**
- **Speech stopped.** The speech ticket is ten minutes and re-minted a minute
  before it lapses. A class longer than that with a broken mint goes quiet.

---

## 5. What does not exist yet

Written down so nobody spends an hour looking for it.

- **No SMS vendor.** Enrolment OTP works on the dev server only (one process, one
  Map, the code in the developer's terminal). The Edge host leaves the provider
  absent and both enrolment routes answer **501** there, deliberately — a
  memory-backed provider cannot work across short-lived isolates, and telling a
  parent "that code is not right" when it was is worse than telling them the door
  is shut (`handler.ts`).
- **No paging.** `OPS_ALERT_WEBHOOK` exists: set, a kept report POSTs
  `{kind, lessonId, at, reportId}` — **metadata only, never the child's words**.
  Unset, it is one server-side log line. Either way an alert failure never fails
  the 202. **NOT VERIFIED: whether it is set on the live project.**
- **No operator UI** for anything in this document. Everything is the Supabase SQL
  editor or a redeploy.
- **No on-call rota.** One person.

---

## 6. Deploying, and going back

```bash
npm run relay:deploy    # secrets, then `supabase db push`, then deploy the function
npm run relay:verify    # verify-deploy.mjs, then live-test.mjs
```

**`relay:deploy` runs `supabase db push`.** That applies migrations to the **live**
project. Read what is pending before running it, every time.

Going back is **not** symmetrical: the Edge Function can be redeployed from an
older commit, but a migration that has been pushed is applied. There is no
`down`. Plan forwards — a fixing migration, not a rollback.

The safe intermediate step, when you are not sure whether a deploy is the problem,
is §1: halt, look, then decide.

### The brain (`supabase/functions/brain`) — NOT DEPLOYED YET

Every answer puts its learner on `public.brain_queue` (migration 0108). The brain
function takes them off: each call runs the settle pass, then folds queued learners
into `concept_state` (at most 200, starting no new one after a second; the rest wait
for the next call). Until it runs on a schedule, nothing on the hosted project writes
`concept_state` (the standing, reviews and wrong ideas the apps read from it), and the nightly
`purge_old_ledger` can delete answers the model never kept.

```bash
supabase db push                                     # 0100-0108 first; read what is pending
supabase secrets set BRAIN_SECRET=<a long random string>
supabase functions deploy brain --no-verify-jwt     # the secret header is its auth
```

Then schedule it from the SQL editor (needs the `pg_cron` and `pg_net` extensions;
keep the secret in Vault, never in the job's text):

```sql
-- select vault.create_secret('<the same BRAIN_SECRET>', 'brain_secret');
-- select cron.schedule('lam-brain', '30 seconds', $job$
--   select net.http_post(
--     url := 'https://<project-ref>.supabase.co/functions/v1/brain',
--     headers := jsonb_build_object(
--       'content-type', 'application/json',
--       'x-brain-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'brain_secret')),
--     body := '{}'::jsonb,
--     timeout_milliseconds := 10000);
-- $job$);
```

Each call logs one line of counts: `{"brain":{"settled":…,"thought":…,"events":…,"failed":…,"busy":…,"waiting":…,"stuck":…}}`.
A growing `waiting` means the schedule is too slow for the school; `stuck` counts learners
the brain failed on five times running (their error is in `brain_queue.last_error`; a
new answer, or `update public.brain_queue set attempts = 0`, gives them another try).
A call without the right `x-brain-secret` gets 401, and every call gets 503 while
`BRAIN_SECRET` is unset.

---

## 7. Checking the money

```bash
node tools/bin/cost-report.mjs
```

Do this after anything unusual, and before raising a cap. `usage_event` carries a
`prep_id` column for attributing spend to a preparation — but **the browser does
not send `x-prep-id` on `/api/llm`**, which is where the rupees are; it is stamped
only on the zero-unit lock routes. So prep attribution works for the pre-warm CLI
and not for a student's own class. Known gap, do not read a prep's spend off it.

---

## 8. Before touching anything, the four gates

Nothing ships without all four green. They take about four minutes together.

```bash
npm run typecheck
npx vitest run
npm run build
node tools/bin/check-bundle-secrets.mjs
```

Plus, for anything that touched colour:

```bash
node docs/brand/build-theme.mjs
```

which refuses to emit unless all 47 rendered pairs clear WCAG AA, and tells you if
the committed CSS has drifted from what it would emit.
