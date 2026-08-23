# tools/pull-syllabus

Pulls the **real NCERT curriculum** into `packages/syllabus/data`. Authoring time
only — nothing here runs in the student app, and its output is committed
alongside the code.

## The split that makes this work

```
ncert.nic.in/textbook.php  ──►  class, subject, book title, book code, CHAPTER COUNT
                                (NCERT's own catalogue — AUTHORITATIVE)
                                             │
                                             ▼
                                LLM, anchored to that count
                                             │
                                             ▼
                                chapter TITLES, topics, sub-topics
```

NCERT's index page builds its three dropdowns from a long chain of inline
JavaScript, and that chain is a machine-readable catalogue of every book it
publishes:

```js
else if((document.test.tclass.value==10) &&
        (document.test.tsubject.options[sind].text=="Science")) {
  document.test.tbook.options[1].text="Science";
  document.test.tbook.options[1].value="textbook.php?jesc1=0-13"
```

That is where the chapter **count** comes from — Class 10 Science is book
`jesc1` with 13 chapters, and no model gets to disagree.

Chapter **titles** cannot come from the same place. A book's own page is
rendered by that same JavaScript and returns the identical index HTML to a plain
fetch, so the titles are not in anything downloadable. The PDFs at
`ncert.nic.in/textbook/pdf/<code><NN>.pdf` do exist, but NCERT's server is slow
enough that one 3–5 MB chapter does not finish inside two minutes; ~300 of them
is not a pipeline. So titles, topics and objectives come from an LLM that is
told the exact chapter count and validated against it.

## Usage

```bash
# What does NCERT actually publish? (free, uses the cached index)
node tools/pull-syllabus/src/cli.ts --list
node tools/pull-syllabus/src/cli.ts --list --class 10
node tools/pull-syllabus/src/cli.ts --list --subjects Science,Mathematics

# See the prompt without spending anything
node tools/pull-syllabus/src/cli.ts --class 10 --subject Science \
  --out packages/syllabus/data --dry-run

# Pull one class + subject
GEMINI_API_KEY=... node tools/pull-syllabus/src/cli.ts \
  --class 10 --subject Science --out packages/syllabus/data

# Pull classes 6-12 for a couple of subjects
GEMINI_API_KEY=... node tools/pull-syllabus/src/cli.ts \
  --all --subjects Science,Mathematics --out packages/syllabus/data
```

| Flag | |
|---|---|
| `--list` | print the parsed catalogue (class, subject, book, chapters) and stop |
| `--class <6..12>` | one class |
| `--subject <name>` | one subject, NCERT's spelling — see `--list` |
| `--all` | every class 6 to 12 |
| `--subjects <a,b,c>` | comma-separated subject filter |
| `--out <dir>` | output directory, e.g. `packages/syllabus/data` |
| `--refresh` | re-fetch the NCERT index instead of using `cache/` |
| `--dry-run` | print prompts, write nothing, and don't require a key |

Env: `LLM_PROVIDER` (`gemini` default, or `anthropic`), `GOOGLE_API_KEY` /
`GEMINI_API_KEY` / `ANTHROPIC_API_KEY`, `GEMINI_MODEL`, `ANTHROPIC_MODEL`.

One file per class + subject: `<out>/class<N>-<subject-slug>.json`, e.g.
`packages/syllabus/data/class10-science.json`. **Writing merges by chapter id**,
so a re-run fills gaps instead of destroying work — pulling Class 12 Mathematics
Part-II cannot wipe out Part-I, and a hand-edited chapter survives unless it is
deliberately regenerated.

`--refresh` re-fetches with a browser `User-Agent` and a `Referer` of
`https://ncert.nic.in/textbook.php`; bare requests are refused.

## Public API

```ts
// src/parse.ts — pure string work, no network, no DOM
interface NcertBook { klass: number; subject: string; title: string; code: string; chapters: number }

parseNcertCatalogue(html: string): NcertBook[]
filterBooks(books: NcertBook[], opts?: FilterOptions): NcertBook[]
  // FilterOptions { minClass = 6, maxClass = 12, subjects?, englishOnly = true, textbooksOnly = true }
pickPrimaryBook(books: NcertBook[]): NcertBook[]   // the English edition(s) of ONE class+subject
slugify(text: string): string

// src/prompt.ts
buildChapterPrompt(book: NcertBook, opts: { syllabusId: string }): { system: string; user: string }

// src/generate.ts
type Outcome<T> = { ok: true; value: T } | { ok: false; errors: string[]; raw: string }
generateChapters(book: NcertBook, adapter: LlmAdapter, opts: ChapterPromptOptions): Promise<Outcome<Chapter[]>>
mergeIntoSyllabus(existing: SubjectSyllabus | null, book: NcertBook, incoming: Chapter[]): Outcome<SubjectSyllabus>
syllabusIdFor(book: NcertBook): string             // "class10-science"

// src/llm.ts — identical to tools/gen-graph/src/llm.ts
interface LlmAdapter { complete(system: string, user: string): Promise<string> }
createAdapterFromEnv(env?): LlmAdapter
```

## Where the quality actually comes from

**The chapter count is the anchor.** It is the one fact NCERT gives us that a
reply can be checked against, and checking it is what stops the model padding a
book out, merging two chapters into one, or drifting into a different edition.
A mismatch is the first and loudest validation error, and it goes straight back
to the model as repair fuel.

**"Topic" means NCERT's numbered sections.** The prompt spells out that a
chapter prints 5.1, 5.2, 5.2.1 … and that *those* are the topics and sub-topics
being asked for, then works one chapter — Class 10 Science, *Life Processes* —
all the way through: five sections plus seven sub-sections, flat, in book order.
Without that, models return four vague themes per chapter and the syllabus is
useless to the lesson designer.

**Objectives must be observable.** `"Student can understand photosynthesis"` is
rejected by name, with the offending sentence quoted back. The Learning Outcome
Map built from this syllabus diagnoses a student by testing each objective, and
*understand / know / learn / be aware / appreciate / master* cannot be tested.

**Nothing broken reaches disk.** A reply is rejected for the wrong chapter
count, duplicate chapter or topic ids, empty titles, a topic with no objectives,
a vague objective, or a chapter with fewer than two topics (a chapter that is
one topic was never decomposed). One repair retry gets the validator's exact
complaints appended; a second failure writes `*.rejected.json` for a human. The
merged file then goes back through `loadSyllabus` before it is written, so what
lands in `packages/syllabus/data` is by construction something the app can load.

## Reading `--list`

The catalogue is NCERT's, warts and all. Translated editions are dropped by
their title tag (`Ganita Prakash (Maithili)`) *and* by the language letter in
the book code — `jesc1` is class 10 (**j**) English (**e**) Science, `jhsc1` the
Hindi *Vigyan*, `jusc1` the Urdu one — because a transliterated title like
*Vigyan*, *Ganit* or *Bhautiki* carries no language marker at all. Exemplar
Problems, Lab Manuals, practical books and supplementary readers are dropped as
well: they share the subject but are not the syllabus a student is taught.

Three things survive that a human should notice before spending anything.

A class + subject genuinely has several English books more often than not —
Class 12 Mathematics is Part-I and Part-II, Class 10 Social Science is four
separate books — so `pickPrimaryBook` returns all of them, in a stable order,
and they merge into one file.

NCERT's Class 6 Science entries have their titles and codes crossed (`fecu1` is
labelled *Vigyan*, `fhcu1` is labelled *Science*). Both are listed rather than
one being guessed at.

**NCERT is mid-transition, and both editions are published.** Class 6-8 list the
new books (*Curiosity*, *Ganita Prakash*) alongside the ones they replace
(*Science*, *Mathematics*), so `--all` pulls both and the file ends up covering
the same syllabus twice. Nothing in the catalogue marks which edition is
current, so this tool does not guess — check `--list` and name the class and
subject you want, or delete the chapters of the edition you don't.

## Depends on

`packages/syllabus` (the `SubjectSyllabus` contract and `loadSyllabus`) —
imported by relative path to the leaf module, since the package index barrel
re-exports values through extensionless specifiers that Node's type stripping
cannot resolve. `cache/ncert-textbook-index.html` is a saved copy of
`https://ncert.nic.in/textbook.php`: the runtime cache and the test fixture, and
the reason the test suite never touches the network.
