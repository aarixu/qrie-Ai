# Qrie control: setting it up and running it

The platform's own console (`apps/admin`): one place for the owner and a few
named staff to see and control every app. It is not the school principal's panel
(that is `apps/lms`). The design is `docs/superpowers/specs/2026-10-06-super-admin-panel-design.md`.

Nothing here has been run against the hosted project yet. Lines marked
**UNVERIFIED** are from documentation or memory and must be confirmed the first
time they are done.

## 0. Your steps, in order

The steps of the sections below, as one list in the order to do them; each
names the section that has the detail. None of
it has been done against the hosted project, Cashfree, Telegram or GitHub
Actions, so every step is UNVERIFIED until you have done it once; the marks
below flag what is most likely to differ.

**Before anything goes live**

1. **Push the branch.** From `.claude/worktrees/admin`: `git push -u origin admin`.
   It is **not** merged into `lms` or `master` until every test passes on it
   (the full suite, with `VITE_SUPABASE_URL=http://127.0.0.1:54321` and
   `VITE_SUPABASE_ANON_KEY=test-anon` set:
   `npx vitest run --exclude "tools/measure/**" --exclude "**/node_modules/**"`)
   and you say so.
2. **Never deploy the tutor, the relay or the contest site from this branch.**
   `apps/classroom`, `packages/relay` and `supabase/functions/relay` here are
   older than the live tutor (`phase3-completion` and `voice-stt-tts`; the live
   relay has `743c05a`, `1dcfcfe` and `18733af`), and the contest site is built
   with the tutor (`npm run build:site`). They go live only from a branch merged
   with those two (step 23). Everything else in this list does not need that
   merge: the migrations' tutor admission check works with the relay that is
   live today (section 7).

**The database**

3. **Look before you push.** Link the project the console will run on
   (`npx supabase login`, then `npx supabase link --project-ref <ref>`; the
   tutor's own project is the one `npm run relay:link` links), then
   `npx supabase migration list --linked`. The hosted project had nothing past
   0025 on 2026-10-03 (STALE: check). If it lists a version that is not in this
   branch's `supabase/migrations`, stop and merge the branch that has it first
   (the push refuses then; its wording is UNVERIFIED).
4. **Push the migrations, on a quiet hour.** `npx supabase db push` applies
   0026 to 0075 together, every pending migration in one go. 0047 replaces the
   sign-up trigger on `auth.users`, and 0064 changes the tutor's admission
   check (`claim_relay`). Afterwards
   `select jobname, schedule from cron.job;` should list `admin-revert-caps`, `billing-states`, `admin-privacy-daily` and
   `admin-metrics-nightly` (that `pg_cron` runs them on the hosted project is
   UNVERIFIED). Migrations 0100 and up belong to the `lam-one-brain` lane, not
   this branch.
5. **Expose the `admin` schema** (section 1 step 2): Project settings, API,
   Exposed schemas, add `admin` beside `public` and `lms` (the dashboard's
   wording is UNVERIFIED). No other schema: `billing` is reached only through
   `admin`'s functions.
6. **Turn on authenticator codes** (TOTP) in Authentication, Multi-factor; do
   not enable SMS. Leave email sign-up as it is (section 1 step 4).

**The console and its first owner**

7. **Host the console on its own address** (section 1 step 6): a Vercel project
   whose Root Directory is `apps/admin`, so `apps/admin/vercel.json` applies its
   security headers (that Vercel installs the workspace from the repository
   root then is UNVERIFIED). Its environment: `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY` and `VITE_ADMIN_ENV=HOSTED`. Not
   `qrie-ai.vercel.app`, where children's sessions live. Add the address to
   Supabase Auth's allowed redirect URLs. Check the headers:
   `curl -sI https://<console>/ | grep -i content-security-policy`.
8. **Tell the functions the console's address:**
   `npx supabase secrets set ADMIN_ORIGIN=https://<the console's address>`
   (the origin only, no path or trailing slash; `admin-api` and `billing-api`
   both read it).
9. **Make the first owner** (section 1 step 5): write the five values into a
   file outside the repository with a text editor (never `echo` or a command
   line, so nothing lands in your shell history), load it, run the bootstrap,
   delete the file. Then sign in to the console and **enrol your authenticator
   at once**: until you do, anyone who learns the password could enrol theirs.
10. **Deploy the staff service** (section 5 step 2):
    `npx supabase functions deploy admin-api --no-verify-jwt`. It needs only
    `ADMIN_ORIGIN` (step 8); Supabase supplies `SUPABASE_URL`,
    `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
11. **Deploy the school admin's service from this branch** (section 7 step 3),
    after step 4: `npx supabase functions deploy lms-admin --no-verify-jwt`. No
    secret of its own. If `git log admin..lms` lists commits, merge `lms` into
    this branch first (tests green, your yes), so an older `lms-admin` does not
    replace a newer one.

**The alarm and the audit copy**

12. **Telegram** (section 1 step 7): a bot from `@BotFather` (its token), two
    private chats (operations; safety, with your backup reviewer in it), the bot
    in both, each chat's id.
13. **The alarm's token:** `openssl rand -hex 24`, stored in the dashboard's SQL
    editor: `select admin.alert_token_set('<token>');`.
14. **Where the checker runs.** GitHub runs a scheduled workflow, and shows its
    "Run workflow" button, only from the default branch (`master`), and both
    workflows check out `tools/admin-alert` from it; `master` has neither file
    today. So `.github/workflows/admin-alert.yml` and `admin-audit-copy.yml`
    run only once this branch reaches `master` (after your yes). Then: GitHub,
    Settings, Secrets, Actions: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
    `ALERT_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_OPS`,
    `TELEGRAM_CHAT_SAFETY` (and `BILLING_RECONCILE_TOKEN`, step 20); the
    Variables tab: `ADMIN_ALERT_ENABLED` = `true`. **Cost:** on a public
    repository, free; on a private one the alarm (every 5 minutes, each run
    billed at least a minute) is about 8,600 job-minutes a month and the audit
    copy about 720, more than the free allowance. Until then, or on a private
    repository, run `npm run admin:alert` every 5 minutes and
    `node --experimental-strip-types tools/admin-alert/src/audit-copy.ts` every
    hour (with `AUDIT_HEADS_FILE` set to a file that survives between runs)
    from the cron of a server you already pay for, with the same values in its
    environment, and leave `ADMIN_ALERT_ENABLED` unset.
15. **See it work:** Today's "Alarm checker" tile turns green, System's "Wrong
    tokens" reads "None in the last hour", and the ops chat gets the audit
    copy's line.
16. **Outside protection** (section 1 steps 8 and 9): an uptime monitor on the
    relay and the console; authenticator or hardware-key MFA on Supabase,
    Vercel, GitHub, Google Cloud, the domain registrar and your mailbox; a
    second person who can stop the tutor and a second alarm phone.

**People and safety**

17. **Your backup safety reviewer** (sections 5 and 8): Staff and audit, Invite
    a person, role `safety`; phone them the temporary password; once they have
    an authenticator, call back, check it is them, press Turn on.
18. **A restore drill** (section 5 step 5), then System, "Record a restore
    drill". Then the first checks in a browser: section 5 step 7 on the
    console, and section 7 step 8 on a TEST project (a minimum build is set
    only to a build that exists, section 7 step 7).

**Money**

19. **Cashfree, before any key** (section 6 steps 1 to 4): business KYC and the
    settlement account (the exact list is UNVERIFIED); the policy pages on the
    website (terms, refund and cancellation, privacy, contact, pricing), the
    privacy page naming **Cashfree, GitHub (Actions runs the alarm) and
    Telegram (carries its messages)** as sub-processors (spec section 6); the
    CA's decisions in Billing, Settings (GSTIN or none, the SAC code, the GST
    rate, the invoice title, the numbering, CGST plus SGST against IGST, the
    rounding); and your plan prices in Billing, Plans.
20. **Sandbox first, on a TEST or STAGING project** (section 6 steps 6 to 10;
    `billing-api` refuses sandbox keys against a HOSTED database). That project
    needs the migrations, an owner made with `--env STAGING` (or `TEST`) and
    a console built with the same `VITE_ADMIN_ENV`. Write
    `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET`, `CASHFREE_ENV=sandbox`,
    `CASHFREE_API_VERSION=2026-01-01` (from Cashfree's documentation,
    UNVERIFIED) and `BILLING_RECONCILE_TOKEN=<openssl rand -hex 24>` into a
    file outside the repository with a text editor, then
    `npx supabase secrets set --env-file <file>` and delete the file; set
    `ADMIN_ORIGIN` there too. Deploy `billing-api` (it reads all six) and
    `cashfree-webhook` (it reads `CASHFREE_CLIENT_SECRET`), each with
    `--no-verify-jwt`. In Cashfree's dashboard, the webhook URL
    `https://<project>.supabase.co/functions/v1/cashfree-webhook`, version
    `2025-01-01` or later, payment-link and refund events, and the same URL on
    the Subscriptions tab (the names are UNVERIFIED). Put the same
    `BILLING_RECONCILE_TOKEN` where the alarm runs (step 14). Then work through
    section 6 step 10.
21. **Go live** (section 6 step 11): production keys and
    `CASHFREE_ENV=production` on the HOSTED project only, the production webhook
    URL, one real Re 1 invoice to yourself, then refund it.

**The charts**

22. **Prices, then the past** (section 9): check `tools/sql/model_price.sql`
    against your providers' prices today, then
    `node tools/bin/apply-prices.mjs` (it shows the difference; it reads
    `VITE_SUPABASE_URL` from the repository's `.env.local` and needs
    `SUPABASE_SERVICE_ROLE_KEY` in the environment: load it from a file as in
    step 9) and the same with `--yes` to insert. Then on any chart page,
    Recompute (owner, fresh code) the 92 days ending yesterday, and the 92
    before if you want them. On System,
    `admin-metrics-nightly` should read Succeeded after the first night.

**After the tutor merge**

23. **Merge this branch with the live tutor branches** (`phase3-completion`,
    `voice-stt-tts`), tests green, your yes. Then from the merged branch: the
    relay (`npm run relay:deploy`) and the tutor app and contest site as today;
    on the Safety page, record the day distress capture went live. Restart the
    demo server (`npm run demo -- --reset`) before deploying the student and
    teacher apps (section 7 steps 4 to 6). Keep `contest.entries_open` on until
    the new contest site is live.

**Counsel, and the decisions that are yours**

24. **Ask counsel** the ten questions at the end of section 8. **Until each
    school's decision is recorded on the Privacy page, nobody can be added to
    that school on the hosted database.** Then set the contest purge date once
    prizes are posted.
25. **Decide (no build needed now):**
    - Plan 2: a new PIN needs a fresh code; a PIN staff make is shown once, to
      them; schools work Monday to Saturday (attendance on time when marked
      within 2 days); the safety reviewer sees the schools list and health but
      not people, users or the audit log; ops give students and parents new
      PINs and add students (a teacher's or school admin's is yours, R22).
    - Plan 3: whether `app_config` should tell the apps more than ok, grace and
      suspended; whether a refund should shorten a licence (now never); whether
      scans of offline payment proof are needed; what "ended" means for a
      school's data (counsel).
    - Plan 4: whether a parent also sees "grace"; whether the banner shows on
      the contest site; whether the relay should enforce "only prepared".
    - Plan 5: whether a trial child's distress is captured (now not); whether
      new classes wait for review before anyone sees them (now shared when
      kept); the privacy page's untrue line "Class and usage records are
      deleted automatically after 90 days" (`landing/app/privacy/page.tsx:80`).
    - Plan 6: if counsel answers question 9 "no", a reviewed migration turns
      sign-ins per school and the contest funnel off.
    - The final review (plan 6's rulings F1 to F8): the principal's
      co-signature on destructive actions (spec section 13) waits for plan 7,
      and meanwhile you get the school admin's written agreement before a
      school student's erasure request is verified; raising
      `contest.daily_limit` stays with owner and ops; removing a lost
      authenticator stays a service-role step (section 3).

## 1. Setup, once (Aarav's steps)

1. **Hosted migrations.** The hosted project had nothing past 0025 on 2026-10-03.
   `npx supabase migration list --linked` shows what is applied. Then
   `npx supabase db push` applies every migration this branch has past that,
   0026 to 0075, every pending one in one go. Do it on a quiet hour;
   0047 replaces the sign-up trigger on `auth.users`. The later sections'
   "apply the migrations" steps are this one push.
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
5. **Make the first owner**, from your laptop. The service-role key passes every
   check in the console, so it never goes on a command line (where your shell
   history keeps it). Write these five lines into a file outside the repository
   with a text editor, for example `~/qrie-owner.env`:

   ```bash
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<from the encrypted bundle>
   ADMIN_OWNER_EMAIL=<your email>
   ADMIN_OWNER_PASSWORD=<12 or more characters>
   ADMIN_OWNER_NAME=Aarav
   ```

   Then, in Git Bash from the repository:

   ```bash
   set -a; . ~/qrie-owner.env; set +a
   npm run admin:bootstrap -- --env HOSTED
   rm ~/qrie-owner.env
   ```

   The tool reads only these environment variables
   (`tools/admin-bootstrap/src/cli.ts`); close the terminal afterwards so they
   do not stay in it.

   Then **open the panel and enrol your authenticator app straight away**. Until
   you do, anyone who learns the password could enrol their own.
6. **Host the panel on its own origin**, not `qrie-ai.vercel.app` (children's
   sessions live there). Build with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   and `VITE_ADMIN_ENV=HOSTED` (`npm run admin:build` ends with the bundle
   secret scan), serve `apps/admin/dist`, and add the new address to Supabase
   Auth's allowed redirect URLs.

   **The headers come with the host.** Spec section 6's own-origin
   Content-Security-Policy and no framing are in `apps/admin/vercel.json`, which
   applies only to a Vercel project whose Root Directory is `apps/admin`; deploy
   it that way (that Vercel then installs the workspace from the repository root
   is UNVERIFIED). On any other host, set the same headers yourself:
   `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src
   'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'
   https://*.supabase.co; base-uri 'none'; form-action 'self'; frame-ancestors
   'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
   `X-Content-Type-Options: nosniff`, `Permissions-Policy: camera=(),
   microphone=(), geolocation=()` and `Cache-Control: no-store` (a meta tag
   cannot set `frame-ancestors`). Check:
   `curl -sI https://<console>/ | grep -i content-security-policy`.
7. **The alarm.**
   - **The default branch first.** GitHub runs a scheduled workflow, and shows its
     "Run workflow" button, only from the default branch (`master`), and both
     `admin-alert.yml` and `admin-audit-copy.yml` check out `tools/admin-alert`
     from it. Neither is on `master` yet, so they run only once this branch has
     reached `master` (after every test passes and you say so). Until then, run
     the checker from a server's cron as the cost line below describes.
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
  A switch nobody has set uses its safe default. Turning the tutor back on and
  turning class preparation back on (`tutor.only_prepared` off) are the
  owner's (0075). A school's own tutor switch wins over the platform's: a
  school paused on its own is resumed by clearing its value, so it follows the
  platform's switch again ("Follow the platform" on its Switches tab; the
  school page's "Turn the tutor switch back on" does this when the platform is
  on). A school turned on while the platform is off keeps a value of its own
  and ignores the platform's switch until that value is cleared.
- Every change is in the audit log with who did it and why. The log cannot be
  edited, even with the service-role key.

## 3. If something goes wrong

- **Someone lost their authenticator** (you, or any member of staff). The console
  cannot remove a factor (spec 5.8's "another owner removes the factor" is not
  built; plan 6's ruling F7), so it is always this, as the service role in the
  dashboard's SQL editor: `delete from auth.mfa_factors where user_id = '<their
  id>';` (UNVERIFIED: the table name; check `\dt auth.*`). Then they sign in and
  enrol at once. A second owner on staff cannot do it from the console either.
- **System shows wrong alarm tokens.** "Wrong tokens" counts the last hour's
  calls to the alarm or the audit copy with a token that does not match (0075).
  One or two after you rotated the token mean a checker still has the old one;
  a steady count means someone with the public key is guessing: rotate the
  token (`select admin.alert_token_set('<new token>');`) and update the
  checker's secret.
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

1. **Migrations 0052 to 0055.** The one push of section 1 step 1 applies
   them with the rest. 0053 replaces `lms.audit_log` so a Qrie staff action shows as "Qrie
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
   `ADMIN_ALERT_ENABLED` variable, and runs only from `master` (section 1 step
   7). Run the "Admin audit copy" workflow once by
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
   migration level should read the highest migration pushed (0075 from this
   branch, or higher once another lane's are applied).
8. **What the switches do.** See section 7: once 0062 to 0064 are applied,
   the database refuses tutor classes to the children of a school whose tutor
   switch is off or that is suspended, and refuses staff's imports for an
   offboarded or suspended school (the school admin's are refused by the
   import code, once deployed as section 7 says); the apps show the rest only
   from the builds named there. Only you
   (the owner) can turn a tutor switch back on, or clear a school's own value
   when that brings its tutor back on; a teacher's or a school admin's new PIN,
   and a teachers sheet, are yours too.

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
  tutor (0061: your ruling on spec section 3), but cannot resume it: every page
  finance can open shows a Stop control in its header (Today and System, where
  the others stop it, are not finance's). A finance member is added like any
  staff member, with the role `finance`.
- **Safety:** no billing.

### Setup, once (Aarav's steps, in this order)

1. **Cashfree account.** Sign up, complete business KYC (PAN, business proof,
   the director's KYC; the exact list is UNVERIFIED), add and verify the
   settlement bank account, and get Payment Gateway with Payment Links enabled.
2. **Policy pages on the website** (landing): terms, refund and cancellation,
   privacy, contact, and pricing. The privacy page names the sub-processors spec
   section 6 lists: Cashfree (payments), GitHub (its Actions run the alarm and
   the audit copy) and Telegram (carries the alarm's messages); today it names
   none of them (`landing/app/privacy/page.tsx`). Payment gateways ask for them during activation; which ones Cashfree
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
5. **Apply the migrations:** the one push of section 1 step 1 applies 0056 to
   0060 with the rest. No new schema needs exposing: billing's browser
   functions are in `admin`, already exposed in section 1 step 2. 0060 schedules
   the daily job `billing-states` at 00:10 India time; that `pg_cron` runs it on
   the hosted project is UNVERIFIED (after the push, `select jobname, schedule
   from cron.job;` should list it).
6. **Sandbox keys into Supabase secrets**, never on a command line. Make the
   token with `openssl rand -hex 24`, then write a file outside the repository
   with a text editor (not `printf` or `echo`, which leave the values in your
   shell history), for example `~/cf.env`:

   ```bash
   CASHFREE_CLIENT_ID=<id>
   CASHFREE_CLIENT_SECRET=<secret>
   CASHFREE_ENV=sandbox
   CASHFREE_API_VERSION=2026-01-01
   BILLING_RECONCILE_TOKEN=<the token>
   ```

   ```bash
   npx supabase secrets set --env-file ~/cf.env && rm ~/cf.env
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
12. **Decide later (no build needed now):** whether
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
2. **Apply the migrations:** the one push of section 1 step 1 applies 0062 to
   0064 with the rest (and plan 5's 0065 to 0069, the merge's 0070, which lets
   Today read distress capture as captured once a flag arrives or you record the
   day, plan 6's 0071 to 0074 and the final review's 0075). The tutor's
   admission check works with the relay that is live today. System's migration
   level reads the highest number applied.
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
- **A school's children cannot start a class**: its own tutor switch is off,
  the platform's is off and the school has no value of its own on, or its
  licence is suspended (Billing, that school).
- **A school keeps teaching while the platform's switch is off**: it has a
  value of its own, on. Its Switches tab, "Follow the platform", clears it.
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
3. **Apply the migrations:** the one push of section 1 step 1 applies 0065 to
   0069 and the merge's 0070 with the rest. Nothing new to expose: the functions are in
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
  Spec section 13's co-signature by the school's principal is not built yet
  (plan 6's ruling F1, plan 7): until it is, get the school admin's written
  agreement before verifying a school student's request, and name it in the
  reason ("school admin agreed in writing, <date>").

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
9. Plan 6's figures: are per-school daily sign-in counts, and the contest
   funnel (entered, a parent verified, a first class, a second day, for each
   complete week, with weeks under 10 entrants hidden), outside DPDP s.9(3)'s
   "tracking or behavioural monitoring" of children? Until you have the
   answer they are built with the small-group rule; if the answer is no, a
   reviewed migration sets `captured` to false on those catalogue rows
   (`school.signins`, and `funnel.cohort`, `funnel.verified`,
   `funnel.first_class`, `funnel.second_day`), and the pages read them
   "Not captured" (section 9). And: on a day with fewer than 10 learners,
   Overview's minutes on task, classes served and AI spend (and Money's
   spend per school, for a school with few active children) describe those
   few children's use together, with no identity; are these allowed, or
   must they be hidden like the learning figures?
10. Spec section 13 asks for the principal's co-signature on destructive
    actions on a school's data (erasing a child, offboarding). Until it is built
    (plan 7), Qrie staff can erase a school child's records with the school
    admin's written agreement as the only check outside Qrie. Is that enough if
    the school is the data fiduciary (question 1), and what must the
    co-signature be (who signs, in which app, before which step)?

## 9. The charts (plan 6)

Eight pages under **Charts** in the console: **Overview**, **Money**,
**Schools**, **Learning**, **Content**, **Reliability**, **Funnel** and
**Safety**, each over the last 7 or 30 India days ending yesterday. The plan is
`docs/superpowers/plans/2026-10-11-super-admin-visualiser.md`. Nothing in this
section has been run against a hosted project: migrations 0071 to 0074 and the
pages were built and tested on the local test database only, and the pages
have not been opened in a browser.

**Plan 6 changes no tutor code; nothing in `apps/classroom`, `packages/relay`
or `supabase/functions/relay` may be deployed from this branch until it is
merged with `phase3-completion` and `voice-stt-tts` (743c05a, 1dcfcfe,
18733af).**

### What the charts are

- **Who sees which page.** The database decides (`admin.chart_roles`); the
  sidebar only follows it. Overview, Schools, Learning, Content, Reliability
  and Funnel: the owner and ops. Money: the owner, ops and finance. Safety:
  the owner and safety. Finance sees only Charts, Money; safety only Charts,
  Safety.
- **Where the numbers come from.** One table of daily figures,
  `admin.metric_daily`, filled by the job `admin-metrics-nightly` at 18:50 UTC
  (00:20 India time): it rolls up yesterday, with the snapshots, and works out
  the six days before again (sittings close and phones sync late, so a day's
  figures can still rise for six days), and the contest funnel's cohorts of
  the current week and the four before it. The owner can work out up to 92 days
  ending yesterday again with the **Recompute** button (a fresh authenticator
  code, a reason and the environment typed).
- **Live tiles** at the top of Overview, Money, Safety and Reliability come
  from the same reads as Today, Billing, Safety and System; Content's (classes
  and the question bank now, the most reported and costliest classes to date)
  from `admin.content_view`.
- **Snapshots** (each school's health, students, seats, activation and
  sign-ins; classes by status; the question bank) are what the nightly run
  saw that night. A recompute leaves them as they were; a night that did not
  run is a gap in those lines for good.

### What they never show

- **A child.** No chart lists, ranks or follows a child; the table behind them
  has no column that can hold a person's id, and no read returns an id, a
  login ID, a name, a report's words, a phone number or an address.
- **A figure about fewer than 10 children, alone or by subtraction.** Each
  school's activation, hand-ins and sign-ins (for a school with fewer than 10
  students), every learning figure (outcomes answered, misconceptions,
  practice) for fewer than 10 children, and a funnel week with fewer than 10
  entrants read "Hidden to protect a group of fewer than 10 children." The
  database also hides a figure that, added to or subtracted from another the
  console shows, would single out fewer than 10 children: the platform's
  practice (or outcomes answered) when 1 to 9 of the children behind it are
  outside the schools shown, and the all-schools total of a school figure
  while any school is hidden. Outcomes answered and misconceptions are shown
  for fixed 30-day blocks, and the funnel for each complete India week on its
  own with no total, so no two of these figures cover overlapping days.
  Misconceptions come from the library's questions only, never a school's
  own. The tests that try these subtractions are in
  `supabase/tests/admin-metrics-small-groups.test.ts`.
- **What this does not cover.** A figure rolled up again after records were
  erased or purged (or recomputed after that) differs from the one shown
  before by those records: anyone who wrote the old one down can subtract.
  The school health card (section 5) still shows each school's activation and
  hand-in percentages, a small school's too, and the direct-user lookup shows
  a user's contest entry and consent. On a day with fewer than 10 learners,
  Overview's minutes, classes and spend describe those few children's use
  together (counsel question 9).
- **A zero for something not captured.** These read grey "Not captured", with
  the reason: the relay's refusals by reason (`claim_relay` keeps no record of
  them), the time a call took (no column records it), the alarm's history (only
  its last check is kept), sign-ins where `auth.users` has no
  `last_sign_in_at`, and distress flags before the day capture went live. A
  day with no roll-up reads "No figure", never 0.

### Setup, once (Aarav's steps)

1. **Apply the migrations:** the one push of section 1 step 1 applies 0071 to
   0074 with the rest (the hosted project had nothing past 0025 on 2026-10-03,
   STALE). Nothing new to expose: every function is in
   `admin`.
2. **Check the job:** on the System page, `admin-metrics-nightly` appears with
   the schedule `50 18 * * *`; after the first night its last run should read
   Succeeded.
3. **Fill the past once:** on any chart page, press **Recompute** (owner, fresh
   code) for the 92 days ending yesterday, then again for the 92 before that
   if you want them. Snapshots start from the first night and cannot be filled
   backwards.
4. **Load prices:** until `public.model_price` holds a row for each model in
   use, spend and Rs per student-hour read "at least" (the page says how many
   calls have no price). After adding prices, Recompute the days you care
   about.
5. **Redeploy the console** the way you host it (section 1): it has a new
   dependency, Recharts.
6. **Do not deploy the tutor or the relay from this branch** (see the line at
   the top of this section).
7. **Ask counsel** question 9 of section 8 (sign-ins per school and the
   contest funnel).

### Day to day

- The figures run through yesterday (India time); each page says when they
  were last rolled up. Outcomes answered and misconceptions change once every
  30 days, when a block ends (blocks run back to back from 2026-01-01); the
  funnel's newest row is the last complete week, Monday to Sunday.
- "No figure" means no roll-up ran for that day yet.
- The meter's units and the ceiling are kept by UTC day, the ceiling's own
  day, so those two lines end a day earlier than the others.
- "At least" means some calls have no price row yet: add prices to
  `model_price`, then Recompute.

### If something goes wrong

- **The charts stopped moving.** The System page shows
  `admin-metrics-nightly`'s last run. A failed night loses that night's
  snapshots for good; its other figures come back with Recompute.
- **A recompute lowered an old figure.** A recompute counts the records as they
  are now: children erased since, Cashfree signature failures older than 90
  days (deleted by the nightly `billing-states` job), payments reversed and invoices
  voided since, and sittings older than 90 days with no answer in them (which
  the nightly `purge-old-ledger` job deletes) are not counted.
- **To stop the job:** in the dashboard's SQL editor,
  `select cron.unschedule('admin-metrics-nightly');`. The charts then stop
  moving; the console keeps working.

### Kept

`admin.metric_daily` holds daily figures only, none of them a child's, and is
kept indefinitely. It is not in the Privacy page's "What is kept" table.
