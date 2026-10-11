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
4. **Close email sign-up** (recommended until the college track needs it).
   No app calls `signUp`, and children sign in anonymously or with a school ID and
   PIN made by the import. Dashboard, Authentication, "Allow new users to sign
   up": off. Anonymous sign-ins stay on. Open the tutor afterwards and start a
   class to be sure. (UNVERIFIED: that the two toggles are independent.)
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
