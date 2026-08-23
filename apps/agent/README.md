# @ai-tutor/agent

**The server side of the live doubt tutor.** A student is watching a recorded
class. They tap ✋: the recording pauses, and a *live* tutor takes over the same
room — she greets them, answers by voice, can pull an earlier moment of the class
back onto the canvas, and hands the room back to the recording. This service is
the half of that seam that does not run in the browser.

It is two processes and one contract:

| File | What it is |
|---|---|
| `src/worker.ts` | the LiveKit agent worker — Gemini Live behind `AgentSession`, with two tools |
| `src/tokenServer.ts` | a ~150-line HTTP server that mints join tokens and dispatches the agent |
| `src/messages.ts` | the room control contract — **the browser imports this file** |
| `src/protocol.ts` | the briefing + HTTP contract, and every parser for it |
| `src/brief.ts` | brief → system prompt (via `@ai-tutor/persona`) + recall validation |
| `src/token.ts` | the join grant, in one place |
| `src/config.ts` | environment, read once and checked loudly |
| `src/workspaceResolve.ts` | lets bare `node` import `@ai-tutor/*` (see *The resolver shim*) |

No AI prompt is written in this service. The tutor's words come from
`@ai-tutor/persona`, the same package the recorded class uses — which is the
only reason the live tutor and the recording sound like one person.

## Running all three processes

The order matters only in one place: **the worker must be registered before the
first hand goes up**, because the agent is dispatched explicitly and a dispatch
to a worker that is not there is simply lost.

```bash
# 1. THE ROOM — livekit-server 1.13.5, no Docker needed on Windows
livekit-server --dev
#    -> ws://127.0.0.1:7880, api key "devkey", api secret "secret"

# 2. CONFIGURE
cp apps/agent/.env.example apps/agent/.env
#    LIVEKIT_URL=ws://127.0.0.1:7880
#    LIVEKIT_API_KEY=devkey
#    LIVEKIT_API_SECRET=secret
#    GOOGLE_API_KEY=<your Gemini key>

# 3. THE TUTOR — registers as agent "ai-tutor-doubt" and then waits
npm run agent:worker            # from the repo root
#    look for: registered worker ... agentName: "ai-tutor-doubt"

# 4. THE TOKEN SERVER — http://127.0.0.1:7890
npm run agent:token
curl http://127.0.0.1:7890/health

# 5. THE STUDENT — the classroom app on :5173
npm run dev
```

`npm run worker:start` is the production form of step 3 (info-level logs, no dev
warnings). Both run the TypeScript source directly: Node 24 strips the types,
there is no build step here either.

### Pointing at LiveKit Cloud instead

Three variables, nothing else:

```
LIVEKIT_URL=wss://<project>.livekit.cloud
LIVEKIT_API_KEY=<project key>
LIVEKIT_API_SECRET=<project secret>
```

Both processes read the same three. Skip step 1; everything else is identical.
For production also set `TOKEN_SERVER_ORIGIN` to the real site origin and
`TOKEN_SERVER_HOST=0.0.0.0` if something other than a local reverse proxy has to
reach it.

## What happens when a hand goes up

```
browser                     tokenServer                 livekit-server        worker
   |  POST /token  --------->  mint (15 min, mic only)      |                    |
   |  <---- {url, token} -----                              |                    |
   |  connect ------------------------------------------->  join                 |
   |  POST /doubt {room, brief} -> createDispatch(brief) ->  dispatch ----------> entry()
   |                                                        |                    ctx.job.metadata
   |  <====== her voice, on the agent's audio track ======= agent joins <---------|
   |  <-- data "recall_moment" (topic tutor-control) -----------------------------|
   |  <-- data "end_doubt"     (topic tutor-control) -----------------------------|
```

**Why two endpoints and not one.** The agent must arrive *after* the student is
connected. Dispatching at mint time sends her into an empty room to speak her
opening line to nobody while the browser is still negotiating WebRTC — and that
opening line is the first half of the seam. Keeping them separate also makes a
second raised hand in the same lesson one cheap POST on a connection that is
already open, instead of a new token and a new join.

**Why the brief travels on the dispatch and not in the token.** Anything baked
into a token is frozen until the token is reissued, and the beat changes with
every raised hand. Dispatch metadata is per-invocation, which is exactly the
shape of this problem.

## HTTP API

```ts
POST /token   { room, identity, name? }
           -> { url, token, room, identity, expiresInSec }

POST /doubt   { room, brief: DoubtBrief }
           -> { dispatchId, room, agentName }

GET  /health -> { ok: true, agentName, livekitUrl }
```

`DoubtBrief` (see `src/protocol.ts` for the exact type):

```ts
{
  lessonId, beatId, beatTopic,          // required
  studentIdentity,                      // required — who she is talking to
  student: { klass: 6..12, ... },       // required klass; the rest are persona factors
  subject?, title?,
  transcriptSoFar, onScreen, recallableBeats: { id, topic }[]
}
```

It mirrors `DoubtContext` from `@ai-tutor/doubt-session`, renamed to match
`@ai-tutor/persona`'s `LessonContext`, which is what it is fed into:
`visibleElementIds → onScreen`, `recentBeats → recallableBeats`. Everything is
validated; a brief with no usable class is **refused** rather than defaulted,
because persona shapes every sentence around the class and a guess would put a
Class 12 explanation in front of a Class 6 student.

The grant on a student token is the narrowest that works: join one room,
publish the microphone *only* (`canPublishSources`), subscribe, publish data.
No camera, no screen share, no metadata rewriting, no room admin. TTL is 15
minutes — one doubt including a reconnect.

CORS allows exactly one origin (`TOKEN_SERVER_ORIGIN`, default
`http://localhost:5173`), never `*`; `*` is refused at startup rather than
warned about. A request with no `Origin` header at all (curl, a health probe) is
allowed through without a CORS header, because CORS was never what stopped
those.

## The room contract (what the browser must implement)

Import the types — do not redeclare them:

```ts
import {
  TUTOR_CONTROL_TOPIC,
  decodeTutorControl,
} from '@ai-tutor/agent/src/messages.ts';

room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
  if (topic !== TUTOR_CONTROL_TOPIC) return;
  const message = decodeTutorControl(payload);
  if (message === null) return;
  switch (message.type) {
    case 'recall_moment': stage.showBeat(message.beatId); break;
    case 'end_doubt':     handoff.endDoubt(); break;      // reason: 'resolved' | 'failed'
  }
});
```

Filter on the **topic**, not on the sender: LiveKit publishes its own
transcriptions on `lk.transcription`, and the sender identity can arrive
undefined when the agent leaves in the same breath as its last packet.

Three notes for whoever wires this into `apps/classroom`:

1. **She greets the student herself.** The agent opens with a `generateReply()`
   in the `DOUBT_OPENING` moment. Do **not** also speak `entryLine()` from
   `@ai-tutor/doubt-session` on this path, or the student hears two greetings.
   `exitLine()` is still yours: it is spoken after `end_doubt` arrives.
2. **Render the agent's audio track**, and when an avatar is added later, render
   the *avatar* participant instead (see the avatar slot in `src/worker.ts`).
3. `apps/classroom` has no Vite alias for `@ai-tutor/agent`, and does not need
   one: the workspace symlink makes `@ai-tutor/agent/src/messages.ts` resolve
   for both Vite and `tsc` today. The file imports nothing from LiveKit or Node,
   so it costs the bundle a few bytes and nothing else.

## The two tools

| Tool | What it does |
|---|---|
| `recall_moment(beatId)` | publishes `{ type: 'recall_moment', beatId }` — the canvas jumps to that beat |
| `end_doubt()` | waits for her closing line to finish playing, publishes `{ type: 'end_doubt', reason: 'resolved' }`, and shuts the job down |

`recall_moment` **validates the id against `recallableBeats`** and returns a
helpful correction to the model when it is unknown, listing the ids that are
real. An invented id would either blank the board or show a later part of the
lesson and spoil it. The confirmation string names the beat's topic, because the
model cannot see the canvas — the Gemini Live plugin's `pushVideo` is a no-op in
1.7, so a tool's return string is her only knowledge of what the student is
looking at.

## Decisions you should not undo without measuring

- **Model is `gemini-2.5-flash-native-audio-latest`.** `generateReply()` throws
  on any id containing `3.1` (the plugin disables mid-session updates for those),
  and our handoff opens with her greeting the student.
  `gemini-2.5-flash-native-audio-preview-12-2025` answers "CONTENT_TYPE_AUDIO is
  not supported" on this key.
- **Voice is `Sulafat`** — the same voice `tools/record-class` narrates every
  recorded lesson with. If these two drift apart, the seam becomes audible and
  the product's one trick stops working.
- **`agentName` is set**, which turns automatic dispatch OFF. Without it the
  worker joins every room in the project, meaning every student who is merely
  *watching* a recording gets a live Gemini session burning tokens beside them.
- **`record: false`.** Every recording category defaults to ON in agents 1.7 —
  session audio, transcript, traces, logs. We teach children between 11 and 18.
  Their voices and their doubts do not leave the room they were spoken in.
- **`vad: null`.** Gemini Live runs its own server-side VAD and barge-in; the
  framework's bundled silero VAD would be a second opinion we never consult,
  plus a native module loaded into every forked job.

## The resolver shim

`src/workspaceResolve.ts` installs one Node resolve hook: if a specifier cannot
be resolved at all, retry it with `.ts` / `/index.ts`. The workspace packages
ship TypeScript source with extensionless relative imports (`./traits`), which
Vite and Vitest resolve and bare Node refuses — and apps/agent is the first
consumer that is neither. It is a fallback, not a rewrite: nothing that resolves
today resolves differently. `src/worker.ts` therefore imports `./brief.ts`
dynamically, *after* the hook is installed, because ESM resolves an entire static
import graph before running a line of it.

Delete both the shim and the dynamic import the day every package writes
explicit `.ts` extensions.

## When this path is worth running at all

Be honest about this: **`apps/classroom/src/lib/liveAgent.ts` already does live
voice doubts with no server at all**, by opening a Gemini Live websocket
straight from the browser. It works, and it is one process instead of three.

Prefer the browser-direct path when:

- you are developing, demoing, or testing the seam. Three processes is three
  things to get wrong at a demo.
- the Gemini key can live on the client, e.g. a local build or an internal pilot.
- one student is alone in their doubt, which today is always.

Prefer this path (LiveKit) when:

- **the Gemini key must not be in the browser.** This is the real reason. On the
  browser-direct path every student's device holds a key that can be extracted
  and spent. Here the key never leaves the worker, and the browser only ever
  receives a 15-minute token scoped to one room.
- **you want a talking avatar.** Avatar services publish a video track into a
  LiveKit room; there is no room on the browser-direct path to publish into.
  See the avatar slot in `src/worker.ts` for the two rules that decide whether
  it works.
- **more than one participant** needs to be in the doubt — a parent, a human
  teacher taking over, a second student.
- **you need server-side control of the session**: enforcing time limits, model
  choice or safety policy on a device you do not trust, or recording a session
  deliberately (we do not).

Both paths implement the same `AgentAdapter` from `@ai-tutor/doubt-session`, so
the handoff state machine, the bridging lines and the canvas recall are shared.
Choosing between them is a wiring decision in `apps/classroom`, not a rewrite.

## Tests

```bash
npx vitest run apps/agent
```

They cover the pure half — message encoding and decoding, brief parsing
including malformed dispatch metadata, beat-id validation, the prompt coming out
of persona, the token grant shape, and the environment readers. **No test needs
a LiveKit server, a network or a clock.** What is left in `worker.ts` and
`tokenServer.ts` is what only exists when a real room does; verify that by
running the three processes above.
