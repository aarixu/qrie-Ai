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
- **Switches** are the remote switches the apps read. A guarded one asks for a
  fresh code. A switch nobody has set uses the safe default built into each app.
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
  switches or Today. A finance member is added like any staff member, with the
  role `finance`.
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
    cancelled; wait an hour and see "Last reconciliation" update. Cashfree's
    sandbox sets a refund's status from words in its refund note (`SUCCESS`,
    `FAILED`, `PENDING`, `ACTIVE`), but billing writes the note itself
    (`Refund for <invoice number>`), so what the sandbox does with that note is
    UNVERIFIED; if the refund stays pending, no credit note is issued, and the
    credit note path is covered only by the repository's tests until then.
11. **Go live:** production keys and `CASHFREE_ENV=production`, set the same way
    as step 6, on the HOSTED project only; the production webhook URL in the
    production dashboard; one real Re 1 invoice to yourself, then refund it.
12. **Decide later (no build needed now):** whether a finance member may stop the
    tutor (now they may not, reading spec section 3's "nothing about switches"
    over its "a stop is open to every active staff member"; allowing it means
    widening `admin.set_halt`'s stop branch, a plan-1 function); whether
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
  that payment is stored, listed as not counted and refundable, and counted
  under Needs attention.
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
- **Voiding a part-paid invoice is refused.** Refund what was paid, then void.

### What billing will never do

It never stores card or bank details (Cashfree's pages collect them); never
deletes an invoice or a payment, or changes an issued invoice's number, amounts
or tax, even with hand-written SQL; never changes a licence on a refund (change
it on the school's page if needed); and never charges a mandate before plan 7.
No child appears anywhere in billing.
