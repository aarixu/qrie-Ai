# @ai-tutor/doubt-session

**The handoff — the product's differentiator.** When the student taps ✋, the
recording pauses, a live agent takes over the same room, solves the doubt (and can
*recall* any earlier canvas moment by beat id), then speaks a bridging line and hands
back to the recording. This package is that seam, as a pure, fully-tested state
machine. **No AI inside** — the agent sits behind an adapter.

## The state machine

```
PLAYING → PAUSING → AGENT_ENTERING → LIVE → AGENT_LEAVING → RESUMING → PLAYING
```

`AGENT_ENTERING` / `AGENT_LEAVING` exist **only** to carry the bridging lines. They
are what make the seam invisible, so they are first-class states, not transitions.

## Public API

```ts
type HandoffState = 'PLAYING' | 'PAUSING' | 'AGENT_ENTERING' | 'LIVE' | 'AGENT_LEAVING' | 'RESUMING'

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

createStubAgent(): AgentAdapter     // deterministic scripted agent for dev/tests

entryLine(ctx: DoubtContext): string   // Hinglish bridge, deterministic per beatId
exitLine(ctx: DoubtContext): string

createHandoff(opts: {
  agent: AgentAdapter
  speak(text: string): Promise<void>     // how bridge lines + agent lines get voiced
  onPause(): void                        // pause the recording
  onResume(): void                       // resume the recording
  onRecall?(beatId: string): void        // canvas jump during LIVE
}): {
  readonly state: HandoffState
  raiseHand(ctx: DoubtContext): void     // legal only from PLAYING; else no-op
  sendUserText(text: string): void       // forwarded to the live session
  endDoubt(): void                       // manual end (agent's done() also ends)
  on(event: 'statechange' | 'agent-say', cb: (payload?: string) => void): () => void
}
```

## Design rules

- Illegal transitions are **no-ops, never throws** — a double-tap on ✋ must not
  crash a class.
- Bridge lines are deterministic (seeded by beatId) so tests can assert them.
- The machine never talks to TTS or the player directly — only through the
  callbacks it was given. Fully testable with fakes, no timers needed.

## Depends on

`@ai-tutor/lesson-format`. Nothing else.
