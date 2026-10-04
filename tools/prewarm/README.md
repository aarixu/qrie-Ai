# tools/prewarm — the catalogue, paid for once

Prep at S=1 is Rs 496.5/student-hour (migration 0017's header does the
arithmetic). The way that number becomes a one-time CAPEX line instead of a
per-student price is this runner: it prepares each cold topic ONCE, through
the deployed relay, and keeps the class via `POST /api/class` so every later
student gets it as a download.

It drives the SAME pipeline the app does — `packages/class-prep`, imported by
path — with the same models `apps/classroom/src/lib/liveClass.ts` measured and
chose. Two things are worth naming against the app:

- **Every class is fact-checked** (`reviewLesson`) before it is kept. Since
  C10 the app does the same (liveClass.ts passes a reviewer, and its keep()
  refuses an unreviewed class), so this only differs when it is turned off.
  `--no-review` turns it off and, in a spending run, demands
  `--i-accept-unreviewed` as well.
- **Kept is not published.** Since I1 the relay stores every class it keeps
  as `review_status 'pending'` (`packages/relay/src/classStore.ts`), this
  runner's included, and the app serves only published, unretracted rows
  (`apps/classroom/src/lib/content.ts`). So a topic this runner reports as
  `done` — "kept (pending publish)" — is served to NO student until an
  operator publishes it by hand, after the spot check:

  ```sql
  update prepared_class set review_status = 'published', published_at = now() where id = '<keptId>';
  ```

  Once published, it is served to every later student until it is
  retracted. The `keptId` is in the state file beside the topic.
- **A graphics failure does not throw the class away**, exactly as the app
  survives one ("the board shows what it has"). Here it is also a money rule:
  the lesson is already bought.

## It spends real money

A live run needs all three of `--relay <url>`, `--token <bearer>` and
`--spend`. Without `--spend` it refuses and names what the run would cost.
`--dry-run` plans nothing, calls nothing, and prints the topic list with the
Rs 26–40/topic estimate (PRD-6's planning band; Rs 30 is the planning number).

**That band does not price the reviewer.** PRD-6 measured a class prepared
without one, so budget a planner-grade call per topic on top, plus a repair
plan and a second review on any topic the reviewer flags. The dry run says so
too. The honest summary: with the reviewer on, the printed estimate is a
floor.

```
# look, free:
node tools/prewarm/run.mjs --dry-run --all-class9-10-science

# one topic, for real (the token is a Supabase auth access token for the
# relay's project — the relay verifies it the same way it verifies the app):
node tools/prewarm/run.mjs --spend \
  --relay https://<project>.supabase.co/functions/v1/relay \
  --token "$ACCESS_TOKEN" \
  --syllabus class9-science --chapter matter-in-our-surroundings --topic evaporation
```

`--relay`/`--token` can come from `PREWARM_RELAY_URL` / `PREWARM_TOKEN`
instead. No vendor key is ever involved here — the relay is the only
vendor-key holder; this tool holds a student-grade bearer like any other
caller, and the relay's gate meters it like any other caller.

## The whole catalogue is a MULTI-DAY operation, not one command

There is no `--all-class9-10-science` run that finishes in an evening, and
pretending otherwise would teach the operator the ceiling by hitting it.
Every call here goes through the same gate a child's browser does:

| what | number | where |
| --- | --- | --- |
| one `/api/llm` call | 85 units | `packages/relay/src/gate.ts:102` |
| one keep (`/api/class`) | 10 units | `gate.ts:105` |
| one identity, per UTC day | 12,000 units | `gate.ts:385` |
| the whole project, per UTC day | 50,000 units | `gate.ts:160` |

At 8–12 llm calls a topic — NOT VERIFIED, no topic has yet been warmed through
this runner — a topic is roughly 700–1,000 units. So one identity buys on the
order of 12–17 topics a day, and the project's whole day is on the order of
50–70 topics, **shared with real students**. Warming 274 topics is weeks of
short runs, or a deliberate decision to raise the ceiling (the per-identity
12,000 is a plpgsql constant inside `claim_relay`, so raising it is a
migration — somebody else's file, and a handoff, not a change this tool can
make).

A budget refusal is handled as what it is: the relay says `reason: 'budget' |
'capped' | 'halted'` in the refusal body (`gate.ts:237-247`), the runner reads
it, STOPS the run rather than counting it as a content failure, and says to
come back tomorrow. It does not trip the three-strike stop. What it cannot
undo is a refusal that lands mid-topic: that topic's partial spend is gone.

## The state file is the budget's memory

`tools/prewarm/state/<syllabus>.json` (override with `--state-dir`) records
every topic touched:

- `done` — prepared AND kept, with the prep id, the spend, whether it was
  reviewed, and any issues the reviewer raised. Never re-paid.
- `skipped` — already in the catalogue on the project this relay writes to.
  Never re-paid; if an earlier attempt had failed and spent money, that spend
  is carried forward onto the note rather than erased.
- `failed` — with the reason and what the failure cost. Retried next run.

A re-run prepares only `failed` and never-tried topics. A corrupt state file
STOPS the run rather than being read as empty — empty would re-pay the
catalogue. Three consecutive failures stop the run: a broken prompt must not
burn the catalogue budget one topic at a time.

**One run at a time.** Starting a second run against the same state directory
is refused (`<syllabus>.lock`, named with the holding pid); two runs both read
the pending set before either writes, so both would prepare and pay for every
topic in it. `--force` takes a lock a dead run left behind.

**A syllabus named twice is one syllabus.** `--syllabus class9-science
--all-class9-10-science` plans 274 topics, not 429. It used to plan both, with
two state objects loaded from one file: doubled count, doubled bill, and the
second pass's save erasing the first pass's record of what was already paid
for.

## `--composed`: classes for the composed board

`--composed` prepares each class for the board composer
(`docs/superpowers/specs/2026-10-03-board-composer-design.md`). The planner gets
the page contract, the class is laid out in regions, and the keep gate also
holds it to `page-full`, `phone-readable` and `one-main`. Without the flag the
runner prepares classes exactly as before. The live classroom's switch,
`COMPOSE_LIVE_CLASSES` in `apps/classroom/src/lib/liveClass.ts`, stays off until
real composed classes are measured with this flag.

## A class refused at the end is kept for `--rekeep`

When the keep refuses a class at the END — its keep gate failed after the
reviewer and the pictures, or `saveable` turned it down — everything expensive
in it is already bought. It is written to
`state/refused/<syllabus>/<topic>.json`: the prepared class, what it was laid
out from (the plan, the drawn pictures and their measured parts and shapes),
and the meta it would be kept under. The topic is still `failed`.

```
# after a layout fix, lay the refused classes out again and keep them:
node tools/prewarm/run.mjs --syllabus class10-science --rekeep --relay <url> --token <token> --spend
```

`--rekeep` touches only topics with a refused record. For each one it lays the
same plan out again with today's engine (class-prep `rekeep`: no planner, no
reviewer, no picture is called), runs the same keep gate, and keeps it if it
now passes — paying only for its nouns' icons and the keep. A class today's
layout still refuses keeps its record for the next fix. A class refused EARLY
(prepareClass stopped it before the reviewer and the pictures) has nothing
worth keeping, so nothing is written.

## Why the duplicate check reads the catalogue, and what happens without it

Before spending on a topic the runner asks the project's `prepared_class`
table whether that `topic_ref` is already there — the authoritative catalogue,
anon-readable (`supabase/migrations/0004_prepared_class.sql:44-47`), on the
project **the relay writes to** (the origin is derived from `--relay`; a
staging relay must not be checked against `.env.local`'s project). It needs an
anon key: `PREWARM_ANON_KEY`, or `VITE_SUPABASE_ANON_KEY` from `.env.local`.
Without one the run says loudly that it has no duplicate check.

It does NOT probe the storage bucket. `keepClass` writes the files first and
the catalogue row last on purpose (`packages/relay/src/classStore.ts:56-64`),
so a half-finished keep leaves exactly the `lesson.json` a bucket probe would
read as success — and the one topic that most needs warming would be recorded
as warm forever.

The check matters because **a duplicate keep is not refused**. `classStore`
tolerates a 409 on every file and posts the catalogue row with
`resolution=ignore-duplicates`, then returns `200 {ok:true}`. Re-preparing a
kept topic therefore spends the money, has the new class silently discarded in
favour of the stored one, and reports success. Nothing signals that the Rs ~30
bought nothing.

## What a topic cost, printed as it lands

The relay translates Vertex into the OpenAI shape (`toOpenAiReply`,
`packages/relay/src/vertex.ts:276-301`) and carries `usageMetadata` through
unchanged under the key `usage` — so the content is OpenAI-shaped and the
counts keep Vertex's own names (`promptTokenCount` / `candidatesTokenCount` /
`thoughtsTokenCount`, the three `usageFromVertex` books in
`packages/relay/src/usage.ts`). The runner writes those down per call and
prices them with the rates parsed from `tools/sql/model_price.sql` — the same
file `apply-prices` applies, so the runner's spend line and the database's
`usage_cost` agree by construction.

A reply whose counts this tool cannot read — no usage block, or one in another
provider's names — is counted UNMEASURED and the topic's figure is called a
floor, never treated as free. Against an **OpenRouter-configured** relay that
is every call: that path is a piped stream the relay never reads, and
OpenRouter names its counts differently. Only the Vertex path gives a real
spend line, and Vertex is what students reach.

Every call also carries an `x-prep-id` header (one uuid per topic), which the
relay validates (a non-uuid is dropped, not passed on — `handler.ts:339-340`).
Phase D's passthrough is in the tree: migration 0019 gives `record_usage` a
`p_prep_id` argument and `packages/relay/src/usage.ts:212` passes it. But 0019
is an UNAPPLIED FILE here, and the deployed relay predates it unless it has
since been redeployed — **NOT VERIFIED from this tree** (0019's `p_prep_id`
defaults to null precisely so the old 13-argument call keeps working across
that gap). So today the id is most likely validated and then dropped. The
runner sends it regardless: applying 0019 and redeploying is then the entire
change before `usage_event.prep_id` starts carrying S — students per
preparation — as a measured number rather than an asserted one.

`usage_event.bucket` is a different case with no owner yet: nothing in
`packages/relay/src` reads a bucket header or writes that column, so
`cost-report`'s by-bucket section cannot populate until somebody wires it —
and this runner is exactly the thing that would send `bucket: live`.

## Why run.mjs registers a resolve hook

The pipeline is TypeScript that only vite has run before. Node 22 strips
types natively, but a few packages import their own files without an
extension (`./syllabus`, `./layout`), which Node's ESM loader refuses.
`lib/register.mjs` adds "try `.ts`, then `/index.ts`" on relative-specifier
misses — how modules are FOUND changes, what they contain does not. `run.mjs`
loads the hook first and everything else after; that is its whole job.

## Tests

`npx vitest run tools/prewarm/tests` — the planner-independent parts: the plan
and its resume arithmetic against the real repo data, the state rules and the
run lock, topic listing and the knowledge-graph outcome join, the dry-run
arithmetic, the `model_price.sql` parser, the relay adapters and spend
pricing against a mocked relay, `cost-report` against a mocked PostgREST, and
a drift check that the runner's model ids still equal `liveClass.ts`'s.
Nothing in the tests touches the network or the live project.
