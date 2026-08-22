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
```

| Flag | |
|---|---|
| `--count` | target nodes per chapter (default 40) |
| `--probes` | also write `<out-basename>.probes.json` |
| `--probes-only` | skip node generation; write questions for nodes that lack one |
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

**The graph decides what needs a probe, not the syllabus.** A map can hold
hand-authored nodes in chapters the syllabus has not been written up yet;
`--chapter all --probes-only` covers them too. Without that, those nodes are
invisible to the diagnostic — a gap that only shows up as a student who can
never be told what they actually got wrong.

## Growing to 10,000 nodes

The bottleneck is the **syllabus**, not this tool: nodes are generated per
chapter, so the map can only be as broad as `packages/syllabus/data` is. Add
chapters and subjects there first, then run `--chapter all` against each.

## Depends on

`packages/knowledge-graph` (types, validation, merge check) and
`packages/syllabus` (chapter input) — imported by relative path to the leaf
modules, since the package index barrels re-export values through extensionless
specifiers that Node's type stripping cannot resolve.
