# tools/design-lesson

The **factory**: an LLM lesson designer. Takes one syllabus topic, produces one
draft `lesson.json` (validated) plus an `assets-spec.json` listing the images/3D
the lesson wants generated later. Runs at **authoring time only** — never in the
student app.

## Usage

```bash
# Gemini (default; needs GOOGLE_API_KEY or GEMINI_API_KEY)
node tools/design-lesson/src/cli.ts \
  --topic class10-science/life-processes/heart-circulation \
  --out content/class10-heart

# Claude instead
LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... node tools/design-lesson/src/cli.ts --topic ... --out ...
```

## How it works

```
syllabus topic ─► prompt (pedagogy rules + element vocabulary + example lesson)
      ─► LLM ─► lesson.json draft ─► validateLesson()
                     ▲                    │ errors
                     └── repair retry ◄───┘  (max 2)
      ─► write lesson.json + assets-spec.json
```

- The prompt embeds the **closed element vocabulary** from `lesson-format` — the
  model composes typed elements, it cannot emit arbitrary drawings or code.
- Validation errors are fed back verbatim for a repair retry; a lesson that fails
  twice is written to `*.rejected.json` for a human to look at, never to `lesson.json`.
- Pedagogy rules (in `src/prompt.ts`): hook first → concrete real-life example →
  concept built on the visual → rhetorical check question every ~3 beats → recap.
  Class 6–8 gets simpler language than 9–12. Narration is Hinglish (`hi-en`).

## Env

| Var | Meaning |
|---|---|
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | Gemini access (default provider) |
| `GEMINI_MODEL` | default `gemini-3.1-flash` |
| `ANTHROPIC_API_KEY` + `LLM_PROVIDER=anthropic` | use Claude instead |

## Depends on

`packages/lesson-format` (validation), `packages/syllabus` (topic input) — imported
by relative path; runs directly under Node ≥ 24 (built-in TS type stripping).
