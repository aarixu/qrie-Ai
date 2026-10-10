# LMS security review and data-handling plan — 2026-10-08

Two parts: **what was tested and what came out** (part 1), and **how the law
and the handling of children's data are to be set up** (part 2). Part 2 is a
plan for a lawyer to check, not legal advice.

**In scope:** the teacher and admin app (`apps/lms`), the student and parent
app (`apps/student`), both as Android debug builds of 2026-10-08, the demo
school server (`tools/lms-demo`), and the `lms` schema functions they all call
(migrations 0021–0046).

**Not in scope:** the hosted Supabase project's own settings (not checked
live), the tutor (`apps/classroom`), and the relay.

---

## Part 1 — Security test

### How it was tested

| Standard | Used for |
|---|---|
| OWASP ASVS | sign-in, sessions, access control, input, files, headers |
| OWASP API Security Top 10 (2023) | object-level and function-level authorisation, auth, resource use |
| OWASP MASVS (STORAGE, NETWORK, PLATFORM) | the two Android apps |

The tests were of three kinds:

- **Live probes.** Run by hand on 2026-10-08 against the running demo school,
  acting as an attacker who holds real demo accounts (admin, teacher, student,
  parent). There were 33 meaningful checks. The lasting versions of these
  checks are the automated tests listed under each fix and the existing
  `packages/lms-client/tests/safety.test.ts` and
  `supabase/tests/lms-invariants.test.ts`.
- **Static checks.** The Android manifests and Capacitor config, both before
  and after the build: the merged manifest inside each APK was read with
  `aapt`.
- **Dependencies.** `npm audit` could not reach the registry from this laptop.
  These versions were checked by hand against their published advisories:
  jspdf 4.2.1, dompurify 3.4.16, react 19.2.8, pdfjs-dist 5.7.284,
  axios 1.20.0 and supabase-js 2.112.4. All are past the versions those
  advisories name.

### What holds (passed)

| Area | Check | Result |
|---|---|---|
| Sign-in | No token, or a forged one | 401 |
| Sign-in | An unknown ID and a wrong PIN | The same answer, so IDs cannot be found by guessing |
| Sign-in | Five wrong PINs in a row | The ID locks for 15 minutes, even against the right PIN (the demo server only; see finding 1) |
| Session | A token after sign-out | Refused |
| Object-level access (BOLA) | A student reads another student's work or attendance | Refused |
| Object-level access (BOLA) | A teacher reads a class that is not theirs | Refused |
| Object-level access (BOLA) | A parent reads a child who is not theirs | Refused |
| Function-level access | A student or teacher calls admin import, a PIN reset, the school's colours, marking someone as left, or linking a parent | Refused |
| Internal functions | All 10 internal functions, called even by the admin | "permission denied" |
| Injection | SQL in a function or argument name | Refused (names must match a strict pattern; every value is a bound parameter) |
| Injection | Quotes in a search | Stay as text |
| Origins (CORS) | A call from another website's origin | Refused |
| Files | Photo addresses | Not guessable; another student's photo address is refused |
| Errors | Any error | No stack traces |
| Caching | Every answer | `cache-control: no-store` |
| Tracking | Analytics, advertising and crash SDKs in either app | None |
| AI | What a "Draft with AI" request carries | No data about any child: only class, subject, chapter, topic and the teacher's note (`packages/lms-client/src/drafts.ts`). A draft reaches no child until a teacher adds it (migration 0043). |

### Fixed today, with tests

1. **Every answer from the demo server** now carries:
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY`
   - `Referrer-Policy: no-referrer`

   Test: `tools/lms-demo/tests/hardening.test.ts`.
2. **Uploads are checked by their bytes.** A photo's first bytes must match
   the type the phone declared (JPEG, PNG or WebP); anything else is refused
   with 415. Before this fix, an HTML page declared as `image/jpeg` was
   accepted. Test: same file.
3. **Served photos cannot run anything.** They carry
   `Content-Security-Policy: default-src 'none'; sandbox` and `nosniff`.
   Test: same file.
4. **Android: nothing the apps keep on the phone leaves it in a backup or a
   device transfer.** What they keep is the sign-in, a child's answers and
   photos waiting in the outbox, and quiz drafts. The settings:
   - `allowBackup="false"`
   - `fullBackupContent="false"`
   - `data_extraction_rules.xml`, which excludes every domain from both cloud
     backup and device transfer

   Test: `apps/student/tests/android-config.test.ts`. Confirmed in both built
   APKs.
5. **Android: plain http only in debug builds.** `usesCleartextTraffic` now
   lives only in `app/src/debug/AndroidManifest.xml`, so a release build
   speaks https alone. Capacitor's `cleartext` and `allowMixedContent` are on
   only when the app is built for an http demo address. Test: same file.
   Confirmed in both APKs.

### Still open, most serious first

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | **High — before real children** (fix built, not deployed) | **The hosted sign-in has no per-ID lockout until the fix is deployed.** As deployed, it is Supabase Auth's with the PIN as the password, and Auth's rate limits, not checked for this project, are the only brake. A 6-digit student PIN cannot stand up to guessing without a lockout. | **Built and tested on 2026-10-10, not deployed.** The Auth password is no longer the PIN but an HMAC of the ID and PIN keyed with a server secret, `LMS_PIN_PEPPER` (`tools/lms-import/src/pinGuard.ts`). The browser gets it only from a new edge function, `lms-signin` (`tools/lms-import/src/signIn.ts`). That function gives the demo's answers and lockout (5 wrong PINs, then 15 minutes, each try counted before its PIN is checked) and refuses an address after 200 failed tries in 15 minutes. Both counts live in `lms.sign_in_guard` and `lms.sign_in_ip` (migration 0046). The import, New PIN and Add parent write the new password and the guard row. Tests: `tools/lms-import/tests/signIn.test.ts`, `pinGuard.test.ts`, `admin.test.ts`, `cli.test.ts`, and `packages/lms-client/tests/sign-in-hosted.test.ts`. **Still to do:** set the secret (`npx supabase secrets set LMS_PIN_PEPPER=…`, at least 32 characters, also in the import CLI's environment); apply 0046; deploy `lms-signin` with `--no-verify-jwt` and redeploy `lms-admin`; build the apps with `signInUrl`; check whether Supabase's gateway lets a caller choose the first `x-forwarded-for` address (if it does, the per-address limit can be dodged, but the per-ID lockout cannot). Any account made before the deploy keeps its PIN as its Auth password, and has no guard row, until it is given a New PIN. |
| 2 | **High — demo only** | **The Wi-Fi demo is plain http.** Anyone on the same Wi-Fi can read PINs and session tokens. | Use the demo only with fictional data, as now. Any school with real children gets the hosted https server and a release build (which refuses http). |
| 3 | Medium | **The session token is kept in the WebView's localStorage** (`packages/lms-client/src/backend.ts`). Injected script could read it, and so could anyone on a rooted phone. | In the Android builds, keep it in Keystore-backed secure storage; on the web, rely on the CSP in finding 4. |
| 4 | Medium | **The web apps have no Content-Security-Policy yet**, because their hosting is not set up. | When hosting is set, send: CSP (`default-src 'self'`; `connect-src` the Supabase project; `frame-ancestors 'none'`), HSTS, `nosniff`, and `Referrer-Policy`. |
| 5 | Medium | **The APKs are debug builds.** They are debuggable and signed with the debug key. | Release builds signed through Play App Signing, with the upload key kept off this laptop, and `debuggable` false (the release default). |
| 6 | Low | **The API sends raw database error text to the caller**, which names functions and constraints. | Send plain messages to the caller and keep the raw text in the server log. |
| 7 | Low | **Hosted storage cannot check a photo's bytes.** Supabase Storage trusts the declared type within the bucket's allowed types. | Photos are served from storage's own origin with `nosniff`. Optionally, check the bytes in an edge function. |
| 8 | Low | **The demo server has no per-IP rate limit.** It has only the per-ID lockout. | Demo only. The hosted fix is finding 1. |
| 9 | Info | **`npm audit` has not run.** | Run it in CI, where the registry is reachable. |
| 10 | Info | **This laptop's Wi-Fi profile is Public**, so phones cannot reach the demo. | For phone testing only: set the profile to Private and allow Node.js on Private networks (`.demo-data/PHONE-TEST.md`). |

---

## Part 2 — Law and the handling of children's data

### Who is who

| Who | Role under the DPDP Act 2023 | Why |
|---|---|---|
| The school | **Data Fiduciary** | It decides why the data exists: to run the school. |
| Qrie | **Data Processor** for the school | It processes the data on the school's instructions, under a written contract (s.8(2)). |
| Students, parents, teachers | **Data Principals** | For a child, the parent acts. |
| Supabase, Google Cloud, Vercel | **Sub-processors** to Qrie | They host and run the system. |

When Qrie sells straight to a family — the tutor, later — Qrie is the Data
Fiduciary itself. It then gets none of the school's exemption (below), and
must obtain the parent's verifiable consent itself.

**A lawyer is to confirm these roles before the first contract.**

### When the law bites

The DPDP Rules 2025 were notified on 13 November 2025. Their dates:

| Date | What starts |
|---|---|
| 13 November 2025 | The Board and the institutional rules |
| 13 November 2026 | Consent managers |
| 13 May 2027 | **The main duties**: notice, consent, children, security, breach, rights and penalties |

In January 2026 MeitY proposed moving the main duties to 13 November 2026;
as of this review that was not in the gazette. **Plan for November 2026.**
Schools will ask for these terms in their 2026–27 contracts in any case.

Already in force today: the CERT-In directions of 28 April 2022. They require:

- reporting a cyber incident **within 6 hours** of noticing it
- keeping system logs **for 180 days, in India**
- clocks synced to NTP
- a named point of contact

### What the law asks, and where the product stands

| Duty | Law | What it means here | Status in the product |
|---|---|---|---|
| **Notice** | s.5, Rule 3 | A standalone, plain notice that lists each kind of data and why it is held, how to withdraw consent, and how to complain to the Board. In English or any Eighth Schedule language. | **Missing.** To build: notices for parents and for staff, in English and Hindi, linked from both sign-in screens and the School Portal. |
| **Parent's verifiable consent** | s.9(1), Rule 10 | Consent from the parent before a child's data is processed. Rule 10 asks for due diligence that the parent is an identifiable adult; the school's admission records can supply this. | **Missing.** To build: a consent record (who, which notice version, when, how), shown to a parent at their first sign-in, plus a per-child switch for photos. |
| **The school's exemption** | Fourth Schedule, Part A, entry 3 | s.9(1) and s.9(3) do not apply to an educational institution where processing is restricted to tracking and behavioural monitoring for its educational activities or for the safety of enrolled children. **It is narrow, and it names the institution, not its processor.** | Progress, mastery, attendance and marks fall inside it. Photos, AI features and anything outside teaching should still have consent. Collect consent anyway: it costs little and covers the gap. |
| **No tracking or targeted ads at children** | s.9(3) | No behavioural monitoring outside the exemption, and no ads. | **Holds.** No analytics or ad SDKs; children's data is used only inside the school. Keep it out of model training and out of Qrie's marketing. |
| **Nothing harmful to a child** | s.9(2) | No processing likely to harm a child's well-being. | **Holds** in design: AI drafts reach no child without a teacher, and there are no public rankings. |
| **Security safeguards** | s.8(5), Rule 6 | Encryption, access control, logs, monitoring, backups, security terms in processor contracts, and logs kept for **1 year**. | Access control is strong (row-level rules plus checked functions), and there is an audit log of admin actions (`lms.audit_event`). **Gaps:** part 1's open findings, and log retention — Supabase keeps platform logs only for a short, plan-dependent window, so export them to storage in India for 1 year. |
| **Breach notice** | s.8(6), Rule 7 | Tell each affected person **and** the Data Protection Board without delay, then send the Board a detailed report **within 72 hours**. CERT-In separately wants a report **within 6 hours**. | **Missing.** To write: an incident runbook. The contract makes Qrie tell the school within hours, so the school can meet its own duties. |
| **Erase when done** | s.8(7) | Erase data once its purpose is served or consent is withdrawn, unless a law requires keeping it. | **Missing.** A student marked as left keeps their account for the admin (migration 0034). To build: the retention schedule below, as timed jobs. |
| **Rights** | s.11–14 | Access a summary of one's data, correct it, erase it, have grievances answered, and nominate someone. | **Partly.** A parent can see and download their child's progress (PDF). To build: requests for correction and erasure, sent to the admin's queue. Answer grievances within the Rules' limit (90 days at most). |
| **Contact person** | s.8(9), Rule 9 | Publish the business contact of a person who can answer questions about the data. A DPO is needed only by a Significant Data Fiduciary. | **Missing.** Name a person and an email address, and show them in both apps. |
| **Processor contract** | s.8(2) | A written contract between the school and Qrie. | **Missing.** To draft with a lawyer; see "The school's contract" below. |
| **Data abroad** | s.16 and the Rules | Allowed, except to countries the government restricts. Schools will still prefer India. | Supabase and Vercel regions are to check and set to Mumbai. **Vertex is called at location `global`** (`packages/relay/src/vertex.ts`): the teacher's draft prompts may leave India. They carry no child's data, but write this into the sub-processor list. |
| **Penalties** | Schedule to the Act | Up to ₹250 crore for failing security safeguards; up to ₹200 crore each for a missed breach notice or for the children's duties. | — |

### What the system holds (the data map)

| Data | About | Why | Where | Kept for (proposed) |
|---|---|---|---|---|
| Name, class, section, roll, login ID | Students, teachers, parents | To run the school | Supabase (Postgres) | While enrolled; after leaving, see below |
| PIN | Everyone | To sign in | Supabase Auth, hashed only | Until changed or the account is erased |
| Answers, marks, practice, mastery | Students | Teaching and reports | Supabase | The school year plus 1 year, then handed to the school or erased |
| Photos of written work | Students | Marking | Supabase Storage (private) | **1 year after the school year ends** |
| Attendance, remarks, notices | Students, parents | Running the school | Supabase | As for marks |
| Parent–child link | Parents | So a parent sees only their own child | Supabase | While the child is enrolled |
| Admin activity log | Staff | Accountability | Supabase (`lms.audit_event`) | 1 year (Rule 6) |
| Server and access logs | Everyone | Security | Supabase and Vercel, then exported | 1 year, of which 180 days in India (CERT-In) |
| Work waiting to send, quiz drafts | Students | Working offline | The phone, inside the app (excluded from backup) | Until sent, or until the app is removed |
| Draft prompts | Teachers | Draft with AI | Vertex (transient) | Not kept by Qrie beyond the draft itself |

**At the end of a contract:** export everything to the school within
30 days, then erase it within a further 30 days. Backups roll off within the
backup window. Record each step in writing.

### The school's contract (a DPA), at the least

- **Roles.** The school is the fiduciary; Qrie processes only on its
  documented instructions.
- **Sub-processors.** Supabase, Google Cloud (Vertex) and Vercel, with their
  regions. Notice to the school before any new one is added.
- **Security.** The measures in part 1, and the right to ask for evidence.
- **Breaches.** Qrie tells the school within a fixed number of hours (for
  example 12), and helps with the Board notice and the parent notices.
  Qrie's own CERT-In report is separate.
- **People's requests.** Qrie helps the school answer access, correction and
  erasure requests.
- **Retention and return.** The schedule above; export and erasure at the
  end of the contract.
- **Confidentiality.** Of Qrie's staff, with access only on a need basis.
- **Children's data.** No ads, no profiling outside education, no use for
  model training or for Qrie's marketing.

### Two outside rules

- **Google Cloud's terms on under-18s.** The Service Specific Terms restrict
  generative AI in services for users under 18. In the LMS only teachers use
  Gemini, and what it writes reaches a child only after a teacher adds it.
  That is the cautious side, but the tutor is not. **Get Google's reading in
  writing.**
- **Google Play.** An app whose audience includes children falls under the
  Families Policy. Before release:
  - a privacy policy URL
  - the Data safety form, filled in from the data map above
  - the target-audience declaration
  - no ad SDKs that are not certified

  Accounts are made by the school, not inside the app. Still, publish a web
  page where a parent can ask for deletion.

### Who does what

**Qrie's code** — can be built next, in this order:

1. Hosted sign-in lockout and per-IP limits (finding 1).
2. Privacy notices (English and Hindi) and the grievance contact, in both
   apps and the portal.
3. Consent records: the parent accepts at first sign-in; a per-child photo
   switch; withdrawal.
4. Requests for correction and erasure, sent to the admin's queue; an erase
   action for the admin, logged.
5. Retention jobs: photo expiry, leavers, and export plus erasure at the end
   of a contract.
6. Log export (1 year, India) and alerts on mass reads and failed-sign-in
   spikes.
7. Release builds:
   - secure token storage
   - CSP and security headers on hosting
   - plain database errors to the caller
   - Play App Signing
8. An incident runbook in `docs/ops`.

**The founder's** — these cannot be done in code:

1. A lawyer to:
   - confirm the roles
   - read the Fourth Schedule for this product
   - review the DPA, the terms and the privacy notices
2. Name the contact person (yourself, at first) and a support email address.
3. Accept the DPAs of Supabase, Google Cloud and Vercel in their consoles,
   and set their regions to India.
4. Name a CERT-In point of contact, and sign off the incident runbook.
5. Get Google's reading of the under-18 clause in writing.
6. For each school:
   - sign the DPA
   - have the school send its parents the consent form at admission or by
     notice
7. In Play Console: the target audience, the Data safety form and the
   privacy policy URL.

**Before a school with real children** (even a free pilot), at the least:

- the hosted https server and release builds (findings 1–5)
- the privacy notice and contact person
- a signed DPA, even a short one
- the parents' consent collected through the school
- the regions set to India

The Wi-Fi demo stays for fictional data only.
