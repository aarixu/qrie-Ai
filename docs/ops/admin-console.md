# Qrie control: setting it up and running it

The platform's own console (`apps/admin`): one place for the owner and a few
named staff to see and control every app. It is not the school principal's panel
(that is `apps/lms`). The design is `docs/superpowers/specs/2026-10-06-super-admin-panel-design.md`.

Nothing here has been run against the hosted project yet. Lines marked
**UNVERIFIED** are from documentation or memory and must be confirmed the first
time they are done.

## 1. Setup, once (Aarav's steps)

1. **Hosted migrations.** The hosted project had nothing past 0025 on 2026-10-03.
   `npx supabase migration list --linked` shows what is applied. Then
   `npx supabase db push` applies 0026 to 0051 together. Do it on a quiet hour;
   0047 replaces the sign-up trigger on `auth.users`.
2. **Expose the `admin` schema.** Dashboard, Project settings, API, "Exposed
   schemas": add `admin` beside `public` and `lms`. Without it the panel's calls
   return 404. (UNVERIFIED: the dashboard's wording.)
3. **Turn on authenticator codes.** Dashboard, Authentication, Multi-factor:
   enable TOTP. Do not enable SMS.
4. **Leave email sign-up as it is for now.** Closing it ("Allow new users to sign
   up": off) would be tidier, since no app calls `signUp`, but it may also refuse
   ANONYMOUS sign-ins, which is how every child on the tutor gets in
   (UNVERIFIED either way). Try it first on a project that is not the live one: turn
   it off, open the tutor in a fresh private window, start a class. Only if that
   works, do the same on the live project, and check again the same way. The
   console does not depend on it: staff are added by an owner, never by sign-up.
5. **Make the first owner**, from your laptop:

   ```bash
   SUPABASE_URL=https://<project>.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=<from the encrypted bundle> \
   ADMIN_OWNER_EMAIL=<your email> ADMIN_OWNER_PASSWORD=<12+ characters> ADMIN_OWNER_NAME="Aarav" \
   npm run admin:bootstrap -- --env HOSTED
   ```

   Then **open the panel and enrol your authenticator app straight away**. Until
   you do, anyone who learns the password could enrol their own.
6. **Host the panel on its own origin**, not `qrie-ai.vercel.app` (children's
   sessions live there). Build with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   and `VITE_ADMIN_ENV=HOSTED`, serve `apps/admin/dist`, and add the new address
   to Supabase Auth's allowed redirect URLs.
7. **The alarm.**
   - Telegram: message `@BotFather`, `/newbot`, keep the token. Make two private
     chats, one for operations and one for safety (a different person is in the
     safety chat: your backup reviewer). Add the bot to both and read each chat's
     id.
   - Make a token: `openssl rand -hex 24`. Store it in the database as the
     service role: `select admin.alert_token_set('<token>');`
   - GitHub, Settings, Secrets, Actions: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
     `ALERT_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_OPS`,
     `TELEGRAM_CHAT_SAFETY`.
   - Same page, the **Variables** tab: `ADMIN_ALERT_ENABLED` = `true`. The workflow
     does nothing until this is set, so it never runs half-configured.
   - **Cost.** It runs every 5 minutes. On a public repository that is free. On a
     private one each run bills at least a minute, about 8,600 minutes a month,
     more than the free allowance. If the repository is private, run
     `npm run admin:alert` from cron on a server you already pay for instead, with
     the same values in its environment, and leave `ADMIN_ALERT_ENABLED` unset.
   - Run the "Admin alert" workflow once by hand. The home page's "Alarm checker"
     tile turns green.
8. **An outside uptime monitor** (any free one) on the relay and on the panel.
9. **Hardware-key or authenticator MFA** on Supabase, Vercel, GitHub, Google
   Cloud, the domain registrar and your mailbox, and a second person who can stop
   the tutor and a second alarm phone on a different device and carrier. These
   matter more than any screen here.

## 2. Day to day

- **Today** is the whole morning check: red means act now, amber means look
  today, grey means "we cannot see this", which is never the same as fine.
- **Stop the tutor** is one tap for anyone on staff. **Resume** is the owner's,
  with a fresh authenticator code. The big red tile "Tutor: Stopped" stays until
  somebody resumes.
- **Switches** are what the apps obey (section 7 says which app reads which,
  and what the database enforces itself). A guarded one asks for a fresh code.
  A switch nobody has set uses its safe default.
- Every change is in the audit log with who did it and why. The log cannot be
  edited, even with the service-role key.

## 3. If something goes wrong

- **You lost your authenticator.** As the service role, remove your factor so you
  can enrol a new one: `delete from auth.mfa_factors where user_id = '<your id>';`
  (UNVERIFIED: the table name; check `\dt auth.*`). Then sign in and enrol at once.
  Another owner can do it for you; one owner alone relies on this.
- **The panel is down and the tutor must stop.** `supabase secrets set
  RELAY_DISABLED=1` stops the relay with no database and no panel (and
  `supabase secrets unset RELAY_DISABLED` resumes). That is the second, separate
  stop and is deliberately not a button.
- **The alarm is silent.** The home page says so. Re-run the "Admin alert" workflow
  by hand and read its log; a red run is a failed Telegram send, a green run that
  sends nothing is a quiet platform.

## 4. What the panel will never do

It has no SQL box, no table editor, no "sign in as this child", and it cannot
deploy, run a migration, or edit the distress rules. Those change in code, with a
review, because each one reaches children. Supabase's own dashboard remains the
emergency tool; keep its login behind a hardware key.

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
   staff invitations and blocks fail with an error ("Could not reach the admin
   service." or "The admin service did not answer properly."; which one is
   UNVERIFIED); everything else works.
3. **Rebuild the console** with the same three values as before and publish it.
4. **The audit copy.** It uses the alarm's secrets and the same
   `ADMIN_ALERT_ENABLED` variable. Run the "Admin audit copy" workflow once by
   hand: the ops chat gets "Audit log on DATE: N entries, chain intact, head …".
   On a private repository it costs about 720 job-minutes a month. If the
   alarm runs from a server instead, run
   `node --experimental-strip-types tools/admin-alert/src/audit-copy.ts`
   from the same cron every hour, with `AUDIT_HEADS_FILE` set to a file that
   survives between runs. If it cannot read the database, that run fails (red
   in Actions; the script exits 1), and from the second such run in a row the
   ops chat gets "The audit log's outside copy could not read the database
   …", again every 24 runs while it lasts. The five-minute alarm does not
   watch this job.
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
   and add a test person (each asks for a fresh code), block and unblock a test
   direct user, invite and turn on a test staff member, and look at System:
   jobs should say "Succeeded" or "Never run", not "Not captured"; the
   migration level should be 0061 (plan 2's 0052 to 0055, billing's 0056 to
   0060, and 0061, which joins the two).
8. **What the switches do.** See section 7: once 0062 to 0064 are applied,
   the database refuses tutor classes to the children of a school whose tutor
   switch is off or that is suspended, and refuses staff's imports for an
   offboarded or suspended school (the school admin's are refused by the
   import code, once deployed as section 7 says); the apps show the rest only
   from the builds named there. Only you
   (the owner) can turn a tutor switch back on; a teacher's or a school admin's
   new PIN, and a teachers sheet, are yours too.

## 6. Billing with Cashfree (plan 3)

Schools pay Qrie through one Cashfree merchant account, by a payment link or by
a bank transfer or cheque recorded by hand. Qrie numbers its own invoices
(`QRIE/26-27/0001`; credit notes `QRCN/26-27/0001`); Cashfree only collects. The
pages are under **Billing** in the console. Nothing in this section has been run
against Cashfree or a hosted project: no sandbox call has been made, so every
line about Cashfree is from its documentation, read 2026-10-07 (the plan,
`docs/superpowers/plans/2026-10-07-super-admin-billing.md`, cites each page).

**Who may do what.** The database decides; the console only hides buttons.

- **Owner:** everything. Refunds, voids, prices (Plans), Qrie's seller details
  (Settings) and a school's grace days are the owner's alone, each with a fresh
  authenticator code.
- **Ops:** reads billing, sets a school's billing account, raises invoices and
  subscriptions, sends payment links.
- **Finance:** reads billing, records money received by hand (with a fresh code,
  because a payment can set a licence), prints invoices. Nothing about children,
  switches or Today. Like everyone on staff, a finance member may stop the
  tutor (0061: your ruling on spec section 3), but cannot resume it; the stop
  button is on Today and System, which finance cannot open, so for now that
  stop has no button of its own in the console. A finance member is added like
  any staff member, with the role `finance`.
- **Safety:** no billing.

### Setup, once (Aarav's steps, in this order)

1. **Cashfree account.** Sign up, complete business KYC (PAN, business proof,
   the director's KYC; the exact list is UNVERIFIED), add and verify the
   settlement bank account, and get Payment Gateway with Payment Links enabled.
2. **Policy pages on the website** (landing): terms, refund and cancellation,
   privacy (listing Cashfree as a sub-processor, spec section 6), contact, and
   pricing. Payment gateways ask for them during activation; which ones Cashfree
   requires is UNVERIFIED.
3. **The CA's decisions**, entered by you in Billing, Settings: whether Qrie is
   GST-registered (the GSTIN, or empty for none), the SAC code, the GST rate, the
   invoice title ("Tax invoice" or what the CA says), and that the numbering
   `QRIE/26-27/0001` and credit notes `QRCN/26-27/0001` suit them; also the rule
   (CGST plus SGST at half the rate each inside one state, IGST at the full rate
   across states) and the rounding (half-up on each tax). Settle these before the
   first real invoice: an issued invoice keeps its number and its tax for good.
   No invoice can be raised until Settings is complete.
4. **Prices**, entered by you in Billing, Plans: each plan's code, name, months
   and price per seat. No plan may be called `pilot`, and a price of 0 cannot be
   invoiced (a trial is a `pilot` licence set from the school's page).
5. **Apply the migrations** (after plan 2's): `npx supabase db push` applies 0056
   to 0060 with the rest. No new schema needs exposing: billing's browser
   functions are in `admin`, already exposed in section 1 step 2. 0060 schedules
   the daily job `billing-states` at 00:10 India time; that `pg_cron` runs it on
   the hosted project is UNVERIFIED (after the push, `select jobname, schedule
   from cron.job;` should list it).
6. **Sandbox keys into Supabase secrets**, never on a command line:

   ```bash
   # a file outside the repo, deleted after
   printf 'CASHFREE_CLIENT_ID=%s\nCASHFREE_CLIENT_SECRET=%s\nCASHFREE_ENV=sandbox\nCASHFREE_API_VERSION=2026-01-01\nBILLING_RECONCILE_TOKEN=%s\n' "<id>" "<secret>" "$(openssl rand -hex 24)" > /tmp/cf.env
   npx supabase secrets set --env-file /tmp/cf.env && rm /tmp/cf.env
   ```

   Keep the same reconciliation token for step 9. `billing-api` also reads
   `ADMIN_ORIGIN`, the console's address, which section 5 (plan 2) sets for
   `admin-api`; one secret serves both functions. If it is not set yet:
   `npx supabase secrets set ADMIN_ORIGIN=https://<the console's address>`.
   `billing-api` refuses sandbox keys against a database whose environment is
   `HOSTED`, and production keys against any other, and then sends nothing to
   Cashfree; so the sandbox run happens on a TEST or STAGING project.
7. **Deploy the two functions:**
   `npx supabase functions deploy billing-api --no-verify-jwt` and
   `npx supabase functions deploy cashfree-webhook --no-verify-jwt`.
   Each checks its caller itself: `billing-api` through the staff member's own
   session in the database (and `/reconcile` through its token),
   `cashfree-webhook` through Cashfree's signature on the raw body. A function
   that answers 503 names the variables it is missing. UNVERIFIED: that the
   gateway passes the reconciliation token through with `--no-verify-jwt`, and
   that the `../../../tools/billing` imports bundle on deploy (the relay imports
   `packages/relay` the same way).
8. **The webhook URL**, in Cashfree's sandbox dashboard: Payment Gateway,
   Developers, Webhooks: add `https://<project>.supabase.co/functions/v1/cashfree-webhook`,
   version `2025-01-01` or later (so Cashfree sends `x-idempotency-key`), events:
   payment links and refunds; and on the **Subscriptions** webhook tab, the same
   URL (plan 7 uses it; until then its events are stored and marked "ignored").
   The tab and event names in the dashboard are UNVERIFIED.
9. **The reconciliation token in GitHub:** Settings, Secrets, Actions:
   `BILLING_RECONCILE_TOKEN` = the token from step 6. Every "Admin alert" run
   (section 1 step 7) then asks `billing-api` to reconcile, and the database lets
   a reconciliation start at most once in 55 minutes. It runs only while
   `ADMIN_ALERT_ENABLED` is `true`. If you run `npm run admin:alert` from a
   server's cron instead, put `BILLING_RECONCILE_TOKEN` in that environment too.
   Without the token nothing asks, and "Last reconciliation" on the Billing
   overview stays "never".
10. **Try everything in the sandbox:** raise an invoice for a demo school, Send
    link, pay it with Cashfree's sandbox test method (UNVERIFIED), and see the
    Webhook log show `processed`, the invoice `Paid` and the school's licence
    move; raise another, pay it, and use "Check with Cashfree" on it; refund part
    of a payment and see the refund's status, and the credit note once Cashfree
    reports `SUCCESS`; void an unpaid invoice that has a link and see the link
    cancelled; record a part payment by hand on an invoice that has a link and
    see the link cancelled at Cashfree, then Send link and see a new link for
    what stays due; wait an hour and see "Last reconciliation" update. Cashfree's
    sandbox sets a refund's status from words in its refund note (`SUCCESS`,
    `FAILED`, `PENDING`, `ACTIVE`), but billing writes the note itself
    (`Refund for <invoice number>`), so what the sandbox does with that note is
    UNVERIFIED; if the refund stays pending, no credit note is issued, and the
    credit note path is covered only by the repository's tests until then.
11. **Go live:** production keys and `CASHFREE_ENV=production`, set the same way
    as step 6, on the HOSTED project only; the production webhook URL in the
    production dashboard; one real Re 1 invoice to yourself, then refund it.
12. **Decide later (no build needed now):** where a finance member's stop
    button goes (decided: finance may stop, 0061; the button is on Today and
    System, which finance cannot open); whether
    `app_config` should tell the apps more than ok, grace and suspended; whether
    a refund should also shorten a licence (now: never automatically); whether
    scans of offline payment proof are needed (deferred; the reference number is
    recorded); counsel on what "ended" means for a school's data (spec
    section 10).

### Day to day

- **Billing overview every morning.** "Needs attention" adds up payments that
  arrived but were not counted (their amount, currency or invoice did not match
  the link, or more was paid than was still due: each one means a refund or a
  call to the school), payment links Cashfree says were paid but for which no
  payment is recorded yet, webhook problems and signature failures in the last
  24 hours. "Overdue" is red when any invoice is past its due day.
- **A red "Last reconciliation"** (more than 2 hours ago) means the hourly check
  is not getting through. Read the latest "Admin alert" run's log, which ends
  `reconcile: ran`, `reconcile: not due` or `reconcile: failed (<status>)`, then
  `billing-api`'s logs in the Supabase dashboard (Edge Functions; the menu
  wording is UNVERIFIED).
- **Raise** an invoice from Invoices or from the school's page (Billing,
  Schools, the school). **Send link** asks Cashfree for a payment page and shows
  its address with a Copy button, for WhatsApp; Cashfree also emails it when the
  school's billing account has an email. Billing asks Cashfree for no SMS and
  does not ask for WhatsApp (Cashfree's default for WhatsApp is UNVERIFIED).
- **Money by bank transfer or cheque:** Payments, Record a payment (owner or
  finance, fresh code). Paying a subscription invoice in full sets the school's
  licence to its seats and period. Nothing else in billing sets a licence, and a
  late payment for an older period never shortens one. If the invoice has an
  open payment link, recording goes through `billing-api`, which cancels the
  link at Cashfree first, so the school cannot pay the same money twice; if
  Cashfree says the link was already paid, nothing is recorded by hand and the
  link's payment is recorded instead ("Money arrived on this invoice's payment
  link; nothing was recorded by hand"). After a part payment, Send link makes a
  new link for what stays due. The database refuses a payment by hand while a
  link is open, whoever asks. If the school still pays an old, cancelled link,
  that payment is stored too; when it is more than is still due (as after a
  part payment) it is listed as not counted and refundable, and counted under
  Needs attention.
- **When a licence ends** the school has its grace days (14 by default, 14 to 30
  per school, set by the owner), then it is suspended: the apps are told the
  tutor is off, and homework is kept. Sixty days after grace ends it reads
  "ended" and still acts as suspended. The daily job at 00:10 India time moves
  these states.
- **Print** an invoice from its page: Print, then "Print or save as PDF" (the
  browser's own dialog; how the print preview looks is UNVERIFIED).

### If something goes wrong

- **A school paid but its invoice still says unpaid.** Open the invoice and use
  **Check with Cashfree**: it reads the link at Cashfree and records what it
  finds. The hourly reconciliation does the same for every open link. Cashfree's
  dashboard also has Batch Resend for webhooks.
- **Cashfree says a link is paid, but no payment for it is recorded** (the
  invoice's link shows it in red, the Billing overview counts it under Needs
  attention, and a webhook event says "Cashfree says this link is paid, but no
  payment for it was recorded"). Billing keeps the link open, so Check with
  Cashfree and the hourly reconciliation keep reading it, and until the payment
  is found the invoice takes no new link, no payment by hand and no void: the
  school may already have paid. If Check with Cashfree never finds it, open the
  link in Cashfree's dashboard and read its order: an order that is paid there
  but not recorded here means billing does not read Cashfree's answer the way
  Cashfree sends it (the formats are UNVERIFIED until the sandbox run), which is
  a code fix, not a hand edit.
- **A payment is listed under Needs attention.** It arrived but was not counted.
  Refund it (owner: Payments, Refund) or call the school. It never changes a
  licence.
- **A Cashfree secret leaked.** Rotate it in Cashfree's dashboard, set the new
  one in Supabase secrets the same way as step 6, and keep the old one active at
  Cashfree until in-flight webhooks clear, per Cashfree's note that each event is
  signed with the secret active when it was sent. `cashfree-webhook` checks one
  secret: an event signed with the old one that arrives after the switch is
  answered 401 and logged as a signature failure, and the hourly reconciliation
  reads its link from Cashfree anyway. Whether Cashfree keeps two secrets active
  at once is UNVERIFIED.
- **"Cashfree is set to sandbox but this database is HOSTED; nothing was
  sent."** (or the reverse): the keys and `CASHFREE_ENV` do not match the
  database. Fix the secrets.
- **A payment by hand was recorded by mistake** (the wrong invoice, the wrong
  amount, a cheque that bounced). The owner reverses it: Payments (or the
  school's Billing tab), Reverse, a fresh code and a reason. The payment stays
  listed, marked reversed with your name and the day, and no longer counts;
  the invoice's paid amount and status are worked out again, so a paid invoice
  can go back to part paid or unpaid. No money moves: if the money really
  arrived and must go back, send it back by bank yourself, outside Qrie (a
  reversal issues no credit note; whether the CA wants one then is
  UNVERIFIED). A licence the payment set stays as it is: change it on the
  school's page if needed. If the money did arrive, record it again correctly;
  the same UTR or cheque number can be used once the old one is reversed. A
  payment through Cashfree is never reversed; it is refunded.
- **Voiding an invoice that has money on it is refused** ("an invoice with
  money on it cannot be void"). Refund each payment that came through Cashfree
  in full (Payments, Refund) and wait until Cashfree reports the refund done
  (its credit note appears on the invoice); reverse each payment recorded by
  hand (above); then Void. A refund still requested or pending stops the void
  ("a refund on this invoice is not finished yet"). A part refund leaves money
  on the invoice, so it cannot be voided. The void keeps the invoice's number,
  what was paid and its credit notes on record, cancels its subscription, and
  does not change the licence.

### What billing will never do

It never stores card or bank details (Cashfree's pages collect them); never
deletes an invoice or a payment, or changes an issued invoice's number, amounts
or tax, or a recorded payment's amount or reference, even with hand-written
SQL (the one change a payment takes is being marked reversed, once, which the
owner does from Payments); never changes a licence on a refund or a reversal
(change it on the school's page if needed); and never charges a mandate before
plan 7.
No child appears anywhere in billing.

## 7. The apps obey the console (plan 4)

What reads what is on the console's **Apps** page. In short: the tutor, student
and teacher apps show the banner and ask an old build to update; the tutor
shows a pause when its switch is off and follows "only prepared"; the student
app shows a suspended school's notice; the school admin sees grace, suspension
and invoices due; the contest form says when entries are closed.

Two things are refused by the database itself, whatever an app shows:

- a tutor class for a child at a school whose tutor switch is off or that is
  suspended. Children see the relay's "Qrie is having a rest" sentence until
  their app refreshes, then the pause notice, from which they can still send a
  report (still at most 120 a minute each) and open Settings (sign out, delete
  the account) and Help. A school's teachers and admin are not refused by the
  switch: the teacher app's Draft with AI carries on. The stop still refuses
  everyone, teachers included.
- a new contest entry when entries are closed or the day's limit (India's day)
  is reached.

New people at an offboarded, suspended or ended school are refused as well,
and each person is told why, but only staff's import is refused by the
database itself (`admin.api_gate`). The school admin's Add people and Add a
parent (the `lms-admin` function, and the demo server's), and the founder's
import tool, refuse in their own code, which asks the database first
(`lms.import_refusal`). So they refuse only once that code is deployed (steps
3 and 4), and the founder's tool only when run from the merged code.

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
   System's migration level then reads the last number applied (0064 with this
   plan's alone), no longer section 5's 0061.
3. **Deploy the two school services from the merged code**, after the
   migrations: `npx supabase functions deploy lms-admin --no-verify-jwt` and
   `npx supabase functions deploy admin-api --no-verify-jwt`. Until `lms-admin`
   is deployed from it, a hosted school admin's Add people and Add a parent do
   not ask whether the school may take people; `admin-api` brings staff the
   same sentence when they check a sheet (the database refuses their import
   either way). Neither deploys the relay: `lms-admin` takes only the sign-in
   check (`createSupabaseVerifier`) from `packages/relay/src/auth.ts`, which is
   the same here as on the live tutor branches, and `admin-api` takes nothing
   from the relay.
4. **Restart the demo server from the merged code** before deploying the
   student and teacher apps: `npm run demo -- --reset`. It now answers the
   apps' `GET /public/app-config` and refuses a demo school that may not take
   people; an older demo server has no such route, and the apps then run on
   their defaults (no banner, no notice, no minimum). A demo database built
   from older migrations does not open, so `--reset` is needed: it rebuilds
   the demo school, with new PINs in `tools/lms-demo/.demo-data/logins.md`.
5. **Until the new contest site is live**, leave `contest.entries_open` on: the
   old form shows "We could not save that. Please try again in a moment." to a
   parent when entries are closed.
6. **Build and deploy the student and teacher apps as you do today**, after
   step 4. They read the switches from the server they already use (the demo
   school today, the hosted project once it serves them).
7. **Set a minimum build only to a build that exists.** The first builds that
   read it are tutor 0.1.0, student 0.1.0, teacher 2.3.0; older builds ignore it.
8. **Try it on TEST:** set a banner and see it in each app within five minutes;
   switch the tutor off for a test school and start a class as one of its test
   children (refused, then the pause notice), then tap Report something and
   open Settings from the notice; as one of its teachers, use Draft with AI
   (it works); close entries and open the contest form; set the daily limit to
   1 and enter twice; suspend a test school's licence (end it more than 14
   days ago) and try Add people and Add a parent as its school admin.

### If something goes wrong

- **An app shows a pause or an old-build screen it should not**: check the
  switch's value on Switches (a school's own value on its page). Set
  `app.min_version.*` back to `0.0.0` to release everyone.
- **A school's children cannot start a class**: its tutor switch is off, the
  platform's is off, or its licence is suspended (Billing, that school).
- **The console cannot be reached**: the apps keep their last values; nothing
  turns on by itself.

## 8. Safety, classes and privacy (plan 5)

Three pages under **Safety and privacy** in the console: **Safety** (reports,
cases, the read log), **Classes** (review, retract, reject) and **Privacy**
(erasure requests, each school's data-protection decision, what is kept). The
plan is `docs/superpowers/plans/2026-10-08-super-admin-safety-classes-privacy.md`.
Nothing in this section has been run against a hosted project: migrations 0065
to 0069, the two new `admin-api` routes and the pages were built and tested on
the local test database only, and the pages have not been opened in a browser.

**Who may do what.** The database decides; the console only hides buttons.

- **Safety:** reads the report list (kind, status, age, school, never the
  words) and opens one report at a time with a case: a reason and a fresh
  authenticator code. Inside the open case, each press of "Read the report"
  shows the child's words once and is written to the read log; "Look at the
  context" asks for its own reason and is logged too. At most 30 readings a
  day per person, the owner included. Marks reports read, triaged or closed;
  closes their own cases. Sees Classes, read only.
- **Ops:** retracts a published class and rejects one waiting for review, each
  with a fresh code (its files are deleted for good); records and verifies
  erasure requests; reads what is kept. Never sees a child's words: the Safety
  page answers "Your role cannot see this."
- **Owner:** all of the above, and alone publishes a class waiting for review,
  refuses or erases an erasure request (erasing with a fresh code), records a
  school's decision (fresh code), sets the contest purge date (fresh code),
  records the day distress capture went live, and reads the read log.
- **Finance:** none of it.

### Setup, once (Aarav's steps)

1. **Name the backup safety reviewer** and add them on Staff and audit with the
   role `safety` (the invitation flow of section 5). Without one, reports wait
   for you alone.
2. **Ask counsel** the questions at the end of this section. Until the answers
   come, every school's decision stays "Not decided" and, on the hosted
   database, nobody can be added to a school.
3. **Apply the migrations** (after plan 4's): `npx supabase db push` applies
   0065 to 0069 with the rest. Nothing new to expose: the functions are in
   `admin` (already exposed) and `lms.report_problem` in `lms`.
4. **Redeploy `admin-api`** for its two new routes (`class-remove`, `erase`):
   `npx supabase functions deploy admin-api --no-verify-jwt`. No new secret.
5. **Do not deploy the relay or the tutor app from this branch.**
   **Nothing in `apps/classroom`, `packages/relay` or `supabase/functions/relay`
   may be deployed from this branch until it is merged with `phase3-completion`
   and `voice-stt-tts` (the live relay has 743c05a, 1dcfcfe and 18733af, which
   this branch does not).** After that merge, deploy the relay with
   `npm run relay:deploy` and the tutor app as usual; then, on the Safety page,
   **record the day capture went live** (until a flag arrives or you record it,
   the page says "Not captured").
6. **Record each school's decision** on the Privacy page once counsel answers
   (who the data fiduciary is, who is told, and what it rests on, for example
   "counsel's letter of <date>").
7. **Set the contest purge date** on the Privacy page once prizes are posted.
8. **Decide (no build needed now):** whether a trial child's distress is
   captured (now it is not, because the trial page promises nothing leaves);
   whether new classes wait for review before anyone sees them (now they are
   shared when kept); and the privacy page's line "Class and usage records are
   deleted automatically after 90 days" (`landing/app/privacy/page.tsx:80`),
   which What is kept shows is not true: class and answer records and usage
   rows are kept until the account is erased (the nightly purge-old-ledger job
   deletes no class or answer event until the server fold sets
   `purge_safe_before`, and nothing sets it yet: 0021).

### Day to day

- **Open the Safety page every morning.** The tiles show unread reports (red
  when one is unsafe), the oldest unread, the time to first look, open cases,
  distress flags and your readings today.
- **An unsafe unread report, or a distress alert in the safety chat, means open
  the page now.** A distress alert carries a count and nothing else: no child,
  no school, no words.
- **Work one case at a time.** Open the case, read the report, look at the
  context if you need it, act, then close it with an outcome. You can hold one
  open case.
- **Record a disclosure as "Disclosed to the agreed person" only after telling
  that person.** The database accepts it only once the school's "who is told"
  is decided, and never for a child who came on their own. Write in the reason
  only that they were told; their name and number stay in the school's
  contacts.
- **Work erasure requests by due date** (30 days from the day received). A
  school student must be marked as left first (by the school admin, or Disable
  on their card). Verify, then the owner erases from the request's own page.

### If something goes wrong

- **A class must vanish now.** Classes, Retract (a fresh code). The class is
  hidden from the catalogue at once; then its files are deleted from Storage
  and its row goes. Open the class: "Files in Storage" should read 0. Copies
  served by Storage's CDN may stay reachable for up to its cache lifetime
  (UNVERIFIED).
- **Retract answers that Storage did not remove all of the files.** The class
  is already hidden; some of its files may be gone. Press Retract again (the
  Removed tab lists it as hidden with its files still in Storage) to finish;
  it is safe to repeat. The file count recorded at the end includes the files
  the first press removed.
- **An erasure stops with photos left** ("Some or none of the child's photos
  were removed; nothing else was erased"). Some photos may already be gone for
  good; no other record was touched. Press Erase again to finish. The photo
  count recorded at the end includes the ones the first press removed.
- **The safety chat counts hundreds of distress flags.** Probably a flood
  from one account rather than hundreds of children. Past 1000 in an hour,
  flags from that school (or from children who came on their own) are
  refused and wait on the children's phones, which try again every 2
  minutes; other schools' flags are still kept. The Safety page's counts
  include the flood.
- **The 30 readings a day are used up on a busy day.** The next India day
  resets them; or change the constant in a reviewed migration.
- **A contest entrant corrects their entry after the purge day.** Their
  details are back in that row until the next night's purge (01:15 India time)
  clears them again: the purge clears every entry made before the purge day
  that holds any personal field.

### What the panel will never do

Show a child's words in a list, a tile or an alert; keep a child's id with a
distress flag; export reports; erase from any page but a verified request's
own page; delete a class's catalogue row before its files are gone from
Storage.

### Questions for counsel

1. For a school's children, is the school the data fiduciary or Qrie (or both,
   for different purposes)?
2. Who receives a distress disclosure: the school's designated person, the
   parent, both, someone else? May Qrie tell them which child, and how do we
   verify them?
3. May any child's words be kept (what a child writes in a report), for how
   long, and may Qrie's safety reviewer read them? The same for the tutor's
   line saved beside a report.
4. Retention windows for each row of "What is kept", in particular reports,
   usage rows that carry a user id, the phone numbers codes were sent to,
   consent records and contest entries.
5. Is a distress flag with a school and a time but no child id "tracking or
   behavioural monitoring" under DPDP s.9(3)? Is a count per school allowed?
6. Erasure: the timeline, the verification a parent's request needs, whether
   staff logs (which keep ids and login IDs) must be scrubbed too, and what
   happens to a school's data when its licence ends.
7. May a trial child's distress be captured even though the trial page says
   nothing about them is kept?
8. May a parent file a report on a child's behalf? When a child is erased, does
   the parent's own sign-in stay?
