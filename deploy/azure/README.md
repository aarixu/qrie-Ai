# QRIE on one Azure VM: the runbook

How the LMS goes live for schools: the three web apps on one Azure VM, the
data on Supabase Cloud. Steps are in order. Each is marked **(founder)** for
something you do in a browser or by hand, or **(script)** for something a file
in this folder does.

Written 2026-10-10. **Nothing here has run on a VM or against the hosted
project yet.** The scripts were checked on the laptop only ("What has been
checked", at the end). Lines marked **NOT VERIFIED** come from documentation
or memory: confirm them the first time.

## What runs where

| What | Where |
|---|---|
| Postgres, Auth, Storage, Edge Functions (`lms-signin`, `lms-admin`, `relay`) | Supabase Cloud, project `ueemqirxyrltdmqgnidy`. The CLI's cached pooler address for it is in `aws-0-ap-south-1`, AWS Mumbai (`supabase/.temp/pooler-url`). |
| Teacher app and School Portal (`apps/lms`) | `https://teacher.<domain>`, nginx on the VM |
| Student and parent app (`apps/student`) | `https://app.<domain>`, nginx on the VM |
| Super Admin console (`apps/admin`, on the admin branch) | `https://admin.<domain>`, nginx on the VM |
| Nightly database backup | the VM, to Azure Blob Storage |
| Uptime watching | an outside monitor (step 13) |
| The brain runner | later (step 16) |

The apps run in the browser and talk to Supabase directly. The VM serves their
files. What it holds of the schools: nginx's logs (each request's address and
path), and each night's dump, which waits in `/var/lib/qrie-backup` only until
it is uploaded.

## Files

| File | Runs where | Does |
|---|---|---|
| `setup-server.sh` | VM, once, with sudo | packages, firewall, fail2ban, sshd, swap, time zone, Node 22, PostgreSQL client, azcopy, nginx, folders, the backup timer |
| `nginx/site.conf.template`, `nginx/render-sites.sh` | VM (`qrie-render-sites`) | one nginx site per app, with its own Content-Security-Policy |
| `deploy-apps.ps1` | laptop | builds the apps for the hosted project, checks them, uploads, switches |
| `activate-release.sh` | VM, run by `deploy-apps.ps1` | unpacks a release, switches `current`, reloads nginx, keeps five; also rollback |
| `backup/qrie-backup.sh`, `.service`, `.timer`, `row-counts.sql`, `backup.env.example` | VM | the nightly backup |
| `RESTORE-DRILL.md` | you | proving a backup restores |
| `tests/` | laptop | checks of the scripts above (end of this file) |

## 1. An SSH key (founder, laptop)

```powershell
ssh-keygen -t ed25519 -f $HOME\.ssh\qrie_azure_ed25519 -C qrie-azure
```

Give it a passphrase. `deploy-apps.ps1` uses this key and opens two
connections per deploy, so without an ssh-agent it asks for the passphrase
twice. To load it once per session instead (the first two lines in an
administrator PowerShell, once):

```powershell
Get-Service ssh-agent | Set-Service -StartupType Manual
Start-Service ssh-agent
ssh-add $HOME\.ssh\qrie_azure_ed25519
```

## 2. The VM (founder, Azure portal)

Create a virtual machine with:

- **Image** Ubuntu Server 24.04 LTS. **Size** Standard_B2ms. **Region** Central India.
- **Authentication** SSH public key, **username** `qrie`, the key: the
  contents of `qrie_azure_ed25519.pub`.
- **Inbound ports** 22, 80 and 443. Step 7 narrows 22 to your address.
- **Public IP** Standard, with assignment **Static**, so DNS never goes stale.
- **Boot diagnostics** on, with a managed storage account: the serial console
  (step 15) needs it.

Write down the public IP address. (The portal's wording moves around: NOT VERIFIED.)

## 3. DNS (founder, the domain's registrar)

Three **A** records, each to the VM's IP address, TTL 300 to begin with:
`teacher`, `app`, `admin` (the last only if you will serve the admin console).
No AAAA records: the VM has no public IPv6 address. Check from the laptop:

```powershell
Resolve-DnsName teacher.<domain>
```

## 4. First SSH (founder, laptop)

```powershell
ssh -i $HOME\.ssh\qrie_azure_ed25519 qrie@<VM IP>
```

Answering `yes` stores the VM's host key in `known_hosts`. `deploy-apps.ps1`
connects only to a VM whose key is already there (`StrictHostKeyChecking=yes`).
To compare the fingerprint before answering, read it through the portal: VM,
Run command, RunShellScript: `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`.

On the VM, this prints the address the VM sees you coming from, which is the
one to give setup as `--admin-ip`:

```bash
echo "${SSH_CONNECTION%% *}"
```

If your internet connection's address changes from day to day, SSH will stop
working when it does, until you change it (step 15).

## 5. Copy the kit to the VM (founder, laptop)

From the repository's folder:

```powershell
scp -i $HOME\.ssh\qrie_azure_ed25519 -r deploy\azure qrie@<VM IP>:qrie-kit
```

If bash on the VM later complains about `$'\r'`, the files reached it with
Windows line endings (a checkout made before this folder's `.gitattributes`
existed). On the VM: `sed -i 's/\r$//' ~/qrie-kit/*.sh ~/qrie-kit/*/*.sh`.

## 6. Set up the VM (script)

On the VM:

```bash
sudo bash ~/qrie-kit/setup-server.sh --admin-ip <your address> --domain <domain>
```

It takes some minutes, and running it again is safe. In order, it:

- updates and upgrades the packages; turns on unattended security updates,
  restarting the VM at 03:30 India time when an update needs it;
- makes the folders: `/var/www/qrie/{teacher,app,admin}/releases` (owned by
  `qrie`), `/var/www/letsencrypt`, `/etc/qrie` (root, 0700), `~/qrie-upload`;
- sets the time zone to Asia/Kolkata, and adds a 2 GB swap file if there is no swap;
- **firewall (ufw):** SSH from `--admin-ip` only (that rule goes in before ufw
  is switched on), then 80 and 443 from anywhere. If this SSH session comes
  from an address `--admin-ip` does not cover, it stops before touching
  anything that could lock you out. Run it again with a new `--admin-ip` and
  the old address's rule is removed;
- **fail2ban** with the `sshd` jail (5 failures in 10 minutes: banned for an
  hour; your address is never banned);
- **sshd:** no passwords, no keyboard-interactive sign-in, no root. It refuses
  to do this if `qrie` has no SSH key, checks the new settings with `sshd -t`
  and `sshd -T` before reloading, and takes them out again if either check fails;
- Node.js 22 (NodeSource), for the brain runner later; the PostgreSQL 17 client
  (PGDG), whose `pg_dump` the backup uses; azcopy (packages.microsoft.com);
- a sudo rule letting `qrie` run exactly `nginx -t` and `systemctl reload nginx`
  without a password, which is all a deploy needs as root;
- nginx: removes Ubuntu's default site, writes the three sites for port 80
  (step 8 adds https), and turns on certbot's renewal timer;
- the backup script and its systemd timer, switched on only once
  `/etc/qrie/backup.env` exists (step 12).

The PostgreSQL client must be the same major version as the project's server
or newer: `pg_dump` refuses a newer server. 17 is the default because the CLI
recorded the project as 17.6 (`supabase/.temp/postgres-version`). Check in
Supabase's SQL editor with `select version();`, and if it says another major,
run setup again with `--pg-major <that number>`.

Optional, as a way back in if SSH and the VM agent both fail (step 15): give
`qrie` a long password, kept in your password manager: `sudo passwd qrie`.
sshd still refuses passwords; only the serial console accepts it.

## 7. The Azure network security group (founder, Azure portal)

VM, Networking: the inbound rule for port 22 gets **Source: your IP address**;
80 and 443 stay open to the Internet; delete any other inbound allow rule. ufw
on the VM enforces the same thing, so either one alone still holds.

## 8. Certificates (founder, then script)

On the VM, one command per name whose DNS already points at the VM:

```bash
sudo certbot certonly --webroot -w /var/www/letsencrypt -d teacher.<domain> --deploy-hook 'systemctl reload nginx'
sudo certbot certonly --webroot -w /var/www/letsencrypt -d app.<domain> --deploy-hook 'systemctl reload nginx'
sudo certbot certonly --webroot -w /var/www/letsencrypt -d admin.<domain> --deploy-hook 'systemctl reload nginx'
```

The first one asks for an email address and whether you accept Let's
Encrypt's terms. Those answers are yours to give. Then write the https sites:

```bash
sudo qrie-render-sites --domain <domain>
```

It prints `https` for every site that now has a certificate. certbot's timer
renews them, and the deploy hook reloads nginx afterwards. To test renewal:
`sudo certbot renew --dry-run`.

The kit uses certbot's `--webroot` mode, so certbot never edits the nginx files
`qrie-render-sites` writes. Each https site sends:

- a Content-Security-Policy of its own (below);
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`;
- `Permissions-Policy` switching off camera, microphone, geolocation, payment
  and USB;
- `Strict-Transport-Security` (on https only).

Port 80 answers Let's Encrypt and redirects everything else to https. Hashed
files under `/assets/` are cached for a year; `index.html` is never cached. A
name that is not one of the sites, such as the bare IP address, gets no answer.

The teacher and app policies come from what each app loads (read on
2026-10-10 in its source and in its build of 2026-10-08; the reasons are
written in `nginx/render-sites.sh`):

| | teacher | app | admin |
|---|---|---|---|
| scripts | own files only | own files only | own files only |
| styles | own, inline, Google Fonts | own, inline | own, inline |
| fonts | own, Google Fonts | own | own |
| images | own, `data:`, the project | own, `data:`, `blob:` | own, `data:` |
| connections | own, the project | own, the project | own, any `*.supabase.co` |

"The project" is `https://ueemqirxyrltdmqgnidy.supabase.co`. The admin column
is `apps/admin/vercel.json` on the admin branch, word for word. The teacher app
loads Inter and Manrope from Google Fonts (`apps/lms/index.html`), so each
teacher's browser contacts Google; serving the fonts from the app itself would
let its policy drop both Google addresses. Neither LMS app opens a Realtime
channel, so no `wss:` address is allowed. If an app is ever built with a relay
address (`VITE_QRIE_RELAY_URL`) on another origin, its policy needs that origin.

## 9. Supabase settings (founder)

These are settings of the hosted project, which the tutor shares.

**Check first.** This step needs three things in the checkout you deploy from:
the sign-in guard `supabase/functions/lms-signin/index.ts`, the passwords made
from the PIN and a pepper (`tools/lms-import/src/pinGuard.ts`), and apps whose
hosted build talks to Supabase. The first two reached the `lms` branch on
2026-10-10 (commit `08df960`); the third was still being built when this kit
was written. If `lms-signin` is missing, stop: the hosted sign-in would have
no per-ID lockout (finding 1 of
`docs/security/2026-10-08-lms-security-and-data-review.md`).
`deploy-apps.ps1` stops by itself when a build does not contain the Supabase
address.

The CLI is the repository's own (`npx supabase`). Sign in once with
`npx supabase login`. The migration commands below use the linked project:
`npm run relay:link` links it, and does nothing else (it is
`supabase link --project-ref ueemqirxyrltdmqgnidy`). The other commands name
the project themselves.

1. **Migrations 0026 to 0046.** The apps call functions these migrations make,
   and both edge functions need 0046. On 2026-10-10 the hosted project had only
   migrations up to about 0025 (not checked again for this kit). Read before
   you push:

   ```powershell
   npx supabase migration list --linked
   npx supabase db push --dry-run
   ```

   `db push` applies every migration in your checkout that the project has
   not had. Other branches carry 0047 and later (the admin console's own
   steps are in `docs/ops/admin-console.md` on the admin branch). Choose the
   branch you push from with that in mind; this kit does not decide it.

2. **Email sign-in on.** Authentication, Sign In / Providers, Email: enabled.
   Every LMS account is an email address ending `@login.qrie.invalid`
   (`packages/lms-client/src/login.ts`), created already confirmed
   (`tools/lms-import/src/supabaseStore.ts`), so "Confirm email" does not
   matter to it. That Supabase accepts a `.invalid` address is NOT VERIFIED
   until the first real import (`login.ts` says the same). Leave sign-ups as they are: the tutor's own
   sign-up, its email and phone codes and its anonymous sign-in use this
   project (`apps/classroom/src/lib/supabase.ts`, `relay.ts`).

3. **Expose the `lms` schema.** Project Settings, Data API, Exposed schemas:
   add `lms` beside `public` (wording NOT VERIFIED). Every data call the apps
   make is to a function in `lms` (`packages/lms-client/src/transport.ts`). On the same
   page, leave **Max rows** at 1000: the apps fetch long lists 1000 rows at a
   time and stop at the first shorter page, so a lower limit would cut lists
   short without an error.

4. **The pepper, `LMS_PIN_PEPPER`.** A secret of at least 32 characters
   (`pinGuard.ts`). In PowerShell, so it never sits in your shell history:

   ```powershell
   $bytes = New-Object byte[] 48
   [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
   $pepper = -join ($bytes | ForEach-Object { $_.ToString('x2') })
   $file = Join-Path $env:TEMP 'qrie-pepper.env'
   [IO.File]::WriteAllText($file, "LMS_PIN_PEPPER=$pepper")
   npx supabase secrets set --env-file $file --project-ref ueemqirxyrltdmqgnidy
   Remove-Item -LiteralPath $file
   $pepper | Set-Clipboard   # into your password manager now
   ```

   A project's secrets reach all its functions, so `lms-signin` and
   `lms-admin` both get it; whoever runs the import CLI's `--apply` needs it
   in their environment too (the header of `supabase/functions/lms-signin/index.ts`).
   **Never change it** once accounts exist: every PIN would stop working until
   each person got a new one (`pinGuard.ts`).

5. **Deploy the two edge functions,** after the migrations:

   ```powershell
   npx supabase functions deploy lms-signin --no-verify-jwt --project-ref ueemqirxyrltdmqgnidy
   npx supabase functions deploy lms-admin --no-verify-jwt --project-ref ueemqirxyrltdmqgnidy
   ```

   `--no-verify-jwt` because a person signing in has no token yet
   (`lms-signin`), and because `lms-admin` checks the caller's token itself
   and refuses anyone but their school's admin (each file's header says so).
   Neither has run on a deployed project yet; try each once after step 10:
   sign in, and give a test account a new PIN from the School Portal.

6. **Raise the per-address sign-in limit.** Authentication, Rate Limits
   (wording NOT VERIFIED). Supabase counts sign-ups and sign-ins per IP
   address per 5 minutes; its documentation gives 30 as the default (NOT
   VERIFIED for this project: read the number on the page). A whole class on
   one school Wi-Fi shares one address, so a class of 40 signing in at the
   bell would be refused. Set it to at least the number of people who may
   sign in from one school within five minutes.

   Raising it is safe for the LMS because of how sign-in works
   (`tools/lms-import/src/signIn.ts`, `pinGuard.ts`, as built on 2026-10-10):
   - The app sends the ID and PIN to `lms-signin` first. It locks an ID for 15
     minutes after 5 wrong PINs, and refuses an address that has had 200 tries
     not proven right in its 15-minute window. Whether a caller can fake its address there has not been
     checked (the header of `supabase/functions/lms-signin/index.ts`); the
     per-ID lockout does not depend on the address.
   - Only for the right PIN does it send back the account's Auth password,
     and the app then signs in to Supabase Auth from the same phone or browser.
   - That password is not the PIN but a long string made from the ID, the PIN
     and the pepper. Guessing PINs at Supabase Auth directly gets nowhere,
     and Auth's password-length and leaked-password checks only ever see the
     long string.

   The same limit also guards the tutor's email-and-password accounts on this
   project: a higher number lets one address try more passwords there.

   On the same page, the limit on session refreshes per address: with
   Supabase's default one-hour sessions, a signed-in app renews its session
   about once an hour, so 1,000 people behind one address make roughly 85
   renewals in five minutes. Raise it if a school is bigger than its number
   allows.

7. **Never run `npm run relay:deploy`** for any of this. It runs
   `relay:secrets`, then `supabase db push`, then deploys the relay
   (`package.json`): the push would apply every migration in your checkout.

8. **Only for the admin console:** its own steps (the `admin` schema, its
   migrations, `admin-api` with `ADMIN_ORIGIN=https://admin.<domain>`) are in
   `docs/ops/admin-console.md` on the admin branch. This kit only builds and
   serves it.

Adding the first school and its admin is the import CLI's job
(`tools/lms-import`), not this kit's.

## 10. Build and deploy the apps (script, laptop)

From the repository's folder, after `npm run typecheck` (the deploy builds with
`vite build` only, which does not check types):

```powershell
.\deploy\azure\deploy-apps.ps1 -VmHost <VM IP> -Domain <domain> `
  -SupabaseUrl https://ueemqirxyrltdmqgnidy.supabase.co `
  -SupabaseAnonKey '<the anon or publishable key: Project Settings, API Keys>' `
  -PrivacyContact '<the privacy contact the apps show>'
```

To deploy the admin console as well, add `-AdminCheckout '<a checkout of the
admin branch>'`; without it, only the teacher and student apps are deployed.

If Windows refuses to run scripts: `powershell -ExecutionPolicy Bypass -File
.\deploy\azure\deploy-apps.ps1 ...` (for that one run only).

What it does, and where it stops (`Get-Help .\deploy\azure\deploy-apps.ps1 -Full`):

- It stops if the key is a service-role or secret key, or another project's.
- It builds `apps/lms` and `apps/student` with `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY` and `VITE_QRIE_PRIVACY_CONTACT`. `VITE_QRIE_DEMO_URL`
  and `VITE_QRIE_RELAY_URL` stay unset, and it stops if an app's `.env` file
  sets either. With no relay address, `supabaseBackend` answers "Draft with
  AI" with "Drafting with AI is not switched on for this school yet."
  (`packages/lms-client/src/backend.ts`). The admin console is built with
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_ADMIN_ENV=HOSTED`.
- It stops if a build does not contain the Supabase address, and warns if the
  teacher or student build does not contain the privacy contact.
- It runs `tools/bin/check-bundle-secrets.mjs` on every build and stops on any
  finding, before anything is uploaded.
- It uploads, then on the VM: unpacks each build into `releases/<time>`,
  checks `nginx -t`, switches every site's `current` link, reloads nginx, and
  keeps the newest five releases. The asset files of the release before are
  copied into the new one, so a page opened before the deploy can still load
  the parts it has not fetched yet.
- It asks each `https://<site>.<domain>/` and stops with a warning unless the
  page names the new build and carries a Content-Security-Policy.

Building overwrites `apps/lms/dist` and `apps/student/dist` (and the admin
checkout's `apps/admin/dist`), as any `vite build` does.

**Rollback** to the release before the live one:

```powershell
ssh -i $HOME\.ssh\qrie_azure_ed25519 qrie@<VM IP> bash qrie-upload/activate-release.sh --rollback teacher
```

## 11. Check by hand (founder)

```powershell
curl.exe -sI https://teacher.<domain>/     # 200, with the headers of step 8
curl.exe -sI http://teacher.<domain>/      # 301 to https
```

Then open each site, sign in with a test account, and look at the browser's
console for "Refused to ..." messages: each is something the policy blocked.
On a phone, open `https://app.<domain>`, and hand in homework with **Take or
choose a photo**. The `Permissions-Policy` header switches off the page's own
use of the camera; that the phone's photo picker still works under it is NOT
VERIFIED until you try it.

## 12. Backups (founder, then script)

**Where.** A storage account in **Central India**, with blob soft delete on
(14 days, say) and anonymous blob access off. In it, a private container, for
example `qrie-backups`.

**Deleting old backups: a lifecycle rule, not the script.** Storage account,
Data management, Lifecycle management: a rule for blobs with the prefix
`qrie-backups/db/` that deletes them 30 days after they were last modified.
Azure runs these rules about once a day, so a backup may outlive 30 days by a
day (from Azure's documentation; NOT VERIFIED). Because of this rule, the VM's
SAS needs no delete or list permission:
someone who took over the VM could not delete the old backups. They could
overwrite one by name with a write permission; soft delete keeps the
overwritten copy for its days.

**The SAS.** On the container: Shared access tokens, permissions **Create** and
**Write** only, HTTPS only, an expiry a year out, and a reminder in your
calendar before then: the backup fails, and the heartbeat stops, the night it
expires. Copy the **Blob SAS URL**: that is `AZURE_BLOB_SAS_URL`. That azcopy
uploads with only these two permissions is NOT VERIFIED; the first run below
is the test. If it is refused, do not add Read: a SAS that can read would let
whoever holds it download every backup.

**The database address.** Supabase dashboard, Connect, **Session pooler**, with
the database password in place of `[YOUR-PASSWORD]`: that is `SUPABASE_DB_URL`.
The session pooler, because the VM has IPv4 only and the project's direct
address answers on IPv6 only (unless the IPv4 add-on is bought).
`backup.env.example` says which characters in the password must be written
as `%..`.

**On the VM:**

```bash
sudo install -m 0600 -o root -g root /etc/qrie/backup.env.example /etc/qrie/backup.env
sudo nano /etc/qrie/backup.env
sudo systemctl enable --now qrie-backup.timer
sudo systemctl start qrie-backup.service          # the first run, now
sudo journalctl -u qrie-backup.service -n 50 --no-pager
systemctl list-timers qrie-backup.timer
```

The journal should end `done: db/qrie-db-<time>.dump`. The backup runs every
night at 02:30 India time, or at the next start if the VM was off then. It runs
as a user systemd makes for the run, not as root. If `pg_dump` stops with
"permission denied" on one of Supabase's own schemas, add that schema to
`BACKUP_EXCLUDE_SCHEMAS` in `backup.env` (never `lms`, `public` or `auth`) and
run it again. Setting that variable replaces the script's own list, so start
from the list in `backup.env.example` and add to it. Then do
`RESTORE-DRILL.md` once.

While the upload runs, any account on the VM can read the SAS on azcopy's
command line (the database password goes to pg_dump and psql through the
environment, never their command lines). Apart from you and root, the
accounts on a fresh Ubuntu VM are system ones, such as nginx's `www-data`.

### What a backup holds and what it does not

A dump is `pg_dump --format=custom` of the project's database, without the
schemas `_analytics _realtime _supavisor realtime net pgsodium pgsodium_masks
vault supabase_functions` (Supabase's internals, pg_net's request log, Vault's
secrets). As far as the `postgres` role can read them, it holds the tables
and rows of `lms`, `public`, `auth` (accounts, their password hashes, their
sessions), `storage` (the list of stored files: names, sizes, owners),
`supabase_migrations` and the rest. That the role can read all of these is
NOT VERIFIED until the first run.

It does **not** hold:

- **The photos of work.** Their bytes live in Supabase Storage (bucket
  `lms-work`), outside the database; the dump has only their records (names,
  sizes, owners). Nothing in
  this kit copies them, so a lost project loses them.
- **Roles.** pg_dump copies one database, and roles belong to the whole
  server. The grants to Supabase's roles are in the dump, and those roles
  exist in every Supabase project.
- **Extensions' code.** The dump says `CREATE EXTENSION` for pg_cron,
  pg_graphql and the rest; plain PostgreSQL lacks several, so those fail there
  (`RESTORE-DRILL.md`, step 4).
- **What lives outside the database:** the edge functions (their code is in
  git), their secrets (keep `LMS_PIN_PEPPER` in your password manager: without
  the same pepper no restored account's PIN works), the project's settings
  (step 9), its API keys and its JWT secret.

Restoring into plain PostgreSQL is what `RESTORE-DRILL.md` rehearses. Moving
the school to a new Supabase project is a different job, not rehearsed (the
end of `RESTORE-DRILL.md`). Supabase's own backups depend on the plan:
Database, Backups in the dashboard says what this project has.

## 13. An outside uptime monitor (founder)

Any monitoring service outside Azure, so it still speaks when the VM or
Azure's region does not:

- `https://teacher.<domain>/`, `https://app.<domain>/`, `https://admin.<domain>/`
  every 5 minutes; alert unless the answer is 200 and contains `Qrie` (each
  app's page title does);
- certificate expiry, 14 days ahead;
- a heartbeat check for the backup, expected every 24 hours with a few hours'
  grace. Put its address in `BACKUP_HEARTBEAT_URL` in `backup.env`: the
  backup asks it once after each good night, so a missed night raises the alarm.

These watch the VM, not Supabase: the pages can be up while Supabase is down.
Subscribe to Supabase's status page for that.

## 14. Day to day

- **Deploy:** step 10 again. **Rollback:** the command under step 10.
- **Updates:** Ubuntu's security updates install by themselves every day,
  with a restart at 03:30 when one needs it. Node, the PostgreSQL client and
  azcopy come from outside Ubuntu, which those automatic updates do not cover
  by default: once a month, `sudo apt update && sudo apt upgrade`.
- **Certificates** renew by themselves; the uptime monitor warns if one does not.
- **Restore drill:** monthly (`RESTORE-DRILL.md`).
- **The backup SAS:** renew it before it expires (step 12).
- **Your address changed:** step 15, then run setup again with the new
  `--admin-ip`.

## 15. Locked out of SSH (founder, Azure portal)

The usual causes: your address changed (the NSG and ufw both stop you),
fail2ban banned an address, or a broken sshd setting.

1. **The NSG.** VM, Networking: set the SSH rule's source to your new address.
2. **ufw and fail2ban, through Run command.** VM, Run command, RunShellScript.
   It runs as root through Azure's VM agent, without SSH:

   ```bash
   ufw allow from <new address> to any port 22 proto tcp comment 'qrie: ssh from the admin'
   fail2ban-client set sshd unbanip <new address>
   ```

   Then SSH in, and run `setup-server.sh` with `--admin-ip <new address>`, which
   also removes the old address's rule.
3. **A broken sshd setting,** through Run command:
   `rm /etc/ssh/sshd_config.d/00-qrie-hardening.conf && systemctl restart ssh`,
   then SSH in and run setup again.
4. **If Run command gets no answer** (the VM agent is down): VM, Help, Serial
   console. It needs boot diagnostics (step 2) and a password for `qrie` (the
   optional line in step 6). Sign in there and do the same.
5. **If none of these work:** Azure's VM repair (`az vm repair create`) attaches
   the VM's disk to a rescue VM, where the files above can be changed (NOT VERIFIED).

## 16. Later: the brain runner

Another session is building it on the branch `lam-one-brain`. It is to run on
this VM. This kit installs nothing for it except Node.js 22 (step 6); its own
runbook will say how it runs here.

## What this kit leaves open

- **The photos of work are not backed up** (step 12).
- **Logs.** Ubuntu's nginx package rotates nginx's logs away after 14 days
  (`/etc/logrotate.d/nginx`; NOT VERIFIED on this VM). The CERT-In directions
  ask for 180 days, kept in India, and the security review's item 6 (exporting
  logs for a year) is not built here.
- **The teacher app's fonts come from Google** (step 8), so Google Fonts sees
  teachers' addresses.
- **Microsoft Azure is a new sub-processor.** The security review's list
  (part 2) names Supabase, Google Cloud and Vercel; the school's contract and
  the privacy notice should name Azure, Central India, for hosting and backups.
- **lms-signin's per-address limit** depends on an address header nobody has
  checked yet (step 9.6).
- **Deploys come from the laptop**, built from whatever the checkout holds;
  there is no build server.

## What has been checked

On the laptop, on 2026-10-10:

- `bash -n` on the four shell scripts; the PowerShell parser on `deploy-apps.ps1`.
- `bash deploy/azure/tests/activate-release.test.sh`: unpacking, carrying the
  last release's assets, refusing to switch when `nginx -t` fails, the link
  switch, keeping five, rollback and bad input, in a scratch folder with nginx
  stubbed (24 checks; on Windows, Git Bash must be able to make symbolic
  links, which Developer Mode allows).
- `bash deploy/azure/tests/render-sites.test.sh`: the sites rendered into a
  scratch folder with and without a certificate (29 checks).
- `bash deploy/azure/tests/qrie-backup.test.sh`: the backup's handling of the
  database address and its refusals of bad settings (10 checks).
- `powershell -NoProfile -ExecutionPolicy Bypass -File deploy\azure\tests\deploy-apps.test.ps1`
  in Windows PowerShell 5.1: the key checks, finding the entry script and the
  project address in a build, and `check-bundle-secrets` passing a clean build
  and stopping on a planted key (14 checks).

**Not run:** anything on a VM; `nginx -t` on the rendered files; certbot;
`setup-server.sh` itself; `pg_dump`, `psql` or azcopy against the real
services; the systemd units; `deploy-apps.ps1` from start to end.
