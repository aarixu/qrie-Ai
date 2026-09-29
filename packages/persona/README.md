# @ai-tutor/persona

**The tutor herself** — one persona for every lesson, every subject, every
student, on every surface she speaks through.

Zero runtime dependencies. Pure: no I/O, no clock, no randomness. The same input
always builds a byte-identical prompt.

## Why this package exists

Her character used to live in three hand-written prompt strings — one in the
typed doubt agent, one in the spoken live agent, one in the stub — and they had
already drifted. A student could meet a slightly different teacher depending on
which one answered. This package is the single source those call sites assemble
from, so the tutor in the recording and the tutor who takes over the room when
a hand goes up are unmistakably the same person.

Behaviour is **composed**, never copy-pasted:

```
traits  (who she is)          ─┐
factors (who is in front)     ─┼─► buildSystemPrompt() ─► one system prompt
moment  (what is happening)   ─┤
surface (how words come out)  ─┘
```

## Public API

```ts
// --- traits.ts : who she is, as data -------------------------------------
interface TutorTraits {
  name: string
  role: string
  voice: string             // PROSE: how she sounds, for a human reading a draft line
  speechVoiceName: string   // the prebuilt Gemini voice id her words are synthesised with
  values: string[]
  neverDoes: string[]
}
const TUTOR: TutorTraits

// --- factors.ts : what she adapts to -------------------------------------
type Klass = 6 | 7 | 8 | 9 | 10 | 11 | 12
type AnswerSignal = 'fast-right' | 'slow-right' | 'fast-wrong' | 'slow-wrong'
type Attendance = { kind: 'streak'; days: number } | { kind: 'returning'; daysAway: number }

interface StudentContext {
  klass: Klass                    // required — every student has one
  mastery?: number                // 0..1 belief for the node being taught now
  namedMisconception?: string     // the wrong idea the failed probe revealed
  doubtCount?: number             // hands raised in THIS lesson
  lastAnswer?: AnswerSignal       // how the last check question went
  attendance?: Attendance
  language?: TutorLanguage        // 'en' | 'hi-en', the tutor language chosen at onboarding
}

describeFactors(ctx: StudentContext): string[]      // one instruction line per ACTIVE factor
classifyAnswer(correct: boolean, ms: number): AnswerSignal

interface FactorSpec { observedFrom: string; values: string[] }
const FACTORS: Record<keyof StudentContext, FactorSpec>   // the documented catalogue

const MASTERY_SECURE = 0.75
const MASTERY_SHAKY = 0.4
const DOUBT_PACE_THRESHOLD = 3
const STREAK_MIN_DAYS = 2
const SLOW_ANSWER_MS = 25_000

// --- language.ts : the language she speaks --------------------------------
type TutorLanguage = 'en' | 'hi-en'
const TUTOR_LANGUAGES: readonly TutorLanguage[]
const REGISTER: Record<TutorLanguage, string>   // one register line per language
registerLine(language: TutorLanguage): string
isTutorLanguage(value: unknown): value is TutorLanguage

// --- moments.ts : the distinct situations --------------------------------
const MOMENTS: readonly Moment[]
type Moment =
  | 'TEACHING' | 'DOUBT_OPENING' | 'DOUBT_ANSWERING' | 'DOUBT_CLOSING'
  | 'CHECK_QUESTION' | 'WRONG_ANSWER' | 'RIGHT_ANSWER' | 'STUDENT_SILENT'
  | 'OFF_TOPIC' | 'DONT_KNOW'
momentGuidance(moment: Moment): string

// --- prompt.ts : the assembler -------------------------------------------
const SURFACES: readonly Surface[]
type Surface = 'voice' | 'text' | 'narration'

interface LessonContext {
  subject?: string
  title?: string
  beatTopic?: string
  transcriptSoFar?: string
  onScreen?: readonly string[]                              // element ids visible right now
  recallableBeats?: readonly { id: string; topic: string }[] // the ONLY legal recall targets
}

interface PromptInput { moment: Moment; student: StudentContext; lesson?: LessonContext; surface: Surface }
buildSystemPrompt(input: PromptInput): string
```

## Using it

```ts
import { buildSystemPrompt, classifyAnswer } from '@ai-tutor/persona';

const systemPrompt = buildSystemPrompt({
  moment: 'DOUBT_OPENING',
  student: {
    klass: 10,
    mastery: 0.31,
    namedMisconception: 'thinks arteries always carry oxygenated blood',
    doubtCount: 4,
    lastAnswer: classifyAnswer(false, 1_800),
  },
  lesson: {
    subject: 'Science',
    beatTopic: 'how the heart moves blood',
    transcriptSoFar: ctx.transcriptSoFar,
    onScreen: ctx.visibleElementIds,
    recallableBeats: ctx.recentBeats,
  },
  surface: 'voice',
});
```

The prompt comes out in a fixed section order, most permanent thing first:

```
WHO YOU ARE / YOU ALWAYS / YOU NEVER
THIS STUDENT — private notes
THIS MOMENT — <MOMENT>
THIS LESSON / WHAT THE CLASS HAS COVERED SO FAR / MOMENTS YOU CAN BRING BACK
WHICH LANGUAGE YOU SPEAK — only when `student.language` is set
HOW TO SPEAK — VOICE | TEXT | NARRATION
```

## The rules worth knowing

- **Absent means unknown, and unknown says nothing.** A missing `mastery`
  produces no line at all — never "average", never "weak". Out-of-range and
  non-finite values are treated as missing for the same reason.
- **Only observable factors exist.** `timeOfDay`, mood, and "learning style" are
  deliberately absent: the app cannot see them, and a tutor that adapts to
  signals nobody measured is a tutor making things up. Adding a factor means
  adding a real signal first — see the "DELIBERATELY NOT FACTORS" block at the
  top of `src/factors.ts`.
- **Blanket prohibitions live once**, in `TUTOR.neverDoes`, and are rendered
  into every prompt. Moment guidance says what to DO in that moment; it never
  repeats a global ban, because two copies of a rule drift apart.
- **The student notes are private.** The assembled prompt labels them as such
  and forbids reading scores out. Beliefs are never printed as numbers.
- **Recall targets are enumerated by id.** The model can only be trusted to pick
  from a list it was shown — and the caller must still check the id it gets back
  before moving the canvas.
- **One tutor means one voice, from one constant.** `TUTOR.speechVoiceName`
  (`Sulafat`, the only voice Google labels Warm, and verified on both the
  text-to-speech models and the Live API) is read by the recorded narration and
  by the live doubt tutor alike. They are synthesised by two different services
  minutes apart inside one lesson, so a second literal anywhere is a second
  teacher waiting to take over the room. Do not confuse it with `TUTOR.voice`,
  which is prose for humans and is never sent to a synthesiser.
- The surface decides physical form only. `voice` bans screen formatting and
  keeps a turn to one or two short sentences; `text` keeps the same length and
  puts a formula on its own line; `narration` is the authored 30-60 word beat
  voice of the recorded class.
- The language is the child's choice, not the surface's. `student.language`
  renders one register line (`src/language.ts`) as its own section above the
  speaking rules — the same line `@ai-tutor/tutor-judge` puts in the judge and
  the close. Absent, it renders nothing.

## For the developer: what to change, and where

| You want her to… | Change | Why it lives there |
|---|---|---|
| have a different name or self-description | `TUTOR.name` / `.role` / `.voice` in `src/traits.ts` | One constant; every surface picks it up on the next call |
| speak with a different synthesised voice | `TUTOR.speechVoiceName` in `src/traits.ts` | The recording and the live doubt read the same field, so they cannot drift into two teachers. Changing it changes both sides at once — and re-records nothing, so cached narration audio must be regenerated |
| commit to something new (or stop) | `TUTOR.values` / `TUTOR.neverDoes` in `src/traits.ts` | Values are positive commitments, neverDoes are prohibitions. Tests fail if the same behaviour appears in both, or if a banned phrase is used elsewhere in the package |
| push harder / go gentler on a strong student | `MASTERY_SECURE` in `src/factors.ts` | The single band boundary for "they hold this" |
| rebuild prerequisites sooner | `MASTERY_SHAKY` in `src/factors.ts` | Set below the knowledge graph's `GAP_THRESHOLD` so borderline nodes get consolidated, not rebuilt |
| notice a struggling lesson earlier | `DOUBT_PACE_THRESHOLD` in `src/factors.ts` | Hands raised before the pace itself is treated as the problem |
| change what "slow answer" means | `SLOW_ANSWER_MS` in `src/factors.ts` | Kept equal to the knowledge graph's slow-answer boundary so the two never disagree |
| reword how she handles one situation | the entry in `GUIDANCE` in `src/moments.ts` | One moment, one rule, nothing else touched |
| add a whole new situation | add to `MOMENTS` in `src/moments.ts` | The compiler then refuses to build until `GUIDANCE` has an entry for it |
| change spoken length or formatting rules | `SPEAKING` in `src/prompt.ts` | Surface rules are about physical form only, never character |
| adapt to a new signal | `StudentContext` + `FACTORS` + `describeFactors` in `src/factors.ts` | `FACTORS` is keyed by `keyof StudentContext`, so a new field will not compile until it is documented |
| reorder or retitle prompt sections | `buildSystemPrompt` in `src/prompt.ts` | The only place the prompt is assembled |

## Depends on

Nothing. It must stay that way — the diagnostic, the lesson factory, the
recorded player and the live agent all need to import her, and a dependency
here would drag one of them into the others.

## Tests

`npx vitest run packages/persona` — traits consistency, the one synthesised
voice reaching both sides of the seam, per-factor silence and speech, exhaustive
moment coverage, surface rules, and prompt determinism. No network, no fixtures
on disk.
