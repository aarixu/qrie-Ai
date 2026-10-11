# QRIE admin console: the local demo

A way to see the super admin console (`apps/admin`) working on this computer,
with no Supabase project and no Docker.

`npm run admin:demo` starts a small Node server on **http://127.0.0.1:54329**
that answers the part of Supabase's HTTP API the console uses (sign-in with a
password, authenticator codes, `admin` function calls, and the two edge
functions). Behind it is an in-memory Postgres (PGlite) built with **every
migration**, exactly as the tests build it, then filled with a made-up but
realistic demo. Every database decision (who is staff, aal2, the fresh-code
rule, the environment check, every refusal) is the real migrations' own.

**Local only.** It listens on 127.0.0.1, answers only requests addressed to
this computer, and the only web pages that may call it are the console's
development page (http://localhost:5182 or http://127.0.0.1:5182) and its
own fake Cashfree page.
Nothing it does leaves this computer. It is never deployed. Everything is
forgotten when it stops; every start builds a fresh demo (about a minute).

## Run it

Two terminals, from the repo root:

```sh
npm run admin:demo                          # 1. the backend; wait for "ready"
npm run demo --workspace @ai-tutor/admin    # 2. the console, with apps/admin/.env.demo
```

Then open **http://localhost:5182**.

Or, in Claude Code's preview, the two `.claude/launch.json` entries
`admin-demo-server` and `admin-demo-console`.

If port 54329 or 5182 is already in use, the command stops and says so (stop
the earlier run first).

## Sign in

All four accounts share one password. These are TEST VALUES for this local
demo only (they are defined in `src/seed.ts`):

| Who | Email | State at start |
|---|---|---|
| Owner (Aarav) | `owner@qrie-demo.example` | active, authenticator already set up |
| Safety (Sneha Iyer) | `safety@qrie-demo.example` | active, authenticator already set up |
| Ops (Kabir Malhotra) | `ops@qrie-demo.example` | invited, no authenticator yet |
| Finance (Farah Khan) | `finance@qrie-demo.example` | active, no authenticator yet |

Password for all four: `qrie-local-demo`

**The 6-digit code.** After the password the console asks for an
authenticator code. The demo's keys are made fresh on every start, so instead
of a phone, ask the running demo for the current code:

```sh
npm run admin:demo-code                                   # the owner's
npm run admin:demo-code -- --email safety@qrie-demo.example
```

`GET http://127.0.0.1:54329/demo/code?email=…` gives the same, and exists only
in this demo; it answers a terminal or a typed address, never a web page.

**Setting up an authenticator (ops, finance).** At the first sign-in the
console shows the "set up your authenticator" screen. There is no QR code in
this demo (making one would need a new dependency); the picture says so, and
the key under it can be typed into a real authenticator app. Or run
`npm run admin:demo-code -- --email ops@qrie-demo.example`: it gives the code
of the key being set up.

- **Finance** is already active, so after setting up the authenticator they
  are in.
- **Ops** was only invited (the real order: invite, they set up an
  authenticator, then the owner switches them on). After setting it up they
  see "No access" until the owner switches them on in **Staff**; then they
  reload and are in.

## What is in the demo

- **Environment DEMO**, set as the bootstrap sets it.
- **Qrie Demo School** (code `DEMO`, from `tools/lms-demo`): 82 students in
  6A, 7A, 8A and 8B, four teachers, an admin, a month of homework, answers,
  attendance, notices and the school's activity; a contact, a call note and its
  privacy decision.
- **Sunrise Public School** (code `SUNRISE`): made with the console's own
  "create school" call, 12 students and 2 staff added through admin-api's
  import, a pilot licence, no activity yet.
- **Billing**: made-up seller details, a Standard plan, the demo school's
  billing account and a year's subscription. Its invoice is dated back (issued
  20 days ago, due 5 days ago) and partly paid by bank transfer, so it is
  overdue and the school's Payment signal is amber. A second invoice (a
  workshop) is due in 15 days.
- **Safety**: three children's reports (one "unsafe"), a distress flag, and one
  prepared class (Reflex Actions) waiting for review.
- **Charts**: the nightly roll-up and a recompute of the last 30 days.
- **Switches**: a banner message.
- **Alarm checker**: a token was set and the checker's read was made once at
  start-up, so the tile shows when that was. No checker runs here, so it grows
  stale; no message is ever sent.

## What is fake

| Hosted piece | Here |
|---|---|
| Supabase Auth (GoTrue) | `src/auth.ts`: password sign-in for staff accounts, sessions, refresh, TOTP factors (RFC 6238, checked against the RFC's own test values). Tokens are signed with a key made fresh on every start. |
| PostgREST | `src/rest.ts`: calls functions only (`/rest/v1/rpc/…`), as PostgREST does: the caller's role, their claims, PostgREST's error body and status. No table reads. |
| The anon key | a dummy shaped like one (role anon), in `apps/admin/.env.demo`; no secret. |
| admin-api | the real handler (`tools/admin-api`), in-process, with a **fake Auth admin** (accounts in the demo's auth; an invited person can sign in with the temporary password the console shows once) and a **fake Storage** (removing a file removes its row; there are no files). New PINs go into the LMS demo's PIN table. |
| billing-api | the real handler (`tools/billing`), in-process, with **fake Cashfree** (sandbox, in memory). A payment link's address is `https://fake-cashfree.invalid/links/…`, which opens nothing. To pretend the school paid: press **Send link** on an invoice in the console, open **http://127.0.0.1:54329/demo/fake-cashfree**, pick the link, press the button, then press **Check with Cashfree** on that invoice. |
| cashfree-webhook, other functions | not served (503 "Not available in the local demo"). |
| pg_cron | nothing runs on a schedule; the nightly roll-up and the billing states ran once, at start-up. |

## Tests

`tools/admin-demo/tests`: the TOTP against RFC 4226 and RFC 6238's published
values, the JWT (a changed or foreign token refused, an expired one refused),
the function calls (arguments typed from pg_catalog, PostgREST's errors and
statuses), and one end-to-end run that builds the demo, serves it on a free
port and drives it with the real `@supabase/supabase-js` and the console's own
`admin-client`, as `apps/admin` does.
