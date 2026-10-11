# tools/gen-graph

Grows the **Learning Outcome Map** and writes the diagnostic questions that
probe it. Authoring time only — nothing here runs in the student app, and its
output is committed alongside the code.

## Usage

```bash
# See the prompt without spending anything
node tools/gen-graph/src/cli.ts --syllabus class10-science --chapter life-processes \
  --out packages/knowledge-graph/data/class10-science.json --dry-run

# Generate nodes for one chapter (extends the map, never replaces it)
GEMINI_API_KEY=... node tools/gen-graph/src/cli.ts \
  --syllabus class10-science --chapter life-processes \
  --out packages/knowledge-graph/data/class10-science.json

# Every chapter in the syllabus, with questions
GEMINI_API_KEY=... node tools/gen-graph/src/cli.ts \
  --syllabus class10-science --chapter all \
  --out packages/knowledge-graph/data/class10-science.json --probes

# Fill in questions for nodes that don't have one yet
GEMINI_API_KEY=... node tools/gen-graph/src/cli.ts \
  --syllabus class10-science --chapter all \
  --out packages/knowledge-graph/data/class10-science.json --probes-only

# A retest and a review question for every node that has its first one
LLM_PROVIDER=vertex node tools/gen-graph/src/cli.ts \
  --syllabus class10-science --chapter all --more-probes --roles retest,review

# Topics with NO outcomes, inside chapters that already have some
LLM_PROVIDER=vertex node tools/gen-graph/src/cli.ts \
  --syllabus all --topic-gaps --probes
```

| Flag | |
|---|---|
| `--count` | target nodes per chapter (default 40) |
| `--probes` | also write `<out-basename>.probes.json` |
| `--probes-only` | skip node generation; write questions for nodes that lack one |
| `--more-probes` | further questions for nodes that already have one: one per role in `--roles` (default `retest,review`), checked by a second reader, resumable |
| `--roles` | comma-separated, from `retest`, `review`, `transfer` |
| `--topic-gaps` | outcomes for topics that hold none, inside chapters that already have nodes. `--count` is per TOPIC here (default 4) |
| `--dry-run` | print prompts, write nothing, and don't require a key |

Env: `LLM_PROVIDER` (`gemini` default, or `anthropic`), `GOOGLE_API_KEY` /
`GEMINI_API_KEY` / `ANTHROPIC_API_KEY`, `GEMINI_MODEL`, `ANTHROPIC_MODEL`.

## Where the quality actually comes from

**Nanoscale is enforced in the prompt, and again in the validator.** The system
prompt carries worked good/bad examples ("Understand photosynthesis" is
rejected; "Identify that oxygen appears on the product side" is the target
size), and `generate.ts` refuses any outcome starting with *understand / know /
learn / be aware / appreciate / master* — those cannot be tested, which defeats
the point of a fine-grained map.

**The wrong options are the point.** Every distractor must encode a named
misconception, aligned to `options` by index with an empty string at the correct
one. That naming is what lets the tutor later say *why* a student is stuck
rather than only *that* they are.

**Nothing broken reaches disk.** A batch is validated for duplicate ids, ids
that already exist, dangling edges and cycles *within* the batch; then the merge
re-validates the **whole** graph, because two acyclic batches can close a loop
between them. A failure gets one repair retry with the validator's exact
complaints appended, and a second failure writes `*.rejected.json` for a human.

**A chapter with nodes is not a chapter that is done.** Node generation is a
chapter at a time and `--chapter all` skips any chapter that already holds
nodes, so a topic with zero outcomes *inside* a populated chapter is invisible
to it — the generator sees no gap and fills none. 48 topics sat in exactly that
blind spot, and a class on one of them teaches and records nothing, because
there is no outcome for the ledger to name. `--topic-gaps` asks for one topic
per call, which is what makes `topicRef` an input checked against the syllabus
rather than a guess a later pass has to make.

That pass also narrows what an edge may point at to the chapter's own nodes,
and the reason is measured on the committed maps: an earlier run hung new work
off chapter roots, and one class11-biology node ended up blocking 337 of 462.
At that fan-out one wrong answer condemns a subject. Nodes added to a chapter
that is already written do not need to reach outside it.

**The graph decides what needs a probe, not the syllabus.** A map can hold
hand-authored nodes in chapters the syllabus has not been written up yet;
`--chapter all --probes-only` covers them too. Without that, those nodes are
invisible to the diagnostic — a gap that only shows up as a student who can
never be told what they actually got wrong.

**A second question is checked by a second reader.** `--more-probes`
(`src/moreProbes.ts`) gives a node that has its first question further ones,
each with a `role`: `retest` (the same outcome in other words and numbers),
`review` (asked back at a spaced review) or `transfer` (applied somewhere
new), at most one per role, ids `<first id>-<role>`. A batch is validated like
the first-question pass (shape, the length leak) and also refuses a stem the
node already has once case, spacing and punctuation are set aside, with one
repair retry. Then two calls that share nothing with the writer: one answers
each question without the key or the labels, the other reads each wrong
option's label against the key. A question either does not confirm is
dropped and logged; the next run asks for it again, because the plan is
always the roles a node still lacks in the bank on disk.

## Growing to 10,000 nodes

The bottleneck is the **syllabus**, not this tool: nodes are generated per
chapter, so the map can only be as broad as `packages/syllabus/data` is. Add
chapters and subjects there first, then run `--chapter all` against each.

## Depends on

`packages/knowledge-graph` (types, validation, merge check) and
`packages/syllabus` (chapter input) — imported by relative path to the leaf
modules, since the package index barrels re-export values through extensionless
specifiers that Node's type stripping cannot resolve.
