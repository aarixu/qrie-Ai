# @ai-tutor/doubt-session

**The handoff — the product's differentiator.** When the student taps ✋, the
recording pauses, a live agent takes over the same room, solves the doubt (and can
*recall* any earlier canvas moment by beat id), then speaks a bridging line and hands
back to the recording. This package is that seam, as a pure, fully-tested state
machine. **No AI inside** — the agent sits behind an adapter.

## The state machine

```
PLAYING → PAUSING → AGENT_ENTERING → LIVE → AGENT_LEAVING → RESUMING → PLAYING

any state → HALTED   (terminal)
```

`AGENT_ENTERING` / `AGENT_LEAVING` exist **only** to carry the bridging lines. They
are what make the seam invisible, so they are first-class states, not transitions.

`HALTED` is where a doubt goes when the caller's safety screen stops the class:
either `speak` resolves `{ halted: true }` (her line was replaced with the support
reply), or the caller calls `halt()` (the student's own words were distress). The
session is stopped, nothing further is spoken, the exit line is skipped, `onResume`
is never called and no new hand is accepted. Nothing leads out of it.

A doubt also closes itself after `maxStudentTurns` student messages (default
`DEFAULT_MAX_STUDENT_TURNS`, 6): after her answer to the last allowed turn she says
`closingLine` instead of the exit line and hands back. A message past the cap is
never forwarded to the agent, and does not cut short an answer to the last
allowed turn that is still on its way: that answer is said, then the closing line.

## Public API

```ts
type HandoffState = 'PLAYING' | 'PAUSING' | 'AGENT_ENTERING' | 'LIVE' | 'AGENT_LEAVING' | 'RESUMING' | 'HALTED'

interface DoubtContext {
  lessonId: string
  beatId: string
  beatTopic: string
  transcriptSoFar: string          // narration of all beats up to & incl. current
  visibleElementIds: string[]
  recentBeats: { id: string; topic: string }[]   // for "recall" targets
}
buildContext(lesson: Lesson, beatIndex: number): DoubtContext

interface AgentIO {
  say(text: string): Promise<void>   // resolves when spoken (app routes to TTS)
  recall(beatId: string): void       // jump the canvas to that beat's state
  done(): void                       // agent signals the doubt is resolved
}
interface AgentAdapter { start(ctx: DoubtContext, io: AgentIO): AgentSession }
interface AgentSession { sendUserText(text: string): void; stop(): void }

createStubAgent(options?: { opening?: boolean }): AgentAdapter
                                    // deterministic scripted agent for dev/tests;
                                    // opening: false skips its greeting and recall (a relief)

// --- brief.ts : the live tutor's system prompt ---------------------------
// StudentContext, and every word of her character, come from @ai-tutor/persona.
type DoubtMoment = 'opening' | 'answering' | 'closing'
type DoubtSurface = 'voice' | 'text'
interface DoubtBriefOptions {
  moment: DoubtMoment
  surface: DoubtSurface
  subject?: string               // e.g. "Science" — from the syllabus, when the caller knows it
  title?: string                 // the lesson's own title
}
buildDoubtBrief(ctx: DoubtContext, student: StudentContext, options: DoubtBriefOptions): string

interface RecallTarget { readonly id: string; readonly topic: string }
recallTargets(ctx: DoubtContext): readonly RecallTarget[]   // what the prompt lists
isRecallable(ctx: DoubtContext, beatId: string): boolean    // what the adapter checks

entryLine(ctx: DoubtContext): string   // bridge in, deterministic per beatId
exitLine(ctx: DoubtContext): string
closingLine(ctx: DoubtContext): string // said instead of exitLine at the turn cap

createHandoff(opts: {
  agent: AgentAdapter
  // how bridge lines + agent lines get voiced; onSaid reports the line that
  // actually came out (the caption), { halted: true } halts the machine
  speak(text: string, onSaid: (said: string) => void): Promise<{ halted: boolean } | void>
  onPause(): void                        // pause the recording
  onResume(): void                       // resume the recording (never once HALTED)
  onRecall?(beatId: string): void        // canvas jump during LIVE
  maxStudentTurns?: number               // default DEFAULT_MAX_STUDENT_TURNS (6)
}): {
  readonly state: HandoffState
  raiseHand(ctx: DoubtContext): void     // legal only from PLAYING; else no-op
  sendUserText(text: string): void       // forwarded to the live session, up to the cap
  endDoubt(): void                       // manual end (agent's done() also ends)
  halt(): void                           // stop for good, from any state
  on(event: 'statechange' | 'agent-say', cb: (payload?: string) => void): () => void
}
```

## The briefing

`buildDoubtBrief` is the only place a live doubt tutor's system prompt is
written. Three call sites used to hand-write one each — the typed agent, the
spoken agent and the LiveKit worker — and they had already drifted, which is why
`@ai-tutor/persona` exists. Nothing in this package writes tutor prose: her
character, her prohibitions and her speaking rules all come out of persona, and
this module only maps a `DoubtContext` onto persona's `LessonContext` and picks
the moment and the surface.

```ts
const ctx = buildContext(lesson, beatIndex);

const systemPrompt = buildDoubtBrief(ctx, student, {
  moment: 'opening',      // 'answering' once they have asked, 'closing' on the way out
  surface: 'voice',       // 'text' for the typed doubt
  title: lesson.title,    // plus subject, where the caller knows it from the syllabus
});

// The same list, both sides of the model:
//   recallTargets(ctx) is what the prompt enumerates
//   isRecallable(ctx, id) is what the adapter checks before moving the canvas
if (isRecallable(ctx, reply.beatId)) io.recall(reply.beatId);
```

Two rules carry across from persona and are worth repeating here:

- **An unknown student signal is passed through, never filled in.** A default
  invented here would be indistinguishable from a measurement by the time the
  model read it, so absent stays absent and persona says nothing about it.
- **The offered ids and the accepted ids are one set.** `isRecallable` is
  derived from `recallTargets`, because a prompt that offers an id the
  validator refuses shows up in class as the tutor promising a diagram and the
  board staying blank.

## Design rules

- Illegal transitions are **no-ops, never throws** — a double-tap on ✋ must not
  crash a class.
- Bridge lines are deterministic (seeded by beatId) so tests can assert them.
- The machine never talks to TTS or the player directly — only through the
  callbacks it was given. Fully testable with fakes, no timers needed.

## Depends on

`@ai-tutor/lesson-format` for the `Lesson` document `buildContext` reads, and
`@ai-tutor/persona` for the tutor herself — `buildDoubtBrief` assembles her
prompt rather than writing one, so the live tutor and the recorded one are the
same person. Nothing else, and no AI: the agent stays behind `AgentAdapter`.
